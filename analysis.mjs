import { calculateGoalScenario, calculateEquityShockScenario } from './goal-scenario.mjs';

/** Pure, deliberately narrow calculations for the portfolio prototype. */
export const sampleHoldings = [
  { id: 'broad', name: 'Sample Broad Market Fund', type: 'Mutual fund', asset: 'Equity', value: 420000, amc: 'Example Asset Management', exposure: { 'Example Bank': 0.10, 'Other issuers': 0.90 }, asOf: '2026-08-31' },
  { id: 'growth', name: 'Sample Growth Fund', type: 'Mutual fund', asset: 'Equity', value: 280000, amc: 'Example Asset Management', exposure: { 'Example Bank': 0.15, 'Other issuers': 0.85 }, asOf: '2026-08-31' },
  { id: 'banking', name: 'Sample Banking Theme Fund', type: 'Mutual fund', asset: 'Equity', value: 120000, amc: 'Example Asset Management', exposure: { 'Example Bank': 0.25, 'Other issuers': 0.75 }, asOf: '2026-08-31' },
  { id: 'gilt', name: 'Sample Government Bond Fund', type: 'Mutual fund', asset: 'Debt', value: 150000, amc: 'Sample Bond House', exposure: null, asOf: '2026-09-30' },
  { id: 'gold', name: 'Sample Gold Fund', type: 'Mutual fund', asset: 'Gold', value: 80000, amc: 'Sample Bond House', exposure: null, asOf: '2026-09-30' },
  { id: 'bank-stock', name: 'Example Bank', type: 'Stock', asset: 'Equity', value: 70000, exposure: { 'Example Bank': 1 }, asOf: '2026-09-30' },
];

export function analyzePortfolio(holdings, goal = { years: 3, target: 2000000 }, today = new Date()) {
  const valid = holdings.filter(h => Number.isFinite(Number(h.value)) && Number(h.value) > 0);
  const total = valid.reduce((sum, h) => sum + Number(h.value), 0);
  const linkedIds = Array.isArray(goal.linkedIds) ? new Set(goal.linkedIds) : null;
  const goalHoldings = linkedIds ? valid.filter(holding => linkedIds.has(holding.id)) : valid;
  const goalTotal = goalHoldings.reduce((sum, holding) => sum + Number(holding.value), 0);
  const largestGoalPosition = largestPositionByIsin(goalHoldings);
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
  const amcs = new Map();
  const isinClassifications = new Map();
  let classifiedValue = 0;
  let fundValue = 0;
  let amcCoveredValue = 0;

  for (const holding of valid) {
    const value = Number(holding.value);
    if (typeof holding.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(holding.isin)) {
      const classifications = isinClassifications.get(holding.isin) || new Set();
      classifications.add(`${holding.type}|${holding.asset}`);
      isinClassifications.set(holding.isin, classifications);
    }
    assets[Object.hasOwn(assets, holding.asset) ? holding.asset : 'Other'] += value;
    if (holding.type === 'Mutual fund') {
      fundValue += value;
      const amc = typeof holding.amc === 'string' ? holding.amc.trim() : '';
      if (amc) {
        amcCoveredValue += value;
        const key = amc.toLocaleLowerCase('en-IN');
        const previous = amcs.get(key);
        amcs.set(key, { name: previous?.name || amc, value: (previous?.value || 0) + value });
      }
    }
    if (holding.exposure) {
      const weights = Object.entries(holding.exposure).filter(([, weight]) => Number.isFinite(weight) && weight > 0);
      const coveredWeight = Math.min(1, weights.filter(([issuer]) => issuer !== 'Other issuers').reduce((sum, [, weight]) => sum + weight, 0));
      classifiedValue += value * coveredWeight;
      for (const [issuer, weight] of weights) {
        if (issuer === 'Other issuers') continue;
        issuers.set(issuer, (issuers.get(issuer) || 0) + value * weight);
        const sources = issuerSources.get(issuer) || { funds: 0, stocks: 0 };
        if (holding.type === 'Mutual fund') sources.funds++;
        if (holding.type === 'Stock') sources.stocks++;
        issuerSources.set(issuer, sources);
      }
    }
  }

  const largestIssuer = [...issuers.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const largestIssuerSources = largestIssuer ? issuerSources.get(largestIssuer[0]) : null;
  const largestAmc = [...amcs.values()].sort((a, b) => b.value - a.value)[0] || null;
  const dated = valid.map(h => h.asOf).filter(date => parseValuationDate(date));
  const asOfSummary = dated.length === 0 ? 'Valuation dates not provided' :
    dated.length !== valid.length ? 'Some valuation dates missing' :
    new Set(dated).size === 1 ? `As of ${dated[0]}` : 'Mixed as-of dates';
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const staleCutoff = new Date(todayDate);
  staleCutoff.setUTCDate(staleCutoff.getUTCDate() - 90);
  const missingDates = valid.length - dated.length;
  const staleDates = dated.filter(date => parseValuationDate(date) < staleCutoff).length;
  const futureDates = dated.filter(date => parseValuationDate(date) > todayDate).length;
  const years = Number(goal.years);
  const target = Number(goal.target);
  const validGoal = Number.isFinite(years) && years > 0 && Number.isFinite(target) && target > 0;
  const scenario = calculateGoalScenario(goalTotal, goal);
  const shock = calculateEquityShockScenario(goalTotal, goalEquityValue, target, Number(goal.equityDropPct ?? 20));
  const equityPct = total ? (assets.Equity / total) * 100 : 0;
  const findings = [];
  const fundHouseSummaries = new Set(valid.filter(holding => holding.granularity === 'fund_house')
    .map(holding => holding.amc?.toLocaleLowerCase('en-IN')).filter(Boolean));
  const conflictingIsins = [...isinClassifications.values()].filter(classifications => classifications.size > 1).length;
  if (conflictingIsins) {
    findings.push({ key: 'identity', tone: 'amber', label: 'Data quality', title: 'Check conflicting labels',
      detail: `${conflictingIsins} ISIN ${conflictingIsins === 1 ? 'appears' : 'appear'} with different holding types or asset categories. Recheck those rows before interpreting concentration or goal mix.` });
  }

  if (fundHouseSummaries.size) {
    findings.push({ key: 'summary', tone: 'amber', label: 'Statement detail', title: 'Only fund-house totals are visible',
      detail: `${fundHouseSummaries.size} fund ${fundHouseSummaries.size === 1 ? 'house is' : 'houses are'} represented by summary amounts, not individual schemes. Check a detailed CAS before judging scheme overlap, plan type or costs.` });
  }

  if (valid.length && (missingDates || staleDates || futureDates)) {
    const issues = [
      missingDates ? `${missingDates} without a valuation date` : null,
      staleDates ? `${staleDates} dated over 90 days ago` : null,
      futureDates ? `${futureDates} dated after today` : null,
    ].filter(Boolean).join('; ');
    findings.push({ key: 'valuation', tone: 'amber', label: 'Data quality', title: 'Check when these values were measured',
      detail: `${issues}. Refresh or verify those values before relying on the goal figures.` });
  }

  if (validGoal && goalTotal > 0 && years <= 5 && goalEquityPct >= 60) {
    findings.push({ key: 'horizon', tone: 'amber', label: 'Goal timing', title: 'The linked goal is relatively near',
      detail: `${goalEquityPct.toFixed(0)}% of the holdings assigned to this goal is equity, while the goal is ${years} ${years === 1 ? 'year' : 'years'} away. Consider how much loss the goal can absorb.` });
  }
  if (largestIssuer && total && largestIssuer[1] / total >= 0.10) {
    const sources = largestIssuerSources;
    const positions = sources.funds + sources.stocks;
    const route = sources.funds && sources.stocks ? 'visible fund holdings and a direct stock' :
      sources.funds ? 'visible fund holdings' : 'a direct stock';
    findings.push({ key: 'issuer', tone: 'rose', label: 'Visible concentration',
      title: positions > 1 ? 'One company appears in several places' : 'One company is a large holding',
      detail: `${largestIssuer[0]} accounts for at least ${(largestIssuer[1] / total * 100).toFixed(1)}% through ${route}.${fundValue ? ' Unnamed fund holdings could add more.' : ''}` });
  }
  if (valid.filter(h => h.asset === 'Equity' && h.type === 'Mutual fund').length >= 3) {
    findings.push({ key: 'funds', tone: 'blue', label: 'Fund roles', title: 'Check what each equity fund adds',
      detail: 'Several equity funds may own similar companies. Review their underlying holdings and the job each fund plays.' });
  }
  if (findings.length === 0 && total > 0) {
    findings.push({ key: 'review', tone: 'blue', label: 'Next review', title: 'Check the missing details',
      detail: 'A holdings snapshot shows composition, but transactions and current fund disclosures are needed for performance and precise overlap.' });
  }

  return {
    total, assets, equityPct, goalTotal, goalAssets, goalEquityPct, goalHoldingCount: goalHoldings.length,
    largestGoalPosition,
    largestIssuer, largestIssuerSources, largestAmc, fundValue, amcCoveredValue, asOfSummary,
    classifiedPct: total ? (classifiedValue / total) * 100 : 0,
    goalGap: validGoal ? Math.max(0, target - goalTotal) : null,
    scenario, shock,
    findings: findings.slice(0, 3),
  };
}

/** Combine only entries with the same valid-format ISIN and classification. */
function largestPositionByIsin(holdings) {
  const positions = new Map();
  holdings.forEach((holding, index) => {
    const identified = typeof holding.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(holding.isin);
    const summarized = holding.granularity === 'fund_house' && typeof holding.amc === 'string' && holding.amc.trim();
    const key = summarized ? `amc:${holding.amc.toLocaleLowerCase('en-IN')}` :
      identified ? `isin:${holding.isin}|${holding.type}|${holding.asset}` : `row:${index}`;
    const previous = positions.get(key);
    positions.set(key, previous ? { ...previous, value: previous.value + Number(holding.value), entries: previous.entries + 1 } :
      { name: summarized ? holding.amc : holding.name || 'Unnamed holding', value: Number(holding.value),
        entries: 1, ...(summarized ? { granularity: 'fund_house' } : {}) });
  });
  return [...positions.values()].reduce((largest, position) =>
    !largest || position.value > largest.value ? position : largest, null);
}

function parseValuationDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function overlapPercent(exposureA, exposureB) {
  if (!exposureA || !exposureB) return null;
  const keys = new Set([...Object.keys(exposureA), ...Object.keys(exposureB)]);
  // The fictional catch-all bucket has no issuer identity; it cannot establish overlap.
  keys.delete('Other issuers');
  return [...keys].reduce((sum, issuer) => sum + Math.min(exposureA[issuer] || 0, exposureB[issuer] || 0), 0) * 100;
}
