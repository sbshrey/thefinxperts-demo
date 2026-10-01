const MAX_BYTES = 1_000_000;
const MAX_HOLDINGS = 200;
const REQUIRED = ['name', 'type', 'asset', 'value'];
const ASSETS = new Set(['Equity', 'Debt', 'Gold', 'Other']);
const TYPES = new Set(['Mutual fund', 'Stock']);

/** Parse a small, deliberately explicit user-created holdings CSV. No network or persistence. */
export function parseHoldingsCsv(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) {
    return { holdings: [], errors: ['Choose a UTF-8 CSV file smaller than 1 MB.'] };
  }
  let rows;
  try { rows = parseRows(text.replace(/^\uFEFF/, '')); }
  catch (error) { return { holdings: [], errors: [error.message] }; }
  if (rows.length < 2) return { holdings: [], errors: ['The CSV needs a header and at least one holding.'] };
  const headers = rows[0].map(value => value.trim().toLowerCase().replace(/[ _-]/g, ''));
  if (new Set(headers).size !== headers.length) {
    return { holdings: [], errors: ['The CSV has duplicate column names. Keep each header only once.'] };
  }
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  const missing = REQUIRED.filter(name => index[name] === undefined);
  if (missing.length) return { holdings: [], errors: [`Missing required columns: ${missing.join(', ')}.`] };
  const dataRows = rows.slice(1).filter(row => row.some(value => value.trim()));
  if (dataRows.length > MAX_HOLDINGS) return { holdings: [], errors: [`The file has more than ${MAX_HOLDINGS} holdings. Split or aggregate it first.`] };

  const holdings = [];
  const errors = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(value => !value.trim())) continue;
    const line = i + 1;
    if (row.length !== headers.length) {
      errors.push(`Row ${line}: expected ${headers.length} columns, found ${row.length}.`);
      continue;
    }
    const get = column => (row[index[column]] || '').trim();
    const name = get('name');
    const type = canonical(get('type'), TYPES);
    const asset = canonical(get('asset'), ASSETS);
    const rawValue = get('value');
    const value = Number(rawValue.replaceAll(',', ''));
    const asOf = index.asof === undefined ? '' : get('asof');
    const amc = get('amc');
    const isin = get('isin').toUpperCase();
    const amfi = get('amfi');

    if (!name || name.length > 80) errors.push(`Row ${line}: name must be 1–80 characters.`);
    if (!type) errors.push(`Row ${line}: type must be Mutual fund or Stock.`);
    if (!asset) errors.push(`Row ${line}: asset must be Equity, Debt, Gold or Other.`);
    if (type === 'Stock' && asset && asset !== 'Equity') errors.push(`Row ${line}: a directly held stock must use Equity as its asset.`);
    if (!rawValue || !/^(?:\d+|\d{1,3}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(rawValue) || !Number.isFinite(value) || value <= 0 || value > 1e10) {
      errors.push(`Row ${line}: value must be a positive rupee amount up to ₹10,00,00,00,000.`);
    }
    if (asOf && !isRealIsoDate(asOf)) errors.push(`Row ${line}: asOf must be a real date in YYYY-MM-DD format.`);
    if (amc.length > 200) errors.push(`Row ${line}: AMC name must be at most 200 characters.`);
    if (isin && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) errors.push(`Row ${line}: ISIN must have 12 letters and digits in a valid format.`);
    if (amfi && !/^\d{5,8}$/.test(amfi)) errors.push(`Row ${line}: AMFI code must be 5–8 digits.`);
    if (type === 'Stock' && (amc || amfi)) errors.push(`Row ${line}: a directly held stock cannot have AMC or AMFI fund fields.`);
    const key = `${name.toLocaleLowerCase('en-IN')}|${type}|${asset}|${asOf}|${isin}`;
    if (seen.has(key)) errors.push(`Row ${line}: duplicate holding. Aggregate same-name entries before import.`);
    seen.add(key);
    if (errors.length > 20) break;
    holdings.push({ name, type, asset, value, asOf: asOf || null, amc: amc || null, isin: isin || null, amfi: amfi || null,
      exposure: type === 'Stock' && name ? { [name]: 1 } : null });
  }
  if (!holdings.length && !errors.length) errors.push('The CSV has no holdings.');
  return { holdings: errors.length ? [] : holdings, errors };
}

function canonical(value, options) {
  return [...options].find(option => option.toLowerCase() === value.toLowerCase()) || null;
}

function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parseRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      afterQuote = false;
      if (c === ',' ) continue;
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows.push(row);
      row = [];
    } else if (c === '"' && field === '' && !afterQuote) {
      quoted = true;
    } else if (afterQuote && (c === ' ' || c === '\t')) {
      // Whitespace between a closing quote and delimiter is harmless.
    } else if (afterQuote || c === '"') {
      throw new Error('Malformed CSV quoting. Check double quotes and commas.');
    } else field += c;
  }
  if (quoted) throw new Error('Malformed CSV quoting: a quoted field is not closed.');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
