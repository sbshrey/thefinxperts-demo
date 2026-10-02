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
