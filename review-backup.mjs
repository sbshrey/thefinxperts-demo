import { validMixPlan } from './mix-plan.mjs?v=d4e06b84f22c';
import { validReserve } from './reserve.mjs?v=d4e06b84f22c';
import { ENTRY_ORIGINS } from './entry-origin.mjs?v=d4e06b84f22c';
import { validNavEstimate } from './nav-estimate.mjs?v=d4e06b84f22c';
import { validShares, validStockEstimate } from './stock-estimate.mjs?v=d4e06b84f22c';
import { validCostBasis } from './cost-basis.mjs?v=d4e06b84f22c';
const MAX_BYTES = 2_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISIN = /^[A-Z]{2}[A-Z0-9]{10}$/;
const AMFI = /^\d{5,8}$/;
const TYPES = new Set(['Mutual fund', 'Stock', 'Other investment']);
const ASSETS = new Set(['Equity', 'Debt', 'Gold', 'Other']);
const TOP_KEYS = ['version', 'holdings', 'goals', 'activeGoalId', 'reserve', 'coverage'];
const COVERAGE = new Set(['all', 'some', 'none', 'unsure']);
function validCoverage(value) {
  return record(value) && [1, 2, 3].includes(Object.keys(value).length) &&
    Object.keys(value).every(key => ['mutualFunds', 'directStocks', 'otherInvestments'].includes(key)) &&
    Object.values(value).every(answer => COVERAGE.has(answer));
}
const HOLDING_KEYS = ['id', 'name', 'type', 'asset', 'value', 'asOf', 'amc', 'isin', 'amfi', 'granularity', 'units', 'statementCategory', 'expenseRatioPct', 'expenseRatioAsOf', 'entryOrigin', 'valuationOrigin', 'navEstimate', 'shares', 'stockEstimate', 'costBasis', 'costBasisAsOf'];
const GOAL_KEYS = ['id', 'name', 'age', 'years', 'target', 'monthlyContribution', 'returnPct', 'inflationPct', 'assumptionsChecked', 'equityDropPct', 'affordableLoss', 'tolerableLoss', 'emergencyFunding', 'linkedIds', 'allocationPct', 'targetMix', 'confirmed'];

/** The same normalized portfolio shape accepted by the account API, without derived exposures. */
export function buildReviewBackup(state) {
  return {
    version: 2,
    holdings: state.holdings.map(holding => ({
      id: holding.id, name: holding.name, type: holding.type, asset: holding.asset, value: holding.value,
      asOf: holding.asOf || null, amc: holding.amc || null, isin: holding.isin || null, amfi: holding.amfi || null,
      granularity: holding.granularity || null, units: holding.units || null,
      ...(holding.entryOrigin ? { entryOrigin: holding.entryOrigin } : {}),
      ...(holding.valuationOrigin ? { valuationOrigin: holding.valuationOrigin } : {}),
      ...(holding.statementCategory ? { statementCategory: holding.statementCategory } : {}),
      ...(holding.expenseRatioPct !== undefined ? { expenseRatioPct: holding.expenseRatioPct,
        expenseRatioAsOf: holding.expenseRatioAsOf } : {}),
      ...(holding.navEstimate ? { navEstimate: { ...holding.navEstimate } } : {}),
      ...(holding.shares ? { shares: holding.shares } : {}),
      ...(holding.stockEstimate ? { stockEstimate: { ...holding.stockEstimate } } : {}),
      ...(holding.costBasis !== undefined ? { costBasis: holding.costBasis,
        costBasisAsOf: holding.costBasisAsOf } : {}),
    })),
    goals: state.goals.map(goal => ({ ...goal, linkedIds: [...goal.linkedIds],
      ...(goal.allocationPct ? { allocationPct: { ...goal.allocationPct } } : {}) })),
    activeGoalId: state.activeGoalId,
    ...(state.reserve ? { reserve: { ...state.reserve } } : {}),
    ...(state.coverage ? { coverage: { ...state.coverage } } : {}),
  };
}

/** Parse an explicitly selected local file; never trust its fields or retain unknown private data. */
export function parseReviewBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) {
    return invalid('Choose a review JSON file smaller than 2 MB.');
  }
  let document;
  try { document = JSON.parse(text); }
  catch { return invalid('The review file is not valid JSON.'); }
  if (!exactKeys(document, TOP_KEYS) || document.version !== 2 ||
      !Array.isArray(document.holdings) || document.holdings.length > 500 ||
      !Array.isArray(document.goals) || document.goals.length < 1 || document.goals.length > 10 ||
      !isUuid(document.activeGoalId) ||
      (document.reserve !== undefined && !validReserve(document.reserve)) ||
      (document.coverage !== undefined && !validCoverage(document.coverage))) {
    return invalid('This is not a supported TheFinxperts review file.');
  }

  const holdingIds = new Set();
  let total = 0;
  const holdings = [];
  for (const holding of document.holdings) {
    if (!exactKeys(holding, HOLDING_KEYS) || !isUuid(holding.id) || holdingIds.has(holding.id) ||
        !isName(holding.name, 200) || !TYPES.has(holding.type) || !ASSETS.has(holding.asset) ||
        !boundedNumber(holding.value, Number.MIN_VALUE, 10_000_000_000) ||
        (holding.asOf != null && !isRealIsoDate(holding.asOf)) ||
        (holding.entryOrigin !== undefined && !Object.hasOwn(ENTRY_ORIGINS, holding.entryOrigin)) ||
        (holding.valuationOrigin !== undefined && !['manual', 'broker_xlsx', 'broker_csv'].includes(holding.valuationOrigin)) ||
        (holding.amc != null && !isName(holding.amc, 200)) ||
        (holding.isin != null && (typeof holding.isin !== 'string' || !ISIN.test(holding.isin))) ||
        (holding.amfi != null && (typeof holding.amfi !== 'string' || !AMFI.test(holding.amfi))) ||
        (holding.units != null && (typeof holding.units !== 'string' ||
          !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(holding.units) || !/[1-9]/.test(holding.units) ||
          holding.type !== 'Mutual fund' || holding.granularity === 'fund_house')) ||
        (holding.statementCategory !== undefined &&
          (typeof holding.statementCategory !== 'string' ||
           !/^[A-Za-z][A-Za-z0-9 &/().,+-]{0,79}$/.test(holding.statementCategory) ||
           /\d{8,}/.test(holding.statementCategory) || holding.type !== 'Mutual fund' ||
           holding.granularity === 'fund_house')) ||
        (holding.expenseRatioPct !== undefined && (!boundedNumber(holding.expenseRatioPct, 0, 10) ||
          !isRealIsoDate(holding.expenseRatioAsOf) || holding.expenseRatioAsOf > indiaToday() ||
          holding.type !== 'Mutual fund' || holding.granularity === 'fund_house')) ||
        (holding.expenseRatioPct === undefined && holding.expenseRatioAsOf !== undefined) ||
        (holding.navEstimate !== undefined && !validNavEstimate(holding, indiaToday())) ||
        (holding.shares !== undefined && (holding.type !== 'Stock' || !validShares(holding.shares))) ||
        (holding.stockEstimate !== undefined && !validStockEstimate(holding, indiaToday())) ||
        ((holding.costBasis !== undefined || holding.costBasisAsOf !== undefined) &&
          (holding.granularity === 'fund_house' || !validCostBasis(holding.costBasis, holding.costBasisAsOf))) ||
        (holding.type === 'Stock' && (holding.asset !== 'Equity' || holding.amc || holding.amfi)) ||
        (holding.type === 'Other investment' && (!['manual', 'epfo_passbook', 'nps_statement'].includes(holding.entryOrigin) ||
          !['Other', 'Gold'].includes(holding.asset) ||
          (holding.entryOrigin === 'epfo_passbook' && (holding.asset !== 'Other' || !/^EPF account [A-F0-9]{12}$/.test(holding.name))) ||
          (holding.entryOrigin === 'nps_statement' && (holding.asset !== 'Other' || !/^NPS Tier I account [A-F0-9]{12}$/.test(holding.name))) ||
          (holding.asset === 'Gold' && !/\bgold\b/i.test(holding.name)) ||
          holding.amc || holding.amfi || holding.isin || holding.units || holding.statementCategory ||
          holding.expenseRatioPct !== undefined || holding.navEstimate || holding.shares ||
          holding.stockEstimate || holding.costBasis !== undefined || holding.valuationOrigin)) ||
        (holding.granularity != null && (holding.granularity !== 'fund_house' || holding.type !== 'Mutual fund' ||
          !holding.amc || holding.isin || holding.amfi))) {
      return invalid('A holding in the review file is invalid or contains unsupported fields.');
    }
    holdingIds.add(holding.id);
    total += holding.value;
    holdings.push({ ...holding, name: holding.name.trim(), amc: holding.amc?.trim() || null });
  }
  if (total > 1_000_000_000_000) return invalid('The combined portfolio value is too large.');
  if (document.coverage?.mutualFunds === 'none' && holdings.some(holding => holding.type === 'Mutual fund') ||
      document.coverage?.directStocks === 'none' && holdings.some(holding => holding.type === 'Stock') ||
      document.coverage?.otherInvestments === 'none' && holdings.some(holding => holding.type === 'Other investment')) {
    return invalid('The holdings conflict with the portfolio coverage answers.');
  }

  const goalIds = new Set();
  const assigned = new Map();
  const goals = [];
  for (const goal of document.goals) {
    const draft = goal?.confirmed === false;
    if (!exactKeys(goal, GOAL_KEYS) || !isUuid(goal.id) || goalIds.has(goal.id) || !isName(goal.name, 60) ||
        !(draft && goal.age === null || boundedNumber(goal.age, 18, 100, true)) ||
        !(draft && goal.years === null || boundedNumber(goal.years, 1, 50, true)) ||
        !(draft && goal.target === null || boundedNumber(goal.target, 1_000, 1_000_000_000_000)) ||
        !boundedNumber(goal.monthlyContribution, 0, 100_000_000) ||
        !boundedNumber(goal.returnPct, -20, 13) || !boundedNumber(goal.inflationPct, -5, 15) ||
        (goal.assumptionsChecked !== undefined && (!record(goal.assumptionsChecked) ||
          Object.keys(goal.assumptionsChecked).length !== 3 ||
          !['monthlyContribution', 'returnPct', 'inflationPct'].every(key =>
            typeof goal.assumptionsChecked[key] === 'boolean'))) ||
        (goal.equityDropPct !== undefined && !boundedNumber(goal.equityDropPct, 0, 60)) ||
        (goal.affordableLoss !== undefined && !boundedNumber(goal.affordableLoss, 0, 10_000_000_000)) ||
        (goal.tolerableLoss !== undefined && !boundedNumber(goal.tolerableLoss, 0, 10_000_000_000)) ||
        (goal.emergencyFunding !== undefined && !['separate', 'goal_holdings', 'unsure'].includes(goal.emergencyFunding)) ||
        (goal.confirmed !== undefined && typeof goal.confirmed !== 'boolean') ||
        (goal.targetMix !== undefined && !validMixPlan(goal.targetMix)) ||
        !Array.isArray(goal.linkedIds) || goal.linkedIds.length > 500 ||
        (goal.allocationPct !== undefined && (!record(goal.allocationPct) || Object.keys(goal.allocationPct).length > 500))) {
      return invalid('A goal in the review file is invalid or contains unsupported fields.');
    }
    const ownLinks = new Set();
    for (const id of goal.linkedIds) {
      if (!isUuid(id) || !holdingIds.has(id) || ownLinks.has(id)) {
        return invalid('Goal links are invalid or duplicated.');
      }
      ownLinks.add(id);
      const share = goal.allocationPct?.[id] ?? 100;
      if (!boundedNumber(share, 1, 100, true) || (assigned.get(id) || 0) + share > 100) {
        return invalid('Goal shares for a holding must total no more than 100%.');
      }
      assigned.set(id, (assigned.get(id) || 0) + share);
    }
    for (const [id, share] of Object.entries(goal.allocationPct || {})) {
      if (!ownLinks.has(id) || !boundedNumber(share, 1, 100, true)) {
        return invalid('Goal shares must name linked holdings and be whole percentages from 1 to 100.');
      }
    }
    goalIds.add(goal.id);
    goals.push({ ...goal, name: goal.name.trim(), linkedIds: [...goal.linkedIds],
      ...(goal.allocationPct ? { allocationPct: { ...goal.allocationPct } } : {}) });
  }
  if (!goalIds.has(document.activeGoalId)) return invalid('The selected goal is missing from the review file.');
  return { portfolio: { version: 2, holdings, goals, activeGoalId: document.activeGoalId,
    ...(document.reserve ? { reserve: { ...document.reserve } } : {}),
    ...(document.coverage ? { coverage: { ...document.coverage } } : {}) }, errors: [] };
}

function invalid(message) { return { portfolio: null, errors: [message] }; }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, allowed) { return record(value) && Object.keys(value).every(key => allowed.includes(key)); }
function isUuid(value) { return typeof value === 'string' && UUID.test(value); }
function isName(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }
function boundedNumber(value, min, max, integer = false) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}
function isRealIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function indiaToday() { return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10); }
