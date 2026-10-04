import { parseAmount } from './assistant-clarify.mjs?v=bbabee0a4417';
import { validShares } from './stock-estimate.mjs?v=bbabee0a4417';
import { validUnits } from './nav-estimate.mjs?v=bbabee0a4417';
import { mentionsEmployeeStockAward } from './employee-awards.mjs?v=bbabee0a4417';
import { parseMixPercentages } from './mix-plan.mjs?v=bbabee0a4417';

/** Stage one clearly described holding. Missing facts remain missing until the investor supplies them. */
export function parseBrowserHoldingStatement(message, today = new Date()) {
  if (typeof message !== 'string' || /[?\n\r]/.test(message)) return null;
  const opening = /^(i (?:own|hold|have)|my holding is)\s+(.+?)[.!]?$/i.exec(message.trim());
  if (!opening) return null;
  const hasHolding = /^i have$/i.test(opening[1]);
  let description = opening[2].trim();
  if (/\b(?:should|buy|sell|switch|recommend|advice)\b/i.test(description)) return null;
  if (mentionsEmployeeStockAward(description))
    return { error: 'An employee stock award or option is not enough to count directly held shares. Check the award type, vesting, exercise or settlement, shares actually held, restrictions, currency and a dated INR value. Enter settled shares only from a dated broker or demat record.' };
  if (hasHolding && /\b(?:invested|bought|paid|cost basis)\b/i.test(description))
    return { error: 'An invested or purchase amount is not a current holding value. Name the investment and give its total current value in rupees.' };

  // Accept either order for an explicit valuation date and total value.
  const dateBeforeValue = /\s+as of\s+(.+?)\s*,?\s+(worth|valued at|with (?:a )?value of)\s+(.+)$/i.exec(description);
  if (dateBeforeValue)
    description = `${description.slice(0, dateBeforeValue.index)} ${dateBeforeValue[2]} ${dateBeforeValue[3]} as of ${dateBeforeValue[1]}`;

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

  let shares = null;
  let units = null;
  const shareClaim = /^([\d,]+)\s+shares?\s+(?:of|in)\s+(.+)$/i.exec(description);
  const unitClaim = /^([\d,]+(?:\.\d+)?)\s+units?\s+(?:of|in)\s+(.+)$/i.exec(description);
  if (shareClaim) {
    shares = shareClaim[1].replaceAll(',', '');
    if (!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:,\d{2})*,\d{3})$/.test(shareClaim[1]) ||
        !validShares(shares))
      return { error: 'Use a positive whole share count below 100 crore and name one directly held stock.' };
    description = shareClaim[2].trim();
  } else if (unitClaim) {
    units = unitClaim[1].replaceAll(',', '');
    const whole = unitClaim[1].split('.')[0];
    if (!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:,\d{2})*,\d{3})$/.test(whole) ||
        !validUnits(units))
      return { error: 'Use a positive fund-unit count with up to six decimal places and name one mutual fund.' };
    description = unitClaim[2].trim();
  } else if (/^\d[\d,.]*\s+(?:shares?|units?)\b/i.test(description)) {
    return { error: 'Name one directly held stock after its share count, or name one mutual fund after its unit count.' };
  }

  let type = shares ? 'Stock' : 'Other';
  let asset = shares ? 'Equity' : 'Other';
  const categorizedFund = /^(?:(?:a|an)\s+)?(equity|debt|gold)\s+(?:mutual fund|fund)(?:\s+(?:called|named))?\s+(.+)$/i.exec(description);
  let match = /^(?:(?:a|an)\s+)?(mutual fund|fund|stock|share)(?:\s+(?:called|named))?\s+(.+)$/i.exec(description);
  if (categorizedFund) {
    type = 'Mutual fund';
    asset = categorizedFund[1][0].toUpperCase() + categorizedFund[1].slice(1).toLowerCase();
    description = categorizedFund[2].trim();
  } else if (match) {
    type = /^(?:stock|share)$/i.test(match[1]) ? 'Stock' : 'Mutual fund';
    description = match[2].trim();
  } else {
    match = /^(.+)\s+(mutual fund|stock)$/i.exec(description);
    if (match) {
      type = /stock/i.test(match[2]) ? 'Stock' : 'Mutual fund';
      description = match[1].trim();
    }
  }
  if (type === 'Other') {
    const other = /^(?:(?:a|an)\s+)?(nps|epf|ppf|fixed deposit|bank deposit|physical gold|digital gold)(?:\s+(?:called|named))?\b(.*)$/i.exec(description);
    if (other) {
      type = 'Other investment';
      asset = /gold$/i.test(other[1]) ? 'Gold' : 'Other';
      description = `${other[1]}${other[2] || ''}`.trim();
    }
  }
  if (shares && type !== 'Stock')
    return { error: 'A directly held share count cannot be used as mutual-fund units. Check the investment type and name it again.' };
  if (units && type !== 'Mutual fund')
    return { error: 'Fund units need an explicitly named mutual fund. Say “units of a mutual fund called NAME” after checking the scheme.' };
  if (hasHolding && type === 'Other') return null;
  const name = description.replace(/^(?:a|an)\s+/i, '').trim();
  if (name.length < 2 || name.length > 80 || !/[a-z]/i.test(name) ||
      /^(?:stock|share|shares|mutual fund|fund|equity|debt|gold)$/i.test(name) ||
      /[<>@\r\n]/.test(name) || /\b[A-Z]{5}\d{4}[A-Z]\b/i.test(name) || /\d{8,}/.test(name) ||
      /\b(?:account|folio|password|pan number)\b/i.test(name))
    return { error: 'Name one fund or stock without an account number, PAN, password or other private identifier.' };
  return { draft: { name, type, asset: type === 'Stock' ? 'Equity' : asset, value, asOf,
    entryOrigin: 'manual', ...(shares ? { shares } : {}), ...(units ? { units } : {}) } };
}

/** Accept a short holding name only after the visitor explicitly starts the guided entry. */
export function parseGuidedHoldingReply(message, today = new Date()) {
  if (typeof message !== 'string') return null;
  const input = message.trim();
  if (!input || /[?\r\n]/.test(input) ||
      /^(?:what|how|why|should|can|could|please|help|show|review|buy|sell|switch|recommend)\b/i.test(input))
    return null;
  const direct = parseBrowserHoldingStatement(input, today);
  if (direct) return direct;
  if (/^(?:i (?:own|hold)|my holding is)\b/i.test(input)) return null;
  const candidate = input.replace(/^i have\s+/i, '').replace(/^(?:a|an)\s+/i, '').trim();
  if (!candidate || /^(?:mutual fund|fund|stock|share|equity|debt|gold)$/i.test(candidate))
    return { error: 'Name one specific fund, stock or other investment you own, without an account number.' };
  if (/^(?:no|none|nothing|goal|question|all|some|unsure)\b/i.test(candidate) ||
      /\b(?:goal|password|account|folio|pan number)\b/i.test(candidate)) return null;
  return parseBrowserHoldingStatement(`I own ${candidate}`, today);
}

/** Stage an explicit pasted list as one reviewable batch; reject the whole list on any unclear row. */
export function parseBrowserHoldingList(message, today = new Date()) {
  if (typeof message !== 'string' || !/[\r\n]/.test(message)) return null;
  const lines = message.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (/^(?:my )?(?:holdings|investments):?$/i.test(lines[0] || '')) lines.shift();
  if (lines.length < 2) return null;
  const first = lines[0].replace(/^(?:[-*•]|\d+[.)])\s*/, '');
  if (!/^(?:i (?:own|hold|have)\b|my holding is\b|(?:a |an )?(?:mutual fund|fund|stock|share|nps|epf|ppf|fixed deposit|bank deposit|physical gold|digital gold)\b)/i.test(first))
    return null;
  if (lines.length > 30) return { error: 'Paste at most 30 holdings at once, one per line.' };
  const drafts = [];
  const names = new Set();
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/^(?:[-*•]|\d+[.)])\s*/, '').trim();
    const statement = /^(?:i (?:own|hold|have)\b|my holding is\b)/i.test(line) ? line : `I own ${line}`;
    const parsed = parseBrowserHoldingStatement(statement, today);
    if (!parsed?.draft) return { error: `Line ${index + 1} could not be staged. Give each holding its type, name and total value in rupees; leave out account details and advice questions.` };
    const key = `${parsed.draft.type}:${parsed.draft.name.toLocaleLowerCase('en-IN').replace(/\s+/g, ' ')}`;
    if (names.has(key)) return { error: `Line ${index + 1} repeats a holding name and type in this list. Check the source before adding it twice.` };
    names.add(key);
    drafts.push(parsed.draft);
  }
  return { drafts };
}

/** Recognize a bounded, single-goal start request without inferring an allocation. */
export function parseBrowserGoalStart(message) {
  if (typeof message !== 'string') return null;
  const match = /^(?:i (?:want|would like|need) to plan for|(?:can you )?help me plan for|let['’]s plan for) (?:my |a |the )?(.+?)(?: goal)?[.!?]?$/i.exec(message.trim());
  if (!match) return null;
  const name = match[1].trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60 || name.split(' ').length > 5 ||
      !/^[a-z][a-z'’ -]*$/i.test(name) ||
      /\b(?:and|but|buy|sell|switch|trade|invest|recommend|advice|should|rebalance)\b/i.test(name))
    return { error: 'Name one goal briefly, such as “I want to plan for retirement”. Leave out account details and investment actions.' };
  return { goalName: name[0].toUpperCase() + name.slice(1) };
}

/** A bare goal name is meaningful only while the guided chat is asking for one. */
export function parseBrowserGoalNameReply(message) {
  if (typeof message !== 'string' || /[?\r\n]/.test(message)) return null;
  const input = message.trim().replace(/[.!]$/, '').replace(/^(?:my|a|the)\s+/i, '');
  if (!/^[a-z][a-z'’ -]{1,59}$/i.test(input) ||
      /^(?:i|you|we|what|how|can|do|please|tell|show|help|upload|open|remove|update)\b/i.test(input)) return null;
  return parseBrowserGoalStart(`I want to plan for ${input}`);
}

/** Accept an explicitly named goal and its three essential facts in one chat turn. */
export function parseBrowserGoalSetup(message) {
  if (typeof message !== 'string' || /[?\r\n]/.test(message)) return null;
  const match = /^(.+?)[;,]\s*((?:i am|my age is|age)\s+.+)$/i.exec(message.trim());
  if (!match) return null;
  const start = parseBrowserGoalStart(match[1]);
  if (!start) return null;
  if (start.error) return start;
  const detail = parseBrowserGoalFact(match[2], { age: null, years: null, target: null });
  if (detail?.error) return detail;
  if (!detail?.facts || !['age', 'years', 'target'].every(field =>
    Object.hasOwn(detail.facts, field)))
    return { error: 'Give your own age, years until this goal and target in today’s rupees together. For example: “I want to plan for retirement; I am 32, goal in 20 years, target ₹50 lakh in today’s rupees”.' };
  return { goalName: start.goalName, facts: detail.facts };
}

/** Narrow, explicit goal answers for the browser-only guided review. */
export function parseBrowserGoalFact(message, goal, pending = {}) {
  if (typeof message !== 'string' || !goal) return null;
  const input = message.trim();
  const retirementAge = /^(?:i (?:want|plan|intend) to )?retire at (?:age )?(\d{1,3})[.!]?$/i.exec(input);
  if (retirementAge && /\bretire(?:ment)?\b/i.test(goal.name || '')) {
    const currentAge = pending.age ?? goal.age;
    const intendedAge = Number(retirementAge[1]);
    if (!Number.isInteger(currentAge) || currentAge < 18 || currentAge > 100)
      return { error: 'Tell me your current age first. I cannot turn a retirement age into years until the goal without it.' };
    const years = intendedAge - currentAge;
    if (intendedAge > 100 || years < 1 || years > 50)
      return { error: 'Check that your intended retirement age is later than your current age and at most 50 years away.' };
    return { facts: { years }, clarification:
      `Your entered age ${currentAge} to intended retirement age ${intendedAge} is ${years} years. Check that horizon in the goal draft. ${nextBrowserGoalQuestion(goal, { ...pending, years })}` };
  }
  const bundle = /^(?:i am |my age is |age )(\d{1,3})(?: years old)?\s*[,;]\s*(?:this )?goal (?:is )?in (\d{1,2}) years?\s*[,;]\s*target(?: in today['’]?s rupees)?(?: is)?\s+(?:₹\s*)?([\d,]+(?:\.\d{1,2})?)(?:\s*(lakh|crore))?(?:\s+in today['’]?s rupees)?[.!]?$/i.exec(input);
  if (bundle) {
    const age = Number(bundle[1]);
    const years = Number(bundle[2]);
    const target = amount(bundle[3], bundle[4]);
    if (age < 18 || age > 100 || years < 1 || years > 50 ||
        !Number.isInteger(target) || target < 1000 || target > 1_000_000_000_000)
      return { error: 'Check your own age, the goal horizon and the target amount in today’s rupees before saving.' };
    return { facts: { age, years, target } };
  }
  const scenarioBundle = /^monthly contribution(?: is)?\s+(.+?)\s*[,;]\s*growth assumption(?: is)?\s+(.+?)\s*[,;]\s*inflation assumption(?: is)?\s+(.+?)[.!]?$/i.exec(input);
  if (scenarioBundle) {
    const monthlyContribution = enteredAmount(scenarioBundle[1]);
    const growth = /^(-?\d{1,2}(?:\.\d{1,2})?)%$/.exec(scenarioBundle[2].trim());
    const inflation = /^(-?\d{1,2}(?:\.\d{1,2})?)%$/.exec(scenarioBundle[3].trim());
    const returnPct = Number(growth?.[1]);
    const inflationPct = Number(inflation?.[1]);
    if (monthlyContribution === null || monthlyContribution > 100_000_000 ||
        !growth || returnPct < -20 || returnPct > 13 ||
        !inflation || inflationPct < -5 || inflationPct > 15)
      return { error: 'Check all three inputs: your monthly contribution from ₹0 to ₹10 crore, growth assumption from -20% to 13%, and inflation assumption from -5% to 15%. These are your what-if inputs, not forecasts.' };
    return { facts: { monthlyContribution, returnPct, inflationPct } };
  }
  if (/^clear goal mix[.!]?$/i.test(input)) return { facts: { targetMix: null } };
  const mixRequest = /^(?:(?:my )?(?:goal|target) mix|my chosen(?: goal)? mix)(?: is)?\s+(.+?)[.!]?$/i.exec(input);
  if (mixRequest) {
    const parsed = parseMixPercentages(mixRequest[1]);
    return parsed.error ? parsed : { facts: { targetMix: parsed.mix } };
  }
  const fallRequest = /^(?:test )?(?:equity fall|equity drop)(?: of)?\s+(.+?)[.!]?$/i.exec(input);
  if (fallRequest) {
    const percentage = /^(\d{1,2}(?:\.\d{1,2})?)%$/.exec(fallRequest[1].trim());
    const value = Number(percentage?.[1]);
    if (!percentage || value < 0 || value > 60)
      return { error: 'Choose a hypothetical equity fall from 0% to 60%, such as “equity fall 25%”.' };
    return { facts: { equityDropPct: value } };
  }
  const limitRequest = /^(?:loss i can (cover|tolerate)|i (?:can|could) (cover|tolerate) (?:a |an )?loss(?: of)?)\s+(.+?)[.!]?$/i.exec(input);
  if (limitRequest) {
    const value = enteredAmount(limitRequest[3]);
    if (value === null || value > 10_000_000_000)
      return { error: 'Enter an amount in rupees for the loss you can cover or tolerate, such as “loss I can cover ₹50,000”.' };
    return { facts: { [(limitRequest[1] || limitRequest[2]).toLowerCase() === 'cover' ? 'affordableLoss' : 'tolerableLoss']: value } };
  }
  if (/^i (?:can|could) (?:handle|bear|take) (?:a |an )?loss(?: of)?\s+.+[.!]?$/i.test(input))
    return { error: 'Do you mean an amount you could cover without disrupting essentials, or a loss you could tolerate? Say “I could cover a loss of ₹50,000” or “I can tolerate a loss of ₹50,000”.' };
  const contribution = /^monthly contribution(?: is)?\s+(.+?)[.!]?$/i.exec(input);
  if (contribution) {
    const value = enteredAmount(contribution[1]);
    if (value === null || value > 100_000_000)
      return { error: 'Enter the monthly amount you plan to add in rupees, such as “monthly contribution ₹5,000”, or 0.' };
    return { facts: { monthlyContribution: value } };
  }
  const assumption = /^(growth|inflation) assumption(?: is)?\s+(.+?)[.!]?$/i.exec(input);
  if (assumption) {
    const match = /^(-?\d{1,2}(?:\.\d{1,2})?)%$/.exec(assumption[2].trim());
    const value = Number(match?.[1]);
    const growth = assumption[1].toLowerCase() === 'growth';
    if (!match || value < (growth ? -20 : -5) || value > (growth ? 13 : 15))
      return { error: `Choose your own ${growth ? 'growth' : 'inflation'} assumption from ${growth ? '-20% to 13%' : '-5% to 15%'}. This is an illustration, not a forecast.` };
    return { facts: { [growth ? 'returnPct' : 'inflationPct']: value } };
  }
  const datedAmount = /^i (?:will )?(?:need|want) (?:₹\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s*(lakh|crore))? in ([0-9]{1,2}) years?[.!]?$/i.exec(input);
  if (datedAmount) {
    const years = Number(datedAmount[3]);
    if (years < 1 || years > 50) return { error: 'Check the number of years until this goal.' };
    return { facts: { years }, clarification: 'I staged the time horizon, but left the amount out because it could mean today’s purchasing power or the amount at the goal date. What amount would you need in today’s rupees? Reply “I need ₹50 lakh in today’s rupees”.' };
  }
  let field;
  let value;
  let match = /^(?:my age is |i am |i['’]m |age )([0-9]{1,3})(?: years old)?[.!]?$/i.exec(input);
  if (match) { field = 'age'; value = Number(match[1]); }
  if (!field) {
    match = /^(?:years(?: until (?:the )?goal)? |in )([0-9]{1,2})(?: years?)?[.!]?$/i.exec(input);
    if (match) { field = 'years'; value = Number(match[1]); }
  }
  if (!field) {
    match = /^(?:i (?:need|want) (?:it|this|my goal)|i (?:want|plan) to (?:retire|reach (?:this|my) goal)|my goal is|the goal is) in ([0-9]{1,2}) years?[.!]?$/i.exec(input);
    if (match) { field = 'years'; value = Number(match[1]); }
  }
  if (!field) {
    match = /^(?:target|goal amount|amount needed)(?: is)? ₹?([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s*(lakh|crore))?[.!]?$/i.exec(input);
    if (match) { field = 'target'; value = amount(match[1], match[2]); }
  }
  if (!field) {
    match = /^i (?:will )?(?:need|want) (?:₹\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s*(lakh|crore))? in today['’]s (?:rupees|money)[.!]?$/i.exec(input);
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

function enteredAmount(raw) {
  const input = raw.trim();
  return /^(?:₹\s*)?0$/.test(input) ? 0 : parseAmount(input);
}

export function nextBrowserGoalQuestion(goal, pending = {}) {
  if (!goal) return 'Name a goal by saying “create goal named Retirement”.';
  if (goal.age == null && pending.age == null) return 'How old are you now? Reply “I’m 32”, or give all three facts together: “I am 32, goal in 20 years, target 50 lakh in today’s rupees”.';
  if (goal.years == null && pending.years == null) return `How many years until this goal? You can reply “I need it in 10 years”.${/\bretire(?:ment)?\b/i.test(goal.name || '') ? ' For a retirement goal, you can also say “I plan to retire at 60”; I will use the current age you entered.' : ''}`;
  if (goal.target == null && pending.target == null) return 'What amount would you need in today’s rupees? You can reply “I need ₹50 lakh in today’s rupees”.';
  return 'Check the goal facts shown above, then choose “Save goal facts”. A future illustration and a chosen asset mix are optional later.';
}
