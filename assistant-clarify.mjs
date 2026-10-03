const amountWords = { k: 1_000, thousand: 1_000, lakh: 100_000, lakhs: 100_000,
  lac: 100_000, lacs: 100_000, crore: 10_000_000, crores: 10_000_000 };

function focus(drafts) {
  const index = drafts.findIndex(row => row.type === 'Other');
  if (index >= 0) return { index, field: 'type' };
  const value = drafts.findIndex(row => !Number.isFinite(row.value) || row.value <= 0);
  if (value >= 0) return { index: value, field: 'value' };
  const stock = drafts.findIndex(row => row.type === 'Stock' && row.asset !== 'Equity');
  if (stock >= 0) return { index: stock, field: 'asset' };
  const fund = drafts.findIndex(row => row.type === 'Mutual fund' && row.asset === 'Other' &&
    row.granularity !== 'fund_house' && !row.assetChecked);
  if (fund >= 0) return { index: fund, field: 'asset' };
  const date = drafts.findIndex(row => !row.asOf);
  return date >= 0 ? { index: date, field: 'asOf' } : null;
}

export function nextDraftQuestion(drafts) {
  const pending = focus(drafts);
  if (!pending) return null;
  const name = drafts[pending.index].name;
  const unknownTypes = drafts.filter(row => row.type === 'Other').length;
  const unknownFunds = drafts.filter(row => row.type === 'Mutual fund' &&
    row.granularity !== 'fund_house' && row.asset === 'Other' && !row.assetChecked).length;
  const missingDates = drafts.filter(row => !row.asOf).length;
  if (pending.field === 'type' && unknownTypes > 1)
    return `${unknownTypes} rows need a holding type. Check each security in the report, then say “classify drafts 1-3 as Stock” for ordinary company shares or “classify drafts 4, 5 as Mutual fund” for fund units. Leave ETFs or other instruments unconfirmed until you check their type.`;
  if (pending.field === 'asset' && unknownFunds > 1)
    return `${unknownFunds} fund categories are unknown. Check each individual scheme source, then say “classify drafts 1-3 as Equity” or “classify drafts 1, 4 as Debt” using the numbered rows. You can leave any category unknown and still confirm.`;
  if (pending.field === 'asOf' && missingDates > 1)
    return `${missingDates} rows need a value date. If the same valuation date is printed for those rows, say “date drafts 1-3 as YYYY-MM-DD” using the checked report date. Otherwise date each group separately, or confirm without dates and keep the limitation visible.`;
  return {
    type: `Is “${name}” a mutual fund or a directly held stock?`,
    value: `What is the current value in rupees of “${name}”? Reply with an amount such as ₹50,000.`,
    asset: drafts[pending.index].type === 'Stock' ?
      `A directly held stock is equity. Please confirm “${name}” is a stock.` :
      `Optional: is “${name}” an Equity, Debt or Gold fund? Reply with one category, or “mixed/unknown” and I will keep its category unknown. You can also confirm it as unknown.`,
    asOf: `Optional: what date was the value of “${name}” checked? Reply YYYY-MM-DD, or confirm without a date.`,
  }[pending.field];
}

function selectedDraftNumbers(drafts, expression) {
  const help = 'Use numbered rows, for example “1-3” or “1, 4”, after checking each row in the source.';
  const numbers = new Set();
  for (const part of expression.split(',')) {
    const item = /^(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/.exec(part.trim());
    if (!item) return { error: help };
    const start = Number(item[1]);
    const end = item[2] ? Number(item[2]) : start;
    if (start < 1 || end < start || end > drafts.length || end - start > 199)
      return { error: 'One or more draft numbers are outside the current list. Check the numbered rows and try again.' };
    for (let number = start; number <= end; number++) numbers.add(number);
  }
  return numbers.size ? { numbers: [...numbers].sort((a, b) => a - b) } : { error: help };
}

/** Label only explicitly numbered drafts after source checking. */
export function classifyDraftsByNumbers(drafts, message) {
  if (!Array.isArray(drafts) || !drafts.length || typeof message !== 'string') return null;
  if (!/^classify drafts?\b/i.test(message.trim())) return null;
  const match = /^classify drafts?\s+([\d,\s-]+)\s+as\s+(equity|debt|gold|other|unknown|stock|mutual fund)[.!]?$/i.exec(message.trim());
  const help = 'Use numbered rows, for example “classify drafts 1-3 as Stock” or “classify drafts 1, 4 as Debt”, after checking each row in its source.';
  if (!match) return { error: help };
  const selection = selectedDraftNumbers(drafts, match[1]);
  if (selection.error) return selection;
  const selected = selection.numbers;
  const label = match[2].toLowerCase();
  if (label === 'stock' || label === 'mutual fund') {
    if (selected.some(number => drafts[number - 1].type !== 'Other'))
      return { error: 'Only rows with an unknown holding type can be classified in this batch. No draft was changed.' };
    const type = label === 'stock' ? 'Stock' : 'Mutual fund';
    const revised = drafts.map((row, index) => selected.includes(index + 1) ?
      { ...row, type, asset: type === 'Stock' ? 'Equity' : 'Other' } : row);
    return { drafts: revised, numbers: selected, type, nextQuestion: nextDraftQuestion(revised) };
  }
  if (selected.some(number => drafts[number - 1].type !== 'Mutual fund' ||
      drafts[number - 1].granularity === 'fund_house'))
    return { error: 'Only individual mutual-fund schemes can be classified in this batch. No draft was changed.' };
  const asset = label === 'unknown' ? 'Other' :
    match[2][0].toUpperCase() + match[2].slice(1).toLowerCase();
  const selectedSet = new Set(selected);
  const revised = drafts.map((row, index) => selectedSet.has(index + 1) ?
    { ...row, asset, assetChecked: true } : row);
  return { drafts: revised, numbers: selected, asset, nextQuestion: nextDraftQuestion(revised) };
}

/** Add a shared report date only to selected rows whose date is still missing. */
export function dateDraftsByNumbers(drafts, message, today = new Date()) {
  if (!Array.isArray(drafts) || !drafts.length || typeof message !== 'string') return null;
  if (!/^date drafts?\b/i.test(message.trim())) return null;
  const match = /^date drafts?\s+([\d,\s-]+)\s+as\s+(\d{4}-\d{2}-\d{2})[.!]?$/i.exec(message.trim());
  if (!match) return { error: 'Use numbered rows and a checked report date, for example “date drafts 1-3 as 2026-09-30”.' };
  const selection = selectedDraftNumbers(drafts, match[1]);
  if (selection.error) return selection;
  const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  if (!validDate(match[2], indiaToday)) return { error: 'Use a real report date that is not in the future. No draft was changed.' };
  if (selection.numbers.some(number => drafts[number - 1].asOf))
    return { error: 'One selected row already has a value date. Check it separately; no draft was changed.' };
  const selectedSet = new Set(selection.numbers);
  const revised = drafts.map((row, index) => selectedSet.has(index + 1) ?
    { ...row, asOf: match[2] } : row);
  return { drafts: revised, numbers: selection.numbers, date: match[2], nextQuestion: nextDraftQuestion(revised) };
}

export function parseAmount(message) {
  const match = /^(?:(?:its?|the|current)\s+)?(?:(?:value|worth)\s+(?:is|of)?\s*)?(?:₹|rs\.?\s*|inr\s*)?([\d,]+(?:\.\d{1,2})?)\s*(k|thousand|lakhs?|lacs?|crores?)?(?:\s*rupees)?\.?$/i.exec(message.trim());
  if (!match) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d{1,2})?$/.test(match[1])) return null;
  const raw = match[1].replaceAll(',', '');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw) * (amountWords[match[2]?.toLowerCase()] || 1);
  return Number.isFinite(value) && value > 0 && value <= 10_000_000_000 ? Math.round(value * 100) / 100 : null;
}

function validDate(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value && value <= today;
}

/** Resolve one plainly stated missing fact without an AI call or another credit. */
export function clarifyDrafts(drafts, message, today = new Date()) {
  if (!Array.isArray(drafts) || !drafts.length || typeof message !== 'string') return null;
  const pending = focus(drafts);
  if (!pending) return null;
  const { index, field } = pending;
  const row = drafts[index];
  const clean = message.trim().replace(/[.!]$/, '').trim();
  let update = null;
  if (field === 'type') {
    if (/^(?:(?:it is|it's|a|an)\s+)?(?:mutual\s+fund|fund)$/i.test(clean)) update = { type: 'Mutual fund' };
    if (/^(?:(?:it is|it's|a|an)\s+)?(?:direct\s+)?(?:stock|share)$/i.test(clean))
      update = { type: 'Stock', asset: 'Equity' };
  } else if (field === 'value') {
    const value = parseAmount(clean);
    if (value !== null) update = { value };
  } else if (field === 'asset') {
    if (row.type === 'Stock') {
      if (/^(?:(?:yes|correct|it is|it's|a)\s+)?(?:stock|equity)$/i.test(clean)) update = { asset: 'Equity' };
    } else {
      const category = /^(?:(?:it is|it's|an?|the fund is)\s+)?(equity|debt|gold|mixed|hybrid|unknown|not sure)$/i.exec(clean)?.[1]?.toLowerCase();
      if (category) update = { asset: ['equity', 'debt', 'gold'].includes(category) ?
        category[0].toUpperCase() + category.slice(1) : 'Other', assetChecked: true };
    }
  } else if (field === 'asOf') {
    const date = /^(?:(?:as of|dated|on)\s+)?(\d{4}-\d{2}-\d{2})$/i.exec(clean)?.[1];
    const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    if (date && validDate(date, indiaToday)) update = { asOf: date };
  }
  if (!update) return null;
  const revised = drafts.map((draft, position) => position === index ? { ...draft, ...update } : draft);
  return { drafts: revised, changedName: row.name, changedField: field,
    nextQuestion: nextDraftQuestion(revised) };
}

/** Remove only an explicitly named draft, or the sole draft when the user says "skip this". */
export function skipDraftFromMessage(drafts, message) {
  if (!Array.isArray(drafts) || !drafts.length || typeof message !== 'string') return null;
  const match = /^(?:skip|remove|discard)\b(?:\s+(?:the\s+)?(?:duplicate\s+)?)?(.*)$/i.exec(message.trim());
  if (!match) return null;
  const normalize = value => value.trim().replace(/[.!]$/, '').replace(/^[“"']|[”"']$/g, '')
    .trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ');
  const wanted = normalize(match[1]);
  if (!wanted || ['this', 'it', 'this one'].includes(wanted)) {
    if (drafts.length !== 1) return { error: 'Name the draft to skip, for example: skip Fictional Bank.' };
    return { drafts: [], changedName: drafts[0].name };
  }
  const matches = drafts.map((row, index) => normalize(row.name) === wanted ? index : -1).filter(index => index >= 0);
  if (matches.length !== 1) return { error: 'Name one draft exactly as it appears in the possible holdings list.' };
  return { drafts: drafts.filter((_row, index) => index !== matches[0]), changedName: drafts[matches[0]].name };
}

/** Keep earlier pending rows when an AI reply describes only the row it clarified. */
export function mergeAssistantDrafts(existing, incoming) {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return existing;
  const result = existing.map(row => ({ ...row }));
  const key = row => row.name.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ');
  for (const row of incoming) {
    const index = result.findIndex(item => key(item) === key(row));
    if (index < 0) {
      if (result.length < 30) result.push(row);
      continue;
    }
    const old = result[index];
    result[index] = { ...old,
      type: row.type === 'Other' ? old.type : row.type,
      asset: row.asset === 'Other' ? old.asset : row.asset,
      value: row.value == null ? old.value : row.value,
      asOf: row.asOf == null ? old.asOf : row.asOf };
  }
  return result;
}
