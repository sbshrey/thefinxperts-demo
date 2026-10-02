import { valuationDateIssue } from './analysis.mjs';

const money = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
const percent = (part, whole) => whole ? `${(part / whole * 100).toFixed(1)}%` : '0%';

/** Answer a narrow set of portfolio questions from the current in-tab review. */
export function answerReviewQuestion(question, { holdings, goal, source, coverage, result, today = new Date() }) {
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

  if (/\b(buy|sell|switch|redeem|rebalance|rebalancing|optimi[sz](?:e|ation|ing)?|recommend|what should i do|should i hold|which fund|best fund|right mix|ideal mix|suitable|how much should i invest)\b/.test(input))
    return answer('I can show what your entries say, but I cannot choose a trade, fund, or personal allocation for you. Check the dated values and your own goal mix before discussing an action with a registered investment adviser.',
      'This review uses your supplied holdings and goal inputs; it has no suitability assessment or verified current prices.',
      'A personalized action needs information and an adviser process that this browser review does not provide.', '#goals', 'Review my goal');
  if (/\b(xirr|cagr|annual(?:ized)? return|performance)\b/.test(input))
    return answer('A holdings snapshot cannot establish your annual return or XIRR. Complete dated cash flows are needed before calculating those figures.',
      `${valid.length} entered current holding ${valid.length === 1 ? 'value' : 'values'}; no complete transaction history is held in this browser review.`,
      'The goal growth assumption is an illustration, not your historical return.', '#holdings', 'Check source statements');
  if (/\b(profit|gains?|loss(?:es)?|invested|returns?)\b/.test(input)) {
    const change = result.unrealizedChange;
    if (!change?.coveredCount) return answer(change?.costAfterValueCount ?
      'The checked invested amount is dated after the holding value. Refresh the value for the same units or shares before calculating an unrealized gain or loss.' :
      'No unrealized gain or loss can be calculated yet. Enter the amount invested in the units or shares you still hold and a dated current value for an individual fund or stock.',
      `${valid.length} entered holding rows; none has cost checked on or before its dated value${change?.costAfterValueCount ? `; ${change.costAfterValueCount} cost ${change.costAfterValueCount === 1 ? 'date is' : 'dates are'} later than the value date` : ''}.`,
      'A total purchase amount that includes sold units is not the cost of the units still held. Complete dated cash flows would be needed for XIRR.', '#holdings', 'Check holding details');
    const direction = change.change >= 0 ? 'gain' : 'loss';
    const percentChange = (Math.abs(change.change) / change.invested * 100).toFixed(1);
    return answer(`${lead}${change.coveredCount} covered ${change.coveredCount === 1 ? 'holding has' : 'holdings have'} an entered unrealized ${direction} of ${money(Math.abs(change.change))} (${percentChange}% of the invested amount).`,
      `${money(change.coveredValue)} entered current value minus ${money(change.invested)} entered cost for the covered positions; value dates ${change.earliestValueDate}${change.latestValueDate !== change.earliestValueDate ? ` to ${change.latestValueDate}` : ''}. ${change.missingCount} ${change.missingCount === 1 ? 'row' : 'rows'} excluded${change.costAfterValueCount ? `, including ${change.costAfterValueCount} with cost checked after the value date` : ''}.`,
      'This is not total lifetime profit or an annual return. It excludes sold positions, cash distributions, taxes, exit loads, rows without checked cost or dated value, and cost checked after the value date.', '#holdings', 'Check covered holdings');
  }
  if (/\b(nav|share price|stock price|market price|live quote|live price|today.{0,25}(?:price|nav|value)|latest.{0,25}(?:price|nav|value))\b/.test(input))
    return answer('I do not have a live market feed here. Use a dated value from your broker or fund statement, then update the holding in this browser.',
      result.asOfSummary,
      'A recent statement value may still differ from the current market value.', '#holdings', 'Check entered dates');
  if (!valid.length)
    return answer('Add one fund or stock, or import a supported statement, and I can answer from that review.',
      'There are no positive holding values in this tab.',
      'No portfolio calculation is available yet.', '#input-choice', 'Choose an input');
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
      'EPF, NPS, deposits, physical gold and other assets are outside this holdings review. Compare current source statements before treating its total as complete.', '#holdings', 'Check review coverage');
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
      'This comparison excludes future growth, inflation, taxes, and holdings outside the selected goal. It uses entered values, not live prices.', '#goals', 'Review selected goal');
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
  if (/\b(biggest|largest|concentrat|top holding|single holding)\b/.test(input)) {
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
    return answer(`${lead}${funds} mutual-fund rows and ${stocks} direct-stock rows total ${money(result.total)}. ${result.asOfSummary}.`,
      `Added ${valid.length} positive values entered or imported in this tab; a fund-house summary may represent several schemes.`,
      `${coverageNote} This is not a live account balance.`, '#holdings', 'Inspect included holdings');
  }
  return answer('I can answer questions about the entered total, asset mix, largest holding, goal gap, valuation dates, and fund cost coverage. Try one of those, or add a statement to improve the review.',
    'This browser tool uses fixed calculations and does not send your question to an AI service.',
    'It cannot answer open-ended market questions or recommend investments.', '#input-choice', 'Add a source');
}
