/** Read an investor-selected EPFO member passbook entirely in a disposable browser worker. */
export async function previewEpfoPassbook(file) {
  if (!file || !/\.pdf$/i.test(file.name) || file.size < 5 || file.size > 15_000_000)
    return { holding: null, errors: ['Choose an EPF passbook PDF smaller than 15 MB.'] };
  const bytes = await file.arrayBuffer();
  return new Promise(resolve => {
    const worker = new Worker(new URL('./epfo-browser-worker.mjs?v=b091de30402b', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ holding: null, errors: [
      'This EPF passbook took too long to read. No holding was added.',
    ] }), 30_000);
    worker.onmessage = event => {
      if (event.data?.kind === 'epfo-result') finish(event.data);
    };
    worker.onerror = () => finish({ holding: null, errors: [
      'This EPF passbook could not be read in this browser. No holding was added.',
    ] });
    worker.postMessage({ bytes }, [bytes]);
  });
}
