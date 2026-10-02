import { analyzePortfolio } from './analysis.mjs';
import { goalShare } from './goals.mjs';

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
    return { kind: 'draft', name: goal.name, missing, linkedCount: linked.length,
      linkedValue: linked.reduce((sum, row) => sum + row.value * goalShare(goal, row.id) / 100, 0) };
  }
  const result = analyzePortfolio(portfolio.holdings, goal, today, portfolio.reserve, portfolio.coverage);
  return { kind: 'confirmed', name: goal.name, years: goal.years, target: goal.target,
    linkedValue: result.goalTotal, linkedCount: result.goalHoldingCount, gapToday: result.goalGap,
    dateCheckCount: result.goalDateCheck.count, scenario: result.scenario,
    assumptions: { monthlyContribution: goal.monthlyContribution, returnPct: goal.returnPct,
      inflationPct: goal.inflationPct },
    findings: [...result.findings, ...result.additionalFindings].slice(0, 2).map(item => ({
      title: item.title, detail: item.detail, basis: item.basis, limitation: item.limitation,
    })) };
}
