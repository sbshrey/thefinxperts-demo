const ALLOWED_ASSETS = new Set(['Equity', 'Debt', 'Gold', 'Other']);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today()) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/** Accept only the normalized, identity-free result from the private CAS endpoint. */
export function prepareAssistantCasDrafts(result, { local = false } = {}) {
  if (!result || !Array.isArray(result.holdings) || !Array.isArray(result.errors) || result.errors.length)
    return { drafts: [], errors: result?.errors?.length ? result.errors.slice(0, 5) : ['The CAS preview was incomplete.'] };
  if (result.source != null && !['CAS', 'Demat CAS'].includes(result.source))
    return { drafts: [], errors: ['The CAS preview source was not recognized.'] };
  if (!result.holdings.length) return { drafts: [], errors: ['No current fund or stock holdings were found in this CAS.'] };
  if (result.holdings.length > 30)
    return { drafts: [], errors: ['This chat can confirm up to 30 CAS holdings at once. Use the guided import on the main page for a larger statement.'] };
  const origin = result.source === 'Demat CAS' ? 'demat_cas' : 'cas';
  const drafts = [];
  for (const row of result.holdings) {
    if (!row || typeof row.name !== 'string' || row.name.trim().length < 2 || row.name.trim().length > 80 ||
        !Number.isFinite(row.value) || row.value <= 0 || row.value > 10_000_000_000 ||
        !validDate(row.asOf) ||
        ![null, 'Mutual fund', 'Stock'].includes(row.type) ||
        !(row.asset === null || ALLOWED_ASSETS.has(row.asset)) ||
        (row.type === 'Stock' && row.asset !== 'Equity') ||
        (row.isin && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isin)) ||
        (row.amfi && !/^\d{5,8}$/.test(row.amfi)) ||
        (row.amc && (typeof row.amc !== 'string' || row.amc.length > 200)) ||
        (row.units && (typeof row.units !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(row.units)))) {
      return { drafts: [], errors: ['A CAS holding needs a supported name, dated value and classification. Use the guided import to inspect it.'] };
    }
    drafts.push({ name: row.name.trim(), type: row.type || 'Other', asset: row.asset || 'Other',
      value: row.value, asOf: row.asOf, entryOrigin: origin,
      ...(row.isin ? { isin: row.isin } : {}), ...(row.amc ? { amc: row.amc } : {}),
      ...(row.amfi ? { amfi: row.amfi } : {}), ...(row.units ? { units: row.units } : {}) });
  }
  return { drafts, errors: [], message: `Found ${drafts.length} possible holding${drafts.length === 1 ? '' : 's'} in the ${origin === 'demat_cas' ? 'demat' : 'mutual-fund'} CAS. The ${local ? 'loopback server on this computer' : 'signed-in server'} read the PDF and password for this request; neither is saved by this preview. Check the rows before confirming. If you later ask AI about these drafts, their names and values may be sent.` };
}
