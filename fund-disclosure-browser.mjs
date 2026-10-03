import { checkXlsxArchive } from './broker-xlsx.mjs?v=b5fcac58766a';
import { parseFundDisclosureRows } from './fund-disclosure.mjs?v=b5fcac58766a';

/** Read a selected scheme disclosure locally. The worker never sends workbook bytes to the host. */
export async function previewFundDisclosure(file) {
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 2_000_000)
    throw new Error('Choose one XLSX scheme portfolio smaller than 2 MB.');
  checkXlsxArchive(await file.arrayBuffer());
  const rows = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fund-disclosure-worker.js?v=b5fcac58766a', import.meta.url));
    let finished = false;
    const timer = setTimeout(() => finish(new Error('The scheme disclosure preview timed out.')), 15_000);
    function finish(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error); else resolve(value);
    }
    worker.onmessage = event => event.data?.error ? finish(new Error(event.data.error)) :
      finish(null, event.data?.rows);
    worker.onerror = () => finish(new Error('The scheme disclosure preview failed in this browser.'));
    worker.postMessage(file);
  });
  const result = parseFundDisclosureRows(rows);
  if (result.errors.length) throw new Error(result.errors[0]);
  return result.disclosure;
}
