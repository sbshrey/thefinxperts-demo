/**
 * Convert the documented casparser CASData shape to the small holdings model.
 * This boundary deliberately drops investor, PAN, folio, nominee and transaction data.
 * No PDF is parsed here; callers must use a separately verified CAS PDF parser.
 */
import { statementXirr } from './cas-performance.mjs?v=c1abbdc26b7f';
import { normalizeDematHoldings } from './demat-adapter.mjs?v=c1abbdc26b7f';

const MAX_PREVIEW_PERFORMANCE_TRANSACTIONS = 2000;

export function normalizeCasHoldings(document) {
  if (['NSDL', 'CDSL'].includes(document?.file_type)) return normalizeDematHoldings(document);
  const errors = [];
  const notices = [];
  const performance = [];
  if (!document || !['CAMS', 'KFINTECH'].includes(document.file_type) ||
      !['DETAILED', 'SUMMARY'].includes(document.cas_type) || !Array.isArray(document.folios)) {
    return { holdings: [], errors: ['This is not a supported CAMS or KFintech CAS result.'], notices, performance };
  }
  if (!Array.isArray(document.parse_warnings)) {
    return { holdings: [], errors: ['The parser did not report a reconciliation status.'], notices, performance };
  }
  if (document.parse_warnings.length) {
    return { holdings: [], errors: ['The CAS parser reported unit-balance warnings. Check the original statement before importing.'], notices, performance };
  }
  const ownerPans = new Set();
  const folioOwnerPans = [];
  for (const folio of document.folios) {
    if (folio?.PAN == null || typeof folio.PAN === 'string' && !folio.PAN.trim()) {
      folioOwnerPans.push(null);
      continue;
    }
    if (typeof folio.PAN !== 'string' || !/^[A-Z]{5}\d{4}[A-Z]$/.test(folio.PAN.trim().toUpperCase())) {
      return { holdings: [], errors: ['A folio owner identifier could not be checked. No holdings were imported.'], notices, performance };
    }
    const ownerPan = folio.PAN.trim().toUpperCase();
    folioOwnerPans.push(ownerPan);
    ownerPans.add(ownerPan);
    if (ownerPans.size > 1) {
      return { holdings: [], errors: ['This CAS contains folios with different owner PANs. Use a separate review for each investor; no holdings were imported.'], notices, performance };
    }
  }
  const ownershipUnverified = document.folios.length > 1 && folioOwnerPans.some(pan => !pan);
  if (ownershipUnverified)
    notices.push('One or more folios do not print an owner PAN. Check ownership in the original statement before adding these holdings.');
  if (document.cas_type === 'SUMMARY') {
    notices.push('This summary statement contains a holdings snapshot; transaction history and performance cannot be verified from it.');
  }

  const holdings = [];
  const byIsin = new Map();
  const aggregatedIds = new Set();
  let schemeCount = 0;
  let combinedRows = 0;
  let performanceTransactions = 0;
  let performanceBudgetExceeded = false;
  for (const [folioIndex, folio] of document.folios.entries()) {
    if (!folio || !Array.isArray(folio.schemes)) {
      errors.push(`Folio ${folioIndex + 1}: scheme list is missing.`);
      continue;
    }
    for (const [schemeIndex, scheme] of folio.schemes.entries()) {
      schemeCount++;
      const location = `Folio ${folioIndex + 1}, scheme ${schemeIndex + 1}`;
      if (schemeCount > 500) {
        errors.push('This CAS contains more than 500 schemes; import is stopped for review.');
        break;
      }
      const name = typeof scheme?.scheme === 'string' ? scheme.scheme.trim() : '';
      const units = parseDecimal(scheme?.close, 6);
      const calculated = parseDecimal(scheme?.close_calculated, 6);
      const valuePaise = parseDecimal(scheme?.valuation?.value, 2);
      const navScaled = parseDecimal(scheme?.valuation?.nav, 6);
      const asOf = scheme?.valuation?.date;
      if (!name || name.length > 200 || units === null || units < 0n ||
          valuePaise === null || valuePaise < 0n || valuePaise > 1_000_000_000_000n || !isRealIsoDate(asOf)) {
        errors.push(`${location}: name, closing units, valuation or date is invalid.`);
        continue;
      }
      if (document.cas_type === 'DETAILED' && (calculated === null || units !== calculated)) {
        errors.push(`${location}: printed and calculated closing units do not match.`);
        continue;
      }
      if ((units === 0n) !== (valuePaise === 0n)) {
        errors.push(`${location}: closing units and valuation disagree about a zero balance.`);
        continue;
      }
      if (units === 0n) {
        notices.push(`${location}: zero-balance scheme was left out of the current-holdings view.`);
        continue;
      }
      if (navScaled === null || navScaled <= 0n) {
        errors.push(`${location}: NAV is missing or invalid for a current holding.`);
        continue;
      }
      const valueRupees = Number(valuePaise) / 100;
      const calculatedValue = Number(units) / 1_000_000 * Number(navScaled) / 1_000_000;
      if (!Number.isFinite(calculatedValue) ||
          Math.abs(calculatedValue - valueRupees) > Math.max(1, valueRupees * 0.001)) {
        errors.push(`${location}: closing units, NAV and reported value do not reconcile.`);
        continue;
      }
      const asset = classifyAsset(scheme.type);
      if (asset === 'Other') notices.push(`${location}: asset category is unclassified and shown as Other.`);
      const holding = {
        id: `cas-${folioIndex + 1}-${schemeIndex + 1}`,
        name,
        type: 'Mutual fund',
        amc: typeof folio.amc === 'string' && folio.amc.trim() ? folio.amc.trim() : null,
        asset,
        value: valueRupees,
        units: formatUnits(units),
        asOf,
        exposure: null,
        isin: validIsin(scheme.isin) ? scheme.isin : null,
        amfi: validAmfi(scheme.amfi) ? scheme.amfi : null,
      };
      let holdingId = holding.id;
      const previous = holding.isin ? byIsin.get(holding.isin) : null;
      if (previous) {
        if (previous.folioIndex !== folioIndex &&
            (!previous.ownerPan || !folioOwnerPans[folioIndex])) {
          errors.push(`${location}: repeated ISIN spans folios without a verified same owner. Use a detailed CAS or check separate account positions before importing.`);
          continue;
        }
        const same = value => value?.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ') || null;
        if (same(previous.row.name) !== same(holding.name) ||
            same(previous.row.amc) !== same(holding.amc) ||
            previous.row.asset !== holding.asset || previous.row.asOf !== holding.asOf ||
            previous.navScaled !== navScaled ||
            previous.row.amfi && holding.amfi && previous.row.amfi !== holding.amfi ||
            previous.valuePaise + valuePaise > 1_000_000_000_000n ||
            previous.units + units > BigInt(Number.MAX_SAFE_INTEGER)) {
          errors.push(`${location}: repeated ISIN has conflicting scheme or valuation details. Check the original folios before importing.`);
          continue;
        }
        previous.units += units;
        previous.valuePaise += valuePaise;
        previous.row.units = formatUnits(previous.units);
        previous.row.value = Number(previous.valuePaise) / 100;
        previous.row.amfi ||= holding.amfi;
        holdingId = previous.row.id;
        aggregatedIds.add(holdingId);
        combinedRows++;
      } else {
        holdings.push(holding);
        if (holding.isin) byIsin.set(holding.isin, { row: holding, units, valuePaise, navScaled,
          folioIndex, ownerPan: folioOwnerPans[folioIndex] });
      }
      if (document.cas_type === 'DETAILED') {
        const transactionCount = Array.isArray(scheme.transactions) ? scheme.transactions.length : 0;
        if (performanceTransactions + transactionCount > MAX_PREVIEW_PERFORMANCE_TRANSACTIONS) {
          performanceBudgetExceeded = true;
        } else {
          performanceTransactions += transactionCount;
          const annualPercent = statementXirr(scheme);
          if (annualPercent !== null) performance.push({ id: holdingId, annualPercent });
        }
      }
      if (!holding.isin) notices.push(`${location}: ISIN is missing or invalid; scheme matching will need review.`);
    }
    if (schemeCount > 500) break;
  }
  if (!schemeCount && !errors.length) errors.push('The CAS contains no schemes.');
  if (schemeCount && !holdings.length && !errors.length) notices.push('No nonzero holdings were found in this CAS.');
  if (combinedRows && !errors.length) notices.push(`${combinedRows} matching folio scheme ${combinedRows === 1 ? 'row was' : 'rows were'} combined by exact ISIN and matching valuation details. Separate folio returns are not shown as one return.`);
  const visiblePerformance = performance.filter(item => !aggregatedIds.has(item.id));
  if (document.cas_type === 'DETAILED' && holdings.length) {
    notices.push(`${visiblePerformance.length} of ${holdings.length} current schemes have enough simple, reconciled cash-flow history for an indicative statement-period money-weighted return. Unavailable returns stay unknown.`);
    if (performanceBudgetExceeded) notices.push('Some returns were left unavailable because the statement has too many transactions to calculate safely in this preview. Holdings are still shown.');
  }
  return { holdings: errors.length ? [] : holdings, errors, notices,
    combinedRows: errors.length ? 0 : combinedRows,
    ownershipUnverified,
    performance: errors.length ? [] : visiblePerformance };
}

function parseDecimal(value, places) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > places && /[1-9]/.test(fraction.slice(places))) return null;
  const scaled = BigInt(whole) * 10n ** BigInt(places) + BigInt((fraction.slice(0, places)).padEnd(places, '0') || '0');
  // Values beyond this limit cannot be displayed faithfully in the prototype.
  return scaled <= BigInt(Number.MAX_SAFE_INTEGER) ? scaled : null;
}

function formatUnits(scaled) {
  const whole = scaled / 1_000_000n;
  const fraction = (scaled % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function isRealIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function classifyAsset(value) {
  const category = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (category === 'EQUITY') return 'Equity';
  if (category === 'DEBT') return 'Debt';
  if (category === 'GOLD') return 'Gold';
  return 'Other';
}

function validIsin(value) { return typeof value === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(value); }
function validAmfi(value) { return typeof value === 'string' && /^\d{5,8}$/.test(value); }
