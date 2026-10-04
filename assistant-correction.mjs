import { parseAmount } from './assistant-clarify.mjs?v=9001bdd7691c';
import { validCostBasis, rupeesWithPaise } from './cost-basis.mjs?v=9001bdd7691c';
import { removeHoldingAllocation } from './goals.mjs?v=9001bdd7691c';
import { estimateNavValue, realDate } from './nav-estimate.mjs?v=9001bdd7691c';
import { estimateStockValue, validShares } from './stock-estimate.mjs?v=9001bdd7691c';

const money = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const indiaToday = today => new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Deliberate, narrow chat commands; ordinary questions cannot alter confirmed holdings. */
export function parseHoldingCorrection(message, today = new Date()) {
  if (typeof message !== 'string' || message.length > 1500) return null;
  const input = message.trim();
  const clearTer = /^(?:clear|remove) (?:saved )?(?:ter|expense ratio) of (.+?)[.!]?$/i.exec(input);
  if (clearTer) return { kind: 'ter-clear', selector: clearTer[1].trim() };
  const remove = /^remove (?:holding )?(.+?)[.!]?$/i.exec(input);
  if (remove) return { kind: 'remove', selector: remove[1].trim() };
  const cost = /^(?:set|update) invested amount of (.+?) to (.+?) checked (\d{4}-\d{2}-\d{2})[.!]?$/i.exec(input);
  if (cost) {
    const value = parseAmount(cost[2]);
    if (!validCostBasis(value, cost[3], today))
      return { error: 'Use the positive cost of the units or shares you still hold and a real, non-future check date: “set invested amount of NAME to ₹40,000 checked YYYY-MM-DD”.' };
    return { kind: 'cost', selector: cost[1].trim(), value, checkedOn: cost[3] };
  }
  if (/^(?:set|update) invested amount\b/i.test(input))
    return { error: 'Say “set invested amount of NAME to ₹40,000 checked YYYY-MM-DD”. Use the holding number if its name appears more than once.' };
  const ter = /^(?:set|update) (?:ter|expense ratio) of (.+?) to (\d+(?:\.\d{1,4})?)\s*%\s+(?:as of|checked) (\d{4}-\d{2}-\d{2})[.!]?$/i.exec(input);
  if (ter) {
    const ratePct = Number(ter[2]);
    if (ratePct > 10 || !realDate(ter[3]) || ter[3] > indiaToday(today))
      return { error: 'Use a published TER from 0% to 10% and a real, non-future date for that exact scheme and plan.' };
    return { kind: 'ter', selector: ter[1].trim(), ratePct, asOf: ter[3] };
  }
  if (/^(?:set|update) (?:ter|expense ratio)\b/i.test(input))
    return { error: 'Say “set TER of holding 1 to 1.25% as of YYYY-MM-DD” using the published rate for that exact scheme and Direct or Regular plan.' };
  const nav = /^(?:set|update) nav of (.+?) to ₹?([0-9]+(?:\.[0-9]+)?) as of (\d{4}-\d{2}-\d{2})[.!]?$/i.exec(input);
  if (nav) return { kind: 'nav', selector: nav[1].trim(), nav: nav[2], asOf: nav[3] };
  if (/^(?:set|update) nav\b/i.test(input))
    return { error: 'Say “set NAV of holding 1 to ₹125.4321 as of YYYY-MM-DD” using the NAV published for the exact scheme, plan and option.' };
  const price = /^(?:set|update) price of (.+?) to ₹?([0-9]+(?:\.[0-9]+)?) as of (\d{4}-\d{2}-\d{2})[.!]?$/i.exec(input);
  if (price) return { kind: 'price', selector: price[1].trim(), price: price[2], asOf: price[3] };
  if (/^(?:set|update) price\b/i.test(input))
    return { error: 'Say “set price of holding 1 to ₹125.43 as of YYYY-MM-DD” using a dated price for the exact listed security.' };
  const classify = /^classify (?:holding )?(.+?) as (equity|debt|gold|other|unknown)[.!]?$/i.exec(input);
  if (classify) return { kind: 'classify', selector: classify[1].trim(),
    asset: classify[2].toLowerCase() === 'unknown' ? 'Other' :
      classify[2][0].toUpperCase() + classify[2].slice(1).toLowerCase() };
  if (/^classify\b/i.test(input))
    return { error: 'Say “classify holding 1 as Equity”, Debt, Gold or Other after checking the scheme source. Use the holding number when names repeat.' };
  const update = /^(?:update|change|correct) (?:value of )?(.+?) (?:value )?to (.+?) as of (\d{4}-\d{2}-\d{2})[.!]?$/i.exec(input);
  if (update) {
    const value = parseAmount(update[2]);
    const date = update[3];
    const parsed = new Date(`${date}T00:00:00Z`);
    if (value === null || value > 10_000_000_000 || !Number.isFinite(parsed.valueOf()) ||
        parsed.toISOString().slice(0, 10) !== date || date > indiaToday(today)) {
      return { error: 'Use a positive total value up to ₹10,00,00,00,000 and a real, non-future date: “update value of NAME to ₹50,000 as of YYYY-MM-DD”.' };
    }
    return { kind: 'update', selector: update[1].trim(), value, asOf: date };
  }
  if (/^(?:update|change|correct)\b/i.test(input))
    return { error: 'To correct a confirmed row, say “update value of NAME to ₹50,000 as of YYYY-MM-DD”. Use the holding number if its name appears more than once.' };
  return null;
}

/** One self-reported completeness answer; an import never proves coverage. */
export function parseCoverageAnswer(message, pendingField = null) {
  if (typeof message !== 'string' || message.length > 1500) return null;
  const input = message.trim();
  const included = /^i (?:have )?included (all|some) (?:of )?my (mutual funds|direct stocks|other investments)[.!]?$/i.exec(input);
  const none = /^i have no (mutual funds|direct stocks|other investments)[.!]?$/i.exec(input);
  const unsure = /^i(?: am|'m) (?:unsure|not sure) (?:whether i included (?:all of )?)?my (mutual funds|direct stocks|other investments)[.!]?$/i.exec(input);
  if (!included && !none && !unsure) {
    if (!['mutualFunds', 'directStocks', 'otherInvestments'].includes(pendingField)) return null;
    const short = input.toLowerCase().replace(/[.!]$/, '');
    const answer = ({ yes: 'all', all: 'all', 'all included': 'all', some: 'some',
      'some missing': 'some', none: 'none', unsure: 'unsure', 'not sure': 'unsure',
      "i don't know": 'unsure' })[short];
    if (answer) return { field: pendingField, answer };
    if (short === 'no') return { error: 'If not all are included, reply “some” if you own more, “none” if you own none, or “unsure” if you cannot tell.' };
    return null;
  }
  const type = (included?.[2] || none?.[1] || unsure?.[1]).toLowerCase();
  return { field: type === 'mutual funds' ? 'mutualFunds' : type === 'direct stocks' ? 'directStocks' : 'otherInvestments',
    answer: included?.[1].toLowerCase() || (none ? 'none' : 'unsure') };
}

export function prepareCoverageAnswer(saved, parsed) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals))
    return { portfolio: null, errors: ['Add a confirmed holding before checking review coverage.'] };
  if (!parsed || !['mutualFunds', 'directStocks', 'otherInvestments'].includes(parsed.field) ||
      !['all', 'some', 'none', 'unsure'].includes(parsed.answer))
    return { portfolio: null, errors: ['Answer whether all, some or none are included, or say you are unsure.'] };
  const label = { mutualFunds: 'mutual funds', directStocks: 'direct stocks',
    otherInvestments: 'other investments' }[parsed.field];
  if (parsed.answer === 'none' && saved.holdings.some(row => row.type ===
      ({ mutualFunds: 'Mutual fund', directStocks: 'Stock',
        otherInvestments: 'Other investment' }[parsed.field])))
    return { portfolio: null, errors: [`This review already includes ${label}. Check those rows before saying you have none.`] };
  if (saved.coverage?.[parsed.field] === parsed.answer)
    return { portfolio: null, errors: [`Your ${label} coverage answer already says ${parsed.answer}.`] };
  const portfolio = structuredClone(saved);
  portfolio.coverage = { ...portfolio.coverage, [parsed.field]: parsed.answer };
  const hasRows = saved.holdings.some(row => row.type ===
    ({ mutualFunds: 'Mutual fund', directStocks: 'Stock',
      otherInvestments: 'Other investment' }[parsed.field]));
  const words = { all: 'all included', some: hasRows ? 'some included; others missing' : 'some owned; none entered yet',
    none: 'none owned', unsure: 'unsure' };
  return { portfolio, errors: [],
    description: `Set self-reported ${label} coverage to “${words[parsed.answer]}”. The other coverage answers stay as shown in the review. This answer changes only the scope label; it does not add or remove a holding. Check it against your current statements.`,
    result: `Your self-reported ${label} coverage is now ${words[parsed.answer]}. The review still uses only confirmed holdings; no accounts or statements were independently checked.` };
}

function findRow(holdings, selector) {
  const numbered = /^(?:holding\s+)?#?(\d{1,3})$/i.exec(selector);
  if (numbered) {
    const index = Number(numbered[1]) - 1;
    return index >= 0 && index < holdings.length ? { row: holdings[index], index } :
      { error: 'That holding number is not in the current review. Check “Included holdings” on the right.' };
  }
  const wanted = selector.toLocaleLowerCase('en-IN').replace(/\s+/g, ' ').trim();
  const matches = holdings.map((row, index) => ({ row, index })).filter(({ row }) =>
    row.name.toLocaleLowerCase('en-IN').replace(/\s+/g, ' ').trim() === wanted);
  if (!matches.length) return { error: 'No confirmed holding has that exact name. Check “Included holdings” and try its name or number.' };
  if (matches.length > 1) return { error: `That name matches ${matches.length} confirmed rows. Use “holding ${matches[0].index + 1}” or another number shown in Included holdings, then check the preview.` };
  return matches[0];
}

/** Make a previewable, validated portfolio change without touching the original. */
export function prepareHoldingCorrection(saved, command, today = new Date()) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals))
    return { portfolio: null, errors: ['Add a confirmed holding before correcting the review.'] };
  if (!command || !['update', 'remove', 'cost', 'ter', 'ter-clear', 'classify', 'nav', 'price'].includes(command.kind) ||
      typeof command.selector !== 'string' || !command.selector.trim())
    return { portfolio: null, errors: ['Name the confirmed holding or use its number in Included holdings.'] };
  const match = findRow(saved.holdings, command.selector);
  if (match.error) return { portfolio: null, errors: [match.error] };
  const { row, index } = match;
  const portfolio = structuredClone(saved);
  if (command.kind === 'remove') {
    portfolio.holdings.splice(index, 1);
    portfolio.goals = removeHoldingAllocation(portfolio.goals, row.id);
    delete portfolio.coverage;
    const linkedGoals = saved.goals.filter(goal => goal.linkedIds?.includes(row.id)).map(goal => goal.name);
    return { portfolio, errors: [], description: `Remove holding ${index + 1}: ${row.name} · ${money(row.value)} · ${row.asOf || 'date missing'} from this review. Nothing is traded. ${linkedGoals.length ? `It will also stop counting toward ${linkedGoals.join(', ')}. ` : ''}${saved.coverage ? 'The self-reported coverage answer will be cleared.' : ''}`, result: `${row.name} removed from the confirmed review. Its goal links were cleared.${saved.coverage ? ' The coverage answer was also cleared.' : ''}` };
  }
  if (command.kind === 'classify') {
    if (row.type !== 'Mutual fund' || row.granularity === 'fund_house')
      return { portfolio: null, errors: ['Only an individual mutual-fund scheme can be classified here. A fund-house total or other investment needs more source detail.'] };
    if (!['Equity', 'Debt', 'Gold', 'Other'].includes(command.asset))
      return { portfolio: null, errors: ['Choose Equity, Debt, Gold or Other only after checking the scheme source.'] };
    if (row.asset === command.asset)
      return { portfolio: null, errors: ['This fund already has that asset category.'] };
    portfolio.holdings[index].asset = command.asset;
    return { portfolio, errors: [],
      description: `Classify holding ${index + 1}: ${row.name} from ${row.asset} to ${command.asset}. Check the individual scheme's current source classification before applying. Its entered value, valuation date, instrument details and goal links stay the same; the asset and goal mix will be recalculated. This is your label, not an independently verified allocation.`,
      result: `${row.name} is now labelled ${command.asset} from your checked source. The entered value and goal links did not change; asset and goal mix were recalculated.` };
  }
  if (command.kind === 'cost') {
    if (!['Mutual fund', 'Stock'].includes(row.type) || row.granularity === 'fund_house')
      return { portfolio: null, errors: ['A checked invested amount needs one individual fund or stock, not a fund-house total or other investment.'] };
    if (!validCostBasis(command.value, command.checkedOn, today))
      return { portfolio: null, errors: ['Use a positive invested amount and a real, non-future check date.'] };
    if (!row.asOf || command.checkedOn > row.asOf)
      return { portfolio: null, errors: ['Check a dated current value for this same position on or after the invested-amount check date before calculating a gain or loss.'] };
    if (row.costBasis === command.value && row.costBasisAsOf === command.checkedOn)
      return { portfolio: null, errors: ['That invested amount and check date already match this holding.'] };
    portfolio.holdings[index].costBasis = command.value;
    portfolio.holdings[index].costBasisAsOf = command.checkedOn;
    return { portfolio, errors: [],
      description: `Set holding ${index + 1}: ${row.name} invested amount to ${rupeesWithPaise(command.value)}, checked ${command.checkedOn}. Current value stays ${money(row.value)} as of ${row.asOf}. Confirm this is the cost of the units or shares still held, after any sales or redemptions; this does not record lifetime contributions or transactions.`,
      result: `${row.name} now has your checked current-position invested amount of ${rupeesWithPaise(command.value)} dated ${command.checkedOn}. Ask “What is my unrealized gain or loss?” for a partial calculation.` };
  }
  if (command.kind === 'ter') {
    if (row.type !== 'Mutual fund' || row.granularity === 'fund_house')
      return { portfolio: null, errors: ['A dated TER needs one individual mutual-fund scheme, not a stock or fund-house summary.'] };
    if (!Number.isFinite(command.ratePct) || command.ratePct < 0 || command.ratePct > 10 ||
        Math.abs(command.ratePct * 10_000 - Math.round(command.ratePct * 10_000)) > 0.000001 ||
        !realDate(command.asOf) || command.asOf > indiaToday(today))
      return { portfolio: null, errors: ['Use a published scheme TER from 0% to 10% and a real, non-future date.'] };
    if (row.expenseRatioPct === command.ratePct && row.expenseRatioAsOf === command.asOf)
      return { portfolio: null, errors: ['That TER and publication date already match this fund.'] };
    portfolio.holdings[index].expenseRatioPct = command.ratePct;
    portfolio.holdings[index].expenseRatioAsOf = command.asOf;
    return { portfolio, errors: [],
      description: `Set holding ${index + 1}: ${row.name} TER to ${command.ratePct}% as published on ${command.asOf}. Check the exact scheme and Direct or Regular plan at the AMC or AMFI source before applying. At unchanged entered value ${money(row.value)} and this rate for a year, ${money(row.value * command.ratePct / 100)} is a cost illustration already reflected in NAV, not an additional bill. The holding value, date and goal links stay unchanged.`,
      result: `${row.name} now has your checked TER of ${command.ratePct}% dated ${command.asOf}. Ask “What are my fund costs?” for covered-value arithmetic; this is not an amount actually paid.` };
  }
  if (command.kind === 'ter-clear') {
    if (row.type !== 'Mutual fund' || row.granularity === 'fund_house' ||
        row.expenseRatioPct === undefined)
      return { portfolio: null, errors: ['This individual fund has no saved TER to clear.'] };
    delete portfolio.holdings[index].expenseRatioPct;
    delete portfolio.holdings[index].expenseRatioAsOf;
    return { portfolio, errors: [],
      description: `Clear the entered TER ${row.expenseRatioPct}% dated ${row.expenseRatioAsOf} from holding ${index + 1}: ${row.name}. Its value, source date, cost basis and goal links stay. Fund-cost coverage will exclude this row until you enter a checked rate again.`,
      result: `${row.name} no longer has an entered TER. Its holding value and goal links stayed unchanged; fund-cost coverage was recalculated.` };
  }
  if (command.kind === 'nav') {
    if (row.type !== 'Mutual fund' || row.granularity === 'fund_house' || !row.units || !realDate(row.asOf))
      return { portfolio: null, errors: ['A dated NAV estimate needs one individual mutual-fund scheme with known units and a dated value. Import a detailed CAS or check the scheme first.'] };
    const value = estimateNavValue(row.units, command.nav);
    if (value === null || !realDate(command.asOf) || command.asOf > indiaToday(today) || command.asOf <= row.asOf)
      return { portfolio: null, errors: ['Use a positive NAV with up to eight decimal places and a real publication date newer than this holding’s value date, not after today.'] };
    const originalValue = row.navEstimate?.originalValue ?? row.value;
    const originalAsOf = row.navEstimate?.originalAsOf ?? row.asOf;
    portfolio.holdings[index] = { ...row, value, asOf: command.asOf,
      valuationOrigin: 'manual',
      navEstimate: { originalValue, originalAsOf, nav: command.nav, navAsOf: command.asOf } };
    const total = portfolio.holdings.reduce((sum, holding) => sum + Number(holding.value), 0);
    if (!Number.isFinite(total) || total > 1_000_000_000_000)
      return { portfolio: null, errors: ['The estimated portfolio total would exceed the supported limit.'] };
    return { portfolio, errors: [],
      description: `Estimate holding ${index + 1}: ${row.name}. ${row.units} ${row.entryOrigin === 'manual' ? 'entered' : 'statement'} units × your entered NAV ₹${command.nav} dated ${command.asOf} = ${money(value)}. The earlier ${row.entryOrigin === 'manual' ? 'entered' : 'statement'} value ${money(originalValue)} dated ${originalAsOf} stays in your private backup. Check the exact scheme, Direct/Regular plan and Growth/IDCW option at the NAV source, and confirm these units are still your current balance after any transactions. This is a dated estimate, not a verified live account value.`,
      result: `${row.name} now uses your dated NAV estimate of ${money(value)} as of ${command.asOf}; the earlier ${row.entryOrigin === 'manual' ? 'entered' : 'statement'} value remains in the private backup. This assumes ${row.units} units are unchanged.` };
  }
  if (command.kind === 'price') {
    if (row.type !== 'Stock' || !validShares(row.shares) || !realDate(row.asOf))
      return { portfolio: null, errors: ['A dated stock-price estimate needs one directly held stock with a checked share count and dated value. Check the report and current shares first.'] };
    const value = estimateStockValue(row.shares, command.price);
    if (value === null || value > 10_000_000_000 || !realDate(command.asOf) ||
        command.asOf > indiaToday(today) || command.asOf <= row.asOf)
      return { portfolio: null, errors: ['Use a positive price with up to six decimal places and a real price date newer than this holding’s value date, not after today.'] };
    const originalValue = row.stockEstimate?.originalValue ?? row.value;
    const originalAsOf = row.stockEstimate?.originalAsOf ?? row.asOf;
    portfolio.holdings[index] = { ...row, value, asOf: command.asOf,
      valuationOrigin: 'manual',
      stockEstimate: { originalValue, originalAsOf, price: command.price, priceAsOf: command.asOf } };
    const total = portfolio.holdings.reduce((sum, holding) => sum + Number(holding.value), 0);
    if (!Number.isFinite(total) || total > 1_000_000_000_000)
      return { portfolio: null, errors: ['The estimated portfolio total would exceed the supported limit.'] };
    return { portfolio, errors: [],
      description: `Estimate holding ${index + 1}: ${row.name}. ${row.shares} shares × your entered price ₹${command.price} dated ${command.asOf} = ${money(value)}. The earlier value ${money(originalValue)} dated ${originalAsOf} stays in your private backup. Check the exact listed security, exchange and price date, and confirm these shares are still held after trades, splits or bonuses. This is a dated estimate, not a verified live account value.`,
      result: `${row.name} now uses your dated stock-price estimate of ${money(value)} as of ${command.asOf}; the earlier value remains in the private backup. This assumes ${row.shares} shares are unchanged.` };
  }
  const date = typeof command.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(command.asOf) ?
    new Date(`${command.asOf}T00:00:00Z`) : null;
  if (!Number.isFinite(command.value) || command.value <= 0 || command.value > 10_000_000_000 ||
      !date || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== command.asOf ||
      command.asOf > indiaToday(today))
    return { portfolio: null, errors: ['Use a positive dated value for the correction.'] };
  if (row.value === command.value && row.asOf === command.asOf)
    return { portfolio: null, errors: ['That value and date already match the confirmed row.'] };
  const { units: _units, shares: _shares, navEstimate: _navEstimate, stockEstimate: _stockEstimate,
    costBasis: _costBasis, costBasisAsOf: _costBasisAsOf, valuationOrigin: _valuationOrigin,
    ...retained } = portfolio.holdings[index];
  portfolio.holdings[index] = { ...retained, value: command.value, asOf: command.asOf,
    ...(row.type === 'Other investment' ? {} : { valuationOrigin: 'manual' }) };
  const total = portfolio.holdings.reduce((sum, holding) => sum + Number(holding.value), 0);
  if (!Number.isFinite(total) || total > 1_000_000_000_000)
    return { portfolio: null, errors: ['The corrected portfolio total would exceed the supported limit.'] };
  return { portfolio, errors: [], description: `Update holding ${index + 1}: ${row.name} from ${money(row.value)} (${row.asOf || 'date missing'}) to ${money(command.value)} (${command.asOf}). Any saved units or shares, entered price estimates and checked invested cost will be cleared; the new value will be marked as your manual update. Verify those details again if needed.`, result: `${row.name} now uses your manually supplied ${money(command.value)} value dated ${command.asOf}. Any prior units, cost and price estimates were cleared.` };
}
