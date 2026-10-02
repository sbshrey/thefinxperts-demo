import { parseHoldingsCsv, parseBrokerCsvRows } from './csv.mjs';
import { suggestBrokerColumns, parseBrokerHoldingsRows } from './broker-xlsx.mjs';
import { readBrokerWorkbook } from './broker-xlsx-browser.mjs';

const MAX_CHAT_DRAFTS = 30;

function brokerDrafts(rows, source, strictWidth, aiAvailable) {
  const suggested = suggestBrokerColumns(rows);
  if (suggested.name === '' || suggested.value === '' || suggested.name === suggested.value) {
    return { drafts: [], errors: ['I could not identify separate security and current market value columns. Use a broker holdings report with those headings.'] };
  }
  const result = parseBrokerHoldingsRows(rows, suggested.headerIndex, {
    name: Number(suggested.name), value: Number(suggested.value),
    isin: suggested.isin === '' ? null : Number(suggested.isin),
  }, null, { strictWidth, allowUnknownDate: true });
  if (result.errors.length) return { drafts: [], errors: result.errors };
  if (result.holdings.length > MAX_CHAT_DRAFTS) {
    return { drafts: [], errors: [`This chat can confirm up to ${MAX_CHAT_DRAFTS} rows at once. Split the report or use the guided import on the main page.`] };
  }
  if (result.holdings.some(row => row.name.length > 80)) {
    return { drafts: [], errors: ['A security name exceeds the saved review limit of 80 characters. Use the guided import to check it.'] };
  }
  return { drafts: result.holdings.map(row => ({ name: row.name, type: 'Other', asset: 'Other',
    value: row.value, asOf: null, ...(row.isin ? { isin: row.isin } : {}), entryOrigin: source })),
  errors: [], message: `Found ${result.holdings.length} possible holding${result.holdings.length === 1 ? '' : 's'} in the broker report. The file stayed in this browser. Please confirm each row is a fund or directly held stock; its valuation date remains unknown until you provide one. ${aiAvailable ? 'Asking AI about these drafts will send their names and values.' : 'Your questions here are answered in this browser without sending the rows.'}` };
}

/** Prepare unconfirmed chat rows from supported CSV or XLSX exports without an upload. */
export async function previewAssistantImport(file, { aiAvailable = true } = {}) {
  if (!file || typeof file.name !== 'string') return { drafts: [], errors: ['Choose a CSV or XLSX holdings report.'] };
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.csv')) {
      if (file.size > 1_000_000) return { drafts: [], errors: ['Choose a UTF-8 CSV smaller than 1 MB.'] };
      const text = await file.text();
      if (text.includes('\uFFFD')) return { drafts: [], errors: ['This CSV is not valid UTF-8. Export a UTF-8 holdings report.'] };
      const simple = parseHoldingsCsv(text);
      if (simple.holdings.length) {
        if (simple.holdings.length > MAX_CHAT_DRAFTS)
          return { drafts: [], errors: [`This chat can confirm up to ${MAX_CHAT_DRAFTS} rows at once. Split the file or use the guided import on the main page.`] };
        return { drafts: simple.holdings.map(row => ({ ...row, entryOrigin: 'simple_csv' })),
          errors: [], message: `Found ${simple.holdings.length} possible holding${simple.holdings.length === 1 ? '' : 's'} in the CSV. The file stayed in this browser. Check the rows before confirming them. ${aiAvailable ? 'Asking AI about these drafts will send their names and values.' : 'Your questions here are answered in this browser without sending the rows.'}` };
      }
      const rows = parseBrokerCsvRows(text);
      const broker = brokerDrafts(rows, 'broker_csv', true, aiAvailable);
      if (broker.errors.length && !simple.errors[0]?.startsWith('Missing required columns:')) return { drafts: [], errors: simple.errors };
      return broker;
    }
    if (name.endsWith('.xlsx')) return brokerDrafts(await readBrokerWorkbook(file), 'broker_xlsx', false, aiAvailable);
    return { drafts: [], errors: ['Choose a CSV or XLSX holdings report.'] };
  } catch (error) {
    return { drafts: [], errors: [error?.message || 'This report could not be read in the browser.'] };
  }
}
