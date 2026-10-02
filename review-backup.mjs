import { validMixPlan } from './mix-plan.mjs';
const MAX_BYTES = 2_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISIN = /^[A-Z]{2}[A-Z0-9]{10}$/;
const AMFI = /^\d{5,8}$/;
const TYPES = new Set(['Mutual fund', 'Stock']);
const ASSETS = new Set(['Equity', 'Debt', 'Gold', 'Other']);
const TOP_KEYS = ['version', 'holdings', 'goals', 'activeGoalId'];
const HOLDING_KEYS = ['id', 'name', 'type', 'asset', 'value', 'asOf', 'amc', 'isin', 'amfi', 'granularity', 'units'];
const GOAL_KEYS = ['id', 'name', 'age', 'years', 'target', 'monthlyContribution', 'returnPct', 'inflationPct', 'equityDropPct', 'affordableLoss', 'tolerableLoss', 'emergencyFunding', 'linkedIds', 'allocationPct', 'targetMix', 'confirmed'];

/** The same normalized portfolio shape accepted by the account API, without derived exposures. */
export function buildReviewBackup(state) {
  return {
    version: 2,
    holdings: state.holdings.map(holding => ({
      id: holding.id, name: holding.name, type: holding.type, asset: holding.asset, value: holding.value,
      asOf: holding.asOf || null, amc: holding.amc || null, isin: holding.isin || null, amfi: holding.amfi || null,
      granularity: holding.granularity || null, units: holding.units || null,
    })),
    goals: state.goals.map(goal => ({ ...goal, linkedIds: [...goal.linkedIds],
      ...(goal.allocationPct ? { allocationPct: { ...goal.allocationPct } } : {}) })),
    activeGoalId: state.activeGoalId,
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
      !isUuid(document.activeGoalId)) return invalid('This is not a supported TheFinxperts review file.');

  const holdingIds = new Set();
  let total = 0;
  const holdings = [];
  for (const holding of document.holdings) {
    if (!exactKeys(holding, HOLDING_KEYS) || !isUuid(holding.id) || holdingIds.has(holding.id) ||
        !isName(holding.name, 200) || !TYPES.has(holding.type) || !ASSETS.has(holding.asset) ||
        !boundedNumber(holding.value, Number.MIN_VALUE, 10_000_000_000) ||
        (holding.asOf != null && !isRealIsoDate(holding.asOf)) ||
        (holding.amc != null && !isName(holding.amc, 200)) ||
        (holding.isin != null && (typeof holding.isin !== 'string' || !ISIN.test(holding.isin))) ||
        (holding.amfi != null && (typeof holding.amfi !== 'string' || !AMFI.test(holding.amfi))) ||
        (holding.units != null && (typeof holding.units !== 'string' ||
          !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(holding.units) || !/[1-9]/.test(holding.units) ||
          holding.type !== 'Mutual fund' || holding.granularity === 'fund_house')) ||
        (holding.type === 'Stock' && (holding.asset !== 'Equity' || holding.amc || holding.amfi)) ||
        (holding.granularity != null && (holding.granularity !== 'fund_house' || holding.type !== 'Mutual fund' ||
          !holding.amc || holding.isin || holding.amfi))) {
      return invalid('A holding in the review file is invalid or contains unsupported fields.');
    }
    holdingIds.add(holding.id);
    total += holding.value;
    holdings.push({ ...holding, name: holding.name.trim(), amc: holding.amc?.trim() || null });
  }
  if (total > 1_000_000_000_000) return invalid('The combined portfolio value is too large.');

  const goalIds = new Set();
  const assigned = new Map();
  const goals = [];
  for (const goal of document.goals) {
    if (!exactKeys(goal, GOAL_KEYS) || !isUuid(goal.id) || goalIds.has(goal.id) || !isName(goal.name, 60) ||
        !boundedNumber(goal.age, 18, 100, true) || !boundedNumber(goal.years, 1, 50, true) ||
        !boundedNumber(goal.target, 1_000, 1_000_000_000_000) ||
        !boundedNumber(goal.monthlyContribution, 0, 100_000_000) ||
        !boundedNumber(goal.returnPct, -20, 13) || !boundedNumber(goal.inflationPct, -5, 15) ||
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
  return { portfolio: { version: 2, holdings, goals, activeGoalId: document.activeGoalId }, errors: [] };
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
