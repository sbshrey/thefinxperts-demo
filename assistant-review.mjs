import { analyzePortfolio } from './analysis.mjs?v=21be8df22fab';
import { goalShare } from './goals.mjs?v=21be8df22fab';
import { calculateStraightLineGap } from './goal-scenario.mjs?v=21be8df22fab';

/** The chat dashboard reads saved facts; all scenario numbers come from the review engine. */
export function buildAssistantGoalReview(portfolio, today = new Date()) {
  if (!portfolio || !Array.isArray(portfolio.goals)) return { kind: 'none' };
  const goal = portfolio.goals.find(item => item.id === portfolio.activeGoalId);
  if (!goal) return { kind: 'none' };
  if (goal.confirmed !== true) {
    const missing = [
      ['age', goal.age], ['years until the goal', goal.years], ['target in today’s rupees', goal.target],
    ].filter(([, value]) => value === null || value === undefined).map(([label]) => label);
    const linked = (portfolio.holdings || []).filter(row => goal.linkedIds?.includes(row.id));
    return { kind: 'draft', name: goal.name, missing, mixPlan: goal.targetMix || null, linkedCount: linked.length,
      linkedValue: linked.reduce((sum, row) => sum + row.value * goalShare(goal, row.id) / 100, 0) };
  }
  const result = analyzePortfolio(portfolio.holdings, goal, today, portfolio.reserve, portfolio.coverage);
  const missingAssumptions = ['monthlyContribution', 'returnPct', 'inflationPct']
    .filter(field => goal.assumptionsChecked?.[field] !== true);
  const scenarioStatus = !result.goalTotal ? 'no_holdings' : missingAssumptions.length ? 'assumptions' :
    result.goalDateCheck.count ? 'valuation_dates' : result.goalAccessCheck.count ? 'access_uncertain' :
      result.scenario ? 'ready' : 'invalid';
  const straightLineGap = result.goalTotal && !result.goalDateCheck.count && !result.goalAccessCheck.count ?
    calculateStraightLineGap(result.goalTotal, goal) : null;
  return { kind: 'confirmed', name: goal.name, age: goal.age, years: goal.years, target: goal.target,
    linkedValue: result.goalTotal, linkedCount: result.goalHoldingCount,
    goalAssets: result.goalAssets,
    gapToday: result.goalHoldingCount ? result.goalGap : null,
    gapIfOtherUnavailable: result.goalGapIfOtherUnavailable,
    straightLineGap,
    coverage: portfolio.coverage || null, emergencyFunding: goal.emergencyFunding || null,
    dateCheckCount: result.goalDateCheck.count, accessCheck: result.goalAccessCheck,
    scenario: scenarioStatus === 'ready' ? result.scenario : null,
    flatScenario: scenarioStatus === 'ready' ? result.flatScenario : null,
    scenarioStatus, missingAssumptions,
    mixPlan: goal.targetMix || null, mixComparison: result.mixComparison, mixPause: result.mixPause,
    stressPause: result.stressPause, shock: result.stressPause === null ? result.shock : null,
    lossLimits: result.stressPause === null ? result.lossLimits : null,
    lossInputs: { affordable: goal.affordableLoss, tolerable: goal.tolerableLoss },
    assumptions: { monthlyContribution: goal.monthlyContribution, returnPct: goal.returnPct,
      inflationPct: goal.inflationPct },
    findings: [...result.findings, ...result.additionalFindings].slice(0, 2).map(item => ({
      title: item.title, detail: item.detail, basis: item.basis, limitation: item.limitation,
    })) };
}

/** Carry the same sourced review findings into the chat side panel. */
export function buildAssistantReviewChecks(holdings, portfolio, today = new Date()) {
  const rows = Array.isArray(portfolio?.holdings) ? portfolio.holdings : holdings;
  if (!Array.isArray(rows) || !rows.length) return [];
  const goal = portfolio?.goals?.find(item => item.id === portfolio.activeGoalId) ||
    { name: 'My goal', age: null, years: null, target: null, confirmed: false, linkedIds: [] };
  const result = analyzePortfolio(rows, goal, today, portfolio?.reserve, portfolio?.coverage);
  return [...result.findings, ...result.additionalFindings].map(item => ({
    key: item.key, title: item.title, detail: item.detail, question: item.question,
    basis: item.basis, limitation: item.limitation,
  }));
}

/** One immediate, factual check for the compact goal card. */
export function goalNextCheck(review) {
  if (review.kind !== 'confirmed') return null;
  if (!review.linkedCount) return 'Link a confirmed holding to this goal.';
  if (review.dateCheckCount)
    return `Check the value dates of ${review.dateCheckCount} linked holding${review.dateCheckCount === 1 ? '' : 's'}.`;
  if (review.accessCheck?.count) return 'Check when the linked other investments can be used.';
  if (review.findings?.[0]) return `${review.findings[0].title}.`;
  if (review.missingAssumptions?.length) return 'Confirm your own inputs for a future illustration.';
  return 'Ask “What should I check first?” for a factual review check.';
}
