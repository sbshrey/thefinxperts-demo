import { planFromName, valuationDateIssue } from './analysis.mjs';
import { rupeesWithPaise } from './cost-basis.mjs';
import { reserveMonths } from './reserve.mjs';

const money = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
const percent = (part, whole) => whole ? `${(part / whole * 100).toFixed(1)}%` : '0%';

/** Answer a narrow set of portfolio questions from the current in-tab review. */
export function answerReviewQuestion(question, { holdings, goal, source, coverage, reserve, result, today = new Date() }) {
  if (typeof question !== 'string' || !question.trim() || !result || !Array.isArray(holdings)) return null;
  const input = question.trim().toLocaleLowerCase('en-IN');
  const valid = holdings.filter(row => Number.isFinite(Number(row.value)) && Number(row.value) > 0);
  const lead = source === 'demo' ? 'In the fictional example, ' : 'From your entered holdings, ';
  const coverageNote = source === 'demo' ? 'This is fictional sample data.' :
    coverage?.mutualFunds === 'all' && coverage?.directStocks === 'all' ?
      'Fund and direct-stock coverage is self reported; other asset types may still be outside this review.' :
      'This snapshot may omit funds or stocks you own. Check it against current statements.';
  const answer = (text, basis, limitation, href = '#holdings', action = 'Check my holdings') =>
    ({ text, basis, limitation, href, action });

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

  if (/\b(buy|sell|switch|redeem|rebalance|rebalancing|optimi[sz](?:e|ation|ing)?|recommend\w*|what should i do|should i hold|which fund|best fund|right mix|ideal mix|suitable|how much should i invest|choose|pick|prefer|better|convert|move)\b/.test(input))
    return answer('I can show what your entries say, but I cannot choose a trade, fund, or personal allocation for you. Check the dated values and your own goal mix before discussing an action with a registered investment adviser.',
      'This review uses your supplied holdings and goal inputs; it has no suitability assessment or verified current prices.',
      'A personalized action needs information and an adviser process that this browser review does not provide.', '#goals', 'Review my goal');
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
  if (/\b(nav|share price|stock price|market price|live quote|live price|today.{0,25}(?:price|nav|value)|latest.{0,25}(?:price|nav|value))\b/.test(input))
    return answer('I do not have a live market feed here. Use a dated value from your broker or fund statement, then update the holding in this browser.',
      result.asOfSummary,
      'A recent statement value may still differ from the current market value.', '#holdings', 'Check entered dates');
  if (/\b(?:reserve|emergency buffer|emergency fund)\b/.test(input)) {
    const months = reserveMonths(reserve);
    return months === null ? answer('No separate reserve totals are saved in this review. If you want the arithmetic, say “monthly essentials ₹50,000” and “accessible money outside holdings ₹3 lakh”, then confirm both.',
      'A reserve comparison needs both the monthly essential-spending total and accessible money outside these holdings.',
      'This review does not choose a reserve target or verify bank balances, debts, or access to money.', '#goals', 'Add separate reserve totals') :
      answer(`Your entered accessible money outside these holdings is ${money(reserve.accessibleMoney)} against ${money(reserve.monthlyEssentials)} monthly essentials: ${months.toFixed(1)} months by division.`,
        `${money(reserve.accessibleMoney)} ÷ ${money(reserve.monthlyEssentials)} = ${months.toFixed(1)} months. These amounts are outside the portfolio total.`,
        'Both amounts are self reported. This is not a recommendation or proof that the money is accessible or enough for your circumstances.', '#goals', 'Check separate reserve');
  }
  if (!valid.length)
    return answer('Add a fund, stock or other investment, or import a supported statement, and I can answer from that review.',
      'There are no positive holding values in this tab.',
      'No portfolio calculation is available yet.', '#input-choice', 'Choose an input');
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
    return answer(`${lead}mutual-fund coverage is ${label(coverage?.mutualFunds)} and direct-stock coverage is ${label(coverage?.directStocks)}.`,
      `Used your self-reported coverage answers and ${valid.length} entered holding rows; no broker or fund account was independently checked.`,
      'Manually entered EPF, NPS, deposits or gold may be included, but their coverage is not checked. Compare current source statements before treating the total as complete.', '#holdings', 'Check review coverage');
  }
  if (/\b(next|priority|start|check first|review first)\b/.test(input)) {
    const first = result.findings?.[0];
    return first ? answer(`${lead}${first.title.toLowerCase()}. ${first.detail}`,
      first.basis, first.limitation, '#review', 'See the review item') :
      answer('Check your statement coverage and the dates of entered values before using this as a complete portfolio picture.',
        `${valid.length} entered holdings; ${result.asOfSummary}.`, coverageNote, '#holdings', 'Check holdings');
  }
  if (/\b(as.?of|dated?|stale|recent|refresh|old values?)\b/.test(input)) {
    const issues = valid.map(row => valuationDateIssue(row.asOf, today));
    const missing = issues.filter(issue => issue === 'missing').length;
    const stale = issues.filter(issue => issue === 'stale').length;
    const future = issues.filter(issue => issue === 'future').length;
    return answer(`${lead}${missing} holdings lack a date, ${stale} are dated over 90 days ago, and ${future} have future dates. ${result.asOfSummary}.`,
      `Compared the dates on ${valid.length} entered holdings with today's date in India; the 90-day threshold is a review prompt.`,
      'A dated entry is not a verified live quote. Refresh values from the original source.', '#holdings', 'Check dated values');
  }
  if (/\b(goal|target|gap|horizon|retirement|future)\b/.test(input)) {
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
    const selectedGoal = goal?.confirmed === true && result.goalTotal > 0;
    const total = selectedGoal ? result.goalTotal : result.total;
    const assets = selectedGoal ? result.goalAssets : result.assets;
    const largest = selectedGoal ? result.largestGoalPosition :
      [...valid].sort((a, b) => Number(b.value) - Number(a.value))[0];
    const scope = selectedGoal ? `For ${goal.name}, the entered, assigned holdings` :
      'The entered holdings';
    const largestValue = Number(largest?.value) || 0;
    const largestKind = largest?.granularity === 'fund_house' ? 'fund-house summary' : 'holding';
    const dateNote = selectedGoal && result.goalDateCheck.count ?
      `${result.goalDateCheck.count} assigned ${result.goalDateCheck.count === 1 ? 'value has' : 'values have'} a missing, future or over-90-day date. ` : '';
    const categoryNote = assets.Other > 0 ?
      `${money(assets.Other)} is labelled Other, so its asset class is unresolved. ` : '';
    return answer(`${scope} are Equity ${percent(assets.Equity, total)}, Debt ${percent(assets.Debt, total)}, Gold ${percent(assets.Gold, total)}, and Other ${percent(assets.Other, total)}. ` +
      `The largest ${largestKind} is ${largest.name} at ${percent(largestValue, total)} of this ${selectedGoal ? 'goal’s assigned value' : 'entered total'}.`,
      `${money(largestValue)} ÷ ${money(total)}; ${selectedGoal ? `${result.goalHoldingCount} assigned holding ${result.goalHoldingCount === 1 ? 'row' : 'rows'} for the selected goal` : `${valid.length} entered holding ${valid.length === 1 ? 'row' : 'rows'}`}. ${result.asOfSummary}.`,
      `${dateNote}${categoryNote}Fund constituents and holdings outside this review are not verified. These shares do not establish whether the mix suits your age, risk capacity or goal. ${coverageNote}`,
      selectedGoal ? '#goals' : '#holdings', selectedGoal ? 'Review this goal' : 'Inspect holdings');
  }
  if (/\b(biggest|largest|concentrat(?:ion|ed|e|ing)?|top holding|single holding)\b/.test(input)) {
    const largest = [...valid].sort((a, b) => Number(b.value) - Number(a.value))[0];
    return answer(`${lead}${largest.name} is the largest entered row at ${money(largest.value)}, or ${percent(largest.value, result.total)} of the entered total.`,
      `${money(largest.value)} ÷ ${money(result.total)} entered total; ${largest.granularity === 'fund_house' ? 'this row is a fund-house summary' : 'this is one entered holding row'}.`,
      'One fund can contain many securities. This row share does not measure verified company concentration or tell you what to trade.', '#holdings', 'Inspect this holding');
  }
  if (/\b(mix|equity|debt|gold|asset|allocation|diversif)\b/.test(input))
    return answer(`${lead}the entered mix is Equity ${percent(result.assets.Equity, result.total)}, Debt ${percent(result.assets.Debt, result.total)}, Gold ${percent(result.assets.Gold, result.total)}, and Other ${percent(result.assets.Other, result.total)}.`,
      `Equity ${money(result.assets.Equity)}, Debt ${money(result.assets.Debt)}, Gold ${money(result.assets.Gold)}, Other ${money(result.assets.Other)} ÷ ${money(result.total)} entered total.`,
      `Asset labels are as entered. This does not judge whether the mix is suitable for your age or goal. ${coverageNote}`, '#goals', 'Review goal context');
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
