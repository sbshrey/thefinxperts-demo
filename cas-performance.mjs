/** Indicative money-weighted return for a single reconciled, detailed CAS scheme.
 * Transaction descriptions and amounts never leave this calculation boundary.
 */
export function statementXirr(scheme) {
  if (typeof scheme?.open !== 'string' || !/^0(?:\.0+)?$/.test(scheme.open) ||
      !Array.isArray(scheme.transactions) || !scheme.transactions.length || scheme.transactions.length > 5000) return null;
  const valuedOn = day(scheme.valuation?.date);
  const value = positiveAmount(scheme.valuation?.value);
  const closingUnits = signedUnits(scheme.close);
  if (valuedOn === null || value === null || closingUnits === null || closingUnits <= 0n) return null;
  const flows = [];
  let calculatedUnits = 0n;
  for (const transaction of scheme.transactions) {
    const date = day(transaction?.date);
    if (date === null || date > valuedOn) return null;
    const amount = positiveAmount(transaction.amount);
    switch (transaction.type) {
      case 'PURCHASE':
      case 'PURCHASE_SIP':
        if (amount === null || !(signedUnits(transaction.units) > 0n)) return null;
        calculatedUnits += signedUnits(transaction.units);
        flows.push({ date, amount: -amount });
        break;
      case 'REDEMPTION':
        if (amount === null || !(signedUnits(transaction.units) < 0n)) return null;
        calculatedUnits += signedUnits(transaction.units);
        flows.push({ date, amount });
        break;
      case 'DIVIDEND_PAYOUT':
        if (amount === null || transaction.units != null && Number(transaction.units) !== 0) return null;
        flows.push({ date, amount });
        break;
      case 'STAMP_DUTY_TAX':
        if (amount === null || transaction.units != null && Number(transaction.units) !== 0) return null;
        flows.push({ date, amount: -amount });
        break;
      case 'DIVIDEND_REINVEST':
        // No external investor cash flow; its new units are included in terminal value.
        if (amount === null || !(signedUnits(transaction.units) > 0n)) return null;
        calculatedUnits += signedUnits(transaction.units);
        break;
      default:
        return null; // Switches, gifts, other taxes and unknown rows need separate reconciliation.
    }
  }
  if (calculatedUnits !== closingUnits) return null;
  flows.push({ date: valuedOn, amount: value });
  flows.sort((a, b) => a.date - b.date);
  const start = flows[0].date;
  if (valuedOn - start < 30 || !flows.some(flow => flow.amount < 0) ||
      !flows.some(flow => flow.amount > 0)) return null;
  const npv = logRate => flows.reduce((sum, flow) =>
    sum + flow.amount * Math.exp(-logRate * (flow.date - start) / 365), 0);
  // Search a bounded rate range and withhold ambiguous or extreme roots.
  const min = Math.log(0.001), max = Math.log(11);
  const brackets = [];
  let left = min, leftValue = npv(left);
  for (let index = 1; index <= 800; index++) {
    const right = min + (max - min) * index / 800;
    const rightValue = npv(right);
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return null;
    if (leftValue === 0 || leftValue * rightValue < 0 || rightValue === 0) brackets.push([left, right]);
    left = right; leftValue = rightValue;
  }
  if (brackets.length !== 1) return null;
  let [lo, hi] = brackets[0];
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const annualPercent = Math.expm1((lo + hi) / 2) * 100;
  return Number.isFinite(annualPercent) ? Math.round(annualPercent * 100) / 100 : null;
}

/** Only purchases explicitly marked SIP within a detailed CAS period; no mandate inference. */
export function statementSipPurchases(document, today = new Date()) {
  if (document?.cas_type !== 'DETAILED' ||
      !['CAMS', 'KFINTECH'].includes(document.file_type) ||
      !Array.isArray(document.folios)) return null;
  const from = document.statement_period?.from;
  const to = document.statement_period?.to;
  const firstDay = day(from);
  const lastDay = day(to);
  const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  if (firstDay === null || lastDay === null || firstDay > lastDay || to > indiaToday) return null;
  let inspected = 0;
  let count = 0;
  let totalPaise = 0n;
  let latestDate = null;
  for (const folio of document.folios) {
    if (!Array.isArray(folio?.schemes)) return null;
    for (const scheme of folio.schemes) {
      if (!Array.isArray(scheme?.transactions)) return null;
      inspected += scheme.transactions.length;
      if (inspected > 2000) return null;
      for (const transaction of scheme.transactions) {
        if (transaction?.type !== 'PURCHASE_SIP') continue;
        const date = day(transaction.date);
        const amount = positivePaise(transaction.amount);
        if (date === null || date < firstDay || date > lastDay || amount === null ||
            !(signedUnits(transaction.units) > 0n)) return null;
        totalPaise += amount;
        if (totalPaise > 100_000_000_000_000n) return null;
        count++;
        if (latestDate === null || transaction.date > latestDate) latestDate = transaction.date;
      }
    }
  }
  return count ? { from, to, latestDate, count, total: Number(totalPaise) / 100 } : null;
}

/** Recheck the identity-free aggregate when it crosses a browser or answer boundary. */
export function validatedStatementSipSummary(value, today = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'count,from,latestDate,to,total' ||
      day(value.from) === null || day(value.to) === null || day(value.latestDate) === null ||
      value.from > value.latestDate || value.latestDate > value.to ||
      value.to > new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10) ||
      !Number.isInteger(value.count) || value.count < 1 || value.count > 2000 ||
      typeof value.total !== 'number' || !Number.isFinite(value.total) ||
      value.total < 0.01 || value.total > 1_000_000_000_000 ||
      Math.abs(value.total * 100 - Math.round(value.total * 100)) > 0.01) return null;
  return { from: value.from, to: value.to, latestDate: value.latestDate,
    count: value.count, total: value.total };
}

function positivePaise(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return paise > 0n && paise <= 100_000_000_000_000n ? paise : null;
}

function positiveAmount(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) ||
      /[1-9]/.test((value.split('.')[1] || '').slice(2))) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 1e12 ? amount : null;
}

function signedUnits(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value) ||
      /[1-9]/.test((value.split('.')[1] || '').slice(6))) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, '0') || '0');
  return negative ? -units : units;
}

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date.valueOf() / 86_400_000;
}
