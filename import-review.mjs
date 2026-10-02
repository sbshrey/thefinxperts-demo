/** Validate the editable holdings preview before it replaces the current portfolio. */
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
  for (const [index, added] of incoming.entries()) {
    for (const current of existing) {
      if (added.isin && current.isin && added.isin === current.isin)
        return [`Holding ${index + 1}: this ISIN already appears in your review. Check the two sources before adding it.`];
      if (added.type === 'Mutual fund' && current.type === 'Mutual fund' &&
          added.amfi && current.amfi && added.amfi === current.amfi)
        return [`Holding ${index + 1}: this AMFI scheme code already appears in your review. Check the two sources before adding it.`];
      const sameName = typeof added.name === 'string' && typeof current.name === 'string' &&
        added.name.trim().toLocaleLowerCase('en-IN') === current.name.trim().toLocaleLowerCase('en-IN');
      if (sameName && added.type === current.type)
        return [`Holding ${index + 1}: a holding with this name already appears in your review. Check for duplicate positions.`];
      if (added.type === 'Mutual fund' && current.type === 'Mutual fund' &&
          (added.granularity === 'fund_house' || current.granularity === 'fund_house') &&
          (!added.amc || !current.amc || added.amc.trim().toLocaleLowerCase('en-IN') === current.amc.trim().toLocaleLowerCase('en-IN')))
        return [`Holding ${index + 1}: a fund-house summary could already include this fund. Add direct stocks separately or replace the review.`];
    }
  }
  return [];
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
  const key = holding => JSON.stringify([holding.amc?.trim().toLocaleLowerCase('en-IN'),
    holding.name?.trim().toLocaleLowerCase('en-IN'), holding.asset,
    holding.granularity || 'scheme']);
  const currentByKey = new Map(funds.map(holding => [key(holding), holding]));
  const incomingByKey = new Map(incoming.map(holding => [key(holding), holding]));
  if (currentByKey.size !== funds.length || incomingByKey.size !== incoming.length) return null;
  const sharedKeys = [...incomingByKey.keys()].filter(item => currentByKey.has(item));
  if (!sharedKeys.length) return null;
  const date = incoming[0].asOf;
  const indiaToday = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (!isRealIsoDate(date) || incoming.some(holding => holding.asOf !== date) ||
      date > indiaToday || funds.some(holding => !isRealIsoDate(holding.asOf) || holding.asOf >= date)) return null;
  const retained = existing.flatMap(holding => {
    if (holding.type !== 'Mutual fund') return holding;
    const next = incomingByKey.get(key(holding));
    if (!next) return [];
    return [{ ...holding, value: next.value, asOf: next.asOf,
      ...(next.units ? { units: next.units } : {}),
      ...(next.statementCategory ? { statementCategory: next.statementCategory } : {}) }];
  });
  const added = incoming.filter(holding => !currentByKey.has(key(holding)));
  const removed = funds.filter(holding => !incomingByKey.has(key(holding)));
  const total = [...retained, ...added].reduce((sum, holding) => sum + Number(holding.value), 0);
  if (!Number.isFinite(total) || total > 1_000_000_000_000)
    return null;
  return { holdings: retained, added, removed, updatedCount: sharedKeys.length };
}

function isRealIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
