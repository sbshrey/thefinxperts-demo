import { parseActiveStatementHtml } from './active-statement.mjs?v=c1abbdc26b7f';

/** Accept the extracted HTML attachment or its enclosing PDF without sending either to a server. */
export async function previewActiveStatementFile(file, password = '') {
  if (!file) return { holdings: [], errors: ['Choose a CAMS Active Statement PDF or HTML attachment.'], notices: [] };
  if (/\.html?$/i.test(file.name)) {
    if (file.size > 10_000_000)
      return { holdings: [], errors: ['Choose a CAMS Active Statement HTML attachment smaller than 10 MB.'], notices: [] };
    try {
      const html = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, '');
      return parseActiveStatementHtml(html);
    } catch {
      return { holdings: [], errors: ['The HTML attachment could not be read as UTF-8.'], notices: [] };
    }
  }
  return previewActiveStatementPdf(file, password);
}

/** Read a CAMS Active Statement PDF attachment entirely in this browser tab. */
export async function previewActiveStatementPdf(file, password) {
  if (!file || file.size > 15_000_000 || !file.name.toLowerCase().endsWith('.pdf'))
    return { holdings: [], errors: ['Choose a CAMS Active Statement PDF smaller than 15 MB.'], notices: [] };
  const pdfjs = await import('./vendor/pdfjs/pdf.mjs?v=c1abbdc26b7f');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs?v=c1abbdc26b7f', import.meta.url).href;
  let document;
  try {
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password,
      disableFontFace: true, useSystemFonts: true });
    document = await task.promise;
    if (document.numPages > 100)
      return { holdings: [], errors: ['This PDF is too long for the browser preview.'], notices: [] };
    let attachmentCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: 'display' });
      for (const annotation of annotations) {
        if (annotation.subtype !== 'FileAttachment' || !annotation.file?.content) continue;
        attachmentCount++;
        if (attachmentCount > 20)
          return { holdings: [], errors: ['This PDF contains too many attachments to inspect.'], notices: [] };
        if (annotation.file.content.byteLength > 10_000_000) continue;
        let html;
        try { html = new TextDecoder('utf-8', { fatal: true }).decode(annotation.file.content).replace(/^\uFEFF/, ''); }
        catch { continue; }
        if (!/Your Mutual Fund Active Statement/i.test(html)) continue;
        return parseActiveStatementHtml(html);
      }
    }
    return { holdings: [], errors: ['No supported CAMS Active Statement HTML attachment was found in this PDF.'], notices: [] };
  } catch (error) {
    const message = error?.name === 'PasswordException' ? 'The PDF needs a different password.' :
      'The PDF could not be read as a CAMS Active Statement.';
    return { holdings: [], errors: [message], notices: [] };
  } finally {
    try { await document?.destroy(); } catch { /* The preview result remains authoritative. */ }
  }
}
