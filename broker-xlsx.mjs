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
  if (!Array.isArray(rows) || !rows.length) return { headerIndex: 0, name: '', value: '', isin: '' };
  let best = { headerIndex: 0, score: -1, name: '', value: '', isin: '' };
  for (let index = 0; index < Math.min(rows.length, 15); index++) {
    const cells = Array.isArray(rows[index]) ? rows[index].map(cell => String(cell ?? '').trim().toLowerCase()) : [];
    const find = pattern => cells.findIndex(cell => pattern.test(cell));
    const name = find(/^(?:symbol|instrument|security|stock|stock name|security name|instrument name|scrip|scrip name)$/);
    const value = find(/^(?:current value|market value|current market value|holding value|holdings value|valuation|current valuation)$/);
    const isin = find(/^isin(?: no| number)?$/);
    const score = (name >= 0 ? 2 : 0) + (value >= 0 ? 2 : 0) + (isin >= 0 ? 1 : 0);
    if (score > best.score) best = { headerIndex: index, score, name: name >= 0 ? String(name) : '',
      value: value >= 0 ? String(value) : '', isin: isin >= 0 ? String(isin) : '' };
  }
  const { score, ...result } = best;
  return result;
}

/** Normalize only confirmed name, current market value and optional ISIN columns. */
export function parseBrokerHoldingsRows(rows, headerIndex, columns, asOf, { strictWidth = false } = {}) {
  const errors = [];
  const notices = ['Choose Stock or Mutual fund and verify the asset category for every row before replacing your holdings.'];
  if (!Array.isArray(rows) || !Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= rows.length ||
      !/^(?:\d{4})-(?:\d{2})-(?:\d{2})$/.test(asOf) || !realDate(asOf))
    return { holdings: [], errors: ['Choose the header row and the report valuation date.'], notices: [] };
  const header = rows[headerIndex];
  if (!Array.isArray(header) || !Number.isInteger(columns.name) || !Number.isInteger(columns.value) ||
      columns.name < 0 || columns.value < 0 || columns.name === columns.value ||
      columns.name >= header.length || columns.value >= header.length ||
      (columns.isin != null && (!Number.isInteger(columns.isin) || columns.isin < 0 ||
        columns.isin >= header.length || [columns.name, columns.value].includes(columns.isin))))
    return { holdings: [], errors: ['Choose separate name and current market value columns; ISIN is optional.'], notices: [] };
  const valueLabel = String(header[columns.value] ?? '').trim().toLowerCase().replace(/[._-]/g, ' ');
  if (!/(?:\bcurrent\b|\bmarket\b|\bmkt\b|\bvaluation\b|\bpresent\b|\bholdings? value\b)/.test(valueLabel) ||
      /\b(?:cost|buy|purchase|average|avg|invested|profit|loss)\b|p\s*&\s*l/.test(valueLabel))
    return { holdings: [], errors: ['Choose a column labelled current market value, not purchase cost or profit/loss.'], notices: [] };
  const holdings = [];
  const seen = new Set();
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
      else reportedTotal = value;
      continue;
    }
    const isin = columns.isin == null ? '' : String(row[columns.isin] ?? '').trim().toUpperCase();
    if (!name || name.length > 200 || value === null || value <= 0 || value > 10_000_000_000 ||
        (isin && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin))) {
      errors.push(`Report row ${index + 1}: check the name, current value and ISIN.`);
      if (errors.length >= 5) break;
      continue;
    }
    const key = `${name.toLocaleLowerCase('en-IN')}|${value}|${isin}`;
    if (seen.has(key)) { errors.push(`Report row ${index + 1}: duplicate row; check the report before import.`); continue; }
    seen.add(key);
    holdings.push({ name, type: null, asset: null, value, asOf, amc: null, isin: isin || null, amfi: null, exposure: null });
    if (holdings.length > MAX_ROWS) { errors.push('Import at most 200 holdings at a time.'); break; }
  }
  if (!holdings.length && !errors.length) errors.push('No holdings were found below the selected header.');
  const total = holdings.reduce((sum, holding) => sum + holding.value, 0);
  if (reportedTotal !== null && Math.abs(reportedTotal - total) > 1)
    errors.push('The report total does not match the selected rows and value column.');
  return { holdings: errors.length ? [] : holdings, errors: errors.slice(0, 5), notices };
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
