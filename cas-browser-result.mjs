import { normalizeCasHoldings } from './cas-adapter.mjs?v=7774f5b16bc3';

/** Keep only reviewed holdings, derived returns and count-safe messages across the worker boundary. */
export function normalizeBrowserCasResult(parsed) {
  if (!['CAMS', 'KFINTECH', 'NSDL', 'CDSL'].includes(parsed?.file_type))
    return { kind: 'cas-result', holdings: [], errors: [
      'This browser import supports original CAMS, KFintech, NSDL or CDSL CAS PDFs only.',
    ] };
  const normalized = normalizeCasHoldings(parsed);
  return { kind: 'cas-result', source: normalized.source ||
    (['NSDL', 'CDSL'].includes(parsed.file_type) ? 'Demat CAS' : 'CAS'),
    holdings: normalized.holdings, errors: normalized.errors,
    notices: normalized.notices, combinedRows: normalized.combinedRows,
    ownershipUnverified: normalized.ownershipUnverified === true,
    performance: normalized.performance };
}
