import * as pdfjs from './vendor/pdfjs/pdf.mjs';
import { createPdfjsBackend } from './vendor/casparser-js/src/pdf/pdfjs.js';
import { readCasPdf } from './vendor/casparser-js/src/parsers/index.js';
import { normalizeCasHoldings } from './cas-adapter.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

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
    if (!['CAMS', 'KFINTECH'].includes(parsed.file_type)) {
      self.postMessage({ kind: 'cas-result', holdings: [], errors: ['This browser import currently supports original CAMS or KFintech mutual-fund CAS PDFs.'] });
      return;
    }
    const normalized = normalizeCasHoldings(parsed);
    self.postMessage({ kind: 'cas-result', source: 'CAS', holdings: normalized.holdings,
      errors: normalized.errors, notices: normalized.notices, combinedRows: normalized.combinedRows });
  } catch (error) {
    self.postMessage({ kind: 'cas-result', holdings: [], errors: [error?.name === 'IncorrectPasswordError' ?
      'That password did not open this CAS PDF.' :
      'This PDF could not be safely read as an original CAMS or KFintech CAS. No holdings were added.'] });
  }
};
