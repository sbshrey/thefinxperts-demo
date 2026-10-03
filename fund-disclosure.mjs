const ISIN = /^[A-Z]{2}[A-Z0-9]{10}$/;
const MONTHS = new Map(['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december']
  .map((name, index) => [name, index + 1]));

const cell = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const label = value => cell(value).toLocaleLowerCase('en-IN');
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value :
  typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : null;
const failed = message => ({ disclosure: null, errors: [message] });

function statementDate(value, todayIso) {
  const printed = cell(value);
  const monthFirst = /\b(?:monthly\s+)?portfolio\s+statement\s+as\s+on\s*:?[\s]*(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(printed);
  const dayFirst = /\bportfolio\s+as\s+on\s*:?[\s]*(\d{1,2})[-\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s](\d{4})\b/i.exec(printed);
  if (!monthFirst && !dayFirst) return null;
  const month = monthFirst ? MONTHS.get(monthFirst[1].toLowerCase()) :
    [...MONTHS.entries()].find(([name]) => name.startsWith(dayFirst[2].toLowerCase()))?.[1];
  const day = monthFirst ? monthFirst[2] : dayFirst[1];
  const year = monthFirst ? monthFirst[3] : dayFirst[3];
  const iso = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso && iso <= todayIso ? iso : false;
}

function schemeTitle(value) {
  const raw = cell(value);
  if (/^Groww\b/i.test(raw) || (/^IB\d{2}-/i.test(raw) && !/^IB\d{2}-Groww\b/i.test(raw))) return null;
  const title = raw.replace(/^IB\d{2}-/i, '').split(/\s*\(/, 1)[0].trim();
  return /^(?:Motilal Oswal|Parag Parikh|Groww)\s+[A-Za-z0-9 &.'/-]{3,100}\s+(?:Fund|ETF)$/i.test(title) ? title : null;
}

/** Read one user-supplied AMC sheet as dated, listed equity weights only. No investor holding changes. */
export function parseFundDisclosureRows(rows,
  todayIso = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)) {
  if (!Array.isArray(rows) || rows.length < 12 || rows.length > 1000 ||
      rows.some(row => !Array.isArray(row) || row.length > 80))
    return failed('Choose one supported scheme portfolio spreadsheet.');
  const headerCandidates = rows.slice(0, 25).flatMap((row, index) => {
    const headings = row.map(label);
    const name = headings.findIndex(text => /^(?:name of the instrument|name of instrument)$/.test(text));
    const isin = headings.indexOf('isin');
    const weight = headings.findIndex(text => /^%\s*to\s*net\s*assets$/.test(text));
    return name >= 0 && isin >= 0 && weight >= 0 && new Set([name, isin, weight]).size === 3 ?
      [{ index, name, isin, weight }] : [];
  });
  if (headerCandidates.length !== 1) return failed('The sheet needs one unambiguous instrument, ISIN and % to Net Assets header.');
  const header = headerCandidates[0];
  const dates = rows.slice(0, header.index).flatMap(row => row.map(value => statementDate(value, todayIso))
    .filter(value => value !== null));
  if (dates.length !== 1 || !dates[0]) return failed('The scheme disclosure date is missing, invalid, future or conflicting.');
  const titles = rows.slice(0, header.index).flatMap(row => row.map(schemeTitle).filter(Boolean));
  if (titles.length !== 1) return failed('The sheet needs one identifiable scheme title before its holdings table.');
  const scheme = titles[0];
  const amc = scheme.startsWith('Motilal Oswal ') ? 'Motilal Oswal' :
    scheme.startsWith('Groww ') ? 'Groww' : 'PPFAS';
  if (amc === 'Motilal Oswal' && !rows.slice(0, header.index).some(row =>
    row.some(value => /Motilal Oswal Asset Management Company Limited/i.test(cell(value)))))
    return failed('The printed fund-house identity does not match the scheme.');
  const body = rows.slice(header.index + 1, Math.min(rows.length, header.index + 10));
  const equityIndex = body.findIndex(row => row.some(value => /^equity\s*&\s*equity related$/i.test(cell(value))));
  if (equityIndex < 0) return failed('A listed equity section was not found under this scheme.');
  const sectionStart = header.index + 1 + equityIndex;
  const listedIndex = rows.slice(sectionStart + 1, sectionStart + 5)
    .findIndex(row => row.some(value => /listed\s*\/\s*awaiting listing on (?:the\s+)?stock exchanges/i.test(cell(value))));
  if (listedIndex < 0) return failed('The listed equity subsection was not found.');
  const first = sectionStart + 2 + listedIndex;
  const subtotal = rows.findIndex((row, index) => index >= first && index < first + 500 &&
    label(row[header.name]) === 'sub total');
  if (subtotal < 0 || subtotal - first < 1 || subtotal - first > 400)
    return failed('The listed equity subsection has no bounded subtotal.');
  const grandTotals = rows.flatMap((row, index) => label(row[header.name]) === 'grand total' ? [index] : []);
  if (grandTotals.length !== 1 || grandTotals[0] <= subtotal)
    return failed('The sheet needs one grand total after the listed equity section.');
  const grand = finite(rows[grandTotals[0]][header.weight]);
  if (amc === 'Groww' && (grand === null || Math.abs(grand - 1) > 0.0001))
    return failed('The Groww sheet’s printed grand total must use the fractional scale.');
  const scale = grand !== null && Math.abs(grand - 100) <= 0.01 ? 1 :
    grand !== null && Math.abs(grand - 1) <= 0.0001 ? 100 : null;
  if (!scale) return failed('The sheet’s % to Net Assets scale cannot be reconciled to 100%.');
  const subtotalRaw = finite(rows[subtotal][header.weight]);
  if (subtotalRaw === null || subtotalRaw <= 0) return failed('The listed equity subtotal is missing or invalid.');
  const securities = [];
  const seen = new Set();
  for (let index = first; index < subtotal; index++) {
    const row = rows[index];
    if (row.every(value => !cell(value))) continue;
    const name = cell(row[header.name]);
    const isin = cell(row[header.isin]).toUpperCase();
    const rawWeight = finite(row[header.weight]);
    if (!name || name.length > 160 || !ISIN.test(isin) || seen.has(isin) ||
        rawWeight === null || rawWeight <= 0 || rawWeight * scale > 100)
      return failed(`Listed equity row ${index + 1} needs a unique security ISIN and positive weight.`);
    seen.add(isin);
    securities.push({ name, isin, weightPct: Math.round(rawWeight * scale * 10000) / 10000 });
  }
  const coveredPct = securities.reduce((sum, security) => sum + security.weightPct, 0);
  const printedPct = subtotalRaw * scale;
  if (!securities.length || coveredPct > 100.05 || Math.abs(coveredPct - printedPct) > 0.2)
    return failed('The listed equity weights do not reconcile with their printed subtotal.');
  return { disclosure: { scheme, amc, asOf: dates[0], scope: 'listed_equity',
    coveredPct: Math.round(coveredPct * 10000) / 10000,
    notIncludedPct: Math.round((100 - coveredPct) * 10000) / 10000,
    securities }, errors: [] };
}

/** Observed shared listed equity, not complete scheme overlap or net derivative exposure. */
export function compareFundDisclosures(first, second) {
  if (!first || !second || first.scope !== 'listed_equity' || second.scope !== 'listed_equity' ||
      disclosureSchemeKey(first) === disclosureSchemeKey(second)) return null;
  const byIsin = new Map(second.securities.map(row => [row.isin, row]));
  const common = first.securities.flatMap(row => {
    const other = byIsin.get(row.isin);
    return other ? [{ isin: row.isin, name: row.name, firstPct: row.weightPct,
      secondPct: other.weightPct, sharedPct: Math.min(row.weightPct, other.weightPct) }] : [];
  }).sort((a, b) => b.sharedPct - a.sharedPct || a.isin.localeCompare(b.isin));
  const sharedPct = common.reduce((sum, row) => sum + row.sharedPct, 0);
  return { common, sharedPct: Math.round(sharedPct * 10000) / 10000,
    firstCoveredPct: first.coveredPct, secondCoveredPct: second.coveredPct,
    sameDate: first.asOf === second.asOf };
}

function baseScheme(value) {
  return cell(value).toLocaleLowerCase('en-IN')
    .replace(/\s*[-–—]\s*(?:direct|regular)\s+plan\b.*$/, '')
    .replace(/\s+(?:direct|regular)\s+plan\b.*$/, '')
    .replace(/\s*[-–—]\s*(?:growth|idcw)(?:\s+option)?\s*$/, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function disclosureSchemeKey(item) {
  return `${cell(item?.amc).toLocaleLowerCase('en-IN')}:${baseScheme(item?.scheme)}`;
}

/** Candidate saved scheme rows; a person must still check the exact scheme and plan. */
export function matchFundDisclosure(disclosure, holdings) {
  if (!disclosure || !Array.isArray(holdings)) return null;
  const name = baseScheme(disclosure.scheme);
  if (!name) return null;
  const matches = holdings.filter(row => row?.type === 'Mutual fund' &&
    row.granularity !== 'fund_house' && baseScheme(row.name) === name &&
    (!row.amc || (disclosure.amc === 'Motilal Oswal' ?
      /motilal\s+oswal/i.test(row.amc) : disclosure.amc === 'Groww' ?
        /groww/i.test(row.amc) : /ppfas|parag\s+parikh/i.test(row.amc))));
  return matches.length ? { matches, count: matches.length,
    value: matches.reduce((sum, row) => sum + Number(row.value || 0), 0) } : null;
}

const validValueDate = (value, todayIso) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && value <= todayIso;
};
/** Old source dates cannot support a present issuer exposure view. */
export function datedSourceIssue(value, todayIso, maxAgeDays = 90) {
  if (!validValueDate(todayIso, todayIso) || !validValueDate(value, todayIso) ||
      !Number.isInteger(maxAgeDays) || maxAgeDays < 1) return 'invalid';
  const ageDays = (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${value}T00:00:00Z`)) / 86_400_000;
  return ageDays > maxAgeDays ? 'stale' : null;
}
const roundPaise = value => Math.round(value * 100) / 100;

/** Dated, identified portion of entered portfolio value; unmatched value remains unknown. */
export function estimateVisibleIssuerExposure(holdings, disclosures,
  todayIso = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)) {
  if (!Array.isArray(holdings) || !Array.isArray(disclosures)) return null;
  const rows = holdings.filter(row => Number.isFinite(row?.value) && row.value > 0);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const latestByScheme = new Map();
  for (const disclosure of disclosures) {
    if (disclosure?.scope !== 'listed_equity' || datedSourceIssue(disclosure.asOf, todayIso)) continue;
    const key = disclosureSchemeKey(disclosure);
    const previous = latestByScheme.get(key);
    if (!previous || disclosure.asOf > previous.asOf) latestByScheme.set(key, disclosure);
  }
  const matched = [...latestByScheme.values()].flatMap(disclosure => {
    const match = disclosure?.scope === 'listed_equity' && !datedSourceIssue(disclosure.asOf, todayIso) ?
      matchFundDisclosure(disclosure, rows) : null;
    return match ? [{ disclosure, holdings: match.matches.filter(row =>
      !datedSourceIssue(row.asOf, todayIso)) }] : [];
  }).filter(source => source.holdings.length);
  const byIsin = new Map();
  const visibleIsins = new Set();
  const sources = [];
  let fundCovered = 0;
  for (const { disclosure, holdings: fundRows } of matched) {
    const value = fundRows.reduce((sum, row) => sum + row.value, 0);
    const coveredValue = value * disclosure.coveredPct / 100;
    fundCovered += coveredValue;
    sources.push({ scheme: disclosure.scheme, disclosureDate: disclosure.asOf,
      holdingDates: [...new Set(fundRows.map(row => row.asOf))].sort(),
      value: roundPaise(value), coveredPct: disclosure.coveredPct,
      coveredValue: roundPaise(coveredValue) });
    for (const security of disclosure.securities) {
      visibleIsins.add(security.isin);
      const exposure = byIsin.get(security.isin) || { isin: security.isin,
        name: security.name, fundValue: 0, directValue: 0 };
      exposure.fundValue += value * security.weightPct / 100;
      byIsin.set(security.isin, exposure);
    }
  }
  let directCovered = 0;
  const directDates = new Set();
  for (const row of rows) {
    if (row.type !== 'Stock' || datedSourceIssue(row.asOf, todayIso) ||
        !visibleIsins.has(row.isin)) continue;
    const exposure = byIsin.get(row.isin);
    exposure.directValue += row.value;
    directCovered += row.value;
    directDates.add(row.asOf);
  }
  const coveredValue = Math.min(total, fundCovered + directCovered);
  const issuers = [...byIsin.values()].map(row => ({ ...row,
    fundValue: roundPaise(row.fundValue), directValue: roundPaise(row.directValue),
    visibleValue: roundPaise(row.fundValue + row.directValue),
    portfolioPct: total ? Math.round((row.fundValue + row.directValue) / total * 10000) / 100 : 0 }))
    .sort((a, b) => b.visibleValue - a.visibleValue || a.isin.localeCompare(b.isin));
  return { total: roundPaise(total), coveredValue: roundPaise(coveredValue),
    unknownValue: roundPaise(total - coveredValue),
    coveragePct: total ? Math.round(coveredValue / total * 10000) / 100 : 0,
    directCovered: roundPaise(directCovered), directDates: [...directDates].sort(),
    sources, issuers };
}
