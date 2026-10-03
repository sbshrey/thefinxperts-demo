/** Reconcile one EPFO member passbook without returning its member ID or PDF text. */
export async function parseEpfoPassbookPages(pages) {
  const fail = message => ({ holding: null, errors: [message] });
  if (!Array.isArray(pages) || !pages.length || pages.length > 30 ||
      pages.some(page => !Array.isArray(page) || page.length > 1000 ||
        page.some(item => typeof item !== 'string' || item.length > 300)))
    return fail('This EPF passbook is too large or has an unsupported layout. No holding was added.');
  const first = pages[0].map(item => item.trim());
  const labels = first.map(item => item.toLowerCase());
  const firstTable = labels.findIndex(item => item === 'particulars');
  if (firstTable < 15 || !labels.includes('employee share') || !labels.includes('employer share') ||
      !labels.some(item => /^member id\s*\/\s*name$/.test(item)))
    return fail('This is not a recognized EPF member passbook. No holding was added.');
  const headerBalance = label => {
    const index = labels.indexOf(label);
    if (index < 0 || index >= firstTable) return null;
    const amounts = first.slice(index + 1, Math.min(index + 7, firstTable)).map(paise).filter(value => value !== null);
    return amounts.length === 1 ? amounts[0] : null;
  };
  const employee = headerBalance('employee share');
  const employer = headerBalance('employer share');
  if (employee === null || employer === null || employee + employer <= 0)
    return fail('The EPF balance could not be checked against this passbook. No holding was added.');

  const all = pages.flat().map(item => item.trim());
  const memberIds = new Set(all.filter(item => /^[A-Z]{5}\d{15,20}\/?$/.test(item)).map(item => item.replace(/\/$/, '')));
  if (memberIds.size !== 1)
    return fail('The EPF member account could not be identified as one account. No holding was added.');
  const totals = [];
  for (let index = 0; index < all.length; index++) {
    if (all[index].toLowerCase() !== 'grand total') continue;
    const amounts = all.slice(index + 1, index + 13).map(paise).filter(value => value !== null);
    if (amounts.length < 2) return fail('An EPF grand total could not be read. No holding was added.');
    totals.push(amounts[0] + amounts[1]);
  }
  if (!totals.length || totals.at(-1) !== employee + employer)
    return fail('The final EPF grand total does not match the current balance. No holding was added.');

  const printDates = [];
  for (let index = 0; index < all.length; index++) {
    if (all[index].toLowerCase() !== 'printed on') continue;
    const nearby = all.slice(index + 1, index + 9).map(printDate).filter(Boolean);
    if (nearby.length !== 1) return fail('The EPF report date could not be checked. No holding was added.');
    printDates.push(nearby[0]);
  }
  if (printDates.length !== 1 || printDates[0] > indiaToday())
    return fail('The EPF report date is missing or in the future. No holding was added.');

  const memberId = [...memberIds][0];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`thefinxperts-epf-v1\0${memberId}`));
  const suffix = [...new Uint8Array(digest).slice(0, 6)].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { holding: { name: `EPF account ${suffix}`, type: 'Other investment', asset: 'Other',
    value: (employee + employer) / 100, asOf: printDates[0], entryOrigin: 'epfo_passbook' },
    errors: [], checks: { grandTotals: totals.length, reportDate: printDates[0] } };
}

function paise(text) {
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replaceAll(',', '').split('.');
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(value) && value <= 1_000_000_000_000 ? value : null;
}

function printDate(text) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*\d{1,2}:\d{2}:\d{2}(?:\s*[AP]M)?)?$/i.exec(text);
  if (!match) return null;
  const first = Number(match[1]), second = Number(match[2]);
  if ((first <= 12 && second <= 12) || (first > 12 && second > 12)) return null;
  const month = first > 12 ? second : first;
  const day = first > 12 ? first : second;
  const iso = `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function indiaToday() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
