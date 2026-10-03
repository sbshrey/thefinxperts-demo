import * as pdfjs from './vendor/pdfjs/pdf.mjs?v=b5fcac58766a';
import { createPdfjsBackend } from './vendor/casparser-js/src/pdf/pdfjs.js?v=b5fcac58766a';
import { readCasPdf } from './vendor/casparser-js/src/parsers/index.js?v=b5fcac58766a';
import { normalizeBrowserCasResult } from './cas-browser-result.mjs?v=b5fcac58766a';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs?v=b5fcac58766a', import.meta.url).href;

self.onmessage = async event => {
  const { bytes, password } = event.data || {};
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 5 || bytes.byteLength > 15_000_000 ||
      typeof password !== 'string' || password.length > 200) {
    self.postMessage({ kind: 'cas-result', holdings: [], errors: ['Choose an original CAS PDF smaller than 15 MB.'] });
    return;
  }
  try {
    const raw = await readCasPdf(new Uint8Array(bytes), password, { output: 'json',
      backend: createPdfjsBackend(pdfjs, { documentOptions: {
        isEvalSupported: false, disableFontFace: true, useSystemFonts: true,
      } }) });
    const parsed = JSON.parse(raw);
    self.postMessage(normalizeBrowserCasResult(parsed));
  } catch (error) {
    self.postMessage({ kind: 'cas-result', holdings: [], errors: [error?.name === 'IncorrectPasswordError' ?
      'That password did not open this CAS PDF.' :
      'This PDF could not be safely read as a supported original CAS. No holdings were added. If it is NPS or an unsupported EPF statement, check its latest balance and date and describe that as an Other investment in chat.'] });
  }
};
