import { importValueAndDates } from './assistant-import-audit.mjs?v=ee09fedbeb53';
import { validatedStatementSipSummary } from './cas-performance.mjs?v=ee09fedbeb53';

const ALLOWED_ASSETS = new Set(['Equity', 'Debt', 'Gold', 'Other']);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today()) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/** Accept only the normalized, identity-free result from the private CAS endpoint. */
export function prepareAssistantCasDrafts(result, { local = false, browser = false } = {}) {
  if (!result || !Array.isArray(result.holdings) || !Array.isArray(result.errors) || result.errors.length)
    return { drafts: [], errors: result?.errors?.length ? result.errors.slice(0, 5) : ['The CAS preview was incomplete.'] };
  if (result.source != null && !['CAS', 'Demat CAS'].includes(result.source))
    return { drafts: [], errors: ['The CAS preview source was not recognized.'] };
  if (!result.holdings.length) return { drafts: [], errors: ['No current fund or stock holdings were found in this CAS.'] };
  const maxDrafts = browser ? 200 : 30;
  if (result.holdings.length > maxDrafts)
    return { drafts: [], handoffSource: 'cas', errors: [`This chat can confirm up to ${maxDrafts} CAS holdings at once. Open the detailed review to inspect this larger statement.`] };
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
  const combined = Number.isInteger(result.combinedRows) && result.combinedRows > 0 &&
    result.combinedRows <= 500 ? ` ${result.combinedRows} matching folio ${result.combinedRows === 1 ? 'row was' : 'rows were'} combined by exact ISIN and valuation details; check the total against your CAS.` : '';
  const ownership = result.ownershipUnverified === true ?
    origin === 'demat_cas' ?
      ' The parsed CAS does not establish an owner PAN for one or more demat accounts. Check account ownership in the original statement before confirming these rows.' :
      ' One or more folios do not print an owner PAN. Check ownership in the original statement before confirming these rows.' : '';
  const performance = [];
  if (result.source !== 'Demat CAS' && Array.isArray(result.performance)) {
    const positions = new Map();
    for (const [index, holding] of result.holdings.entries()) {
      if (typeof holding.id === 'string')
        positions.set(holding.id, positions.has(holding.id) ? null : index);
    }
    const seen = new Set();
    for (const item of result.performance) {
      if (!item || typeof item.id !== 'string' || seen.has(item.id) ||
          !Number.isFinite(item.annualPercent) || item.annualPercent < -99.9 ||
          item.annualPercent > 1000) continue;
      const index = positions.get(item.id);
      if (index === undefined || index === null) continue;
      seen.add(item.id);
      performance.push({ index, annualPercent: item.annualPercent });
    }
  }
  const sip = result.source !== 'CAS' || result.ownershipUnverified === true ? null :
    validatedStatementSipSummary(result.sipSummary);
  const sipMessage = sip ?
      `This detailed CAS explicitly marks ${sip.count} SIP purchase ${sip.count === 1 ? 'entry' : 'entries'} totalling ₹${sip.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from ${sip.from} to ${sip.to}; the latest marked entry is ${sip.latestDate}. These are statement-period purchases, not proof of an active mandate, bank debits or complete SIP history. This total is a preview only and is not saved with holdings.` : '';
  return { drafts, errors: [], performance, sipSummary: sip, sipMessage, message: `Found ${drafts.length} possible holding${drafts.length === 1 ? '' : 's'} in the ${origin === 'demat_cas' ? 'demat' : 'mutual-fund'} CAS. ${importValueAndDates(drafts)} Only positive current positions were staged; compare the parsed value with your statement total. The supported CAS reader did not provide a statement grand total.${combined}${ownership} ${performance.length ? ` ${performance.length} of ${drafts.length} schemes have an indicative statement-period XIRR in the unconfirmed row preview. It uses supported reconciled cash flows and the statement's dated valuation, not a live price or forecast. The rate disappears after a row edit and is not saved with holdings.` : ''}${sipMessage ? ` ${sipMessage}` : ''} ${browser ? 'This browser tab read the PDF and password; neither was sent to a server.' : `The ${local ? 'loopback server on this computer' : 'signed-in server'} read the PDF and password for this request; neither is saved by this preview.`} Check the rows before confirming.${browser ? '' : ' If you later ask AI about these drafts, their names and values may be sent.'}` };
}
