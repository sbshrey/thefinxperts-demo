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
  if (/^clear goal mix[.!]?$/i.test(input)) return { facts: { targetMix: null } };
  const mixRequest = /^(?:my )?(?:goal|target) mix(?: is)?\s+(.+?)[.!]?$/i.exec(input);
  if (mixRequest) {
    const parts = mixRequest[1].split(/\s*(?:,|\band\b)\s*/i).filter(Boolean);
    const mix = { Equity: 0, Debt: 0, Gold: 0, Other: 0 };
    const seen = new Set();
    for (const part of parts) {
      const match = /^(\d{1,3})%\s+(equity|debt|gold|other)$/i.exec(part.trim());
      if (!match) return { error: 'Use named percentages, such as “goal mix 60% equity, 30% debt, 10% gold”.' };
      const asset = match[2][0].toUpperCase() + match[2].slice(1).toLowerCase();
      const share = Number(match[1]);
      if (seen.has(asset) || share > 100)
        return { error: 'Give each asset category once, with a percentage from 0 to 100.' };
      seen.add(asset);
      mix[asset] = share;
    }
    if (!parts.length || Object.values(mix).reduce((sum, share) => sum + share, 0) !== 100)
      return { error: 'Your chosen goal mix must total 100%. The site cannot choose a mix for you.' };
    return { facts: { targetMix: mix } };
  }
  const fallRequest = /^(?:test )?(?:equity fall|equity drop)(?: of)?\s+(.+?)[.!]?$/i.exec(input);
  if (fallRequest) {
    const percentage = /^(\d{1,2}(?:\.\d{1,2})?)%$/.exec(fallRequest[1].trim());
    const value = Number(percentage?.[1]);
    if (!percentage || value < 0 || value > 60)
      return { error: 'Choose a hypothetical equity fall from 0% to 60%, such as “equity fall 25%”.' };
    return { facts: { equityDropPct: value } };
  }
  const limitRequest = /^loss i can (cover|tolerate)\s+(.+?)[.!]?$/i.exec(input);
  if (limitRequest) {
    const raw = limitRequest[2].trim();
    const value = /^(?:₹\s*)?0$/.test(raw) ? 0 : parseAmount(raw);
    if (value === null || value > 10_000_000_000)
      return { error: 'Enter an amount in rupees for the loss you can cover or tolerate, such as “loss I can cover ₹50,000”.' };
    return { facts: { [limitRequest[1].toLowerCase() === 'cover' ? 'affordableLoss' : 'tolerableLoss']: value } };
  }
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
