import { parseAmount } from './assistant-clarify.mjs';
import { removeHoldingAllocation } from './goals.mjs';

const money = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const indiaToday = today => new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Deliberate, narrow chat commands; ordinary questions cannot alter confirmed holdings. */
export function parseHoldingCorrection(message, today = new Date()) {
  if (typeof message !== 'string' || message.length > 1500) return null;
  const input = message.trim();
  const remove = /^remove (?:holding )?(.+?)[.!]?$/i.exec(input);
  if (remove) return { kind: 'remove', selector: remove[1].trim() };
  const update = /^(?:update|change|correct) (?:value of )?(.+?) (?:value )?to (.+?) as of (\d{4}-\d{2}-\d{2})[.!]?$/i.exec(input);
  if (update) {
    const value = parseAmount(update[2]);
    const date = update[3];
    const parsed = new Date(`${date}T00:00:00Z`);
    if (value === null || value > 10_000_000_000 || !Number.isFinite(parsed.valueOf()) ||
        parsed.toISOString().slice(0, 10) !== date || date > indiaToday(today)) {
      return { error: 'Use a positive total value up to ₹10,00,00,00,000 and a real, non-future date: “update value of NAME to ₹50,000 as of YYYY-MM-DD”.' };
    }
    return { kind: 'update', selector: update[1].trim(), value, asOf: date };
  }
  if (/^(?:update|change|correct)\b/i.test(input))
    return { error: 'To correct a confirmed row, say “update value of NAME to ₹50,000 as of YYYY-MM-DD”. Use the holding number if its name appears more than once.' };
  return null;
}

function findRow(holdings, selector) {
  const numbered = /^(?:holding\s+)?#?(\d{1,3})$/i.exec(selector);
  if (numbered) {
    const index = Number(numbered[1]) - 1;
    return index >= 0 && index < holdings.length ? { row: holdings[index], index } :
      { error: 'That holding number is not in the current review. Check “Included holdings” on the right.' };
  }
  const wanted = selector.toLocaleLowerCase('en-IN').replace(/\s+/g, ' ').trim();
  const matches = holdings.map((row, index) => ({ row, index })).filter(({ row }) =>
    row.name.toLocaleLowerCase('en-IN').replace(/\s+/g, ' ').trim() === wanted);
  if (!matches.length) return { error: 'No confirmed holding has that exact name. Check “Included holdings” and try its name or number.' };
  if (matches.length > 1) return { error: `That name matches ${matches.length} confirmed rows. Use “holding ${matches[0].index + 1}” or another number shown in Included holdings, then check the preview.` };
  return matches[0];
}

/** Make a previewable, validated portfolio change without touching the original. */
export function prepareHoldingCorrection(saved, command, today = new Date()) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals))
    return { portfolio: null, errors: ['Add a confirmed holding before correcting the review.'] };
  if (!command || !['update', 'remove'].includes(command.kind) ||
      typeof command.selector !== 'string' || !command.selector.trim())
    return { portfolio: null, errors: ['Name the confirmed holding or use its number in Included holdings.'] };
  const match = findRow(saved.holdings, command.selector);
  if (match.error) return { portfolio: null, errors: [match.error] };
  const { row, index } = match;
  const portfolio = structuredClone(saved);
  if (command.kind === 'remove') {
    portfolio.holdings.splice(index, 1);
    portfolio.goals = removeHoldingAllocation(portfolio.goals, row.id);
    delete portfolio.coverage;
    const linkedGoals = saved.goals.filter(goal => goal.linkedIds?.includes(row.id)).map(goal => goal.name);
    return { portfolio, errors: [], description: `Remove holding ${index + 1}: ${row.name} · ${money(row.value)} · ${row.asOf || 'date missing'} from this review. Nothing is traded. ${linkedGoals.length ? `It will also stop counting toward ${linkedGoals.join(', ')}. ` : ''}${saved.coverage ? 'The self-reported coverage answer will be cleared.' : ''}`, result: `${row.name} removed from the confirmed review. Its goal links were cleared.${saved.coverage ? ' The coverage answer was also cleared.' : ''}` };
  }
  const date = typeof command.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(command.asOf) ?
    new Date(`${command.asOf}T00:00:00Z`) : null;
  if (!Number.isFinite(command.value) || command.value <= 0 || command.value > 10_000_000_000 ||
      !date || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== command.asOf ||
      command.asOf > indiaToday(today))
    return { portfolio: null, errors: ['Use a positive dated value for the correction.'] };
  if (row.value === command.value && row.asOf === command.asOf)
    return { portfolio: null, errors: ['That value and date already match the confirmed row.'] };
  const { units: _units, shares: _shares, navEstimate: _navEstimate, stockEstimate: _stockEstimate,
    costBasis: _costBasis, costBasisAsOf: _costBasisAsOf, valuationOrigin: _valuationOrigin,
    ...retained } = portfolio.holdings[index];
  portfolio.holdings[index] = { ...retained, value: command.value, asOf: command.asOf,
    ...(row.type === 'Other investment' ? {} : { valuationOrigin: 'manual' }) };
  const total = portfolio.holdings.reduce((sum, holding) => sum + Number(holding.value), 0);
  if (!Number.isFinite(total) || total > 1_000_000_000_000)
    return { portfolio: null, errors: ['The corrected portfolio total would exceed the supported limit.'] };
  return { portfolio, errors: [], description: `Update holding ${index + 1}: ${row.name} from ${money(row.value)} (${row.asOf || 'date missing'}) to ${money(command.value)} (${command.asOf}). Any saved units or shares, entered price estimates and checked invested cost will be cleared; the new value will be marked as your manual update. Verify those details again if needed.`, result: `${row.name} now uses your manually supplied ${money(command.value)} value dated ${command.asOf}. Any prior units, cost and price estimates were cleared.` };
}
