/**
 * casparser-js: reads Indian consolidated account statements.
 *
 * A statement from CAMS, KFintech, NSDL or CDSL goes in; folios, schemes, transactions,
 * demat holdings and pension holdings come out. Nothing leaves the process: the PDF is
 * parsed where it is opened.
 *
 * Two things have to be wired up before the first call, because both are choices this
 * library should not make for you:
 *
 *     import * as pdfjsLib from 'pdfjs-dist';
 *     import { setPdfBackend, createPdfjsBackend, readCasPdf } from '@chikatina/casparser-js';
 *
 *     setPdfBackend(createPdfjsBackend(pdfjsLib));
 *     const data = await readCasPdf(bytes, 'ABCDE1234F');
 *
 * The second is the ISIN database, which fills in the scheme codes and types a statement
 * does not print. It is optional: without one those fields come back null and everything
 * else parses. See `setIsinProvider`.
 */

export const VERSION = '1.1.0';

export { readCasPdf } from './parsers/index.js?v=ff0e542bbcde';
export { cas2csv, cas2csvSummary, cas2json, isClose } from './parsers/utils.js?v=ff0e542bbcde';

export { CASFileType, FileType, FundType, GainType, TransactionType } from './enums.js?v=ff0e542bbcde';

export {
  CASIntegrityError,
  CASParseError,
  GainsError,
  HeaderParseError,
  IncompleteCASError,
  IncorrectPasswordError,
  ParserException,
} from './exceptions.js?v=ff0e542bbcde';

export {
  Bond,
  CASData,
  DematAccount,
  DematOwner,
  Equity,
  Folio,
  InvestorInfo,
  MODELS,
  MutualFund,
  NPSAccount,
  NPSScheme,
  NSDLCASData,
  Scheme,
  SchemeValuation,
  StatementPeriod,
  TransactionData,
} from './types.js?v=ff0e542bbcde';

export { D, Decimal, DecimalError } from './decimal.js?v=ff0e542bbcde';
export { CasDate } from './dates.js?v=ff0e542bbcde';

export { getPdfBackend, setPdfBackend } from './pdf/backend.js?v=ff0e542bbcde';
export { createPdfjsBackend } from './pdf/pdfjs.js?v=ff0e542bbcde';

export {
  MemoryIsinDb,
  batchEquitySymbols,
  batchIsinMetadata,
  getIsinProvider,
  isinSearch,
  navSearch,
  setIsinProvider,
} from './isin.js?v=ff0e542bbcde';

export {
  SchemeNotFoundError,
  SqlIsinDb,
} from './isin-db.js?v=ff0e542bbcde';

export {
  CII,
  CapitalGainsReport,
  Fund,
  GainEntry,
  GainEntry112A,
  GiftEntry,
  QUARTERLY_CATEGORIES,
  QUARTER_LABELS,
  getFinYear,
  getFundType,
} from './analysis/index.js?v=ff0e542bbcde';

export { extractGiftFolio, getParsedSchemeName, getTransactionType } from './parsers/classify.js?v=ff0e542bbcde';
export { detectCasType, detectFileType } from './parsers/detect.js?v=ff0e542bbcde';
