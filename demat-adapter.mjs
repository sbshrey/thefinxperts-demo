/** Reduce casparser NSDL/CDSL output to reviewed securities, without account identities. */
export function normalizeDematHoldings(document) {
  const errors = [];
  const notices = [];
  let ownershipUnverified = false;
  const empty = () => ({ holdings: [], errors, notices, performance: [],
    ownershipUnverified, source: 'Demat CAS' });
  if (!['NSDL', 'CDSL'].includes(document?.file_type) || !Array.isArray(document.accounts)) {
    errors.push('This is not a supported NSDL or CDSL demat CAS result.');
    return empty();
  }
  if (!Array.isArray(document.parse_warnings) || document.parse_warnings.length) {
    errors.push('The demat parser reported missing or unreconciled values. Check the original statement before importing.');
    return empty();
  }
  const asOf = periodEnd(document.statement_period?.to);
  if (!asOf) {
    errors.push('The demat statement period end is missing or invalid.');
    return empty();
  }
  const npsValue = money(document.nps?.value ?? '0');
  if (npsValue === null || npsValue > 0n || (Array.isArray(document.nps?.schemes) && document.nps.schemes.length > 0)) {
    errors.push('This statement includes NPS holdings or an unreadable NPS value. Import is stopped because NPS is not yet represented in this review.');
    return empty();
  }
  if (!document.accounts.length) {
    errors.push('The demat CAS contains no accounts.');
    return empty();
  }
  const printedOwners = new Set();
  for (const account of document.accounts) {
    const owners = Array.isArray(account?.owners) ? account.owners : [];
    if (!owners.length) ownershipUnverified = true;
    if (owners.length > 1 && owners.some(owner =>
      !/^[A-Z]{5}\d{4}[A-Z]$/.test(typeof owner?.PAN === 'string' ? owner.PAN.trim().toUpperCase() : ''))) {
      errors.push('This demat CAS has joint holders whose owner PANs could not all be established. A single-investor review cannot assign their full account value to one person; no holdings were imported.');
      return empty();
    }
    for (const owner of owners) {
      const pan = typeof owner?.PAN === 'string' ? owner.PAN.trim().toUpperCase() : '';
      if (!pan) { ownershipUnverified = true; continue; }
      if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) ownershipUnverified = true;
      printedOwners.add(pan);
      if (printedOwners.size > 1) {
        errors.push('This demat CAS lists different owner PANs across its accounts or joint holders. A single-investor review cannot assign their full values to one person; no holdings were imported.');
        return empty();
      }
    }
  }
  if (ownershipUnverified)
    notices.push('The parsed CAS does not establish an owner PAN for one or more demat accounts. Check account ownership in the original statement before adding these holdings.');
  const holdings = [];
  for (const [accountIndex, account] of document.accounts.entries()) {
    if (!Array.isArray(account?.equities) || !Array.isArray(account.mutual_funds) || !Array.isArray(account.bonds)) {
      errors.push(`Account ${accountIndex + 1}: security lists are incomplete.`);
      continue;
    }
    if (account.bonds.length) {
      errors.push(`Account ${accountIndex + 1}: bonds are present. Import is stopped because bonds are not yet represented in this review.`);
      continue;
    }
    const accountStart = holdings.length;
    for (const [index, equity] of account.equities.entries()) {
      const row = `Account ${accountIndex + 1}, equity ${index + 1}`;
      const position = positionValue(equity?.num_shares, equity?.value, row, errors);
      if (!position) continue;
      if (position.zero) { notices.push(`${row}: zero-balance security was left out.`); continue; }
      if (!pricedValueMatches(equity.num_shares, equity.price, position.value)) {
        errors.push(`${row}: quantity, price and value do not reconcile within ₹1.`); continue;
      }
      if (!validIsin(equity.isin)) { errors.push(`${row}: ISIN is missing or invalid.`); continue; }
      const name = label(equity.name) || label(equity.symbol) || '';
      holdings.push({ id: `demat-${accountIndex + 1}-equity-${index + 1}`, name, type: null,
        asset: null, value: position.value, asOf, amc: null, isin: equity.isin,
        amfi: null, exposure: null });
      if (!name) notices.push(`${row}: enter the security name from the original statement.`);
    }
    for (const [index, fund] of account.mutual_funds.entries()) {
      const row = `Account ${accountIndex + 1}, mutual fund ${index + 1}`;
      const position = positionValue(fund?.balance, fund?.value, row, errors);
      if (!position) continue;
      if (position.zero) { notices.push(`${row}: zero-balance scheme was left out.`); continue; }
      if (!pricedValueMatches(fund.balance, fund.nav, position.value)) {
        errors.push(`${row}: units, NAV and value do not reconcile within ₹1.`); continue;
      }
      if (!validIsin(fund.isin)) { errors.push(`${row}: ISIN is missing or invalid.`); continue; }
      const name = label(fund.name) || '';
      const asset = classifyFund(fund.type);
      const units = formatUnits(fund.balance);
      if (!units) { errors.push(`${row}: unit balance cannot be represented.`); continue; }
      holdings.push({ id: `demat-${accountIndex + 1}-fund-${index + 1}`, name,
        type: 'Mutual fund', asset, value: position.value, units, asOf,
        amc: null, isin: fund.isin, amfi: validAmfi(fund.amfi) ? fund.amfi : null,
        exposure: null });
      if (!name) notices.push(`${row}: enter the scheme name from the original statement.`);
      if (asset === 'Other') notices.push(`${row}: fund asset category is unclassified and shown as Other.`);
    }
    const reported = money(account.balance);
    const parsed = holdings.slice(accountStart).reduce((sum, holding) => sum + BigInt(Math.round(holding.value * 100)), 0n);
    if (reported === null || (reported > parsed ? reported - parsed : parsed - reported) > 100n) {
      errors.push(`Account ${accountIndex + 1}: reported account value does not match imported securities within ₹1.`);
    }
    if (holdings.length > 500) errors.push('This demat CAS contains more than 500 securities; import is stopped for review.');
  }
  if (!holdings.length && !errors.length) errors.push('The demat CAS contains no nonzero supported holdings.');
  if (holdings.length) notices.push('Demat values are as of the statement period end, not live prices. Confirm each security type and compare with the original statement. Transactions and personal account identifiers are not imported.');
  return { holdings: errors.length ? [] : holdings, errors: errors.slice(0, 5), notices,
    performance: [], ownershipUnverified, source: 'Demat CAS' };
}

function money(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) ||
      /[1-9]/.test((value.split('.')[1] || '').slice(2))) return null;
  const [whole, fraction = ''] = value.split('.');
  const paise = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0') || '0');
  return paise <= 100_000_000_000_000n ? paise : null;
}

function positionValue(quantity, value, row, errors) {
  const parsedQuantity = decimal(quantity);
  const parsedValue = money(value);
  if (parsedQuantity === null || parsedValue === null || parsedValue > 1_000_000_000_000n ||
      (parsedQuantity === 0n) !== (parsedValue === 0n)) {
    errors.push(`${row}: quantity and value are missing or inconsistent.`);
    return null;
  }
  return { zero: parsedQuantity === 0n, value: Number(parsedValue) / 100 };
}

function decimal(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) ||
      /[1-9]/.test((value.split('.')[1] || '').slice(6))) return null;
  const [whole, fraction = ''] = value.split('.');
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, '0') || '0');
  return scaled <= BigInt(Number.MAX_SAFE_INTEGER) ? scaled : null;
}

function pricedValueMatches(quantity, price, value) {
  if (decimal(quantity) === null || typeof price !== 'string' || !/^\d+(?:\.\d+)?$/.test(price)) return false;
  const units = Number(quantity), perUnit = Number(price);
  return Number.isFinite(units) && Number.isFinite(perUnit) && perUnit > 0 &&
    Math.abs(units * perUnit - value) <= 1;
}

function formatUnits(value) {
  const scaled = decimal(value);
  if (scaled === null || scaled <= 0n) return null;
  const whole = scaled / 1_000_000n;
  const fraction = (scaled % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function periodEnd(value) {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(value ?? '');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    .findIndex(name => name.toLowerCase() === match?.[2].toLowerCase());
  if (!match || month < 0) return null;
  const iso = `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

function classifyFund(value) {
  const type = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return ({ EQUITY: 'Equity', DEBT: 'Debt', GOLD: 'Gold' })[type] || 'Other';
}
function label(value) { return typeof value === 'string' && value.trim().length <= 200 ? value.trim() : ''; }
function validIsin(value) { return typeof value === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(value); }
function validAmfi(value) { return typeof value === 'string' && /^\d{5,8}$/.test(value); }
