const ASSETS = new Set(['Equity', 'Debt', 'Gold', 'Other']);
const SOURCES = new Set(['manual', 'active_statement', 'broker_csv', 'broker_xlsx', 'simple_csv', 'cas', 'demat_cas']);

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

/** A matching name or ISIN may be the same position in another report. Never sum it silently. */
export function findAssistantOverlap(existing, draft) {
  if (!Array.isArray(existing) || !draft || typeof draft.name !== 'string' ||
      !['Mutual fund', 'Stock'].includes(draft.type)) return null;
  const isin = typeof draft.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(draft.isin) ? draft.isin : null;
  for (const row of existing) {
    if (!row || typeof row.name !== 'string') continue;
    if (row.type === draft.type && key(row) === key(draft)) return { existingName: row.name, reason: 'name' };
    if (isin && row.isin === isin) return { existingName: row.name, reason: 'ISIN' };
  }
  return null;
}

/** Prepare an append-only account save. Existing goals and holding rows stay unchanged. */
export function prepareAssistantSave(saved, drafts, { newId = () => crypto.randomUUID() } = {}) {
  const portfolio = asVersionTwo(saved, newId);
  if (!portfolio) return { portfolio: null, errors: ['This saved review format needs an account check.'] };
  if (!Array.isArray(drafts) || !drafts.length || drafts.length > 30) {
    return { portfolio: null, errors: ['Confirm one to thirty holdings at a time.'] };
  }
  if (portfolio.holdings.some(row => row.type === 'Mutual fund' && row.granularity === 'fund_house') &&
      drafts.some(row => row.type === 'Mutual fund')) {
    return { portfolio: null, errors: ['This account has fund-house totals that may already include these schemes. Review that overlap before saving individual funds.'] };
  }
  const added = [];
  for (const row of drafts) {
    if (!row || typeof row.name !== 'string' || row.name.trim().length < 2 || row.name.trim().length > 80 ||
        !['Mutual fund', 'Stock'].includes(row.type) || !ASSETS.has(row.asset) ||
        (row.type === 'Stock' && row.asset !== 'Equity') ||
        !Number.isFinite(row.value) || row.value <= 0 || row.value > 10_000_000_000 ||
        !realDate(row.asOf) || !SOURCES.has(row.entryOrigin) ||
        (row.isin && (typeof row.isin !== 'string' || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isin))) ||
        (row.amc && (typeof row.amc !== 'string' || !row.amc.trim() || row.amc.length > 200)) ||
        (row.amfi && (typeof row.amfi !== 'string' || !/^\d{5,8}$/.test(row.amfi))) ||
        (row.units && (typeof row.units !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(row.units) || !/[1-9]/.test(row.units))) ||
        (row.granularity !== undefined && (row.granularity !== 'fund_house' || row.type !== 'Mutual fund' ||
          !row.amc || row.isin || row.amfi || row.units || row.statementCategory)) ||
        (row.statementCategory && (typeof row.statementCategory !== 'string' ||
          !/^[A-Za-z][A-Za-z0-9 &/().,+-]{0,79}$/.test(row.statementCategory) || /\d{8,}/.test(row.statementCategory))) ||
        (row.type === 'Stock' && (row.amc || row.amfi || row.units || row.statementCategory))) {
      return { portfolio: null, errors: ['A draft needs a fund or stock type, positive value, asset category and valid date.'] };
    }
    const overlap = findAssistantOverlap([...portfolio.holdings, ...added], row);
    if (overlap) {
      return { portfolio: null, errors: [`${row.name.trim()} may already be counted as ${overlap.existingName} (${overlap.reason} match). Check the source before adding both. Reply “skip ${row.name.trim()}” to leave this draft out.`] };
    }
    added.push({ id: newId(), name: row.name.trim(), type: row.type, asset: row.asset,
      value: row.value, asOf: row.asOf, entryOrigin: row.entryOrigin,
      ...(row.isin ? { isin: row.isin } : {}), ...(row.amc ? { amc: row.amc.trim() } : {}),
      ...(row.amfi ? { amfi: row.amfi } : {}), ...(row.units ? { units: row.units } : {}),
      ...(row.granularity === 'fund_house' ? { granularity: 'fund_house' } : {}),
      ...(row.statementCategory ? { statementCategory: row.statementCategory } : {}) });
  }
  if (portfolio.holdings.length + added.length > 500 ||
      portfolio.holdings.reduce((sum, row) => sum + row.value, 0) +
        added.reduce((sum, row) => sum + row.value, 0) > 1_000_000_000_000) {
    return { portfolio: null, errors: ['This account has reached its holding count or value limit.'] };
  }
  if (portfolio.coverage?.mutualFunds === 'none' && added.some(row => row.type === 'Mutual fund') ||
      portfolio.coverage?.directStocks === 'none' && added.some(row => row.type === 'Stock')) {
    return { portfolio: null, errors: ['The saved coverage answer says this asset type is absent. Check that answer before saving new holdings.'] };
  }
  portfolio.holdings.push(...added);
  return { portfolio, addedCount: added.length, errors: [] };
}
