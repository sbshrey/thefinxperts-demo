import { validShares } from './stock-estimate.mjs?v=7c573a59f999';
import { validCostBasis } from './cost-basis.mjs?v=7c573a59f999';

const ASSETS = new Set(['Equity', 'Debt', 'Gold', 'Other']);
const SOURCES = new Set(['manual', 'active_statement', 'broker_csv', 'broker_xlsx', 'simple_csv', 'cas', 'demat_cas', 'epfo_passbook']);

function realDate(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value &&
    value <= new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function basePortfolio(newId) {
  const goalId = newId();
  return { version: 2, holdings: [], goals: [{ id: goalId, name: 'My goal', age: null, years: null,
    target: null, monthlyContribution: 0, returnPct: 0, inflationPct: 0,
    assumptionsChecked: { monthlyContribution: false, returnPct: false, inflationPct: false },
    confirmed: false, linkedIds: [] }], activeGoalId: goalId };
}

export function asVersionTwo(saved, newId) {
  if (!saved) return basePortfolio(newId);
  if (saved.version === 2 && Array.isArray(saved.holdings) && Array.isArray(saved.goals))
    return structuredClone(saved);
  if (saved.version !== 1 || !Array.isArray(saved.holdings) || !saved.goal) return null;
  const holdings = saved.holdings.map(row => ({ ...row, id: row.id || newId() }));
  const goalId = newId();
  return { version: 2, holdings, goals: [{ ...saved.goal, id: goalId,
    linkedIds: saved.goal.linkedIds || holdings.map(row => row.id) }], activeGoalId: goalId };
}

function key(row) {
  return `${row.type}|${row.name.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ')}`;
}

function fundHouseKey(value) {
  if (typeof value !== 'string') return '';
  return value.toLocaleLowerCase('en-IN').replace(/\b(?:asset management company|funds management|mutual fund|amc|mf|limited|ltd|private|pvt|co)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** A matching name or ISIN may be the same position in another report. Never sum it silently. */
export function findAssistantOverlap(existing, draft, { allowComplementarySummary = false } = {}) {
  if (!Array.isArray(existing) || !draft || typeof draft.name !== 'string' ||
      !['Mutual fund', 'Stock', 'Other investment'].includes(draft.type)) return null;
  const isin = typeof draft.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(draft.isin) ? draft.isin : null;
  for (const row of existing) {
    if (!row || typeof row.name !== 'string') continue;
    if (row.type === draft.type && key(row) === key(draft)) return { existingName: row.name, reason: 'name' };
    if (isin && row.isin === isin) return { existingName: row.name, reason: 'ISIN' };
    if (row.type === 'Mutual fund' && draft.type === 'Mutual fund') {
      if (draft.amfi && row.amfi && draft.amfi === row.amfi)
        return { existingName: row.name, reason: 'AMFI code' };
      // A CAMS fund-house total may be split into disjoint Equity and Other portions.
      if (allowComplementarySummary && row.granularity === 'fund_house' && draft.granularity === 'fund_house' &&
          row.asset !== draft.asset) continue;
      const existingHouse = fundHouseKey(row.amc);
      const draftHouse = fundHouseKey(draft.amc);
      if ((row.granularity === 'fund_house' || draft.granularity === 'fund_house') &&
          (!existingHouse || !draftHouse || existingHouse === draftHouse ||
            existingHouse.split(' ')[0] === draftHouse.split(' ')[0]))
        return { existingName: row.name, reason: 'fund-house summary' };
    }
  }
  return null;
}

/** Preview saved-position matches without deciding whether they are truly duplicates. */
export function findSavedDraftOverlaps(existing, drafts) {
  if (!Array.isArray(drafts)) return [];
  return drafts.flatMap((draft, index) => {
    const match = findAssistantOverlap(existing, draft);
    return match ? [{ index, draft, ...match }] : [];
  });
}

/** Prepare an append-only account save. Existing goals and holding rows stay unchanged. */
export function prepareAssistantSave(saved, drafts, { newId = () => crypto.randomUUID(), maxDrafts = 30 } = {}) {
  const portfolio = asVersionTwo(saved, newId);
  if (!portfolio) return { portfolio: null, errors: ['This saved review format needs an account check.'] };
  if (!Array.isArray(drafts) || !drafts.length || drafts.length > maxDrafts) {
    return { portfolio: null, errors: [`Confirm one to ${maxDrafts} holdings at a time.`] };
  }
  const added = [];
  for (const row of drafts) {
    if (!row || typeof row.name !== 'string' || row.name.trim().length < 2 || row.name.trim().length > 80 ||
        !['Mutual fund', 'Stock', 'Other investment'].includes(row.type) || !ASSETS.has(row.asset) ||
        (row.type === 'Stock' && row.asset !== 'Equity') ||
        (row.type === 'Other investment' && (!['manual', 'epfo_passbook'].includes(row.entryOrigin) ||
          !['Other', 'Gold'].includes(row.asset) ||
          (row.entryOrigin === 'epfo_passbook' && (row.asset !== 'Other' || !/^EPF account [A-F0-9]{12}$/.test(row.name))) ||
          (row.asset === 'Gold' && !/\bgold\b/i.test(row.name)) ||
          row.isin || row.amc || row.amfi || row.units || row.statementCategory || row.granularity)) ||
        !Number.isFinite(row.value) || row.value <= 0 || row.value > 10_000_000_000 ||
        !realDate(row.asOf) || !SOURCES.has(row.entryOrigin) ||
        (row.isin && (typeof row.isin !== 'string' || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isin))) ||
        (row.amc && (typeof row.amc !== 'string' || !row.amc.trim() || row.amc.length > 200)) ||
        (row.amfi && (typeof row.amfi !== 'string' || !/^\d{5,8}$/.test(row.amfi))) ||
        (row.units && (typeof row.units !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(row.units) || !/[1-9]/.test(row.units))) ||
        (row.shares !== undefined && (row.type !== 'Stock' || !validShares(row.shares))) ||
        ((row.costBasis !== undefined || row.costBasisAsOf !== undefined) &&
          (!['broker_csv', 'broker_xlsx'].includes(row.entryOrigin) ||
            !validCostBasis(row.costBasis, row.costBasisAsOf) || row.costBasisAsOf !== row.asOf)) ||
        (row.granularity !== undefined && (row.granularity !== 'fund_house' || row.type !== 'Mutual fund' ||
          !row.amc || row.isin || row.amfi || row.units || row.statementCategory)) ||
        (row.statementCategory && (typeof row.statementCategory !== 'string' ||
          !/^[A-Za-z][A-Za-z0-9 &/().,+-]{0,79}$/.test(row.statementCategory) || /\d{8,}/.test(row.statementCategory))) ||
        (row.type === 'Stock' && (row.amc || row.amfi || row.units || row.statementCategory))) {
      return { portfolio: null, errors: ['A draft needs a supported investment type, positive value, asset category and valid date.'] };
    }
    const overlap = findAssistantOverlap(portfolio.holdings, row) ||
      findAssistantOverlap(added, row, { allowComplementarySummary: true });
    if (overlap) {
      return { portfolio: null, errors: [`${row.name.trim()} may already be counted as ${overlap.existingName} (${overlap.reason} match). Check the source before adding both. Reply “skip ${row.name.trim()}” to leave this draft out.`] };
    }
    added.push({ id: newId(), name: row.name.trim(), type: row.type, asset: row.asset,
      value: row.value, asOf: row.asOf, entryOrigin: row.entryOrigin,
      ...(row.isin ? { isin: row.isin } : {}), ...(row.amc ? { amc: row.amc.trim() } : {}),
      ...(row.amfi ? { amfi: row.amfi } : {}), ...(row.units ? { units: row.units } : {}),
      ...(row.shares ? { shares: row.shares } : {}),
      ...(row.costBasis !== undefined ? { costBasis: row.costBasis,
        costBasisAsOf: row.costBasisAsOf } : {}),
      ...(row.granularity === 'fund_house' ? { granularity: 'fund_house' } : {}),
      ...(row.statementCategory ? { statementCategory: row.statementCategory } : {}) });
  }
  if (portfolio.holdings.length + added.length > 500 ||
      portfolio.holdings.reduce((sum, row) => sum + row.value, 0) +
        added.reduce((sum, row) => sum + row.value, 0) > 1_000_000_000_000) {
    return { portfolio: null, errors: ['This account has reached its holding count or value limit.'] };
  }
  if (portfolio.coverage?.mutualFunds === 'none' && added.some(row => row.type === 'Mutual fund') ||
      portfolio.coverage?.directStocks === 'none' && added.some(row => row.type === 'Stock') ||
      portfolio.coverage?.otherInvestments === 'none' && added.some(row => row.type === 'Other investment')) {
    return { portfolio: null, errors: ['The saved coverage answer says this asset type is absent. Check that answer before saving new holdings.'] };
  }
  portfolio.holdings.push(...added);
  if (portfolio.coverage?.mutualFunds === 'all' && added.some(row => row.type === 'Mutual fund'))
    portfolio.coverage.mutualFunds = 'unsure';
  if (portfolio.coverage?.directStocks === 'all' && added.some(row => row.type === 'Stock'))
    portfolio.coverage.directStocks = 'unsure';
  if (portfolio.coverage?.otherInvestments === 'all' && added.some(row => row.type === 'Other investment'))
    portfolio.coverage.otherInvestments = 'unsure';
  return { portfolio, addedCount: added.length, errors: [] };
}
