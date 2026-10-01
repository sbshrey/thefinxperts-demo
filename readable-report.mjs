import { analyzePortfolio } from './analysis.mjs';
import { MIX_ASSETS, compareMixPlan } from './mix-plan.mjs';

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
  const result = analyzePortfolio(state.holdings, goal, preparedAt);
  const linked = new Set(goal.linkedIds || []);
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
    ...(result.assets.Other > 0 ? [`Other category: ${rupees(result.assets.Other)}. ${fundHouseOther ?
      'CAMS non-equity totals are not classified as debt or gold here; check a detailed statement.' :
      'Check what these holdings contain before judging the asset mix.'}`] : []),
    '',
    `SELECTED GOAL: ${clean(goal.name)}`,
    `Age at goal date: ${Number(goal.age) + Number(goal.years)}`,
    `Time until goal: ${goal.years} ${goal.years === 1 ? 'year' : 'years'}`,
    `Goal cost in today's rupees: ${rupees(goal.target)}`,
    `Value linked to this goal: ${rupees(result.goalTotal)} across ${result.goalHoldingCount} ${result.goalHoldingCount === 1 ? 'holding' : 'holdings'}`,
    `Linked asset mix: ${result.goalTotal ? MIX_ASSETS.map(asset => `${asset} ${(result.goalAssets[asset] / result.goalTotal * 100).toFixed(1)}%`).join(' | ') : 'No holdings linked'}`,
    `Linked value needing a valuation-date check: ${rupees(result.goalDateCheck.value)} across ${result.goalDateCheck.count} holdings (missing, future or over 90 days old; entered values remain unverified)`,
    `Current gap before growth, inflation or tax: ${rupees(result.goalGap ?? 0)}`,
  ];
  if (result.lossLimits?.affordable || result.lossLimits?.tolerable) {
    lines.push(`Illustrative linked-equity loss: ${rupees(result.shock.loss)} under the entered ${result.shock.dropPct}% one-time fall.`);
    if (result.lossLimits.affordable) lines.push(`Your entered amount coverable from other resources: ${rupees(result.lossLimits.affordable.limit)}; illustration ${result.lossLimits.affordable.excess ? `exceeds it by ${rupees(result.lossLimits.affordable.excess)}` : 'does not exceed it'}.`);
    if (result.lossLimits.tolerable) lines.push(`Your entered tolerable temporary fall: ${rupees(result.lossLimits.tolerable.limit)}; illustration ${result.lossLimits.tolerable.excess ? `exceeds it by ${rupees(result.lossLimits.tolerable.excess)}` : 'does not exceed it'}.`);
    lines.push('This comparison is not a formal risk profile or a suitability assessment; actual losses may differ.');
  }

  const mix = goal.targetMix ? compareMixPlan(result.goalAssets, result.goalTotal, goal.targetMix) : null;
  if (mix) {
    lines.push('', 'YOUR CHOSEN MIX FOR THIS GOAL');
    for (const row of mix) {
      lines.push(`${row.asset}: current ${row.currentPct.toFixed(1)}% | chosen ${row.plannedPct.toFixed(1)}% | ${row.differencePct >= 0 ? '+' : ''}${row.differencePct.toFixed(1)} percentage points`);
    }
    lines.push('These are comparisons with your chosen mix, not amounts to buy or sell.');
  }

  lines.push('', 'REVIEW QUESTIONS');
  result.findings.forEach((finding, index) => {
    lines.push(`${index + 1}. ${finding.title}`, `   ${finding.detail}`,
      `   Why this appeared: ${clean(finding.basis)}`,
      `   What remains unknown: ${clean(finding.limitation)}`,
      `   Check next: ${finding.question}`);
  });
  if (!result.findings.length) lines.push('No findings yet. Check the entered holdings and goal.');

  lines.push('', 'ENTERED HOLDINGS');
  for (const holding of state.holdings) {
    const label = linked.has(holding.id) ? 'linked to selected goal' : 'not linked to selected goal';
    const detail = holding.granularity === 'fund_house' ? ' / fund-house summary, not a scheme' : '';
    lines.push(`- ${clean(holding.name)} | ${holding.type} / ${holding.asset}${detail} | ${rupees(holding.value)} | as of ${holding.asOf || 'unknown'} | ${label}`);
  }
  lines.push('', 'IMPORTANT LIMITS',
    'Values and asset labels are as entered or imported; this is not a live price feed.',
    'Unknown fund constituents remain unknown. A fund-house summary is not a scheme-level review.',
    'A holdings snapshot cannot establish performance, taxes, exit loads or precise overlap.',
    'This educational review does not recommend buying, selling or rebalancing a security.',
    'Keep the separate JSON backup if you want to restore this review later.', '');
  return lines.join('\n');
}
