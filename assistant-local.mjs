import { parseAmount } from './assistant-clarify.mjs';

/** Stage one clearly described holding. Missing facts remain missing until the investor supplies them. */
export function parseBrowserHoldingStatement(message, today = new Date()) {
  if (typeof message !== 'string' || /[?\n\r]/.test(message)) return null;
  const opening = /^(?:i (?:own|hold)|my holding is)\s+(.+?)[.!]?$/i.exec(message.trim());
  if (!opening) return null;
  let description = opening[1].trim();
  if (/\b(?:should|buy|sell|switch|recommend|advice)\b/i.test(description)) return null;
  if (/^\d[\d,.]*\s+(?:shares?|units?)\b/i.test(description))
    return { error: 'A share or unit count alone is not a current holding value. Name one fund or stock and share its total value in rupees.' };

  let asOf = null;
  const dated = /\s+as of\s+(.+)$/i.exec(description);
  if (dated) {
    asOf = dated[1].trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new Date(`${asOf}T00:00:00Z`) : null;
    const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    if (!parsed || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== asOf || asOf > indiaToday)
      return { error: 'Use a real, non-future valuation date as YYYY-MM-DD, or leave the date out.' };
    description = description.slice(0, dated.index).trim();
  }

  let value = null;
  const valued = /\s+(?:worth|valued at|with (?:a )?value of)\s+(.+)$/i.exec(description);
  if (valued) {
    value = parseAmount(valued[1]);
    if (value === null) return { error: 'Enter the total current value in rupees, such as ₹50,000 or ₹1 lakh.' };
    description = description.slice(0, valued.index).trim();
  }

  let type = 'Other';
  let match = /^(?:(?:a|an)\s+)?(mutual fund|fund|stock|share)(?:\s+(?:called|named))?\s+(.+)$/i.exec(description);
  if (match) {
    type = /^(?:stock|share)$/i.test(match[1]) ? 'Stock' : 'Mutual fund';
    description = match[2].trim();
  } else {
    match = /^(.+)\s+(mutual fund|stock)$/i.exec(description);
    if (match) {
      type = /stock/i.test(match[2]) ? 'Stock' : 'Mutual fund';
      description = match[1].trim();
    }
  }
  const name = description.replace(/^(?:a|an)\s+/i, '').trim();
  if (name.length < 2 || name.length > 80 || !/[a-z]/i.test(name) ||
      /[<>@\r\n]/.test(name) || /\b[A-Z]{5}\d{4}[A-Z]\b/i.test(name) || /\d{8,}/.test(name) ||
      /\b(?:account|folio|password|pan number)\b/i.test(name))
    return { error: 'Name one fund or stock without an account number, PAN, password or other private identifier.' };
  return { draft: { name, type, asset: type === 'Stock' ? 'Equity' : 'Other', value, asOf,
    entryOrigin: 'manual' } };
}

/** Narrow, explicit goal answers for the browser-only guided review. */
export function parseBrowserGoalFact(message, goal, pending = {}) {
  if (typeof message !== 'string' || !goal) return null;
  const input = message.trim();
  let field;
  let value;
  let match = /^(?:my age is |i am |age )([0-9]{1,3})(?: years old)?[.!]?$/i.exec(input);
  if (match) { field = 'age'; value = Number(match[1]); }
  if (!field) {
    match = /^(?:years(?: until (?:the )?goal)? |in )([0-9]{1,2})(?: years?)?[.!]?$/i.exec(input);
    if (match) { field = 'years'; value = Number(match[1]); }
  }
  if (!field) {
    match = /^(?:target|goal amount|amount needed)(?: is)? ₹?([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s*(lakh|crore))?[.!]?$/i.exec(input);
    if (match) { field = 'target'; value = amount(match[1], match[2]); }
  }
  if (!field && /^[0-9][0-9,]*(?:\.[0-9]{1,2})?$/.test(input)) {
    field = ['age', 'years', 'target'].find(key => goal[key] == null && pending[key] == null);
    value = Number(input.replaceAll(',', ''));
  }
  if (!field) return null;
  const limits = { age: [18, 100], years: [1, 50], target: [1000, 1_000_000_000_000] };
  const [min, max] = limits[field];
  if (!Number.isFinite(value) || value < min || value > max || !Number.isInteger(value))
    return { error: `Check the ${field === 'target' ? 'goal amount in rupees' : field} before using it.` };
  return { facts: { [field]: value } };
}

function amount(digits, unit) {
  const base = Number(digits.replaceAll(',', ''));
  return base * ({ lakh: 100_000, crore: 10_000_000 }[unit?.toLowerCase()] || 1);
}

export function nextBrowserGoalQuestion(goal, pending = {}) {
  if (!goal) return 'Name a goal by saying “create goal named Retirement”.';
  if (goal.age == null && pending.age == null) return 'How old are you now? You can reply “age 32”.';
  if (goal.years == null && pending.years == null) return 'How many years until this goal? You can reply “in 10 years”.';
  if (goal.target == null && pending.target == null) return 'What amount would you need in today’s rupees? You can reply “target 50 lakh”.';
  return 'Check the goal facts shown above, then choose “Save goal facts”.';
}
