const MAX_FILE_BYTES = 2_000_000;
const MAX_UNPACKED_BYTES = 12_000_000;
const MAX_ENTRIES = 100;
const MAX_ROWS = 200;
const AMOUNT = /^(?:\d+|\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;

/** Reject oversized or unexpected ZIP contents before the workbook reader runs. */
export function checkXlsxArchive(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_FILE_BYTES) throw new Error('Choose an XLSX file smaller than 2 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { eocd = i; break; }
  }
  if (eocd < 0 || view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true))
    throw new Error('This is not a supported XLSX workbook.');
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (!count || count > MAX_ENTRIES || count === 0xffff || directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff || directoryOffset + directorySize > eocd)
    throw new Error('This workbook has too many or unsupported archive entries.');
  let position = directoryOffset;
  let unpacked = 0;
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (position + 46 > eocd || view.getUint32(position, true) !== 0x02014b50)
      throw new Error('The XLSX archive directory is invalid.');
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const compressed = view.getUint32(position + 20, true);
    const expanded = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const end = position + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || (flags & 1) || ![0, 8].includes(method) || expanded > 5_000_000 ||
        compressed > MAX_FILE_BYTES || expanded === 0xffffffff)
      throw new Error('The XLSX archive contains an unsupported or oversized part.');
    const name = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLength));
    const lower = name.toLowerCase();
    if (lower.includes('..') || lower.includes('\\') || lower.startsWith('/') ||
        lower.startsWith('xl/externallinks/') || lower.endsWith('vbaproject.bin'))
      throw new Error('The XLSX archive contains an unsupported part.');
    names.add(lower);
    unpacked += expanded;
    if (unpacked > MAX_UNPACKED_BYTES) throw new Error('This XLSX workbook expands beyond the 12 MB preview limit.');
    position = end;
  }
  if (position !== directoryOffset + directorySize || !names.has('[content_types].xml') ||
      !names.has('xl/workbook.xml') || ![...names].some(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)))
    throw new Error('This is not a supported XLSX holdings workbook.');
}

export function suggestBrokerColumns(rows) {
  if (!Array.isArray(rows) || !rows.length) return { headerIndex: 0, name: '', value: '', isin: '', cost: '' };
  let best = { headerIndex: 0, score: -1, name: '', value: '', isin: '', cost: '' };
  for (let index = 0; index < Math.min(rows.length, 15); index++) {
    const cells = Array.isArray(rows[index]) ? rows[index].map(normalizeHeader) : [];
    // A duplicated heading cannot be mapped safely in the chat importer.
    const find = pattern => {
      const matches = cells.flatMap((cell, column) => pattern.test(cell) ? [column] : []);
      return matches.length === 1 ? matches[0] : -1;
    };
    const name = find(/^(?:symbol|trading symbol|stock symbol|instrument|security|stock|stock name|security name|instrument name|scrip|scrip name)$/);
    const value = find(/^(?:current|market|mkt|holding|holdings|present)(?: market)? value$|^(?:valuation|current valuation|market valuation)$/);
    const isin = find(/^isin(?: no| number)?$/);
    const cost = find(/^(?:total )?(?:invested amount|invested value|investment value|purchase cost|purchase value|cost basis|buy value)$/);
    const score = (name >= 0 ? 2 : 0) + (value >= 0 ? 2 : 0) + (isin >= 0 ? 1 : 0);
    if (score > best.score) best = { headerIndex: index, score, name: name >= 0 ? String(name) : '',
      value: value >= 0 ? String(value) : '', isin: isin >= 0 ? String(isin) : '',
      cost: cost >= 0 ? String(cost) : '' };
  }
  const { score, ...result } = best;
  return result;
}

function normalizeHeader(cell) {
  return String(cell ?? '').trim().toLowerCase()
    .replace(/\(\s*(?:₹|inr|rs\.?)\s*\)|₹|\b(?:inr|rs\.?)\b/g, '')
    .replace(/[._-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Normalize only confirmed name, current market value and optional ISIN columns. */
export function parseBrokerHoldingsRows(rows, headerIndex, columns, asOf,
  { strictWidth = false, allowUnknownDate = false } = {}) {
  const errors = [];
  const notices = ['Choose Stock or Mutual fund and verify the asset category for every row before replacing your holdings.'];
  if (!Array.isArray(rows) || !Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= rows.length ||
      !(allowUnknownDate && asOf === null) && (!/^(?:\d{4})-(?:\d{2})-(?:\d{2})$/.test(asOf) || !realDate(asOf)))
    return { holdings: [], errors: ['Choose the header row and the report valuation date.'], notices: [] };
  const header = rows[headerIndex];
  if (!Array.isArray(header) || !Number.isInteger(columns.name) || !Number.isInteger(columns.value) ||
      columns.name < 0 || columns.value < 0 || columns.name === columns.value ||
      columns.name >= header.length || columns.value >= header.length ||
      [columns.isin, columns.cost].some((column, position) => column != null &&
        (!Number.isInteger(column) || column < 0 || column >= header.length ||
         [columns.name, columns.value, position ? columns.isin : columns.cost].includes(column))))
    return { holdings: [], errors: ['Choose separate name and current market value columns; ISIN and invested amount are optional.'], notices: [] };
  const valueLabel = String(header[columns.value] ?? '').trim().toLowerCase().replace(/[._-]/g, ' ');
  if (!/(?:\bcurrent\b|\bmarket\b|\bmkt\b|\bvaluation\b|\bpresent\b|\bholdings? value\b)/.test(valueLabel) ||
      /\b(?:cost|buy|purchase|average|avg|invested|profit|loss)\b|p\s*&\s*l/.test(valueLabel))
    return { holdings: [], errors: ['Choose a column labelled current market value, not purchase cost or profit/loss.'], notices: [] };
  if (columns.cost != null) {
    const costLabel = String(header[columns.cost] ?? '').trim().toLowerCase().replace(/[._-]/g, ' ');
    if (!/^(?:total )?(?:invested amount|invested value|investment value|purchase cost|purchase value|cost basis|buy value)$/.test(costLabel))
      return { holdings: [], errors: ['Choose a total invested amount for the current position, not average price, profit or a transaction amount.'], notices: [] };
    notices.push('The mapped invested amount stays a draft until you check each row against the current units or shares.');
  }
  const holdings = [];
  const seen = new Set();
  const seenIsins = new Set();
  const seenNames = new Map();
  let reportedTotal = null;
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!Array.isArray(row) || row.every(cell => cell == null || String(cell).trim() === '')) continue;
    if (strictWidth && row.length !== header.length) {
      errors.push(`Report row ${index + 1}: expected ${header.length} CSV columns, found ${row.length}. Check commas and quotes.`);
      if (errors.length >= 5) break;
      continue;
    }
    const name = String(row[columns.name] ?? '').trim();
    const raw = row[columns.value];
    const value = numericAmount(raw);
    if (/^(?:grand )?total$/i.test(name)) {
      if (value === null) errors.push(`Report row ${index + 1}: the reported total is invalid.`);
      else if (reportedTotal !== null) errors.push(`Report row ${index + 1}: more than one total row was found. Check the report before import.`);
      else reportedTotal = value;
      continue;
    }
    const isin = columns.isin == null ? '' : String(row[columns.isin] ?? '').trim().toUpperCase();
    const cost = columns.cost == null || row[columns.cost] == null || String(row[columns.cost]).trim() === '' ?
      null : numericAmount(row[columns.cost]);
    if (!name || name.length > 200 || value === null || value <= 0 || value > 10_000_000_000 ||
        (isin && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) ||
        columns.cost != null && cost !== null && (cost <= 0 || cost > 10_000_000_000) ||
        columns.cost != null && String(row[columns.cost] ?? '').trim() !== '' && cost === null) {
      errors.push(`Report row ${index + 1}: check the name, current value, invested amount and ISIN.`);
      if (errors.length >= 5) break;
      continue;
    }
    const key = `${name.toLocaleLowerCase('en-IN')}|${value}|${isin}`;
    if (seen.has(key)) { errors.push(`Report row ${index + 1}: duplicate row; check the report before import.`); continue; }
    const nameKey = name.toLocaleLowerCase('en-IN');
    if (isin && seenIsins.has(isin) || seenNames.has(nameKey) && (!isin || !seenNames.get(nameKey))) {
      errors.push(`Report row ${index + 1}: repeated ISIN or name may represent another lot or a duplicate. Check and aggregate this report before import.`);
      continue;
    }
    seen.add(key);
    if (isin) seenIsins.add(isin);
    seenNames.set(nameKey, isin);
    holdings.push({ name, type: null, asset: null, value, asOf, amc: null, isin: isin || null, amfi: null,
      exposure: null, ...(cost !== null && asOf !== null ?
        { _costCandidate: cost, _costCandidateAsOf: asOf } : {}) });
    if (holdings.length > MAX_ROWS) { errors.push('Import at most 200 holdings at a time.'); break; }
  }
  if (!holdings.length && !errors.length) errors.push('No holdings were found below the selected header.');
  const total = holdings.reduce((sum, holding) => sum + holding.value, 0);
  if (reportedTotal !== null && Math.abs(reportedTotal - total) > 1)
    errors.push('The report total does not match the selected rows and value column.');
  return { holdings: errors.length ? [] : holdings, errors: errors.slice(0, 5), notices,
    reportedTotal: errors.length ? null : reportedTotal,
    parsedTotal: errors.length ? null : Math.round(total * 100) / 100 };
}

function numericAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && Math.abs(raw * 100 - Math.round(raw * 100)) < 0.000001 ? raw : null;
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/^₹\s*/, '');
  return AMOUNT.test(value) ? Number(value.replaceAll(',', '')) : null;
}

function realDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso;
}
