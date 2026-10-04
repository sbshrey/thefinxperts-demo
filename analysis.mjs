import { calculateGoalScenario, calculateEquityShockScenario, compareEnteredLossLimits, confirmedGoalAssumptions } from './goal-scenario.mjs?v=4e7b69b0d686';
import { compareMixPlan } from './mix-plan.mjs?v=4e7b69b0d686';
import { goalShare } from './goals.mjs?v=4e7b69b0d686';
import { reserveMonths } from './reserve.mjs?v=4e7b69b0d686';
import { summarizeUnrealizedChange } from './cost-basis.mjs?v=4e7b69b0d686';

/** Pure, deliberately narrow calculations for the portfolio prototype. */
export const sampleHoldings = [
  { id: 'broad', name: 'Sample Broad Market Fund', type: 'Mutual fund', asset: 'Equity', value: 420000, amc: 'Example Asset Management', isin: 'INF000000001', exposure: { 'Example Bank': 0.10, 'Other issuers': 0.90 }, asOf: '2026-08-31' },
  { id: 'growth', name: 'Sample Growth Fund', type: 'Mutual fund', asset: 'Equity', value: 280000, amc: 'Example Asset Management', isin: 'INF000000002', exposure: { 'Example Bank': 0.15, 'Other issuers': 0.85 }, asOf: '2026-08-31' },
  { id: 'banking', name: 'Sample Banking Theme Fund', type: 'Mutual fund', asset: 'Equity', value: 120000, amc: 'Example Asset Management', isin: 'INF000000003', exposure: { 'Example Bank': 0.25, 'Other issuers': 0.75 }, asOf: '2026-08-31' },
  { id: 'gilt', name: 'Sample Government Bond Fund', type: 'Mutual fund', asset: 'Debt', value: 150000, amc: 'Sample Bond House', exposure: null, asOf: '2026-09-30' },
  { id: 'gold', name: 'Sample Gold Fund', type: 'Mutual fund', asset: 'Gold', value: 80000, amc: 'Sample Bond House', exposure: null, asOf: '2026-09-30' },
  { id: 'bank-stock', name: 'Example Bank', type: 'Stock', asset: 'Equity', value: 70000, exposure: { 'Example Bank': 1 }, asOf: '2026-09-30' },
];

/** Keep only the fictional tour's entered dates recent as calendar time advances. */
export function freshFictionalHoldings(today = new Date()) {
  const indiaDay = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const dated = daysAgo => {
    const day = new Date(`${indiaDay}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - daysAgo);
    return day.toISOString().slice(0, 10);
  };
  return structuredClone(sampleHoldings).map(holding => ({
    ...holding, asOf: dated(holding.asset === 'Equity' ? 30 : 1),
  }));
}

/** Group only supplied mutual-fund house labels; no issuer or scheme look-through. */
export function summarizeFundHouses(holdings) {
  const houses = new Map();
  let fundValue = 0;
  let coveredValue = 0;
  for (const holding of holdings) {
    const value = Number(holding.value);
    if (holding.type !== 'Mutual fund' || !Number.isFinite(value) || value <= 0) continue;
    fundValue += value;
    const name = typeof holding.amc === 'string' ? holding.amc.trim() : '';
    if (!name) continue;
    coveredValue += value;
    const key = name.toLocaleLowerCase('en-IN');
    const previous = houses.get(key);
    houses.set(key, { name: previous?.name || name, value: (previous?.value || 0) + value });
  }
  const groups = [...houses.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'en-IN'));
  return { fundValue, coveredValue, largest: groups[0] || null,
    labelledHouseCount: groups.length, groups };
}

export function analyzePortfolio(holdings, goal = { years: 3, target: 2000000 }, today = new Date(), reserve = null, coverage = null) {
  const rupees = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
  const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const valid = holdings.filter(h => Number.isFinite(Number(h.value)) && Number(h.value) > 0);
  const fundHouses = summarizeFundHouses(valid);
  const fundValue = fundHouses.fundValue;
  const total = valid.reduce((sum, h) => sum + Number(h.value), 0);
  const unrealizedChange = summarizeUnrealizedChange(valid, today);
  const goalHoldings = Array.isArray(goal.linkedIds) ? valid.flatMap(holding => {
    const share = goalShare(goal, holding.id);
    return share ? [{ ...holding, value: Number(holding.value) * share / 100 }] : [];
  }) : valid;
  const goalTotal = goalHoldings.reduce((sum, holding) => sum + Number(holding.value), 0);
  const goalAccessCheck = goalHoldings.filter(holding => holding.type === 'Other investment')
    .reduce((check, holding) => ({ count: check.count + 1, value: check.value + Number(holding.value) }),
      { count: 0, value: 0 });
  const topPositions = positionsByIsin(valid).slice(0, 3);
  const topGoalPositions = positionsByIsin(goalHoldings).slice(0, 3);
  const largestGoalPosition = topGoalPositions[0] || null;
  const goalEquityValue = goalHoldings.filter(holding => holding.asset === 'Equity')
    .reduce((sum, holding) => sum + Number(holding.value), 0);
  const goalEquityPct = goalTotal ? goalEquityValue / goalTotal * 100 : 0;
  const assets = { Equity: 0, Debt: 0, Gold: 0, Other: 0 };
  const goalAssets = { Equity: 0, Debt: 0, Gold: 0, Other: 0 };
  for (const holding of goalHoldings) {
    goalAssets[Object.hasOwn(goalAssets, holding.asset) ? holding.asset : 'Other'] += Number(holding.value);
  }
  const issuers = new Map();
  const issuerSources = new Map();
  const isinClassifications = new Map();
  const stockLabelByIsin = new Map();
  for (const holding of valid) {
    if (holding.type === 'Stock' && typeof holding.isin === 'string' &&
        /^[A-Z]{2}[A-Z0-9]{10}$/.test(holding.isin) && typeof holding.name === 'string' &&
        !stockLabelByIsin.has(holding.isin)) stockLabelByIsin.set(holding.isin, holding.name);
  }
  let classifiedValue = 0;
  let costCoveredValue = 0;
  let annualCostIllustration = 0;
  let costCoveredCount = 0;
  const fundTerDates = [];
  let oldTerValue = 0;
  let oldTerCount = 0;
  const fundPlans = { Direct: 0, Regular: 0, Unclear: 0 };

  for (const holding of valid) {
    const value = Number(holding.value);
    if (typeof holding.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(holding.isin)) {
      const classifications = isinClassifications.get(holding.isin) || new Set();
      classifications.add(`${holding.type}|${holding.asset}`);
      isinClassifications.set(holding.isin, classifications);
    }
    assets[Object.hasOwn(assets, holding.asset) ? holding.asset : 'Other'] += value;
    if (holding.type === 'Mutual fund') {
      fundPlans[holding.granularity === 'fund_house' ? 'Unclear' : planFromName(holding.name)] += value;
      if (hasDatedFundTer(holding, today)) {
        costCoveredValue += value;
        annualCostIllustration += value * holding.expenseRatioPct / 100;
        costCoveredCount++;
        fundTerDates.push(holding.expenseRatioAsOf);
        if (valuationDateIssue(holding.expenseRatioAsOf, today) === 'stale') {
          oldTerValue += value;
          oldTerCount++;
        }
      }
    }
    if (holding.exposure) {
      const weights = Object.entries(holding.exposure).filter(([, weight]) => Number.isFinite(weight) && weight > 0);
      const coveredWeight = Math.min(1, weights.filter(([issuer]) => issuer !== 'Other issuers').reduce((sum, [, weight]) => sum + weight, 0));
      classifiedValue += value * coveredWeight;
      for (const [issuer, weight] of weights) {
        if (issuer === 'Other issuers') continue;
        const identity = holding.type === 'Stock' && weight === 1 && issuer === holding.name &&
          stockLabelByIsin.has(holding.isin) ? stockLabelByIsin.get(holding.isin) : issuer;
        issuers.set(identity, (issuers.get(identity) || 0) + value * weight);
        const sources = issuerSources.get(identity) || { funds: 0, stocks: 0 };
        if (holding.type === 'Mutual fund') sources.funds++;
        if (holding.type === 'Stock') sources.stocks++;
        issuerSources.set(identity, sources);
      }
    }
  }

  const largestIssuer = [...issuers.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const fundCost = { coveredValue: costCoveredValue, uncoveredValue: fundHouses.fundValue - costCoveredValue,
    coveredCount: costCoveredCount, annualIllustration: annualCostIllustration,
    weightedPct: costCoveredValue ? annualCostIllustration / costCoveredValue * 100 : null,
    oldestTerDate: fundTerDates.length ? fundTerDates.sort()[0] : null,
    newestTerDate: fundTerDates.length ? fundTerDates.at(-1) : null,
    oldTerValue, oldTerCount };
  const largestIssuerSources = largestIssuer ? issuerSources.get(largestIssuer[0]) : null;
  const largestAmc = fundHouses.largest;
  const dated = valid.map(h => h.asOf).filter(date => parseValuationDate(date));
  const orderedDates = [...dated].sort();
  const dateSpan = orderedDates[0] === orderedDates.at(-1) ? `as of ${orderedDates[0]}` :
    `from ${orderedDates[0]} to ${orderedDates.at(-1)}`;
  const asOfSummary = dated.length === 0 ? 'Valuation dates not provided' :
    dated.length !== valid.length ? `Valuation dates missing for ${valid.length - dated.length} of ${valid.length} holdings; dated values ${dateSpan}` :
    orderedDates[0] === orderedDates.at(-1) ? `As of ${orderedDates[0]}` :
      `Mixed as-of dates: ${orderedDates[0]} to ${orderedDates.at(-1)}`;
  const todayDate = new Date(`${indiaToday}T00:00:00Z`);
  const staleCutoff = new Date(todayDate);
  staleCutoff.setUTCDate(staleCutoff.getUTCDate() - 90);
  const dateIssues = valid.map(holding => valuationDateIssue(holding.asOf, today));
  const missingDates = dateIssues.filter(issue => issue === 'missing').length;
  const staleDates = dateIssues.filter(issue => issue === 'stale').length;
  const futureDates = dateIssues.filter(issue => issue === 'future').length;
  const dateCheckValue = valid.reduce((sum, holding, index) =>
    sum + (dateIssues[index] ? Number(holding.value) : 0), 0);
  const goalDateCheck = goalHoldings.reduce((check, holding) => {
    if (valuationDateIssue(holding.asOf, today)) {
      check.value += Number(holding.value);
      check.count++;
    }
    return check;
  }, { value: 0, count: 0 });
  const years = Number(goal.years);
  const target = Number(goal.target);
  const validGoal = Number.isFinite(years) && years > 0 && Number.isFinite(target) && target > 0;
  const scenario = goalTotal && !goalDateCheck.count && !goalAccessCheck.count && confirmedGoalAssumptions(goal) ?
    calculateGoalScenario(goalTotal, goal) : null;
  const flatScenario = scenario && scenario.returnPct !== 0 ?
    calculateGoalScenario(goalTotal, { ...goal, returnPct: 0 }) : null;
  const shockCandidate = typeof goal.equityDropPct === 'number' ?
    calculateEquityShockScenario(goalTotal, goalEquityValue, target, goal.equityDropPct) : null;
  const stressPause = goal.equityDropPct == null ? 'no_assumption' : !validGoal ? 'goal_details' :
    !goalTotal ? 'no_holdings' : goalDateCheck.count ? 'valuation_dates' :
      goalAccessCheck.count ? 'access_uncertain' :
        goalAssets.Other > 0 ? 'unclassified' :
        goalHoldings.some(holding => holding.granularity === 'fund_house') ? 'fund_house' :
          shockCandidate ? null : 'invalid';
  const shock = stressPause === null ? shockCandidate : null;
  const shockContinuation = scenario && shock?.loss > 0 ? calculateGoalScenario(shock.valueAfterLoss, goal) : null;
  const lossLimits = shock ? compareEnteredLossLimits(shock.loss, goal) : null;
  const equityPct = total ? (assets.Equity / total) * 100 : 0;
  const findings = [];
  if (goalAccessCheck.count) {
    findings.push({ key: 'goal-access', tone: 'amber', label: 'Goal timing',
      title: 'Check when linked savings can be used',
      detail: `${rupees(goalAccessCheck.value)} across ${goalAccessCheck.count} manually entered other ${goalAccessCheck.count === 1 ? 'investment is' : 'investments are'} linked to this goal. The future illustration stays paused while they are linked because this review cannot record a spendable amount at the goal date.`,
      question: 'Which linked amounts should be removed from this goal while you check their withdrawal terms?',
      basis: `Counted ${goalAccessCheck.count} linked other-investment ${goalAccessCheck.count === 1 ? 'row' : 'rows'} and their assigned shares, totalling ${rupees(goalAccessCheck.value)} of ${rupees(goalTotal)} linked value.`,
      limitation: 'Withdrawal, maturity, tax and sale conditions were not supplied or verified. The gap today still shows gross entered value, not confirmed spendable money.' });
  }
  const incompleteTypes = [
    ['mutual funds', coverage?.mutualFunds],
    ['direct stocks', coverage?.directStocks],
    ['other investments', coverage?.otherInvestments],
  ].filter(([, answer]) => answer === 'some' || answer === 'unsure' || answer == null);
  if (total > 0 && incompleteTypes.length) {
    const answers = incompleteTypes.map(([type, answer]) =>
      `${type}: ${answer === 'some' ? 'you reported missing holdings' : answer === 'unsure' ?
        'you are unsure whether all are included' : 'you have not answered yet'}`).join('; ');
    findings.push({ key: 'scope', tone: 'amber', label: 'Complete your snapshot',
      title: 'Check what this review leaves out',
      detail: `${coverage ? 'Your coverage check shows' : 'You have not checked portfolio coverage yet:'} ${answers}. Compare current fund, broker and other investment statements with the entered rows before treating these figures as your full portfolio.`,
      question: coverage ? 'Which current statement would help you complete or confirm the missing holdings?' :
        'Have you included all your mutual funds, direct stocks and other investments?',
      basis: `Self reported coverage: mutual funds ${coverage?.mutualFunds || 'not answered'}; direct stocks ${coverage?.directStocks || 'not answered'}; other investments ${coverage?.otherInvestments || 'not answered'}. Calculations use only ${rupees(total)} of entered value.`,
      limitation: 'Your coverage answer and entered values have not been independently verified. Other investments count only if you entered them.' });
  }
  const fundHouseSummaries = new Set(valid.filter(holding => holding.granularity === 'fund_house')
    .map(holding => holding.amc?.toLocaleLowerCase('en-IN')).filter(Boolean));
  const conflictingIsins = [...isinClassifications.values()].filter(classifications => classifications.size > 1).length;
  const goalIsinClassifications = new Map();
  for (const holding of goalHoldings) {
    if (typeof holding.isin !== 'string' || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(holding.isin)) continue;
    const labels = goalIsinClassifications.get(holding.isin) || new Set();
    labels.add(`${holding.type}|${holding.asset}`);
    goalIsinClassifications.set(holding.isin, labels);
  }
  const goalIdentityConflict = [...goalIsinClassifications.values()].some(labels => labels.size > 1);
  const goalExposureReady = validGoal && goalTotal > 0 && !goalDateCheck.count &&
    !goalAccessCheck.count && goalAssets.Other === 0 && !goalIdentityConflict &&
    !goalHoldings.some(holding => holding.granularity === 'fund_house');
  if (conflictingIsins) {
    findings.push({ key: 'identity', tone: 'amber', label: 'Data quality', title: 'Check conflicting labels',
      detail: `${conflictingIsins} ISIN ${conflictingIsins === 1 ? 'appears' : 'appear'} with different holding types or asset categories. Recheck those rows before interpreting concentration or goal mix.`,
      question: 'Which type and asset category does the original statement show for each conflicting ISIN?',
      basis: `Compared the type and asset label on every row sharing a format-valid ISIN; ${conflictingIsins} identifier ${conflictingIsins === 1 ? 'has' : 'have'} conflicting labels.`,
      limitation: 'An ISIN in an import has not been checked against an instrument registry.' });
  }

  if (valid.length && (missingDates || staleDates || futureDates)) {
    const issues = [
      missingDates ? `${missingDates} without a valuation date` : null,
      staleDates ? `${staleDates} dated over 90 days ago` : null,
      futureDates ? `${futureDates} dated after today` : null,
    ].filter(Boolean).join('; ');
    findings.push({ key: 'valuation', tone: 'amber', label: 'Data quality', title: 'Check when these values were measured',
      detail: `${rupees(dateCheckValue)} (${(dateCheckValue / total * 100).toFixed(1)}%) of entered value needs a date check: ${issues}. Refresh or verify those values before relying on the goal figures.`,
      question: 'Can you confirm the value and valuation date of each flagged holding?',
      basis: `Added values for ${missingDates + staleDates + futureDates} flagged rows: ${rupees(dateCheckValue)} ÷ ${rupees(total)} entered value = ${(dateCheckValue / total * 100).toFixed(1)}%. Compared ${valid.length} entered holding dates with ${indiaToday} in India; dates before ${staleCutoff.toISOString().slice(0, 10)} are marked over 90 days old. Missing or invalid dates are counted together.`,
      limitation: 'Ninety days is a prompt to recheck entered values, not a market-data freshness rule. The entered amounts and holdings have not been independently verified.' });
  }

  if (fundHouseSummaries.size) {
    findings.push({ key: 'summary', tone: 'amber', label: 'Statement detail', title: 'Only fund-house totals are visible',
      detail: `${fundHouseSummaries.size} fund ${fundHouseSummaries.size === 1 ? 'house is' : 'houses are'} represented by summary amounts, not individual schemes. Check a detailed CAS before judging scheme overlap, plan type or costs.`,
      question: 'Can you get a detailed CAS that lists each scheme and its current value?',
      basis: `Counted ${fundHouseSummaries.size} distinct fund-house names on rows marked as fund-house summaries.`,
      limitation: 'Those rows have no scheme identifier, so scheme overlap, plan type and costs cannot be calculated.' });
  }

  const unclassifiedValue = valid.filter(holding => holding.asset === 'Other' &&
    holding.type !== 'Other investment' &&
    holding.granularity !== 'fund_house').reduce((sum, holding) => sum + Number(holding.value), 0);
  if (unclassifiedValue > 0) {
    findings.push({ key: 'classification', tone: 'amber', label: 'Asset labels',
      title: 'Check holdings labelled Other',
      detail: `${rupees(unclassifiedValue)} of entered holding value is labelled Other. Check the original statement before using the asset mix for a goal.`,
      question: 'Which of these holdings can you classify from their original statements?',
      basis: `${rupees(unclassifiedValue)} labelled Other ÷ ${rupees(total)} entered value = ${(unclassifiedValue / total * 100).toFixed(1)}%. Fund-house summary portions are excluded from this check because they have a separate detail prompt.`,
      limitation: 'A statement label or fund name alone does not establish whether a holding belongs in Debt, Gold, Equity or another category. This is a data check, not a suggested allocation.' });
  }

  const monthsOfEssentials = reserveMonths(reserve);
  if (validGoal && goalTotal > 0 && goal.emergencyFunding === 'separate' && monthsOfEssentials === 0) {
    findings.push({ key: 'reserve', tone: 'amber', label: 'Check your answers',
      title: 'Your separate reserve answer needs a second look',
      detail: 'You selected separate accessible money for unexpected expenses, but entered ₹0 outside this portfolio. Check which answer reflects your situation before relying on the goal plan.',
      question: 'Is there accessible money outside these holdings that you want to include in the reserve check?',
      basis: `Entered ${rupees(reserve.accessibleMoney)} accessible money ÷ ${rupees(reserve.monthlyEssentials)} monthly essentials = 0 months; selected the separate-money answer for this goal.`,
      limitation: 'Only your entries are compared. Bank balances, income stability, insurance, debts and access to money are not verified.' });
  }
  if (validGoal && goalTotal > 0 && ['goal_holdings', 'unsure'].includes(goal.emergencyFunding)) {
    const mayUseGoal = goal.emergencyFunding === 'goal_holdings';
    findings.push({ key: 'emergency', tone: 'amber', label: 'Money needed sooner',
      title: 'Check how unexpected expenses affect this goal',
      detail: mayUseGoal ? 'You said you may need holdings linked to this goal for an unexpected essential expense. Consider how using them early would change the goal plan.' :
        'You are unsure where money for an unexpected essential expense would come from. Check this before relying on the goal scenario.',
      question: 'Where would money for an unexpected essential expense come from without disrupting this goal?',
      basis: `Used your answer about unexpected essential expenses for this goal; ${rupees(goalTotal)} of entered holdings is linked to it.${monthsOfEssentials === null ? '' : ` Separately entered accessible money covers ${monthsOfEssentials.toFixed(1)} months of essentials at the amounts you supplied.`}`,
      limitation: 'This answer does not verify accessible savings, income, obligations or the size and timing of an emergency. It is not a risk profile or a recommendation to move money.' });
  }
  const exceededLossChecks = stressPause === null && !goalIdentityConflict ?
    [['cover', lossLimits?.affordable], ['tolerate', lossLimits?.tolerable]]
      .filter(([, check]) => check?.excess > 0) : [];
  if (exceededLossChecks.length) {
    const comparisons = exceededLossChecks.map(([label, check]) =>
      `${rupees(check.excess)} above the ${rupees(check.limit)} you said you could ${label}`).join('; ');
    findings.push({ key: 'loss-capacity', tone: 'amber', label: 'Goal loss check',
      title: 'Your chosen fall exceeds an amount you entered',
      detail: `For ${goal.name || 'this goal'}, a one-time ${shock.dropPct}% fall in assigned Equity illustrates a ${rupees(shock.loss)} loss: ${comparisons}. Check whether those entered amounts still reflect your circumstances.`,
      question: 'Could you absorb this illustrated loss without disrupting essentials or the goal, and are the amounts you entered still accurate?',
      basis: `${rupees(goalEquityValue)} assigned Equity × your ${shock.dropPct}% hypothetical fall = ${rupees(shock.loss)} illustrated loss. Compared only with your entered cover and tolerance amounts; other asset values are held fixed.`,
      limitation: 'This is one hypothetical fall, not a forecast, worst case, risk profile, suitability verdict or instruction to trade. Holdings, dates, categories and loss amounts are supplied by you; fund constituents, liabilities and other assets are not verified.' });
  }

  const mixComparisonPause = !goal.targetMix ? 'no_mix' : !validGoal ? 'goal_details' :
    !goalTotal ? 'no_holdings' :
      goalHoldings.some(holding => holding.type === 'Other investment' && holding.asset === 'Other') ? 'other_investment' :
        goalAssets.Other > 0 ? 'unclassified' :
          goalDateCheck.count ? 'valuation_dates' : goalIdentityConflict ? 'conflicting_identity' :
            goalHoldings.some(holding => holding.granularity === 'fund_house') ? 'fund_house' : null;
  const mixComparison = mixComparisonPause === null ? compareMixPlan(goalAssets, goalTotal, goal.targetMix) : null;
  const mixPause = mixComparisonPause || (mixComparison ? null : 'invalid_mix');
  const largestMixDifference = mixComparison?.reduce((largest, row) =>
    !largest || Math.abs(row.differencePct) > Math.abs(largest.differencePct) ? row : largest, null);
  if (largestMixDifference && Math.abs(largestMixDifference.differencePct) >= 10) {
    const row = largestMixDifference;
    const direction = row.differencePct > 0 ? 'above' : 'below';
    findings.push({ key: 'chosen-mix', tone: 'blue', label: 'Your chosen goal mix',
      title: 'Your goal holdings differ from the mix you chose',
      detail: `${row.asset} is ${row.currentPct.toFixed(1)}% of the entered value linked to this goal, ${Math.abs(row.differencePct).toFixed(1)} percentage points ${direction} your chosen ${row.plannedPct.toFixed(1)}% share.`,
      question: 'Does the mix you entered still reflect what you want for this goal?',
      basis: `${rupees(goalAssets[row.asset])} labelled ${row.asset} ÷ ${rupees(goalTotal)} linked to this goal = ${row.currentPct.toFixed(1)}%; your entered mix assigns ${row.plannedPct.toFixed(1)}% to ${row.asset}. The largest difference is shown when it reaches 10 percentage points.`,
      limitation: 'This compares entered asset labels with your own mix. The 10-point trigger is a review prompt, not an allocation rule or a trade recommendation. Fund constituents, taxes and transaction costs are not assessed.' });
  }

  if (goalExposureReady && years <= 5 && goalEquityPct >= 60) {
    findings.push({ key: 'horizon', tone: 'amber', label: 'Goal timing', title: 'The linked goal is relatively near',
      detail: `${goalEquityPct.toFixed(0)}% of the holdings assigned to this goal is equity, while the goal is ${years} ${years === 1 ? 'year' : 'years'} away. Consider how much loss the goal can absorb.`,
      question: 'If equity falls before this goal date, how much of the goal cost can you still meet?',
      basis: `${rupees(goalEquityValue)} labelled Equity ÷ ${rupees(goalTotal)} linked to this goal = ${goalEquityPct.toFixed(1)}%; entered horizon ${years} ${years === 1 ? 'year' : 'years'}.`,
      limitation: 'Asset labels and values are as entered; this does not assess your cash reserve, liabilities or capacity for loss.' });
  }
  if (goalExposureReady && largestGoalPosition && largestGoalPosition.granularity !== 'fund_house' &&
      largestGoalPosition.value / goalTotal >= 0.5) {
    const share = largestGoalPosition.value / goalTotal * 100;
    findings.push({ key: 'position', tone: 'blue', label: 'Goal concentration', title: 'One position carries much of this goal',
      detail: `${String(largestGoalPosition.name).replace(/\s+/g, ' ').trim()} is ${share.toFixed(1)}% of the entered value linked to this goal. Check what this holding contains and the role you expect it to play.`,
      question: 'What is inside this position, and how would a setback affect this goal?',
      basis: `${rupees(largestGoalPosition.value)} in ${largestGoalPosition.entries} ${largestGoalPosition.entries === 1 ? 'entry' : 'entries'} ÷ ${rupees(goalTotal)} linked to this goal = ${share.toFixed(1)}%. Entries are combined only when their supplied ISIN and classification agree.`,
      limitation: 'The 50% trigger is a review prompt, not a target allocation. One fund may hold many securities, and unlinked holdings are outside this calculation; this share alone does not prove a need to trade.' });
  }
  if (!validGoal && total > 0) {
    const largestFundPosition = positionsByIsin(valid.filter(holding => holding.type === 'Mutual fund'))[0];
    if (largestFundPosition && largestFundPosition.granularity !== 'fund_house' &&
        largestFundPosition.value / total >= 0.5) {
      const share = largestFundPosition.value / total * 100;
      findings.push({ key: 'portfolio-position', tone: 'blue', label: 'Entered fund concentration',
        title: 'One fund position carries much of the entered value',
        detail: `${String(largestFundPosition.name).replace(/\s+/g, ' ').trim()} is ${share.toFixed(1)}% of the entered investment value. Check what this exact scheme holds and whether other investments are missing from this review.`,
        question: 'What does this scheme contain, and do your other accounts change this picture?',
        basis: `${rupees(largestFundPosition.value)} across ${largestFundPosition.entries} ${largestFundPosition.entries === 1 ? 'entry' : 'entries'} ÷ ${rupees(total)} entered value = ${share.toFixed(1)}%. Matching supplied ISINs are grouped; unidentified rows remain separate.`,
        limitation: 'The 50% trigger only chooses a review question. One fund may itself hold many securities, its contents and unentered investments are unknown, and this share does not establish a suitable allocation or a trade.' });
    }
  }
  if (largestIssuer && total && largestIssuer[1] / total >= 0.10) {
    const sources = largestIssuerSources;
    const positions = sources.funds + sources.stocks;
    const stockRoute = sources.stocks > 1 ? 'multiple direct stock entries' : 'a direct stock';
    const route = sources.funds && sources.stocks ? `visible fund holdings and ${stockRoute}` :
      sources.funds ? 'visible fund holdings' : stockRoute;
    findings.push({ key: 'issuer', tone: 'rose', label: 'Visible concentration',
      title: positions > 1 ? 'One company appears in several places' : 'One company is a large holding',
      detail: `${largestIssuer[0]} accounts for at least ${(largestIssuer[1] / total * 100).toFixed(1)}% through ${route}.${fundValue ? ' Unnamed fund holdings could add more.' : ''}`,
      question: 'Would a large fall in this one company materially change your goal, and is fund exposure still unknown?',
      basis: `${rupees(largestIssuer[1])} visible exposure ÷ ${rupees(total)} entered portfolio = ${(largestIssuer[1] / total * 100).toFixed(1)}%. Direct stock rows with the same supplied ISIN are grouped; any supplied fund constituent weights are added by issuer name.`,
      limitation: `Only ${(classifiedValue / total * 100).toFixed(1)}% of entered value has named-company coverage. ISINs and fund issuer names are not registry-verified; unknown or differently named fund holdings may add exposure.` });
  }
  const equityFundGroups = summarizeFundGroups(valid.filter(holding => holding.asset === 'Equity'));
  if (fundPlans.Regular > 0) {
    findings.push({ key: 'plan', tone: 'blue', label: 'Fund costs', title: 'Check fund plan and ongoing cost',
      detail: `${rupees(fundPlans.Regular)} of entered fund value has an explicit Regular Plan label. Check each scheme's current expense ratio and what service you receive before deciding whether its plan still fits.`,
      question: 'What is the current expense ratio for each labelled plan, and what guidance or service do you use?',
      basis: `Added ${rupees(fundPlans.Regular)} from mutual-fund names explicitly labelled Regular Plan; ${rupees(fundPlans.Direct)} is labelled Direct Plan and ${rupees(fundPlans.Unclear)} has no clear plan label.`,
      limitation: `Labels and any entered expense ratios are not registry-verified. Expense ratios cover ${rupees(costCoveredValue)} of ${rupees(fundValue)} entered fund value. Exit loads, tax lots and switching costs are unknown, so savings and a switch decision cannot be calculated.` });
  }
  if (equityFundGroups.total >= 3) {
    findings.push({ key: 'funds', tone: 'blue', label: 'Fund roles', title: 'Check what each equity fund adds',
      detail: 'Several entered equity-fund positions may own similar companies or represent different plans or options of one scheme. Check the exact schemes and their latest disclosed holdings.',
      question: 'Which exact schemes are these, and what distinct exposure does each add according to its latest disclosed holdings?',
      basis: `Counted ${equityFundGroups.total} supplied equity-fund groups: ${equityFundGroups.isinCount} distinct format-valid ISINs and ${equityFundGroups.nameCount} distinct names without a valid ISIN. Excluded fund-house summaries, repeated ISINs and names matching an identified row.`,
      limitation: 'Supplied ISINs and names are not registry-verified. A group count does not establish distinct schemes or company overlap; plan and option variants may share holdings, and current scheme disclosures are needed to compare companies.' });
  }
  if (findings.length === 0 && total > 0) {
    const hasStock = valid.some(holding => holding.type === 'Stock');
    const hasOther = valid.some(holding => holding.type === 'Other investment');
    const detail = fundValue ?
      'A holdings snapshot shows composition, but transactions and current fund disclosures are needed for performance and precise overlap.' :
      hasStock && hasOther ?
        'This snapshot shows dated stock and other-investment values. Broker records and product statements are needed to check current positions, access terms and performance.' :
        hasStock ?
          'This snapshot shows dated stock values. Check current settled shares and transaction history against broker records before calculating performance.' :
          'This snapshot shows manually entered other-investment values. Check a current statement and withdrawal or maturity terms before counting them toward a goal.';
    const question = fundValue ? 'Which missing statement or fund disclosure would answer your next portfolio question?' :
      hasStock && hasOther ? 'Which broker report or product statement would check these values and access terms?' :
        hasStock ? 'Which broker holdings report or transaction history can check these shares and costs?' :
          'Which statement and product terms establish this balance and when it can be used?';
    findings.push({ key: 'review', tone: 'blue', label: 'Next review', title: 'Check the missing details',
      detail, question,
      basis: `Calculated composition from ${valid.length} entered holding ${valid.length === 1 ? 'value' : 'values'}; no other rule yielded a priority review item.`,
      limitation: fundValue ?
        'A snapshot has no transaction history or verified fund constituents, so performance and precise overlap remain unknown.' :
        'Entered balances and dates are not independently verified. This snapshot has no complete transaction history or proof that every position and access term is current.' });
  }

  return {
    total, assets, equityPct, goalTotal, goalAssets, goalEquityPct, goalHoldingCount: goalHoldings.length,
    goalDateCheck, goalAccessCheck, mixComparison, mixPause,
    largestGoalPosition, topPositions, topGoalPositions,
    largestIssuer, largestIssuerSources, largestAmc, fundValue: fundHouses.fundValue,
    fundPlans, fundCost, amcCoveredValue: fundHouses.coveredValue, asOfSummary,
    unrealizedChange,
    classifiedPct: total ? (classifiedValue / total) * 100 : 0,
    goalGap: validGoal ? Math.max(0, target - goalTotal) : null,
    goalGapIfOtherUnavailable: validGoal && goalAccessCheck.count ?
      Math.max(0, target - (goalTotal - goalAccessCheck.value)) : null,
    scenario, flatScenario, shock, shockContinuation, lossLimits, stressPause,
    findings: findings.slice(0, 3), additionalFindings: findings.slice(3),
  };
}

/** Count supplied fund groups conservatively; a group is not proof of a distinct scheme. */
export function summarizeFundGroups(holdings) {
  const isins = new Set();
  const identifiedNames = new Set();
  const nameOnly = new Set();
  for (const holding of holdings) {
    if (holding.type !== 'Mutual fund' || holding.granularity === 'fund_house') continue;
    const name = typeof holding.name === 'string' ? holding.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN') : '';
    if (typeof holding.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(holding.isin)) {
      isins.add(holding.isin);
      if (name) identifiedNames.add(name);
    } else if (name) nameOnly.add(name);
  }
  for (const name of identifiedNames) nameOnly.delete(name);
  return { total: isins.size + nameOnly.size, isinCount: isins.size, nameCount: nameOnly.size };
}

/** Leave ambiguous or absent plan names unknown; an AMC summary is handled by the caller. */
export function planFromName(name) {
  if (typeof name !== 'string') return 'Unclear';
  const direct = /\bdirect\s*plan\b|(?:^|[-–(])\s*direct\s*(?=$|[-–)])/i.test(name);
  const regular = /\bregular\s*plan\b|(?:^|[-–(])\s*regular\s*(?=$|[-–)])/i.test(name);
  return direct === regular ? 'Unclear' : direct ? 'Direct' : 'Regular';
}

/** A checked, dated scheme rate is comparable; fund-house totals have no single TER. */
export function hasDatedFundTer(holding, today = new Date()) {
  const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return holding?.type === 'Mutual fund' && holding.granularity !== 'fund_house' &&
    Number.isFinite(holding.expenseRatioPct) && holding.expenseRatioPct >= 0 &&
    holding.expenseRatioPct <= 10 && Boolean(parseValuationDate(holding.expenseRatioAsOf)) &&
    holding.expenseRatioAsOf <= indiaToday;
}

/** Combine only entries with the same valid-format ISIN and classification. */
export function positionsByIsin(holdings, { withSourceIndexes = false } = {}) {
  const positions = new Map();
  holdings.forEach((holding, index) => {
    const identified = typeof holding.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(holding.isin);
    const summarized = holding.granularity === 'fund_house' && typeof holding.amc === 'string' && holding.amc.trim();
    const key = summarized ? `amc:${holding.amc.toLocaleLowerCase('en-IN')}` :
      identified ? `isin:${holding.isin}|${holding.type}|${holding.asset}` : `row:${index}`;
    const previous = positions.get(key);
    positions.set(key, previous ? { ...previous, value: previous.value + Number(holding.value),
      entries: previous.entries + 1,
      ...(withSourceIndexes ? { sourceIndexes: [...previous.sourceIndexes, index] } : {}) } :
      { name: summarized ? holding.amc : holding.name || 'Unnamed holding', value: Number(holding.value),
        entries: 1, ...(withSourceIndexes ? { sourceIndexes: [index] } : {}),
        ...(summarized ? { granularity: 'fund_house' } : {}) });
  });
  return [...positions.values()].sort((a, b) => b.value - a.value);
}

function parseValuationDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Calendar age of valid, nonfuture positive holding values in India. */
export function valuationAgeSummary(holdings, today = new Date()) {
  if (!Array.isArray(holdings)) return null;
  const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const todayDay = Date.parse(`${indiaToday}T00:00:00Z`) / 86_400_000;
  const dates = holdings.filter(row => Number.isFinite(Number(row?.value)) && Number(row.value) > 0)
    .map(row => row.asOf).filter(date => {
      const parsed = parseValuationDate(date);
      return parsed && date <= indiaToday;
    }).sort();
  if (!dates.length) return null;
  const oldestDate = dates[0], newestDate = dates.at(-1);
  return { oldestDate, newestDate, datedCount: dates.length,
    oldestDays: todayDay - Date.parse(`${oldestDate}T00:00:00Z`) / 86_400_000,
    newestDays: todayDay - Date.parse(`${newestDate}T00:00:00Z`) / 86_400_000 };
}

/** A 90-day value check, measured against the calendar date in India. */
export function valuationDateIssue(asOf, today = new Date()) {
  const date = parseValuationDate(asOf);
  if (!date) return 'missing';
  const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const todayDate = new Date(`${indiaToday}T00:00:00Z`);
  if (date > todayDate) return 'future';
  const staleCutoff = new Date(todayDate);
  staleCutoff.setUTCDate(staleCutoff.getUTCDate() - 90);
  return date < staleCutoff ? 'stale' : null;
}

/** Keep the original row number while showing the largest dated-value gaps first. */
export function valuationRowsNeedingCheck(holdings, today = new Date()) {
  if (!Array.isArray(holdings)) return [];
  return holdings.flatMap((row, index) => {
    const value = Number(row?.value);
    if (!Number.isFinite(value) || value <= 0) return [];
    const issue = valuationDateIssue(row.asOf, today);
    return issue ? [{ row, index, issue }] : [];
  }).sort((a, b) => Number(b.row.value) - Number(a.row.value) || a.index - b.index);
}

export function overlapPercent(exposureA, exposureB) {
  if (!exposureA || !exposureB) return null;
  const keys = new Set([...Object.keys(exposureA), ...Object.keys(exposureB)]);
  // The fictional catch-all bucket has no issuer identity; it cannot establish overlap.
  keys.delete('Other issuers');
  return [...keys].reduce((sum, issuer) => sum + Math.min(exposureA[issuer] || 0, exposureB[issuer] || 0), 0) * 100;
}
