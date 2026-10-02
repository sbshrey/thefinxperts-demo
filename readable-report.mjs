import { analyzePortfolio } from './analysis.mjs';
import { MIX_ASSETS, compareMixPlan } from './mix-plan.mjs';
import { goalShare, summarizeGoalCoverage } from './goals.mjs';
import { reserveMonths } from './reserve.mjs';

const rupees = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const indiaDate = date => new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** A private, plain-text snapshot for reading or printing; never a restorable backup. */
export function buildReadableReport(state, preparedAt = new Date()) {
  if (state?.source !== 'user' || !Array.isArray(state.holdings) || state.holdings.length === 0 ||
      !Array.isArray(state.goals) || state.goals.some(goal => goal.confirmed !== true) ||
      !(preparedAt instanceof Date) || Number.isNaN(preparedAt.getTime())) return null;
  const goal = state.goals.find(item => item.id === state.activeGoalId);
  if (!goal) return null;
  const result = analyzePortfolio(state.holdings, goal, preparedAt, state.reserve);
  const monthsOfEssentials = reserveMonths(state.reserve);
  const goalCoverage = summarizeGoalCoverage(state.goals, state.activeGoalId, state.holdings);
  const fundHouseOther = state.holdings.some(holding => holding.granularity === 'fund_house' && holding.asset === 'Other');
  const lines = [
    'THEFINXPERTS | PRIVATE PORTFOLIO REVIEW',
    `Prepared (India): ${indiaDate(preparedAt)}`,
    'This file contains your holdings and values. Keep it private.',
    '',
    'PORTFOLIO SNAPSHOT',
    `Entered value: ${rupees(result.total)} across ${state.holdings.length} ${state.holdings.length === 1 ? 'holding' : 'holdings'}`,
    `Valuation dates: ${result.asOfSummary}`,
    `Asset mix: ${MIX_ASSETS.map(asset => `${asset} ${result.total ? (result.assets[asset] / result.total * 100).toFixed(1) : '0.0'}%`).join(' | ')}`,
    `Fund plan labels from entered names: Regular ${rupees(result.fundPlans.Regular)} | Direct ${rupees(result.fundPlans.Direct)} | unclear ${rupees(result.fundPlans.Unclear)}; current expense ratios not verified`,
    `Entered fund cost coverage: ${rupees(result.fundCost.coveredValue)} of ${rupees(result.fundValue)} fund value across ${result.fundCost.coveredCount} dated scheme ${result.fundCost.coveredCount === 1 ? 'entry' : 'entries'}`,
    ...(result.fundCost.coveredValue ? [`Weighted TER on covered fund value: ${result.fundCost.weightedPct.toFixed(2)}%; one-year illustration ${rupees(result.fundCost.annualIllustration)} if entered values and rates stayed unchanged. TER is already reflected in NAV, not an additional bill; rates and values are not independently verified.`] : []),
    ...(result.assets.Other > 0 ? [`Other category: ${rupees(result.assets.Other)}. ${fundHouseOther ?
      'CAMS non-equity totals are not classified as debt or gold here; check a detailed statement.' :
      'Check what these holdings contain before judging the asset mix.'}`] : []),
    '',
    `SELECTED GOAL: ${clean(goal.name)}`,
    `Age at goal date: ${Number(goal.age) + Number(goal.years)}`,
    `Time until goal: ${goal.years} ${goal.years === 1 ? 'year' : 'years'}`,
    `Goal cost in today's rupees: ${rupees(goal.target)}`,
    `Value linked to this goal: ${rupees(result.goalTotal)} across ${result.goalHoldingCount} ${result.goalHoldingCount === 1 ? 'holding' : 'holdings'}`,
    `Outside this goal: ${rupees(goalCoverage.elsewhereValue)} assigned to other goals across ${goalCoverage.elsewhereCount} ${goalCoverage.elsewhereCount === 1 ? 'holding' : 'holdings'}; ${rupees(goalCoverage.unassignedValue)} unassigned across ${goalCoverage.unassignedCount} ${goalCoverage.unassignedCount === 1 ? 'holding' : 'holdings'}. A shared holding may appear in more than one count; these amounts are excluded from this goal's figures.`,
    `Linked asset mix: ${result.goalTotal ? MIX_ASSETS.map(asset => `${asset} ${(result.goalAssets[asset] / result.goalTotal * 100).toFixed(1)}%`).join(' | ') : 'No holdings linked'}`,
    `Linked value needing a valuation-date check: ${rupees(result.goalDateCheck.value)} across ${result.goalDateCheck.count} holdings (missing, future or over 90 days old; entered values remain unverified)`,
    `Current gap before growth, inflation or tax: ${rupees(result.goalGap ?? 0)}`,
  ];
  if (monthsOfEssentials !== null) lines.push('', 'SEPARATE RESERVE CONTEXT',
    `Accessible money outside entered holdings: ${rupees(state.reserve.accessibleMoney)}`,
    `Monthly essential spending: ${rupees(state.reserve.monthlyEssentials)}`,
    `Coverage arithmetic: ${monthsOfEssentials.toFixed(1)} months of essentials. This money is not added to portfolio or goal values. Adequacy, access, income stability, debts and insurance are not assessed.`);
  if (goal.emergencyFunding) {
    const answer = { separate: 'I have separate accessible money', goal_holdings: 'I may use holdings linked to this goal',
      unsure: 'I am unsure' }[goal.emergencyFunding];
    if (answer) lines.push(`Your answer about unexpected essential expenses: ${answer}. This has not been verified.`);
  }
  if (result.scenario) {
    lines.push('', 'ILLUSTRATIVE GOAL-DATE SCENARIO',
      `With your entered ${result.scenario.returnPct}% growth, ${result.scenario.inflationPct}% inflation and ${rupees(result.scenario.monthlyContribution)} month-end contribution assumptions:`,
      `Goal cost: ${rupees(result.scenario.futureCost)} | linked holdings and planned contributions: ${rupees(result.scenario.projectedValue)} | gap: ${rupees(result.scenario.futureGap)}`,
      `Additional whole-rupee monthly amount above your plan: ${rupees(Math.ceil(result.scenario.monthlyAdditionalNeeded))}. Total mathematical monthly amount: ${rupees(Math.ceil(result.scenario.monthlyTotalNeeded))}.`,
      'This is arithmetic, not a return forecast or investment recommendation; taxes, fees and market losses may differ.');
  }
  if (result.shockContinuation) {
    lines.push('', 'HYPOTHETICAL EQUITY FALL AND GOAL DATE',
      `A ${result.shock.dropPct}% immediate fall in linked equity would remove ${rupees(result.shock.loss)} from the entered goal holdings.`,
      `With the same growth, inflation and monthly contribution assumptions afterward, the goal-date gap would be ${rupees(result.shockContinuation.futureGap)} versus ${rupees(result.scenario.futureGap)} before the fall.`,
      `Additional whole-rupee monthly amount above your plan: ${rupees(Math.ceil(result.shockContinuation.monthlyAdditionalNeeded))} after the fall versus ${rupees(Math.ceil(result.scenario.monthlyAdditionalNeeded))} before it.`,
      'This is a fixed-assumption illustration, not a forecast or investment recommendation; actual prices, cash flows and costs can differ.');
  }
  if (result.lossLimits?.affordable || result.lossLimits?.tolerable) {
    lines.push(`Illustrative linked-equity loss: ${rupees(result.shock.loss)} under the entered ${result.shock.dropPct}% one-time fall.`);
    if (result.lossLimits.affordable) lines.push(`Your entered amount coverable from other resources: ${rupees(result.lossLimits.affordable.limit)}; illustration ${result.lossLimits.affordable.excess ? `exceeds it by ${rupees(result.lossLimits.affordable.excess)}` : 'does not exceed it'}.`);
    if (result.lossLimits.tolerable) lines.push(`Your entered tolerable temporary fall: ${rupees(result.lossLimits.tolerable.limit)}; illustration ${result.lossLimits.tolerable.excess ? `exceeds it by ${rupees(result.lossLimits.tolerable.excess)}` : 'does not exceed it'}.`);
    lines.push('This comparison is not a formal risk profile or a suitability assessment; actual losses may differ.');
  }

  const mix = goal.targetMix ? compareMixPlan(result.goalAssets, result.goalTotal, goal.targetMix) : null;
  if (goal.targetMix) {
    lines.push('', 'YOUR CHOSEN MIX FOR THIS GOAL');
    if (result.goalAssets.Other > 0) {
      lines.push(`Comparison paused: ${rupees(result.goalAssets.Other)} of linked holdings is labelled Other. Check its asset category against a detailed statement or scheme information before interpreting debt or gold gaps.`);
    } else if (!mix) {
      lines.push('Assign valid holdings to this goal before comparing your chosen mix.');
    } else {
      for (const row of mix) {
        lines.push(`${row.asset}: current ${row.currentPct.toFixed(1)}% | chosen ${row.plannedPct.toFixed(1)}% | ${row.differencePct >= 0 ? '+' : ''}${row.differencePct.toFixed(1)} percentage points`);
      }
      lines.push('These are comparisons with your chosen mix, not amounts to buy or sell.');
    }
  }

  lines.push('', 'REVIEW QUESTIONS');
  [...result.findings, ...result.additionalFindings].forEach((finding, index) => {
    lines.push(`${index + 1}. ${finding.title}`, `   ${clean(finding.detail)}`,
      `   Why this appeared: ${clean(finding.basis)}`,
      `   What remains unknown: ${clean(finding.limitation)}`,
      `   Check next: ${finding.question}`);
  });
  if (!result.findings.length) lines.push('No findings yet. Check the entered holdings and goal.');

  lines.push('', 'ENTERED HOLDINGS');
  for (const holding of state.holdings) {
    const share = goalShare(goal, holding.id);
    const label = share ? `${share}% (${rupees(Number(holding.value) * share / 100)}) linked to selected goal` : 'not linked to selected goal';
    const detail = holding.granularity === 'fund_house' ? ' / fund-house summary, not a scheme' : '';
    lines.push(`- ${clean(holding.name)} | ${holding.type} / ${holding.asset}${detail}${holding.isin ? ` / supplied ISIN ${clean(holding.isin)}` : ''} | ${rupees(holding.value)} | as of ${holding.asOf || 'unknown'}${holding.expenseRatioPct !== undefined ? ` | entered TER ${holding.expenseRatioPct}% checked ${holding.expenseRatioAsOf}` : ''} | ${label}`);
  }
  lines.push('', 'IMPORTANT LIMITS',
    'Values and asset labels are as entered or imported; this is not a live price feed.',
    'Unknown fund constituents remain unknown. A fund-house summary is not a scheme-level review.',
    'A holdings snapshot cannot establish performance, taxes, exit loads or precise overlap.',
    'This educational review does not recommend buying, selling or rebalancing a security.',
    'Keep the separate JSON backup if you want to restore this review later.', '');
  return lines.join('\n');
}
