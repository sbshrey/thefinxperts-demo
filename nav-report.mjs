import { estimateNavValue, realDate, validUnits } from './nav-estimate.mjs?v=3ce860de2534';

const HEADER = 'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date';
const MONTHS = new Map(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  .map((name, index) => [name.toLowerCase(), index + 1]));
const ISIN = /^INF[A-Z0-9]{9}$/;
const NAV = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,8})?$/;
const money = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const indiaToday = now => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
// AMFI separates Plan and Option into columns; statements may include those labels in one name.
// This removes separator punctuation and only labels that directly follow an identity word.
const schemeNameKey = name => typeof name === 'string' && name.length <= 600 ?
  name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
    .replace(/\b(direct|regular) plan\b/g, '$1')
    .replace(/\b(growth|idcw) option\b/g, '$1') : '';

function navDate(value) {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  if (!match) return null;
  const month = MONTHS.get(match[2].toLowerCase());
  const iso = month && `${match[3]}-${String(month).padStart(2, '0')}-${match[1]}`;
  return iso && realDate(iso) ? iso : null;
}

/** The investor supplies AMFI's new text download; this does not authenticate its source. */
export function parseAmfiNavReport(text, now = new Date()) {
  if (typeof text !== 'string' || text.length > 4_000_000 || text.includes('\0'))
    return { rows: [], errors: ['Choose an AMFI text NAV report smaller than 4 MB.'] };
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > 40_000 || lines[0]?.trim() !== HEADER)
    return { rows: [], errors: ['This is not the current AMFI text NAV report format. Download the Complete NAV Report from AMFI and open that .txt file.'] };
  const rows = [];
  const codes = new Set();
  const unavailableNames = new Set();
  let invalid = 0, unavailableNav = 0;
  for (const line of lines.slice(1)) {
    const clean = line.trim();
    if (!clean || !/^\d{1,9}\s*;/.test(clean)) continue;
    const fields = clean.split(';').map(field => field.trim());
    if (fields.length !== 8) { invalid++; continue; }
    const [code, firstIsin, secondIsin, scheme, plan, option, nav, printedDate] = fields;
    const asOf = navDate(printedDate);
    if (!/^\d{1,9}$/.test(code) || codes.has(code) ||
        !scheme || scheme.length > 200 || plan.length > 200 || option.length > 200 ||
        !NAV.test(nav) ||
        !asOf || asOf > indiaToday(now)) { invalid++; continue; }
    codes.add(code);
    if (!/[1-9]/.test(nav)) {
      unavailableNav++;
      unavailableNames.add(schemeNameKey([scheme, plan, option].filter(Boolean).join(' · ')));
      continue;
    }
    rows.push({ code, isins: [firstIsin, secondIsin].filter(value => ISIN.test(value)),
      name: [scheme, plan, option].filter(Boolean).join(' · '), nav, asOf });
  }
  if (invalid || !rows.length || rows.length > 25_000)
    return { rows: [], errors: [`The NAV file has ${invalid} invalid or repeated data ${invalid === 1 ? 'row' : 'rows'}, or no usable rows. No values changed.`] };
  return { rows, unavailableNav, unavailableNames: [...unavailableNames], errors: [] };
}

/** Stage newer exact identifier or unique full-name matches using unchanged saved units. */
export function prepareNavReportRefresh(saved, report, now = new Date()) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals))
    return { errors: ['Confirm mutual-fund holdings with units before using a NAV report.'] };
  if (!report || report.errors?.length || !Array.isArray(report.rows))
    return { errors: report?.errors?.length ? report.errors : ['Read a valid AMFI text NAV report first.'] };
  if (report.unavailableNames !== undefined &&
      (!Array.isArray(report.unavailableNames) || report.unavailableNames.length > 25_000 ||
       !report.unavailableNames.every(name => typeof name === 'string' && name.length <= 600)))
    return { errors: ['The NAV rows could not be checked. No values changed.'] };
  const byCode = new Map();
  const byIsin = new Map();
  const byName = new Map();
  const unavailableNames = new Set(report.unavailableNames || []);
  for (const row of report.rows) {
    if (!row || typeof row.code !== 'string' || !/^\d{1,9}$/.test(row.code) ||
        byCode.has(row.code) || !schemeNameKey(row.name) || !Array.isArray(row.isins) ||
        !row.isins.every(isin => ISIN.test(isin)) || !realDate(row.asOf) ||
        row.asOf > indiaToday(now) || !NAV.test(row.nav) || !/[1-9]/.test(row.nav))
      return { errors: ['The NAV rows could not be checked. No values changed.'] };
    byCode.set(row.code, row);
    const nameKey = schemeNameKey(row.name);
    const nameMatches = byName.get(nameKey) || [];
    nameMatches.push(row);
    byName.set(nameKey, nameMatches);
    for (const isin of row.isins) {
      const matches = byIsin.get(isin) || [];
      matches.push(row);
      byIsin.set(isin, matches);
    }
  }
  const portfolio = structuredClone(saved);
  const changes = [];
  const updates = [];
  let eligible = 0, unmatched = 0, older = 0, invalidUnits = 0, nameMatched = 0;
  for (let index = 0; index < saved.holdings.length; index++) {
    const row = saved.holdings[index];
    if (row.type !== 'Mutual fund' || row.granularity === 'fund_house') continue;
    if (!validUnits(row.units) || !realDate(row.asOf)) { invalidUnits++; continue; }
    eligible++;
    const codeMatch = row.amfi ? byCode.get(row.amfi) : null;
    const isinMatches = ISIN.test(row.isin || '') ? byIsin.get(row.isin) || [] : [];
    const nameKey = schemeNameKey(row.name);
    const nameMatches = !row.amfi && !row.isin && !unavailableNames.has(nameKey) ?
      byName.get(nameKey) || [] : [];
    const candidate = row.amfi && row.isin ?
      codeMatch && isinMatches.length === 1 && isinMatches[0] === codeMatch ? codeMatch : null :
      row.amfi ? codeMatch : row.isin ? isinMatches.length === 1 ? isinMatches[0] : null :
        nameMatches.length === 1 ? nameMatches[0] : null;
    if (!candidate) { unmatched++; continue; }
    if (candidate.asOf <= row.asOf) { older++; continue; }
    const value = estimateNavValue(row.units, candidate.nav);
    if (value === null || value > 10_000_000_000) { unmatched++; continue; }
    if (!row.amfi && !row.isin) nameMatched++;
    const originalValue = row.navEstimate?.originalValue ?? row.value;
    const originalAsOf = row.navEstimate?.originalAsOf ?? row.asOf;
    portfolio.holdings[index] = { ...row, value, asOf: candidate.asOf,
      valuationOrigin: 'amfi_nav_report',
      navEstimate: { originalValue, originalAsOf, nav: candidate.nav, navAsOf: candidate.asOf } };
    updates.push({ index, id: row.id, value: row.value, asOf: row.asOf, units: row.units });
    changes.push(`Holding ${index + 1}, saved ${row.name}; AMFI ${candidate.name} (code ${candidate.code}; ${!row.amfi && !row.isin ? 'unique full-name match' : 'identifier match'}): ${money(row.value)} (${row.asOf}) → ${money(value)} (${candidate.asOf}); ${row.units} saved units × NAV ${candidate.nav}`);
  }
  if (!changes.length) return { errors: [], repeated: true,
    description: `No newer exact NAV match could update a saved fund. ${eligible} rows had units and a date; ${unmatched} lacked a unique identifier or full-name match; ${older} matched NAV dates were not newer; ${invalidUnits} lacked valid units or an existing date. No value changed.` };
  const total = portfolio.holdings.reduce((sum, row) => sum + Number(row.value), 0);
  if (!Number.isFinite(total) || total > 1_000_000_000_000)
    return { errors: ['The estimated portfolio total would exceed the supported limit. No value changed.'] };
  return { portfolio, errors: [], kind: 'nav_report', changes, updates,
    description: `${changes.length} mutual-fund values have a newer exact AMFI code, ISIN or unique full-name match in the uploaded text file; ${nameMatched} used a name because no identifier was saved. ${unmatched} eligible rows had no unique match; ${older} had no newer date; ${invalidUnits} lacked valid units or an existing date. Compare every saved name with the AMFI scheme, plan and option shown below, and check that each saved unit balance is still held after purchases, redemptions or switches. A name match is not an independently verified identity. This file was supplied by you and its origin was not authenticated. Values are estimates, not live account balances; stocks and goal links stay unchanged.`,
    result: `${changes.length} dated mutual-fund NAV ${changes.length === 1 ? 'estimate was' : 'estimates were'} applied using saved units. Verify current units against a newer statement. Goal links and direct stocks stayed unchanged.` };
}

/** Apply only checked preview rows against the unchanged saved review. */
export function selectNavReportRefresh(saved, staged, selectedIndices) {
  const invalid = { errors: ['The NAV selection no longer matches this review. Discard it and open the report again.'] };
  if (staged?.kind !== 'nav_report' || !Array.isArray(staged.updates) ||
      !Array.isArray(staged.portfolio?.holdings) || !Array.isArray(saved?.holdings) ||
      !Array.isArray(selectedIndices) || !selectedIndices.length ||
      new Set(selectedIndices).size !== selectedIndices.length) return invalid;
  const updates = new Map(staged.updates.map(update => [update.index, update]));
  if (updates.size !== staged.updates.length ||
      selectedIndices.some(index => !Number.isInteger(index) || !updates.has(index))) return invalid;
  const portfolio = structuredClone(saved);
  for (const index of selectedIndices) {
    const before = saved.holdings[index];
    const update = updates.get(index);
    const after = staged.portfolio.holdings[index];
    if (!before || !after || before.id !== update.id || before.value !== update.value ||
        before.asOf !== update.asOf || before.units !== update.units || after.id !== update.id ||
        after.valuationOrigin !== 'amfi_nav_report' || !after.navEstimate) return invalid;
    portfolio.holdings[index] = structuredClone(after);
  }
  const total = portfolio.holdings.reduce((sum, row) => sum + Number(row.value), 0);
  if (!Number.isFinite(total) || total > 1_000_000_000_000) return invalid;
  return { portfolio, count: selectedIndices.length, omitted: staged.updates.length - selectedIndices.length,
    errors: [] };
}
