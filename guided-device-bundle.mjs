import { disclosureSchemeKey, matchFundDisclosure } from './fund-disclosure.mjs?v=da01a4be5c8f';
import { parseReviewBackup } from './review-backup.mjs?v=da01a4be5c8f';

const ISIN = /^[A-Z]{2}[A-Z0-9]{10}$/;
const disclosureKeys = 'amc|asOf|coveredPct|notIncludedPct|scheme|scope|securities';
const securityKeys = 'isin|name|weightPct';
const exact = (value, keys) => value && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).sort().join('|') === keys;
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const dateValid = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > indiaToday()) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const textValid = (value, max) => typeof value === 'string' && value.length >= 1 &&
  value.length <= max && !/[\u0000-\u001f]/.test(value) && value.trim() === value;
const percentValid = value => typeof value === 'number' && Number.isFinite(value) &&
  value >= 0 && value <= 100;

function validDisclosure(item, holdings) {
  if (!exact(item, disclosureKeys) || !textValid(item.scheme, 110) ||
      !['Motilal Oswal', 'PPFAS', 'Groww', 'HDFC'].includes(item.amc) ||
      !dateValid(item.asOf) || item.scope !== 'listed_equity' ||
      !percentValid(item.coveredPct) || item.coveredPct <= 0 ||
      !percentValid(item.notIncludedPct) ||
      Math.abs(item.coveredPct + item.notIncludedPct - 100) > 0.01 ||
      !Array.isArray(item.securities) || !item.securities.length || item.securities.length > 400 ||
      !matchFundDisclosure(item, holdings)) return false;
  const seen = new Set();
  let sum = 0;
  for (const row of item.securities) {
    if (!exact(row, securityKeys) || !textValid(row.name, 160) ||
        typeof row.isin !== 'string' || !ISIN.test(row.isin) || seen.has(row.isin) ||
        !percentValid(row.weightPct) || row.weightPct <= 0) return false;
    seen.add(row.isin);
    sum += row.weightPct;
  }
  return Math.abs(sum - item.coveredPct) <= 0.02;
}

/** Only normalized scheme weights go into the optional encrypted device copy. */
export function buildGuidedDeviceBundle(portfolio, disclosures = []) {
  const supported = disclosures.filter(item => validDisclosure(item, portfolio?.holdings || []))
    .slice(0, 5).map(item => ({ scheme: item.scheme, amc: item.amc,
      asOf: item.asOf, scope: item.scope, coveredPct: item.coveredPct,
      notIncludedPct: item.notIncludedPct,
      securities: item.securities.map(row => ({ name: row.name, isin: row.isin,
        weightPct: row.weightPct })) }));
  return JSON.stringify({ kind: 'guided-device-review', version: 1, portfolio,
    disclosures: supported });
}

/** A user-requested encrypted save must never silently omit checked evidence. */
export function buildCompleteGuidedDeviceBundle(portfolio, disclosures = []) {
  const plain = buildGuidedDeviceBundle(portfolio, disclosures);
  const parsed = parseGuidedDeviceBundle(plain);
  if (parsed.errors.length || parsed.disclosures.length !== disclosures.length)
    throw new Error('Some checked fund disclosures or review details could not be included. Check the review before saving again.');
  return plain;
}

/** Accept older encrypted portfolio-only records and reject unrecognized private fields. */
export function parseGuidedDeviceBundle(plain) {
  let document;
  try { document = JSON.parse(plain); }
  catch { return { portfolio: null, disclosures: [], errors: ['The saved review is damaged or uses an unsupported format.'] }; }
  if (!document || document.kind !== 'guided-device-review') {
    const legacy = parseReviewBackup(plain);
    return { portfolio: legacy.portfolio, disclosures: [], errors: legacy.errors };
  }
  const invalid = { portfolio: null, disclosures: [],
    errors: ['The saved review is damaged or uses an unsupported format.'] };
  if (!exact(document, 'disclosures|kind|portfolio|version') || document.version !== 1 ||
      !Array.isArray(document.disclosures) || document.disclosures.length > 5) return invalid;
  const parsed = parseReviewBackup(JSON.stringify(document.portfolio));
  if (parsed.errors.length) return invalid;
  const seen = new Set();
  for (const item of document.disclosures) {
    if (!validDisclosure(item, parsed.portfolio.holdings)) return invalid;
    const key = disclosureSchemeKey(item);
    if (seen.has(key)) return invalid;
    seen.add(key);
  }
  return { portfolio: parsed.portfolio, disclosures: document.disclosures, errors: [] };
}
