import { analyzePortfolio, valuationRowsNeedingCheck } from './analysis.mjs?v=356c52d3090e';
import { MIX_ASSETS } from './mix-plan.mjs?v=356c52d3090e';
import { goalShare, summarizeGoalCoverage } from './goals.mjs?v=356c52d3090e';
import { reserveMonths } from './reserve.mjs?v=356c52d3090e';
import { entryOriginText, valuationOriginText } from './entry-origin.mjs?v=356c52d3090e';
import { rupeesWithPaise } from './cost-basis.mjs?v=356c52d3090e';
import { calculateStraightLineGap, confirmedGoalAssumptions } from './goal-scenario.mjs?v=356c52d3090e';

const rupees = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const indiaDate = date => new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);

function fundCostLines(result) {
  const cost = result.fundCost;
  const lines = [`Entered fund cost coverage: ${rupees(cost.coveredValue)} of ${rupees(result.fundValue)} fund value across ${cost.coveredCount} dated scheme ${cost.coveredCount === 1 ? 'entry' : 'entries'}`];
  if (!cost.coveredValue) return lines;
  const rateDates = cost.oldestTerDate === cost.newestTerDate ?
    `Supplied TER date: ${cost.oldestTerDate}.` :
    `Supplied TER dates: ${cost.oldestTerDate} to ${cost.newestTerDate}.`;
  lines.push(`Weighted TER on covered fund value: ${cost.weightedPct.toFixed(2)}%; one-year illustration ${rupees(cost.annualIllustration)} if entered values and rates stayed unchanged. ${rateDates} TER is already reflected in NAV, not an additional bill or an amount actually paid; rates and values are not independently verified.`);
  if (cost.oldTerCount) lines.push(`${rupees(cost.oldTerValue)} of covered fund value uses ${cost.oldTerCount} supplied ${cost.oldTerCount === 1 ? 'rate' : 'rates'} dated over 90 days ago. Recheck ${cost.oldTerCount === 1 ? 'it' : 'them'} against the exact scheme and plan before using a current comparison; 90 days is a review prompt, not a TER rule.`);
  lines.push('Check the exact scheme and plan on its AMC daily TER disclosure. AMFI explains TER and where current rates are disclosed: https://www.amfiindia.com/investor/knowledge-center-info?zoneName=expenseRatio');
  return lines;
}

/** A private, plain-text snapshot for reading or printing; never a restorable backup. */
export function buildReadableReport(state, preparedAt = new Date()) {
  if (state?.source !== 'user' || !Array.isArray(state.holdings) || state.holdings.length === 0 ||
      !Array.isArray(state.goals) ||
      !(preparedAt instanceof Date) || Number.isNaN(preparedAt.getTime())) return null;
  const goal = state.goals.find(item => item.id === state.activeGoalId);
  if (!goal || goal.confirmed !== true) return buildPortfolioOnlyReport(state, preparedAt);
  const result = analyzePortfolio(state.holdings, goal, preparedAt, state.reserve, state.coverage);
  const assumptionsReady = confirmedGoalAssumptions(goal);
  const monthsOfEssentials = reserveMonths(state.reserve);
  const goalCoverage = summarizeGoalCoverage(state.goals, state.activeGoalId, state.holdings);
  const straightLineGap = result.goalTotal && !result.goalDateCheck.count && !result.goalAccessCheck.count ?
    calculateStraightLineGap(result.goalTotal, goal) : null;
  const fundHouseOther = state.holdings.some(holding => holding.granularity === 'fund_house' && holding.asset === 'Other');
  const lines = [
    'THEFINXPERTS | PRIVATE PORTFOLIO REVIEW',
    `Prepared (India): ${indiaDate(preparedAt)}`,
    'This file contains your holdings and values. Keep it private.',
    '',
    'PORTFOLIO SNAPSHOT',
    `Entered value: ${rupees(result.total)} across ${state.holdings.length} ${state.holdings.length === 1 ? 'holding' : 'holdings'}`,
    'Scope: only the holdings entered or imported here; check other fund and broker statements before treating this as your full portfolio.',
    ...(state.coverage ? [`Self reported coverage (unverified): mutual funds ${coverageText(state.coverage.mutualFunds)}; direct stocks ${coverageText(state.coverage.directStocks)}; other investments ${coverageText(state.coverage.otherInvestments)}. Other assets count only if entered.`] : ['Self reported coverage: not answered; this snapshot may be partial.']),
    `Valuation dates: ${result.asOfSummary}`,
    `Asset mix: ${MIX_ASSETS.map(asset => `${asset} ${result.total ? (result.assets[asset] / result.total * 100).toFixed(1) : '0.0'}%`).join(' | ')}`,
    `Fund plan labels from entered names: Regular ${rupees(result.fundPlans.Regular)} | Direct ${rupees(result.fundPlans.Direct)} | unclear ${rupees(result.fundPlans.Unclear)}; current expense ratios not verified`,
    ...fundCostLines(result),
    ...(result.unrealizedChange.coveredCount ? [`Entered unrealized ${result.unrealizedChange.change >= 0 ? 'gain' : 'loss'} on ${result.unrealizedChange.coveredCount} cost-covered ${result.unrealizedChange.coveredCount === 1 ? 'holding' : 'holdings'}: ${rupeesWithPaise(Math.abs(result.unrealizedChange.change))}; current covered value ${rupeesWithPaise(result.unrealizedChange.coveredValue)} less invested amount ${rupeesWithPaise(result.unrealizedChange.invested)}. ${result.unrealizedChange.missingCount} ${result.unrealizedChange.missingCount === 1 ? 'row' : 'rows'} excluded. This is not lifetime profit or annual return.`] : []),
    ...(result.unrealizedChange.costAfterValueCount ? [`Cost checked after its holding value date: ${result.unrealizedChange.costAfterValueCount} ${result.unrealizedChange.costAfterValueCount === 1 ? 'row' : 'rows'} excluded from gain or loss until a value is refreshed for the same current position.`] : []),
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
    result.goalHoldingCount ?
      `Current gap before growth, inflation or tax: ${rupees(result.goalGap)}` :
      'Current gap: unavailable until a confirmed holding is linked to this goal.',
    ...(straightLineGap ? [`Simple monthly gap: ${rupees(straightLineGap.gapToday)} in today's rupees divided by ${straightLineGap.months} months = about ${rupees(straightLineGap.roundedMonthly)} per month, rounded up. This is division only, not an amount to invest or a forecast; inflation, returns, taxes, future contributions and missing holdings are excluded.`] :
      result.goalTotal && (result.goalDateCheck.count || result.goalAccessCheck.count) ?
        ['Simple monthly gap paused until linked value dates and withdrawal access are checked.'] : []),
    ...(result.goalAccessCheck.count ? [`Gross gap includes ${rupees(result.goalAccessCheck.value)} in ${result.goalAccessCheck.count} linked other ${result.goalAccessCheck.count === 1 ? 'investment' : 'investments'} with no verified access date. If none of those amounts can be used for this goal, the gap in today's rupees would be ${rupees(result.goalGapIfOtherUnavailable)}. This is a what-if bound, not proof that they are locked. Goal-date projection is paused; check product terms before treating this value as available for the goal.`] : []),
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
  if (!result.goalTotal) lines.push('', 'GOAL-DATE SCENARIO PAUSED',
    'Link a confirmed holding to this goal before using a future illustration. Other entered holdings are not counted here.');
  else if (!assumptionsReady) lines.push('', 'GOAL-DATE SCENARIO PAUSED',
    'Confirm your monthly contribution, growth and inflation assumptions in the goal editor before using a future illustration. Zero is valid when deliberately chosen.');
  else if (result.goalDateCheck.count) lines.push('', 'GOAL-DATE SCENARIO PAUSED',
    'Check missing, future or over-90-day valuation dates on linked holdings before using a future illustration.');
  else if (result.goalAccessCheck.count) lines.push('', 'GOAL-DATE SCENARIO PAUSED',
    'Check when linked other investments can be used. Their entered values count toward the gross gap today, but access at the goal date has not been verified.');
  else if (!result.scenario) lines.push('', 'GOAL-DATE SCENARIO PAUSED',
    'The entered goal and linked holdings do not support a future illustration. Check their values and goal details.');
  if (result.goalTotal && assumptionsReady && !result.goalDateCheck.count && result.scenario) {
    lines.push('', 'ILLUSTRATIVE GOAL-DATE SCENARIO',
      `With your entered ${result.scenario.returnPct}% growth, ${result.scenario.inflationPct}% inflation and ${rupees(result.scenario.monthlyContribution)} month-end contribution assumptions:`,
      `Goal cost: ${rupees(result.scenario.futureCost)} | linked holdings and planned contributions: ${rupees(result.scenario.projectedValue)} | gap: ${rupees(result.scenario.futureGap)}`,
      `Additional whole-rupee monthly amount above your plan: ${rupees(Math.ceil(result.scenario.monthlyAdditionalNeeded))}. Total mathematical monthly amount: ${rupees(Math.ceil(result.scenario.monthlyTotalNeeded))}.`,
      ...(result.flatScenario ? [`For comparison, with 0% growth and the same monthly amount and inflation, the goal-date gap would be ${rupees(result.flatScenario.futureGap)}.`] : []),
      'This is arithmetic, not a return forecast or investment recommendation; taxes, fees and market losses may differ.');
  }
  if (result.goalTotal && assumptionsReady && !result.goalDateCheck.count && result.shockContinuation) {
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
  appendHoldings(lines, state.holdings, goal);
  lines.push('', 'IMPORTANT LIMITS',
    'Values and asset labels are as entered or imported; a user-entered NAV or stock-price estimate is not a live price feed.',
    'Unknown fund constituents remain unknown. A fund-house summary is not a scheme-level review.',
    'A checked invested amount can show only an unrealized change on covered holdings; a holdings snapshot cannot establish annualized return, lifetime profit, taxes, exit loads or precise overlap.',
    'This educational review does not recommend buying, selling or rebalancing a security.',
    'Keep the separate JSON backup if you want to restore this review later.', '');
  return lines.join('\n');
}

function buildPortfolioOnlyReport(state, preparedAt) {
  // Only portfolio fields are used; the empty goal prevents unconfirmed goal arithmetic.
  const result = analyzePortfolio(state.holdings, { linkedIds: [], years: 0, target: 0 },
    preparedAt, state.reserve, state.coverage);
  const dateChecks = valuationRowsNeedingCheck(state.holdings, preparedAt);
  const portfolioFindings = [...result.findings, ...result.additionalFindings].filter(finding =>
    ['scope', 'identity', 'valuation', 'summary', 'classification', 'issuer', 'plan', 'funds', 'review'].includes(finding.key));
  const lines = [
    'THEFINXPERTS | PRIVATE PORTFOLIO SNAPSHOT',
    `Prepared (India): ${indiaDate(preparedAt)}`,
    'This file contains your holdings and values. Keep it private.',
    '', 'PORTFOLIO SNAPSHOT',
    `Entered value: ${rupees(result.total)} across ${state.holdings.length} ${state.holdings.length === 1 ? 'holding' : 'holdings'}`,
    'Scope: only the holdings entered or imported here; check other fund and broker statements before treating this as your full portfolio.',
    ...(state.coverage ? [`Self reported coverage (unverified): mutual funds ${coverageText(state.coverage.mutualFunds)}; direct stocks ${coverageText(state.coverage.directStocks)}; other investments ${coverageText(state.coverage.otherInvestments)}. Other assets count only if entered.`] : ['Self reported coverage: not answered; this snapshot may be partial.']),
    `Valuation dates: ${result.asOfSummary}`,
    `Asset mix: ${MIX_ASSETS.map(asset => `${asset} ${result.total ? (result.assets[asset] / result.total * 100).toFixed(1) : '0.0'}%`).join(' | ')}`,
    'Largest entered positions (matching supplied ISIN and classification grouped; fund-house totals remain summaries):',
    ...result.topPositions.map((position, index) =>
      `${index + 1}. ${clean(position.name)} | ${rupees(position.value)} | ${result.total ? (position.value / result.total * 100).toFixed(1) : '0.0'}% of entered value${position.granularity === 'fund_house' ? ' | fund-house summary, schemes unknown' : ''}`),
    `Fund plan labels from entered names: Regular ${rupees(result.fundPlans.Regular)} | Direct ${rupees(result.fundPlans.Direct)} | unclear ${rupees(result.fundPlans.Unclear)}; current expense ratios not verified`,
    ...fundCostLines(result),
    ...(result.unrealizedChange.coveredCount ? [`Entered unrealized ${result.unrealizedChange.change >= 0 ? 'gain' : 'loss'} on ${result.unrealizedChange.coveredCount} cost-covered ${result.unrealizedChange.coveredCount === 1 ? 'holding' : 'holdings'}: ${rupeesWithPaise(Math.abs(result.unrealizedChange.change))}. ${result.unrealizedChange.missingCount} ${result.unrealizedChange.missingCount === 1 ? 'row' : 'rows'} excluded. This is not lifetime profit or annual return.`] : []),
    '', 'GOAL CONTEXT',
    'No confirmed selected goal. Age, time horizon and target have not been used to calculate a gap, future value or suitable mix.',
    ...(goalName(state) ? [`Draft selected goal: ${clean(goalName(state))}; its details remain unconfirmed.`] : []),
    '', 'REVIEW QUESTIONS',
    `Coverage to check: ${state.coverage ? 'compare your self reported answers with current fund, broker and other investment statements' : 'confirm whether all mutual funds, direct stocks and other investments are included'}.`,
    `Value dates to check: ${dateChecks.length} ${dateChecks.length === 1 ? 'holding' : 'holdings'} with a missing, future or over-90-day date; ${rupees(dateChecks.reduce((sum, item) => sum + Number(item.row.value), 0))} of entered value. Dated values are still not live quotes.`,
  ];
  portfolioFindings.forEach((finding, index) => lines.push(
    `${index + 1}. ${finding.title}`,
    `   ${clean(finding.detail)}`,
    `   Why this appeared: ${clean(finding.basis)}`,
    `   What remains unknown: ${clean(finding.limitation)}`,
    `   Check next: ${finding.key === 'issuer' ? 'Check how this company exposure could affect your portfolio, including any unknown fund holdings.' : clean(finding.question)}`));
  lines.push('Confirm a goal when you want goal-date arithmetic. For personal investment decisions, discuss these facts and your full circumstances with a SEBI-registered investment adviser.',
    '', 'ENTERED HOLDINGS');
  appendHoldings(lines, state.holdings);
  lines.push('', 'IMPORTANT LIMITS',
    'Values and asset labels are as entered or imported; a user-entered NAV or stock-price estimate is not a live price feed.',
    'Unknown fund constituents remain unknown. A fund-house summary is not a scheme-level review.',
    'A checked invested amount can show only an unrealized change on covered holdings; a holdings snapshot cannot establish annualized return, lifetime profit, taxes, exit loads or precise overlap.',
    'This educational snapshot does not recommend buying, selling or rebalancing a security.',
    'Keep the separate JSON backup if you want to restore this review later.', '');
  return lines.join('\n');
}

function goalName(state) {
  const goal = state.goals.find(item => item.id === state.activeGoalId);
  return goal?.name && goal.name !== 'My goal' ? goal.name : null;
}

function appendHoldings(lines, holdings, goal = null) {
  for (const holding of holdings) {
    const share = goal ? goalShare(goal, holding.id) : 0;
    const label = goal ? (share ? `${share}% (${rupees(Number(holding.value) * share / 100)}) linked to selected goal` : 'not linked to selected goal') : 'goal allocation not yet confirmed';
    const detail = holding.granularity === 'fund_house' ? ' / fund-house summary, not a scheme' : '';
    lines.push(`- ${clean(holding.name)} | ${holding.type} / ${holding.asset}${detail}${holding.statementCategory ? ` / statement category ${clean(holding.statementCategory)}` : ''}${holding.isin ? ` / supplied ISIN ${clean(holding.isin)}` : ''} | ${rupees(holding.value)} | as of ${holding.asOf || 'unknown'} | originally added from ${entryOriginText(holding.entryOrigin)}${holding.valuationOrigin ? ` | latest value from ${valuationOriginText(holding.valuationOrigin)}` : ''}${holding.expenseRatioPct !== undefined ? ` | entered TER ${holding.expenseRatioPct}% checked ${holding.expenseRatioAsOf}` : ''} | ${label}`);
    if (holding.navEstimate) lines.push(`  User-entered NAV estimate: ${holding.units} statement units × ₹${holding.navEstimate.nav} on ${holding.navEstimate.navAsOf}; original statement value ${rupees(holding.navEstimate.originalValue)} on ${holding.navEstimate.originalAsOf || 'unknown'}. Units and exact scheme were confirmed by the investor, not independently verified here.`);
    if (holding.shares) lines.push(`  Entered direct-stock shares: ${holding.shares}. Check trades and corporate actions against a current broker report.`);
    if (holding.costBasis !== undefined) lines.push(`  Entered invested amount for current units or shares: ${rupeesWithPaise(holding.costBasis)} checked ${holding.costBasisAsOf}. This is investor-supplied, not a verified transaction history.`);
    if (holding.stockEstimate) lines.push(`  User-entered stock-price estimate: ${holding.shares} shares × ₹${holding.stockEstimate.price} on ${holding.stockEstimate.priceAsOf}; earlier entered value ${rupees(holding.stockEstimate.originalValue)} on ${holding.stockEstimate.originalAsOf}. Shares, security and quote were confirmed by the investor, not independently verified here.`);
  }
}

function coverageText(value) {
  return ({ all: 'all included', some: 'some missing', none: 'none owned', unsure: 'unsure' })[value] || 'not answered';
}
