import { checkXlsxArchive } from './broker-xlsx.mjs?v=bdc3c5a41d5b';

/** Parse an investor-selected workbook in a short-lived worker, without uploading it. */
export async function readBrokerWorkbook(file) {
  if (!file || !file.name.toLowerCase().endsWith('.xlsx') || file.size > 2_000_000)
    throw new Error('Choose an XLSX holdings report smaller than 2 MB.');
  checkXlsxArchive(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./broker-xlsx-worker.js?v=bdc3c5a41d5b', import.meta.url));
    const timer = setTimeout(() => finish(new Error('The workbook preview timed out.')), 15_000);
    let complete = false;
    function finish(error, rows) {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error); else resolve(rows);
    }
    worker.onmessage = event => event.data?.error ? finish(new Error(event.data.error)) : finish(null, event.data?.rows);
    worker.onerror = () => finish(new Error('The workbook preview failed in this browser.'));
    worker.postMessage(file);
  });
}
