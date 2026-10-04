import { estimateNavValue, realDate, validUnits } from './nav-estimate.mjs?v=d98a6ab971da';
import { estimateStockValue, validShares } from './stock-estimate.mjs?v=d98a6ab971da';

const indiaToday = now => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Keep a quote question tied to the exact confirmed row and revision that opened it. */
export function beginQuoteFollowUp(row, index, revision) {
  if (!row?.asOf || !realDate(row.asOf) || !Number.isInteger(index) || index < 0) return null;
  const kind = row.type === 'Mutual fund' && row.granularity !== 'fund_house' && validUnits(row.units) ? 'nav' :
    row.type === 'Stock' && validShares(row.shares) ? 'price' : null;
  if (!kind) return null;
  return { kind, index, revision, asOf: row.asOf, quantity: kind === 'nav' ? row.units : row.shares,
    stage: 'amount' };
}

/** Return null for a new question so it can leave the short follow-up cleanly. */
export function advanceQuoteFollowUp(pending, message, now = new Date()) {
  if (!pending || typeof message !== 'string') return null;
  const input = message.trim();
  if (/^(?:cancel|stop|never mind)[.!]?$/i.test(input)) return { cancelled: true };
  const label = pending.kind === 'nav' ? 'NAV' : 'share price';
  if (pending.stage === 'amount') {
    const amount = /^(?:(?:nav|share price|price)\s+(?:is\s+)?)?(?:₹\s*|rs\.?\s*|inr\s*)?([\d,.]+)[.!]?$/i.exec(input)?.[1];
    if (!amount && !/^(?:nav|share price|price)\b/i.test(input)) return null;
    const value = amount?.replaceAll(',', '');
    const validAmount = /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d{1,6})?$/.test(amount || '');
    const estimate = validAmount ? pending.kind === 'nav' ? estimateNavValue(pending.quantity, value) :
      estimateStockValue(pending.quantity, value) : null;
    if (!validAmount || estimate === null)
      return { error: `Enter the checked ${label} as a positive rupee number with up to six decimal places. No value has changed.` };
    return { pending: { ...pending, amount: value, stage: 'date' },
      question: `What is the published date for that ${label}? Reply YYYY-MM-DD. It must be newer than ${pending.asOf}.` };
  }
  if (pending.stage === 'date') {
    const date = /^(?:(?:as of|dated|on)\s+)?(\d{4}-\d{2}-\d{2})[.!]?$/i.exec(input)?.[1];
    if (!date && !/^(?:(?:as of|dated|on)\s+)?\d{4}-/i.test(input)) return null;
    if (!realDate(date) || date <= pending.asOf || date > indiaToday(now))
      return { error: `Use the real ${label} date, newer than ${pending.asOf} and no later than today. No value has changed.` };
    return { command: { kind: pending.kind, selector: `holding ${pending.index + 1}`,
      [pending.kind === 'nav' ? 'nav' : 'price']: pending.amount, asOf: date } };
  }
  return null;
}
