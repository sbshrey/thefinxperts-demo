importScripts('./vendor/read-excel-file/read-excel-file.min.js?v=a5371f1602a3');

self.onmessage = async event => {
  try {
    const workbook = await self.readXlsxFile(event.data);
    const rows = Array.isArray(workbook?.[0]?.data) ? workbook[0].data : workbook;
    if (!Array.isArray(rows) || rows.length > 500 || rows.some(row => !Array.isArray(row) || row.length > 80))
      throw new Error('Workbook dimensions are too large.');
    self.postMessage({ rows });
  } catch {
    self.postMessage({ error: 'The workbook could not be read. Use a small, unencrypted XLSX holdings report.' });
  }
};
