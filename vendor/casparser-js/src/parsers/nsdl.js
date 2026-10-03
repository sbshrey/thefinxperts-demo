/**
 * The NSDL statement reader.
 *
 * Consumes the `Block`/`Cell` structure from `pageobj.js` and produces holdings directly.
 *
 * Where the truth comes from:
 *
 *   1. Page two carries the canonical account roster in a small summary table, one row
 *      per demat account and one for the fund-folio pseudo-account, with type, broker, DP
 *      and client identifiers, holding count and value. Accounts are bootstrapped from
 *      there. Scanning every page for the phrase "Demat Account" instead would pick up
 *      footers, footnotes and numbered paragraphs.
 *   2. A per-account section header matches a roster entry on its identifiers and becomes
 *      the cursor for the equity, fund and bond rows that follow.
 *   3. The "Mutual Fund Folios" detailed table routes to the pseudo-account. Its rows
 *      resolve by ISIN position, token shape and arithmetic rather than fixed columns, so
 *      the stray lone digit these statements sometimes render in the units column is
 *      recognised as the client code it is.
 *
 * Amounts are parsed here, commas stripped, rather than left to the model layer.
 */

import { FileType } from '../enums.js?v=03fe4f2cff52';
import { Decimal, ZERO } from '../decimal.js?v=03fe4f2cff52';
import {
  Bond, DematAccount, DematOwner, Equity, MutualFund, NPSAccount, NPSScheme, NSDLCASData,
  StatementPeriod,
} from '../types.js?v=03fe4f2cff52';
import * as pageobj from './pageobj.js?v=03fe4f2cff52';
import { extractNsdlCdslInvestor } from './investor.js?v=03fe4f2cff52';

// ---------------------------------------------------------------------- patterns

export const ISIN_RE = /^[A-Z]{2}[0-9A-Z]{9}\d$/;
export const INF_ISIN_RE = /^INF[0-9A-Z]{8}\d$/;
export const INE_ISIN_RE = /^IN[E9][0-9A-Z]{8}\d$/;

/**
 * Some templates drop the leading zero on a fraction, printing a balance of `0.196` as
 * `.196`, so the integer part is optional when there is a decimal part.
 */
const NUMERIC_RE = /^-?(?:[\d,]+(?:\.\d+)?|\.\d+)$/;

const PERIOD_RE = new RegExp(
  '(?:for\\s+the\\s+period\\s+from|statement\\s+for\\s+the\\s+period\\s+from)\\s+'
  + '(\\d{2}-[A-Za-z]{3}-\\d{4})\\s+to\\s+(\\d{2}-[A-Za-z]{3}-\\d{4})',
  'i',
);

const DEMAT_TYPE_RE = /^(NSDL|CDSL)\s+Demat\s+Account\s*$/i;
const DP_CLIENT_RE = /DP\s*ID\s*:?\s*(\S+?)\s+Client\s*ID\s*:?\s*(\d+)/i;
const PAN_RE = /(.+?)\s*\(PAN\s*:\s*([^)]+)\)/i;
const PAN_RE_GLOBAL = /(.+?)\s*\(PAN\s*:\s*([^)]+)\)/gi;
const MF_FOLIOS_HEADER_RE = /^Mutual\s+Fund\s+Folios\b/i;
/*
 * The pension section, and where it stops.
 *
 * A statement prints two NPS tables under near-identical headings: "holding details" and
 * then "transaction details", the second running over several pages of contributions and
 * redemptions. Both have a date, an amount and a NAV, so a reader that takes any row with
 * three numbers will happily add the entire contribution ledger to the holdings and
 * report a balance that is too high. Only the first table is holdings.
 */
/*
 * The heading that opens the holdings table, and the one that closes it.
 *
 * The end pattern must not name the scheme wording. A holding here is called "NPS TRUST
 * A/C ICICI PRUDENTIAL PENSION FUND SCHEME E - TIER I DIRECT", so an end pattern matching
 * "nps trust a/c" is matched by the first row of the very table it is meant to close, and
 * the section ends before it has read anything.
 *
 * The start pattern earns its "holding details" for the opposite reason: the words
 * "national pension system" also appear in the depository's own footer on a later page,
 * and a looser start reopens the section over the transaction ledger.
 */
export const NPS_SECTION_RE = /national\s+pension\s+system[\s\S]{0,40}holding\s+details/i;
export const NPS_TRANSACTIONS_RE = /\btransaction\s+details\b/i;
const PRAN_RE = /\bPRAN\b[\s:.-]*([0-9]{9,14})/i;

// "NPS TRUST A/C ICICI PRUDENTIAL PENSION FUND SCHEME E - TIER I" names the fund manager
// in the middle, between the trust account and the scheme letter.
const NPS_MANAGER_RE = /a\/c\s+(.+?)\s+scheme\b/i;
const FOLIO_TAIL_RE = /^\d+\/\d+$/;
// A company is INE, a fund INF, and a government issue IN0 through IN9. Both uses of this
// ask "does this row carry an ISIN, so is it data rather than a column header", and a
// government security that answered no could be mistaken for a header.
const ISIN_ANYWHERE_RE = /\b(IN[0-9EF][0-9A-Z]{8}\d)\b/i;

/** Coarse column tolerances, not absolute positions. */
const UNITS_CLUSTER_X_EPS = 35.0;
const VALUE_COL_X_EPS = 35.0;
const ECHO_REL_EPS = Decimal.parse('0.03');
const PLACEHOLDER_UCCS = new Set(['NOT AVAILABLE', 'NA', 'N.A.', '']);

// --------------------------------------------------------------- decimal helpers

const BLANKS = new Set(['', '-', '--', 'N.A', 'NA']);

export function toDecimal(text) {
  if (text === null || text === undefined) return ZERO;
  const value = String(text).replace(/,/g, '').trim();
  if (BLANKS.has(value)) return ZERO;
  try {
    return Decimal.parse(value);
  } catch {
    return ZERO;
  }
}

export function optDecimal(text) {
  if (text === null || text === undefined) return null;
  const value = String(text).replace(/,/g, '').trim();
  if (BLANKS.has(value)) return null;
  try {
    return Decimal.parse(value);
  } catch {
    return null;
  }
}

export function looksNumeric(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;
  return NUMERIC_RE.test(value);
}

// ------------------------------------------- column anchors for the bonds summary

/**
 * The summary bonds table renders eight data cells per row. Two of them, the coupon
 * frequency and the coupon rate, share an x band and cannot be told apart by position, so
 * within that band the text one is the frequency and the numeric one is the rate.
 */
const BOND_SUMMARY_COLUMNS = [
  ['isin', 15, 80],
  ['name', 80, 175],
  ['coupon_band', 175, 240],
  ['maturity', 240, 310],
  ['num_bonds', 310, 390],
  ['face_value', 390, 510],
  ['value', 510, 600],
];

function bondSummaryColumn(cell) {
  for (const [key, lo, hi] of BOND_SUMMARY_COLUMNS) {
    if (cell.xLeft >= lo && cell.xLeft < hi) return key;
  }
  return null;
}

// ------------------------------------------------------------- account key helpers

/** `NSDL` becomes `NSDL Demat Account`, the form used everywhere else. */
export function fullType(typeWord) {
  return `${String(typeWord).toUpperCase()} Demat Account`;
}

export function accountKey(typeWord, dpId, clientId) {
  return [String(typeWord).toUpperCase(), String(dpId).trim(), String(clientId).trim()];
}

function keyString(key) {
  return key.join('\0');
}

// ------------------------------------------------------------------- entry point

/**
 * Reads an NSDL statement.
 *
 * @param {object} document an open PDF document from a backend
 * @param {string} fileType the issuer, as detected by the dispatcher
 */
export async function parseNsdl(document, fileType = FileType.NSDL) {
  // Atoms once, then both the blocks the holdings reader needs and the investor block.
  const atoms = await pageobj.extractAtoms(document);
  const blocks = pageobj.blocksFromAtoms(atoms);
  const period = findPeriod(blocks) || new StatementPeriod({ from: '', to: '' });

  // Bootstrap the accounts from the page-two roster.
  const accountsByKey = new Map();
  const orderedAccounts = [];
  let mfFoliosAccount = null;

  // Owner names harvested from the most recent "in the name of" header, consumed by the
  // next roster row and reset on each new header.
  let pendingOwners = [];

  for (const block of blocks) {
    if (block.page !== 2) continue;
    const text = block.text();
    const lower = text.toLowerCase();

    if (lower.includes('in the single name of')
      || lower.includes('in the joint names of')
      || lower.includes('in the joint name of')) {
      pendingOwners = [];
      continue;
    }

    if (PAN_RE.test(text)) {
      // `name1 (PAN:...)\nname2 (PAN:...)` arrives as one cell with a newline in it.
      PAN_RE_GLOBAL.lastIndex = 0;
      let match = PAN_RE_GLOBAL.exec(text);
      while (match) {
        pendingOwners.push(new DematOwner({ name: match[1].trim(), PAN: match[2].trim() }));
        match = PAN_RE_GLOBAL.exec(text);
      }
      continue;
    }

    if (isSummaryDematRow(block)) {
      const [account, key] = accountFromSummaryRow(block, [...pendingOwners]);
      if (!accountsByKey.has(keyString(key))) {
        accountsByKey.set(keyString(key), account);
        orderedAccounts.push(account);
      }
      continue;
    }

    if (isSummaryMfFoliosRow(block)) {
      if (mfFoliosAccount === null) {
        mfFoliosAccount = mfFoliosAccountFromSummary(block, [...pendingOwners]);
        orderedAccounts.push(mfFoliosAccount);
      }
    }
  }

  // Walk the remaining pages, following per-account section headers and reading the
  // holdings rows into whichever account is current.
  //
  // `section` comes from the small marker blocks and disambiguates the detailed table
  // header, whose column set is identical for equities, funds and bonds. `mode` is the
  // routing key the column header settles on.
  const pageBlocks = blocks.filter((block) => block.page > 2);
  let account = null;
  let mode = null;
  let section = null;
  let inNps = false;
  let npsPran = null;
  const npsSchemes = [];
  const parseWarnings = [];

  let i = 0;
  while (i < pageBlocks.length) {
    const block = pageBlocks[i];
    const lower = block.text().toLowerCase();

    const [headerKey, consumed] = tryPerAccountHeader(pageBlocks, i);
    if (headerKey !== null) {
      account = accountsByKey.get(keyString(headerKey)) || null;
      mode = null;
      section = null;
      i += consumed;
      continue;
    }

    if (lower.includes('mutual fund folios (f)')) {
      account = mfFoliosAccount;
      mode = 'mf_holdings';
      section = 'mfunds';
      inNps = false;
      i += 1;
      continue;
    }

    /*
     * National Pension System.
     *
     * This one hangs off the statement rather than off a demat account: one PRAN with a
     * few schemes under it, laid out as fund manager, scheme, units, NAV and value. It
     * runs over a page break, so it is read until another heading turns up rather than
     * for a fixed number of rows.
     */
    // Started by the holdings heading and never by the transaction one. Matching the
    // pension words loosely and ruling the ledger out explicitly survives a statement
    // that words either heading differently, which demanding an exact phrase did not.
    if (NPS_SECTION_RE.test(lower) && !NPS_TRANSACTIONS_RE.test(lower)) {
      inNps = true;
      account = null;
      mode = null;
      section = null;
      i += 1;
      continue;
    }

    if (inNps) {
      // The end of the holdings table, checked before the rows so nothing past it is read
      // as a holding.
      if (NPS_TRANSACTIONS_RE.test(block.text())
        || sectionMarkerKind(block) !== null
        || tryPerAccountHeader(pageBlocks, i)[0] !== null
        || /^(?:mutual fund folios|equity shares|grand total)/i.test(block.text().trim())) {
        inNps = false;
      } else {
        const pran = PRAN_RE.exec(block.text());
        if (pran && !npsPran) npsPran = pran[1];
        const scheme = parseNpsRow(block);
        if (scheme) npsSchemes.push(scheme);
        i += 1;
        continue;
      }
    }

    if (account !== null) {
      const headerMode = detectModeFromHeader(block, section);
      if (headerMode !== null) {
        mode = headerMode;
        i += 1;
        continue;
      }
      if (isTotalRow(block)) {
        i += 1;
        continue;
      }
      const marker = sectionMarkerKind(block);
      if (marker !== null) {
        section = marker;
        // The mode is cleared rather than set: for a section this reader does not
        // support, the rows that follow should fall through and be ignored until the
        // next table header arrives.
        mode = null;
        i += 1;
        continue;
      }
    }

    if (account === null || mode === null) {
      i += 1;
      continue;
    }

    switch (mode) {
      case 'equities_summary': {
        const equity = parseEquityRow(block, false);
        if (equity) account.equities.push(equity);
        break;
      }
      case 'equities_detailed': {
        const equity = parseEquityRow(block, true);
        if (equity) account.equities.push(equity);
        break;
      }
      case 'mfunds_summary': {
        const fund = parseSummaryMfRow(block);
        if (fund) account.mutual_funds.push(fund);
        break;
      }
      case 'mfunds_detailed': {
        const fund = parseDetailedMfRow(block);
        if (fund) account.mutual_funds.push(fund);
        break;
      }
      case 'mf_holdings': {
        const fund = parseMfHoldingsRow(block, parseWarnings);
        if (fund) account.mutual_funds.push(fund);
        break;
      }
      case 'bonds_summary': {
        const bond = parseBondSummaryRow(block);
        if (bond) account.bonds.push(bond);
        break;
      }
      case 'bonds_detailed': {
        const bond = parseBondDetailedRow(block);
        if (bond) account.bonds.push(bond);
        break;
      }
      default:
        break;
    }
    i += 1;
  }

  // Left null when the statement carries no pension section, so a caller can tell "no NPS
  // here" from "an NPS account holding nothing".
  const nps = npsSchemes.length
    ? new NPSAccount({
      pran: npsPran,
      schemes: npsSchemes,
      value: npsSchemes.reduce((total, scheme) => total.add(scheme.value), ZERO),
    })
    : null;

  return new NSDLCASData({
    statement_period: period,
    accounts: orderedAccounts,
    investor_info: extractNsdlCdslInvestor(atoms),
    file_type: fileType,
    nps,
    parse_warnings: parseWarnings,
  });
}

// ------------------------------------------------------- roster rows (page two)

/**
 * A roster row. Two physical layouts produce the same logical row, depending on whether
 * the broker name and the identifier line were clustered together:
 *
 *   four cells:  Type | "<broker>\nDP ID:... Client ID:..." | count | value
 *   five cells:  Type | "<broker>" | "DP ID:... Client ID:..." | count | value
 *
 * Both are accepted; the identifier cell is found by content rather than position.
 */
export function isSummaryDematRow(block) {
  if (block.cells.length !== 4 && block.cells.length !== 5) return false;
  if (!DEMAT_TYPE_RE.test(block.cells[0].text.trim())) return false;
  return block.cells.slice(1).some((cell) => DP_CLIENT_RE.test(cell.text));
}

export function isSummaryMfFoliosRow(block) {
  if (block.cells.length !== 4) return false;
  return MF_FOLIOS_HEADER_RE.test(block.cells[0].text.trim());
}

export function accountFromSummaryRow(block, owners = []) {
  const typeWord = DEMAT_TYPE_RE.exec(block.cells[0].text.trim())[1].toUpperCase();

  // Find the cell carrying the identifiers; whatever precedes it is the broker name.
  let dpIndex = 1;
  for (let i = 1; i < block.cells.length; i += 1) {
    if (DP_CLIENT_RE.test(block.cells[i].text)) {
      dpIndex = i;
      break;
    }
  }
  const dpText = block.cells[dpIndex].text;
  const identifiers = DP_CLIENT_RE.exec(dpText);
  const dpId = identifiers ? identifiers[1] : '';
  const clientId = identifiers ? identifiers[2] : '';

  const brokerLines = dpText.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !DP_CLIENT_RE.test(line));
  let broker;
  if (brokerLines.length) {
    broker = brokerLines[0];
  } else if (dpIndex >= 2) {
    broker = block.cells[dpIndex - 1].text.trim();
  } else {
    broker = '';
  }

  const cells = block.cells;
  const account = new DematAccount({
    name: broker,
    type: fullType(typeWord),
    dp_id: dpId,
    client_id: clientId,
    folios: Number(toDecimal(cells[cells.length - 2].text).toBigInt()),
    balance: toDecimal(cells[cells.length - 1].text),
    owners: [...owners],
    equities: [],
    mutual_funds: [],
    bonds: [],
  });
  return [account, accountKey(typeWord, dpId, clientId)];
}

export function mfFoliosAccountFromSummary(block, owners = []) {
  const countMatch = /(\d+)/.exec(block.cells[1].text);
  return new DematAccount({
    name: 'Mutual Fund Folios',
    type: 'Mutual Fund Folios',
    dp_id: '',
    client_id: '',
    folios: countMatch ? Number(countMatch[1]) : 0,
    balance: toDecimal(block.cells[3].text),
    owners: [...owners],
    equities: [],
    mutual_funds: [],
    bonds: [],
  });
}

// --------------------------------------------------------- per-account headers

/**
 * A per-account header starts a holdings section for one account.
 *
 * Two layouts. A single-name account puts the type and identifiers in one block. A
 * joint-name account splits the header across three consecutive blocks, so up to three
 * are scanned ahead for the identifiers. Paragraph text that merely mentions a demat
 * account is rejected for having too many cells or too little structure.
 *
 * @returns {[string[]|null, number]} the account key and how many blocks it consumed
 */
export function tryPerAccountHeader(blocks, index) {
  const block = blocks[index];
  const text = block.text();
  const typeMatch = /\b(NSDL|CDSL)\b\s+Demat\s+Account/i.exec(text);
  if (!typeMatch) return [null, 1];

  const identifiers = DP_CLIENT_RE.exec(text);
  if (identifiers && block.cells.length >= 3 && block.cells.length <= 8 && text.length < 500) {
    return [accountKey(typeMatch[1], identifiers[1], identifiers[2]), 1];
  }

  const lower = text.toLowerCase();
  if (lower.includes('account holders') || lower.includes('account holder')) {
    for (let ahead = 1; ahead < 4; ahead += 1) {
      if (index + ahead >= blocks.length) break;
      const next = blocks[index + ahead];
      if (next.page !== block.page) break;
      const found = DP_CLIENT_RE.exec(next.text());
      if (found) return [accountKey(typeMatch[1], found[1], found[2]), ahead + 1];
    }
  }
  return [null, 1];
}

/**
 * The holdings mode a column-header row implies, or null if it is not one.
 *
 * `section` comes from the most recent marker block and is what tells the detailed table
 * headers apart: their column sets are identical for equities, funds and bonds.
 */
export function detectModeFromHeader(block, section = null) {
  if (ISIN_ANYWHERE_RE.test(block.text())) return null; // carries an ISIN, so it is data
  const text = block.text().toLowerCase().replace(/\n/g, ' ').replace(/\t\t/g, ' ');

  // The fund-folio table first: its header also carries "ISIN Description" and a folio
  // column, so the simpler folio test would claim it.
  if (text.includes('folio no') && (text.includes('average') || text.includes('total cost'))) {
    return 'mf_holdings';
  }
  if (text.includes('current bal') && (text.includes('market price') || text.includes('value in'))) {
    if (section === 'bonds') return 'bonds_detailed';
    if (section === 'mfunds') return 'mfunds_detailed';
    return 'equities_detailed';
  }
  if (text.includes('coupon') && (text.includes('maturity') || text.includes('frequency'))) {
    return 'bonds_summary';
  }
  if (text.includes('stock symbol') && text.includes('company name')) return 'equities_summary';
  if (text.includes('isin description') && (text.includes('nav') || text.includes('value in'))) {
    return 'mfunds_summary';
  }
  return null;
}

/**
 * Section markers are short blocks naming what the following table holds. Sections absent
 * from this map are still recognised as markers so the rows under them are ignored rather
 * than misrouted into the previous section's list.
 */
const SECTION_MARKER_MAP = {
  'equity shares': 'equities',
  'equities (e)': 'equities',
  'mutual funds (m)': 'mfunds',
  'mutual funds units held with the amc': 'mfunds',
  'corporate bonds (c)': 'bonds',
  /*
   * A government security is laid out exactly as a corporate bond: an ISIN, a description
   * carrying the coupon and the maturity, the balance columns, then a market price and a
   * value. So it reads with the bond parsers rather than needing its own, and the caller
   * tells a G-Sec from a corporate bond by the ISIN, which starts IN0 rather than INE.
   */
  'government securities (g)': 'bonds',
};

const UNSUPPORTED_SECTION_MARKERS = new Set([
  'preference shares (p)',
  'alternate investment fund (a)',
  'money market instruments (i)',
  'securitised instruments (s)',
  'postal saving scheme (o)',
  'zero coupon zero principal(z)',
]);

export function sectionMarkerKind(block) {
  if (block.cells.length > 2) return null;
  const text = block.text().trim().toLowerCase();
  if (SECTION_MARKER_MAP[text]) return SECTION_MARKER_MAP[text];
  if (UNSUPPORTED_SECTION_MARKERS.has(text)) return 'unsupported';
  return null;
}

// -------------------------------------------------------------- generic helpers

export function findPeriod(blocks) {
  for (const block of blocks) {
    const match = PERIOD_RE.exec(block.text());
    if (match) return new StatementPeriod({ from: match[1], to: match[2] });
  }
  return null;
}

/** A column-label row: no ISIN, several recognisable header words. */
export function isTableHeader(block) {
  const text = block.text().toLowerCase().replace(/\t\t/g, ' ').replace(/\n/g, ' ');
  if (ISIN_ANYWHERE_RE.test(text)) return false;
  const keywords = [
    'isin description', 'no. of\nunits', 'no. of\nshares', 'stock symbol', 'current bal',
    'free bal', 'market price', 'value in', 'total cost', 'current nav', 'unrealised',
    'annualised', 'isin description folio', 'isin description no.',
  ];
  const raw = block.text().toLowerCase();
  return keywords.filter((keyword) => text.includes(keyword) || raw.includes(keyword)).length >= 2;
}

export function isTotalRow(block) {
  const first = block.cells.length ? block.cells[0].text.trim().toLowerCase() : '';
  return first === 'sub total' || first === 'total' || first === 'grand total';
}

// ------------------------------------------------------------------ equity rows

/**
 * An equity row. The first cell carries the ISIN, sometimes with a ticker on a second
 * line, and the trailing cells are numbers.
 *
 * The summary form prints four: face value, quantity, price, value, so the last three are
 * taken. The detailed form prints eleven balance columns before the price and the value,
 * so the quantity is the first of them.
 */
export function parseEquityRow(block, detailed = false) {
  if (!block.cells.length) return null;
  const firstToken = block.cells[0].text.split('\n')[0].trim();
  if (!ISIN_RE.test(firstToken)) return null;

  const name = block.cells.length > 1
    ? block.cells[1].text.replace(/\n/g, ' ').trim()
    : null;

  const numerics = block.cells.slice(2)
    .filter((cell) => looksNumeric(cell.text))
    .map((cell) => cell.text.trim());
  if (numerics.length < 3) return null;

  let price = toDecimal(numerics[numerics.length - 2]);
  const value = toDecimal(numerics[numerics.length - 1]);

  let numShares;
  if (detailed || numerics.length >= 9) {
    numShares = toDecimal(numerics[0]);
  } else if (numerics.length === 4) {
    numShares = toDecimal(numerics[numerics.length - 3]);
  } else {
    // A pledged or sub-balance row prints extra leading numbers before the price and the
    // value, so pick the quantity that closes quantity times price against the value.
    const candidates = numerics.slice(0, -2).map(toDecimal);
    numShares = pickBalanceClosing(candidates, price, value);
  }

  if (numShares.gt(0) && value.gt(0) && !holdingsValueCloses(numShares, price, value)) {
    price = value.div(numShares);
  }

  return new Equity({ name, isin: firstToken, num_shares: numShares, price, value });
}

// ------------------------------------------------- summary fund row (per account)

export function parseSummaryMfRow(block) {
  if (!block.cells.length) return null;
  const isin = block.cells[0].text.trim();
  if (!ISIN_RE.test(isin)) return null;

  const name = block.cells.length > 1
    ? block.cells[1].text.replace(/\n/g, ' ').trim()
    : null;
  const numerics = block.cells.slice(2)
    .filter((cell) => looksNumeric(cell.text))
    .map((cell) => cell.text.trim());
  if (numerics.length < 3) return null;

  // This table prints units, NAV and value in that order, so the last two are always the
  // NAV and the value. A pledged holding prints an extra leading number — the total and
  // the pledged part, in no fixed order across statements — so the balance is picked
  // arithmetically rather than positionally.
  let nav = toDecimal(numerics[numerics.length - 2]);
  const value = toDecimal(numerics[numerics.length - 1]);
  const candidates = numerics.slice(0, -2).map(toDecimal);
  const balance = pickBalanceClosing(candidates, nav, value);

  // If the NAV was mis-captured but the balance and the value are trustworthy, recover it
  // from the identity, the same way the detailed path does.
  if (balance.gt(0) && value.gt(0) && !holdingsValueCloses(balance, nav, value)) {
    nav = value.div(balance);
  }
  return new MutualFund({ name, isin, balance, nav, value });
}

// ----------------------------------------------------- detailed fund holdings row

function relClose(a, b, rel = Decimal.parse('0.005')) {
  if (b.isZero()) return a.abs().lte(Decimal.parse('0.01'));
  return a.sub(b).abs().div(b.abs()).lte(rel);
}

function isinCellIndex(block) {
  for (let i = 0; i < block.cells.length; i += 1) {
    const first = block.cells[i].text.split('\n')[0].trim();
    if (INF_ISIN_RE.test(first)) return i;
  }
  return null;
}

function isFolioToken(text) {
  const value = String(text ?? '').trim().replace(/,/g, '');
  if (!value) return false;
  if (FOLIO_TAIL_RE.test(value)) return true;
  return /^\d+$/.test(value) && value.length >= 4;
}

/** True when `balance * nav` reproduces `value` within the statement's own rounding. */
export function holdingsValueCloses(balance, nav, value) {
  if (!balance.gt(0) || !nav.gt(0) || !value.gt(0)) return false;
  const derived = balance.mul(nav);
  const tolerance = [Decimal.parse('0.01'), value.abs().mul(Decimal.parse('0.005'))]
    .reduce((a, b) => (a.gt(b) ? a : b));
  return derived.sub(value).abs().lte(tolerance);
}

/**
 * Picks the true unit balance from several candidates.
 *
 * A pledged holding prints both the total and the pledged part, and only one of them
 * satisfies `balance * nav ~= value`. Failing that, the largest positive amount, since a
 * total is never smaller than a part of it.
 */
export function pickBalanceClosing(candidates, nav, value) {
  if (!candidates.length) return ZERO;
  let pool = candidates.filter((c) => c.gt(0));
  if (!pool.length) pool = [...candidates];

  if (nav.gt(0) && value.gt(0)) {
    const closed = pool.filter((c) => holdingsValueCloses(c, nav, value));
    if (closed.length === 1) return closed[0];
  }
  return pool.reduce((best, current) => (current.gt(best) ? current : best));
}

/**
 * Chooses the market value when the value band caught extras.
 *
 * Some rows render the value twice — a full amount at a lower x and a truncated fragment
 * at a higher one — and occasionally echo the total cost nearby. Drop the cost echoes
 * first, then prefer the candidate that closes the identity, otherwise the largest.
 */
function pickMfHoldingsValue(balance, nav, totalCost, valueCandidates) {
  if (!valueCandidates.length) return ZERO;
  if (valueCandidates.length === 1) return valueCandidates[0];

  let candidates = [...valueCandidates];
  const positives = candidates.filter((v) => v.gt(0));
  if (positives.length) candidates = positives;

  if (totalCost && totalCost.gt(0) && candidates.length > 1) {
    const filtered = candidates.filter((v) => v.sub(totalCost).abs().div(totalCost).gt(ECHO_REL_EPS)
      || (balance.gt(0) && nav.gt(0) && holdingsValueCloses(balance, nav, v)));
    candidates = filtered.length ? filtered : (positives.length ? positives : [...valueCandidates]);
  }

  if (balance.gt(0) && nav.gt(0)) {
    const closed = candidates.filter((v) => holdingsValueCloses(balance, nav, v));
    if (closed.length === 1) return closed[0];
  }
  return candidates.reduce((best, current) => (current.gt(best) ? current : best));
}

/** Splits a detailed fund holdings row into its identity fields and a numeric tail. */
function partitionMfHoldingsRow(block) {
  if (!block.cells.length) return null;
  const isinIndex = isinCellIndex(block);
  if (isinIndex === null) return null;

  const lines = block.cells[isinIndex].text.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const isin = lines[0];
  let ucc = lines.length > 1 ? lines[1] : null;
  const needsUcc = ucc === null || PLACEHOLDER_UCCS.has(ucc.toUpperCase());

  let name = null;
  if (isinIndex > 0) {
    const parts = block.cells.slice(0, isinIndex)
      .filter((cell) => cell.text.trim())
      .map((cell) => cell.text.replace(/\n/g, ' ').trim());
    if (parts.length) name = parts.join(' ') || null;
  }

  let index = isinIndex + 1;
  if (name === null && index < block.cells.length) {
    const cell = block.cells[index];
    if (!isFolioToken(cell.text) && !looksNumeric(cell.text)) {
      name = cell.text.replace(/\n/g, ' ').trim() || null;
      index += 1;
    }
  }

  let folio = null;
  if (index < block.cells.length && isFolioToken(block.cells[index].text)) {
    folio = block.cells[index].text.trim().replace(/,/g, '');
    index += 1;
    if (index < block.cells.length) {
      const tail = block.cells[index].text.trim();
      if (FOLIO_TAIL_RE.test(tail)) {
        folio += tail;
        index += 1;
      }
    }
  }

  // Skip the distributor label cells before the units column.
  while (index < block.cells.length && !looksNumeric(block.cells[index].text)) index += 1;

  const clusterCells = [];
  let clusterStartX = null;
  while (index < block.cells.length) {
    const cell = block.cells[index];
    if (!looksNumeric(cell.text)) break;
    if (!clusterCells.length) {
      clusterStartX = cell.xLeft;
      clusterCells.push(cell);
      index += 1;
      continue;
    }
    const text = cell.text.trim();
    if (Math.abs(cell.xLeft - clusterStartX) <= UNITS_CLUSTER_X_EPS && text && text.length <= 2) {
      clusterCells.push(cell);
      index += 1;
    } else {
      break;
    }
  }

  let balance = ZERO;
  if (clusterCells.length) {
    const amounts = clusterCells.map((cell) => [toDecimal(cell.text), cell]);
    balance = amounts.reduce((best, [amount]) => (amount.gt(best) ? amount : best), amounts[0][0]);
    if (needsUcc && amounts.length > 1) {
      for (const [amount, cell] of amounts) {
        const text = cell.text.trim();
        if (text && text.length <= 2 && amount.lt(balance)) {
          ucc = text;
          break;
        }
      }
    } else if (amounts.length === 1) {
      balance = amounts[0][0];
    }
  }

  const tail = [];
  for (const cell of block.cells.slice(index)) {
    if (looksNumeric(cell.text)) tail.push([cell.xLeft, toDecimal(cell.text)]);
  }
  tail.sort((a, b) => a[0] - b[0]);

  return { isin, ucc, name, folio, balance, tail };
}

/** Adjacent closing pairs, plus the case with one cell between the NAV and the value. */
function closingNavValuePairs(balance, tail) {
  const pairs = [];
  for (let i = 0; i < tail.length - 1; i += 1) {
    if (holdingsValueCloses(balance, tail[i][1], tail[i + 1][1])) {
      pairs.push([i, tail[i][1], tail[i + 1][1]]);
    }
  }
  for (let i = 0; i < tail.length - 2; i += 1) {
    if (holdingsValueCloses(balance, tail[i][1], tail[i + 2][1])) {
      pairs.push([i, tail[i][1], tail[i + 2][1]]);
    }
  }
  return pairs;
}

/**
 * True when `fragment` is `value` with its leading digit group clipped.
 *
 * A large value is sometimes printed beside a truncated copy of itself. The fragment
 * shares the low-order digits, so the difference is an exact multiple of ten to the power
 * of the fragment's digit count. The only threshold is structural: the fragment needs at
 * least four integer digits to be a rupee amount rather than a small percentage.
 */
function isTruncatedValueFragment(fragment, value) {
  if (!fragment.gt(0) || fragment.gte(value)) return false;
  const digits = fragment.toBigInt().toString().length;
  if (digits < 4) return false;
  const power = Decimal.parse(`1${'0'.repeat(digits)}`);
  return value.sub(fragment).mod(power).isZero();
}

/**
 * Drops truncated fragments left in the tail once the value is settled. A number matching
 * the profit identity is always kept.
 */
function dropValueFragments(remaining, lockedValue, totalCost = null) {
  if (!lockedValue.gt(0)) return remaining;
  const expectedPnl = totalCost && totalCost.gt(0) ? lockedValue.sub(totalCost) : null;
  return remaining.filter((r) => (expectedPnl !== null && relClose(r, expectedPnl))
    || !isTruncatedValueFragment(r, lockedValue));
}

/** Reads NAV, value, average cost, total cost, profit and return out of a numeric tail. */
function resolveMfHoldingsTail(balance, tail, isin, parseWarnings) {
  let nav = ZERO;
  let value = ZERO;
  let navIndex = null;
  let valueIndex;

  if (!tail.length) return [nav, value, null, null, null, null];

  const pairs = closingNavValuePairs(balance, tail);
  if (pairs.length) {
    // The rightmost closing pair wins: a spurious cost pair always sits to its left.
    let best = pairs[0];
    for (const pair of pairs) {
      if (pair[0] > best[0]) best = pair;
    }
    [navIndex, nav, value] = best;
    valueIndex = navIndex + 1;
    for (let j = navIndex + 1; j < tail.length; j += 1) {
      if (tail[j][1].eq(value)) {
        valueIndex = j;
        break;
      }
    }
  } else {
    valueIndex = 0;
    for (let i = 1; i < tail.length; i += 1) {
      if (tail[i][1].gt(tail[valueIndex][1])) valueIndex = i;
    }
    value = tail[valueIndex][1];
    nav = balance.gt(0) ? value.div(balance) : ZERO;
    parseWarnings.push(
      `MF holdings ${isin}: no closing nav/value pair; inferred from max tail`,
    );
  }

  const costTail = navIndex !== null && navIndex < tail.length
    ? tail.slice(0, navIndex)
    : tail.slice(0, Math.min(2, valueIndex || 0));

  let avgCost = null;
  let totalCost = null;
  if (costTail.length >= 2) {
    avgCost = costTail[costTail.length - 2][1];
    totalCost = costTail[costTail.length - 1][1];
  } else if (costTail.length === 1) {
    totalCost = costTail[0][1];
  }
  if (navIndex !== null && valueIndex === navIndex + 2
    && valueIndex < tail.length) {
    totalCost = tail[navIndex + 1][1];
  }

  const valueCandidates = [value];
  const valueX = tail[valueIndex][0];
  tail.forEach(([x, candidate], j) => {
    if (j !== valueIndex && Math.abs(x - valueX) <= VALUE_COL_X_EPS) {
      valueCandidates.push(candidate);
    }
  });
  value = pickMfHoldingsValue(balance, nav, totalCost, valueCandidates);
  if (balance.gt(0) && value.gt(0) && !holdingsValueCloses(balance, nav, value)) {
    nav = value.div(balance);
  }

  const consumed = new Set();
  if (navIndex !== null) {
    for (let j = 0; j <= navIndex; j += 1) consumed.add(j);
    consumed.add(valueIndex);
    if (valueIndex === navIndex + 2) consumed.add(navIndex + 1);
  } else {
    for (let j = 0; j < Math.min(2, valueIndex); j += 1) consumed.add(j);
    consumed.add(valueIndex);
  }
  tail.forEach(([x, candidate], j) => {
    if (consumed.has(j)) return;
    if (Math.abs(x - valueX) <= VALUE_COL_X_EPS
      && valueCandidates.some((c) => c.eq(candidate)) && !candidate.eq(value)) {
      consumed.add(j);
    }
  });

  let remaining = tail
    .map(([, amount], j) => (consumed.has(j) ? null : amount))
    .filter((amount) => amount !== null && !amount.isZero());
  remaining = dropValueFragments(remaining, value, totalCost);

  let pnl = null;
  let returns = null;
  if (remaining.length === 1) {
    const only = remaining[0];
    if (totalCost && totalCost.gt(0)) {
      const expectedPnl = value.sub(totalCost);
      if (relClose(only, expectedPnl)) {
        pnl = only;
      } else if (only.abs().lt(Decimal.parse('50'))) {
        // Last-resort tie-break for a single trailing number that fails the identity: a
        // small magnitude reads as a percentage, anything larger as a rupee figure. Both
        // fields are soft, so a rare misclassification here is not fatal.
        returns = only;
      } else {
        pnl = only;
      }
    } else {
      pnl = only;
    }
  } else if (remaining.length >= 2) {
    if (totalCost && totalCost.gt(0)) {
      const expectedPnl = value.sub(totalCost);
      for (const candidate of remaining) {
        if (relClose(candidate, expectedPnl)) {
          pnl = candidate;
          break;
        }
      }
      let others = remaining.filter((r) => pnl === null || !r.eq(pnl));
      if (pnl !== null && others.length) {
        returns = others[others.length - 1];
      } else if (pnl === null) {
        pnl = remaining.reduce((best, current) => (current.sub(expectedPnl).abs()
          .lt(best.sub(expectedPnl).abs()) ? current : best));
        others = remaining.filter((r) => !r.eq(pnl));
        returns = others.length ? others[others.length - 1] : null;
      }
    } else {
      pnl = remaining[0];
      returns = remaining[remaining.length - 1];
    }
  }

  return [nav, value, avgCost, totalCost, pnl, returns];
}

/**
 * A detailed holdings row: ISIN, client code, scheme name, folio, then a numeric tail.
 *
 * Columns resolve by ISIN position, token shape and arithmetic, never by fixed x bands. A
 * lone client-code digit sitting at the units position is folded back into its field when
 * the ISIN cell carried a placeholder instead.
 */
export function parseMfHoldingsRow(block, parseWarnings = null) {
  const part = partitionMfHoldingsRow(block);
  if (part === null) return null;

  const warnings = parseWarnings || [];
  const [nav, value, avgCost, totalCost, pnl, returns] = resolveMfHoldingsTail(
    part.balance, part.tail, part.isin, warnings,
  );

  return new MutualFund({
    name: part.name,
    isin: part.isin,
    balance: part.balance,
    nav,
    value,
    avg_cost: avgCost,
    total_cost: totalCost,
    ucc: part.ucc,
    folio: part.folio,
    pnl,
    return: returns,
  });
}

// -------------------------------------------------------- detailed fund row (CDSL)

/**
 * A detailed "Mutual Funds (M)" row on a CDSL account page: the same wide layout as a
 * detailed equity row, but with a fund ISIN. The quantity becomes the balance and the
 * last two numbers are the NAV and the value.
 */
export function parseDetailedMfRow(block) {
  if (!block.cells.length) return null;
  const isin = block.cells[0].text.trim();
  if (!INF_ISIN_RE.test(isin)) return null;

  const name = block.cells.length > 1 ? block.cells[1].text.replace(/\n/g, ' ').trim() : null;
  const numerics = block.cells.slice(2)
    .filter((cell) => looksNumeric(cell.text))
    .map((cell) => cell.text.trim());
  if (numerics.length < 3) return null;

  return new MutualFund({
    name,
    isin,
    balance: toDecimal(numerics[0]),
    nav: toDecimal(numerics[numerics.length - 2]),
    value: toDecimal(numerics[numerics.length - 1]),
  });
}

// -------------------------------------------------------------------- bond rows

/**
 * A summary bonds row, eight data cells, mapped to columns by position. Two cells share
 * the coupon band: the text one is the frequency, the numeric one is the rate.
 */
export function parseBondSummaryRow(block) {
  if (!block.cells.length) return null;
  const isin = block.cells[0].text.split('\n')[0].trim();
  if (!ISIN_RE.test(isin)) return null;

  const byColumn = new Map();
  for (const cell of block.cells) {
    const key = bondSummaryColumn(cell);
    if (!key) continue;
    if (!byColumn.has(key)) byColumn.set(key, []);
    byColumn.get(key).push(cell);
  }

  let name = null;
  if (byColumn.has('name')) {
    name = byColumn.get('name')
      .map((cell) => cell.text.replace(/\n/g, ' ').trim())
      .join(' ')
      .trim() || null;
  }

  let couponRate = null;
  let couponFrequency = null;
  for (const cell of byColumn.get('coupon_band') || []) {
    if (looksNumeric(cell.text)) {
      couponRate = optDecimal(cell.text);
    } else {
      const text = cell.text.replace(/\n/g, ' ').trim();
      if (text) couponFrequency = text;
    }
  }

  const maturity = byColumn.has('maturity') ? byColumn.get('maturity')[0].text.trim() || null : null;

  return new Bond({
    name,
    isin,
    num_bonds: byColumn.has('num_bonds') ? toDecimal(byColumn.get('num_bonds')[0].text) : ZERO,
    value: byColumn.has('value') ? toDecimal(byColumn.get('value')[0].text) : ZERO,
    face_value: byColumn.has('face_value') ? optDecimal(byColumn.get('face_value')[0].text) : null,
    coupon_rate: couponRate,
    coupon_frequency: couponFrequency,
    maturity_date: maturity,
  });
}

/**
 * A detailed bonds row, the same wide layout as a detailed equity row. It yields only the
 * quantity, the market price and the value: the detailed table carries no coupon,
 * maturity or face-value information.
 */
/*
 * One National Pension System scheme.
 *
 * The columns are the fund manager, the scheme, the units held, the current NAV and the
 * current value. There is no ISIN anywhere in this table, which is why every other row
 * parser here rejects these rows outright: they all key on one.
 *
 * The three numbers are taken from the end rather than by position, so a statement that
 * prints an extra column in front does not shift the reading.
 */
export function parseNpsRow(block) {
  if (block.cells.length < 3) return null;

  const texts = block.cells.map((cell) => String(cell.text ?? '').replace(/\n/g, ' ').trim());
  const numerics = texts.filter((text) => looksNumeric(text));
  if (numerics.length < 3) return null;

  const words = texts.filter((text) => !looksNumeric(text) && /[A-Za-z]{3}/.test(text));
  if (!words.length) return null;

  /*
   * A subtotal carries the same three numbers as a holding and must not become one. The
   * word can sit anywhere in the row and in any cell: this table prints "Tier I Total" as
   * readily as "Total", so anchoring the test to the start of a cell missed it and the
   * pension total came out one row too high.
   */
  if (texts.some((text) => /\btotals?\b/i.test(text))) return null;

  const [units, nav, value] = numerics.slice(-3);
  // The scheme and the fund manager arrive as one cell, not two, so the manager is read
  // back out of the name rather than taken from a column of its own.
  const scheme = words.length > 1 ? words[1] : words[0];
  const manager = NPS_MANAGER_RE.exec(scheme);
  const tier = /tier\s*[-:]?\s*(i{1,2}|1|2)\b/i.exec(texts.join(' '));
  const assetClass = /\bscheme\s+([EGCA])\b/i.exec(scheme);

  return new NPSScheme({
    scheme,
    fund_manager: manager ? manager[1].trim() : (words.length > 1 ? words[0] : null),
    tier: tier ? tier[1].toUpperCase() : null,
    asset_class: assetClass ? assetClass[1].toUpperCase() : null,
    units: toDecimal(units),
    nav: toDecimal(nav),
    value: toDecimal(value),
  });
}

export function parseBondDetailedRow(block) {
  if (!block.cells.length) return null;
  const isin = block.cells[0].text.trim();
  if (!ISIN_RE.test(isin)) return null;

  const name = block.cells.length > 1 ? block.cells[1].text.replace(/\n/g, ' ').trim() : null;
  const numerics = block.cells.slice(2)
    .filter((cell) => looksNumeric(cell.text))
    .map((cell) => cell.text.trim());
  if (numerics.length < 3) return null;

  return new Bond({
    name,
    isin,
    num_bonds: toDecimal(numerics[0]),
    value: toDecimal(numerics[numerics.length - 1]),
    market_price: optDecimal(numerics[numerics.length - 2]),
  });
}
