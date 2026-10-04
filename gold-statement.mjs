/** Preview one narrow digital-gold statement summary. Never infer today's value from purchases. */
export function parseGoldStatementPages(pages) {
  const fail = (message, recognized = false) => ({ holding: null, errors: [message], recognized });
  if (!Array.isArray(pages) || !pages.length || pages.length > 50 ||
      pages.some(page => !Array.isArray(page) || page.length > 1500 ||
        page.some(cell => typeof cell !== 'string' || cell.length > 300)))
    return fail('This gold statement is too large or has an unsupported layout. No holding was added.');
  const text = pages.flat().map(cell => cell.replace(/\s+/g, ' ').trim()).join(' ');
  const jarLayout = /Your gold savings/i.test(text) && /Account Statement/i.test(text) &&
    /Your current gold savings\s*:/i.test(text);
  if (!jarLayout) {
    const gullakLayout = /Transaction\s+Type\s+Amount\s+Quantity/i.test(text) &&
      /Total Buy\s*-\s*Gold/i.test(text) && /Total Sell\s*-\s*Gold/i.test(text) &&
      /Total Lease\s*-\s*Gold/i.test(text);
    return gullakLayout ? fail('This Gullak statement shows gold activity and quantity, but no dated current rupee value. Check the current balance, value and valuation date in your provider account, then tell the assistant the checked value. No holding was added.', true) :
      { holding: null, errors: [], recognized: false };
  }
  const matches = [...text.matchAll(/Your current gold savings\s*:\s*\|\s*(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)\s*\|\s*([\d,.]+)\s*g\b/gi)];
  if (matches.length !== 1)
    return fail('The current gold value and quantity could not be uniquely read. No holding was added.', true);
  const value = money(matches[0][1]);
  const grams = gramsAmount(matches[0][2]);
  if (value === null || grams === null)
    return fail('The current gold value or quantity is invalid. No holding was added.', true);
  return { holding: { name: 'Jar digital gold', type: 'Other investment', asset: 'Gold',
    value, asOf: null, entryOrigin: 'digital_gold_statement' }, errors: [], recognized: true,
  checks: { grams } };
}

function money(raw) {
  if (!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{0,2}(?:,\d{2})+,\d{3})(?:\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw.replaceAll(',', ''));
  return Number.isFinite(amount) && amount > 0 && amount <= 10_000_000_000 ? amount : null;
}

function gramsAmount(raw) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000 ? amount : null;
}
