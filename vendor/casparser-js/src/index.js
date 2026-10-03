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

export { readCasPdf } from './parsers/index.js?v=ee09fedbeb53';
export { cas2csv, cas2csvSummary, cas2json, isClose } from './parsers/utils.js?v=ee09fedbeb53';

export { CASFileType, FileType, FundType, GainType, TransactionType } from './enums.js?v=ee09fedbeb53';

export {
  CASIntegrityError,
  CASParseError,
  GainsError,
  HeaderParseError,
  IncompleteCASError,
  IncorrectPasswordError,
  ParserException,
} from './exceptions.js?v=ee09fedbeb53';

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
} from './types.js?v=ee09fedbeb53';

export { D, Decimal, DecimalError } from './decimal.js?v=ee09fedbeb53';
export { CasDate } from './dates.js?v=ee09fedbeb53';

export { getPdfBackend, setPdfBackend } from './pdf/backend.js?v=ee09fedbeb53';
export { createPdfjsBackend } from './pdf/pdfjs.js?v=ee09fedbeb53';

export {
  MemoryIsinDb,
  batchEquitySymbols,
  batchIsinMetadata,
  getIsinProvider,
  isinSearch,
  navSearch,
  setIsinProvider,
} from './isin.js?v=ee09fedbeb53';

export {
  SchemeNotFoundError,
  SqlIsinDb,
} from './isin-db.js?v=ee09fedbeb53';

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
} from './analysis/index.js?v=ee09fedbeb53';

export { extractGiftFolio, getParsedSchemeName, getTransactionType } from './parsers/classify.js?v=ee09fedbeb53';
export { detectCasType, detectFileType } from './parsers/detect.js?v=ee09fedbeb53';
