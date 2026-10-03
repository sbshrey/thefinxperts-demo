import { hasDatedFundTer, planFromName, positionsByIsin, valuationDateIssue } from './analysis.mjs';
import { rupeesWithPaise } from './cost-basis.mjs';
import { reserveMonths } from './reserve.mjs';
import { confirmedGoalAssumptions } from './goal-scenario.mjs';
import { asksForAdvice } from './question-scope.mjs';
import { goalShare, summarizeGoalCoverage } from './goals.mjs';

const money = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
const percent = (part, whole) => whole ? `${(part / whole * 100).toFixed(1)}%` : '0%';

/** Answer a narrow set of portfolio questions from the current in-tab review. */
export function answerReviewQuestion(question, { holdings, goal, goals, source, coverage, reserve, result, today = new Date() }) {
  if (typeof question !== 'string' || !question.trim() || !result || !Array.isArray(holdings)) return null;
  const input = question.trim().toLocaleLowerCase('en-IN');
  const valid = holdings.filter(row => Number.isFinite(Number(row.value)) && Number(row.value) > 0);
  const lead = source === 'demo' ? 'In the fictional example, ' : 'From your entered holdings, ';
  const coverageNote = source === 'demo' ? 'This is fictional sample data.' :
    coverage?.mutualFunds === 'all' && coverage?.directStocks === 'all' &&
    ['all', 'none'].includes(coverage?.otherInvestments) ?
      'Coverage of all three investment groups is self reported and has not been verified.' :
      'This snapshot may omit investments you own. Check it against current statements.';
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

  if (otherNamedGoal && /\b(?:goal|toward|towards|for|assigned|linked|funding|counted)\b/.test(input) &&
      !asksForAdvice(input))
    return answer(`You named ${otherNamedGoal.name}, but ${goal?.name || 'another goal'} is selected. Say “select goal ${otherNamedGoal.name}”, then ask again so I use that goal’s assignments.`,
      `The current calculation belongs to the selected goal ${goal?.name || 'unnamed'}; no value for ${otherNamedGoal.name} was used.`,
      'Goal totals and allocations must come from the goal you actually mean.', '#goals', 'Select the named goal');

  if (goalScopeRequested && /\b(?:invested|profit|gains?|ter|expense ratio|regular plans?|direct plans?|overlap)\b/.test(input))
    return answer(`I cannot calculate that metric separately for ${goal?.name || 'the selected goal'} from this review. Ask about the goal’s assigned value or asset mix, or ask for the whole-portfolio metric without naming a goal.`,
      'Goal links assign shares of current holding value; checked cost, fund fees and overlap are not allocated to individual goals here.',
      'Using a whole-portfolio figure as a goal figure would be misleading.', '#goals', 'Review goal assignments');

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

  if (/^(?:what should i do(?: next)?|how (?:can|do) i improve (?:my )?(?:portfolio|review|investments?)|where should i start)[?.!]*$/.test(input)) {
    if (!valid.length) return answer('Start by adding and confirming a current holding from a supported statement or broker report. Then I can show what the entered portfolio contains and what needs checking.',
      'No confirmed holding value is available for a factual review.',
      'I cannot choose investments or trades; an import remains a draft until you confirm it.', '#holdings', 'Add a holding');
    const first = result.findings?.[0];
    if (first) return answer(`Start with this factual check: ${first.title}. ${first.detail} ${first.question}`,
      first.basis,
      `${first.limitation} This check does not select a trade or personal allocation.`, '#review', 'See this review check');
    return answer('The entered snapshot has no flagged first check. Review its scope, valuation dates, and your selected goal before making a decision.',
      `${valid.length} confirmed holding ${valid.length === 1 ? 'row' : 'rows'}; ${result.asOfSummary}.`,
      'This browser review cannot assess suitability or choose a trade or personal allocation.', '#goals', 'Review selected goal');
  }

  if (asksForAdvice(input))
    return answer('I can show what your entries say, but I cannot choose a trade, fund, or personal allocation for you. Check the dated values and your own goal mix before discussing an action with a registered investment adviser.',
      'This review uses your supplied holdings and goal inputs; it has no suitability assessment or verified current prices.',
      'A personalized action needs information and an adviser process that this browser review does not provide.', '#goals', 'Review my goal');
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
      !/\b(?:biggest|largest|top|concentrat\w*|rank\w*)\b/.test(input)) {
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
    return answer('Add a fund, stock or other investment, or import a supported statement, and I can answer from that review.',
      'There are no positive holding values in this tab.',
      'No portfolio calculation is available yet.', '#input-choice', 'Choose an input');
  }
  if (/\b(?:goal|target|chosen) mix\b|\b(?:mix|allocation)\b.{0,30}\b(?:compare|difference|plan)\b/.test(input)) {
    if (!goal?.targetMix) return answer('You have not entered a chosen mix for this goal. If you already have one, say “goal mix 60% equity, 30% debt, 10% gold” and confirm it. I cannot choose percentages for you.',
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
    const parts = result.mixComparison.map(row =>
      `${row.asset} ${row.currentPct.toFixed(1)}% entered versus ${row.plannedPct.toFixed(1)}% chosen`);
    return answer(`For ${goal.name}, ${parts.join('; ')}.`,
      `${money(result.goalTotal)} of entered value is linked to this goal; each share is its labelled asset value divided by that total.`,
      'These are supplied dated values and your own chosen percentages. Fund constituents, taxes and transaction costs are not assessed. A difference is a review prompt, not an instruction to trade.', '#goals', 'Review chosen mix');
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
  if (/\b(overlap|duplicates?|same stocks?|same funds?|twice|double.count(?:ed|ing)?)\b/.test(input))
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
    const prefix = repeated.length ?
      `I found ${repeated.length} repeated instrument ${repeated.length === 1 ? 'identifier' : 'identifiers'} across ${repeatedRows} entered rows. Compare their statements and accounts before deciding whether they represent separate positions or a duplicated import.` :
      'I found no repeated instrument identifier among the entered rows with an ISIN.';
    return answer(`${prefix} I cannot confirm overlap inside different funds from this snapshot.`,
      `${byInstrument.size} distinct supplied type-and-ISIN pairs compared; ${missingIds} of ${valid.length} rows lack a usable ISIN. ${repeated.length ? `Repeated: ${repeated.slice(0, 3).map(([key, count]) => `${key.split(':')[1]} (${count} rows)`).join(', ')}${repeated.length > 3 ? ', and more' : ''}.` : ''}`,
      'A repeated ISIN is a review flag, not proof of double counting. Different fund ISINs can still own the same underlying securities; constituent look-through is unverified here.', '#holdings', 'Inspect matching rows');
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
    const issues = valid.map(row => ({ row, issue: valuationDateIssue(row.asOf, today),
      number: holdings.indexOf(row) + 1 }));
    const count = issue => issues.filter(item => item.issue === issue).length;
    const missing = count('missing');
    const stale = count('stale');
    const future = count('future');
    const needingCheck = issues.filter(item => item.issue);
    const first = needingCheck.slice(0, 5).map(({ row, issue, number }) =>
      `#${number} ${row.name} (${issue === 'missing' ? 'date missing' :
        `${row.asOf}; ${issue === 'future' ? 'future date' : 'over 90 days old'}`})`);
    const list = first.length ? ` Check ${first.join('; ')}${needingCheck.length > first.length ?
      `; and ${needingCheck.length - first.length} more flagged ${needingCheck.length - first.length === 1 ? 'row' : 'rows'}` : ''}.` : '';
    return answer(`${lead}${missing} ${missing === 1 ? 'holding lacks' : 'holdings lack'} a date, ${stale} ${stale === 1 ? 'is' : 'are'} dated over 90 days ago, and ${future} ${future === 1 ? 'has a' : 'have'} future ${future === 1 ? 'date' : 'dates'}.${list} ${String(result.asOfSummary).replace(/\.$/, '')}.`,
      `Compared the dates on ${valid.length} entered ${valid.length === 1 ? 'holding' : 'holdings'} with today's date in India; the 90-day threshold is a review prompt.`,
      'A dated entry is not a verified live quote. Refresh values from the original source.', '#holdings', 'Check dated values');
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
    return answer(`${lead}${money(result.goalTotal)} is assigned to ${goal.name} against your ${money(goal.target)} target today. The simple gap is ${money(result.goalGap)}.`,
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
    return cost.coveredValue ? answer(`${lead}dated TERs cover ${money(cost.coveredValue)} of ${money(result.fundValue)} entered fund value. Their weighted rate is ${percent(cost.annualIllustration, cost.coveredValue)} on the covered amount only.`,
      `${money(cost.annualIllustration)} annual cost illustration ÷ ${money(cost.coveredValue)} with entered TERs; ${money(cost.uncoveredValue)} has no dated TER here.`,
      'This is an illustration already reflected in fund NAV, not an extra charge or a full portfolio fee estimate.', '#holdings', 'Check fund TERs') :
      answer('No dated, scheme-specific expense ratios are entered, so I cannot estimate fund cost coverage.',
        `${money(result.fundValue)} entered mutual-fund value; none has a validated dated TER in this review.`,
        'A fund name or plan label alone is not an expense ratio.', '#holdings', 'Check fund details');
  }
  if (/\b(diversif(?:y|ied|ication)?|spread across assets)\b/.test(input)) {
    if (goalScopeRequested) {
      const unavailable = unavailableGoalScope();
      if (unavailable) return unavailable;
    }
    const selectedGoal = goal?.confirmed === true && result.goalTotal > 0;
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
  if (/\b(mix|equity|debt|gold|asset|allocation|diversif)\b/.test(input))
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
    return answer(`${lead}${funds} mutual-fund rows, ${stocks} direct-stock rows and ${other} other-investment rows total ${money(result.total)}. ${result.asOfSummary}.`,
      `Added ${valid.length} positive values entered or imported in this tab; a fund-house summary may represent several schemes.`,
      `${coverageNote} This is not a live account balance.`, '#holdings', 'Inspect included holdings');
  }
  return answer('I can answer questions about the entered total, asset mix, largest holding, goal gap, valuation dates, and fund cost coverage. Try one of those, or add a statement to improve the review.',
    'This browser tool uses fixed calculations and does not send your question to an AI service.',
    'It cannot answer open-ended market questions or recommend investments.', '#input-choice', 'Add a source');
}
