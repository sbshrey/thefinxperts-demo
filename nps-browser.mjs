/** Read an investor-selected NPS transaction statement in a disposable browser worker. */
export async function previewNpsStatement(file, password = '') {
  if (!file || !/\.pdf$/i.test(file.name) || file.size < 5 || file.size > 15_000_000)
    return { holding: null, errors: ['Choose an NPS transaction-statement PDF smaller than 15 MB.'] };
  const bytes = await file.arrayBuffer();
  return new Promise(resolve => {
    const worker = new Worker(new URL('./nps-browser-worker.mjs?v=0b4c00b40d26', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ holding: null,
      errors: ['This NPS statement took too long to read. No holding was added.'] }), 30_000);
    worker.onmessage = event => {
      if (event.data?.kind === 'nps-result') finish(event.data);
    };
    worker.onerror = () => finish({ holding: null,
      errors: ['This NPS statement could not be read in this browser. No holding was added.'] });
    worker.postMessage({ bytes, password }, [bytes]);
  });
}
