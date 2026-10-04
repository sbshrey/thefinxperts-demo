/** Reconcile a single NPS transaction-statement investment table in a worker. */
export async function parseNpsStatementPages(pages) {
  let recognized = false;
  const fail = message => ({ holding: null, errors: [message], recognized });
  if (!Array.isArray(pages) || !pages.length || pages.length > 50 ||
      pages.some(page => !Array.isArray(page) || page.length > 1500 ||
        page.some(cell => typeof cell !== 'string' || cell.length > 300)))
    return fail('This NPS statement is too large or has an unsupported layout. No holding was added.');
  const cells = pages.flat().map(cell => cell.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const text = cells.join(' ');
  recognized = /National Pension System|NPS TRUST-|Investment Details as on/i.test(text);
  const accounts = [...text.matchAll(/\bPRAN\s*(?:No\.?\s*)?[:#-]?\s*(\d{12})\b/gi)]
    .map(match => match[1]);
  if (!accounts.length || new Set(accounts).size !== 1)
    return fail('One NPS account number could not be established. No holding was added.');
  const markers = [...text.matchAll(/Investment Details as on\s+(\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}[- ][A-Za-z]{3}[- ,]+\d{4})/gi)];
  if (markers.length !== 1)
    return fail('One dated NPS investment table could not be established. No holding was added.');
  const asOf = investmentDate(markers[0][1]);
  if (!asOf || asOf > indiaToday())
    return fail('The NPS investment date is missing, invalid or future-dated. No holding was added.');
  const heading = cells.findIndex(cell => /Investment Details as on/i.test(cell));
  const end = cells.findIndex((cell, index) => index > heading && /Changes made during selected period/i.test(cell));
  if (heading < 0 || end < 0 || end - heading > 500)
    return fail('The NPS investment table is incomplete. No holding was added.');
  const section = cells.slice(heading, end);
  const header = section.findIndex(cell => /Scheme Name/i.test(cell));
  const headerText = section.slice(header, header + 6).join(' ');
  if (header < 0 || !/Total Units/i.test(headerText) || !/Latest NAV/i.test(headerText) ||
      !/Value at NAV/i.test(headerText) || !/XIRR/i.test(headerText))
    return fail('The NPS scheme columns were not recognized. No holding was added.');
  if (/\bTier\s*II\b/i.test(section.join(' ')) || /\bTier\s*II\b/i.test(text.slice(0, markers[0].index)))
    return fail('This statement may include Tier II. Check the tier balances separately; no holding was added.');
  const rows = section.slice(header + 1);
  const isSchemeStart = cell => /^NPS TRUST-/i.test(cell) || /\bPension Funds?\b/i.test(cell);
  const hasPensionFundRows = rows.some(cell => /\bPension Funds?\b/i.test(cell));
  const names = new Set();
  let totalPaise = 0;
  let count = 0;
  for (let index = 0; index < rows.length; index++) {
    if (!isSchemeStart(rows[index])) continue;
    const nameParts = [rows[index]];
    let cursor = index + 1;
    while (cursor < rows.length && number(rows[cursor], 6) === null &&
        !isSchemeStart(rows[cursor]) && nameParts.length < 7)
      nameParts.push(rows[cursor++]);
    const units = number(rows[cursor], 6);
    const nav = number(rows[cursor + 1], 6);
    const value = number(rows[cursor + 2], 2);
    const name = nameParts.join(' ').toLowerCase();
    if (hasPensionFundRows && !/^nps trust-/i.test(name) && !/\btier\s*i\b/i.test(name))
      return fail('The NPS scheme tier could not be established. No holding was added.');
    if (names.has(name) || units === null || nav === null || value === null ||
        units <= 0 || nav <= 0 || value <= 0 || value > 10_000_000_000 ||
        Math.abs(units * nav - value) > Math.max(2, value * 0.0001))
      return fail('An NPS scheme value did not reconcile to its units and NAV. No holding was added.');
    names.add(name);
    totalPaise += Math.round(value * 100);
    count++;
    if (count > 12 || totalPaise > 1_000_000_000_000)
      return fail('The NPS scheme table exceeds the supported review limit. No holding was added.');
    index = cursor + 2;
  }
  if (!count || rows.filter(isSchemeStart).length !== count)
    return fail('The NPS scheme table could not be fully reconciled. No holding was added.');
  const totalMarkers = rows.flatMap((cell, index) => /^Total(?:\s+Value)?$/i.test(cell) ? [index] : []);
  const printedTotal = totalMarkers.length === 1 ? number(rows[totalMarkers[0] + 1], 2) : null;
  if (printedTotal === null || Math.abs(totalPaise - Math.round(printedTotal * 100)) > 2)
    return fail('A single printed total was missing or did not match the NPS scheme values. No holding was added.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    `thefinxperts-nps-tier1-v1\0${accounts[0]}`));
  const code = [...new Uint8Array(digest).slice(0, 6)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { holding: { name: `NPS Tier I account ${code}`, type: 'Other investment',
    asset: 'Other', value: totalPaise / 100, asOf, entryOrigin: 'nps_statement' },
    errors: [], recognized: true, checks: { schemes: count, asOf } };
}

function number(text, decimals) {
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) return null;
  const fraction = text.split('.')[1] || '';
  if (fraction.length > decimals) return null;
  const value = Number(text.replaceAll(',', ''));
  return Number.isFinite(value) && value <= 10_000_000_000 ? value : null;
}

function investmentDate(raw) {
  const match = /^(\d{1,2})[-/ ](\d{1,2}|[A-Za-z]{3})[-/ ,]+(\d{4})$/.exec(raw);
  if (!match) return null;
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : monthNames.indexOf(match[2].toLowerCase()) + 1;
  const iso = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function indiaToday() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
