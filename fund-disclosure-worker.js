importScripts('./vendor/read-excel-file/read-excel-file.min.js?v=3ce860de2534');

const schemeName = value => String(value ?? '').trim().replace(/^IB\d{2}-/i, '')
  .replace(/\s*[-–—]\s*(?:direct|regular)\s+plan\b.*$/i, '')
  .replace(/\s+(?:direct|regular)\s+plan\b.*$/i, '')
  .replace(/\s*[-–—]\s*(?:growth|idcw)(?:\s+option)?\s*$/i, '')
  .replace(/&/g, ' and ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

self.onmessage = async event => {
  try {
    const workbook = await self.readXlsxFile(event.data?.file);
    if (!Array.isArray(workbook) || !workbook.length || workbook.length > 70)
      throw new Error('Choose a supported scheme workbook with at most 70 tabs.');
    let totalRows = 0;
    for (const sheet of workbook) {
      if (!Array.isArray(sheet?.data) || sheet.data.length > 1000 ||
          sheet.data.some(row => !Array.isArray(row) || row.length > 80))
        throw new Error('The scheme disclosure exceeds the browser preview limit.');
      totalRows += sheet.data.length;
    }
    if (totalRows > 15000)
      throw new Error('The scheme disclosure exceeds the browser preview limit.');
    if (workbook.length === 1) {
      self.postMessage({ sheets: [{ name: workbook[0].sheet, rows: workbook[0].data }], multiSheet: false });
      return;
    }
    const codes = new Set();
    const groww = workbook.every(sheet => {
      if (sheet.sheet === 'XDO_METADATA') return true;
      const title = String(sheet.data?.[0]?.[1] ?? '').trim();
      const match = /^(IB\d{2})-Groww\s+.{3,110}$/i.exec(title);
      if (!match || sheet.sheet !== match[1] || codes.has(match[1])) return false;
      codes.add(match[1]);
      return true;
    });
    if (!groww || !codes.size) throw new Error('Choose one supported scheme or an official Groww monthly workbook.');
    const targetNames = new Set((event.data?.targetNames || []).map(schemeName));
    const selected = workbook.filter(sheet => sheet.sheet !== 'XDO_METADATA' &&
      targetNames.has(schemeName(sheet.data[0][1])));
    if (!selected.length)
      throw new Error('The Groww monthly workbook has no exact scheme match in your confirmed fund holdings. Check the fund names and AMC first.');
    if (selected.length > 5)
      throw new Error('This workbook matches more than five confirmed schemes. Review at most five at a time.');
    self.postMessage({ sheets: selected.map(sheet => ({ name: sheet.sheet, rows: sheet.data })), multiSheet: true });
  } catch (error) {
    const known = /^(?:The Groww monthly workbook|This workbook matches|Choose a supported scheme workbook|Choose one supported scheme|The scheme disclosure exceeds)/.test(error.message || '');
    self.postMessage({ error: known ? error.message :
      'The scheme disclosure workbook could not be read safely.', disclosureWorkbook: known });
  }
};
