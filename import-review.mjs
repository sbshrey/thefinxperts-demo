/** Validate the editable holdings preview before it replaces the current portfolio. */
import { ENTRY_ORIGINS } from './entry-origin.mjs?v=cf5150899ee0';
import { validCostBasis } from './cost-basis.mjs?v=cf5150899ee0';

export function validateImportReview(holdings) {
  if (!Array.isArray(holdings) || holdings.length === 0) return ['Keep at least one holding to import.'];
  if (holdings.length > 500) return ['Import at most 500 holdings at a time.'];
  const errors = [];
  let total = 0;
  for (const [index, holding] of holdings.entries()) {
    const row = index + 1;
    const name = typeof holding.name === 'string' ? holding.name.trim() : '';
    const value = Number(holding.value);
    if (!name || name.length > 200) errors.push(`Holding ${row}: enter a name of up to 200 characters.`);
    if (!['Mutual fund', 'Stock'].includes(holding.type)) errors.push(`Holding ${row}: choose a valid holding type.`);
    if (!['Equity', 'Debt', 'Gold', 'Other'].includes(holding.asset) ||
        (holding.type === 'Stock' && holding.asset !== 'Equity')) errors.push(`Holding ${row}: check the asset category.`);
    if (!Number.isFinite(value) || value <= 0 || value > 10_000_000_000) {
      errors.push(`Holding ${row}: enter a positive value up to ₹10,00,00,00,000.`);
    } else total += value;
    if (holding.asOf && !isRealIsoDate(holding.asOf)) errors.push(`Holding ${row}: check the valuation date.`);
    if ((holding.costBasis !== undefined || holding.costBasisAsOf !== undefined) &&
        (holding.granularity === 'fund_house' || !validCostBasis(holding.costBasis, holding.costBasisAsOf)))
      errors.push(`Holding ${row}: check the invested amount and its source-check date.`);
    if (holding.entryOrigin !== undefined && !Object.hasOwn(ENTRY_ORIGINS, holding.entryOrigin))
      errors.push(`Holding ${row}: check the entry source.`);
    if (holding.amc != null && (typeof holding.amc !== 'string' || !holding.amc.trim() || holding.amc.length > 200))
      errors.push(`Holding ${row}: check the fund-house name.`);
    if (holding.isin != null && (typeof holding.isin !== 'string' || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(holding.isin)))
      errors.push(`Holding ${row}: check the ISIN.`);
    if (holding.amfi != null && (typeof holding.amfi !== 'string' || !/^\d{5,8}$/.test(holding.amfi)))
      errors.push(`Holding ${row}: check the AMFI code.`);
    if (holding.units != null && (typeof holding.units !== 'string' ||
        !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(holding.units) ||
        !/[1-9]/.test(holding.units) || holding.type !== 'Mutual fund' || holding.granularity === 'fund_house'))
      errors.push(`Holding ${row}: check the scheme units.`);
    if (holding.shares != null && (holding.type !== 'Stock' || typeof holding.shares !== 'string' ||
        !/^[1-9]\d{0,8}$/.test(holding.shares)))
      errors.push(`Holding ${row}: check the direct-stock share count.`);
    if (holding.statementCategory != null &&
        (typeof holding.statementCategory !== 'string' ||
         !/^[A-Za-z][A-Za-z0-9 &/().,+-]{0,79}$/.test(holding.statementCategory) ||
         /\d{8,}/.test(holding.statementCategory) || holding.type !== 'Mutual fund' ||
         holding.granularity === 'fund_house'))
      errors.push(`Holding ${row}: check the statement category.`);
    if (holding.type === 'Stock' && (holding.amc || holding.amfi)) errors.push(`Holding ${row}: stock rows cannot carry fund-house or AMFI fields.`);
    if (holding.granularity != null &&
        (holding.granularity !== 'fund_house' || holding.type !== 'Mutual fund' || !holding.amc || holding.isin || holding.amfi))
      errors.push(`Holding ${row}: check the fund-house summary label.`);
    if (errors.length >= 5) return errors.slice(0, 5);
  }
  if (total > 1_000_000_000_000) errors.push('The combined portfolio value is too large.');
  return errors.slice(0, 5);
}

/** Check a second source before adding it to an existing personal review. */
export function validateImportMerge(existing, incoming) {
  const errors = validateImportReview(incoming);
  if (errors.length) return errors;
  if (!Array.isArray(existing) || existing.length + incoming.length > 500)
    return ['A combined review can contain at most 500 holdings.'];
  const total = [...existing, ...incoming].reduce((sum, holding) => sum + Number(holding.value), 0);
  if (!Number.isFinite(total) || total > 1_000_000_000_000)
    return ['The combined portfolio value is too large.'];
  return findImportMergeConflicts(existing, incoming).slice(0, 5).map(item => item.message);
}

/** Potential overlap with the saved review; never assume two matching rows are the same account position. */
export function findImportMergeConflicts(existing, incoming) {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return [];
  const conflicts = [];
  for (const [index, added] of incoming.entries()) {
    let conflict = null;
    for (const current of existing) {
      if (added.isin && current.isin && added.isin === current.isin) {
        conflict = `Holding ${index + 1}: this ISIN already appears in your review. Check the two sources before adding it.`;
        break;
      }
      if (added.type === 'Mutual fund' && current.type === 'Mutual fund' &&
          added.amfi && current.amfi && added.amfi === current.amfi) {
        conflict = `Holding ${index + 1}: this AMFI scheme code already appears in your review. Check the two sources before adding it.`;
        break;
      }
      const sameName = typeof added.name === 'string' && typeof current.name === 'string' &&
        added.name.trim().toLocaleLowerCase('en-IN') === current.name.trim().toLocaleLowerCase('en-IN');
      if (sameName && added.type === current.type) {
        conflict = `Holding ${index + 1}: a holding with this name already appears in your review. Check for duplicate positions.`;
        break;
      }
      if (added.type === 'Mutual fund' && current.type === 'Mutual fund' &&
          (added.granularity === 'fund_house' || current.granularity === 'fund_house') &&
          (!added.amc || !current.amc || added.amc.trim().toLocaleLowerCase('en-IN') === current.amc.trim().toLocaleLowerCase('en-IN'))) {
        conflict = `Holding ${index + 1}: a fund-house summary could already include this fund. Add direct stocks separately or replace the review.`;
        break;
      }
    }
    if (conflict) conflicts.push({ index, message: conflict, holding: added });
  }
  return conflicts;
}

/** A manual row may be a separate account position, but an exact match needs investor confirmation. */
export function possibleManualDuplicate(existing, candidate) {
  if (!Array.isArray(existing) || !candidate || !['Mutual fund', 'Stock'].includes(candidate.type)) return null;
  return existing.find(current => current.type === candidate.type && (
    candidate.isin && current.isin && candidate.isin === current.isin ||
    candidate.type === 'Mutual fund' && candidate.amfi && current.amfi && candidate.amfi === current.amfi ||
    typeof candidate.name === 'string' && typeof current.name === 'string' &&
      candidate.name.trim().toLocaleLowerCase('en-IN') === current.name.trim().toLocaleLowerCase('en-IN'))) || null;
}

/** Update only unambiguous positions from a newer report of the same account. */
export function planBrokerReportRefresh(existing, incoming, origin) {
  if (!Array.isArray(existing) || !existing.length || !Array.isArray(incoming) ||
      validateImportReview(incoming).length || !['broker_xlsx', 'broker_csv'].includes(origin)) return null;
  const currentByIsin = new Map();
  for (const holding of existing) {
    if (!holding.isin) continue;
    if (currentByIsin.has(holding.isin)) currentByIsin.set(holding.isin, null);
    else currentByIsin.set(holding.isin, holding);
  }
  const incomingByIsin = new Map();
  for (const holding of incoming) {
    if (!holding.isin) continue;
    if (incomingByIsin.has(holding.isin)) incomingByIsin.set(holding.isin, null);
    else incomingByIsin.set(holding.isin, holding);
  }
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const matched = [];
  for (const [isin, next] of incomingByIsin) {
    if (!currentByIsin.has(isin)) continue;
    const current = currentByIsin.get(isin);
    if (!current || !next || current.type !== next.type || current.asset !== next.asset ||
        current.granularity || next.granularity || !isRealIsoDate(current.asOf) ||
        !isRealIsoDate(next.asOf) || next.asOf <= current.asOf || next.asOf > today) return null;
    matched.push({ current, next });
  }
  if (!matched.length) return null;
  const byId = new Map(matched.map(({ current, next }) => [current.id, next]));
  const holdings = existing.map(holding => {
    const next = byId.get(holding.id);
    if (!next) return holding;
    const { navEstimate: _navEstimate, stockEstimate: _stockEstimate,
      costBasis: _costBasis, costBasisAsOf: _costBasisAsOf,
      units: _units, shares: _shares, ...prior } = holding;
    return { ...prior, value: next.value, asOf: next.asOf, valuationOrigin: origin,
      ...(next.costBasis !== undefined ? { costBasis: next.costBasis,
        costBasisAsOf: next.costBasisAsOf } : {}) };
  });
  const total = holdings.reduce((sum, holding) => sum + Number(holding.value), 0);
  if (!Number.isFinite(total) || total > 1_000_000_000_000) return null;
  return { holdings, matched, skipped: incoming.length - matched.length };
}

/** Refresh only unique positions first entered from a demat CAS, never another source. */
export function planDematCasRefresh(existing, incoming) {
  if (!Array.isArray(existing) || !existing.length || !Array.isArray(incoming) ||
      !incoming.length || incoming.some(row => row.entryOrigin !== 'demat_cas')) return null;
  const byIsin = rows => {
    const map = new Map();
    for (const row of rows) {
      if (!row.isin) continue;
      map.set(row.isin, map.has(row.isin) ? null : row);
    }
    return map;
  };
  const currentByIsin = byIsin(existing);
  const incomingByIsin = byIsin(incoming);
  const shared = [...incomingByIsin.keys()].filter(isin => currentByIsin.has(isin));
  if (!shared.length) return null;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const clean = value => typeof value === 'string' ? value.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ') : '';
  const matched = [];
  for (const isin of shared) {
    const current = currentByIsin.get(isin), next = incomingByIsin.get(isin);
    const confirmedStock = current?.type === 'Stock' && current.asset === 'Equity' &&
      next?.type === 'Other' && next.asset === 'Other';
    const checkedNext = confirmedStock ? { ...next, type: 'Stock', asset: 'Equity' } : next;
    if (!current || !next || validateImportReview([checkedNext]).length ||
        current.entryOrigin !== 'demat_cas' || current.type !== checkedNext.type ||
        current.granularity || next.granularity || clean(current.name) !== clean(next.name) ||
        current.asset !== checkedNext.asset && checkedNext.asset !== 'Other' ||
        !isRealIsoDate(current.asOf) || !isRealIsoDate(next.asOf) ||
        current.asOf > today || next.asOf > today || next.asOf < current.asOf ||
        (current.type === 'Mutual fund' &&
          (typeof next.units !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(next.units) ||
           !/[1-9]/.test(next.units) || current.amfi && next.amfi && current.amfi !== next.amfi)) ||
        next.asOf === current.asOf && (next.value !== current.value ||
          current.type === 'Mutual fund' && next.units !== current.units)) return null;
    matched.push({ current, next: checkedNext });
  }
  const changed = matched.filter(({ current, next }) => next.asOf > current.asOf);
  if (!changed.length) return { holdings: existing, matched, changed, skipped: incoming.length - matched.length,
    repeated: true };
  const replacements = new Map(changed.map(({ current, next }) => [current.id, next]));
  const holdings = existing.map(row => {
    const next = replacements.get(row.id);
    if (!next) return row;
    const { navEstimate: _navEstimate, stockEstimate: _stockEstimate,
      costBasis: _costBasis, costBasisAsOf: _costBasisAsOf,
      valuationOrigin: _valuationOrigin, shares: _shares, ...prior } = row;
    return { ...prior, value: next.value, asOf: next.asOf,
      ...(row.type === 'Mutual fund' ? { units: next.units } : {}) };
  });
  if (holdings.reduce((sum, row) => sum + Number(row.value), 0) > 1_000_000_000_000) return null;
  return { holdings, matched, changed, skipped: incoming.length - matched.length, repeated: false };
}

/** Recognize the same complete Active Statement fund snapshot without changing saved goal links. */
export function isRepeatedActiveStatement(existing, incoming) {
  if (!Array.isArray(existing) || !Array.isArray(incoming) || !incoming.length ||
      validateImportReview(incoming).length || incoming.some(holding => holding.type !== 'Mutual fund')) return false;
  const funds = existing.filter(holding => holding.type === 'Mutual fund');
  if (!funds.length || funds.length !== incoming.length) return false;
  const summaries = funds.every(holding => holding.granularity === 'fund_house') &&
    incoming.every(holding => holding.granularity === 'fund_house');
  const schemes = funds.every(holding => holding.granularity !== 'fund_house' &&
    holding.statementCategory && holding.units) && incoming.every(holding =>
    holding.granularity !== 'fund_house' && holding.statementCategory && holding.units);
  if (!summaries && !schemes) return false;
  const date = incoming[0].asOf;
  if (!isRealIsoDate(date) || incoming.some(holding => holding.asOf !== date)) return false;
  const currentByKey = new Map(funds.map(holding => [activeStatementKey(holding), holding]));
  const incomingByKey = new Map(incoming.map(holding => [activeStatementKey(holding), holding]));
  if (currentByKey.size !== funds.length || incomingByKey.size !== incoming.length) return false;
  return incoming.every(holding => {
    const current = currentByKey.get(activeStatementKey(holding));
    return current && isRealIsoDate(holding.asOf) && current.asOf === holding.asOf &&
      sourceAssetCompatible(current, holding) && sourceIdentifiersCompatible(current, holding) &&
      Number(current.value) === Number(holding.value) &&
      (current.units || null) === (holding.units || null) &&
      (current.statementCategory || null) === (holding.statementCategory || null);
  });
}

/** Plan one complete newer Active Statement snapshot, preserving identities for matched fund rows. */
export function planActiveStatementRefresh(existing, incoming) {
  if (!Array.isArray(existing) || !Array.isArray(incoming) || validateImportReview(incoming).length ||
      !incoming.length || incoming.some(holding => holding.type !== 'Mutual fund')) return null;
  const funds = existing.filter(holding => holding.type === 'Mutual fund');
  if (!funds.length || existing.length - funds.length + incoming.length > 500 ||
      funds.some(holding => holding.granularity !== 'fund_house' &&
        !(holding.statementCategory && holding.units)) ||
      incoming.some(holding => holding.granularity !== 'fund_house' &&
        !(holding.statementCategory && holding.units))) return null;
  const summary = funds.every(holding => holding.granularity === 'fund_house') &&
    incoming.every(holding => holding.granularity === 'fund_house');
  const schemes = funds.every(holding => holding.granularity !== 'fund_house') &&
    incoming.every(holding => holding.granularity !== 'fund_house');
  if (!summary && !schemes) return null;
  const currentByKey = new Map(funds.map(holding => [activeStatementKey(holding), holding]));
  const incomingByKey = new Map(incoming.map(holding => [activeStatementKey(holding), holding]));
  if (currentByKey.size !== funds.length || incomingByKey.size !== incoming.length) return null;
  const sharedKeys = [...incomingByKey.keys()].filter(item => currentByKey.has(item));
  if (!sharedKeys.length) return null;
  if (sharedKeys.some(key => !sourceAssetCompatible(currentByKey.get(key), incomingByKey.get(key)) ||
      !sourceIdentifiersCompatible(currentByKey.get(key), incomingByKey.get(key)))) return null;
  const date = incoming[0].asOf;
  const indiaToday = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (!isRealIsoDate(date) || incoming.some(holding => holding.asOf !== date) ||
      date > indiaToday || funds.some(holding => {
        const sourceDate = holding.navEstimate?.originalAsOf || holding.asOf;
        return !isRealIsoDate(sourceDate) || sourceDate >= date;
      })) return null;
  const retained = existing.flatMap(holding => {
    if (holding.type !== 'Mutual fund') return holding;
    const next = incomingByKey.get(activeStatementKey(holding));
    if (!next) return [];
    const { navEstimate: _previousEstimate, valuationOrigin: _previousValuationOrigin,
      costBasis: _costBasis, costBasisAsOf: _costBasisAsOf, ...prior } = holding;
    return [{ ...prior, value: next.value, asOf: next.asOf,
      ...(next.units ? { units: next.units } : {}),
      ...(next.statementCategory ? { statementCategory: next.statementCategory } : {}) }];
  });
  const added = incoming.filter(holding => !currentByKey.has(activeStatementKey(holding)));
  const removed = funds.filter(holding => !incomingByKey.has(activeStatementKey(holding)));
  const total = [...retained, ...added].reduce((sum, holding) => sum + Number(holding.value), 0);
  if (!Number.isFinite(total) || total > 1_000_000_000_000)
    return null;
  return { holdings: retained, added, removed, updatedCount: sharedKeys.length };
}

function activeStatementKey(holding) {
  const granularity = holding.granularity || 'scheme';
  return JSON.stringify([holding.amc?.trim().toLocaleLowerCase('en-IN'),
    holding.name?.trim().toLocaleLowerCase('en-IN'), granularity,
    granularity === 'fund_house' ? holding.asset : null]);
}

function sourceAssetCompatible(current, incoming) {
  if (current.granularity === 'fund_house') return current.asset === incoming.asset;
  // A corrected Debt/Gold label may still come back as CAMS non-equity (Other).
  if (incoming.asset === 'Other') return ['Debt', 'Gold', 'Other'].includes(current.asset);
  return incoming.asset === 'Equity' && current.asset === 'Equity';
}

function sourceIdentifiersCompatible(current, incoming) {
  return (!current.isin || !incoming.isin || current.isin === incoming.isin) &&
    (!current.amfi || !incoming.amfi || current.amfi === incoming.amfi);
}

function isRealIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
