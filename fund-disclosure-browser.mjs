import { checkXlsxArchive } from './broker-xlsx.mjs?v=979cff73e85b';
import { parseFundDisclosureRows } from './fund-disclosure.mjs?v=979cff73e85b';

const hdfcFlexiName = /^Monthly HDFC Flexi Cap Fund - \d{1,2} [A-Za-z]+ 20\d{2}\.xlsx$/i;
const flexiFailure = message => Object.assign(new Error(message), { disclosureWorkbook: true });

async function previewHdfcFlexi(file) {
  // The bundled browser reader runs its parser in its own disposable worker.
  // This route selects only the holdings tab, leaving the large derivative tab unread.
  try {
    await import('./vendor/read-excel-file/read-excel-file.min.js?v=979cff73e85b');
    const reader = globalThis.readXlsxFile;
    if (typeof reader !== 'function') throw new Error('Workbook reader unavailable');
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Workbook read timed out')), 25_000);
    });
    let workbook;
    try { workbook = await Promise.race([reader(file, { sheets: ['HDFCEQ'] }), timeout]); }
    finally { clearTimeout(timer); }
    if (!Array.isArray(workbook) || workbook.length !== 1 || workbook[0]?.sheet !== 'HDFCEQ')
      throw new Error('Holdings tab missing');
    const rows = workbook[0].data;
    if (!Array.isArray(rows) || rows.length > 1000 || rows.some(row => !Array.isArray(row) || row.length > 80) ||
        !/^HDFC Flexi Cap Fund\s*\(/i.test(String(rows[0]?.[0] || '')))
      throw new Error('Holdings tab invalid');
    const parsed = parseFundDisclosureRows(rows);
    if (parsed.errors.length || parsed.disclosure?.scheme !== 'HDFC Flexi Cap Fund')
      throw new Error('Scheme disclosure did not reconcile');
    return [parsed.disclosure];
  } catch {
    throw flexiFailure('The HDFC Flexi Cap holdings sheet could not be checked safely.');
  }
}

/** Read a selected scheme disclosure locally. The worker never sends workbook bytes to the host. */
export async function previewFundDisclosures(file, confirmed = []) {
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 5_000_000)
    throw new Error('Choose an XLSX scheme portfolio smaller than 5 MB.');
  const hdfcFlexi = hdfcFlexiName.test(file.name);
  checkXlsxArchive(await file.arrayBuffer(), hdfcFlexi ? 'hdfc-flexi-disclosure' : 'disclosure');
  if (hdfcFlexi) return previewHdfcFlexi(file);
  const workbook = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fund-disclosure-worker.js?v=979cff73e85b', import.meta.url));
    let finished = false;
    const timer = setTimeout(() => finish(new Error('The scheme disclosure preview timed out.')), 25_000);
    function finish(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error); else resolve(value);
    }
    worker.onmessage = event => {
      if (event.data?.error) {
        const error = new Error(event.data.error);
        error.disclosureWorkbook = event.data.disclosureWorkbook === true;
        finish(error);
      } else finish(null, event.data);
    };
    worker.onerror = () => finish(new Error('The scheme disclosure preview failed in this browser.'));
    worker.postMessage({ file, targetNames: confirmed.filter(row => row?.type === 'Mutual fund' &&
      row.granularity !== 'fund_house').map(row => row.name) });
  });
  const sheets = workbook?.sheets;
  if (!Array.isArray(sheets) || !sheets.length || sheets.length > 5)
    throw new Error('The scheme disclosure worker returned no supported sheet.');
  return sheets.map(sheet => {
    const result = parseFundDisclosureRows(sheet.rows);
    if (result.errors.length) {
      const error = new Error(`${sheet.name || 'This sheet'}: ${result.errors[0]}`);
      error.disclosureWorkbook = workbook.multiSheet === true;
      throw error;
    }
    return result.disclosure;
  });
}

export async function previewFundDisclosure(file) {
  const disclosures = await previewFundDisclosures(file);
  if (disclosures.length !== 1) throw new Error('Choose one supported scheme sheet.');
  return disclosures[0];
}
