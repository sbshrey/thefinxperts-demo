import { parseAmount } from './assistant-clarify.mjs?v=471b6d5981eb';
import { asVersionTwo } from './assistant-save.mjs?v=471b6d5981eb';
import { validReserve, reserveMonths } from './reserve.mjs?v=471b6d5981eb';

const amount = raw => /^(?:₹\s*)?0$/.test(raw.trim()) ? 0 : parseAmount(raw);

/** Recognize only explicit portfolio-wide reserve totals, never account details. */
export function parseAssistantReserveFact(message) {
  if (typeof message !== 'string' || message.length > 1500) return null;
  const input = message.trim();
  if (/^(?:clear|forget) (?:my )?(?:reserve|emergency buffer)[.!]?$/i.test(input))
    return { clear: true };
  const essentials = /^monthly essentials(?: (?:are|is))?\s+(.+?)[.!]?$/i.exec(input);
  const accessible = /^accessible money outside (?:my )?(?:holdings|investments)(?: (?:is|are))?\s+(.+?)[.!]?$/i.exec(input);
  if (!essentials && !accessible) return null;
  const field = essentials ? 'monthlyEssentials' : 'accessibleMoney';
  const value = amount((essentials || accessible)[1]);
  if (value === null || value > (essentials ? 100_000_000 : 10_000_000_000) ||
      (essentials && value <= 0))
    return { error: essentials ?
      'Enter positive monthly essential spending in rupees, such as “monthly essentials ₹50,000”.' :
      'Enter accessible money outside the reviewed holdings in rupees, including 0, such as “accessible money outside holdings ₹3 lakh”.' };
  return { facts: { [field]: value } };
}

export function nextAssistantReserveQuestion(saved, pending = {}) {
  const combined = { ...saved?.reserve, ...pending };
  if (combined.monthlyEssentials === undefined)
    return 'What are your monthly essential expenses? Reply “monthly essentials ₹50,000”.';
  if (combined.accessibleMoney === undefined)
    return 'How much accessible money is outside the holdings in this review? Reply “accessible money outside holdings ₹3 lakh” or 0.';
  return 'Check both totals shown above, then save them. This is arithmetic, not a judgement that the reserve is enough.';
}

/** Return a new saved portfolio only after both user-supplied totals are confirmed. */
export function prepareAssistantReserveSave(saved, pending, { newId = () => crypto.randomUUID() } = {}) {
  const portfolio = asVersionTwo(saved, newId);
  if (!portfolio) return { portfolio: null, errors: ['The saved review needs a format check.'] };
  if (pending?.clear === true) {
    if (!portfolio.reserve) return { portfolio: null, errors: ['No separate reserve is saved.'] };
    delete portfolio.reserve;
    return { portfolio, errors: [], description: 'Remove the two separate reserve totals from this review. Holdings and goals will not change.',
      result: 'The separate reserve totals were removed. Holdings and goals did not change.' };
  }
  if (!pending || Object.keys(pending).some(key => !['monthlyEssentials', 'accessibleMoney'].includes(key)))
    return { portfolio: null, errors: ['Only monthly essentials and accessible money totals can be saved.'] };
  const reserve = { ...portfolio.reserve, ...pending };
  if (!validReserve(reserve))
    return { portfolio: null, errors: ['Enter both valid rupee totals before saving the separate reserve.'] };
  if (portfolio.reserve?.monthlyEssentials === reserve.monthlyEssentials &&
      portfolio.reserve?.accessibleMoney === reserve.accessibleMoney)
    return { portfolio: null, errors: ['These two reserve totals already match the saved review.'] };
  portfolio.reserve = reserve;
  return { portfolio, errors: [],
    description: `Save monthly essentials ₹${reserve.monthlyEssentials.toLocaleString('en-IN')} and accessible money outside these holdings ₹${reserve.accessibleMoney.toLocaleString('en-IN')}. This is ${reserveMonths(reserve).toFixed(1)} months by division only. Check that this money is separate from the holdings above and actually accessible; no account or debt was verified.`,
    result: `The separate reserve totals now show ${reserveMonths(reserve).toFixed(1)} months of entered essential spending. This is not a suitability assessment.` };
}
