import { hasDatedFundTer, planFromName, positionsByIsin, summarizeFundGroups, summarizeFundHouses, valuationDateIssue,
  valuationRowsNeedingCheck } from './analysis.mjs?v=da73a34f0752';
import { rupeesWithPaise, summarizeUnrealizedChange } from './cost-basis.mjs?v=da73a34f0752';
import { reserveMonths } from './reserve.mjs?v=da73a34f0752';
import { calculateGoalScenario, calculateStraightLineGap,
  confirmedGoalAssumptions } from './goal-scenario.mjs?v=da73a34f0752';
import { asksForAdvice } from './question-scope.mjs?v=da73a34f0752';
import { goalShare, summarizeGoalCoverage } from './goals.mjs?v=da73a34f0752';
import { entryOriginText, valuationOriginText } from './entry-origin.mjs?v=da73a34f0752';
import { unansweredCoverageFields } from './coverage-state.mjs?v=da73a34f0752';
import { parseAmount } from './assistant-clarify.mjs?v=da73a34f0752';
import { validatedStatementSipSummary } from './cas-performance.mjs?v=da73a34f0752';
import { compareFundDisclosures, estimateVisibleIssuerExposure,
  matchFundDisclosure } from './fund-disclosure.mjs?v=da73a34f0752';

const money = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
const percent = (part, whole) => whole ? `${(part / whole * 100).toFixed(1)}%` : '0%';
/** Summarize saved row provenance, never the number or identity of uploaded files. */
export function summarizeReviewSources(holdings, goal = null, today = new Date()) {
  const original = new Map();
  const latest = new Map();
  let total = 0;
  let count = 0;
  let changed = 0;
  let dateCheckCount = 0;
  let dateCheckValue = 0;
  const dates = [];
  const add = (groups, label, value) => {
    const group = groups.get(label) || { label, count: 0, value: 0 };
    group.count++;
    group.value += value;
    groups.set(label, group);
  };
  for (const row of holdings) {
    const value = Number(row.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    const share = goal ? goalShare(goal, row.id) : 100;
    if (!share) continue;
    const assigned = value * share / 100;
    total += assigned;
    count++;
    const first = entryOriginText(row.entryOrigin);
    const current = row.valuationOrigin ? valuationOriginText(row.valuationOrigin) : first;
    add(original, first, assigned);
    add(latest, current, assigned);
    if (current !== first) changed++;
    const issue = valuationDateIssue(row.asOf, today);
    if (issue) { dateCheckCount++; dateCheckValue += assigned; }
    if (issue !== 'missing') dates.push(row.asOf);
  }
  const ordered = groups => [...groups.values()].sort((a, b) => b.value - a.value ||
    a.label.localeCompare(b.label, 'en-IN'));
  dates.sort();
  return { total, count, original: ordered(original), latest: ordered(latest), changed,
    dateCheckCount, dateCheckValue, earliestDate: dates[0] || null,
    latestDate: dates.at(-1) || null };
}
const investorDefinitions = new Map([
  ['diversification', {
    text: 'Diversification means spreading investments across different assets or holdings so one loss does not determine the whole result. Owning several funds does not prove their underlying companies are different.',
    limitation: 'It reduces some concentration risk but cannot remove all investment risk. This definition does not assess your portfolio.',
    href: 'https://investor.sebi.gov.in/investment_risk_managment.html',
  }],
  ['asset allocation', {
    text: 'Asset allocation is how investment value is divided among asset classes such as equity, debt and gold. A goal, time horizon and ability to bear losses matter when choosing a mix.',
    limitation: 'This explanation does not choose percentages for you. Ask “How is my asset mix?” to see only the shares in your entered holdings.',
    href: 'https://investor.sebi.gov.in/investment-thingsbeforeinv.html',
  }],
  ['equity', {
    text: 'Equity is ownership in a company through shares. An equity mutual fund holds shares on investors’ behalf; its value can rise or fall with those holdings.',
    limitation: 'An Equity label in this review is supplied or checked by you; it is not a verified look-through of every fund.',
    href: 'https://investor.sebi.gov.in/investment-assetclasses.html',
  }],
  ['debt', {
    text: 'Debt investments include bonds, where an issuer borrows money and promises payments under stated terms. Debt mutual funds hold such securities and their value can also change.',
    limitation: 'A Debt label does not mean guaranteed return or immediate access to the money.',
    href: 'https://investor.sebi.gov.in/investment-assetclasses.html',
  }],
  ['nav', {
    text: 'NAV means net asset value: a mutual fund’s value per unit on a stated date after its assets and liabilities are accounted for. Units held × that dated NAV gives an estimated holding value.',
    limitation: 'The estimate needs the exact scheme, plan and option plus a confirmed current unit balance. NAV is not a continuously changing stock quote.',
    href: 'https://investor.sebi.gov.in/securities-mf-investments.html',
  }],
  ['expense ratio', {
    text: 'A mutual fund expense ratio is its ongoing operating cost expressed as a percentage of scheme assets. It is reflected in the fund’s NAV rather than added as a second bill to the holding value.',
    limitation: 'A fund name alone does not establish its current dated expense ratio. Check the exact scheme and plan before comparing costs.',
    href: 'https://investor.sebi.gov.in/regular_and_direct_mutual_funds.html',
  }],
  ['direct and regular plans', {
    text: 'Direct and Regular are two plans of the same mutual fund scheme. The underlying portfolio is generally the same; a Regular plan includes distributor involvement and typically has a higher expense ratio.',
    limitation: 'The plan label alone does not account for service received, taxes, exit loads or whether changing plans would suit you.',
    href: 'https://investor.sebi.gov.in/regular_and_direct_mutual_funds.html',
  }],
  ['sip', {
    text: 'SIP means Systematic Investment Plan: a way to put a chosen amount into a mutual fund at regular intervals. It is a payment method, not a separate asset class or a guaranteed return.',
    limitation: 'A snapshot of current holdings cannot reconstruct all past SIP payments or calculate a lifetime return.',
    href: 'https://investor.sebi.gov.in/pdf/downloadable-documents/Financial%20Education%20Booklet%20-%20English.pdf',
  }],
]);
const definitionAliases = new Map([
  ['diversified', 'diversification'], ['portfolio diversification', 'diversification'],
  ['allocation', 'asset allocation'], ['equity shares', 'equity'], ['bonds', 'debt'],
  ['net asset value', 'nav'], ['ter', 'expense ratio'], ['total expense ratio', 'expense ratio'],
  ['expense ratios', 'expense ratio'],
  ['regular plan', 'direct and regular plans'], ['direct plan', 'direct and regular plans'],
  ['direct vs regular plan', 'direct and regular plans'],
  ['difference between direct and regular plans', 'direct and regular plans'],
  ['difference between regular and direct plans', 'direct and regular plans'],
  ['regular and direct plans', 'direct and regular plans'],
  ['systematic investment plan', 'sip'],
]);
function investorDefinition(input) {
  const match = /^(?:what (?:is|are|does)|explain|define|meaning of|tell me about)\s+(.+?)[?.!]*$/.exec(input);
  if (!match) return null;
  const term = match[1].replace(/^(?:a|an|the)\s+/, '')
    .replace(/\s+(?:mean|stand for)$/, '').trim();
  return investorDefinitions.get(definitionAliases.get(term) || term) || null;
}

export function isChoosingMixQuestion(question) {
  if (typeof question !== 'string') return false;
  const input = question.trim().toLocaleLowerCase('en-IN');
  return /\b(?:how (?:do|can|should) i (?:choose|decide|set)|what (?:factors|should guide))\b.{0,75}\b(?:asset mix|asset allocation|target mix|target allocation|portfolio mix|equity (?:and|vs) debt)\b/.test(input) &&
    !/\b(?:for me|buy|sell|switch|redeem|replace|increase|reduce|trade|which fund|which stock|specific percentages?)\b/.test(input);
}

function positionChangeIntent(question) {
  if (typeof question !== 'string' || asksForAdvice(question)) return null;
  const input = question.trim().toLocaleLowerCase('en-IN');
  const asksChange = /\b(?:which|what|show|list|biggest|largest|top)\b.{0,70}\b(?:holdings?|positions?|funds?|stocks?|shares?)\b.{0,50}\b(?:in (?:a )?loss|(?:making|showing) (?:a )?loss|loss(?:es)?|lost|losing|gains?|profitable|profit|up|down|in the red)\b/.test(input) ||
    /\b(?:losing|loss.making|profitable|gaining)\b.{0,40}\b(?:holdings?|positions?|funds?|stocks?|shares?)\b/.test(input);
  if (!asksChange) return null;
  const mentionsFund = /\b(?:fund|funds|mutual fund|mutual funds)\b/.test(input);
  const mentionsStock = /\b(?:stock|stocks|shares?)\b/.test(input);
  return { kind: mentionsFund && !mentionsStock ? 'Mutual fund' :
    mentionsStock && !mentionsFund ? 'Stock' : null,
  losing: /\b(?:loss|losses|lost|losing|down|red)\b/.test(input) };
}

/** A saved goal contribution is an illustration input, never evidence of an active SIP. */
export function isSipAmountQuestion(question) {
  if (typeof question !== 'string') return false;
  const input = question.trim().toLocaleLowerCase('en-IN');
  return !/^what if\b/.test(input) &&
    /^(?:how much|how many|what|show|list|am i|do i)\b/.test(input) &&
    (/(?:\bsips?\b|systematic investment plans?)\b/.test(input) &&
      /\b(?:amount|total|active|running|pay|paid|payments?|purchases?|invest\w*|contribut\w*|monthly|month|savings?)\b/.test(input) ||
      /\b(?:my|i)\b.{0,35}\b(?:monthly contributions?|monthly investments?|investing per month|invest each month|invest every month)\b/.test(input));
}

function shortReviewFollowUp(message) {
  if (typeof message !== 'string') return null;
  const input = message.trim().toLocaleLowerCase('en-IN');
  const namedType = /^(?:and\s+)?(?:(?:what|how)\s+about\s+)?(?:the\s+)?(mutual funds?|funds?|stocks?|shares?|holdings?|positions?)[?.!]*$/.exec(input);
  const namedDirection = /^(?:and\s+)?(?:(?:what|how)\s+about\s+)?(?:the\s+)?(loss(?:es)?|gains?|profits?)[?.!]*$/.exec(input);
  return namedType || namedDirection ? { namedType, namedDirection } : null;
}

export function isShortReviewFollowUp(message) {
  return Boolean(shortReviewFollowUp(message));
}

/** Expand only short, factual gain/loss follow-ups from the previous answered question. */
export function resolveReviewFollowUp(message, previousQuestion) {
  const previous = positionChangeIntent(previousQuestion);
  const followUp = shortReviewFollowUp(message);
  if (!previous || !followUp) return null;
  const { namedType, namedDirection } = followUp;
  const kind = namedType ? /^mutual fund|^fund/.test(namedType[1]) ? 'funds' :
    /^stock|^share/.test(namedType[1]) ? 'stocks' : 'holdings' :
    previous.kind === 'Mutual fund' ? 'funds' : previous.kind === 'Stock' ? 'stocks' : 'holdings';
  const losing = namedDirection ? /^loss/.test(namedDirection[1]) : previous.losing;
  return `Which ${kind} show ${losing ? 'losses' : 'gains'}?`;
}

/** Answer a narrow set of portfolio questions from the current in-tab review. */
export function answerReviewQuestion(question, { holdings, goal, goals, source, coverage, reserve,
  result, sipSummary = null, disclosures = [], today = new Date() }) {
  if (typeof question !== 'string' || !question.trim() || !result || !Array.isArray(holdings)) return null;
  const input = question.trim().toLocaleLowerCase('en-IN');
  const valid = holdings.filter(row => Number.isFinite(Number(row.value)) && Number(row.value) > 0);
  const lead = source === 'demo' ? 'In the fictional example, ' : 'From your entered holdings, ';
  const coverageNote = source === 'demo' ? 'This is fictional sample data.' :
    coverage?.mutualFunds === 'all' && coverage?.directStocks === 'all' &&
    ['all', 'none'].includes(coverage?.otherInvestments) ?
      'Coverage of all three investment groups is self reported and has not been verified.' :
      'This snapshot may omit investments you own. Check it against current statements.';
  const otherAccessBound = result.goalAccessCheck?.count ?
    ` If none of the ${money(result.goalAccessCheck.value)} in linked other investments can be used for this goal, the gap in today's rupees would be ${money(result.goalGapIfOtherUnavailable)}. Check their terms; this what-if does not establish that the money is locked.` : '';
  const answer = (text, basis, limitation, href = '#holdings', action = 'Check my holdings') =>
    ({ text, basis, limitation, href, action });
  const mentionsGoal = name => typeof name === 'string' && name.trim() &&
    new RegExp(`(?:^|\\W)${name.trim().toLocaleLowerCase('en-IN').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\W)`).test(input);
  const namedGoal = mentionsGoal(goal?.name);
  const goalScopeRequested = /\bgoal\b/.test(input) || namedGoal;
  const otherNamedGoal = Array.isArray(goals) ? goals.find(item =>
    item.id !== goal?.id && mentionsGoal(item.name)) : null;
  const unavailableGoalScope = () => goal?.confirmed !== true ? answer(
    'Confirm the selected goal’s age, target amount and time horizon before using its assigned mix or concentration.',
    `Selected goal ${goal?.name || 'unnamed'} is unfinished.`,
    'The whole portfolio and the selected goal may contain different amounts.', '#goal-form', 'Confirm goal details') :
    !result.goalTotal ? answer('No entered holdings are assigned to this goal yet. Link holdings before comparing its mix or largest position.',
      `Selected goal ${goal.name}; assigned value ₹0.`,
      'The whole portfolio and the selected goal may contain different amounts.', '#holdings', 'Link a holding') : null;
  const namesFunds = /\b(?:mutual funds?|funds?)\b/.test(input);
  const namesStocks = /\b(?:stocks?|direct shares?)\b/.test(input);
  const namedGroup = namesFunds !== namesStocks ? namesFunds ?
    { kind: 'Mutual fund', label: 'mutual funds', positionLabel: 'mutual-fund' } :
    { kind: 'Stock', label: 'direct stocks', positionLabel: 'direct-stock' } : null;
  const rowsForNamedGroup = () => valid.filter(row => row.type === namedGroup.kind).flatMap(row => {
    const share = goalScopeRequested ? goalShare(goal, row.id) : 100;
    return share ? [{ ...row, value: Number(row.value) * share / 100 }] : [];
  });

  if (otherNamedGoal && /\b(?:goal|toward|towards|for|assigned|linked|funding|counted|track)\b/.test(input) &&
      !asksForAdvice(input))
    return answer(`You named ${otherNamedGoal.name}, but ${goal?.name || 'another goal'} is selected. Say “select goal ${otherNamedGoal.name}”, then ask again so I use that goal’s assignments.`,
      `The current calculation belongs to the selected goal ${goal?.name || 'unnamed'}; no value for ${otherNamedGoal.name} was used.`,
      'Goal totals and allocations must come from the goal you actually mean.', '#goals', 'Select the named goal');

  if (goalScopeRequested && /\b(?:invested|profit|gains?|loss(?:es)?|underperform\w*|outperform\w*|performance|returns?|ter|expense ratio|regular plans?|direct plans?|overlap)\b/.test(input))
    return answer(`I cannot calculate that metric separately for ${goal?.name || 'the selected goal'} from this review. Ask about the goal’s assigned value or asset mix, or ask for the whole-portfolio metric without naming a goal.`,
      'Goal links assign shares of current holding value; checked cost, historical performance, fund fees and overlap are not allocated to individual goals here.',
      'Using a whole-portfolio figure as a goal figure would be misleading.', '#goals', 'Review goal assignments');

  const definition = investorDefinition(input);
  if (definition) return answer(definition.text,
    'Plain-language term explanation from SEBI investor education; no personal holding value was calculated.',
    definition.limitation, definition.href, 'Read the SEBI explanation');

  if (isChoosingMixQuestion(input)) {
    const next = goal?.confirmed !== true ?
      'Start by confirming one goal’s amount in today’s rupees and when you need it, along with your current age.' :
      !result.goalTotal ? `For ${goal.name}, next choose which entered holdings you intend to count toward it.` :
        `For ${goal.name}, first check the value dates and labels of the holdings you count toward it.`;
    return answer(`A target mix depends on your goal, time horizon, ability to bear a loss and need for access to the money. ${next} Consider whether a nearer essential expense could use these holdings and test a fall you choose against a loss you could afford. Then compare a mix you choose with the entered mix. If you already chose percentages, say “my chosen mix is” and name each category; I will show them for confirmation. You can also ask “How diversified is my goal?” to see the current assigned mix.`,
      `SEBI's investor education names goals, horizon, risk appetite, liquidity and diversification as factors in asset allocation. ${goal?.confirmed === true ? `The selected goal ${goal.name} has a confirmed horizon${result.goalTotal ? ' and assigned value' : ' but no assigned value'}.` : 'No confirmed selected goal facts were used.'} No target percentages were calculated.`,
      'This is a self-directed checklist. It does not choose percentages, funds or trades, and a holdings snapshot cannot establish your full circumstances or risk capacity.',
      'https://investor.sebi.gov.in/investment-thingsbeforeinv.html', 'Read SEBI allocation factors');
  }

  const planQuestion = /\b(?:regular|direct)\s+plans?\b/.test(input) &&
    /^(?:which|what|how many|how much|do i|show|list)\b/.test(input);
  const planAction = /\b(?:buy|sell|switch|redeem|rebalance|optimi[sz]\w*|recommend\w*|advis\w*|should|best|choose|pick|prefer|better|convert|move|invest|suitable|trade)\b/.test(input);
  if (planQuestion && !planAction) {
    const funds = valid.filter(row => row.type === 'Mutual fund');
    const regular = funds.filter(row => row.granularity !== 'fund_house' && planFromName(row.name) === 'Regular');
    const direct = funds.filter(row => row.granularity !== 'fund_house' && planFromName(row.name) === 'Direct');
    const unclear = funds.filter(row => row.granularity === 'fund_house' || planFromName(row.name) === 'Unclear');
    const value = rows => rows.reduce((sum, row) => sum + Number(row.value), 0);
    const examples = (label, rows) => rows.length ?
      ` ${label}: ${rows.slice(0, 3).map(row => row.name).join('; ')}${rows.length > 3 ? `; and ${rows.length - 3} more` : ''}.` : '';
    const named = examples('Regular-labelled rows', regular) + examples('Direct-labelled rows', direct);
    return answer(funds.length ?
      `${lead}${regular.length} mutual-fund ${regular.length === 1 ? 'row says' : 'rows say'} Regular Plan (${money(value(regular))}); ${direct.length} ${direct.length === 1 ? 'row says' : 'rows say'} Direct Plan (${money(value(direct))}); ${unclear.length} ${unclear.length === 1 ? 'row has' : 'rows have'} no clear plan label (${money(value(unclear))}).${named}` :
      'No mutual-fund holdings are entered, so there are no plan labels to compare.',
      `Classified only explicit Regular Plan or Direct Plan words in ${funds.length} entered mutual-fund names; fund-house summaries count as unclear. The entered values are dated, not current quotes.`,
      'Names and expense ratios are not independently verified. A plan label alone does not establish current TER, tax, exit load, service value or whether to switch.', '#holdings', 'Check fund plan labels');
  }

  if (/^(?:what should i do(?: next)?|how (?:(?:can|do|should) i|to) (?:improve|optimi[sz]e) (?:my )?(?:portfolio|review|investments?)(?: for (?:my )?(?:age and goal|age|goal))?|where should i start)[?.!]*$/.test(input)) {
    if (!valid.length) return answer('Start by adding and confirming a current holding from a supported statement or broker report. Then I can show what the entered portfolio contains and what needs checking.',
      'No confirmed holding value is available for a factual review.',
      'I cannot choose investments or trades; an import remains a draft until you confirm it.', '#holdings', 'Add a holding');
    const first = result.findings?.[0];
    const goalSnapshotReady = goal?.confirmed === true && result.goalTotal > 0 &&
      result.goalDateCheck?.count === 0 && result.goalAccessCheck?.count === 0 &&
      result.goalAssets?.Other === 0 && Number.isFinite(Number(goal.target)) &&
      Number(goal.target) > 0 && Number.isFinite(Number(goal.years)) && Number(goal.years) > 0 &&
      !valid.some(row => row.granularity === 'fund_house' && goalShare(goal, row.id) > 0) &&
      !['scope', 'identity', 'summary', 'classification', 'valuation'].includes(first?.key);
    const goalSnapshot = goalSnapshotReady ?
      `For ${goal.name}, ${money(result.goalTotal)} of entered value is assigned across a ${goal.years}-year horizon; ${result.goalEquityPct.toFixed(1)}% is labelled Equity. Against your ${money(goal.target)} target in today's rupees, the simple current gap is ${money(result.goalGap)}. ` : '';
    const goalBasis = goalSnapshotReady ?
      `Assigned ${money(result.goalTotal)} from your goal links; labelled Equity ${money(result.goalAssets.Equity)} ÷ assigned value = ${result.goalEquityPct.toFixed(1)}%; target ${money(goal.target)} less assigned value gives the nonnegative current gap ${money(result.goalGap)}. ` : '';
    const reviewCheck = () => answer(`${goalSnapshot}Start with this factual check: ${first.title}. ${first.detail} ${first.question}`,
      `${goalBasis}${first.basis}`, `${first.limitation} This check does not select a trade or personal allocation. Age and horizon alone do not establish a suitable mix.`,
      '#review', 'See this review check');
    if (first && ['scope', 'identity', 'summary', 'classification', 'valuation'].includes(first.key))
      return reviewCheck();
    if (!Array.isArray(goals) || !goals.length) return answer(
      'Next, name a goal, for example “create goal named Retirement”. Then give your age, target amount and years until that goal, and choose which entered holdings count toward it.',
      `${valid.length} confirmed holding ${valid.length === 1 ? 'row is' : 'rows are'} entered, but no goal has been created.`,
      'A goal name and your facts allow a comparison; they do not choose an allocation or trade.', '#goals', 'Create a goal');
    if (goal?.confirmed !== true) return answer(
      `Next, confirm your age, target amount and time horizon for ${goal?.name || 'a goal'}. Then I can compare only the holdings you assign to it with that goal.`,
      `${valid.length} confirmed holding ${valid.length === 1 ? 'row is' : 'rows are'} entered; the selected goal has no confirmed age, target and horizon together.`,
      'This does not choose an allocation or trade. A goal comparison also needs you to check which holdings belong to that goal.', '#goals', 'Confirm goal details');
    if (!result.goalTotal) return answer(
      `Next, choose which of the entered holdings count toward ${goal.name}. Its goal-specific value is still ₹0, so the current portfolio total cannot be treated as money assigned to that goal.`,
      `${valid.length} confirmed holding ${valid.length === 1 ? 'row is' : 'rows are'} entered; no positive value is assigned to ${goal.name}.`,
      'Linking a holding records your intent. It does not change the portfolio total or establish whether that investment is suitable for this goal.', '#goals', 'Link goal holdings');
    if (first) return reviewCheck();
    return answer('The entered snapshot has no flagged first check. Review its scope, valuation dates, and your selected goal before making a decision.',
      `${valid.length} confirmed holding ${valid.length === 1 ? 'row' : 'rows'}; ${result.asOfSummary}.`,
      'This browser review cannot assess suitability or choose a trade or personal allocation.', '#goals', 'Review selected goal');
  }

  const goalRiskQuestion = /\b(?:safe|risky|risk|suitable|appropriate|right|balance|balanced|aligned)\b/.test(input) &&
    (/(?:\b(?:goal|retirement)\b.{0,60}\b(?:safe|risky|risk|suitable|appropriate|right|balance|balanced|aligned)\b)/.test(input) ||
      /\b(?:safe|risky|risk|suitable|appropriate|right|balance|balanced|aligned)\b.{0,60}\b(?:goal|retirement|my age|age and goal)\b/.test(input));
  if (goalRiskQuestion && !/\b(?:buy|sell|switch|redeem|rebalance|replace|increase|reduce|move|shift|trade|invest|allocate|recommend|suggest|optimi[sz]e)\b/.test(input)) {
    if (goal?.confirmed !== true)
      return answer('Confirm the selected goal’s age, target and years until it is due before checking the exposure of its assigned holdings.',
        `The selected goal ${goal?.name || 'unnamed'} is unfinished.`,
        'Age alone cannot establish a suitable allocation or whether a goal is safe.', '#goals', 'Confirm goal details');
    const namedOther = [
      { label: 'EPF', question: /\bepf\b/, row: /\bepf\b|employees?'? provident fund/, origin: 'epfo_passbook' },
      { label: 'NPS', question: /\bnps\b/, row: /\bnps\b|national pension system/, origin: 'nps_statement' },
      { label: 'PPF', question: /\bppf\b/, row: /\bppf\b|public provident fund/, origin: null },
    ].find(item => item.question.test(input));
    if (namedOther) {
      const rows = valid.filter(row => row.type === 'Other investment' &&
        (namedOther.origin && row.entryOrigin === namedOther.origin ||
          namedOther.row.test(String(row.name || '').toLocaleLowerCase('en-IN'))));
      if (!rows.length) return answer(`No ${namedOther.label} holding is entered in this review. Add a checked dated balance before asking how it affects ${goal.name}.`,
        `0 positive ${namedOther.label} rows identified from their entered name or supported source label.`,
        'This does not establish whether you own the account elsewhere or when its money can be used.', '#holdings', `Add ${namedOther.label} balance`);
      const assigned = rows.reduce((sum, row) => sum + Number(row.value) * goalShare(goal, row.id) / 100, 0);
      if (!assigned) return answer(`${namedOther.label} is entered, but none of its value is assigned to ${goal.name}. Check whether you intend to count it toward this goal before comparing.`,
        `${rows.length} identified ${namedOther.label} ${rows.length === 1 ? 'row' : 'rows'}; assigned share toward ${goal.name} is ₹0.`,
        'A portfolio balance is not automatically available for a particular goal.', '#goals', 'Check goal assignments');
      return answer(`${money(assigned)} of entered ${namedOther.label} value is assigned to ${goal.name}. I cannot tell whether it will be accessible or adequate when the goal arrives. Check the account’s current balance, date and withdrawal or maturity terms.`,
        `Added the assigned shares of ${rows.length} identified ${namedOther.label} ${rows.length === 1 ? 'row' : 'rows'}; ${result.asOfSummary}.`,
        `Entered balances and goal links are unverified. This is gross value, not confirmed spendable money or a safety verdict. ${coverageNote}`, '#holdings', 'Check account terms');
    }
    const statedHorizon = /\b(?:goal|retirement)\b.{0,20}\b(?:in|due in)\s+(\d{1,2})\s+years?\b/.exec(input);
    if (statedHorizon && Number(statedHorizon[1]) !== Number(goal.years))
      return answer(`You asked about a goal in ${statedHorizon[1]} years, but ${goal.name} is set for ${goal.years} years. Check the selected goal’s horizon before using its exposure for this question.`,
        `The question says ${statedHorizon[1]} years; the confirmed selected goal says ${goal.years} years.`,
        'A different date can change the goal target and which holdings you intend to use.', '#goals', 'Check goal timing');
    if (!result.goalTotal)
      return answer(`Link the holdings you intend to count toward ${goal.name} before checking its exposure.`,
        `No entered holding value is assigned to ${goal.name}.`,
        'An empty goal review does not mean you own no investments.', '#goals', 'Link goal holdings');
    const hasFundHouseSummary = valid.some(row => goalShare(goal, row.id) > 0 && row.granularity === 'fund_house');
    if (result.goalDateCheck.count || result.goalAccessCheck.count || result.goalAssets.Other > 0 ||
        hasFundHouseSummary) {
      const checks = [
        result.goalDateCheck.count ? `${result.goalDateCheck.count} assigned value ${result.goalDateCheck.count === 1 ? 'date' : 'dates'}` : null,
        result.goalAccessCheck.count ? 'withdrawal access for linked other investments' : null,
        result.goalAssets.Other > 0 ? 'asset labels for linked Other value' : null,
        hasFundHouseSummary ? 'scheme detail behind fund-house summaries' : null,
      ].filter(Boolean);
      return answer(`For ${goal.name}, check ${checks.join(', ')} before relying on its asset exposure.`,
        `${money(result.goalTotal)} of entered value is assigned to this ${goal.years}-year goal; ${result.asOfSummary}.`,
        `These gaps can change the apparent mix. I cannot decide whether the goal is safe or the mix suitable. ${coverageNote}`, '#holdings', 'Check goal holdings');
    }
    const equity = result.goalAssets.Equity;
    return answer(`For ${goal.name}, due in ${goal.years} ${goal.years === 1 ? 'year' : 'years'}, ${money(equity)} (${percent(equity, result.goalTotal)}) of assigned value is labelled Equity. The other entered labels are Debt ${percent(result.goalAssets.Debt, result.goalTotal)}, Gold ${percent(result.goalAssets.Gold, result.goalTotal)} and Other ${percent(result.goalAssets.Other, result.goalTotal)}. ${equity ? 'To see a one-time fall using a percentage you choose, say “equity fall 20%” with your own figure.' : 'No assigned value is labelled Equity in this snapshot.'}`,
      `${money(equity)} labelled Equity ÷ ${money(result.goalTotal)} assigned value; entered age ${goal.age} and ${goal.years}-year horizon; ${result.asOfSummary}.`,
      `This describes entered exposure, not whether it is safe or suitable for your age or goal. It does not choose an allocation or trade, and fund constituents, other risks and unentered holdings are unknown. ${coverageNote}`, '#goals', 'Review goal exposure');
  }

  if (asksForAdvice(input))
    return answer('I can show what your entries say, but I cannot choose a trade, fund, or personal allocation for you. Check the dated values and your own goal mix before discussing an action with a registered investment adviser. For a self-directed checklist, ask “How do I choose a target mix?”',
      'This review uses your supplied holdings and goal inputs; it has no suitability assessment or verified current prices.',
      'A personalized action needs information and an adviser process that this browser review does not provide.', '#goals', 'Review my goal');
  if (/\bwhat should i check\b/.test(input) && /\b(?:changing|switching|selling|redeeming)\b.{0,30}\bfunds?\b/.test(input))
    return answer('Before deciding about a fund change, check the exact scheme and plan, its dated value and cost, your goal and time horizon, the current scheme factsheet and benchmark, expense ratio, exit load, and possible tax effects. Record why you hold it and what the change would accomplish. A registered investment adviser can assess a personal decision.',
      'This is a general due-diligence checklist. No scheme, tax lot, benchmark series or personal suitability assessment was verified for this question.',
      'The checklist does not say whether to change a fund or which replacement to choose.', '#holdings', 'Check fund details');
  if (/\b(?:tax|taxes|ltcg|stcg)\b/.test(input) && /\b(?:sell|sale|redeem|redemption|capital gain)\b/.test(input))
    return answer('I cannot calculate tax on a sale or redemption from this holdings snapshot. Check your purchase and sale records and the applicable tax rules before using any estimate.',
      'The review stores current entered holdings and only optional checked cost for units or shares still held; it does not have complete dated tax lots or a proposed sale.',
      'No tax rate, exemption, holding period, or personal tax situation was verified. This answer does not recommend a transaction.', '#holdings', 'Check transaction records');
  if (/\b(?:connect|link|sync)\b/.test(input) && /\b(?:zerodha|groww|upstox|broker)\b/.test(input))
    return answer('This browser review does not connect to a broker account. You can upload a supported holdings CSV or XLSX export, inspect the mapped rows and dates, and confirm only the holdings you recognize.',
      'The public site reads selected holdings files in this browser and has no broker login or account synchronization.',
      'An export is a dated snapshot; it may omit accounts or assets and does not update itself. Check its value columns and report date before confirmation.', '#report-help-dialog', 'Get a broker report');
  const reviewsHoldings = /\b(?:review|analy[sz]e|assess|improv\w*)\b/.test(input);
  const reviewsFunds = /\b(?:mutual funds?|funds?)\b/.test(input);
  const reviewsStocks = /\b(?:stocks?|shares?)\b/.test(input);
  if (reviewsHoldings && reviewsFunds !== reviewsStocks) {
    const kind = reviewsFunds ? 'Mutual fund' : 'Stock';
    const label = reviewsFunds ? 'mutual funds' : 'direct stocks';
    if (goalScopeRequested) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const rows = valid.filter(row => row.type === kind).flatMap(row => {
      const share = goalScopeRequested ? goalShare(goal, row.id) : 100;
      return share ? [{ ...row, value: Number(row.value) * share / 100 }] : [];
    });
    if (!rows.length) return answer(`No ${label} are ${goalScopeRequested ? `assigned to ${goal.name}` : 'entered in this review'} yet. Add or assign a current holding before I review that group.`,
      `0 positive ${kind} rows in ${goalScopeRequested ? `the selected goal ${goal.name}` : 'the entered snapshot'}.`,
      `This does not establish that you own no ${label} elsewhere. ${coverageNote}`, '#holdings', 'Add or assign a holding');
    const groupTotal = rows.reduce((sum, row) => sum + row.value, 0);
    const largest = positionsByIsin(rows)[0];
    const datedChecks = rows.filter(row => valuationDateIssue(row.asOf, today));
    const oldValue = datedChecks.reduce((sum, row) => sum + row.value, 0);
    const fundSummary = reviewsFunds && rows.some(row => row.granularity === 'fund_house');
    const unknownAsset = rows.some(row => row.asset === 'Other');
    const next = datedChecks.length ?
      `First check the value dates for ${datedChecks.length} ${datedChecks.length === 1 ? 'row' : 'rows'} (${money(oldValue)} of this group) against a current ${reviewsFunds ? 'CAS or AMC statement' : 'broker holdings report'}.` :
      fundSummary ? 'First get scheme-level detail behind the fund-house summary before comparing individual funds.' :
      unknownAsset ? 'First check the asset labels against the exact scheme or listed security.' :
      reviewsFunds ? 'Next compare each exact scheme’s current disclosed holdings, plan and dated costs; a fund count alone does not show company overlap.' :
        'Next check the settled share count and recent corporate actions against your broker report; a value snapshot alone does not show that the position is current.';
    const introduction = source === 'demo' ? goalScopeRequested ?
      `In the fictional example, for ${goal.name}, ` : 'In the fictional example, ' :
      goalScopeRequested ? `For ${goal.name}, ` : 'In this review, ';
    return answer(`${introduction}${rows.length} entered ${reviewsFunds ? 'fund' : 'stock'} ${rows.length === 1 ? 'row has' : 'rows have'} ${money(groupTotal)} of ${goalScopeRequested ? 'assigned' : 'entered'} value. The largest ${largest.granularity === 'fund_house' ? 'fund-house summary' : 'position'} is ${largest.name} at ${money(largest.value)} (${percent(largest.value, groupTotal)} of this group). ${next}`,
      `Used ${rows.length} positive ${kind} rows${goalScopeRequested ? ` and only their assignment shares for ${goal.name}` : ''}; grouped exact matching supplied ISINs and fund-house summaries for the largest position. ${money(largest.value)} ÷ ${money(groupTotal)} = ${percent(largest.value, groupTotal)}. ${datedChecks.length} ${datedChecks.length === 1 ? 'row needs' : 'rows need'} a value-date check.`,
      `These are supplied values and labels, not verified current account coverage${reviewsFunds ? ' or fund look-through' : ''}. This review does not choose a fund, stock, trade or suitable personal mix. ${coverageNote}`,
      goalScopeRequested ? '#goals' : '#holdings', 'Inspect this group');
  }
  if (isSipAmountQuestion(input)) {
    const historical = /\b(?:invested|paid|deposited|contributed|total|purchases?|payments?)\b/.test(input);
    const currentSchedule = /\b(?:monthly|per month|each month|every month|running|active|mandate|scheduled|currently)\b/.test(input);
    const printedSip = source === 'demo' ? null : validatedStatementSipSummary(sipSummary, today);
    if (printedSip && historical && !currentSchedule) return answer(
      `The detailed CAS read in this chat explicitly marks ${printedSip.count} SIP purchase ${printedSip.count === 1 ? 'entry' : 'entries'} totalling ₹${printedSip.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in its printed period ${printedSip.from} to ${printedSip.to}; the latest marked entry is ${printedSip.latestDate}. This is a partial statement-period total, not your lifetime SIP investment or current monthly payment.`,
      `${printedSip.count} explicitly SIP-marked purchase ${printedSip.count === 1 ? 'row' : 'rows'} in one detailed CAS. I did not derive this from current holding values or the goal’s monthly planning input. The aggregate is kept only in this chat tab.`,
      `Check those rows against the original statement. Other accounts or periods may be missing; a purchase label does not prove an active mandate or bank debit. This total is not saved with holdings.`, '#holdings', 'Check SIP rows');
    const plan = goal?.confirmed === true && goal.assumptionsChecked?.monthlyContribution === true ?
      `For ${goal.name}, you confirmed ${money(goal.monthlyContribution)} per month as a goal illustration input.` :
      'No monthly amount has been confirmed for the selected goal illustration.';
    return answer(`I cannot tell how much you actually pay into SIPs each month or have paid in the past from these holdings. ${plan} That planning input is not an active SIP or payment record. Check your current fund or broker mandates for scheduled amounts and your payment history for amounts actually paid.`,
      `${valid.length} entered holding ${valid.length === 1 ? 'row' : 'rows'} contain current value snapshots, not an active mandate list or complete dated cash flows. ${goal?.confirmed === true ? `Selected goal ${goal.name}; monthly illustration input ${money(goal.monthlyContribution)}${goal.assumptionsChecked?.monthlyContribution === true ? ' confirmed' : ' unconfirmed'}.` : 'No confirmed selected-goal monthly input.'}`,
      `A scheduled mandate can differ from completed payments, and the selected goal’s monthly assumption is independent of either. ${coverageNote}`, '#holdings', 'Check SIP records');
  }
  const sourceQuestion = /\b(?:which|what|show|list)\b.{0,70}\b(?:sources?|statements?|reports?)\b.{0,50}\b(?:used|included|behind|for|in)\b/.test(input) ||
    /\bwhere\b.{0,60}\b(?:values?|holdings?|numbers?)\b.{0,30}\b(?:from|come from)\b/.test(input) ||
    /\b(?:sources?|origins?|provenance) of (?:my|the|these) (?:portfolio|holdings?|values?|review)\b/.test(input) ||
    /\bhow many\b.{0,40}\b(?:statements?|reports?|files?)\b.{0,30}\b(?:used|included|upload(?:ed)?|did i upload)\b/.test(input);
  if (sourceQuestion) {
    if (goalScopeRequested) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const sources = summarizeReviewSources(valid, goalScopeRequested ? goal : null, today);
    const scope = goalScopeRequested ? `holding rows assigned to ${goal.name}` : 'entered holding rows';
    const destination = goalScopeRequested ? '#goals' : '#holdings';
    if (!sources.count) return answer(`There are no ${scope} with a positive value to trace yet. Add and confirm a holding or statement first.`,
      `0 positive ${goalScopeRequested ? 'assigned' : 'entered'} holding rows.`,
      `An empty review does not establish that you own no investments. ${coverageNote}`, destination, 'Add a source');
    const list = groups => groups.slice(0, 5).map(item =>
      `${item.label} ${money(item.value)} across ${item.count} ${item.count === 1 ? 'row' : 'rows'}`).join('; ') +
      (groups.length > 5 ? `; ${groups.length - 5} other source labels total ${money(groups.slice(5).reduce((sum, item) => sum + item.value, 0))}` : '');
    const dates = sources.earliestDate ? sources.earliestDate === sources.latestDate ?
      `The supplied value date is ${sources.earliestDate}.` :
      `Supplied value dates range from ${sources.earliestDate} to ${sources.latestDate}.` :
      'No usable value date is supplied.';
    const dateCheck = sources.dateCheckCount ?
      ` ${sources.dateCheckCount} ${sources.dateCheckCount === 1 ? 'row needs' : 'rows need'} a missing, future or over-90-day value-date check (${money(sources.dateCheckValue)}).` : '';
    return answer(`${goalScopeRequested ? `For ${goal.name}, ` : lead}${money(sources.total)} across ${sources.count} ${scope} has these original entry labels: ${list(sources.original)}.` +
      (sources.changed ? ` ${sources.changed} ${sources.changed === 1 ? 'row has' : 'rows have'} a later value source; latest value labels: ${list(sources.latest)}.` : '') +
      ` ${dates}${dateCheck}`,
      `Grouped positive saved holding rows by their recorded entry origin${sources.changed ? ' and latest valuation origin' : ''}${goalScopeRequested ? ', using only assigned shares' : ''}. These are row counts, not uploaded-document counts.`,
      `A source label and date do not verify the document or prove complete account coverage. The saved review does not retain original PDF files or filenames, so it cannot count or identify every uploaded document. ${coverageNote}`,
      destination, 'Inspect source rows');
  }
  const nextSourceQuestion = /\b(?:what|which)\b.{0,60}\b(?:statements?|reports?|documents?|files?|sources?)\b.{0,55}\b(?:upload|add|need|next|missing|complete)\b/.test(input) ||
    /\bwhat (?:should|can|do) i (?:upload|import)\b/.test(input);
  if (nextSourceQuestion) {
    if (source === 'demo') return answer(
      'This is a fictional example, so it cannot identify a statement missing from your accounts. Start my review, then choose Get a report or describe a holding you own.',
      'The example has no connected accounts or real source documents.',
      'Do not use sample holdings as evidence of your own portfolio coverage.', '#start-review', 'Start my review');
    if (!valid.length) return answer(
      'Start with one current source for an investment you own: try a mutual-fund CAS or CAMS Active Statement for funds, or a broker holdings XLSX/CSV for direct shares. You can also describe one holding in chat. Tell me which groups you own so I can ask what may still be missing.',
      'There are 0 confirmed holding rows and no account has been connected. Get a report links to official source instructions.',
      'A CAMS Active Statement covers CAMS-serviced funds and may not include demat holdings. Supported imports still require a row-by-row confirmation.', '#report-help-dialog', 'Get a report');
    const groups = [
      { key: 'mutualFunds', label: 'mutual funds', source: 'Try a current original mutual-fund CAS for the missing folios, or a CAMS Active Statement if those funds are CAMS-serviced. Check its scheme rows against what is already entered before adding anything.' },
      { key: 'directStocks', label: 'direct stocks', source: 'Download a current holdings XLSX/CSV from the broker account that is not fully represented, then compare its shares and ISINs with the entered rows before confirming an import.' },
      { key: 'otherInvestments', label: 'other investments', source: 'For EPF, try a current EPFO member passbook. For NPS, PPF, deposits or gold, enter a dated balance manually from your own record; those formats are not all supported as uploads yet.' },
    ];
    const flagged = groups.find(item => ['some', 'unsure'].includes(coverage?.[item.key]));
    if (flagged) return answer(
      `First check ${flagged.label}: you reported ${coverage[flagged.key] === 'some' ? 'some are missing from this review' : 'you are unsure whether they are all included'}. ${flagged.source}`,
      `Used your saved ${flagged.label} coverage answer and ${valid.length} confirmed holding rows; no external account was checked.`,
      'This identifies a source to compare, not proof that a particular holding is missing. A new statement can overlap saved positions, so review matches before confirming an import.', '#holdings', 'Compare this source');
    const unanswered = unansweredCoverageFields(coverage)[0];
    if (unanswered) {
      const label = groups.find(item => item.key === unanswered).label;
      return answer(`First tell me whether all your ${label} are included, some are missing, you own none, or you are unsure. Then I can identify a source to check without assuming what you own.`,
        `${valid.length} confirmed holding rows; coverage for ${label} has not been answered.`,
        'The entered rows alone cannot establish which accounts or statements exist outside this review.', '#holdings', 'Check review coverage');
    }
    const dated = valuationRowsNeedingCheck(valid, today);
    if (dated.length) {
      const first = dated[0];
      const sourceHint = first.row.type === 'Mutual fund' ? 'a newer scheme or folio statement' :
        first.row.type === 'Stock' ? 'a current broker holdings report' : 'a dated balance record';
      return answer(`Your coverage answers do not identify a missing group. Next check the value date for holding #${first.index + 1} against ${sourceHint}; ${dated.length} entered ${dated.length === 1 ? 'row needs' : 'rows need'} a date check.`,
        `Self-reported coverage is answered for all three groups; ${dated.length} of ${valid.length} confirmed rows have missing, future or over-90-day value dates.`,
        'Self-reported coverage and a newer value date do not verify ownership, account completeness or a live price.', '#holdings', 'Check value dates');
    }
    return answer('Your coverage answers do not identify a missing investment group, and the entered value dates passed the 90-day review check. Compare row counts and balances with your current account records before treating this as a complete picture.',
      `Self-reported coverage is answered for all three groups; ${valid.length} confirmed rows have no missing, future or over-90-day value date.`,
      'No account was connected or independently reconciled. A recent date and an “all included” answer cannot prove complete ownership.', '#holdings', 'Review entered sources');
  }
  const oneChosenEquityFall = /\bequity\b/.test(input) &&
    (input.match(/\d+(?:\.\d+)?\s*%/g) || []).length === 1;
  const namesDirectStocks = /\b(?:my|direct|held)\s+(?:equity\s+)?(?:stocks?|shares?)\b|\b(?:stocks?|shares?)\s+(?:i|we)\s+(?:own|hold)\b/.test(input);
  const oneChosenStockFall = namesDirectStocks && (input.match(/\d+(?:\.\d+)?\s*%/g) || []).length === 1;
  const oneChosenMarketFall = /\bstock market\b/.test(input) && (input.match(/\d+(?:\.\d+)?\s*%/g) || []).length === 1;
  const wholePortfolioFall = (/\b(?:portfolio|holdings|investments)\b/.test(input) || oneChosenEquityFall || oneChosenStockFall || oneChosenMarketFall) &&
    /\b(?:fall|falls|fell|drop|drops|dropped)\b/.test(input) &&
    /\b(?:what if|if|test|simulate)\b/.test(input) &&
    !/\b(?:largest|biggest|single|one holding|one position)\b/.test(input);
  if (wholePortfolioFall) {
    const scoped = Boolean(goalScopeRequested);
    const directStockOnly = namesDirectStocks && !/\bstock market\b|\bequity\s+(?:mutual\s+)?funds?\b/.test(input);
    const equityOnly = !directStockOnly && /\bequity\b/.test(input);
    if (!equityOnly && !directStockOnly && /\b(?:stocks?|shares?|stock market)\b/.test(input))
      return answer('Do you mean a hypothetical fall in only your directly held stocks, or in every entered holding labelled Equity, including equity mutual funds? Name one group and your chosen percentage, for example “What if my direct stocks fell 20%?”',
        'Directly held stocks and Equity-labelled mutual funds are different parts of the entered review; a broad market move does not tell us how much each holding would change.',
        'This question needs a chosen group and percentage for one-time arithmetic; it cannot predict how investments respond to a market move.', '#holdings', 'Review entered groups');
    if (scoped) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    if (!valid.length) return answer('Add and confirm a dated holding before testing a portfolio-wide fall.',
      'No positive confirmed holding value is entered.',
      'An empty review does not establish that you own no investments.', '#holdings', 'Add a holding');
    const rows = scoped ? valid.flatMap(row => {
      const share = goalShare(goal, row.id);
      return share ? [{ ...row, value: Number(row.value) * share / 100 }] : [];
    }) : valid;
    const total = scoped ? result.goalTotal : result.total;
    const assets = scoped ? result.goalAssets : result.assets;
    const percentages = input.match(/\d+(?:\.\d+)?\s*%/g) || [];
    const dropPct = percentages.length === 1 ? Number.parseFloat(percentages[0]) : null;
    if (dropPct === null || !Number.isFinite(dropPct) || dropPct < 1 || dropPct > 60)
      return answer('Choose one hypothetical fall from 1% to 60%, such as “What if my portfolio fell 20%?” or “What if equity in my portfolio fell 20%?”',
        `${money(total)} ${scoped ? 'assigned' : 'entered'} value, including ${money(assets.Equity)} labelled Equity; no single valid hypothetical fall was supplied.`,
        'The percentage must be your what-if choice; it is not a predicted market move.', '#holdings', 'Choose a fall');
    const dated = valuationRowsNeedingCheck(rows, today);
    if (dated.length) return answer(`Check ${dated.length} missing, future or over-90-day value ${dated.length === 1 ? 'date' : 'dates'} before using this ${scoped ? 'goal' : 'portfolio'} snapshot for a fall calculation.`,
      `${dated.length} of ${rows.length} positive ${scoped ? 'assigned ' : ''}holding rows need a valuation-date check; ${result.asOfSummary}.`,
      'A hypothetical fall calculated from an old or unavailable starting amount could be misleading.', '#holdings', 'Check entered values');
    if (scoped && result.goalAccessCheck.count)
      return answer(`Check when the ${money(result.goalAccessCheck.value)} assigned from other investments can be used for ${goal.name} before applying a fall to its goal value.`,
        `${result.goalAccessCheck.count} linked other-investment ${result.goalAccessCheck.count === 1 ? 'row has' : 'rows have'} unverified access for this goal.`,
        'A gross balance may not be available when the goal arrives; this calculation is paused rather than treating it as spendable.', '#holdings', 'Check access terms');
    if (equityOnly || directStockOnly) {
      const labelsByIsin = new Map();
      for (const row of rows) {
        if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isin || '')) continue;
        const labels = labelsByIsin.get(row.isin) || new Set();
        labels.add(`${row.type}|${row.asset}`);
        labelsByIsin.set(row.isin, labels);
      }
      if ([...labelsByIsin.values()].some(labels => labels.size > 1))
        return answer('Check the conflicting type or asset labels on rows with the same supplied ISIN before applying this fall.',
          'At least one supplied ISIN has different classifications in this review.',
          'The Equity portion cannot be trusted until those source labels are checked.', '#holdings', 'Check identifiers');
    }
    const equity = assets.Equity;
    const directStocks = rows.filter(row => row.type === 'Stock').reduce((sum, row) => sum + Number(row.value), 0);
    if (directStockOnly && rows.some(row => row.type === 'Stock' && row.asset !== 'Equity'))
      return answer('Check the asset label of your directly held stock before testing its fall. A stock row here is not labelled Equity.',
        `${rows.filter(row => row.type === 'Stock' && row.asset !== 'Equity').length} direct-stock row has a conflicting asset label.`,
        'The entered category needs source review before this group can be described as direct-stock equity.', '#holdings', 'Check stock labels');
    if (directStockOnly && !directStocks) return answer('No directly held stock value is entered for this review scope. Add or assign a current broker holding before testing a direct-stock fall.',
      `${money(total)} ${scoped ? 'assigned' : 'entered'} value; ${money(directStocks)} in direct-stock rows.`,
      `This does not establish whether you own stocks outside the review. ${coverageNote}`, '#holdings', 'Check stock holdings');
    if (equityOnly && !equity) return answer('No entered value is labelled Equity, so this review cannot show an equity-loss amount for your holdings. Check any rows labelled Other against their source.',
      `${money(total)} ${scoped ? 'assigned' : 'entered'} value; ${money(equity)} labelled Equity; ${result.asOfSummary}.`,
      `An Other label may conceal equity exposure; fund constituents and investments outside this review are unknown. ${coverageNote}`, '#holdings', 'Check asset labels');
    const movedValue = directStockOnly ? directStocks : equityOnly ? equity : total;
    const loss = movedValue * dropPct / 100;
    const after = total - loss;
    const gap = scoped ? ` The gap to ${goal.name}'s entered target in today's rupees would be ${money(Math.max(0, Number(goal.target) - after))}.` : '';
    return answer(scoped ?
      `If ${directStockOnly ? 'the assigned direct-stock value' : equityOnly ? 'the assigned value labelled Equity' : 'every assigned holding value'} for ${goal.name} fell ${dropPct}% once${directStockOnly ? ' while all other holdings stayed fixed' : equityOnly ? ' while its other asset labels stayed fixed' : ''}, its assigned value would fall by ${money(loss)} to ${money(after)} (${percent(loss, total)} lower).${gap}` : directStockOnly ?
      `If only your entered directly held stocks fell ${dropPct}% once while all other holdings stayed fixed, this entered portfolio would fall by ${money(loss)} to ${money(after)} (${percent(loss, result.total)} lower).` : equityOnly ?
      `If all entered value labelled Equity fell ${dropPct}% once while Debt, Gold and Other values stayed fixed, this entered portfolio would fall by ${money(loss)} to ${money(after)} (${percent(loss, result.total)} lower).` :
      `If every entered holding value fell ${dropPct}% once, this entered portfolio would fall by ${money(loss)} to ${money(after)} (${percent(loss, result.total)} lower).`,
      `${money(movedValue)} ${directStockOnly ? 'in direct-stock rows' : equityOnly ? 'labelled Equity' : scoped ? 'across assigned holdings' : 'across all entered holdings'} × ${dropPct}% = ${money(loss)} hypothetical loss; ${money(total)} ${scoped ? 'assigned' : 'entered'} value − ${money(loss)} = ${money(after)}. ${result.asOfSummary}.`,
      `This is one-time arithmetic from supplied dated values${scoped ? " against your goal target in today's rupees" : ''}, not a forecast, stress limit, suitability verdict or trade instruction. ${equityOnly ? 'Other labels may conceal equity, and ' : ''}Fund constituents, other price moves, taxes and unentered holdings are unknown. ${coverageNote}`, scoped ? '#goals' : '#holdings', scoped ? 'Review selected goal' : 'Review entered mix');
  }
  const holdingDetail = /^(?:review|show|describe|inspect|check|tell me about)\s+holding\s*#?(\d{1,4})[?.!]*$/.exec(input);
  if (holdingDetail) {
    const number = Number(holdingDetail[1]);
    const row = holdings[number - 1];
    if (!row || !Number.isFinite(Number(row.value)) || Number(row.value) <= 0)
      return answer(`Holding #${number} is not a confirmed positive-value row in this review. Choose a number from the displayed holdings.`,
        `${holdings.length} holding ${holdings.length === 1 ? 'row is' : 'rows are'} available in this tab.`,
        'A row number only refers to the current review and may change when you import or edit holdings.', '#holdings', 'Choose a holding');
    const issue = valuationDateIssue(row.asOf, today);
    const dateCheck = issue === 'stale' ? 'Its value date is over 90 days old; check a newer statement or broker report.' :
      issue === 'future' ? 'Its value date is in the future; check the source.' :
      issue ? 'Its value date is missing; check the source.' : 'Check that the holding amount and date still match a current source.';
    const detail = row.granularity === 'fund_house' ?
      'This is a fund-house summary; individual schemes and their plan labels are unknown.' :
      row.type === 'Mutual fund' ? `The entered scheme name ${planFromName(row.name) === 'Unclear' ? 'has no clear Direct or Regular Plan label' : `says ${planFromName(row.name)} Plan`}.` :
      row.type === 'Stock' ? 'This is labelled a directly held stock; verify the current settled share balance.' :
      'This is a manually described other investment; check its access and withdrawal terms.';
    return answer(`Holding #${number}, ${row.name}, is ${money(Number(row.value))} (${percent(Number(row.value), result.total)}) of entered investment value, labelled ${row.asset}, as of ${row.asOf || 'an unknown date'}. ${detail} ${dateCheck}`,
      `${money(Number(row.value))} ÷ ${money(result.total)} entered value; row #${number} is ${row.type}; ${row.asOf ? `supplied value date ${row.asOf}` : 'no supplied value date'}.`,
      `This is one supplied, dated row, not a verified current price, fund look-through, performance result or suitability verdict. ${coverageNote}`, '#holdings', 'Check this holding');
  }
  const portfolioRiskQuestion = /\b(?:risks?|risky|safe|volatile|volatility|balanced?)\b/.test(input) &&
    (/\b(?:portfolio|holdings|investments|asset mix|allocation)\b/.test(input) ||
      /\bam i taking too much risk\b/.test(input)) &&
    !/\b(?:fall|falls|drop|drops|stress|what if)\b/.test(input);
  if (portfolioRiskQuestion) {
    if (!valid.length) return answer('Add and confirm at least one holding with a value and valuation date before I can describe your entered portfolio exposure.',
      'No positive confirmed holding value is entered.',
      'This cannot establish your personal risk capacity or whether an investment is safe.', '#holdings', 'Add a holding');
    const scoped = Boolean(goalScopeRequested);
    if (scoped) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const rows = scoped ? valid.flatMap(row => {
      const share = goalShare(goal, row.id);
      return share ? [{ ...row, value: Number(row.value) * share / 100 }] : [];
    }) : valid;
    const total = scoped ? result.goalTotal : result.total;
    const assets = scoped ? result.goalAssets : result.assets;
    const largest = (scoped ? result.topGoalPositions : result.topPositions)[0];
    const dateChecks = valuationRowsNeedingCheck(rows, today);
    const summary = scoped ? `For ${goal.name}, the assigned holdings` : `${lead}the entered holdings`;
    return answer(`${summary} are labelled Equity ${percent(assets.Equity, total)}, Debt ${percent(assets.Debt, total)}, Gold ${percent(assets.Gold, total)} and Other ${percent(assets.Other, total)}. ` +
      `The largest entered position is ${largest.name} at ${percent(largest.value, total)} of ${scoped ? 'assigned' : 'entered'} value. ` +
      `${dateChecks.length ? `${dateChecks.length} ${dateChecks.length === 1 ? 'value date needs' : 'value dates need'} a check. ` : ''}` +
      `${assets.Other ? `${money(assets.Other)} has an unresolved asset label. ` : ''}` +
      `These are exposure checks; they cannot tell whether you are taking too much risk.${scoped ? '' : ' To explore a one-time what-if with your own percentage, ask “What if my portfolio fell 20%?” or “What if equity in my portfolio fell 20%?”'}`,
      `Equity ${money(assets.Equity)}, Debt ${money(assets.Debt)}, Gold ${money(assets.Gold)}, Other ${money(assets.Other)} ÷ ${money(total)} ${scoped ? 'assigned' : 'entered'} value. ` +
      `${money(largest.value)} ÷ ${money(total)} for the largest grouped position. ${result.asOfSummary}.`,
      `Fund constituents, other risks and holdings outside this review are not verified. A fund-house summary can contain several schemes. This is not a risk score, safety or suitability verdict, or allocation or trade instruction. ${coverageNote}`,
      scoped ? '#goals' : '#holdings', scoped ? 'Review this goal' : 'Inspect holdings');
  }
  if (/\b(?:largest|biggest|top)\s+(?:holding|position)\b/.test(input) &&
      /\b(?:fall|falls|fell|drop|drops|dropped|halve|halves|halved)\b/.test(input)) {
    const scoped = Boolean(goalScopeRequested);
    if (scoped) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const values = input.match(/\d+(?:\.\d+)?\s*%/g) || [];
    const half = /\b(?:halve|halves|halved)\b/.test(input);
    const dropPct = half ? 50 : values.length === 1 ? Number.parseFloat(values[0]) : null;
    if (values.length > 1 || half && values.length || dropPct === null || dropPct < 1 || dropPct > 100)
      return answer('Choose one hypothetical fall between 1% and 100%, such as “What if my largest holding falls 20%?” I will keep the other entered values fixed.',
        'No single valid fall percentage was supplied for this question.',
        'The percentage is your what-if input, not a predicted market move.', scoped ? '#goals' : '#holdings', 'Choose one fall');
    const rows = scoped ? valid.flatMap(row => {
      const share = goalShare(goal, row.id);
      return share ? [{ ...row, value: Number(row.value) * share / 100 }] : [];
    }) : valid;
    const total = scoped ? result.goalTotal : result.total;
    if (!rows.length) return answer(`Add and confirm ${scoped ? 'a holding assigned to this goal' : 'a fund or stock'} before testing a hypothetical fall.`,
      `No positive ${scoped ? 'assigned ' : ''}holding value is available in this review.`,
      'An empty review does not mean you own no investments.', scoped ? '#goals' : '#holdings', 'Add a holding');
    const datedIssues = rows.filter(row => valuationDateIssue(row.asOf, today)).length;
    if (datedIssues || scoped && result.goalAccessCheck.count)
      return answer(`Check ${datedIssues ? `${datedIssues} missing, future or over-90-day value date${datedIssues === 1 ? '' : 's'}` : 'the linked value dates'}${scoped && result.goalAccessCheck.count ? `${datedIssues ? ' and ' : ''}access to ${money(result.goalAccessCheck.value)} of linked other investments` : ''} before applying a fall to this ${scoped ? 'goal' : 'portfolio'} snapshot.`,
        `${rows.length} entered ${scoped ? 'assigned ' : ''}holding rows; ${datedIssues} need a date check${scoped ? `; ${result.goalAccessCheck.count} linked other-investment rows need an access check` : ''}.`,
        'A hypothetical fall applied to an old or unavailable starting amount would be misleading.', '#holdings', 'Check entered values');
    const labelsByIsin = new Map();
    for (const row of rows) {
      if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isin || '')) continue;
      const labels = labelsByIsin.get(row.isin) || new Set();
      labels.add(`${row.type}|${row.asset}`);
      labelsByIsin.set(row.isin, labels);
    }
    if ([...labelsByIsin.values()].some(labels => labels.size > 1))
      return answer('Check the conflicting type or asset labels on rows with the same supplied ISIN before choosing the largest position.',
        'At least one supplied ISIN appears with different classifications in this review.',
        'The same identifier cannot be ranked safely as separate instruments until its source rows are checked.', '#holdings', 'Check identifiers');
    const largest = positionsByIsin(rows, { withSourceIndexes: true })[0];
    if (!largest || largest.granularity === 'fund_house' ||
        rows[largest.sourceIndexes[0]]?.type === 'Other investment')
      return answer('The largest entered amount is a fund-house summary or manually valued other investment. Check a scheme-level statement or ask about a specific fund or stock before testing a single-position fall.',
        `Largest entered amount: ${largest ? `${largest.name} ${money(largest.value)}` : 'none'}.`,
        'A fund-house total can contain several schemes, and access or value behavior of other savings is not verified.', '#holdings', 'Check holding detail');
    const loss = largest.value * dropPct / 100;
    const after = total - loss;
    const goalGap = scoped ? Math.max(0, Number(goal.target) - after) : null;
    return answer(`If ${largest.name} fell ${dropPct}% once while every other entered value stayed fixed, ${scoped ? `the value assigned to ${goal.name}` : 'the entered portfolio'} would fall by ${money(loss)} to ${money(after)} (${percent(loss, total)} lower).${scoped ? ` The gap to your goal target in today’s rupees would be ${money(goalGap)}.` : ''}`,
      `${money(largest.value)} in ${largest.entries} ${largest.entries === 1 ? 'entry' : 'entries'} × ${dropPct}% = ${money(loss)} hypothetical loss; ${money(total)} entered ${scoped ? 'assigned ' : ''}value − ${money(loss)} = ${money(after)}. Exact matching supplied ISINs and classifications are grouped. ${result.asOfSummary}.`,
      `This is a one-time arithmetic what-if, not a forecast, risk score or trade instruction. Fund constituents, other price moves, taxes and unentered holdings are unknown. ${coverageNote}`, scoped ? '#goals' : '#holdings', 'Review entered positions');
  }
  if (/\b(?:on track|can i retire|ready to retire|enough to retire|afford to retire)\b/.test(input)) {
    if (/\bretir\w*\b/.test(input) && !/\bretir\w*\b/i.test(goal?.name || ''))
      return answer(`The selected goal is ${goal?.name || 'unfinished'}, not Retirement. Select or create your retirement goal so this question uses its own target and assigned holdings.`,
        'Only the selected goal can supply a target, horizon and assigned value.',
        'Another goal’s balance cannot establish retirement readiness.', '#goals', 'Select retirement goal');
    const retirementAge = /\bretir\w*\s+(?:at|by)\s+(?:age\s+)?(\d{2,3})\b/.exec(input);
    if (retirementAge && goal?.confirmed === true) {
      const askedAge = Number(retirementAge[1]);
      const goalAge = Number(goal.age) + Number(goal.years);
      if (askedAge < 18 || askedAge > 100)
        return answer('Check the retirement age in your question; this review accepts ages from 18 to 100.',
          `You entered age ${goal.age} and a ${goal.years}-year horizon for ${goal.name}.`,
          'No retirement-readiness comparison is made from an invalid age.', '#goals', 'Check retirement age');
      if (goalAge !== askedAge)
        return answer(`You asked about retiring at age ${askedAge}, but the selected ${goal.name} goal is set for approximately age ${goalAge} (age ${goal.age} plus ${goal.years} years). Check and update that goal’s horizon before I use its target and assigned value for this question.`,
          `Entered age ${goal.age} + entered horizon ${goal.years} years = approximate goal age ${goalAge}; asked age ${askedAge}.`,
          'The goal has no exact date or birthday, and a different retirement age may require a different target. I cannot decide whether retirement is affordable.', '#goals', 'Check goal timing');
    }
    if (goal?.confirmed !== true)
      return answer('Confirm the selected goal’s age, target in today’s rupees and time horizon before checking its entered value.',
        `The selected goal ${goal?.name || 'unnamed'} is unfinished.`,
        'A holdings snapshot alone cannot show whether you are on track.', '#goals', 'Confirm goal details');
    if (!result.goalTotal)
      return answer(`No entered holdings are assigned to ${goal.name} yet. Link and check the holdings you intend to count toward it.`,
        `Selected goal ${goal.name}; assigned value ₹0 against a ${money(goal.target)} target in today’s rupees.`,
        'An empty or unassigned review does not mean you have no savings.', '#holdings', 'Link a holding');
    if (result.goalDateCheck.count || result.goalAccessCheck.count) {
      const checks = [
        result.goalDateCheck.count ? `${result.goalDateCheck.count} assigned value date${result.goalDateCheck.count === 1 ? '' : 's'}` : null,
        result.goalAccessCheck.count ? `access to ${money(result.goalAccessCheck.value)} of linked other investments` : null,
      ].filter(Boolean).join(' and ');
      return answer(`I cannot judge whether ${goal.name} is on track from this snapshot. First check ${checks}.${otherAccessBound}`,
        `${money(result.goalTotal)} entered value is assigned against a ${money(goal.target)} target in today’s rupees; ${result.asOfSummary}.`,
        'Old or missing dates and withdrawal terms can change what is available at the goal date. This is not a retirement or suitability assessment.', '#holdings', 'Check linked holdings');
    }
    const gap = calculateStraightLineGap(result.goalTotal, goal);
    if (!gap) return answer('Check the selected goal amount and horizon before comparing its entered value with the target.',
      `Selected goal ${goal.name}; current-gap arithmetic is unavailable.`,
      'No on-track conclusion is inferred from invalid goal inputs.', '#goals', 'Check goal details');
    return answer(`I cannot tell whether ${goal.name} is on track from a holdings snapshot. You entered ${money(result.goalTotal)} assigned toward a ${money(goal.target)} target in today’s rupees, leaving a current gap of ${money(gap.gapToday)} across ${goal.years} years. ${confirmedGoalAssumptions(goal) ? 'Ask “future goal gap” to see a separate what-if using the assumptions you confirmed.' : 'To explore a separate future what-if, confirm your own monthly contribution, growth and inflation assumptions.'}`,
      `${money(goal.target)} target today minus ${money(result.goalTotal)} assigned value = ${money(gap.gapToday)} current gap; ${result.asOfSummary}.`,
      `This is a current comparison, not a forecast or a retirement-readiness verdict. Future contributions, inflation, returns, taxes and unentered holdings are not established. ${coverageNote}`, '#goals', 'Review goal inputs');
  }
  if (/\b(?:goal readiness|goal checks|check my goal|check this goal|what needs checking for (?:my|this) goal)\b/.test(input)) {
    if (goal?.confirmed !== true) {
      const missing = [['age', 'your current age'], ['years', 'years until the goal'],
        ['target', 'the goal amount in today’s rupees']].find(([key]) => goal?.[key] == null);
      return answer(`For ${goal?.name || 'your selected goal'}, first confirm ${missing?.[1] || 'your age, horizon and target'} in chat.`,
        `The selected goal is unfinished; ${missing?.[1] || 'at least one required fact'} is not confirmed.`,
        'A statement does not establish your goal timing or a suitable allocation.', '#goals', 'Confirm goal details');
    }
    if (!valid.length) return answer(`For ${goal.name}, first add and confirm a current holding or supported statement.`,
      `You entered age ${goal.age} and ${goal.years} years until this goal, but no positive holding value is in the review.`,
      'An empty review does not mean you own no investments.', '#holdings', 'Add a holding');
    if (!result.goalTotal) return answer(`For ${goal.name}, first link the holdings you intend to count toward it.`,
      `You entered age ${goal.age} and ${goal.years} years until this goal; ₹0 of ${money(result.total)} entered value is assigned to it.`,
      'Only assigned shares count toward a goal. The link does not prove the money can be used then.', '#goals', 'Review goal assignments');
    const uncertainScope = [['mutualFunds', 'mutual funds'], ['directStocks', 'direct stocks'],
      ['otherInvestments', 'other investments']].filter(([key]) =>
      ['some', 'unsure'].includes(coverage?.[key])).map(([, label]) => label);
    const context = `For ${goal.name}, you entered age ${goal.age}, ${goal.years} years until the goal, and ${money(result.goalTotal)} of assigned value. ` +
      (uncertainScope.length ? `You reported partial or unsure coverage for ${uncertainScope.join(', ')}; the remaining checks use only entered holdings. ` : '');
    const basis = `${result.goalHoldingCount} assigned holding ${result.goalHoldingCount === 1 ? 'row' : 'rows'}; ${result.asOfSummary}.`;
    const incomplete = [['mutualFunds', 'mutual funds'], ['directStocks', 'direct stocks'],
      ['otherInvestments', 'other investments']].find(([key]) => coverage?.[key] == null);
    if (incomplete) return answer(context + `First check whether the entered ${incomplete[1]} cover everything you own in that group. Say “I included all my ${incomplete[1]}”, “I included some of my ${incomplete[1]}”, or say you are unsure, using your latest statement.`,
      `${basis} Coverage for ${incomplete[1]} is ${coverage?.[incomplete[0]] || 'not answered'}.`,
      'Coverage is self reported. This review cannot inspect accounts you have not provided.', '#holdings', 'Check review coverage');
    if (result.goalDateCheck.count) return answer(context + `Next check ${result.goalDateCheck.count} assigned ${result.goalDateCheck.count === 1 ? 'value with a missing, future or old date' : 'values with missing, future or old dates'} against a newer source.`,
      `${basis} ${money(result.goalDateCheck.value)} of assigned value needs a valuation-date check.`,
      'A newer price alone does not confirm the same units or shares are still held.', '#holdings', 'Check dated values');
    if (result.goalAccessCheck.count) return answer(context + 'Next check the withdrawal or maturity terms for the other investments linked to this goal.',
      `${basis} ${money(result.goalAccessCheck.value)} of assigned other-investment value has no checked access date.`,
      'A gross balance does not prove it is spendable when the goal arrives.', '#holdings', 'Check access to savings');
    if (result.goalAssets.Other > 0) return answer(context + 'Next check the asset category of holdings labelled Other against their original source.',
      `${basis} ${money(result.goalAssets.Other)} of assigned value has no confirmed Equity, Debt or Gold label.`,
      'An unknown category cannot support a reliable asset-mix comparison.', '#holdings', 'Check asset labels');
    if (!goal.emergencyFunding) return answer(context + 'Next say whether a nearer unexpected essential expense would use separate money, these goal holdings, or whether you are unsure.',
      `${basis} No unexpected-expense funding answer is confirmed for this goal.`,
      'Age and time horizon alone do not show whether this goal can stay invested through an earlier need.', '#goals', 'Check nearer expenses');
    let riskSummary = '';
    let riskBasis = '';
    if (result.goalAssets.Equity > 0) {
      if (goal.equityDropPct === undefined) return answer(context + 'Next choose a hypothetical one-time equity fall to test, such as “equity fall 25%”. You choose the size; it is not a market forecast.',
        `${basis} ${money(result.goalAssets.Equity)} of assigned value is labelled Equity.`,
        'This arithmetic will hold other assets fixed and cannot establish your risk profile or a suitable allocation.', '#goals', 'Test a hypothetical fall');
      if (result.stressPause || !result.shock) return answer(context + 'The equity-fall check needs its assigned values and labels reviewed before it can be interpreted.',
        `${basis} Stress calculation status: ${result.stressPause || 'unavailable'}.`,
        'An unverified balance or category can change the illustrated loss.', '#holdings', 'Check source details');
      const shock = result.shock;
      if (goal.affordableLoss === undefined) return answer(context + `At your ${shock.dropPct}% hypothetical equity fall, the assigned value would fall by ${money(shock.loss)}. Next say “loss I can cover ₹50,000” with the amount you could actually cover without disrupting essentials.`,
        `${money(result.goalAssets.Equity)} assigned Equity × ${shock.dropPct}% = ${money(shock.loss)} illustrated loss; ${basis}`,
        'The example is a one-time fall, not a forecast. The entered cover amount is your statement, not a verified capacity assessment.', '#goals', 'Check loss capacity');
      if (goal.tolerableLoss === undefined) return answer(context + `At your ${shock.dropPct}% hypothetical equity fall, the assigned value would fall by ${money(shock.loss)}. You entered ${money(goal.affordableLoss)} as a loss you could cover. Next say “loss I can tolerate ₹50,000” with your own separate tolerance amount.`,
        `${money(result.goalAssets.Equity)} assigned Equity × ${shock.dropPct}% = ${money(shock.loss)} illustrated loss; ${basis}`,
        'A loss someone says they can tolerate may differ from what they can afford. Neither amount is independently checked.', '#goals', 'Check loss tolerance');
      const covered = result.lossLimits?.affordable;
      const tolerated = result.lossLimits?.tolerable;
      const compare = (check, label) => check.excess > 0 ?
        `exceeds the ${money(check.limit)} you said you could ${label} by ${money(check.excess)}` :
        `does not exceed the ${money(check.limit)} you said you could ${label}`;
      riskSummary = `At your ${shock.dropPct}% hypothetical equity fall, the assigned loss is ${money(shock.loss)}; this ${compare(covered, 'cover')}, and ${compare(tolerated, 'tolerate')}. `;
      riskBasis = ` ${money(result.goalAssets.Equity)} assigned Equity × ${shock.dropPct}% = ${money(shock.loss)}; compared with your entered cover limit ${money(covered.limit)} and tolerance limit ${money(tolerated.limit)}.`;
    }
    if (!goal.targetMix) return answer(context + riskSummary + 'If you already have a mix chosen for this goal, enter it to compare with the assigned holdings. The review cannot choose percentages for you.',
      `${basis}${riskBasis} Assigned labels: Equity ${percent(result.goalAssets.Equity, result.goalTotal)}, Debt ${percent(result.goalAssets.Debt, result.goalTotal)}, Gold ${percent(result.goalAssets.Gold, result.goalTotal)}.`,
      'These are supplied labels and dated values. The hypothetical fall is not a worst case; a chosen mix is optional and should not be inferred from age.', '#goals', 'Compare a chosen mix');
    if (result.mixComparison) {
      const largest = result.mixComparison.reduce((best, row) =>
        !best || Math.abs(row.differencePct) > Math.abs(best.differencePct) ? row : best, null);
      return answer(context + riskSummary + `${largest.asset} is ${largest.currentPct.toFixed(1)}% of assigned value versus ${largest.plannedPct.toFixed(1)}% in the mix you entered. Review whether your chosen mix still reflects this goal.`,
        `${basis}${riskBasis} ${money(result.goalAssets[largest.asset])} assigned to ${largest.asset} ÷ ${money(result.goalTotal)} = ${largest.currentPct.toFixed(1)}%.`,
        'This comparison does not assess whether the chosen mix is suitable or tell you to trade. Fund constituents, tax and transaction costs are unknown.', '#goals', 'Review chosen mix');
    }
    return answer(context + 'Check the original fund or broker detail behind this goal before interpreting its mix.',
      `${basis} Chosen-mix comparison status: ${result.mixPause || 'unavailable'}.`,
      'The current inputs do not support a reliable mix comparison or a personalized allocation.', '#holdings', 'Check source details');
  }
  if (/\bnet worth\b/.test(input))
    return answer(valid.length ?
      `The entered investment holdings total ${money(result.total)}. That is a gross, dated investment subtotal, not your net worth.` :
      'No investment holdings are entered here yet. I cannot calculate your net worth from this review.',
    valid.length ? `${valid.length} positive entered holding ${valid.length === 1 ? 'value' : 'values'} added once; ${result.asOfSummary}.` :
      'No positive investment holding values are entered.',
    `Net worth needs all assets minus all liabilities. This review does not record your complete assets, loans and other debts. ${coverageNote}`,
    '#holdings', 'Check investment holdings');

  if (/\b(?:unassigned|not assigned)\b/.test(input) ||
      (/\b(?:not counted|excluded|outside)\b/.test(input) &&
        (goalScopeRequested || /\b(?:portfolio|holdings?|investments?|value)\b/.test(input)))) {
    const selected = goal || { id: null, name: 'the selected goal', linkedIds: [] };
    const allGoals = Array.isArray(goals) && goals.some(item => item.id === selected.id) ? goals : [selected];
    const outside = summarizeGoalCoverage(allGoals, selected.id, valid);
    const outsideValue = outside.elsewhereValue + outside.unassignedValue;
    const assigned = result.goalTotal || 0;
    const examples = valid.map(row => ({ name: row.name,
      value: Number(row.value) * (100 - goalShare(selected, row.id)) / 100 }))
      .filter(row => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 3);
    const sample = examples.length ? ` Largest excluded portions: ${examples.map(row =>
      `${row.name} ${money(row.value)}`).join('; ')}.` : '';
    return answer(valid.length ?
      `For ${selected.name}, ${money(assigned)} of ${money(result.total)} entered value is counted. ${money(outsideValue)} sits outside this goal: ${money(outside.unassignedValue)} is unassigned and ${money(outside.elsewhereValue)} is assigned to other goals.${sample}` :
      'No positive holding value is entered yet, so there is nothing to assign to a goal.',
      valid.length ?
        `Added each entered holding value once. For each row, counted its share linked to ${selected.name}, its shares linked to other goals, and the remaining unassigned share. ${outside.unassignedCount} ${outside.unassignedCount === 1 ? 'row has' : 'rows have'} an unassigned portion; ${outside.elsewhereCount} ${outside.elsewhereCount === 1 ? 'row has' : 'rows have'} a portion linked elsewhere. ${result.asOfSummary}.` :
        'No positive holding values are entered in this tab.',
      `These are supplied assignments and dated values, not verified account coverage. A split holding can appear in more than one category, but its value is counted only once. ${coverageNote}`,
      '#goals', 'Review goal assignments');
  }
  if (goalScopeRequested && /^(?:which|what|show|list)\b/.test(input) &&
      /\b(?:holdings?|investments?|funds?|stocks?|shares?)\b/.test(input) &&
      /\b(?:count|counted|assigned|linked|fund|funding|toward|towards|for)\b/.test(input) &&
      !/\b(?:biggest|largest|top|concentrat\w*|rank\w*|amc|fund[ -]?houses?)\b/.test(input)) {
    const type = /\b(?:stocks?|shares?)\b/.test(input) && !/\b(?:funds?|investments?|holdings?)\b/.test(input) ? 'Stock' :
      /\b(?:mutual funds?|funds?)\b/.test(input) && !/\b(?:stocks?|shares?|investments?|holdings?)\b/.test(input) ? 'Mutual fund' : null;
    const linked = holdings.flatMap((row, index) => {
      const share = goalShare(goal, row.id);
      return Number(row.value) > 0 && share && (!type || row.type === type) ?
        [{ row, index: index + 1, share, value: Number(row.value) * share / 100 }] : [];
    });
    const total = linked.reduce((sum, item) => sum + item.value, 0);
    const names = linked.slice(0, 5).map(item =>
      `#${item.index} ${item.row.name}: ${money(item.value)}${item.share < 100 ? ` (${item.share}% of this row)` : ''}`).join('; ');
    const label = type === 'Stock' ? 'direct-stock' : type === 'Mutual fund' ? 'mutual-fund' : 'holding';
    return answer(linked.length ?
      `${linked.length} entered ${label} ${linked.length === 1 ? 'row counts' : 'rows count'} toward ${goal.name}, with ${money(total)} assigned value. ${names}${linked.length > 5 ? `; and ${linked.length - 5} more in the review` : ''}.` :
      `No entered ${label} value is assigned to ${goal?.name || 'the selected goal'} yet. Check its links in the review.`,
      `Applied the selected goal’s saved percentage to each positive entered ${label} row; ${result.asOfSummary}. Whole-portfolio values count each row once.`,
      `These are supplied links and dated values, not verified account coverage or proof that the money can be used at the goal date. A fund-house summary can combine schemes. ${coverageNote}`,
      '#goals', 'Review assigned holdings');
  }
  if ((/\b(?:mutual funds?|funds?)\b/.test(input) && /\b(?:stocks?|shares?)\b/.test(input) &&
      /\b(?:how much|how many|percent(?:age)?|share|split|breakdown|versus|vs)\b/.test(input)) ||
      /\b(?:product|investment)\s+(?:type|category)\s+(?:split|breakdown|mix)\b/.test(input)) {
    if (goalScopeRequested) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const rows = valid.flatMap(row => {
      const share = goalScopeRequested ? goalShare(goal, row.id) : 100;
      return share ? [{ ...row, value: Number(row.value) * share / 100 }] : [];
    });
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const value = type => rows.filter(row => row.type === type).reduce((sum, row) => sum + row.value, 0);
    const funds = value('Mutual fund');
    const stocks = value('Stock');
    const other = value('Other investment');
    return answer(total ?
      `${goalScopeRequested ? `For ${goal.name}, ` : lead}mutual funds are ${money(funds)} (${percent(funds, total)}), directly held stocks ${money(stocks)} (${percent(stocks, total)}), and other investments ${money(other)} (${percent(other, total)}) of ${money(total)} ${goalScopeRequested ? 'assigned' : 'entered'} value.` :
      `No positive ${goalScopeRequested ? 'assigned' : 'entered'} holding value is available for a product-type breakdown.`,
      `Grouped ${rows.length} positive ${goalScopeRequested ? 'assigned shares of ' : ''}holding rows by their confirmed type. ${result.asOfSummary}.`,
      `A mutual fund may itself hold stocks or other assets, and a fund-house summary may contain multiple schemes. This is a product-type split, not underlying asset exposure. ${coverageNote}`,
      goalScopeRequested ? '#goals' : '#holdings', goalScopeRequested ? 'Review assigned holdings' : 'Inspect holdings');
  }
  if (/\b(?:portfolio|holdings|investments)\b/.test(input) &&
      /\b(?:beat(?:ing)?|outperform(?:ing)?|underperform(?:ing)?|lag(?:ging)?)\b.{0,20}\b(?:nifty|sensex|benchmark|index)\b/.test(input))
    return answer('I cannot establish whether your portfolio beat that benchmark from a current holdings snapshot. A fair comparison needs complete dated cash flows, a matching period and a verified benchmark series.',
      `${valid.length} current entered holding ${valid.length === 1 ? 'row' : 'rows'}; no verified benchmark series or complete transaction history is available.`,
      'A current value, entered gain or goal growth assumption is not a historical portfolio return.', '#holdings', 'Check transaction history');
  if (/\b(?:underperform\w*|outperform\w*|beat(?:ing)? (?:the )?benchmark|lag(?:ging)? (?:the )?benchmark|doing well|perform(?:ed|ing)? (?:best|worst)|best.perform(?:ing|ed))\b/.test(input))
    return answer('I cannot call an entered fund an underperformer from a holdings snapshot or a current-position gain or loss. Compare the exact scheme, plan and option with its stated benchmark over the same period, using verified historical figures. For your own return, complete dated cash flows are also needed.',
      `${valid.filter(row => row.type === 'Mutual fund').length} entered mutual-fund rows; this browser review holds no verified benchmark series or complete transaction history.`,
      'An entered loss does not prove benchmark underperformance, and a gain does not prove outperformance. This answer does not rank funds or suggest an exit.', '#holdings', 'Check scheme factsheet');
  const changeIntent = positionChangeIntent(input);
  if (changeIntent) {
    const { kind, losing } = changeIntent;
    const scope = kind === 'Mutual fund' ? 'mutual-fund' : kind === 'Stock' ? 'direct-stock' : 'holding';
    const rows = valid.flatMap(row => !kind || row.type === kind ? [{ row, number: holdings.indexOf(row) + 1 }] : []);
    if (!rows.length) return answer(`No ${scope} rows are entered for this review.`,
      `0 positive entered ${scope} rows.`, 'This does not establish what you own outside the review.', '#holdings', 'Add a holding');
    const covered = rows.flatMap(item => summarizeUnrealizedChange([item.row], today).coveredCount ?
      [{ ...item, difference: Number(item.row.value) - item.row.costBasis }] : []);
    if (!covered.length) return answer(`No ${scope} row has both a checked cost for its currently held units or shares and a usable dated value. Check those facts before asking which positions show a gain or loss.`,
      `${rows.length} entered ${scope} rows; 0 have a usable current-position cost and dated value pair.`,
      'A fund-house summary or a purchase total including sold units cannot establish a current-position gain or loss.', '#holdings', 'Check holding costs');
    const ranked = covered.filter(item => losing ? item.difference < 0 : item.difference > 0)
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.number - b.number);
    const direction = losing ? 'loss' : 'gain';
    const total = ranked.reduce((sum, item) => sum + Math.abs(item.difference), 0);
    const list = ranked.slice(0, 5).map(item => `#${item.number} ${item.row.name}: ${rupeesWithPaise(Math.abs(item.difference))} as of ${item.row.asOf}`).join('; ');
    const dateChecks = covered.filter(item => valuationDateIssue(item.row.asOf, today)).length;
    return answer(ranked.length ?
      `${lead}${ranked.length} of ${covered.length} covered ${scope} ${covered.length === 1 ? 'row shows' : 'rows show'} an entered unrealized ${direction}, totaling ${rupeesWithPaise(total)}: ${list}${ranked.length > 5 ? `; and ${ranked.length - 5} more` : ''}.` :
      covered.length === 1 ? `${lead}the one covered ${scope} row does not show an entered unrealized ${direction}.` :
        `${lead}none of the ${covered.length} covered ${scope} rows show an entered unrealized ${direction}.`,
      `Compared ${covered.length} covered current-position ${covered.length === 1 ? 'value with its' : 'values with each row’s'} checked cost; ${rows.length - covered.length} ${scope} ${rows.length - covered.length === 1 ? 'row lacks' : 'rows lack'} a usable pair.${dateChecks ? ` ${dateChecks} covered ${dateChecks === 1 ? 'value date needs' : 'value dates need'} a freshness check.` : ''}`,
      `These are per-row, dated differences, not annual returns, benchmark performance, lifetime profit or a reason to trade. They exclude sold positions, distributions, taxes, exit loads and unchecked costs. ${coverageNote}`, '#holdings', 'Inspect covered holdings');
  }
  if (/\b(xirr|cagr|annual(?:ized)? return|performance)\b/.test(input))
    return answer('A holdings snapshot cannot establish your annual return or XIRR. Complete dated cash flows are needed before calculating those figures.',
      `${valid.length} entered current holding ${valid.length === 1 ? 'value' : 'values'}; no complete transaction history is held in this browser review.`,
      'The goal growth assumption is an illustration, not your historical return.', '#holdings', 'Check source statements');
  if (/\b(?:invested|investment amount|cost basis|purchase cost)\b/.test(input) &&
      !/\b(?:profit|gains?|loss(?:es)?|returns?)\b/.test(input)) {
    const cost = result.unrealizedChange;
    if (!cost?.coveredCount) return answer(cost?.costAfterValueCount ?
      'A checked invested amount exists, but it is dated after the holding value. Refresh that value before including this position in a covered invested total.' :
      'No checked invested amount is paired with a dated value yet. For one fund or stock, say “set invested amount of NAME to ₹40,000 checked YYYY-MM-DD” using the cost of the units or shares you still hold.',
      `${valid.length} entered holding rows; 0 have usable paired cost and value dates.`,
      'A purchase total that includes sold units is not the invested cost of the positions still held.', '#holdings', 'Check holding costs');
    return answer(`${lead}the checked invested amount is ${rupeesWithPaise(cost.invested)} across ${cost.coveredCount} of ${valid.length} entered ${valid.length === 1 ? 'holding' : 'holdings'}.`,
      `Added only checked current-position costs paired with dated values; covered value ${rupeesWithPaise(cost.coveredValue)}. ${cost.missingCount} ${cost.missingCount === 1 ? 'row' : 'rows'} excluded${cost.costAfterValueCount ? `, including ${cost.costAfterValueCount} with cost checked after the value date` : ''}.`,
      'This is a partial cost total for holdings still entered here, not all money ever invested or lifetime profit. Sold units, other assets and unchecked costs are excluded.', '#holdings', 'Check covered holdings');
  }
  if (/\b(profit|gains?|loss(?:es)?|invested|returns?)\b/.test(input)) {
    const change = result.unrealizedChange;
    if (!change?.coveredCount) return answer(change?.costAfterValueCount ?
      'The checked invested amount is dated after the holding value. Refresh the value for the same units or shares before calculating an unrealized gain or loss.' :
      'No unrealized gain or loss can be calculated yet. For one individual fund or stock with a dated value, say “set invested amount of NAME to ₹40,000 checked YYYY-MM-DD” using the cost of the units or shares you still hold.',
      `${valid.length} entered holding rows; none has cost checked on or before its dated value${change?.costAfterValueCount ? `; ${change.costAfterValueCount} cost ${change.costAfterValueCount === 1 ? 'date is' : 'dates are'} later than the value date` : ''}.`,
      'A total purchase amount that includes sold units is not the cost of the units still held. Complete dated cash flows would be needed for XIRR.', '#holdings', 'Check holding details');
    const direction = change.change >= 0 ? 'gain' : 'loss';
    const percentChange = (Math.abs(change.change) / change.invested * 100).toFixed(1);
    return answer(`${lead}${change.coveredCount} covered ${change.coveredCount === 1 ? 'holding has' : 'holdings have'} an entered unrealized ${direction} of ${rupeesWithPaise(Math.abs(change.change))} (${percentChange}% of the invested amount).`,
      `${rupeesWithPaise(change.coveredValue)} entered current value minus ${rupeesWithPaise(change.invested)} entered cost for the covered positions; value dates ${change.earliestValueDate}${change.latestValueDate !== change.earliestValueDate ? ` to ${change.latestValueDate}` : ''}. ${change.missingCount} ${change.missingCount === 1 ? 'row' : 'rows'} excluded${change.costAfterValueCount ? `, including ${change.costAfterValueCount} with cost checked after the value date` : ''}.`,
      'This is not total lifetime profit or an annual return. It excludes sold positions, cash distributions, taxes, exit loads, rows without checked cost or dated value, and cost checked after the value date.', '#holdings', 'Check covered holdings');
  }
  if (/\b(nav|share price|stock price|market price|live quote|live price|today.{0,25}(?:price|nav|value)|latest.{0,25}(?:price|nav|value))\b/.test(input)) {
    const fund = valid.find(row => row.type === 'Mutual fund' && row.granularity !== 'fund_house' && row.units);
    return answer('I do not have a live market feed here. Use a dated value from your broker or fund statement, then update the holding in this browser.' +
      (fund ? ` If you checked the exact scheme NAV and still own its ${fund.units} statement units, say “set NAV of holding ${holdings.indexOf(fund) + 1} to ₹125.4321 as of YYYY-MM-DD” to preview a dated estimate.` : ''),
      result.asOfSummary,
      'A recent statement value may still differ from the current market value. An entered NAV times old units is only an estimate until you confirm the units have not changed.', '#holdings', 'Check entered dates');
  }
  const incomeGap = /^what if i (?:lost|lose|had no) (?:my )?(?:income|salary|pay) for (\d{1,2}) months?[?.!]*$/.exec(input) ||
    /^could (?:my )?(?:reserve|emergency fund|emergency buffer) cover (\d{1,2}) months?(?: without income)?[?.!]*$/.exec(input);
  if (incomeGap) {
    const months = Number(incomeGap[1]);
    if (months < 1 || months > 36) return answer(
      'Choose a period from 1 to 36 months for this arithmetic what-if, such as “What if I had no income for 6 months?”',
      'No valid period was supplied.',
      'The period is your own scenario, not a reserve target chosen by this review.', '#goals', 'Choose a period');
    if (reserveMonths(reserve) === null) return answer(
      `For a ${months}-month income-gap check, first enter monthly essentials and accessible money outside these holdings, then confirm both totals.`,
      'The review does not have both separate reserve totals needed for this calculation.',
      'Investment holding values are not assumed to be accessible cash.', '#goals', 'Add separate reserve totals');
    const expenses = reserve.monthlyEssentials * months;
    const difference = reserve.accessibleMoney - expenses;
    return answer(`For ${months} months without income, your entered ${money(reserve.monthlyEssentials)} monthly essentials total ${money(expenses)}. Your entered ${money(reserve.accessibleMoney)} accessible money outside holdings would ${difference < 0 ?
      `be short by ${money(-difference)}` : `leave ${money(difference)}`} by subtraction.`,
      `${money(reserve.monthlyEssentials)} × ${months} months = ${money(expenses)} essential spending; ${money(reserve.accessibleMoney)} separate accessible money minus ${money(expenses)} = ${difference < 0 ? '-' : ''}${money(Math.abs(difference))}. No holding value was counted.`,
      'This fixed-spending what-if assumes no other income and does not verify access to the money. Other costs, debt payments and changing expenses are not included. It is not a reserve target or personal advice.',
      'https://investor.sebi.gov.in/moneymatters-inc-exp.html', 'Read SEBI emergency-fund context');
  }
  if (/\b(?:reserve|emergency buffer|emergency fund)\b/.test(input)) {
    const months = reserveMonths(reserve);
    return months === null ? answer('No separate reserve totals are saved in this review. If you want the arithmetic, say “monthly essentials ₹50,000” and “accessible money outside holdings ₹3 lakh”, then confirm both.',
      'A reserve comparison needs both the monthly essential-spending total and accessible money outside these holdings.',
      'This review does not choose a reserve target or verify bank balances, debts, or access to money.', '#goals', 'Add separate reserve totals') :
      answer(`Your entered accessible money outside these holdings is ${money(reserve.accessibleMoney)} against ${money(reserve.monthlyEssentials)} monthly essentials: ${months.toFixed(1)} months by division.`,
        `${money(reserve.accessibleMoney)} ÷ ${money(reserve.monthlyEssentials)} = ${months.toFixed(1)} months. These amounts are outside the portfolio total.`,
        'Both amounts are self reported. This is not a recommendation or proof that the money is accessible or enough for your circumstances.', '#goals', 'Check separate reserve');
  }
  const asksAgeAtGoal = /\b(?:how old (?:will|would) i be|what (?:will|would) my age be|what age (?:am|will|would) i|my age (?:at|when)|age (?:at|when))\b/.test(input) &&
    /\b(?:goal|retir\w*|when)\b/.test(input);
  const asksGoalHorizon = /\bhow (?:many|long)\s+years?\s+(?:until|till|to|before)\b/.test(input) &&
    /\b(?:goal|retir\w*)\b/.test(input);
  if (asksAgeAtGoal || asksGoalHorizon) {
    if (/\bretir\w*\b/.test(input) && !/\bretir\w*\b/i.test(goal?.name || ''))
      return answer(`The selected goal is ${goal?.name || 'unfinished'}, not Retirement. Select or create your retirement goal before asking for its age or time horizon.`,
        'Only the selected goal’s confirmed age and horizon are available to this answer.',
        'Using another goal’s horizon would give the wrong retirement age.', '#goals', 'Select retirement goal');
    const age = Number(goal?.age);
    const years = Number(goal?.years);
    if (goal?.confirmed !== true || !Number.isInteger(age) || age < 18 || age > 100 ||
        !Number.isInteger(years) || years < 1 || years > 50)
      return answer('Confirm your current age and the years until the selected goal to answer that question.',
        `The selected goal ${goal?.name || 'unnamed'} has no confirmed age and horizon pair.`,
        'This review cannot infer a goal date or age from a holding statement.', '#goals', 'Confirm goal details');
    return answer(asksAgeAtGoal ?
      `You entered age ${age} and ${years} years until ${goal.name}, so you would be approximately age ${age + years} at that horizon.` :
      `You entered ${years} years until ${goal.name}. Your current age is ${age}, so you would be approximately age ${age + years} then.`,
      `Entered age ${age} + entered horizon ${years} years = approximate age ${age + years}.`,
      'This is age arithmetic, not a suitability assessment or an asset-allocation suggestion. Your birthday and exact goal date were not entered.', '#goals', 'Review selected goal');
  }
  if (!valid.length) {
    if (/^(?:what if|test|compare)\s+(?:i\s+(?:(?:can|could)\s+)?(?:contribute|save|add|put in)\b|(?:my|the)\s+monthly\s+contribution\b)/.test(input) ||
        /^(?:what if|test|compare)\s+(?:the\s+)?(?:annual\s+)?(?:inflation|growth)(?:\s+rate)?\b/.test(input) ||
        /^(?:what if|test|compare)\s+(?:(?:my|the)\s+goal\s+(?:is|were|was)\s+in\b|i\s+(?:reach|hit|delay|postpone|bring|move)\s+(?:my|the)\s+goal\b)/.test(input))
      return goal?.confirmed === true ? answer(`Assign at least one confirmed holding to ${goal.name} before comparing its future illustrations.`,
        `Selected goal ${goal.name}; 0 positive holding rows are entered.`,
        'An empty review does not establish that you own no investments.', '#holdings', 'Add a holding') :
        answer('Confirm a goal’s age, target and horizon, then add and assign a holding before comparing future illustrations.',
          'No confirmed goal and positive holding value pair is available.',
          'An alternative rate alone cannot establish a goal outcome.', '#goals', 'Set up a goal');
    if (/\b(?:goal|target|gap|retirement|future)\b/.test(input)) {
      if (goal?.confirmed !== true) return answer(goal?.name && goal.name !== 'My goal' ?
        `The selected goal ${goal.name} still needs your age, years until the goal and target in today’s rupees. Share those facts in chat and confirm them before checking the gap.` :
        'Start by naming one goal, such as “I want to plan for retirement”. I will ask for your age, time horizon and target amount before checking its gap.',
        `Selected goal ${goal?.name || 'not named'} is unfinished; no positive holding value is entered.`,
        'No goal gap can be treated as complete before the goal facts and holdings are checked.', '#goals', 'Set up a goal');
      return answer(`Your selected goal ${goal.name} has a target of ${money(goal.target)} in today’s rupees, but no holdings are entered here yet. Add and confirm your holdings before using a portfolio gap.`,
        `Selected goal ${goal.name}; confirmed target ${money(goal.target)}; 0 positive holding values entered.`,
        'The empty review does not mean you own no investments. It cannot establish your actual shortfall.', '#holdings', 'Add holdings');
    }
    if (/\b(diversif(?:y|ied|ication)?|spread across assets)\b/.test(input))
      return answer('Add and confirm at least one dated fund or stock holding before I can describe its share of your entered investments.',
        'No positive confirmed holding value is entered in this review.',
        'I cannot assess diversification, a goal mix or investments that have not been entered.', '#holdings', 'Add a holding');
    return answer('Add a fund, stock or other investment, or import a supported statement, and I can answer from that review.',
      'There are no positive holding values in this tab.',
      'No portfolio calculation is available yet.', '#input-choice', 'Choose an input');
  }
  if (/\b(?:goal|target|chosen) mix\b|\b(?:mix|allocation)\b.{0,30}\b(?:compare|difference|plan)\b/.test(input)) {
    if (!goal?.targetMix) return answer('You have not entered a chosen mix for this goal. If you already have one, say “my chosen mix is” followed by percentages for the categories you chose (Equity, Debt, Gold or Other), totalling 100%, then confirm the preview. I cannot choose percentages for you.',
      'No chosen mix is saved on the selected goal.',
      'Age and time horizon alone do not establish a suitable allocation.', '#goals', 'Review selected goal');
    const plan = goal.targetMix;
    if (!result.mixComparison) {
      const reason = { goal_details: 'the goal facts are unfinished', no_holdings: 'no holdings are linked to this goal',
        other_investment: 'a linked other investment has no verified asset split',
        unclassified: 'linked holdings include an unknown asset category',
        valuation_dates: 'linked holdings have missing, future or old valuation dates',
        conflicting_identity: 'one instrument identifier has conflicting labels',
        fund_house: 'a linked fund-house summary lacks scheme detail' }[result.mixPause] || 'the linked holding details need checking';
      return answer(`Your chosen mix is Equity ${plan.Equity}%, Debt ${plan.Debt}%, Gold ${plan.Gold}%, Other ${plan.Other}%. The comparison is paused because ${reason}.`,
        `Selected goal ${goal.name}; comparison status ${result.mixPause || 'unavailable'}.`,
        'The chosen percentages came from you. This review does not create an allocation or suggest trades.', '#goals', 'Check goal inputs');
    }
    const parts = result.mixComparison.map(row => {
      const difference = Math.abs(row.differenceValue) < 0.5 ? 'at your rupee reference' :
        `${money(Math.abs(row.differenceValue))} ${row.differenceValue > 0 ? 'above' : 'below'} the rupee reference at this total`;
      return `${row.asset} ${row.currentPct.toFixed(1)}% entered versus ${row.plannedPct.toFixed(1)}% chosen (${difference})`;
    });
    return answer(`For ${goal.name}, ${parts.join('; ')}.`,
      `${money(result.goalTotal)} of entered value is linked to this goal. Each percentage is labelled asset value divided by that total; each rupee reference is the same total times your chosen percentage.`,
      'These are supplied dated values and your own chosen percentages. The rupee reference is not money to move or add. Fund constituents, taxes and transaction costs are not assessed. A difference is a review prompt, not an instruction to trade.', '#goals', 'Review chosen mix');
  }
  if (/\b(?:equity|stock market).{0,25}\b(?:fall(?:s|en)?|drop(?:s|ped)?)\b|\b(?:stress test|hypothetical loss)\b/.test(input)) {
    if (goal?.equityDropPct === undefined) return answer('Choose a hypothetical equity fall first, such as “equity fall 25%”, then confirm it. I will apply it once to the entered Equity value linked to this goal.',
      'No investor-chosen equity fall is saved for the selected goal.',
      'The example is not a market prediction, personal risk score or recommendation.', '#goals', 'Choose a hypothetical fall');
    const pause = { goal_details: 'the goal details are unfinished', no_holdings: 'no holdings are linked to this goal',
      valuation_dates: 'linked values have missing, future or old dates',
      access_uncertain: 'access to a linked other investment at the goal date has not been checked',
      unclassified: 'a linked holding has an unknown asset category',
      fund_house: 'a linked fund-house total lacks scheme detail' }[result.stressPause];
    if (result.stressPause) return answer(`The ${goal.equityDropPct}% equity-fall calculation is paused because ${pause || 'the inputs need checking'}.`,
      `Selected goal ${goal.name}; stress status ${result.stressPause}.`,
      'Check the source values and labels before interpreting a hypothetical loss.', '#goals', 'Check linked holdings');
    const shock = result.shock;
    const limits = result.lossLimits;
    const checks = [limits?.affordable ? `You said you could cover ${money(limits.affordable.limit)}; this loss ${limits.affordable.excess ? `exceeds it by ${money(limits.affordable.excess)}` : 'does not exceed it'}.` : null,
      limits?.tolerable ? `You said you could tolerate ${money(limits.tolerable.limit)}; this loss ${limits.tolerable.excess ? `exceeds it by ${money(limits.tolerable.excess)}` : 'does not exceed it'}.` : null].filter(Boolean).join(' ');
    return answer(`If linked Equity value fell ${shock.dropPct}% once, the entered loss would be ${money(shock.loss)}, leaving ${money(shock.valueAfterLoss)} assigned to ${goal.name} and a ${money(shock.gapAfterLoss)} gap to today’s goal cost. ${checks}`.trim(),
      `${money(result.goalAssets.Equity)} linked Equity value × ${shock.dropPct}% = ${money(shock.loss)}; ${money(result.goalTotal)} assigned value minus that loss = ${money(shock.valueAfterLoss)}.`,
      'One-time arithmetic from supplied dated values, holding other assets fixed. It excludes future growth, contributions, inflation and tax; actual losses could be larger. It is not a risk score or trade instruction.', '#goals', 'Review stress check');
  }
  const namedHouseMentioned = valid.some(row => typeof row.amc === 'string' && row.amc.trim() &&
    input.includes(row.amc.trim().toLocaleLowerCase('en-IN')));
  if ((/\b(?:amc|fund[ -]?houses?|asset management compan(?:y|ies))\b/.test(input) || namedHouseMentioned) &&
      /\b(?:which|what|how|show|list|all|each|breakdown|split|distribution|largest|biggest|most|concentrat\w*|share|much|exposure|spread|depend\w*|dominat\w*)\b/.test(input)) {
    const selectedGoal = Boolean(goalScopeRequested);
    if (selectedGoal) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const rows = selectedGoal ? valid.flatMap(row => {
      const share = goalShare(goal, row.id);
      return share ? [{ ...row, value: Number(row.value) * share / 100 }] : [];
    }) : valid;
    const houses = summarizeFundHouses(rows);
    const scope = selectedGoal ? `${goal.name}’s assigned mutual-fund value` : 'entered mutual-fund value';
    const destination = selectedGoal ? '#goals' : '#holdings';
    if (!houses.fundValue) return answer(`No mutual-fund value is ${selectedGoal ? 'assigned to this goal' : 'entered in this review'}, so I cannot compare fund houses yet.`,
      `${money(houses.fundValue)} ${scope}.`,
      `This does not establish whether you own funds outside this review. ${coverageNote}`, destination, 'Check fund holdings');
    if (!houses.largest) return answer(`I cannot identify the largest fund house because none of the ${money(houses.fundValue)} ${scope} has a fund-house label. Check the statement or add the missing labels.`,
      `${money(houses.coveredValue)} of ${money(houses.fundValue)} ${scope} has a supplied fund-house label.`,
      `Fund-house names and current values are not independently verified. ${coverageNote}`, '#holdings', 'Check fund-house labels');
    const partial = houses.coveredValue < houses.fundValue;
    const basis = `Grouped ${houses.labelledHouseCount} supplied fund-house ${houses.labelledHouseCount === 1 ? 'label' : 'labels'} after trimming and case folding${selectedGoal ? ', applying each goal assignment share' : ''}. ${selectedGoal ? 'Whole-review date context: ' : ''}${result.asOfSummary}.`;
    const limitation = `This is fund-house exposure, not underlying company concentration or verified scheme overlap. It does not set a safe threshold or suggest a trade. ${coverageNote}`;
    const named = houses.groups.filter(house => input.includes(house.name.toLocaleLowerCase('en-IN')));
    if (named.length === 1) {
      const house = named[0];
      const assignedTotal = selectedGoal ? result.goalTotal : result.total;
      return answer(`${selectedGoal ? `For ${goal.name}, ` : lead}${house.name} has ${money(house.value)}, or ${percent(house.value, houses.fundValue)} of ${scope} and ${percent(house.value, assignedTotal)} of ${selectedGoal ? 'this goal’s total assigned value' : 'all entered investment value'}.` +
        (partial ? ` Fund-house labels cover ${money(houses.coveredValue)} of ${money(houses.fundValue)}; other fund value is unlabelled.` : ''),
      `${money(house.value)} ÷ ${money(houses.fundValue)} ${scope}; ${money(house.value)} ÷ ${money(assignedTotal)} ${selectedGoal ? 'assigned goal' : 'entered portfolio'} value. ${basis}`,
      limitation, destination, 'Inspect fund holdings');
    }
    if (/\b(?:each|all|breakdown|split|distribution|spread)\b/.test(input) || /\bhow much\b/.test(input)) {
      const shown = houses.groups.slice(0, 5);
      const rest = houses.groups.slice(5);
      const remainder = rest.reduce((sum, house) => sum + house.value, 0);
      const pieces = shown.map(house => `${house.name} ${money(house.value)} (${percent(house.value, houses.fundValue)})`);
      if (rest.length) pieces.push(`${rest.length} more named ${rest.length === 1 ? 'house' : 'houses'} ${money(remainder)} (${percent(remainder, houses.fundValue)})`);
      if (partial) pieces.push(`unlabelled fund value ${money(houses.fundValue - houses.coveredValue)} (${percent(houses.fundValue - houses.coveredValue, houses.fundValue)})`);
      return answer(`${selectedGoal ? `For ${goal.name}, ` : lead}the supplied breakdown of ${scope} (${money(houses.fundValue)}) is ${pieces.join('; ')}.`,
        `${money(houses.coveredValue)} has a supplied fund-house label and ${money(houses.fundValue - houses.coveredValue)} does not. Each share uses ${money(houses.fundValue)} ${scope} as its denominator. ${basis}`,
        limitation, destination, 'Inspect fund holdings');
    }
    return answer(`${selectedGoal ? `For ${goal.name}, ` : lead}${houses.largest.name} is the largest ${partial ? 'named ' : ''}fund house at ${money(houses.largest.value)}, or ${percent(houses.largest.value, houses.fundValue)} of ${scope}.` +
      (partial ? ` Fund-house labels cover ${money(houses.coveredValue)} of ${money(houses.fundValue)}; an unnamed fund house could be larger.` : ''),
      `${money(houses.largest.value)} ÷ ${money(houses.fundValue)} ${scope}; ${basis}`,
      limitation, destination, 'Inspect fund holdings');
  }
  const disclosureQuestion = /\b(?:overlaps?|same stocks?|underlying (?:stocks|shares|companies)|companies? (?:inside|through)|issuer exposure|inside (?:my|the) funds)\b/.test(input);
  const checkedDisclosures = Array.isArray(disclosures) ? disclosures.filter(item =>
    matchFundDisclosure(item, valid)) : [];
  if (!goalScopeRequested && disclosureQuestion && checkedDisclosures.length) {
    const todayIso = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const visible = estimateVisibleIssuerExposure(valid, checkedDisclosures, todayIso);
    if (!visible.sources.length) return answer(
      'The uploaded scheme sheets match entered funds, but their holding values need valid dates before I can estimate visible issuer exposure. Check those value dates against your statements.',
      `${checkedDisclosures.length} checked scheme ${checkedDisclosures.length === 1 ? 'disclosure' : 'disclosures'} in this tab; no matching fund has a usable dated value.`,
      'A scheme disclosure date cannot substitute for the date of your own holding value.', '#holdings', 'Check value dates');
    const pairs = [];
    for (let first = 0; first < checkedDisclosures.length; first++) for (let second = first + 1; second < checkedDisclosures.length; second++) {
      const overlap = compareFundDisclosures(checkedDisclosures[first], checkedDisclosures[second]);
      if (overlap) pairs.push(`${checkedDisclosures[first].scheme} and ${checkedDisclosures[second].scheme}: ${overlap.common.length} shared listed ${overlap.common.length === 1 ? 'ISIN' : 'ISINs'}, minimum observed shared weight ${overlap.sharedPct.toFixed(2)}% (${overlap.sameDate ? 'same date' : 'different dates'})`);
    }
    const top = visible.issuers.slice(0, 3).map(item =>
      `${item.name} (${item.isin}) ${money(item.visibleValue)}, including ${money(item.directValue)} matching direct stock`).join('; ');
    return answer(
      `${money(visible.coveredValue)} (${visible.coveragePct.toFixed(2)}%) of ${money(visible.total)} entered value maps to listed share ISINs; ${money(visible.unknownValue)} remains outside this view. Largest identified exposures: ${top}.${pairs.length ? ` Checked fund pairs: ${pairs.slice(0, 3).join('; ')}.` : ''}`,
      visible.sources.map(item => `${item.scheme}: fund value ${money(item.value)} dated ${item.holdingDates.join(', ')}, disclosure ${item.disclosureDate}, listed section ${item.coveredPct.toFixed(2)}%`).join('; ') +
        (visible.directCovered ? `; matching direct stocks ${money(visible.directCovered)} dated ${visible.directDates.join(', ')}` : ''),
      'This is a mixed-date, partial look-through of user-supplied values and AMC sheets. Unmatched securities, other fund assets, later trades and missing investments are unknown. It does not establish current prices, full concentration or a trade to make.', '#holdings', 'Inspect dated sources');
  }
  if (/\b(overlaps?|overlapping|duplicates?|same stocks?|same funds?|twice|double.count(?:ed|ing)?)\b/.test(input))
  {
    const byInstrument = new Map();
    for (const row of valid) {
      if (typeof row.isin !== 'string' || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isin)) continue;
      const key = `${row.type}:${row.isin}`;
      byInstrument.set(key, (byInstrument.get(key) || 0) + 1);
    }
    const repeated = [...byInstrument.entries()].filter(([, count]) => count > 1);
    const repeatedRows = repeated.reduce((sum, [, count]) => sum + count, 0);
    const missingIds = valid.filter(row => typeof row.isin !== 'string' ||
      !/^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isin)).length;
    const fundRows = valid.filter(row => row.type === 'Mutual fund');
    const fundHouseRows = fundRows.filter(row => row.granularity === 'fund_house');
    const fundGroups = summarizeFundGroups(fundRows);
    const asksStockFundOverlap = /\b(?:my|our)\s+(?:direct\s+)?(?:stock|share)s?\b|\b(?:stock|share) holdings\b/.test(input) &&
      /\bfunds?\b/.test(input);
    const prefix = repeated.length ?
      `I found ${repeated.length} repeated instrument ${repeated.length === 1 ? 'identifier' : 'identifiers'} across ${repeatedRows} entered rows. Compare their statements and accounts before deciding whether they represent separate positions or a duplicated import.` :
      'I found no repeated instrument identifier among the entered rows with an ISIN.';
    const fundCheck = !fundRows.length ? '' :
      fundHouseRows.length ?
        ` ${fundHouseRows.length} fund-house ${fundHouseRows.length === 1 ? 'summary needs' : 'summaries need'} a scheme-level statement before its underlying holdings can be checked.` :
        fundGroups.total > 1 ?
          ' To check companies shared by different funds, upload supported dated scheme portfolio XLSX files from their AMCs, confirm the exact schemes, and inspect the listed equity comparison in this tab. Other fund assets remain unknown.' :
          fundGroups.total === 1 && valid.some(row => row.type === 'Stock') ?
            ' To check whether your direct stock appears inside that fund, upload its supported dated scheme portfolio XLSX from the AMC and confirm the exact scheme. Other fund assets remain unknown.' : '';
    const noFunds = asksStockFundOverlap && !valid.some(row => row.type === 'Stock') ?
      ' No direct stock is entered to compare with these funds.' :
      fundGroups.total > 1 ?
      asksStockFundOverlap ?
        ' I cannot tell which fund contains your direct stock, or rank that overlap, from this holdings snapshot.' :
        ' I cannot confirm company overlap inside different fund groups from this holdings snapshot.' :
      fundGroups.total === 1 && valid.some(row => row.type === 'Stock') ?
        ' I cannot confirm whether your direct stocks also appear inside that fund from this holdings snapshot.' :
        fundGroups.total === 1 ? ' Only one identifiable fund group is entered, so there is no fund pair to compare.' :
          fundRows.length ? ' No individual scheme is identifiable from these fund rows, so there is no fund pair to compare.' : '';
    return answer(`${prefix}${noFunds}${fundCheck}`,
      `${byInstrument.size} distinct supplied type-and-ISIN pairs compared; ${missingIds} of ${valid.length} rows lack a usable ISIN; ${fundRows.length} mutual-fund rows, including ${fundHouseRows.length} fund-house summaries and ${fundGroups.total} identifiable fund ${fundGroups.total === 1 ? 'group' : 'groups'}. ${repeated.length ? `Repeated: ${repeated.slice(0, 3).map(([key, count]) => `${key.split(':')[1]} (${count} rows)`).join(', ')}${repeated.length > 3 ? ', and more' : ''}.` : ''}`,
      fundRows.length ?
        'A repeated ISIN is a review flag, not proof of double counting. Different fund ISINs can still own the same underlying securities; AMC disclosures are dated, and constituent look-through is unverified here.' :
        'A repeated stock ISIN is a review flag, not proof of double counting. Check accounts, report dates and whether separate positions were intended.', '#holdings', 'Inspect matching rows');
  }
  if (/\b(coverage|complete|missing holdings|all my investments|what.{0,20}missed)\b/.test(input)) {
    const label = value => ({ all: 'all included', some: 'some included', none: 'none included', unsure: 'unsure' })[value] || 'not answered';
    return answer(`${lead}mutual-fund coverage is ${label(coverage?.mutualFunds)}, direct-stock coverage is ${label(coverage?.directStocks)}, and other-investment coverage is ${label(coverage?.otherInvestments)}.`,
      `Used your self-reported coverage answers and ${valid.length} entered holding rows; no account or statement was independently checked.`,
      'Other investments include manually entered EPF, NPS, PPF, deposits or gold. Compare current source statements before treating the total as complete.', '#holdings', 'Check review coverage');
  }
  if (/\b(next|priority|start|check first|review first)\b/.test(input)) {
    const first = result.findings?.[0];
    return first ? answer(`${lead}${first.title.toLowerCase()}. ${first.detail}`,
      first.basis, first.limitation, '#review', 'See the review item') :
      answer('Check your statement coverage and the dates of entered values before using this as a complete portfolio picture.',
        `${valid.length} entered holdings; ${result.asOfSummary}.`, coverageNote, '#holdings', 'Check holdings');
  }
  if (/\b(as.?of|dated?|stale|outdated|recent|refresh\w*|old values?)\b/.test(input) ||
      /\b(?:values?|holdings?) need(?:s)? (?:an? )?updat\w*\b/.test(input)) {
    const issues = valuationRowsNeedingCheck(holdings, today);
    if (!issues.length) return answer(`${lead}none of the ${valid.length} entered holding values has a missing, future or over-90-day valuation date. ${result.asOfSummary}.`,
      `Compared ${valid.length} entered holding dates with today's date in India using a 90-day review threshold.`,
      'Dates and amounts are supplied, not verified live quotes. A recent date does not prove the holding quantity is still current.', '#holdings', 'Review source dates');
    const count = issue => issues.filter(item => item.issue === issue).length;
    const missing = count('missing');
    const stale = count('stale');
    const future = count('future');
    const affectedValue = issues.reduce((sum, item) => sum + Number(item.row.value), 0);
    const first = issues.slice(0, 5).map(({ row, issue, index }) =>
      `#${index + 1} ${row.name} (${issue === 'missing' ? 'date missing' :
        `${row.asOf}; ${issue === 'future' ? 'future date' : 'over 90 days old'}`})`);
    const list = first.length ? ` Check the largest affected entered values first: ${first.join('; ')}${issues.length > first.length ?
      `; and ${issues.length - first.length} more flagged ${issues.length - first.length === 1 ? 'row' : 'rows'}` : ''}.` : '';
    return answer(`${lead}${missing} ${missing === 1 ? 'holding lacks' : 'holdings lack'} a date, ${stale} ${stale === 1 ? 'is' : 'are'} dated over 90 days ago, and ${future} ${future === 1 ? 'has a' : 'have'} future ${future === 1 ? 'date' : 'dates'}. ${money(affectedValue)} of entered value needs a date check.${list} ${String(result.asOfSummary).replace(/\.$/, '')}.`,
      `Compared the dates on ${valid.length} entered ${valid.length === 1 ? 'holding' : 'holdings'} with today's date in India and added ${money(affectedValue)} across ${issues.length} flagged rows. Rows are listed by entered value, with original row numbers retained. The 90-day threshold is a review prompt.`,
      'A dated entry is not a verified live quote. Refresh values from the original source.', '#holdings', 'Check dated values');
  }
  const alternateMonthlyQuestion = /^(?:what if|test|compare)\s+(?:i\s+(?:(?:can|could)\s+)?(?:contribute|save|add|put in)\b|(?:my|the)\s+monthly\s+contribution\b)/.test(input);
  if (alternateMonthlyQuestion) {
    const verb = /^(?:what if|test|compare)\s+i\s+(?:(?:can|could)\s+)?(?:contribute|save|add|put in)\s+(.+?)\s+(?:per month|monthly)(?:\s+instead of\s+(.+?)(?:\s+per month)?)?(?:\s+for\s+(?:my|the)\s+goal)?[?.!]*$/.exec(input);
    const plan = /^(?:what if|test|compare)\s+(?:my|the)\s+monthly\s+contribution\s+(?:is|were|was|at)\s+(.+?)(?:\s+instead of\s+(.+?))?(?:\s+for\s+(?:my|the)\s+goal)?[?.!]*$/.exec(input);
    const supplied = verb || plan;
    const monthlyAmount = raw => /^(?:₹\s*)?0(?:\.0{1,2})?(?:\s+rupees)?$/i.test(raw?.trim() || '') ?
      0 : parseAmount(raw || '');
    const alternative = monthlyAmount(supplied?.[1]);
    if (alternative === null || alternative > 100_000_000)
      return answer('Choose one alternative monthly amount from ₹0 to ₹10 crore, such as “What if I save ₹10,000 per month?”',
        'No single valid alternative monthly amount was supplied.',
        'The amount must be your own hypothetical input; this review does not decide what you should save.', '#goals', 'Choose an amount');
    if (goal?.confirmed !== true) return answer('Confirm the selected goal’s age, target and horizon before comparing monthly amounts.',
      `Selected goal ${goal?.name || 'unnamed'} is unfinished.`,
      'A monthly amount without a confirmed goal has no defined target or period.', '#goals', 'Confirm goal details');
    if (supplied[2] !== undefined && monthlyAmount(supplied[2]) !== Number(goal.monthlyContribution))
      return answer(`You said “instead of ${supplied[2]}”, but ${goal.name} has ${money(goal.monthlyContribution)} saved per month. Check that starting amount before comparing.`,
        `Entered starting amount ${supplied[2]}; saved monthly amount ${money(goal.monthlyContribution)}.`,
        'The comparison must start from the amount you actually confirmed.', '#goals', 'Check saved amount');
    if (!result.goalTotal) return answer(`Assign at least one confirmed holding to ${goal.name} before comparing its future illustrations.`,
      `Selected goal ${goal.name}; assigned holding value ₹0.`,
      'A portfolio total cannot be substituted for the value assigned to this goal.', '#holdings', 'Link holdings');
    if (!confirmedGoalAssumptions(goal)) return answer(`Confirm your monthly contribution, growth and inflation assumptions for ${goal.name} before changing one amount in a what-if. You may deliberately choose zero.`,
      'At least one saved goal assumption is not confirmed.',
      'No default rate or contribution is treated as your plan.', '#goals', 'Confirm assumptions');
    if (result.goalDateCheck.count) return answer(`Check ${result.goalDateCheck.count} assigned missing, future or over-90-day value ${result.goalDateCheck.count === 1 ? 'date' : 'dates'} before comparing monthly amounts for ${goal.name}.`,
      `${result.goalDateCheck.count} linked holding ${result.goalDateCheck.count === 1 ? 'row needs' : 'rows need'} a valuation-date check.`,
      'A stale starting value can distort both illustrations.', '#holdings', 'Check goal values');
    if (result.goalAccessCheck.count) return answer(`Check when linked other investments can be used for ${goal.name} before comparing monthly amounts.`,
      `${money(result.goalAccessCheck.value)} in linked other investments has unverified access for this goal.`,
      'A gross balance may not be available when the goal arrives.', '#holdings', 'Check access terms');
    const base = result.scenario;
    const changed = calculateGoalScenario(result.goalTotal, { ...goal, monthlyContribution: alternative });
    if (!base || !changed) return answer('I cannot calculate both illustrations from these goal inputs. Check the selected goal and assumptions.',
      `Selected goal ${goal.name}; one or both scenario calculations are unavailable.`,
      'An invalid input must not produce an inferred future value.', '#goals', 'Check goal inputs');
    const gapChange = changed.futureGap - base.futureGap;
    const gapDifference = Math.abs(gapChange) < 0.5 ? 'unchanged' :
      `${money(Math.abs(gapChange))} ${gapChange > 0 ? 'higher' : 'lower'}`;
    return answer(`At your saved ${money(base.monthlyContribution)} per month, ${goal.name} illustrates ${money(base.projectedValue)} at the goal date and a ${money(base.futureGap)} gap. At your alternative ${money(alternative)} per month, the illustrated value is ${money(changed.projectedValue)} and the gap is ${money(changed.futureGap)} (${gapDifference}). The total mathematical monthly amount is ${money(Math.ceil(base.monthlyTotalNeeded))} under both assumptions; the amount above your entered plan changes from ${money(Math.ceil(base.monthlyAdditionalNeeded))} to ${money(Math.ceil(changed.monthlyAdditionalNeeded))}. This temporary comparison has not changed your saved goal.`,
      `${money(result.goalTotal)} assigned now; ${goal.years} years; goal-date cost ${money(base.futureCost)} from a ${money(goal.target)} target in today's rupees. Only the monthly contribution changed from ${money(goal.monthlyContribution)} to ${money(alternative)}; annual growth stayed ${goal.returnPct}% and inflation stayed ${goal.inflationPct}%. Contributions are added at each month’s end.`,
      `Both results are fixed-assumption illustrations, not forecasts or monthly savings instructions. Taxes, fees, losses, access to money and unentered holdings may change outcomes. ${coverageNote}`,
      '#goals', 'Review monthly plan');
  }
  const monthlyGoalQuestion = /\b(?:per month|monthly)\b/.test(input) &&
    /\b(?:goal|target|gap)\b/.test(input);
  const straightLineQuestion = monthlyGoalQuestion &&
    (/\b(?:simple|straight[ -]line|today|without (?:returns?|growth)|zero growth)\b/.test(input) ||
      !confirmedGoalAssumptions(goal) && !/\b(?:future|project\w*|growth|inflation)\b/.test(input));
  if (straightLineQuestion) {
    if (goal?.confirmed !== true) return answer('Confirm the selected goal’s age, target in today’s rupees and time horizon first.',
      'The selected goal details are unfinished.',
      'A monthly gap cannot be divided without a confirmed goal amount and horizon.', '#goals', 'Confirm goal details');
    if (!result.goalTotal) return answer('Link at least one entered holding to this goal before dividing its current gap across months.',
      `Selected goal ${goal.name}; no holding value is assigned.`,
      'An empty or unassigned review does not show what you own.', '#holdings', 'Link a holding');
    if (result.goalDateCheck.count) return answer('Check the missing, future or over-90-day values linked to this goal before using a monthly gap figure.',
      `${result.goalDateCheck.count} assigned ${result.goalDateCheck.count === 1 ? 'value needs' : 'values need'} a valuation-date check.`,
      'An old or undated starting amount can materially change the division.', '#holdings', 'Check dated values');
    if (result.goalAccessCheck.count) return answer('Check when the other investments linked to this goal can be used before dividing its current gap across months.',
      `${money(result.goalAccessCheck.value)} of manually entered other investments is assigned to ${goal.name}.`,
      'Gross current value does not prove this money is spendable at the goal date.', '#holdings', 'Check access to savings');
    const straight = calculateStraightLineGap(result.goalTotal, goal);
    if (!straight) return answer('The selected goal amount or horizon needs checking before I can divide its current gap.',
      `Selected goal ${goal.name}; the simple monthly calculation is unavailable.`,
      'No value is inferred from invalid goal inputs.', '#goals', 'Check goal details');
    return answer(straight.gapToday > 0 ?
      `The current gap for ${goal.name} is ${money(straight.gapToday)} in today’s rupees. Dividing it evenly across ${straight.months} months is about ${money(straight.roundedMonthly)} per month, rounded up.` :
      `The entered value assigned to ${goal.name} meets or exceeds its target in today’s rupees, so the simple monthly gap is ₹0.`,
      `${money(goal.target)} target today minus ${money(result.goalTotal)} assigned entered value = ${money(straight.gapToday)} current gap; ${goal.years} years × 12 = ${straight.months} months; divide and round up to whole rupees.`,
      `This is division of today's gap, not a savings instruction or future forecast. It excludes inflation, returns, taxes, future contributions and unentered holdings. ${coverageNote}`, '#goals', 'Review selected goal');
  }
  const alternateRateQuestion = /^(?:what if|test|compare)\s+(?:the\s+)?(?:annual\s+)?(inflation|growth)(?:\s+rate)?\b/.exec(input);
  if (alternateRateQuestion) {
    const kind = alternateRateQuestion[1];
    const field = kind === 'inflation' ? 'inflationPct' : 'returnPct';
    const complete = /^(?:what if|test|compare)\s+(?:the\s+)?(?:annual\s+)?(?:inflation|growth)(?:\s+rate)?\s+(?:is|were|was|at|of)\s+(-?\d{1,2}(?:\.\d{1,2})?)\s*%(?:\s+instead of\s+(-?\d{1,2}(?:\.\d{1,2})?)\s*%)?(?:\s+for\s+(?:my|the)\s+goal)?[?.!]*$/.exec(input);
    const range = kind === 'inflation' ? '-5% to 15%' : '-20% to 13%';
    const alternative = Number(complete?.[1]);
    if (!complete || alternative < (kind === 'inflation' ? -5 : -20) ||
        alternative > (kind === 'inflation' ? 15 : 13))
      return answer(`Choose one alternative annual ${kind} rate from ${range}, such as “What if ${kind} were 6%?” You can add “instead of 4%” only if 4% is the rate saved for this goal.`,
        `No single valid alternative ${kind} rate was supplied.`,
        'The rate must be your own hypothetical input; this review does not predict inflation or investment growth.', '#goals', 'Choose a rate');
    if (goal?.confirmed !== true) return answer('Confirm the selected goal’s age, target and horizon before comparing assumptions.',
      `Selected goal ${goal?.name || 'unnamed'} is unfinished.`,
      'An alternative rate without a confirmed goal has no defined target or period.', '#goals', 'Confirm goal details');
    if (!result.goalTotal) return answer(`Assign at least one confirmed holding to ${goal.name} before comparing its future illustrations.`,
      `Selected goal ${goal.name}; assigned holding value ₹0.`,
      'A portfolio total cannot be substituted for the value assigned to this goal.', '#goals', 'Link holdings');
    if (!confirmedGoalAssumptions(goal)) return answer(`Confirm your monthly contribution, growth and inflation assumptions for ${goal.name} before changing one rate in a what-if. You may deliberately choose zero.`,
      'At least one saved goal assumption is not confirmed.',
      'No default rate or contribution is treated as your plan.', '#goals', 'Confirm assumptions');
    if (complete[2] !== undefined && Number(complete[2]) !== Number(goal[field]))
      return answer(`You said “instead of ${complete[2]}%”, but ${goal.name} has ${goal[field]}% saved for ${kind}. Check that starting rate before comparing.`,
        `Entered starting rate ${complete[2]}%; saved ${kind} rate ${goal[field]}%.`,
        'The comparison must start from the assumption you actually confirmed.', '#goals', 'Check saved assumption');
    if (result.goalDateCheck.count) return answer(`Check ${result.goalDateCheck.count} assigned missing, future or over-90-day value ${result.goalDateCheck.count === 1 ? 'date' : 'dates'} before comparing ${kind} assumptions for ${goal.name}.`,
      `${result.goalDateCheck.count} linked holding ${result.goalDateCheck.count === 1 ? 'row needs' : 'rows need'} a valuation-date check.`,
      'A stale starting value can distort both illustrations.', '#holdings', 'Check goal values');
    if (result.goalAccessCheck.count) return answer(`Check when linked other investments can be used for ${goal.name} before applying an alternative ${kind} rate.`,
      `${money(result.goalAccessCheck.value)} in linked other investments has unverified access for this goal.`,
      'A gross balance may not be available when the goal arrives.', '#holdings', 'Check access terms');
    const base = result.scenario;
    const changed = calculateGoalScenario(result.goalTotal, { ...goal, [field]: alternative });
    if (!base || !changed) return answer('I cannot calculate both illustrations from these goal inputs. Check the selected goal and assumptions.',
      `Selected goal ${goal.name}; one or both scenario calculations are unavailable.`,
      'An invalid input must not produce an inferred future value.', '#goals', 'Check goal inputs');
    const gapChange = changed.futureGap - base.futureGap;
    const gapDifference = Math.abs(gapChange) < 0.5 ? 'unchanged' :
      `${money(Math.abs(gapChange))} ${gapChange > 0 ? 'higher' : 'lower'}`;
    const resultText = kind === 'inflation' ?
      `At your saved ${base.inflationPct}% inflation rate, ${goal.name}’s ${money(goal.target)} target in today’s rupees illustrates ${money(base.futureCost)} at the goal date and a ${money(base.futureGap)} gap. At your alternative ${alternative}%, the illustrated goal-date cost is ${money(changed.futureCost)} and the gap is ${money(changed.futureGap)} (${gapDifference}).` :
      `At your saved ${base.returnPct}% growth rate, ${money(result.goalTotal)} assigned now with ${money(goal.monthlyContribution)} added at each month’s end illustrates ${money(base.projectedValue)} at the goal date and a ${money(base.futureGap)} gap. At your alternative ${alternative}%, the illustrated value is ${money(changed.projectedValue)} and the gap is ${money(changed.futureGap)} (${gapDifference}).`;
    return answer(`${resultText} This temporary comparison has not changed your saved goal.`,
      `${money(result.goalTotal)} assigned now; ${money(goal.target)} target in today's rupees; ${goal.years} years; ${money(goal.monthlyContribution)} added at each month’s end. Only annual ${kind} changed from ${goal[field]}% to ${alternative}%; ${kind === 'inflation' ? `growth stayed ${goal.returnPct}%` : `inflation stayed ${goal.inflationPct}%`}.`,
      `Both results are fixed-assumption illustrations, not forecasts, expected returns or a monthly investment instruction. Taxes, fees, losses, access to money and unentered holdings may change outcomes. ${coverageNote}`,
      'https://investor.sebi.gov.in/calculators/Visual_Gold_Planner.html', 'Read SEBI’s illustration');
  }
  const retirementTiming = /^(?:what if|test|compare)\s+i\s+retire\s+(?:in\s+\d{1,3}\s+years?|\d{1,3}\s+years?\s+(?:later|earlier))/.test(input);
  const alternateHorizonQuestion = /^(?:what if|test|compare)\s+(?:(?:my|the)\s+goal\s+(?:is|were|was)\s+in\b|i\s+(?:reach|hit|delay|postpone|bring|move)\s+(?:my|the)\s+goal\b)/.test(input) || retirementTiming;
  if (alternateHorizonQuestion) {
    if (retirementTiming && !/\bretire(?:ment)?\b/i.test(goal?.name || ''))
      return answer('Select or create the retirement goal you mean before comparing retirement dates.',
        `The selected goal is ${goal?.name || 'unnamed'}, not a confirmed retirement goal.`,
        'A different goal may use different holdings, target and horizon.', '#goals', 'Select retirement goal');
    const absolute = /^(?:what if|test|compare)\s+(?:(?:my|the)\s+goal\s+(?:is|were|was)\s+in|i\s+(?:reach|hit)\s+(?:my|the)\s+goal\s+in|i\s+retire\s+in)\s+(\d{1,3})\s+years?(?:\s+instead of\s+(\d{1,3})\s+years?)?[?.!]*$/.exec(input);
    const later = /^(?:what if|test|compare)\s+i\s+(?:delay|postpone)\s+(?:my|the)\s+goal\s+by\s+(\d{1,3})\s+years?[?.!]*$/.exec(input) ||
      /^(?:what if|test|compare)\s+i\s+retire\s+(\d{1,3})\s+years?\s+later[?.!]*$/.exec(input);
    const earlier = /^(?:what if|test|compare)\s+i\s+(?:bring|move)\s+(?:my|the)\s+goal\s+(?:forward|earlier)\s+by\s+(\d{1,3})\s+years?[?.!]*$/.exec(input) ||
      /^(?:what if|test|compare)\s+i\s+retire\s+(\d{1,3})\s+years?\s+earlier[?.!]*$/.exec(input);
    const savedYears = Number(goal?.years);
    const alternative = absolute ? Number(absolute[1]) : later ? savedYears + Number(later[1]) :
      earlier ? savedYears - Number(earlier[1]) : NaN;
    if (!Number.isInteger(alternative) || alternative < 1 || alternative > 50 ||
        (later && Number(later[1]) < 1) || (earlier && Number(earlier[1]) < 1))
      return answer('Choose one alternative goal horizon from 1 to 50 years, such as “What if my goal were in 12 years?” or “What if I delay my goal by 2 years?”',
        'No single valid alternative horizon was supplied.',
        'The time period must be your own hypothetical choice; this review does not select a goal date for you.', '#goals', 'Choose a horizon');
    if (goal?.confirmed !== true) return answer('Confirm the selected goal’s age, target and saved horizon before comparing a different date.',
      `Selected goal ${goal?.name || 'unnamed'} is unfinished.`,
      'An alternative horizon without a confirmed goal has no defined starting period.', '#goals', 'Confirm goal details');
    if (absolute?.[2] !== undefined && Number(absolute[2]) !== savedYears)
      return answer(`You said “instead of ${absolute[2]} years”, but ${goal.name} has ${savedYears} years saved. Check that starting horizon before comparing.`,
        `Entered starting horizon ${absolute[2]} years; saved horizon ${savedYears} years.`,
        'The comparison must start from the horizon you actually confirmed.', '#goals', 'Check saved horizon');
    if (!result.goalTotal) return answer(`Assign at least one confirmed holding to ${goal.name} before comparing its future illustrations.`,
      `Selected goal ${goal.name}; assigned holding value ₹0.`,
      'A portfolio total cannot be substituted for the value assigned to this goal.', '#holdings', 'Link holdings');
    if (!confirmedGoalAssumptions(goal)) return answer(`Confirm your monthly contribution, growth and inflation assumptions for ${goal.name} before changing its horizon in a what-if. You may deliberately choose zero.`,
      'At least one saved goal assumption is not confirmed.',
      'No default rate or contribution is treated as your plan.', '#goals', 'Confirm assumptions');
    if (result.goalDateCheck.count) return answer(`Check ${result.goalDateCheck.count} assigned missing, future or over-90-day value ${result.goalDateCheck.count === 1 ? 'date' : 'dates'} before comparing horizons for ${goal.name}.`,
      `${result.goalDateCheck.count} linked holding ${result.goalDateCheck.count === 1 ? 'row needs' : 'rows need'} a valuation-date check.`,
      'A stale starting value can distort both illustrations.', '#holdings', 'Check goal values');
    if (result.goalAccessCheck.count) return answer(`Check when linked other investments can be used for ${goal.name} before comparing goal dates.`,
      `${money(result.goalAccessCheck.value)} in linked other investments has unverified access for this goal.`,
      'A gross balance may not be available at either date.', '#holdings', 'Check access terms');
    const base = result.scenario;
    const changed = calculateGoalScenario(result.goalTotal, { ...goal, years: alternative });
    if (!base || !changed) return answer('I cannot calculate both illustrations from these goal inputs. Check the selected goal and assumptions.',
      `Selected goal ${goal.name}; one or both scenario calculations are unavailable.`,
      'An invalid input must not produce an inferred future value.', '#goals', 'Check goal inputs');
    const baseMonthly = Math.ceil(base.monthlyTotalNeeded);
    const changedMonthly = Math.ceil(changed.monthlyTotalNeeded);
    const monthlyChange = changedMonthly - baseMonthly;
    const monthlyDifference = monthlyChange ? `${money(Math.abs(monthlyChange))} ${monthlyChange > 0 ? 'higher' : 'lower'}` : 'unchanged';
    return answer(`At your saved ${savedYears}-year horizon, ${goal.name} illustrates a ${money(base.futureCost)} goal-date cost, ${money(base.projectedValue)} value, ${money(base.futureGap)} gap and ${money(baseMonthly)} total mathematical monthly amount. At your alternative ${alternative}-year horizon, those figures are ${money(changed.futureCost)}, ${money(changed.projectedValue)}, ${money(changed.futureGap)} and ${money(changedMonthly)} per month (${monthlyDifference}). This temporary comparison has not changed your saved goal.`,
      `${money(result.goalTotal)} assigned now; ${money(goal.target)} target in today's rupees; ${money(goal.monthlyContribution)} added at each month’s end. Only the horizon changed from ${savedYears} to ${alternative} years; annual growth stayed ${goal.returnPct}% and inflation stayed ${goal.inflationPct}%.`,
      `The two goal-date rupee amounts refer to different dates. Both results use fixed assumptions, not forecasts or savings instructions. Taxes, fees, losses, access to money and unentered holdings may change outcomes. ${coverageNote}`,
      '#goals', 'Review goal timing');
  }
  const futureGoalQuestion = /\b(?:future|project(?:ion|ed)?|goal[ -]date|in \d+ years|per month|monthly)\b/.test(input) &&
    /\b(?:goal|target|gap|need|cost|contribut(?:ion|e)|retirement)\b/.test(input);
  if (futureGoalQuestion) {
    if (goal?.confirmed !== true) return answer('Confirm the selected goal’s age, target amount and time horizon before using a future illustration.',
      'The selected goal details are unfinished.',
      'A portfolio value alone cannot establish a future goal amount.', '#goal-form', 'Confirm goal details');
    if (!result.goalTotal) return answer('Link at least one holding to this goal before calculating a future illustration.',
      `Selected goal ${goal.name}; no entered holding value is assigned.`,
      'Unassigned holdings are excluded from this goal.', '#holdings', 'Link a holding');
    if (!confirmedGoalAssumptions(goal)) return answer('The future illustration is paused until you confirm your monthly contribution, growth and inflation assumptions. You may deliberately choose zero.',
      'One or more of the three goal assumptions has not been confirmed.',
      'No default growth, inflation or contribution should be treated as your plan.', '#goal-assumptions', 'Confirm assumptions');
    if (result.goalDateCheck.count) return answer('The future illustration is paused until you check missing, future or over-90-day values linked to this goal.',
      `${result.goalDateCheck.count} linked ${result.goalDateCheck.count === 1 ? 'holding needs' : 'holdings need'} a valuation-date check.`,
      'A stale or undated value may change the starting amount materially.', '#holdings', 'Check linked values');
    if (result.goalAccessCheck.count) return answer('The future illustration is paused while linked other investments have no checked access date. Check their maturity or withdrawal terms for this goal.',
      `${money(result.goalAccessCheck.value)} of manually valued other investments is assigned to ${goal.name}.`,
      'The gross current gap does not establish that these amounts will be spendable at the goal date.', '#holdings', 'Check linked access');
    if (!result.scenario) return answer('I cannot calculate a future illustration from the current goal inputs. Check the goal amount, horizon and assumptions.',
      `Selected goal ${goal.name}; future calculation is unavailable.`,
      'No future value is inferred when the inputs fail validation.', '#goal-form', 'Check goal inputs');
    const scenario = result.scenario;
    return answer(`Under your chosen assumptions, ${goal.name} would cost ${money(scenario.futureCost)} at the goal date. Linked holdings and your planned monthly amount would illustrate ${money(scenario.projectedValue)}, leaving a ${money(scenario.futureGap)} gap. The total mathematical monthly amount is ${money(Math.ceil(scenario.monthlyTotalNeeded))}; that is ${money(Math.ceil(scenario.monthlyAdditionalNeeded))} above your entered plan.`,
      `${money(result.goalTotal)} linked value for ${scenario.years} years; ${scenario.returnPct}% annual growth, ${scenario.inflationPct}% inflation and ${money(scenario.monthlyContribution)} added at each month’s end. Target in today’s rupees: ${money(goal.target)}.`,
      `This fixed-assumption arithmetic is not a forecast or an instruction to invest that amount. Taxes, fees, losses and unentered holdings may change the outcome. ${coverageNote}`, '#goals', 'Review goal scenario');
  }
  if (goalScopeRequested && /\b(?:mix|equity|debt|gold|asset|allocation)\b/.test(input)) {
    const unavailable = unavailableGoalScope();
    if (unavailable) return unavailable;
    const assets = result.goalAssets;
    const total = result.goalTotal;
    return answer(`For ${goal.name}, the assigned value is Equity ${money(assets.Equity)} (${percent(assets.Equity, total)}), Debt ${money(assets.Debt)} (${percent(assets.Debt, total)}), Gold ${money(assets.Gold)} (${percent(assets.Gold, total)}), and Other ${money(assets.Other)} (${percent(assets.Other, total)}).`,
      `Divided each asset-labelled share assigned to ${goal.name} by ${money(total)} linked value across ${result.goalHoldingCount} holding ${result.goalHoldingCount === 1 ? 'row' : 'rows'}.`,
      `These are supplied dated values and labels, not verified fund constituents or a suitable allocation. ${result.goalDateCheck.count} linked ${result.goalDateCheck.count === 1 ? 'value needs' : 'values need'} a date check.`, '#goals', 'Review assigned holdings');
  }
  if (/\b(goal|target|gap|horizon|retirement|future)\b/.test(input) &&
      !/\b(?:biggest|largest|concentrat(?:ion|ed|e|ing)?|top holding|single holding|diversif(?:y|ied|ication)?)\b/.test(input)) {
    if (source === 'user' && goal?.confirmed === false)
      return answer('Enter and confirm the selected goal’s age, target amount, and time horizon before using its gap or scenario.',
        `The selected goal ${goal?.name || ''} is unfinished.`,
        'A portfolio value alone does not establish whether a goal is funded.', '#goal-form', 'Confirm goal details');
    if (!result.goalTotal)
      return answer('No entered holdings are assigned to the selected goal yet. Link holdings to compare their supplied value with the goal amount.',
        `Selected goal: ${goal?.name || 'unnamed'}; assigned value ${money(0)}.`,
        coverageNote, '#holdings', 'Link holdings');
    return answer(`${lead}${money(result.goalTotal)} is assigned to ${goal.name} against your ${money(goal.target)} target today. The simple gap is ${money(result.goalGap)}.${otherAccessBound}`,
      `${money(goal.target)} target minus ${money(result.goalTotal)} assigned value; ${result.goalHoldingCount} linked holdings. ${result.asOfSummary}.`,
      'This gross comparison excludes future growth, inflation, taxes, and holdings outside the selected goal. Access to linked other investments at the goal date has not been checked. It uses entered values, not live prices.', '#goals', 'Review selected goal');
  }
  if (/\b(?:highest|largest)\b/.test(input) && /\b(?:expense ratios?|ter)\b/.test(input) &&
      /\b(?:fund|funds|scheme|schemes)\b/.test(input)) {
    const funds = valid.filter(row => row.type === 'Mutual fund');
    const checked = funds.filter(row => hasDatedFundTer(row, today));
    if (!checked.length) return answer('No dated scheme expense ratio is entered, so I cannot name the highest one.',
      `0 of ${funds.length} entered mutual-fund rows have a usable scheme TER and date.`,
      'Fund names and plan labels do not establish their current expense ratios.', '#holdings', 'Check fund TERs');
    const highest = checked.reduce((best, row) => row.expenseRatioPct > best.expenseRatioPct ? row : best);
    const tied = checked.filter(row => row.expenseRatioPct === highest.expenseRatioPct).length;
    return answer(`${lead}${highest.name} has the highest entered scheme expense ratio among the dated rates here: ${highest.expenseRatioPct.toFixed(2)}% as of ${highest.expenseRatioAsOf}${tied > 1 ? `; ${tied - 1} other entered ${tied === 2 ? 'row has' : 'rows have'} the same rate` : ''}.`,
      `Compared ${checked.length} of ${funds.length} entered mutual-fund rows with a valid dated scheme TER; ${funds.length - checked.length} ${funds.length - checked.length === 1 ? 'row is' : 'rows are'} excluded.`,
      'Rates and scheme identities are not independently verified; excluded or later rates could change the ranking. TER is reflected in NAV, and this is not a switch recommendation.', '#holdings', 'Check fund TERs');
  }
  if (/\b(fees?|expense ratio|\bter\b|fund costs?)\b/.test(input)) {
    const cost = result.fundCost;
    if (cost.coveredValue) {
      const rateDates = cost.oldestTerDate === cost.newestTerDate ?
        `The supplied rate is dated ${cost.oldestTerDate}.` :
        `Supplied rate dates run from ${cost.oldestTerDate} to ${cost.newestTerDate}.`;
      const oldRates = cost.oldTerCount ?
        ` ${money(cost.oldTerValue)} of covered fund value uses ${cost.oldTerCount} ${cost.oldTerCount === 1 ? 'rate' : 'rates'} dated over 90 days ago; recheck ${cost.oldTerCount === 1 ? 'it' : 'them'} before a current comparison.` : '';
      return answer(`${lead}dated TERs cover ${money(cost.coveredValue)} of ${money(result.fundValue)} entered fund value. Applying those rates to the covered entered values for one year gives ${money(cost.annualIllustration)} as a cost illustration, a weighted rate of ${percent(cost.annualIllustration, cost.coveredValue)}. ${rateDates}${oldRates}`,
        `Summed each covered fund's entered value × its supplied annual TER; ${money(cost.annualIllustration)} ÷ ${money(cost.coveredValue)} = ${percent(cost.annualIllustration, cost.coveredValue)}. ${money(cost.uncoveredValue)} has no dated TER here.`,
        'Fund expenses are already reflected in NAV, not billed again. Actual costs depend on changing daily scheme assets and rates; this is neither an amount paid nor a full portfolio fee estimate. Scheme identities and rates were not independently verified.', '#holdings', 'Check fund TERs');
    }
    return answer('No dated, scheme-specific expense ratios are entered, so I cannot estimate fund cost coverage.',
        `${money(result.fundValue)} entered mutual-fund value; none has a validated dated TER in this review.`,
        'A fund name or plan label alone is not an expense ratio.', '#holdings', 'Check fund details');
  }
  if (/\b(diversif(?:y|ied|ication)?|spread across assets)\b/.test(input)) {
    if (goalScopeRequested) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    if (namedGroup) {
      const rows = rowsForNamedGroup();
      if (!rows.length) return answer(`No ${namedGroup.label} are ${goalScopeRequested ? `assigned to ${goal.name}` : 'entered in this review'} yet. Add or assign a current holding before comparing this group.`,
        `0 positive ${namedGroup.kind} rows in ${goalScopeRequested ? `the selected goal ${goal.name}` : 'the entered snapshot'}.`,
        `This does not establish what you own outside the review. ${coverageNote}`, goalScopeRequested ? '#goals' : '#holdings', 'Check this group');
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      const assets = Object.fromEntries(['Equity', 'Debt', 'Gold', 'Other'].map(asset =>
        [asset, rows.filter(row => row.asset === asset).reduce((sum, row) => sum + row.value, 0)]));
      const top = positionsByIsin(rows).slice(0, 3);
      const largest = top[0];
      const topValue = top.reduce((sum, position) => sum + position.value, 0);
      const dateChecks = rows.filter(row => valuationDateIssue(row.asOf, today)).length;
      const scope = goalScopeRequested ? `For ${goal.name}, the assigned ${namedGroup.label}` :
        `The entered ${namedGroup.label}`;
      return answer(`${scope} are Equity ${percent(assets.Equity, total)}, Debt ${percent(assets.Debt, total)}, Gold ${percent(assets.Gold, total)}, and Other ${percent(assets.Other, total)}. The largest ${largest.granularity === 'fund_house' ? 'fund-house summary' : 'position'} is ${largest.name} at ${percent(largest.value, total)} of this group.` +
        (top.length > 1 ? ` The largest ${top.length} positions together are ${percent(topValue, total)}.` : ''),
        `${money(largest.value)} ÷ ${money(total)} ${goalScopeRequested ? 'assigned' : 'entered'} ${namedGroup.label} value; ${rows.length} positive ${namedGroup.kind} rows. ${top.length > 1 ? `The largest ${top.length} positions sum to ${money(topValue)}. ` : ''}Exact matching supplied ISINs and fund-house summaries are grouped. ${dateChecks} ${dateChecks === 1 ? 'row needs' : 'rows need'} a value-date check.`,
        `${assets.Other ? `${money(assets.Other)} is labelled Other within this group. ` : ''}Fund constituents and holdings outside this review are not verified. These shares do not establish whether the mix suits your age, risk capacity or goal. ${coverageNote}`,
        goalScopeRequested ? '#goals' : '#holdings', 'Inspect this group');
    }
    const selectedGoal = Boolean(goalScopeRequested);
    const total = selectedGoal ? result.goalTotal : result.total;
    const assets = selectedGoal ? result.goalAssets : result.assets;
    const top = selectedGoal ? result.topGoalPositions : result.topPositions;
    const largest = top?.[0];
    const scope = selectedGoal ? `For ${goal.name}, the entered, assigned holdings` :
      'The entered holdings';
    const largestValue = Number(largest?.value) || 0;
    const topValue = top?.reduce((sum, position) => sum + position.value, 0) || 0;
    const largestKind = largest?.granularity === 'fund_house' ? 'fund-house summary' : 'holding';
    const dateNote = selectedGoal && result.goalDateCheck.count ?
      `${result.goalDateCheck.count} assigned ${result.goalDateCheck.count === 1 ? 'value has' : 'values have'} a missing, future or over-90-day date. ` : '';
    const categoryNote = assets.Other > 0 ?
      `${money(assets.Other)} is labelled Other, so its asset class is unresolved. ` : '';
    return answer(`${scope} are Equity ${percent(assets.Equity, total)}, Debt ${percent(assets.Debt, total)}, Gold ${percent(assets.Gold, total)}, and Other ${percent(assets.Other, total)}. ` +
      `The largest ${largestKind} is ${largest.name} at ${percent(largestValue, total)} of this ${selectedGoal ? 'goal’s assigned value' : 'entered total'}.` +
      (top.length > 1 ? ` The largest ${top.length} positions together are ${percent(topValue, total)}.` : ''),
      `${money(largestValue)} ÷ ${money(total)}; ${selectedGoal ? `${result.goalHoldingCount} assigned holding ${result.goalHoldingCount === 1 ? 'row' : 'rows'} for the selected goal` : `${valid.length} entered holding ${valid.length === 1 ? 'row' : 'rows'}`}. ${top.length > 1 ? `The largest ${top.length} positions sum to ${money(topValue)}. ` : ''}Exact matching supplied ISINs and fund-house summary names are grouped; rows without those identifiers stay separate. ${result.asOfSummary}.`,
      `${dateNote}${categoryNote}Fund constituents and holdings outside this review are not verified. These shares do not establish whether the mix suits your age, risk capacity or goal. ${coverageNote}`,
      selectedGoal ? '#goals' : '#holdings', selectedGoal ? 'Review this goal' : 'Inspect holdings');
  }
  const topMatch = /\btop\s+(?:(?:three|3)\s+)?(holdings?|positions?|funds?|stocks?)\b/.exec(input);
  if (topMatch) {
    const selectedGoal = Boolean(goalScopeRequested);
    if (selectedGoal) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const requested = topMatch[1];
    const kind = /^fund/.test(requested) ? 'Mutual fund' : /^stock/.test(requested) ? 'Stock' : null;
    const scope = kind === 'Mutual fund' ? 'mutual-fund' : kind === 'Stock' ? 'direct-stock' : 'holding';
    const rows = valid.filter(row => !kind || row.type === kind).flatMap(row => {
      const share = selectedGoal ? goalShare(goal, row.id) : 100;
      return share ? [{ ...row, value: Number(row.value) * share / 100 }] : [];
    });
    if (!rows.length) return answer(`No ${scope} value is entered for this review scope.`,
      selectedGoal ? `No ${scope} value is assigned to ${goal.name}.` : `No ${scope} row has a positive entered value.`,
      'This does not establish what you own outside the entered review.', selectedGoal ? '#goals' : '#holdings', 'Check holdings');
    const positions = positionsByIsin(rows).slice(0, 3);
    const total = rows.reduce((sum, row) => sum + Number(row.value), 0);
    const list = positions.map((position, index) =>
      `#${index + 1} ${position.name} ${money(position.value)} (${percent(position.value, total)})`).join('; ');
    const combined = positions.filter(position => position.entries > 1);
    return answer(`${selectedGoal ? `For ${goal.name}, ` : lead}the largest ${positions.length} entered ${scope} ${positions.length === 1 ? 'position is' : 'positions are'} ${list}.`,
      `Ranked ${rows.length} entered ${scope} rows by ${selectedGoal ? 'assigned' : 'entered'} value, using ${money(total)} as the denominator. ${combined.length ? `${combined.map(position => `${position.entries} rows sharing one supplied ISIN or fund house were grouped for ${position.name}`).join('; ')}. ` : ''}${result.asOfSummary}.`,
      'These are supplied values with dates where entered. Fund constituents and investments outside this review are unknown, so the ranking does not establish underlying company concentration or suggest a trade.', selectedGoal ? '#goals' : '#holdings', 'Inspect these holdings');
  }
  const asksFund = /\b(?:fund|funds|mutual fund|mutual funds)\b/.test(input);
  const asksStock = /\b(?:stock|stocks)\b/.test(input);
  if (/\b(?:biggest|largest|highest\s+(?:entered\s+)?value)\b/.test(input) && asksFund !== asksStock) {
    const selectedGoal = Boolean(goalScopeRequested);
    if (selectedGoal) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const kind = asksFund ? 'Mutual fund' : 'Stock';
    const label = asksFund ? 'mutual-fund' : 'direct-stock';
    const rows = valid.filter(row => row.type === kind).flatMap(row => {
      const share = selectedGoal ? goalShare(goal, row.id) : 100;
      return share ? [{ ...row, value: Number(row.value) * share / 100 }] : [];
    });
    if (!rows.length) return answer(`No ${label} value is entered for this review scope.`,
      selectedGoal ? `No ${label} value is assigned to ${goal.name}.` : `No ${label} row has a positive entered value.`,
      'This does not establish what you own outside the entered review.', '#holdings', `Check ${asksFund ? 'fund' : 'stock'} holdings`);
    const largest = positionsByIsin(rows)[0];
    const total = rows.reduce((sum, row) => sum + Number(row.value), 0);
    return answer(`${selectedGoal ? `For ${goal.name}, ` : lead}${largest.name} is the largest entered ${largest.granularity === 'fund_house' ? 'fund-house summary' : asksFund ? 'fund position' : 'stock position'} at ${money(largest.value)}, or ${percent(largest.value, total)} of ${selectedGoal ? 'assigned' : 'entered'} ${label} value.`,
      `${money(largest.value)} ÷ ${money(total)} ${selectedGoal ? 'assigned' : 'entered'} ${label} value; exact matching supplied ISINs${asksFund ? ' and fund-house summaries' : ''} are grouped. ${result.asOfSummary}.`,
      `This uses supplied dated values. ${asksFund ? 'A fund-house summary may contain several schemes, and fund constituents' : 'Corporate actions and quantities'} or missing investments are not verified.`, selectedGoal ? '#goals' : '#holdings', `Inspect this ${asksFund ? 'fund' : 'stock'}`);
  }
  if (/\b(biggest|largest|concentrat(?:ion|ed|e|ing)?|top holding|single holding)\b/.test(input)) {
    const selectedGoal = Boolean(goalScopeRequested);
    if (selectedGoal) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    if (namedGroup) {
      const rows = rowsForNamedGroup();
      if (!rows.length) return answer(`No ${namedGroup.label} are ${selectedGoal ? `assigned to ${goal.name}` : 'entered in this review'} yet. Add or assign a current holding before comparing this group.`,
        `0 positive ${namedGroup.kind} rows in ${selectedGoal ? `the selected goal ${goal.name}` : 'the entered snapshot'}.`,
        `This does not establish what you own outside the review. ${coverageNote}`, selectedGoal ? '#goals' : '#holdings', 'Check this group');
      const top = positionsByIsin(rows).slice(0, 3);
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      const largest = top[0];
      const topValue = top.reduce((sum, position) => sum + position.value, 0);
      const scope = `${selectedGoal ? 'assigned' : 'entered'} ${namedGroup.positionLabel} value`;
      const additional = top.length > 1 ? ` The largest ${top.length} entered positions together are ${money(topValue)}, or ${percent(topValue, total)}. They are ${top.map(position => `${position.name} ${percent(position.value, total)}`).join('; ')}.` : '';
      return answer(`${selectedGoal ? `For ${goal.name}, ` : lead}${largest.name} is the largest entered ${largest.granularity === 'fund_house' ? 'fund-house summary' : `${namedGroup.positionLabel} position`} at ${money(largest.value)}, or ${percent(largest.value, total)} of ${scope}.${additional}`,
        `${money(largest.value)} ÷ ${money(total)} ${scope}; ${rows.length} positive ${namedGroup.kind} rows. Exact matching supplied ISINs and fund-house summary names are grouped; unidentified rows stay separate.`,
        `One fund can contain many securities. These shares do not measure verified company concentration or tell you what to trade. ${coverageNote}`, selectedGoal ? '#goals' : '#holdings', 'Inspect this group');
    }
    const top = selectedGoal ? result.topGoalPositions : result.topPositions;
    const total = selectedGoal ? result.goalTotal : result.total;
    const largest = top[0];
    const topValue = top.reduce((sum, position) => sum + position.value, 0);
    const scope = selectedGoal ? `${goal.name}’s assigned value` : 'the entered total';
    const additional = top.length > 1 ? ` The largest ${top.length} entered positions together are ${money(topValue)}, or ${percent(topValue, total)}. They are ${top.map(position => `${position.name} ${percent(position.value, total)}`).join('; ')}.` : '';
    return answer(`${selectedGoal ? `For ${goal.name}, ` : lead}${largest.name} is the largest entered position at ${money(largest.value)}, or ${percent(largest.value, total)} of ${scope}.${additional}`,
      `${money(largest.value)} ÷ ${money(total)} ${scope}; ${largest.granularity === 'fund_house' ? 'the largest position is a fund-house summary' : largest.entries > 1 ? `${largest.entries} rows with the same supplied ISIN form the largest position` : 'the largest position is one entered row'}. Exact matching supplied ISINs and fund-house summary names are grouped; unidentified rows stay separate. ${result.asOfSummary}.`,
      `One fund can contain many securities. These shares do not measure verified company concentration or tell you what to trade. ${coverageNote}`, selectedGoal ? '#goals' : '#holdings', 'Inspect this holding');
  }
  if (/\btoo many\b.{0,25}\b(?:mutual\s+)?funds?\b/.test(input)) {
    const funds = valid.filter(row => row.type === 'Mutual fund');
    const groups = summarizeFundGroups(funds);
    return answer(`${lead}${funds.length} mutual-fund ${funds.length === 1 ? 'row is' : 'rows are'} entered, representing ${groups.total} identifiable fund ${groups.total === 1 ? 'group' : 'groups'}. The count alone cannot tell whether you own too many funds. Check scheme identities, what each holds, and how each relates to your goals before judging overlap.`,
      `${funds.length} positive mutual-fund rows; ${groups.total} identifiable groups after matching supplied identifiers or names.`,
      `Fund-house summaries may contain several schemes. Different schemes can hold the same companies, and dated holdings outside this review are unknown. ${coverageNote}`, '#holdings', 'Inspect fund rows');
  }
  if (/\b(?:risk score|risk rating|how much could i lose|maximum loss|worst.case loss)\b/.test(input))
    return answer('I cannot assign a personal risk score or maximum loss from this holdings snapshot. You can choose a hypothetical fall to see one-time arithmetic from the entered values, such as “What if my portfolio fell 20%?” This will not predict a future loss.',
      `Entered value ${money(result.total)}; no validated risk model, full fund constituents, or complete financial circumstances are available.`,
      'A hypothetical percentage is chosen by you and does not bound the possible loss or establish suitability.', '#holdings', 'Review entered exposure');
  if (/\bwhy\b.{0,55}\b(?:portfolio|funds?|stocks?|investments?)\b.{0,25}\b(?:fell|fall|dropped|declined)\b|\bwhy\b.{0,55}\b(?:fell|fall|dropped|declined)\b.{0,25}\b(?:portfolio|funds?|stocks?|investments?)\b/.test(input))
    return answer('I cannot identify why the portfolio changed from one holdings snapshot. Compare two dated, complete snapshots and the intervening cash flows first; then check the price and quantity changes of the same positions.',
      `${valid.length} current entered holding ${valid.length === 1 ? 'row' : 'rows'}; this review has no complete earlier portfolio snapshot or transaction history.`,
      'A current value or a single holding gain or loss does not establish the cause of a portfolio move.', '#holdings', 'Check dated sources');
  if (namedGroup && /^(?:how much|what (?:percentage|percent|proportion|share|amount|value))\b/.test(input) &&
      !/\b(?:tax|expense|cost|return|profit|loss|fee|invested)\b/.test(input)) {
    if (goalScopeRequested) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const rows = rowsForNamedGroup();
    const value = rows.reduce((sum, row) => sum + Number(row.value), 0);
    const total = goalScopeRequested ? result.goalTotal : result.total;
    return answer(`${goalScopeRequested ? `For ${goal.name}, ` : lead}${money(value)} (${percent(value, total)}) of ${goalScopeRequested ? 'assigned' : 'entered'} value is in ${namedGroup.label}.`,
      `${money(value)} ${namedGroup.label} ÷ ${money(total)} ${goalScopeRequested ? 'assigned' : 'entered'} value; ${rows.length} positive ${namedGroup.kind} rows. ${result.asOfSummary}.`,
      `This is a product-type share, not underlying company or asset exposure. Fund-house summaries can contain several schemes. Values and coverage are supplied, not independently verified. ${coverageNote}`, goalScopeRequested ? '#goals' : '#holdings', 'Inspect these holdings');
  }
  const askedAssets = [
    ['Equity', /\b(?:equity|equities)\b/],
    ['Debt', /\bdebt\b/],
    ['Gold', /\bgold\b/],
  ].filter(([, pattern]) => pattern.test(input));
  if (askedAssets.length === 1 && /^(?:how much|what (?:percentage|percent|share|amount|value))\b/.test(input) &&
      !/\b(?:tax|expense|cost|return|profit|loss|fee)\b/.test(input)) {
    if (goalScopeRequested) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const asset = askedAssets[0][0];
    const value = goalScopeRequested ? result.goalAssets[asset] : result.assets[asset];
    const total = goalScopeRequested ? result.goalTotal : result.total;
    return answer(`${goalScopeRequested ? `For ${goal.name}, ` : lead}${money(value)} (${percent(value, total)}) of ${goalScopeRequested ? 'assigned' : 'entered'} value is labelled ${asset}.`,
      `${money(value)} labelled ${asset} ÷ ${money(total)} ${goalScopeRequested ? 'assigned' : 'entered'} value; ${result.asOfSummary}.`,
      `Asset labels, values and dates are supplied, not independently verified. Funds may hold other assets beneath their broad labels. ${coverageNote}`, goalScopeRequested ? '#goals' : '#holdings', 'Inspect asset labels');
  }
  if (/\b(mix|equity|equities|debt|gold|asset|allocation|diversif)\b/.test(input))
    return answer(`${lead}the entered mix is Equity ${percent(result.assets.Equity, result.total)}, Debt ${percent(result.assets.Debt, result.total)}, Gold ${percent(result.assets.Gold, result.total)}, and Other ${percent(result.assets.Other, result.total)}.`,
      `Equity ${money(result.assets.Equity)}, Debt ${money(result.assets.Debt)}, Gold ${money(result.assets.Gold)}, Other ${money(result.assets.Other)} ÷ ${money(result.total)} entered total.`,
      `Asset labels are as entered. This does not judge whether the mix is suitable for your age or goal. ${coverageNote}`, '#goals', 'Review goal context');
  if (goalScopeRequested && /\b(?:own|holdings?|worth|total|value)\b/.test(input)) {
    const unavailable = unavailableGoalScope();
    if (unavailable) return unavailable;
    return answer(`${money(result.goalTotal)} of entered holding value is assigned to ${goal.name} across ${result.goalHoldingCount} linked ${result.goalHoldingCount === 1 ? 'row' : 'rows'}.`,
      `Added only the shares of confirmed holding values linked to ${goal.name}; ${result.asOfSummary}.`,
      `The assignments and valuation dates are supplied, not independently verified. Holdings outside this review and unassigned shares are excluded.`, '#goals', 'Review assigned holdings');
  }
  if (/\b(own|holdings?|total|worth|value|portfolio|funds?|stocks?)\b/.test(input)) {
    const funds = valid.filter(row => row.type === 'Mutual fund').length;
    const stocks = valid.filter(row => row.type === 'Stock').length;
    const other = valid.filter(row => row.type === 'Other investment').length;
    return answer(`${lead}${funds} mutual-fund ${funds === 1 ? 'row' : 'rows'}, ${stocks} direct-stock ${stocks === 1 ? 'row' : 'rows'} and ${other} other-investment ${other === 1 ? 'row' : 'rows'} total ${money(result.total)}. ${result.asOfSummary}.`,
      `Added ${valid.length} positive values entered or imported in this tab; a fund-house summary may represent several schemes.`,
      `${coverageNote} This is not a live account balance.`, '#holdings', 'Inspect included holdings');
  }
  return answer('I can answer questions about the entered total, asset mix, largest holding, goal gap, valuation dates, and fund cost coverage. Try one of those, or add a statement to improve the review.',
    'This browser tool uses fixed calculations and does not send your question to an AI service.',
    'It cannot answer open-ended market questions or recommend investments.', '#input-choice', 'Add a source');
}
