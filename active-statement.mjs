/**
 * Read the HTML attachment embedded in some CAMS Active Statement PDFs.
 * This deliberately never evaluates its scripts or retains investor and folio fields.
 * The statement is an AMC-level snapshot, not a scheme-level CAS.
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
  if (!matched) errors.push('No fund-house summary rows were found in the statement.');
  if (errors.length) return { holdings: [], errors: errors.slice(0, 5), notices: [] };

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
