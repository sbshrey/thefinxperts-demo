import { checkXlsxArchive } from './broker-xlsx.mjs?v=f99c3f688088';
import { parseFundDisclosureRows } from './fund-disclosure.mjs?v=f99c3f688088';

/** Read a selected scheme disclosure locally. The worker never sends workbook bytes to the host. */
export async function previewFundDisclosures(file, confirmed = []) {
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 5_000_000)
    throw new Error('Choose an XLSX scheme portfolio smaller than 5 MB.');
  checkXlsxArchive(await file.arrayBuffer(), 'disclosure');
  const workbook = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fund-disclosure-worker.js?v=f99c3f688088', import.meta.url));
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
