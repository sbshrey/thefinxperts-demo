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
  let previousDate = null;
  for (const transaction of scheme.transactions) {
    const date = day(transaction?.date);
    if (date === null || date > valuedOn || previousDate !== null && date < previousDate) return null;
    previousDate = date;
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
        if (calculatedUnits < 0n) return null;
        flows.push({ date, amount });
        break;
      case 'DIVIDEND_PAYOUT':
        if (amount === null || calculatedUnits <= 0n ||
            transaction.units != null && Number(transaction.units) !== 0) return null;
        flows.push({ date, amount });
        break;
      case 'STAMP_DUTY_TAX':
        if (amount === null || transaction.units != null && Number(transaction.units) !== 0) return null;
        flows.push({ date, amount: -amount });
        break;
      case 'DIVIDEND_REINVEST':
        // No external investor cash flow; its new units are included in terminal value.
        if (amount === null || calculatedUnits <= 0n ||
            !(signedUnits(transaction.units) > 0n)) return null;
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
const SIP_REVERSAL_RE = /\b(?:revers(?:al|ed)?|reject(?:ed|ion)?|dishonou?red|mismatch|fail(?:ed|ure)|cancel(?:l?ed|l?ation)|insufficient\s+balance|payment\s+not\s+received)\b/i;
const SIP_HINT_RE = /\bsip\b|systematic\s+invest|instal+ment/i;
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
  const byMonth = new Map();
  for (const folio of document.folios) {
    if (!Array.isArray(folio?.schemes)) return null;
    for (const scheme of folio.schemes) {
      if (!Array.isArray(scheme?.transactions)) return null;
      inspected += scheme.transactions.length;
      if (inspected > 2000) return null;
      for (const transaction of scheme.transactions) {
        if (typeof transaction?.description === 'string' &&
            SIP_REVERSAL_RE.test(transaction.description) &&
            (transaction.type === 'PURCHASE_SIP' ||
              transaction.type === 'REVERSAL' && SIP_HINT_RE.test(transaction.description))) return null;
        if (transaction?.type !== 'PURCHASE_SIP') continue;
        const date = day(transaction.date);
        const amount = positivePaise(transaction.amount);
        if (date === null || date < firstDay || date > lastDay || amount === null ||
            !(signedUnits(transaction.units) > 0n)) return null;
        totalPaise += amount;
        if (totalPaise > 100_000_000_000_000n) return null;
        count++;
        const month = transaction.date.slice(0, 7);
        const previous = byMonth.get(month) || { count: 0, paise: 0n };
        byMonth.set(month, { count: previous.count + 1, paise: previous.paise + amount });
        if (byMonth.size > 240) return null;
        if (latestDate === null || transaction.date > latestDate) latestDate = transaction.date;
      }
    }
  }
  const months = [...byMonth].sort(([left], [right]) => left.localeCompare(right))
    .map(([month, value]) => ({ month, count: value.count, total: Number(value.paise) / 100 }));
  return count ? { from, to, latestDate, count, total: Number(totalPaise) / 100, months } : null;
}

/** Recheck the identity-free aggregate when it crosses a browser or answer boundary. */
export function validatedStatementSipSummary(value, today = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['count,from,latestDate,to,total', 'count,from,latestDate,months,to,total']
        .includes(Object.keys(value).sort().join(',')) ||
      day(value.from) === null || day(value.to) === null || day(value.latestDate) === null ||
      value.from > value.latestDate || value.latestDate > value.to ||
      value.to > new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10) ||
      !Number.isInteger(value.count) || value.count < 1 || value.count > 2000 ||
      typeof value.total !== 'number' || !Number.isFinite(value.total) ||
      value.total < 0.01 || value.total > 1_000_000_000_000 ||
      Math.abs(value.total * 100 - Math.round(value.total * 100)) > 0.01) return null;
  if (value.months !== undefined) {
    if (!Array.isArray(value.months) || !value.months.length || value.months.length > 240) return null;
    let monthCount = 0;
    let monthPaise = 0;
    let previousMonth = '';
    for (const entry of value.months) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          Object.keys(entry).sort().join(',') !== 'count,month,total' ||
          typeof entry.month !== 'string' || !/^\d{4}-\d{2}$/.test(entry.month) ||
          day(`${entry.month}-01`) === null || entry.month <= previousMonth ||
          entry.month < value.from.slice(0, 7) || entry.month > value.to.slice(0, 7) ||
          !Number.isInteger(entry.count) || entry.count < 1 || entry.count > 2000 ||
          typeof entry.total !== 'number' || !Number.isFinite(entry.total) ||
          entry.total < 0.01 || entry.total > 1_000_000_000_000 ||
          Math.abs(entry.total * 100 - Math.round(entry.total * 100)) > 0.01) return null;
      previousMonth = entry.month;
      monthCount += entry.count;
      monthPaise += Math.round(entry.total * 100);
    }
    if (monthCount !== value.count || monthPaise !== Math.round(value.total * 100) ||
        value.latestDate.slice(0, 7) !== previousMonth) return null;
  }
  return { from: value.from, to: value.to, latestDate: value.latestDate,
    count: value.count, total: value.total,
    ...(value.months === undefined ? {} : { months: value.months.map(entry => ({ ...entry })) }) };
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
