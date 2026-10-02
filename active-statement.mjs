/**
 * Read the HTML attachment embedded in some CAMS Active Statement PDFs.
 * This deliberately never evaluates its scripts or retains investor and folio fields.
 * The issuer's statement has scheme detail; this importer uses it only when
 * every detected row can be reconciled without running statement scripts.
 */
export function parseActiveStatementHtml(html) {
  const errors = [];
  const notices = [
    'This Active Statement shows fund-house totals, not individual schemes. Scheme overlap, plan type and expense ratios remain unknown.',
    'The statement calls one portion non-equity. It is shown as Other until you verify whether it is debt, gold or another asset.',
  ];
  if (typeof html !== 'string' || html.length > 10_000_000 ||
      !/Your Mutual Fund Active Statement/i.test(html) || !/document\.writeln/i.test(html)) {
    return { holdings: [], errors: ['This is not a supported CAMS Active Statement HTML attachment.'], notices: [] };
  }

  const dateMatch = /Composition of Portfolio as of\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})/i.exec(html);
  const asOf = dateMatch ? statementDate(...dateMatch.slice(1)) : null;
  if (!asOf) errors.push('The statement valuation date is missing or invalid.');

  const rows = new Map();
  // A format change in one row must not turn a full statement into a partial portfolio.
  const summaryCandidates = html.split('document.writeln').filter(part =>
    part.startsWith("(' <td onclick=\"blocking(") && (part.match(/class="amount"/g) || []).length >= 4).length;
  const summaryRow = /document\.writeln\(' <td onclick="blocking\([^\r\n]*?repApos\("([^"\r\n]+)"\) \+'<\/td><td onclick="blocking\([^>\r\n]+>([^<\r\n]+)<\/td><td class="amount">([^<\r\n]+)<\/td><td class="amount">([^<\r\n]+)<\/td><td class="amount">([^<\r\n]+)<\/td><td class="amount">([^<\r\n]+)<\/td>'\);/g;
  let matched = 0;
  for (const match of html.matchAll(summaryRow)) {
    matched++;
    if (matched > 200) { errors.push('The statement has more than 200 fund-house rows.'); break; }
    const amc = cleanText(match[2]);
    const equity = amountPaise(match[3]);
    const other = amountPaise(match[4]);
    const total = amountPaise(match[5]);
    if (!amc || amc.length > 170 || equity === null || other === null || total === null ||
        Math.abs(equity + other - total) > 100 || total > 1_000_000_000_000) {
      errors.push(`Fund-house row ${matched} does not reconcile or contains an invalid value.`);
      continue;
    }
    const current = rows.get(amc) || { equity: 0, other: 0 };
    current.equity += equity;
    current.other += other;
    rows.set(amc, current);
  }
  if (summaryCandidates > matched) errors.push('Some fund-house summary rows could not be read. Import stopped to avoid a partial portfolio.');
  if (!matched) errors.push('No fund-house summary rows were found in the statement.');
  if (errors.length) return { holdings: [], errors: errors.slice(0, 5), notices: [] };

  const schemes = parseSchemeRows(html, rows, asOf);
  if (schemes.holdings) {
    return { holdings: schemes.holdings, errors: [], notices: [
      'Individual scheme rows reconcile to the fund-house summary in this statement. Scheme names, units and values are still unverified statement data; ISINs and underlying fund constituents remain unknown.',
      'Equity and non-equity labels are inferred only from the statement summary where the arithmetic gives one unique answer. Non-equity stays Other until its debt, gold or other category is checked.',
    ] };
  }
  if (schemes.detected) notices.unshift('Scheme rows could not be fully reconciled, so only fund-house totals are shown.');

  const holdings = [];
  for (const [amc, values] of rows) {
    for (const [asset, paise] of [['Equity', values.equity], ['Other', values.other]]) {
      if (!paise) continue;
      holdings.push({ id: `active-${holdings.length + 1}`, name: `${amc} · ${asset === 'Equity' ? 'equity' : 'non-equity'} portion`,
        type: 'Mutual fund', asset, value: paise / 100, asOf, amc, isin: null, amfi: null,
        granularity: 'fund_house', exposure: null });
    }
  }
  if (!holdings.length) errors.push('The statement contains no current fund-house value.');
  if (holdings.reduce((sum, holding) => sum + holding.value, 0) > 1_000_000_000_000)
    errors.push('The combined statement value is too large.');
  return { holdings: errors.length ? [] : holdings, errors, notices };
}

/** Parse a narrow, observed CAMS scheme-row template as text, never as JavaScript. */
function parseSchemeRows(html, summaries, asOf) {
  const fail = () => ({ detected: true, holdings: null });
  const lines = html.split(/\r?\n/);
  const groups = new Map();
  let code = null;
  let codeLine = -100;
  let detected = 0;
  for (let index = 0; index < lines.length - 1; index++) {
    const assignment = /^\s*amc_code\s*=\s*'([A-Za-z0-9]{1,12})';/.exec(lines[index]);
    if (assignment) { code = assignment[1]; codeLine = index; }
    const line = lines[index];
    if (!line.includes('document.writeln') || !line.includes('repApos(') ||
        !/\+\s*broker\s*\+/.test(line)) continue;
    detected++;
    if (detected > 200 || !code || index - codeLine > 40 ||
        !lines[index + 1].includes('document.writeln')) return fail();
    const schemeMatch = /repApos\("([^"\r\n]+)"\)/.exec(line);
    const fragments = [...(line + lines[index + 1]).matchAll(/'(?:\\.|[^'\\])*'/g)]
      .map(match => match[0].slice(1, -1));
    const cells = [...fragments.join('').matchAll(/<td\b[^>]*>(.*?)<\/td>/g)]
      .map(match => cleanText(match[1]));
    if (!schemeMatch || cells.length !== 8 || cells[1] || cells[0].length > 30)
      return fail();
    const name = cleanText(schemeMatch[1]);
    const statementCategory = cleanText(cells[2]);
    const units = numericString(cells[3], 6, true);
    const nav = numericString(cells[4], 6, true);
    const valuePaise = amountPaise(cells[5]);
    if (!name || name.length > 200 || !/^[A-Za-z][A-Za-z0-9 &/().,+-]{0,79}$/.test(statementCategory) ||
        /\d{8,}/.test(statementCategory) || units === null || !nav || valuePaise === null ||
        (valuePaise > 0 && (Number(units) === 0 || Number(nav) === 0)) ||
        Math.abs(Number(units) * Number(nav) - valuePaise / 100) > Math.max(1, valuePaise / 10_000_000))
      return fail();
    if (!groups.has(code)) groups.set(code, []);
    if (valuePaise > 0) groups.get(code).push({ name, statementCategory, units, valuePaise });
  }
  if (!detected) return { detected: false, holdings: null };
  const positiveSummaries = [...summaries].map(([amc, values]) => ({ amc, ...values,
    total: values.equity + values.other })).filter(item => item.total > 0);
  const positiveGroups = [...groups.values()].filter(items => items.length);
  if (positiveGroups.length !== positiveSummaries.length) return fail();

  const used = new Set();
  const holdings = [];
  for (const items of positiveGroups) {
    if (items.length > 16) return fail();
    const total = items.reduce((sum, item) => sum + item.valuePaise, 0);
    const matches = positiveSummaries.filter(item => Math.abs(item.total - total) <= 100);
    if (matches.length !== 1 || used.has(matches[0].amc)) return fail();
    const summary = matches[0];
    used.add(summary.amc);
    let uniqueMask = null;
    for (let mask = 0; mask < 2 ** items.length; mask++) {
      let equity = 0;
      for (let part = 0; part < items.length; part++) if (mask & (1 << part)) equity += items[part].valuePaise;
      if (Math.abs(equity - summary.equity) <= 100) {
        if (uniqueMask !== null) return fail();
        uniqueMask = mask;
      }
    }
    if (uniqueMask === null) return fail();
    items.forEach((item, part) => holdings.push({
      id: `active-scheme-${holdings.length + 1}`, name: item.name, type: 'Mutual fund',
      asset: uniqueMask & (1 << part) ? 'Equity' : 'Other', value: item.valuePaise / 100,
      asOf, amc: summary.amc, isin: null, amfi: null, units: item.units,
      statementCategory: item.statementCategory, exposure: null,
    }));
  }
  return { detected: true, holdings: holdings.length && used.size === positiveSummaries.length ? holdings : null };
}

function numericString(raw, maxDecimals, allowZero = false) {
  const value = raw.replace(/,/g, '');
  if (!new RegExp(`^(?:0|[1-9]\\d{0,9})(?:\\.\\d{1,${maxDecimals}})?$`).test(value)) return null;
  return Number(value) > 0 || (allowZero && Number(value) === 0) ? value : null;
}

function amountPaise(raw) {
  const value = cleanText(raw);
  if (!/^(?:\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(value)) return null;
  const number = Number(value.replace(/,/g, ''));
  return Number.isFinite(number) && number >= 0 && number <= 10_000_000_000 ? Math.round(number * 100) : null;
}

function statementDate(day, shortMonth, year) {
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(shortMonth.toLowerCase()) + 1;
  if (!month) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function cleanText(raw) {
  return raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
