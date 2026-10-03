/** Parse a supported original CAS inside a bounded, disposable browser worker. */
export async function previewBrowserCas(file, password = '') {
  if (!file || !/\.pdf$/i.test(file.name) || file.size < 5 || file.size > 15_000_000)
    return { holdings: [], errors: ['Choose an original CAS PDF smaller than 15 MB.'] };
  if (typeof password !== 'string' || password.length > 200)
    return { holdings: [], errors: ['Check the CAS PDF password.'] };
  const bytes = await file.arrayBuffer();
  return new Promise(resolve => {
    const worker = new Worker(new URL('./cas-browser-worker.mjs?v=a76a80c45627', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ holdings: [], errors: [
      'This CAS took too long to read in the browser. No holdings were added.',
    ] }), 45_000);
    worker.onmessage = event => {
      if (event.data?.kind === 'cas-result') finish(event.data);
    };
    worker.onerror = () => finish({ holdings: [], errors: [
      'This CAS could not be read in the browser. No holdings were added.',
    ] });
    worker.postMessage({ bytes, password }, [bytes]);
  });
}
