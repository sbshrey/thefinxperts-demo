import * as pdfjs from './vendor/pdfjs/pdf.mjs?v=da200429ed44';
import { parseNpsStatementPages } from './nps-statement.mjs?v=da200429ed44';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs?v=da200429ed44', import.meta.url).href;

self.onmessage = async event => {
  const bytes = event.data?.bytes;
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 5 || bytes.byteLength > 15_000_000) {
    self.postMessage({ kind: 'nps-result', holding: null,
      errors: ['Choose an NPS transaction-statement PDF smaller than 15 MB.'] });
    return;
  }
  let document;
  try {
    document = await pdfjs.getDocument({ data: new Uint8Array(bytes),
      password: typeof event.data?.password === 'string' ? event.data.password : '', isEvalSupported: false,
      disableFontFace: true, useSystemFonts: true }).promise;
    if (document.numPages > 50) {
      self.postMessage({ kind: 'nps-result', holding: null,
        errors: ['This NPS statement is too long to review. No holding was added.'] });
      return;
    }
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      pages.push((await page.getTextContent()).items.filter(item => 'str' in item).map(item => item.str));
    }
    self.postMessage({ kind: 'nps-result', ...await parseNpsStatementPages(pages) });
  } catch {
    self.postMessage({ kind: 'nps-result', holding: null,
      errors: ['This NPS statement could not be read safely. No holding was added.'] });
  } finally {
    try { await document?.destroy(); } catch { /* The result remains authoritative. */ }
  }
};
