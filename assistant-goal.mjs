import { asVersionTwo } from './assistant-save.mjs?v=c1abbdc26b7f';
import { goalShare, setHoldingAllocations } from './goals.mjs?v=c1abbdc26b7f';
import { validMixPlan } from './mix-plan.mjs?v=c1abbdc26b7f';

const LIMITS = { age: [18, 100], years: [1, 50], target: [1000, 1_000_000_000_000],
  monthlyContribution: [0, 100_000_000], returnPct: [-20, 13], inflationPct: [-5, 15],
  equityDropPct: [0, 60], affordableLoss: [0, 10_000_000_000], tolerableLoss: [0, 10_000_000_000] };
const normalized = value => value.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ');
const cleanName = value => value.trim().replace(/^[“"']|[”"']$/g, '').trim().replace(/\.$/, '').trim();

/** Match only explicit account actions; ordinary goal questions still go to the assistant. */
export function parseAssistantGoalCommand(message) {
  if (typeof message !== 'string') return null;
  const input = message.trim();
  const create = /^(?:create|add) (?:a |new )?goal (?:named|called) (.+)$/i.exec(input);
  if (create) return { kind: 'create', goalName: cleanName(create[1]) };
  const select = /^(?:select|show|review) goal (.+)$/i.exec(input);
  if (select) return { kind: 'select', goalName: cleanName(select[1]) };
  const split = /^split (.+?):\s*(\d{1,3})% (?:to|toward) goal (.+?)(?:,| and)\s*(\d{1,3})% (?:to|toward) goal (.+)$/i.exec(input);
  if (split) return { kind: 'split', holdingName: cleanName(split[1]),
    firstPct: Number(split[2]), goalName: cleanName(split[3]),
    secondPct: Number(split[4]), secondGoalName: cleanName(split[5]) };
  const assign = /^(?:assign|count) (.+?) (?:to|toward) goal (.+)$/i.exec(input);
  if (assign) return { kind: 'assign', holdingName: cleanName(assign[1]), goalName: cleanName(assign[2]) };
  const conversationalAssign = /^(?:use|count) (holding\s*#?\d{1,3}) (?:for|toward) (?:my )?(.+?) goal[.!]?$/i.exec(input);
  if (conversationalAssign) return { kind: 'assign',
    holdingName: cleanName(conversationalAssign[1]), goalName: cleanName(conversationalAssign[2]) };
  const unassign = /^(?:uncount|unlink) (.+?) from goal (.+)$/i.exec(input);
  if (unassign) return { kind: 'unassign', holdingName: cleanName(unassign[1]),
    goalName: cleanName(unassign[2]) };
  const move = /^move (.+?) from goal (.+?) to goal (.+)$/i.exec(input);
  if (move) return { kind: 'move', holdingName: cleanName(move[1]),
    sourceGoalName: cleanName(move[2]), goalName: cleanName(move[3]) };
  return null;
}

/** Find an explicitly named saved goal in a factual question without guessing from a holding name. */
export function namedGoalInQuestion(message, portfolio) {
  if (typeof message !== 'string' || !Array.isArray(portfolio?.goals) ||
      !/^(?:what|how|which|show|tell me|is|are)\b/i.test(message.trim()) ||
      /\b(?:buy|sell|switch|redeem|rebalance|recommend\w*|best)\b/i.test(message)) return null;
  const matches = portfolio.goals.filter(goal => {
    if (typeof goal.name !== 'string' || goal.name.length < 2) return false;
    const name = goal.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`\\b(?:goal\\s+${name}|${name}\\s+goal|(?:for|in|toward|about)\\s+(?:my\\s+)?${name})(?=$|\\W)`, 'i').test(message);
  });
  if (!matches.length) return null;
  return matches.length === 1 ? { goal: matches[0] } :
    { error: `I found more than one named goal in that question. Ask about one goal at a time: ${matches.map(goal => goal.name).join(', ')}.` };
}

/** Record the investor's own answer about a nearer essential expense for the selected goal. */
export function parseAssistantEmergencyFunding(message) {
  if (typeof message !== 'string' || message.length > 1500) return null;
  const input = message.trim().replace(/[.!]$/, '').toLocaleLowerCase('en-IN');
  const answer = {
    'unexpected expense from separate money': 'separate',
    'unexpected expense from goal holdings': 'goal_holdings',
    'unsure about unexpected expenses': 'unsure',
  }[input];
  if (answer) return { facts: { emergencyFunding: answer } };
  if (/^(?:unexpected expense|unsure about unexpected expenses)\b/.test(input))
    return { error: 'Say “unexpected expense from separate money”, “unexpected expense from goal holdings”, or “unsure about unexpected expenses”.' };
  return null;
}

function goalByName(portfolio, name) {
  const matches = portfolio.goals.filter(goal => normalized(goal.name) === normalized(name));
  return matches.length === 1 ? matches[0] : null;
}

export function prepareAssistantGoalCommand(saved, command, { newId = () => crypto.randomUUID() } = {}) {
  if (!command || !['create', 'select', 'assign', 'unassign', 'move', 'split'].includes(command.kind))
    return { portfolio: null, errors: ['Use a supported goal command.'] };
  const portfolio = asVersionTwo(saved, newId);
  if (!portfolio) return { portfolio: null, errors: ['This saved review format needs an account check.'] };
  if (typeof command.goalName !== 'string' || command.goalName.length < 2 || command.goalName.length > 60)
    return { portfolio: null, errors: ['Use a goal name of 2–60 characters.'] };
  if (command.kind === 'create') {
    if (goalByName(portfolio, command.goalName)) return { portfolio: null, errors: ['That goal already exists. Say “select goal NAME” to review it.'] };
    if (saved === null) {
      portfolio.goals[0].name = command.goalName;
      return { portfolio, errors: [], description: `Created ${command.goalName} as an unfinished goal.` };
    }
    if (portfolio.goals.length >= 10) return { portfolio: null, errors: ['This account already has ten goals.'] };
    const id = newId();
    portfolio.goals.push({ id, name: command.goalName, age: null, years: null, target: null,
      monthlyContribution: 0, returnPct: 0, inflationPct: 0,
      assumptionsChecked: { monthlyContribution: false, returnPct: false, inflationPct: false },
      confirmed: false, linkedIds: [] });
    portfolio.activeGoalId = id;
    return { portfolio, errors: [], description: `Created ${command.goalName} as an unfinished goal and selected it.` };
  }
  const goal = goalByName(portfolio, command.goalName);
  if (!goal) return { portfolio: null, errors: ['Name a saved goal exactly as shown in the review.'] };
  if (command.kind === 'select') {
    if (portfolio.activeGoalId === goal.id) return { portfolio: null, errors: [`${goal.name} is already selected.`] };
    portfolio.activeGoalId = goal.id;
    return { portfolio, errors: [], description: `Selected ${goal.name}. Its saved facts are now shown in the review.` };
  }
  if (typeof command.holdingName !== 'string' || !command.holdingName.trim())
    return { portfolio: null, errors: ['Name a saved holding to count toward this goal.'] };
  const numbered = /^(?:holding\s*)?#?(\d{1,3})$/i.exec(command.holdingName.trim());
  const holdingByNumber = numbered ? portfolio.holdings[Number(numbered[1]) - 1] : null;
  if (numbered && !holdingByNumber)
    return { portfolio: null, errors: [`Use a displayed holding number from 1 to ${portfolio.holdings.length}.`] };
  const matches = numbered ? [holdingByNumber] :
    portfolio.holdings.filter(row => normalized(row.name) === normalized(command.holdingName));
  if (matches.length !== 1 || !matches[0].id) return { portfolio: null, errors: ['Name one saved holding exactly as shown in the review.'] };
  const holding = matches[0];
  const currentGoals = portfolio.goals.filter(item => item.linkedIds.includes(holding.id));
  if (command.kind === 'unassign') {
    if (!goal.linkedIds.includes(holding.id))
      return { portfolio: null, errors: [`${holding.name} is not counted toward ${goal.name}.`] };
    portfolio.goals = setHoldingAllocations(portfolio.goals, holding.id,
      Object.fromEntries(portfolio.goals.map(item =>
        [item.id, item.id === goal.id ? 0 : goalShare(item, holding.id)])));
    portfolio.activeGoalId = goal.id;
    return { portfolio, errors: [], description: `${holding.name} is no longer counted toward ${goal.name}. It remains in your total holdings; other goal shares stay as entered.` };
  }
  if (command.kind === 'split') {
    const second = typeof command.secondGoalName === 'string' ?
      goalByName(portfolio, command.secondGoalName) : null;
    if (!second || second.id === goal.id)
      return { portfolio: null, errors: ['Name two different saved goals for the split.'] };
    if (!Number.isInteger(command.firstPct) || !Number.isInteger(command.secondPct) ||
        command.firstPct < 1 || command.secondPct < 1 ||
        command.firstPct + command.secondPct !== 100)
      return { portfolio: null, errors: ['Use two whole percentages above zero that add to 100%.'] };
    if (currentGoals.some(item => item.id !== goal.id && item.id !== second.id))
      return { portfolio: null, errors: ['This holding is also assigned to another goal. Review that allocation before splitting it.'] };
    if (currentGoals.length === 2 &&
        (goal.allocationPct?.[holding.id] ?? 100) === command.firstPct &&
        (second.allocationPct?.[holding.id] ?? 100) === command.secondPct)
      return { portfolio: null, errors: ['This holding already has that goal split.'] };
    portfolio.goals = setHoldingAllocations(portfolio.goals, holding.id,
      Object.fromEntries(portfolio.goals.map(item => [item.id,
        item.id === goal.id ? command.firstPct : item.id === second.id ? command.secondPct : 0])));
    portfolio.activeGoalId = goal.id;
    return { portfolio, errors: [], description: `${holding.name} is now split ${command.firstPct}% to ${goal.name} and ${command.secondPct}% to ${second.name}. The portfolio total has not changed.` };
  }
  if (command.kind === 'move') {
    if (typeof command.sourceGoalName !== 'string' || command.sourceGoalName.length < 2)
      return { portfolio: null, errors: ['Name the current goal for this holding.'] };
    const source = goalByName(portfolio, command.sourceGoalName);
    if (!source || source.id === goal.id) return { portfolio: null, errors: ['Name two different saved goals for the move.'] };
    if (currentGoals.length !== 1 || currentGoals[0].id !== source.id ||
        (source.allocationPct?.[holding.id] ?? 100) !== 100)
      return { portfolio: null, errors: ['This holding is not fully assigned to that one goal. Check its shared allocation before moving it.'] };
    source.linkedIds = source.linkedIds.filter(id => id !== holding.id);
    if (source.allocationPct) delete source.allocationPct[holding.id];
    goal.linkedIds.push(holding.id);
    portfolio.activeGoalId = goal.id;
    return { portfolio, errors: [], description: `${holding.name} moved from ${source.name} to ${goal.name}. The portfolio total has not changed.` };
  }
  if (goal.linkedIds.includes(holding.id)) return { portfolio: null, errors: [`${holding.name} is already counted toward ${goal.name}.`] };
  if (currentGoals.length) {
    const source = currentGoals[0];
    const hint = currentGoals.length === 1 && (source.allocationPct?.[holding.id] ?? 100) === 100 ?
      ` If you want to replace that assignment, say “move ${holding.name} from goal ${source.name} to goal ${goal.name}”.` : '';
    return { portfolio: null, errors: [`${holding.name} is already assigned to another goal. Review its allocation before using it for ${goal.name}.${hint}`] };
  }
  goal.linkedIds.push(holding.id);
  portfolio.activeGoalId = goal.id;
  return { portfolio, errors: [], description: `${holding.name} is now counted toward ${goal.name}, which is selected in the review. The portfolio total has not changed.` };
}

/** Apply only facts explicitly reviewed in chat to the selected goal. */
export function prepareAssistantGoalSave(saved, facts, { newId = () => crypto.randomUUID() } = {}) {
  const portfolio = asVersionTwo(saved, newId);
  if (!portfolio) return { portfolio: null, errors: ['This saved review format needs an account check.'] };
  if (!facts || typeof facts !== 'object' || Array.isArray(facts) || !Object.keys(facts).length ||
      Object.keys(facts).some(key => !['name', 'targetMix', 'emergencyFunding'].includes(key) && !Object.hasOwn(LIMITS, key)))
    return { portfolio: null, errors: ['No supported goal facts were supplied.'] };
  const goal = portfolio.goals.find(item => item.id === portfolio.activeGoalId);
  if (!goal) return { portfolio: null, errors: ['The selected goal could not be found.'] };
  if (facts.name !== undefined) {
    if (typeof facts.name !== 'string' || facts.name.trim().length < 2 || facts.name.trim().length > 60)
      return { portfolio: null, errors: ['Check the goal name before saving.'] };
    if (goal.name !== 'My goal' && normalized(goal.name) !== normalized(facts.name))
      return { portfolio: null, errors: [`These details name a different goal. Say “create goal named ${facts.name.trim()}” to keep ${goal.name} unchanged.`] };
    goal.name = facts.name.trim();
  }
  for (const [field, [min, max]] of Object.entries(LIMITS)) {
    if (facts[field] === undefined) continue;
    const value = facts[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
        (['age', 'years'].includes(field) && !Number.isInteger(value)))
      return { portfolio: null, errors: [`Check the ${field} value before saving.`] };
    goal[field] = value;
  }
  for (const field of ['monthlyContribution', 'returnPct', 'inflationPct']) {
    if (facts[field] === undefined) continue;
    goal.assumptionsChecked = { monthlyContribution: false, returnPct: false, inflationPct: false,
      ...goal.assumptionsChecked, [field]: true };
  }
  if (Object.hasOwn(facts, 'targetMix')) {
    if (facts.targetMix === null) delete goal.targetMix;
    else if (validMixPlan(facts.targetMix)) goal.targetMix = { ...facts.targetMix };
    else return { portfolio: null, errors: ['Check that your chosen goal mix uses the four asset categories and totals 100%.'] };
  }
  if (Object.hasOwn(facts, 'emergencyFunding')) {
    if (!['separate', 'goal_holdings', 'unsure'].includes(facts.emergencyFunding))
      return { portfolio: null, errors: ['Choose separate money, goal holdings or unsure for unexpected expenses.'] };
    goal.emergencyFunding = facts.emergencyFunding;
  }
  goal.confirmed = goal.age !== null && goal.years !== null && goal.target !== null;
  return { portfolio, errors: [] };
}

/** A single-goal investor can explicitly count all still-unassigned holdings for that goal. */
export function prepareAssistantGoalAssignment(saved) {
  if (!saved || saved.version !== 2 || saved.goals?.length !== 1)
    return { portfolio: null, errors: ['This shortcut is available only for a single saved goal.'] };
  const portfolio = structuredClone(saved);
  const goal = portfolio.goals[0];
  if (goal.id !== portfolio.activeGoalId || !Array.isArray(goal.linkedIds))
    return { portfolio: null, errors: ['The selected goal could not be checked.'] };
  const assigned = new Set(goal.linkedIds);
  const added = portfolio.holdings.filter(row => row.id && !assigned.has(row.id)).map(row => row.id);
  if (!added.length) return { portfolio: null, errors: ['All saved holdings are already assigned to this goal.'] };
  goal.linkedIds.push(...added);
  return { portfolio, addedCount: added.length, errors: [] };
}
