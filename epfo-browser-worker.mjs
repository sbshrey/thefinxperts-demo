import * as pdfjs from './vendor/pdfjs/pdf.mjs?v=281711f6ba37';
import { parseEpfoPassbookPages } from './epfo-passbook.mjs?v=281711f6ba37';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs?v=281711f6ba37', import.meta.url).href;

self.onmessage = async event => {
  const bytes = event.data?.bytes;
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 5 || bytes.byteLength > 15_000_000) {
    self.postMessage({ kind: 'epfo-result', holding: null, errors: ['Choose an EPF passbook PDF smaller than 15 MB.'] });
    return;
  }
  let document;
  try {
    document = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false,
      disableFontFace: true, useSystemFonts: true }).promise;
    if (document.numPages > 30) {
      self.postMessage({ kind: 'epfo-result', holding: null, errors: ['This EPF passbook is too long to review. No holding was added.'] });
      return;
    }
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      pages.push((await page.getTextContent()).items.filter(item => 'str' in item).map(item => item.str));
    }
    self.postMessage({ kind: 'epfo-result', ...await parseEpfoPassbookPages(pages) });
  } catch {
    self.postMessage({ kind: 'epfo-result', holding: null, errors: [
      'This EPF passbook could not be read safely. No holding was added.',
    ] });
  } finally {
    try { await document?.destroy(); } catch { /* The result remains authoritative. */ }
  }
};
