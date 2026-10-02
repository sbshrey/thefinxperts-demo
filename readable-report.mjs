import { analyzePortfolio } from './analysis.mjs';
import { MIX_ASSETS } from './mix-plan.mjs';
import { goalShare, summarizeGoalCoverage } from './goals.mjs';
import { reserveMonths } from './reserve.mjs';
import { entryOriginText } from './entry-origin.mjs';
import { rupeesWithPaise } from './cost-basis.mjs';

const rupees = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const indiaDate = date => new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** A private, plain-text snapshot for reading or printing; never a restorable backup. */
export function buildReadableReport(state, preparedAt = new Date()) {
  if (state?.source !== 'user' || !Array.isArray(state.holdings) || state.holdings.length === 0 ||
      !Array.isArray(state.goals) ||
      !(preparedAt instanceof Date) || Number.isNaN(preparedAt.getTime())) return null;
  const goal = state.goals.find(item => item.id === state.activeGoalId);
  if (!goal || goal.confirmed !== true) return null;
  const result = analyzePortfolio(state.holdings, goal, preparedAt, state.reserve, state.coverage);
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
    'Scope: only the holdings entered or imported here; check other fund and broker statements before treating this as your full portfolio.',
    ...(state.coverage ? [`Self reported coverage (unverified): mutual funds ${coverageText(state.coverage.mutualFunds)}; direct stocks ${coverageText(state.coverage.directStocks)}. Other assets such as deposits, EPF and NPS are outside this review.`] : ['Self reported coverage: not answered; this snapshot may be partial.']),
    `Valuation dates: ${result.asOfSummary}`,
    `Asset mix: ${MIX_ASSETS.map(asset => `${asset} ${result.total ? (result.assets[asset] / result.total * 100).toFixed(1) : '0.0'}%`).join(' | ')}`,
    `Fund plan labels from entered names: Regular ${rupees(result.fundPlans.Regular)} | Direct ${rupees(result.fundPlans.Direct)} | unclear ${rupees(result.fundPlans.Unclear)}; current expense ratios not verified`,
    `Entered fund cost coverage: ${rupees(result.fundCost.coveredValue)} of ${rupees(result.fundValue)} fund value across ${result.fundCost.coveredCount} dated scheme ${result.fundCost.coveredCount === 1 ? 'entry' : 'entries'}`,
    ...(result.unrealizedChange.coveredCount ? [`Entered unrealized ${result.unrealizedChange.change >= 0 ? 'gain' : 'loss'} on ${result.unrealizedChange.coveredCount} cost-covered ${result.unrealizedChange.coveredCount === 1 ? 'holding' : 'holdings'}: ${rupeesWithPaise(Math.abs(result.unrealizedChange.change))}; current covered value ${rupeesWithPaise(result.unrealizedChange.coveredValue)} less invested amount ${rupeesWithPaise(result.unrealizedChange.invested)}. ${result.unrealizedChange.missingCount} ${result.unrealizedChange.missingCount === 1 ? 'row' : 'rows'} excluded. This is not lifetime profit or annual return.`] : []),
    ...(result.unrealizedChange.costAfterValueCount ? [`Cost checked after its holding value date: ${result.unrealizedChange.costAfterValueCount} ${result.unrealizedChange.costAfterValueCount === 1 ? 'row' : 'rows'} excluded from gain or loss until a value is refreshed for the same current position.`] : []),
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
    if (result.lossLimits.capacityGap !== null) lines.push(`Your tolerable amount is ${rupees(result.lossLimits.capacityGap)} above the amount you said you could cover. Check whether a loss between those amounts would delay this goal or essential spending.`);
    lines.push('This comparison is not a formal risk profile or a suitability assessment; actual losses may differ.');
  }

  const mix = result.mixComparison;
  if (goal.targetMix) {
    lines.push('', 'YOUR CHOSEN MIX FOR THIS GOAL');
    if (result.mixPause === 'unclassified') {
      lines.push(`Comparison paused: ${rupees(result.goalAssets.Other)} of linked holdings is labelled Other. Check its asset category against a detailed statement or scheme information before interpreting debt or gold gaps.`);
    } else if (!mix) {
      lines.push({
        valuation_dates: 'Comparison paused: check linked holding values with missing, future or over-90-day valuation dates before comparing your chosen mix.',
        conflicting_identity: 'Comparison paused: rows sharing an ISIN have conflicting type or asset labels. Correct them before comparing your chosen mix.',
        fund_house: 'Comparison paused: a linked fund-house total is not an individual scheme. Check a detailed statement before comparing your chosen mix.',
        no_holdings: 'Assign valid holdings to this goal before comparing your chosen mix.',
      }[result.mixPause] || 'Confirm the goal details and chosen percentages before comparing your mix.');
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
    lines.push(`- ${clean(holding.name)} | ${holding.type} / ${holding.asset}${detail}${holding.statementCategory ? ` / statement category ${clean(holding.statementCategory)}` : ''}${holding.isin ? ` / supplied ISIN ${clean(holding.isin)}` : ''} | ${rupees(holding.value)} | as of ${holding.asOf || 'unknown'} | originally added from ${entryOriginText(holding.entryOrigin)}${holding.valuationOrigin ? ` | latest value from ${entryOriginText(holding.valuationOrigin)}` : ''}${holding.expenseRatioPct !== undefined ? ` | entered TER ${holding.expenseRatioPct}% checked ${holding.expenseRatioAsOf}` : ''} | ${label}`);
    if (holding.navEstimate) lines.push(`  User-entered NAV estimate: ${holding.units} statement units × ₹${holding.navEstimate.nav} on ${holding.navEstimate.navAsOf}; original statement value ${rupees(holding.navEstimate.originalValue)} on ${holding.navEstimate.originalAsOf || 'unknown'}. Units and exact scheme were confirmed by the investor, not independently verified here.`);
    if (holding.shares) lines.push(`  Entered direct-stock shares: ${holding.shares}. Check trades and corporate actions against a current broker report.`);
    if (holding.costBasis !== undefined) lines.push(`  Entered invested amount for current units or shares: ${rupeesWithPaise(holding.costBasis)} checked ${holding.costBasisAsOf}. This is investor-supplied, not a verified transaction history.`);
    if (holding.stockEstimate) lines.push(`  User-entered stock-price estimate: ${holding.shares} shares × ₹${holding.stockEstimate.price} on ${holding.stockEstimate.priceAsOf}; earlier entered value ${rupees(holding.stockEstimate.originalValue)} on ${holding.stockEstimate.originalAsOf}. Shares, security and quote were confirmed by the investor, not independently verified here.`);
  }
  lines.push('', 'IMPORTANT LIMITS',
    'Values and asset labels are as entered or imported; a user-entered NAV or stock-price estimate is not a live price feed.',
    'Unknown fund constituents remain unknown. A fund-house summary is not a scheme-level review.',
    'A checked invested amount can show only an unrealized change on covered holdings; a holdings snapshot cannot establish annualized return, lifetime profit, taxes, exit loads or precise overlap.',
    'This educational review does not recommend buying, selling or rebalancing a security.',
    'Keep the separate JSON backup if you want to restore this review later.', '');
  return lines.join('\n');
}

function coverageText(value) {
  return ({ all: 'all included', some: 'some missing', none: 'none owned', unsure: 'unsure' })[value] || 'unsure';
}
