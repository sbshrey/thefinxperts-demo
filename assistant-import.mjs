import { parseHoldingsCsv, parseBrokerCsvRows } from './csv.mjs?v=416b8426a5c0';
import { suggestBrokerColumns, detectBrokerHoldingsDate, parseBrokerHoldingsRows } from './broker-xlsx.mjs?v=416b8426a5c0';
import { readBrokerWorkbook } from './broker-xlsx-browser.mjs?v=416b8426a5c0';
import { validShares } from './stock-estimate.mjs?v=416b8426a5c0';
import { rupees } from './assistant-import-audit.mjs?v=416b8426a5c0';

const MAX_CHAT_DRAFTS = 30;
const MAX_BROWSER_IMPORT_DRAFTS = 200;

function importAudit(drafts, reportedTotal = null) {
  const parsedTotal = drafts.reduce((paise, row) => paise + Math.round(row.value * 100), 0) / 100;
  const dates = drafts.map(row => row.asOf).filter(Boolean).sort();
  const dateNote = !dates.length ? 'No valuation dates were supplied.' :
    `${dates.length} of ${drafts.length} ${drafts.length === 1 ? 'row has a supplied valuation date' : 'rows have supplied valuation dates'}${dates[0] === dates.at(-1) ?
      ` (${dates[0]})` : ` (${dates[0]} to ${dates.at(-1)})`}.`;
  return `Parsed value ${rupees(parsedTotal)}; ${reportedTotal === null ? 'no report total supplied' :
    `reported total ${rupees(reportedTotal)} (matched within ₹1)`}. No non-total rows were omitted. ${dateNote}`;
}

const BROKER_METADATA_HEADERS = {
  type: new Set(['holding type', 'security type', 'instrument type']),
  asset: new Set(['asset class', 'asset category']),
  asOf: new Set(['value date', 'valuation date', 'as of date']),
  shares: new Set(['quantity', 'share quantity', 'shares held', 'holding quantity']),
};

function brokerMetadataColumns(header, reserved) {
  const found = { type: null, asset: null, asOf: null, shares: null };
  for (const [index, cell] of header.entries()) {
    const label = String(cell ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    for (const [field, labels] of Object.entries(BROKER_METADATA_HEADERS)) {
      if (!labels.has(label)) continue;
      if (reserved.has(index) || found[field] !== null)
        return { error: `The report has ambiguous ${field === 'asOf' ? 'valuation date' : field === 'shares' ? 'share count' : field} columns. Check the header before importing.` };
      found[field] = index;
    }
  }
  return found;
}

function explicitType(value) {
  const label = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!label) return 'Other';
  if (['stock', 'share', 'equity share', 'equity shares', 'direct equity'].includes(label)) return 'Stock';
  if (['mutual fund', 'mutual funds', 'mf'].includes(label)) return 'Mutual fund';
  return null;
}

function explicitAsset(value) {
  const label = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!label) return 'Other';
  return { equity: 'Equity', debt: 'Debt', gold: 'Gold', other: 'Other',
    mixed: 'Other', hybrid: 'Other', unknown: 'Other' }[label] || null;
}

function explicitDate(value) {
  const label = String(value ?? '').trim();
  if (!label) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return false;
  const date = new Date(`${label}T00:00:00Z`);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === label && label <= today ? label : false;
}

/** Stage only fields stated in distinct, compatible broker columns. */
export function brokerDrafts(rows, source, strictWidth, aiAvailable, maxDrafts = MAX_CHAT_DRAFTS) {
  const suggested = suggestBrokerColumns(rows);
  if (suggested.name === '' || suggested.value === '' || suggested.name === suggested.value) {
    return { drafts: [], errors: ['I could not identify separate security and current market value columns. Use a broker holdings report with those headings.'] };
  }
  const datedHeading = detectBrokerHoldingsDate(rows, suggested.headerIndex);
  if (datedHeading.error) return { drafts: [], errors: [datedHeading.error] };
  const result = parseBrokerHoldingsRows(rows, suggested.headerIndex, {
    name: Number(suggested.name), value: Number(suggested.value),
    isin: suggested.isin === '' ? null : Number(suggested.isin),
    cost: suggested.cost === '' ? null : Number(suggested.cost),
  }, null, { strictWidth, allowUnknownDate: true, stageUndatedCost: true });
  if (result.errors.length) return { drafts: [], errors: result.errors };
  if (result.holdings.length > maxDrafts) {
    return { drafts: [], handoffSource: 'broker', errors: [`This chat can confirm up to ${maxDrafts} rows at once. The detailed review can preview this broker report (up to 200 positions).`] };
  }
  if (result.holdings.some(row => row.name.length > 80)) {
    return { drafts: [], errors: ['A security name exceeds the saved review limit of 80 characters. Use the guided import to check it.'] };
  }
  const metadata = brokerMetadataColumns(rows[suggested.headerIndex],
    new Set([suggested.name, suggested.value, suggested.isin, suggested.cost].filter(value => value !== '').map(Number)));
  if (metadata.error) return { drafts: [], errors: [metadata.error] };
  const dataRows = rows.slice(suggested.headerIndex + 1).map((row, offset) => ({ row, number: suggested.headerIndex + offset + 2 }))
    .filter(({ row }) => Array.isArray(row) && row.some(cell => cell != null && String(cell).trim() !== '') &&
      !/^(?:grand )?total$/i.test(String(row[Number(suggested.name)] ?? '').trim()));
  if (dataRows.length !== result.holdings.length || dataRows.some(({ row }, index) =>
    String(row[Number(suggested.name)] ?? '').trim() !== result.holdings[index].name))
    return { drafts: [], errors: ['The report rows could not be matched to the parsed holdings. Check the file before importing.'] };
  const drafts = [];
  for (const [index, holding] of result.holdings.entries()) {
    const { row, number } = dataRows[index];
    const type = metadata.type === null ? 'Other' : explicitType(row[metadata.type]);
    const asset = metadata.asset === null ? 'Other' : explicitAsset(row[metadata.asset]);
    const asOf = metadata.asOf === null ? datedHeading.date : explicitDate(row[metadata.asOf]);
    const rawShares = metadata.shares === null ? '' : String(row[metadata.shares] ?? '').trim();
    const shares = type === 'Stock' && rawShares ? rawShares : null;
    if (type === null || asset === null || asOf === false || type === 'Stock' && asset !== 'Other' && asset !== 'Equity') {
      return { drafts: [], errors: [`Report row ${number}: check the holding type, asset class and ISO valuation date (YYYY-MM-DD). Unsupported or conflicting labels cannot be imported.`] };
    }
    if (shares && !validShares(shares))
      return { drafts: [], errors: [`Report row ${number}: the stock share count is invalid. Check the current settled shares after trades and corporate actions.`] };
    drafts.push({ name: holding.name, type, asset: type === 'Stock' ? 'Equity' : asset,
      value: holding.value, asOf, ...(holding.isin ? { isin: holding.isin } : {}),
      ...(shares ? { shares } : {}),
      ...(holding._costCandidate !== undefined ? { _costCandidate: holding._costCandidate } : {}),
      entryOrigin: source });
  }
  const typed = drafts.filter(row => row.type !== 'Other').length;
  const dated = drafts.filter(row => row.asOf).length;
  const counted = drafts.filter(row => row.shares).length;
  const costCandidates = drafts.filter(row => row._costCandidate !== undefined).length;
  const metadataNote = metadata.type !== null || metadata.asset !== null || metadata.asOf !== null ?
    `Used explicit report fields for ${typed} type${typed === 1 ? '' : 's'} and ${dated} valuation date${dated === 1 ? '' : 's'}; check every row. Missing fields remain unknown.` :
    `Please confirm each row is a fund or directly held stock; ${datedHeading.date ?
      `the explicit holdings-as-of heading supplied ${datedHeading.date} for its valuation date` :
      'its valuation date remains unknown until you provide one'}.`;
  const headingNote = datedHeading.date && metadata.asOf === null ?
    ` Check the ${datedHeading.date} holdings-as-of date against your report before confirming.` : '';
  const audit = importAudit(drafts, result.reportedTotal);
  return { drafts, errors: [], audit, message: `Found ${drafts.length} possible holding${drafts.length === 1 ? '' : 's'} in the broker report. ${audit} The file stayed in this browser. ${metadataNote}${headingNote}${counted ? ` ${counted} stock share count${counted === 1 ? ' was' : 's were'} staged; check the current settled shares after trades, splits or bonuses before confirming.` : ''}${costCandidates ? ` ${costCandidates} invested amount${costCandidates === 1 ? ' is' : 's are'} unconfirmed; check each against the position still held and its value date before using gain or loss.` : ''} ${aiAvailable ? 'Asking AI about these drafts will send their names and values.' : 'Your questions here are answered in this browser without sending the rows.'}` };
}

/** Prepare unconfirmed chat rows from supported CSV or XLSX exports without an upload. */
export async function previewAssistantImport(file, { aiAvailable = true, browserOnly = false } = {}) {
  const maxDrafts = browserOnly ? MAX_BROWSER_IMPORT_DRAFTS : MAX_CHAT_DRAFTS;
  if (!file || typeof file.name !== 'string') return { drafts: [], errors: ['Choose a CSV or XLSX holdings report.'] };
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.csv')) {
      if (file.size > 1_000_000) return { drafts: [], errors: ['Choose a UTF-8 CSV smaller than 1 MB.'] };
      const text = await file.text();
      if (text.includes('\uFFFD')) return { drafts: [], errors: ['This CSV is not valid UTF-8. Export a UTF-8 holdings report.'] };
      const simple = parseHoldingsCsv(text);
      if (simple.holdings.length) {
        if (simple.holdings.length > maxDrafts)
          return { drafts: [], handoffSource: 'csv', errors: [`This chat can confirm up to ${maxDrafts} rows at once. The detailed review can preview this CSV (up to 200 holdings).`] };
        const audit = importAudit(simple.holdings);
        return { drafts: simple.holdings.map(row => ({ ...row, entryOrigin: 'simple_csv' })),
          errors: [], audit, message: `Found ${simple.holdings.length} possible holding${simple.holdings.length === 1 ? '' : 's'} in the simple CSV. ${audit} The file stayed in this browser. Check the rows before confirming them. ${aiAvailable ? 'Asking AI about these drafts will send their names and values.' : 'Your questions here are answered in this browser without sending the rows.'}` };
      }
      const rows = parseBrokerCsvRows(text);
      const broker = brokerDrafts(rows, 'broker_csv', true, aiAvailable, maxDrafts);
      if (broker.errors.length && !simple.errors[0]?.startsWith('Missing required columns:')) return { drafts: [], errors: simple.errors };
      return broker;
    }
    if (name.endsWith('.xlsx')) return brokerDrafts(await readBrokerWorkbook(file), 'broker_xlsx', false, aiAvailable, maxDrafts);
    return { drafts: [], errors: ['Choose a CSV or XLSX holdings report.'] };
  } catch (error) {
    return { drafts: [], errors: [error?.message || 'This report could not be read in the browser.'] };
  }
}
