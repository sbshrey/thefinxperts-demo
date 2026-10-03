importScripts('./vendor/read-excel-file/read-excel-file.min.js?v=b5fcac58766a');

self.onmessage = async event => {
  try {
    const workbook = await self.readXlsxFile(event.data);
    if (!Array.isArray(workbook) || workbook.length !== 1 ||
        !Array.isArray(workbook[0]?.data))
      throw new Error('Choose one scheme in a single-sheet workbook.');
    const rows = workbook[0].data;
    if (rows.length > 1000 || rows.some(row => !Array.isArray(row) || row.length > 80))
      throw new Error('The scheme disclosure exceeds the browser preview limit.');
    self.postMessage({ rows });
  } catch (error) {
    self.postMessage({ error: error.message === 'Choose one scheme in a single-sheet workbook.' ||
      error.message === 'The scheme disclosure exceeds the browser preview limit.' ? error.message :
      'The scheme disclosure workbook could not be read safely.' });
  }
};
