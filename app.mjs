import { analyzePortfolio, sampleHoldings, overlapPercent, valuationDateIssue } from './analysis.mjs?v=65491240e0a7';
import { parseHoldingsCsv, parseBrokerCsvRows } from './csv.mjs?v=65491240e0a7';
import { suggestBrokerColumns, detectBrokerHoldingsDate, parseBrokerHoldingsRows } from './broker-xlsx.mjs?v=65491240e0a7';
import { validateImportReview, validateImportMerge, findImportMergeConflicts, possibleManualDuplicate, isRepeatedActiveStatement,
  planActiveStatementRefresh, planBrokerReportRefresh, planDematCasRefresh } from './import-review.mjs?v=65491240e0a7';
import { prepareAssistantCasRefresh } from './assistant-refresh.mjs?v=65491240e0a7';
import { setGoalHolding, setHoldingAllocations, removeHoldingAllocation, goalShare, relinkAfterReplacingHoldings, linkAddedHoldings, summarizeGoalCoverage } from './goals.mjs?v=65491240e0a7';
import { entryOriginFromImport, entryOriginText, valuationOriginText } from './entry-origin.mjs?v=65491240e0a7';
import { buildReviewBackup, parseReviewBackup } from './review-backup.mjs?v=65491240e0a7';
import { prepareReviewHandoff, receiveReviewHandoff } from './review-handoff.mjs?v=65491240e0a7';
import { buildReadableReport } from './readable-report.mjs?v=65491240e0a7';
import { MIX_ASSETS, validMixPlan } from './mix-plan.mjs?v=65491240e0a7';
import { validReserve, reserveMonths } from './reserve.mjs?v=65491240e0a7';
import { contextNeedsReview } from './market-context.mjs?v=65491240e0a7';
import { estimateNavValue, fundNavLookupUrl } from './nav-estimate.mjs?v=65491240e0a7';
import { estimateStockValue, validShares } from './stock-estimate.mjs?v=65491240e0a7';
import { chooseNextReviewStep } from './next-step.mjs?v=65491240e0a7';
import { calculateStraightLineGap, confirmedGoalAssumptions } from './goal-scenario.mjs?v=65491240e0a7';
import { answerReviewQuestion } from './review-questions.mjs?v=65491240e0a7';
import { validCostBasis, rupeesWithPaise } from './cost-basis.mjs?v=65491240e0a7';

function demoGoal() {
  return { id: crypto.randomUUID(), years: 3, target: 2000000, age: 32, name: 'Home down payment', monthlyContribution: 0,
    returnPct: 0, inflationPct: 0, confirmed: false, linkedIds: sampleHoldings.map(holding => holding.id) };
}
function resetExampleGoal(goal) {
  const { assumptionsChecked, equityDropPct, affordableLoss, tolerableLoss,
    emergencyFunding, ...rest } = goal;
  return { ...rest, age: null, years: null, target: null, monthlyContribution: 0,
    returnPct: 0, inflationPct: 0, confirmed: false };
}
const firstGoal = demoGoal();
const state = { holdings: structuredClone(sampleHoldings), source: 'demo', goals: [firstGoal], activeGoalId: firstGoal.id, goal: firstGoal, reserve: null, coverage: null };
let lastReviewQuestion = '';
let currentReviewResult = null;
const coverageLabel = value => ({ all: 'all included', some: 'some still missing', none: 'none owned', unsure: 'unsure' })[value];
const rupees = value => '₹' + Math.round(value).toLocaleString('en-IN');
const $ = selector => document.querySelector(selector);
function renderReviewAnswer() {
  const response = answerReviewQuestion(lastReviewQuestion, { holdings: state.holdings,
    goal: state.goal, goals: state.goals, source: state.source, coverage: state.coverage, reserve: state.reserve,
    result: currentReviewResult });
  $('#review-question-answer').hidden = !response;
  if (!response) return;
  $('#review-answer-text').textContent = response.text;
  $('#review-answer-basis').textContent = response.basis;
  $('#review-answer-limit').textContent = response.limitation;
  const answerLink = $('#review-answer-link');
  answerLink.dataset.reviewAction = response.href;
  answerLink.href = ['#report-help-dialog', '#start-review'].includes(response.href) ?
    '#input-choice' : response.href;
  answerLink.textContent = `${response.action} →`;
  const externalSource = response.href?.startsWith('https://investor.sebi.gov.in/');
  $('#review-answer-link').target = externalSource ? '_blank' : '_self';
  if (externalSource) $('#review-answer-link').rel = 'noopener noreferrer';
  else $('#review-answer-link').removeAttribute('rel');
}
$('#review-answer-link').addEventListener('click', event => {
  const action = event.currentTarget.dataset.reviewAction;
  if (action === '#start-review') {
    event.preventDefault();
    startOwnReview();
  } else if (action === '#report-help-dialog') {
    event.preventDefault();
    const guide = $('.source-guide');
    guide.open = true;
    guide.scrollIntoView({ block: 'center' });
    guide.querySelector('summary').focus({ preventScroll: true });
  } else if (action === '#goal-assumptions') $('#goal-assumptions').open = true;
});
$('#review-question-form').addEventListener('submit', event => {
  event.preventDefault();
  lastReviewQuestion = $('#review-question').value.trim();
  renderReviewAnswer();
});
for (const prompt of document.querySelectorAll('[data-review-question]')) {
  prompt.addEventListener('click', () => {
    $('#review-question').value = prompt.dataset.reviewQuestion;
    $('#review-question-form').requestSubmit();
  });
}
$('#context-goal-link').addEventListener('click', () => { $('#goal-assumptions').open = true; });
$('#deeper-review').open = window.matchMedia('(min-width: 800px)').matches;
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
for (const card of document.querySelectorAll('.market-context-card')) {
  if (!contextNeedsReview(card.dataset.nextReview, indiaToday())) continue;
  card.querySelector('h3').textContent = card.dataset.staleTitle;
  card.querySelector('.market-context-grid').hidden = true;
  const status = card.querySelector('.market-context-status');
  status.textContent = card.dataset.staleMessage;
  status.classList.add('needs-review');
}
function validEnteredDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > indiaToday()) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function createDatedUnitWorksheet(holding) {
  const fund = holding.type === 'Mutual fund';
  const count = fund ? holding.units : holding.shares;
  const prior = fund ? holding.navEstimate : holding.stockEstimate;
  if (state.source !== 'user' || !count || !holding.asOf ||
      (fund && holding.granularity === 'fund_house')) return null;
  const originalValue = prior?.originalValue ?? holding.value;
  const originalDate = prior?.originalAsOf ?? holding.asOf;
  const priceKey = fund ? 'nav' : 'price';
  const dateKey = fund ? 'navAsOf' : 'priceAsOf';
  const unitName = fund ? 'units' : 'shares';
  const estimateValue = fund ? estimateNavValue : estimateStockValue;
  const worksheet = document.createElement('details');
  worksheet.className = 'holding-update nav-worksheet';
  const title = document.createElement('summary');
  title.textContent = fund ? 'Estimate value from a newer NAV' : 'Estimate value from a newer stock price';
  const form = document.createElement('form');
  const intro = document.createElement('p');
  intro.className = 'form-hint';
  intro.textContent = fund ?
    `Original statement: ${count} units, ${rupees(originalValue)} as of ${originalDate}. Check the NAV for this exact scheme, Direct/Regular plan and Growth/IDCW option with the AMC. NAV is dated, not a live price.` :
    `Earlier entered value: ${count} shares, ${rupees(originalValue)} as of ${originalDate}. Check a dated price for the exact listed security and exchange. Splits, bonuses or trades may change your share count.`;
  const source = fund ? document.createElement('p') : null;
  if (source) {
    source.className = 'form-hint';
    const lookup = fundNavLookupUrl(holding.isin);
    if (lookup) {
      const lookupLink = document.createElement('a');
      lookupLink.href = lookup;
      lookupLink.target = '_blank';
      lookupLink.rel = 'noopener noreferrer';
      lookupLink.textContent = 'Search this ISIN on MFnav ↗';
      source.append(lookupLink, document.createTextNode('. Opening it sends only the scheme ISIN to an independent site. Check its plan, option and NAV date with the AMC. '));
    }
    source.append(document.createTextNode(lookup ? 'You can also start on your AMC site or ' :
      'Find the exact scheme and dated NAV on your AMC site or '));
    const link = document.createElement('a');
    link.href = 'https://www.amfiindia.com/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'open AMFI’s home page ↗';
    source.append(link, document.createTextNode('. This AMFI home link sends no holding data.'));
  }
  const priceLabel = document.createElement('label');
  priceLabel.textContent = fund ? 'NAV per unit (₹)' : 'Price per share (₹)';
  const priceInput = document.createElement('input');
  priceInput.type = 'text'; priceInput.inputMode = 'decimal'; priceInput.maxLength = 16;
  priceInput.placeholder = fund ? 'e.g. 125.4321' : 'e.g. 123.45';
  priceInput.value = prior?.[priceKey] || '';
  priceLabel.append(priceInput);
  const dateLabel = document.createElement('label');
  dateLabel.textContent = fund ? 'Published NAV date' : 'Date of this share price';
  const dateInput = document.createElement('input');
  dateInput.type = 'date'; dateInput.max = indiaToday();
  dateInput.value = prior?.[dateKey] || '';
  dateLabel.append(dateInput);
  const confirmation = text => {
    const label = document.createElement('label');
    label.className = 'nav-confirm';
    const input = document.createElement('input');
    input.type = 'checkbox';
    label.append(input, document.createTextNode(` ${text}`));
    return { label, input };
  };
  const identity = confirmation(fund ? 'I checked the exact scheme, plan and option.' :
    'I checked the exact listed security and its price date.');
  const balance = confirmation(fund ? 'I checked that these units are still my current balance.' :
    'I checked my current shares after any trades, splits or bonuses.');
  const preview = document.createElement('p');
  preview.className = 'form-hint'; preview.setAttribute('role', 'status');
  const updatePreview = () => {
    const value = estimateValue(count, priceInput.value.trim());
    preview.textContent = value === null ? `Enter a positive ${fund ? 'NAV' : 'share price'} with up to six decimal places.` :
      `${count} ${unitName} × ₹${priceInput.value.trim()} = ${rupees(value)}. Earlier value: ${rupees(originalValue)} on ${originalDate}. This assumes the ${unitName} are unchanged.`;
  };
  priceInput.addEventListener('input', updatePreview);
  updatePreview();
  const error = document.createElement('p');
  error.className = 'form-error'; error.setAttribute('role', 'alert');
  const apply = document.createElement('button');
  apply.type = 'submit'; apply.className = 'text-button';
  apply.textContent = 'Use this dated estimate in my review';
  form.append(intro, ...(source ? [source] : []), priceLabel, dateLabel, identity.label, balance.label, preview, error, apply);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const price = priceInput.value.trim();
    const priceAsOf = dateInput.value;
    const value = estimateValue(count, price);
    if (value === null || !priceAsOf || !validEnteredDate(priceAsOf) || priceAsOf <= originalDate ||
        !identity.input.checked || !balance.input.checked) {
      error.textContent = `Enter a valid newer ${fund ? 'NAV' : 'share price'} and date, then confirm the exact instrument and current ${unitName}.`;
      return;
    }
    state.holdings = state.holdings.map(item => item.id === holding.id ? {
      ...item, value, asOf: priceAsOf,
      valuationOrigin: undefined,
      ...(fund ? { navEstimate: { originalValue, originalAsOf: originalDate, nav: price, navAsOf: priceAsOf } } :
        { stockEstimate: { originalValue, originalAsOf: originalDate, price, priceAsOf } }),
    } : item);
    render();
    $('#live-status').textContent = `${holding.name}: dated ${fund ? 'NAV' : 'stock-price'} estimate applied. The earlier value remains in the private review backup.`;
  });
  worksheet.append(title, form);
  return worksheet;
}
let pendingImport = null;
let pendingPerformance = new Map();
let brokerRows = null;
let brokerHeaderDate = null;
let brokerSource = 'Broker XLSX';
let accountAuthenticated = false;
let accountPortfolioAccess = false;
let accountEnrollment = null;
let hasSavedPortfolio = false;
let accountRevision = null;
let creatingGoal = false;
let inputMode = 'manual';
let casAvailable = true;
let casMode = 'browser';

function selectGoal(id) {
  const selected = state.goals.find(goal => goal.id === id);
  if (!selected) return;
  state.activeGoalId = id;
  state.goal = selected;
  creatingGoal = false;
  $('#mix-plan-details').hidden = false;
  $('#loss-limits-details').hidden = false;
  $('#cancel-new-goal').hidden = true;
  $('#goal-form button[type="submit"]').textContent = 'Update my view →';
  fillGoalForm(selected);
  render();
}

function fillGoalForm(goal) {
  for (const [selector, value] of [
    ['#age', goal.age], ['#goal-years', goal.years], ['#goal-name', goal.name],
    ['#goal-target', goal.target], ['#monthly-contribution', goal.monthlyContribution ?? 0],
    ['#return-assumption', goal.returnPct ?? 0], ['#inflation-assumption', goal.inflationPct ?? 0],
    ['#equity-drop-assumption', goal.equityDropPct ?? 20],
  ]) $(selector).value = value ?? '';
  $('#form-error').textContent = '';
  fillMixForm(goal);
  $('#affordable-loss').value = goal.affordableLoss ?? '';
  $('#tolerable-loss').value = goal.tolerableLoss ?? '';
  $('#emergency-funding').value = goal.emergencyFunding ?? '';
  $('#loss-limits-error').textContent = '';
}

function fillMixForm(goal) {
  for (const asset of MIX_ASSETS) $(`#mix-${asset.toLowerCase()}`).value = goal.targetMix?.[asset] ?? '';
  $('#mix-plan-error').textContent = '';
}

function fillReserveForm() {
  $('#monthly-essentials').value = state.reserve?.monthlyEssentials ?? '';
  $('#accessible-money').value = state.reserve?.accessibleMoney ?? '';
  $('#reserve-error').textContent = '';
}

$('#reserve-form').addEventListener('submit', event => {
  event.preventDefault();
  const monthlyEssentials = $('#monthly-essentials').value.trim();
  const accessibleMoney = $('#accessible-money').value.trim();
  const reserve = { monthlyEssentials: Number(monthlyEssentials), accessibleMoney: Number(accessibleMoney) };
  if (!monthlyEssentials || !accessibleMoney || !validReserve(reserve)) {
    $('#reserve-error').textContent = 'Enter positive monthly essentials and accessible money of zero or more.';
    return;
  }
  state.reserve = reserve;
  $('#reserve-error').textContent = '';
  render();
});

$('#clear-reserve').addEventListener('click', () => {
  state.reserve = null;
  fillReserveForm();
  render();
});

function renderMixPlan(result, pauseGoalFigures) {
  const container = $('#mix-plan-result');
  container.replaceChildren();
  if (!state.goal.targetMix) {
    container.textContent = 'No mix saved for this goal.';
    return;
  }
  if (pauseGoalFigures) {
    container.textContent = 'Confirm this goal and clear any fictional holdings before comparing your chosen mix.';
    return;
  }
  const rows = result.mixComparison;
  if (!rows) {
    container.textContent = {
      no_holdings: 'Assign holdings to this goal to see the comparison.',
      valuation_dates: 'Comparison paused: check the linked holding values with missing, future or over-90-day valuation dates first.',
      conflicting_identity: 'Comparison paused: holdings sharing an ISIN have conflicting type or asset labels. Correct them before comparing your chosen mix.',
      fund_house: 'Comparison paused: a linked fund-house total is not an individual scheme. Check a detailed statement before comparing your chosen mix.',
      invalid_mix: 'Check that your chosen percentages total 100% before comparing.',
    }[result.mixPause] || (result.mixPause === 'unclassified' ?
      `${rupees(result.goalAssets.Other)} of holdings linked to this goal is labelled Other. Check those holdings against a detailed statement or scheme information before comparing the chosen mix; debt and gold gaps would be unreliable.` :
      'Confirm the goal details before comparing your chosen mix.');
    return;
  }
  const headings = document.createElement('div');
  headings.className = 'mix-plan-row mix-plan-head';
  for (const label of ['Asset', 'Current', 'Your mix', 'Difference']) {
    const cell = document.createElement('span'); cell.textContent = label; headings.append(cell);
  }
  container.append(headings);
  for (const row of rows) {
    const line = document.createElement('div'); line.className = 'mix-plan-row';
    for (const value of [row.asset, `${row.currentPct.toFixed(1)}%`, `${row.plannedPct.toFixed(1)}%`, `${row.differencePct >= 0 ? '+' : ''}${row.differencePct.toFixed(1)} pp`]) {
      const cell = document.createElement('span'); cell.textContent = value; line.append(cell);
    }
    container.append(line);
  }
  const largest = rows.reduce((previous, row) =>
    Math.abs(row.differenceValue) > Math.abs(previous.differenceValue) ? row : previous);
  const summary = document.createElement('p');
  summary.className = 'mix-plan-summary';
  summary.textContent = Math.abs(largest.differenceValue) < 0.5
    ? 'Your entered holdings match this chosen mix to the nearest rupee.'
    : `${largest.asset} is ${rupees(Math.abs(largest.differenceValue))} ${largest.differenceValue > 0 ? 'above' : 'below'} your chosen share of the current ${rupees(result.goalTotal)} linked to this goal. This is a snapshot difference, not a suggested transaction.`;
  container.append(summary);
}

function syncGoalSelector() {
  const select = $('#goal-select');
  select.replaceChildren();
  for (const goal of state.goals) {
    const option = document.createElement('option');
    option.value = goal.id;
    option.textContent = state.source !== 'demo' && goal.confirmed === false ? `${goal.name} (confirm details)` : goal.name;
    select.append(option);
  }
  select.value = state.activeGoalId;
  $('#add-goal').disabled = state.goals.length >= 10;
  $('#delete-goal').disabled = state.goals.length <= 1;
}

function render() {
  $('#hero-review-link').textContent = state.source === 'demo' ? 'Explore the fictional example' : 'Explore your entered review';
  const returnLink = $('#return-guided');
  returnLink.textContent = state.source === 'demo' ? 'Start guided review' : 'Continue in guided chat';
  returnLink.href = './guided-review.html';
  if (state.source === 'demo') {
    returnLink.removeAttribute('target');
    returnLink.removeAttribute('rel');
  }
  $('#holding-date').max = indiaToday();
  syncGoalSelector();
  const needsGoalConfirmation = state.source !== 'demo' && state.goal.confirmed === false;
  const pauseGoalFigures = needsGoalConfirmation;
  const result = analyzePortfolio(state.holdings, pauseGoalFigures ? { ...state.goal, years: 0, target: 0 } : state.goal,
    new Date(), state.reserve, state.source === 'user' ? state.coverage : null);
  currentReviewResult = result;
  renderReviewAnswer();
  const nextStep = chooseNextReviewStep(state);
  $('#review-next-action').hidden = !nextStep;
  if (nextStep) {
    $('#review-next-action-text').textContent = nextStep.text;
    $('#review-next-action-link').href = nextStep.href;
    $('#review-next-action-link').textContent = nextStep.label;
  }
  $('#reserve-check').hidden = state.source !== 'user';
  const months = reserveMonths(state.reserve);
  $('#reserve-result').textContent = months === null ? 'Add both amounts to see months of essential spending covered.' :
    `${rupees(state.reserve.accessibleMoney)} outside entered holdings ÷ ${rupees(state.reserve.monthlyEssentials)} monthly essentials = ${months.toFixed(1)} months. This does not establish an adequate reserve; income stability, debt, dependants and insurance are not assessed.`;
  renderMixPlan(result, pauseGoalFigures);
  $('#portfolio-value').textContent = rupees(result.total);
  $('#portfolio-value-label').textContent = state.source === 'demo' ? 'Example holdings total' : 'Entered holdings total';
  const checkedCost = result.unrealizedChange;
  $('#cost-snapshot').hidden = state.source !== 'user' || !checkedCost.coveredCount;
  $('#cost-invested').textContent = rupeesWithPaise(checkedCost.invested);
  $('#cost-change').textContent = `${checkedCost.change >= 0 ? 'Gain' : 'Loss'} ${rupeesWithPaise(Math.abs(checkedCost.change))}`;
  $('#cost-snapshot-note').textContent = `${checkedCost.coveredCount} of ${state.holdings.length} entered ${state.holdings.length === 1 ? 'holding' : 'holdings'} covered; ${checkedCost.missingCount} excluded. Values dated ${checkedCost.earliestValueDate}${checkedCost.latestValueDate !== checkedCost.earliestValueDate ? ` to ${checkedCost.latestValueDate}` : ''}. This is unrealized change on covered positions, not lifetime profit or annual return.`;
  $('#portfolio-scope').hidden = state.source !== 'user' || !state.holdings.length;
  $('#coverage-summary').hidden = state.source !== 'user' || !state.holdings.length;
  $('#coverage-quick-check').hidden = state.source !== 'user' || !state.holdings.length;
  $('#coverage-details').hidden = state.source !== 'user' || !state.holdings.length;
  $('#coverage-summary').textContent = state.coverage
    ? `Your answer: mutual funds ${coverageLabel(state.coverage.mutualFunds)}; direct stocks ${coverageLabel(state.coverage.directStocks)}; other investments ${coverageLabel(state.coverage.otherInvestments) || 'not answered'}. This is self reported and has not been verified.`
    : 'Coverage not checked yet. This snapshot may be partial.';
  $('#coverage-quick-check').textContent = state.coverage ? 'Update what is included →' : 'Check what is included →';
  $('#coverage-mutual-funds').value = state.coverage?.mutualFunds || '';
  $('#coverage-direct-stocks').value = state.coverage?.directStocks || '';
  $('#coverage-other-investments').value = state.coverage?.otherInvestments || '';
  $('#holding-count').textContent = `${state.holdings.length} ${state.holdings.length === 1 ? 'holding' : 'holdings'}`;
  $('#goal-years-value').textContent = needsGoalConfirmation ? 'Goal details needed' : `${state.goal.years} years`;
  $('#age-at-goal').textContent = pauseGoalFigures ? 'Goal figures paused' : `Age ${Number(state.goal.age) + Number(state.goal.years)} at the goal date`;
  $('#goal-gap').textContent = result.goalGap === null || !result.goalHoldingCount ? '—' : rupees(result.goalGap);
  $('#goal-gap-note').textContent = needsGoalConfirmation ? 'Confirm age, cost and time horizon below.' :
    !result.goalHoldingCount ? 'Link a holding before comparing its value with this target.' :
    result.goalAccessCheck.count ? `Gross entered value; ${rupees(result.goalAccessCheck.value)} of linked savings has no checked access date.` :
      'Simple arithmetic before growth, inflation or tax';
  const straightLineGap = state.source === 'user' && !pauseGoalFigures && result.goalTotal &&
    !result.goalDateCheck.count && !result.goalAccessCheck.count ?
      calculateStraightLineGap(result.goalTotal, state.goal) : null;
  $('#goal-monthly-note').hidden = !straightLineGap;
  $('#goal-monthly-note').textContent = !straightLineGap ? '' : straightLineGap.gapToday > 0 ?
    `Simple monthly gap: ${rupees(straightLineGap.gapToday)} in today's rupees ÷ ${straightLineGap.months} months ≈ ${rupees(straightLineGap.roundedMonthly)} per month, rounded up. Division only; no inflation, returns, taxes, future contributions or missing holdings. This is not an amount to invest.` :
    'The entered value meets or exceeds this target in today’s rupees. Future costs and access to money may differ.';
  $('#goal-setup-note').hidden = !pauseGoalFigures;
  $('#goal-setup-note').textContent = 'Check the goal name and enter your age, goal cost and time horizon before using goal figures.';
  $('#goal-confirm-note').hidden = !needsGoalConfirmation;
  $('#goal-edit-link').href = '#goal-form';
  $('#goal-edit-link').textContent = needsGoalConfirmation ? 'Confirm goal details ↗' : 'Change goal details ↗';
  if (!creatingGoal) $('#goal-form button[type="submit"]').textContent = needsGoalConfirmation ? 'Confirm goal details →' : 'Update my view →';
  $('#goal-assigned').textContent = `${rupees(result.goalTotal)} assigned from ${result.goalHoldingCount} ${result.goalHoldingCount === 1 ? 'holding' : 'holdings'}`;
  $('#goal-mix-summary').textContent = pauseGoalFigures || !result.goalTotal ? '—' :
    `Equity ${pct(result.goalAssets.Equity, result.goalTotal)} · Debt ${pct(result.goalAssets.Debt, result.goalTotal)} · Gold ${pct(result.goalAssets.Gold, result.goalTotal)}` +
    (result.goalAssets.Other ? ` · Other ${pct(result.goalAssets.Other, result.goalTotal)}` : '');
  $('#goal-mix-note').textContent = needsGoalConfirmation ? 'Confirm the goal details before using this mix.' :
    !result.goalTotal ? 'Link holdings below to see their mix for this goal.' :
    result.goalAssets.Other ? 'Other may include unclassified holdings. Verify their asset labels.' :
      'Based only on holdings linked to this goal.';
  $('#goal-date-check').textContent = pauseGoalFigures ? 'Date check paused with the goal figures.' :
    !result.goalTotal ? 'Link holdings to check their valuation dates.' :
    result.goalDateCheck.count ? `${rupees(result.goalDateCheck.value)} of ${rupees(result.goalTotal)} linked value needs a date check (${result.goalDateCheck.count} ${result.goalDateCheck.count === 1 ? 'holding' : 'holdings'}). Missing, future or over 90 days old.` :
      'No linked values have missing, future or over-90-day dates; values are still unverified.';
  const goalCoverage = summarizeGoalCoverage(state.goals, state.activeGoalId, state.holdings);
  $('#goal-coverage-note').textContent = !state.holdings.length ? 'Add holdings below to link them to this goal.' :
    !goalCoverage.elsewhereValue && !goalCoverage.unassignedValue ? 'All entered value is linked to this goal.' :
    `${result.goalHoldingCount} of ${state.holdings.length} holdings contribute here. ${rupees(goalCoverage.elsewhereValue)} is assigned to other goals; ${rupees(goalCoverage.unassignedValue)} is unassigned. Neither amount is included in this goal's figures.`;
  $('#goal-largest-value').textContent = result.largestGoalPosition ?
    `${(result.largestGoalPosition.value / result.goalTotal * 100).toFixed(1)}%` : 'Unknown';
  $('#goal-largest-label').textContent = result.largestGoalPosition?.granularity === 'fund_house' ?
    'Largest fund-house group in this goal' : 'Largest position in this goal';
  $('#goal-largest-note').textContent = result.largestGoalPosition ?
    result.largestGoalPosition.granularity === 'fund_house' ?
      `${result.largestGoalPosition.name} · fund-house total, not one scheme; no fund look-through` :
      `${result.largestGoalPosition.name} · ${result.largestGoalPosition.entries > 1 ? `${result.largestGoalPosition.entries} entries matched by ISIN` : 'one entered holding'}; no fund look-through` :
    'Assign holdings to this goal to see this share';
  $('#coverage').textContent = `${result.classifiedPct.toFixed(0)}%`;
  $('#mix-summary').textContent = `Equity ${result.equityPct.toFixed(0)}% · Debt ${pct(result.assets.Debt, result.total)} · Gold ${pct(result.assets.Gold, result.total)}` +
    (result.assets.Other ? ` · Other ${pct(result.assets.Other, result.total)}` : '');
  const otherFromFundHouse = state.holdings.some(holding => holding.granularity === 'fund_house' && holding.asset === 'Other');
  $('#mix-caveat').hidden = result.assets.Other === 0;
  $('#mix-caveat').textContent = result.assets.Other ?
    `${rupees(result.assets.Other)} is labelled Other. ${otherFromFundHouse ? 'CAMS non-equity totals are not classified as debt or gold here. Check a detailed statement before judging this mix.' : 'Check what these holdings contain before judging this mix.'}` : '';
  $('#summary-asof').textContent = result.asOfSummary;
  $('#goal-title').textContent = needsGoalConfirmation ? 'Set your goal' : state.goal.name;
  const assumptionsReady = state.source === 'demo' || confirmedGoalAssumptions(state.goal);
  const scenario = assumptionsReady && result.goalTotal && !result.goalDateCheck.count ? result.scenario : null;
  $('#scenario-cost').textContent = scenario ? rupees(scenario.futureCost) : '—';
  $('#scenario-value').textContent = scenario ? rupees(scenario.projectedValue) : '—';
  $('#scenario-gap').textContent = scenario ? rupees(scenario.futureGap) : '—';
  $('#scenario-monthly').textContent = scenario ? rupees(Math.ceil(scenario.monthlyAdditionalNeeded)) : '—';
  const shock = pauseGoalFigures ? null : result.shock;
  $('#shock-drop').textContent = shock ? `${shock.dropPct}%` : '—';
  $('#shock-loss').textContent = shock ? rupees(shock.loss) : '—';
  $('#shock-value').textContent = shock ? rupees(shock.valueAfterLoss) : '—';
  $('#shock-gap').textContent = shock ? rupees(shock.gapAfterLoss) : '—';
  $('#shock-note').textContent = needsGoalConfirmation ? 'Confirm goal details to see this illustration.' :
    result.stressPause === 'access_uncertain' ? 'Check when the linked other investments can be used before interpreting this goal stress calculation.' : shock
    ? `This subtracts ${shock.dropPct}% once from only the holdings marked Equity and linked to this goal. It uses today's entered values and goal cost; it excludes future growth, contributions, inflation, taxes and changes in other assets. It is a what-if loss, not a prediction or a target allocation.`
    : 'Enter a valid equity-loss percentage to see this illustration.';
  const shockContinuation = pauseGoalFigures || !assumptionsReady || !result.goalTotal || result.goalDateCheck.count ? null : result.shockContinuation;
  $('#shock-goal-context').hidden = !shockContinuation;
  $('#shock-goal-context').textContent = shockContinuation
    ? `If that fall happened now, then the same ${shockContinuation.returnPct}% growth, ${shockContinuation.inflationPct}% inflation and ${rupees(shockContinuation.monthlyContribution)} monthly contribution assumptions held: the goal-date gap would be ${rupees(shockContinuation.futureGap)} versus ${rupees(scenario.futureGap)} before the fall. The additional monthly amount above your plan would be ${rupees(Math.ceil(shockContinuation.monthlyAdditionalNeeded))} versus ${rupees(Math.ceil(scenario.monthlyAdditionalNeeded))}. This is a fixed-assumption illustration, not a forecast; actual prices, cash flows and costs can differ.`
    : '';
  const limits = result.lossLimits;
  const limitText = (label, check) => check ?
    `${label}: ${rupees(check.limit)}. The illustrated loss ${check.excess > 0 ? `exceeds it by ${rupees(check.excess)}` : 'does not exceed it'}.` : '';
  $('#loss-context').textContent = pauseGoalFigures ? 'Goal figures are paused until the personal holdings and goal details are ready.' :
    !result.goalTotal ? 'Link holdings to this goal before comparing a loss.' :
    !limits?.affordable && !limits?.tolerable ? 'Add your own optional loss limits below to put this illustration in context.' :
      `${limitText('Amount you could cover', limits.affordable)} ${limitText('Amount you could tolerate', limits.tolerable)} ` +
      `${limits.capacityGap !== null ? `The amount you could tolerate is ${rupees(limits.capacityGap)} above the amount you said you could cover. Check whether a loss between those amounts would delay this goal or essential spending. ` : ''}` +
      'This is your own comparison, not a formal risk profile; real losses may be larger.';
  $('#scenario-note').textContent = needsGoalConfirmation ? 'Confirm goal details to see this illustration.' :
    !result.goalTotal ? 'Future illustration paused. Link a confirmed holding to this goal first.' :
    !assumptionsReady ? 'Future illustration paused. Open the goal assumptions below and confirm your monthly amount, growth and inflation choices. Zero is valid when you choose it deliberately.' :
    result.goalAccessCheck.count ? `Future illustration paused: ${rupees(result.goalAccessCheck.value)} of manually entered other investments is linked to this goal, but access by the goal date has not been checked. The gross gap includes them; if none can be used for this goal, the gap in today's rupees would be ${rupees(result.goalGapIfOtherUnavailable)}. This is a what-if bound, not proof that they are locked. Check their terms before relying on the gross gap.` : scenario
    ? `Uses ${scenario.returnPct}% annual growth, ${scenario.inflationPct}% inflation and your planned ${rupees(scenario.monthlyContribution)} in month-end contributions for ${scenario.years} years. The total mathematical monthly amount would be ${rupees(Math.ceil(scenario.monthlyTotalNeeded))}; the number above is only the extra beyond your plan. ${result.flatScenario ? `For comparison, with 0% growth and the same monthly amount and inflation, the goal-date gap would be ${rupees(result.flatScenario.futureGap)}. ` : ''}This arithmetic is illustrative, not a return forecast or investment recommendation. Entered valuations may be dated; taxes, fees and market losses may differ.`
    : result.goalDateCheck.count ? 'Future illustration paused. Check missing, future or over-90-day valuation dates on linked holdings before using these figures.' :
      'Enter valid goal assumptions to see an illustrative scenario.';
  $('#workspace-note').textContent = state.source === 'demo' ? 'Illustrative portfolio · values are entered, not live' : 'Your entries · values are entered, not live';
  $('#holding-form-hint').textContent = `${state.source === 'demo' ? 'Adding your first holding removes the fictional example. ' : ''}New holdings count toward the selected goal. Untick them below to change that. You can add a checked invested amount to an individual holding later. Fund constituents remain unknown until verified data is available.`;
  $('#entry-state').hidden = state.source === 'user';
  $('#entry-state-note').textContent = 'These holdings are fictional. Start blank, then add yours and check the goal details.';
  $('#start-own-review').textContent = state.source === 'user' ? 'Continue detailed review' : 'Use detailed review';
  $('#start-own-review-inline').textContent = 'Start my review';
  $('#panel-foot').textContent = 'These are educational review prompts, not instructions to buy or sell. ' +
    (state.source === 'demo' ? 'The starting example is fictional.' :
      'Your values are used as entered; fund constituent data is not verified here.');

  const mix = $('#mix-bar');
  mix.setAttribute('aria-label', `Portfolio allocation: ${['Equity', 'Debt', 'Gold', 'Other'].map(asset => `${asset} ${pct(result.assets[asset], result.total)}`).join(', ')}`);
  mix.replaceChildren();
  for (const [asset, color] of [['Equity', 'equity'], ['Debt', 'debt'], ['Gold', 'gold'], ['Other', 'other']]) {
    const share = result.total ? result.assets[asset] / result.total * 100 : 0;
    if (!share) continue;
    const part = document.createElement('span');
    part.className = `mix-part ${color}`;
    part.style.width = `${share}%`;
    part.setAttribute('aria-hidden', 'true');
    mix.append(part);
  }

  const findings = $('#finding-list');
  findings.replaceChildren();
  const moreFindings = $('#more-finding-list');
  moreFindings.replaceChildren();
  const morePanel = $('#more-findings');
  morePanel.hidden = result.additionalFindings.length === 0;
  $('#more-findings-label').textContent = `Show ${result.additionalFindings.length} more ${result.additionalFindings.length === 1 ? 'check' : 'checks'}`;
  $('#findings-title').textContent = result.findings.length === 3 ? 'Three things worth a closer look' : result.findings.length === 0 ? 'Add holdings to start your review' : `${result.findings.length} ${result.findings.length === 1 ? 'thing' : 'things'} worth a closer look`;
  $('#panel-counter').textContent = result.findings.length ? `${String(result.findings.length).padStart(2, '0')} REVIEW ${result.findings.length === 1 ? 'ITEM' : 'ITEMS'}` : 'NO HOLDINGS';
  const reviewDestinations = {
    scope: ['#coverage-details', 'Check snapshot coverage'],
    identity: ['#holdings', 'Review holding labels'], summary: ['#input-choice', 'See import choices'],
    'goal-access': ['#holdings', 'Check linked holding access'],
    classification: ['#holdings', 'Check asset categories'],
    valuation: ['#holdings', 'Check entered values'], 'chosen-mix': ['#mix-plan-details', 'Compare my chosen mix'],
    emergency: ['#goal-form', 'Review goal context'], reserve: ['#reserve-check', 'Check accessible money'],
    'loss-capacity': ['#goal-form', 'Review your loss amounts'],
    horizon: ['#goal-form', 'Explore goal timing'], position: ['#holdings', 'Review linked holdings'],
    issuer: ['#holdings', 'Review holdings'], plan: ['#holdings', 'Review fund names'],
    funds: ['#holdings', 'Review fund list'], review: ['#holdings', 'Review holdings'],
  };
  const firstOther = state.holdings.findIndex(holding => holding.asset === 'Other' && holding.granularity !== 'fund_house');
  const firstDateIssue = state.holdings.findIndex(holding => valuationDateIssue(holding.asOf));
  const firstSummary = state.holdings.findIndex(holding => holding.granularity === 'fund_house');
  const firstGoalAccess = state.holdings.findIndex(holding =>
    holding.type === 'Other investment' && goalShare(state.goal, holding.id) > 0);
  if (firstOther >= 0) reviewDestinations.classification = [`#holding-${firstOther + 1}`, 'Check first Other holding'];
  if (firstDateIssue >= 0) reviewDestinations.valuation = [`#holding-${firstDateIssue + 1}`, 'Check first flagged value'];
  if (firstSummary >= 0) reviewDestinations.summary = [`#holding-${firstSummary + 1}`, 'See fund-house summary'];
  if (firstGoalAccess >= 0) reviewDestinations['goal-access'] =
    [`#holding-${firstGoalAccess + 1}`, 'Check linked holding access'];
  const renderFinding = (finding, index, target) => {
    const article = document.createElement('article');
    article.className = 'finding';
    const number = document.createElement('div');
    number.className = 'finding-number';
    number.textContent = `0${index + 1}`;
    const content = document.createElement('div');
    const dot = document.createElement('span');
    dot.className = `finding-label ${finding.tone}`;
    const label = document.createElement('span');
    label.className = 'eyebrow';
    label.textContent = finding.label;
    const title = document.createElement('h3');
    title.textContent = finding.title;
    const detail = document.createElement('p');
    detail.textContent = finding.detail;
    const next = document.createElement('p');
    next.className = 'finding-next';
    const nextLabel = document.createElement('strong');
    nextLabel.textContent = 'Check next: ';
    next.append(nextLabel, document.createTextNode(finding.question));
    const [destination, linkText] = reviewDestinations[finding.key] || ['#holdings', 'Review holdings'];
    const reviewLink = document.createElement('a');
    reviewLink.className = 'finding-review-link';
    reviewLink.href = destination;
    reviewLink.textContent = `${linkText} →`;
    const explanation = document.createElement('details');
    explanation.className = 'finding-basis';
    const explanationTitle = document.createElement('summary');
    explanationTitle.textContent = 'Why this appeared';
    const basis = document.createElement('p');
    basis.textContent = finding.basis;
    const limitation = document.createElement('p');
    limitation.textContent = finding.limitation;
    explanation.append(explanationTitle, basis, limitation);
    content.append(dot, label, title, detail, next, reviewLink, explanation);
    article.append(number, content);
    target.append(article);
  };
  result.findings.forEach((finding, index) => renderFinding(finding, index, findings));
  result.additionalFindings.forEach((finding, index) => renderFinding(finding, index + result.findings.length, moreFindings));

  const holdings = $('#holdings-list');
  holdings.replaceChildren();
  state.holdings.forEach((holding, index) => {
    const row = document.createElement('div');
    row.className = 'holding-row';
    row.id = `holding-${index + 1}`;
    const info = document.createElement('div');
    info.className = 'holding-info';
    const name = document.createElement('strong');
    name.textContent = holding.name;
    const meta = document.createElement('small');
    meta.textContent = `${holding.type} · ${holding.asset} · originally added from ${entryOriginText(holding.entryOrigin)}${holding.valuationOrigin ? ` · latest value from ${valuationOriginText(holding.valuationOrigin)}` : ''}${holding.amc ? ` · ${holding.amc}` : ''}${holding.granularity === 'fund_house' ? ' · fund-house summary' : ''}${holding.isin ? ` · ISIN ${holding.isin}` : ''}${holding.units ? ` · ${holding.units} statement units` : ''}${holding.shares ? ` · ${holding.shares} entered shares` : ''}${holding.costBasis !== undefined ? ` · invested ${rupees(holding.costBasis)} checked ${holding.costBasisAsOf}` : ''}${holding.costBasisAsOf && holding.asOf && holding.costBasisAsOf > holding.asOf ? ' · refresh value before calculating gain or loss' : ''}${holding.navEstimate ? ' · user-entered NAV estimate' : ''}${holding.stockEstimate ? ' · user-entered stock-price estimate' : ''}${holding.expenseRatioPct !== undefined ? ` · TER ${holding.expenseRatioPct}% checked ${holding.expenseRatioAsOf}` : ''}${holding.asOf ? ` · as of ${holding.asOf}` : ' · valuation date unknown'}`;
    const sourceCategory = document.createElement('small');
    sourceCategory.className = 'holding-source-category';
    sourceCategory.textContent = holding.statementCategory ?
      `Statement category: ${holding.statementCategory} · broad asset here: ${holding.asset}` : '';
    const checks = document.createElement('div');
    checks.className = 'holding-checks';
    if (holding.asset === 'Other' && holding.granularity !== 'fund_house') {
      const check = document.createElement('span');
      check.textContent = 'Check asset category';
      checks.append(check);
    }
    const dateIssue = valuationDateIssue(holding.asOf);
    if (dateIssue) {
      const check = document.createElement('span');
      check.textContent = dateIssue === 'stale' ? 'Value over 90 days old' :
        dateIssue === 'future' ? 'Date is after today' : 'Valuation date missing';
      checks.append(check);
    }
    if (holding.granularity === 'fund_house') {
      const check = document.createElement('span');
      check.textContent = 'Fund-house total only';
      checks.append(check);
    }
    const goalLink = document.createElement('label');
    goalLink.className = 'holding-goal-link';
    const goalCheckbox = document.createElement('input');
    goalCheckbox.type = 'checkbox';
    goalCheckbox.checked = goalShare(state.goal, holding.id) > 0;
    goalCheckbox.setAttribute('aria-label', `Count ${holding.name} toward ${state.goal.name}`);
    goalCheckbox.addEventListener('change', () => {
      state.goals = setGoalHolding(state.goals, state.activeGoalId, holding.id, goalCheckbox.checked);
      state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
      render();
    });
    const goalLinkText = document.createElement('span');
    const otherGoal = state.goals.find(goal => goal.id !== state.activeGoalId && goalShare(goal, holding.id) > 0);
    const selectedShare = goalShare(state.goal, holding.id);
    goalLinkText.textContent = selectedShare && selectedShare < 100 ? `${selectedShare}% for this goal` :
      otherGoal ? `Assigned to ${otherGoal.name}` : 'For this goal';
    goalLink.append(goalCheckbox, goalLinkText);
    const allocation = document.createElement('details');
    allocation.className = 'holding-allocation';
    if (state.goals.length > 1) {
      const allocationTitle = document.createElement('summary');
      allocationTitle.textContent = 'Divide this holding between goals';
      const allocationForm = document.createElement('form');
      const allocationHint = document.createElement('p');
      allocationHint.textContent = 'Enter whole percentages. The total can be less than 100%; the rest stays unassigned.';
      allocationForm.append(allocationHint);
      const inputs = new Map();
      for (const goal of state.goals) {
        const label = document.createElement('label');
        label.textContent = `${goal.name} (%)`;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '100';
        input.step = '1';
        input.required = true;
        input.value = String(goalShare(goal, holding.id));
        label.append(input);
        allocationForm.append(label);
        inputs.set(goal.id, input);
      }
      const allocationError = document.createElement('span');
      allocationError.className = 'form-error';
      allocationError.setAttribute('role', 'alert');
      const allocationSave = document.createElement('button');
      allocationSave.type = 'submit';
      allocationSave.className = 'text-button';
      allocationSave.textContent = 'Save goal shares';
      allocationForm.append(allocationError, allocationSave);
      allocationForm.addEventListener('submit', event => {
        event.preventDefault();
        const shares = Object.fromEntries([...inputs].map(([id, input]) => [id, Number(input.value)]));
        try {
          state.goals = setHoldingAllocations(state.goals, holding.id, shares);
          state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
          render();
        } catch (error) { allocationError.textContent = error.message; }
      });
      allocation.append(allocationTitle, allocationForm);
    }
    const update = document.createElement('details');
    update.className = 'holding-update';
    const updateTitle = document.createElement('summary');
    updateTitle.textContent = holding.granularity === 'fund_house' || holding.type === 'Other investment' ? 'Update value or date' :
      holding.type === 'Mutual fund' ? 'Update value, invested amount or fund cost' :
        'Update value, invested amount or details';
    const updateForm = document.createElement('form');
    const valueLabel = document.createElement('label');
    valueLabel.textContent = 'Current value (₹)';
    const valueInput = document.createElement('input');
    valueInput.type = 'number';
    valueInput.inputMode = 'decimal';
    valueInput.min = '1';
    valueInput.max = '10000000000';
    valueInput.step = 'any';
    valueInput.required = true;
    valueInput.value = holding.value;
    valueLabel.append(valueInput);
    const dateLabel = document.createElement('label');
    dateLabel.textContent = 'Date value was checked';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.max = indiaToday();
    dateInput.value = holding.asOf || '';
    dateLabel.append(dateInput);
    let costInput = null;
    let costDateInput = null;
    let costLabel = null;
    let costDateLabel = null;
    let costHint = null;
    if (holding.granularity !== 'fund_house' && holding.type !== 'Other investment') {
      costLabel = document.createElement('label');
      costLabel.textContent = 'Amount invested in units or shares still held (₹; optional)';
      costInput = document.createElement('input');
      costInput.type = 'number'; costInput.inputMode = 'decimal'; costInput.min = '0.01';
      costInput.max = '10000000000'; costInput.step = '0.01';
      costInput.value = holding.costBasis ?? '';
      costLabel.append(costInput);
      costDateLabel = document.createElement('label');
      costDateLabel.textContent = 'Date that invested amount was checked';
      costDateInput = document.createElement('input');
      costDateInput.type = 'date'; costDateInput.max = indiaToday();
      costDateInput.value = holding.costBasisAsOf || '';
      costDateLabel.append(costDateInput);
      costHint = document.createElement('p'); costHint.className = 'form-hint';
      costHint.textContent = 'Use cost for your current units or shares, after any sales or redemptions. Check it against a report. Leave both blank if unsure; changing the ISIN or share count clears the old cost.';
    }
    let sharesInput = null;
    let sharesLabel = null;
    if (holding.type === 'Stock') {
      sharesLabel = document.createElement('label');
      sharesLabel.textContent = 'Shares held (optional)';
      sharesInput = document.createElement('input');
      sharesInput.type = 'text'; sharesInput.inputMode = 'numeric'; sharesInput.maxLength = 9;
      sharesInput.value = holding.shares || '';
      sharesLabel.append(sharesInput);
    }
    const assetLabel = document.createElement('label');
    assetLabel.textContent = 'Asset category';
    const assetInput = document.createElement('select');
    for (const asset of ['Equity', 'Debt', 'Gold', 'Other']) {
      const option = document.createElement('option');
      option.value = asset;
      option.textContent = asset;
      assetInput.append(option);
    }
    assetInput.value = holding.asset;
    assetInput.disabled = holding.type === 'Stock' || holding.type === 'Other investment' || holding.granularity === 'fund_house';
    assetLabel.append(assetInput);
    const assetHint = document.createElement('p');
    assetHint.className = 'form-hint';
    assetHint.textContent = holding.type === 'Stock' ? 'Direct stocks stay in Equity.' :
      holding.type === 'Other investment' ? 'This category follows your description. Remove and add the holding again if its type is wrong.' :
      holding.granularity === 'fund_house' ? 'A fund-house total may contain several asset categories. Use a detailed scheme statement before classifying it.' :
        'Check the scheme objective or original statement before changing its category.';
    let isinInput = null;
    let isinLabel = null;
    let isinHint = null;
    if (holding.granularity !== 'fund_house' && holding.type !== 'Other investment') {
      isinLabel = document.createElement('label');
      isinLabel.textContent = 'ISIN from your statement (optional)';
      isinInput = document.createElement('input');
      isinInput.type = 'text';
      isinInput.maxLength = 12;
      isinInput.spellcheck = false;
      isinInput.autocapitalize = 'characters';
      isinInput.value = holding.isin || '';
      isinLabel.append(isinInput);
      isinHint = document.createElement('p');
      isinHint.className = 'form-hint';
      isinHint.textContent = 'Format checked only. Changing this code removes any linked AMFI code, fund constituent estimate and entered TER.';
    }
    let expenseRatioInput = null;
    let expenseDateInput = null;
    let ratioLabel = null;
    let ratioDateLabel = null;
    let ratioHint = null;
    if (holding.type === 'Mutual fund' && holding.granularity !== 'fund_house') {
      ratioLabel = document.createElement('label');
      ratioLabel.textContent = 'Total expense ratio (TER, % yearly; optional)';
      expenseRatioInput = document.createElement('input');
      expenseRatioInput.type = 'number';
      expenseRatioInput.inputMode = 'decimal';
      expenseRatioInput.min = '0';
      expenseRatioInput.max = '10';
      expenseRatioInput.step = 'any';
      expenseRatioInput.value = holding.expenseRatioPct ?? '';
      ratioLabel.append(expenseRatioInput);
      ratioDateLabel = document.createElement('label');
      ratioDateLabel.textContent = 'Date of that TER';
      expenseDateInput = document.createElement('input');
      expenseDateInput.type = 'date';
      expenseDateInput.max = indiaToday();
      expenseDateInput.value = holding.expenseRatioAsOf || '';
      ratioDateLabel.append(expenseDateInput);
      ratioHint = document.createElement('p');
      ratioHint.className = 'form-hint';
      ratioHint.textContent = 'Use the rate for this exact scheme and Direct or Regular plan. Check the latest AMC or AMFI disclosure. Leave both fields blank if unsure.';
    }
    isinInput?.addEventListener('input', () => {
      if (expenseRatioInput && isinInput.value.trim().toUpperCase() !== (holding.isin || '')) {
        expenseRatioInput.value = '';
        expenseDateInput.value = '';
      }
    });
    const updateError = document.createElement('p');
    updateError.className = 'form-error';
    updateError.setAttribute('role', 'alert');
    const updateButton = document.createElement('button');
    updateButton.type = 'submit';
    updateButton.className = 'text-button';
    updateButton.textContent = 'Save holding changes';
    updateForm.append(valueLabel, dateLabel);
    if (costLabel) updateForm.append(costLabel, costDateLabel, costHint);
    if (sharesLabel) updateForm.append(sharesLabel);
    updateForm.append(assetLabel, assetHint);
    if (isinLabel) updateForm.append(isinLabel, isinHint);
    if (ratioLabel) updateForm.append(ratioLabel, ratioDateLabel, ratioHint);
    updateForm.append(updateError, updateButton);
    updateForm.addEventListener('submit', event => {
      event.preventDefault();
      const value = Number(valueInput.value);
      const asOf = dateInput.value;
      const asset = assetInput.value;
      const isin = isinInput?.value.trim().toUpperCase() || '';
      const expenseRatio = expenseRatioInput?.value.trim() || '';
      const expenseDate = expenseDateInput?.value || '';
      const shares = sharesInput?.value.trim() || '';
      const costAmount = costInput?.value.trim() || '';
      const costChecked = costDateInput?.value || '';
      if (!Number.isFinite(value) || value <= 0 || value > 1e10 || !validEnteredDate(asOf)) {
        updateError.textContent = 'Enter a positive value and a valid date no later than today.';
        return;
      }
      if (!['Equity', 'Debt', 'Gold', 'Other'].includes(asset) ||
          ((holding.type === 'Stock' || holding.type === 'Other investment' || holding.granularity === 'fund_house') && asset !== holding.asset)) {
        updateError.textContent = 'Check the asset category against the source before saving.';
        return;
      }
      if (isin && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
        updateError.textContent = 'Check the 12-character ISIN against your statement, or leave it blank.';
        return;
      }
      if (shares && !validShares(shares)) {
        updateError.textContent = 'Enter a positive whole share count of at most nine digits, or leave it blank.';
        return;
      }
      if (costInput && (costAmount || costChecked) &&
          (!costAmount || !costChecked || !validCostBasis(Number(costAmount), costChecked))) {
        updateError.textContent = 'Enter a positive invested amount in rupees and paise with its checked date, or leave both blank.';
        return;
      }
      if (expenseRatioInput && ((expenseRatio !== '' && (!Number.isFinite(Number(expenseRatio)) ||
          Number(expenseRatio) < 0 || Number(expenseRatio) > 10 || !expenseDate || !validEnteredDate(expenseDate))) ||
          (expenseRatio === '' && expenseDate))) {
        updateError.textContent = 'Enter both a TER from 0% to 10% and its checked date, or leave both blank.';
        return;
      }
      if (holding.navEstimate && (asset !== holding.asset || isin !== (holding.isin || '')) &&
          value === holding.value && (asOf || null) === (holding.asOf || null)) {
        updateError.textContent = 'After changing scheme details, enter a newly checked value and date before saving.';
        return;
      }
      if (holding.stockEstimate && (shares !== (holding.shares || '') || isin !== (holding.isin || '')) &&
          value === holding.value && (asOf || null) === (holding.asOf || null)) {
        updateError.textContent = 'After changing shares or security details, enter a newly checked value and date before saving.';
        return;
      }
      state.holdings = state.holdings.map(item => {
        if (item.id !== holding.id) return item;
        const identifierChanged = isinInput && isin !== (item.isin || '');
        const updated = { ...item, value, asOf: asOf || null, asset,
          ...((asset !== item.asset || (identifierChanged && item.type === 'Mutual fund')) ? { exposure: null } : {}) };
        if (value !== item.value || (asOf || null) !== (item.asOf || null) || asset !== item.asset || identifierChanged)
          delete updated.navEstimate;
        if (value !== item.value || (asOf || null) !== (item.asOf || null)) {
          if (item.type !== 'Other investment') updated.valuationOrigin = 'manual';
        } else if (identifierChanged) delete updated.valuationOrigin;
        if (value !== item.value || (asOf || null) !== (item.asOf || null) || identifierChanged ||
            shares !== (item.shares || '')) delete updated.stockEstimate;
        if (sharesInput) {
          if (shares) updated.shares = shares;
          else delete updated.shares;
        }
        if (costInput) {
          if (costAmount && !identifierChanged && shares === (item.shares || '')) {
            updated.costBasis = Number(costAmount);
            updated.costBasisAsOf = costChecked;
          } else {
            delete updated.costBasis;
            delete updated.costBasisAsOf;
          }
        }
        if (identifierChanged) delete updated.statementCategory;
        if (isinInput) {
          if (isin) updated.isin = isin;
          else delete updated.isin;
          if (identifierChanged) delete updated.amfi;
        }
        if (expenseRatioInput) {
          if (expenseRatio !== '') {
            updated.expenseRatioPct = Number(expenseRatio);
            updated.expenseRatioAsOf = expenseDate;
          } else {
            delete updated.expenseRatioPct;
            delete updated.expenseRatioAsOf;
          }
        }
        return updated;
      });
      render();
    });
    update.append(updateTitle, updateForm);
    const unitWorksheet = createDatedUnitWorksheet(holding);
    info.append(name, meta);
    const priorEstimate = holding.navEstimate || holding.stockEstimate;
    if (priorEstimate) {
      const earlier = document.createElement('small');
      earlier.className = 'holding-source-category';
      earlier.textContent = `Earlier value: ${rupees(priorEstimate.originalValue)} on ${priorEstimate.originalAsOf}. Current review uses your entered ${holding.navEstimate ? 'NAV' : 'stock-price'} estimate, not a verified live balance.`;
      info.append(earlier);
    }
    if (holding.statementCategory) info.append(sourceCategory);
    if (checks.childElementCount) info.append(checks);
    info.append(goalLink);
    if (state.goals.length > 1) info.append(allocation);
    info.append(update);
    if (unitWorksheet) info.append(unitWorksheet);
    const amount = document.createElement('strong');
    amount.className = 'holding-amount';
    amount.textContent = rupees(holding.value);
    const remove = document.createElement('button');
    remove.className = 'remove-button';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${holding.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.holdings = state.holdings.filter(h => h.id !== holding.id);
      state.coverage = null;
      state.goals = removeHoldingAllocation(state.goals, holding.id);
      state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
      render();
    });
    row.append(info, amount, remove);
    holdings.append(row);
  });
  $('#empty-message').hidden = state.holdings.length !== 0;
  const pendingGoals = state.goals.filter(goal => goal.confirmed !== true);
  const showNextStep = state.source === 'user' && state.holdings.length > 0 && pendingGoals.length > 0;
  $('#goal-next-step').hidden = !showNextStep;
  if (showNextStep) {
    const selectedPending = state.goal.confirmed !== true;
    $('#goal-next-step-text').textContent = selectedPending ?
      'Your holdings are entered. Check the goal name, then enter your age, goal cost and time horizon to see its figures and readable analysis. You can already download a private JSON backup.' :
      `${pendingGoals.length} ${pendingGoals.length === 1 ? 'other goal needs' : 'other goals need'} details before its figures and readable analysis are available. Choose a goal above, then enter its details.`;
    $('#goal-next-step-link').href = selectedPending ? '#goal-form' : '#goals';
    $('#goal-next-step-link').textContent = selectedPending ? 'Enter my goal details →' : 'Choose a goal →';
  }

  const fundA = state.holdings.find(h => h.id === 'broad');
  const fundB = state.holdings.find(h => h.id === 'growth');
  const overlap = fundA && fundB ? overlapPercent(fundA.exposure, fundB.exposure) : null;
  $('#overlap-value').textContent = overlap === null ? 'Unknown' : `At least ${overlap.toFixed(0)}%`;
  $('#overlap-note').textContent = overlap === null ? 'Verified constituent data is needed for your fund pairs' : `${fundA.name} + ${fundB.name}`;
  $('#issuer-value').textContent = result.largestIssuer ? `${(result.largestIssuer[1] / result.total * 100).toFixed(1)}%+` : 'Unknown';
  const issuerSources = result.largestIssuerSources;
  const directRoute = issuerSources?.stocks > 1 ? 'multiple direct stock entries' : 'direct stock';
  const issuerRoute = issuerSources?.funds && issuerSources?.stocks ? `${directRoute} + visible fund holdings` :
    issuerSources?.funds ? 'visible fund holdings' : directRoute;
  $('#issuer-note').textContent = result.largestIssuer ? `${result.largestIssuer[0]} · ${issuerRoute}` : 'Fund constituent data is missing';
  $('#amc-value').textContent = result.largestAmc && result.fundValue ? `${(result.largestAmc.value / result.fundValue * 100).toFixed(0)}%+` : 'Unknown';
  $('#amc-note').textContent = result.largestAmc ? `${result.largestAmc.name} · ${pct(result.amcCoveredValue, result.fundValue)} of fund value has known fund houses` : 'Fund-house names are missing';
  $('#plan-value').textContent = !result.fundValue ? 'No funds entered' : result.fundPlans.Regular ?
    `${rupees(result.fundPlans.Regular)} Regular` : result.fundPlans.Direct ? `${rupees(result.fundPlans.Direct)} Direct` : 'Unknown';
  $('#plan-note').textContent = result.fundValue ?
    `${rupees(result.fundPlans.Direct)} labelled Direct · ${rupees(result.fundPlans.Regular)} labelled Regular · ${rupees(result.fundPlans.Unclear)} unclear. Names only; check current expense ratios and services.` :
    'Add a mutual fund to review its plan label.';
  $('#fund-cost-value').textContent = result.fundCost.coveredValue ?
    `${result.fundCost.weightedPct.toFixed(2)}% on covered funds` : 'No rates entered';
  $('#fund-cost-note').textContent = result.fundCost.coveredValue ?
    `${rupees(result.fundCost.coveredValue)} of ${rupees(result.fundValue)} fund value has a dated rate you entered. ${rupees(result.fundCost.annualIllustration)} is a one-year illustration at unchanged value and rate, already reflected in NAV rather than an extra bill.` :
    'Enter a dated, plan-specific TER on an individual fund below to estimate cost coverage.';
  $('#coverage-note').textContent = result.classifiedPct < 100 ? 'Unknown fund constituents are excluded from this measure' : 'All entered value has named issuer coverage';
  $('#live-status').textContent = `Review updated. ${state.holdings.length} holdings, ${result.findings.length + result.additionalFindings.length} review items.`;
  const hasPersonalHoldings = state.source === 'user' && state.holdings.length > 0;
  $('#download-review').disabled = !hasPersonalHoldings;
  $('#download-readable').disabled = !hasPersonalHoldings;
  updateAccountActions();
}

function pct(value, total) { return total ? `${(value / total * 100).toFixed(0)}%` : '0%'; }

$('#mix-plan-form').addEventListener('submit', event => {
  event.preventDefault();
  const values = MIX_ASSETS.map(asset => $(`#mix-${asset.toLowerCase()}`).value);
  const plan = Object.fromEntries(MIX_ASSETS.map((asset, index) => [asset, Number(values[index])]));
  if (values.some(value => value.trim() === '') || !validMixPlan(plan)) {
    $('#mix-plan-error').textContent = 'Enter four percentages from 0 to 100 that total exactly 100%.';
    return;
  }
  $('#mix-plan-error').textContent = '';
  state.goal = { ...state.goal, targetMix: plan };
  state.goals = state.goals.map(goal => goal.id === state.activeGoalId ? state.goal : goal);
  render();
});
$('#clear-mix').addEventListener('click', () => {
  state.goal = { ...state.goal };
  delete state.goal.targetMix;
  state.goals = state.goals.map(goal => goal.id === state.activeGoalId ? state.goal : goal);
  fillMixForm(state.goal);
  render();
});
$('#loss-limits-form').addEventListener('submit', event => {
  event.preventDefault();
  const read = selector => $(selector).value.trim() === '' ? undefined : Number($(selector).value);
  const affordableLoss = read('#affordable-loss');
  const tolerableLoss = read('#tolerable-loss');
  if ([affordableLoss, tolerableLoss].some(value => value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > 1e10))) {
    $('#loss-limits-error').textContent = 'Enter whole-rupee amounts from ₹0 to ₹10,00,00,00,000, or leave either blank.';
    return;
  }
  $('#loss-limits-error').textContent = '';
  state.goal = { ...state.goal };
  delete state.goal.affordableLoss;
  delete state.goal.tolerableLoss;
  if (affordableLoss !== undefined) state.goal.affordableLoss = affordableLoss;
  if (tolerableLoss !== undefined) state.goal.tolerableLoss = tolerableLoss;
  state.goals = state.goals.map(goal => goal.id === state.activeGoalId ? state.goal : goal);
  render();
});

$('#goal-form').addEventListener('submit', event => {
  event.preventDefault();
  const years = Number($('#goal-years').value);
  const target = Number($('#goal-target').value);
  const age = Number($('#age').value);
  const optionalNumber = (selector, fallback) => $(selector).value.trim() === '' ? fallback : Number($(selector).value);
  const monthlyContribution = optionalNumber('#monthly-contribution', 0);
  const returnPct = optionalNumber('#return-assumption', 0);
  const inflationPct = optionalNumber('#inflation-assumption', 0);
  const equityDropPct = optionalNumber('#equity-drop-assumption', 20);
  const emergencyFunding = $('#emergency-funding').value;
  if (['#age', '#goal-years', '#goal-target'].some(selector => !$(selector).value.trim()) ||
      !Number.isInteger(years) || years < 1 || years > 50 || !Number.isFinite(target) || target < 1000 || target > 1e12 ||
      !Number.isFinite(age) || age < 18 || age > 100 || !Number.isFinite(monthlyContribution) || monthlyContribution < 0 || monthlyContribution > 1e8 ||
      !Number.isFinite(returnPct) || returnPct < -20 || returnPct > 13 || !Number.isFinite(inflationPct) || inflationPct < -5 || inflationPct > 15 ||
      !Number.isFinite(equityDropPct) || equityDropPct < 0 || equityDropPct > 60) {
    $('#form-error').textContent = 'Check the age, goal, monthly amount and assumption ranges shown beside the fields.';
    return;
  }
  $('#form-error').textContent = '';
  const assumptionsOpen = $('#goal-assumptions').open;
  const checked = assumptionsOpen ? { monthlyContribution: true, returnPct: true, inflationPct: true } :
    creatingGoal ? null : state.goal.assumptionsChecked;
  const details = { name: $('#goal-name').value.trim() || 'My goal', years, target, age, monthlyContribution, returnPct, inflationPct,
    ...(checked ? { assumptionsChecked: { ...checked } } : {}),
    ...(assumptionsOpen ? { equityDropPct } : {}), confirmed: true };
  if (emergencyFunding) details.emergencyFunding = emergencyFunding;
  if (creatingGoal) {
    const added = { id: crypto.randomUUID(), ...details, linkedIds: [] };
    state.goals.push(added);
    state.activeGoalId = added.id;
    state.goal = added;
    creatingGoal = false;
    $('#cancel-new-goal').hidden = true;
    $('#goal-form button[type="submit"]').textContent = 'Update my view →';
    $('#mix-plan-details').hidden = false;
    $('#loss-limits-details').hidden = false;
    fillMixForm(added);
  } else {
    state.goal = { ...state.goal, ...details };
    if (!emergencyFunding) delete state.goal.emergencyFunding;
    state.goals = state.goals.map(goal => goal.id === state.activeGoalId ? state.goal : goal);
  }
  render();
  $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#goal-select').addEventListener('change', event => selectGoal(event.target.value));
$('#add-goal').addEventListener('click', () => {
  if (state.goals.length >= 10) return;
  creatingGoal = true;
  $('#mix-plan-details').hidden = true;
  $('#loss-limits-details').hidden = true;
  $('#goal-confirm-note').hidden = true;
  $('#goal-name').value = '';
  $('#goal-years').value = '10';
  $('#goal-target').value = '';
  $('#age').value = state.goal.age ?? '';
  $('#monthly-contribution').value = '0';
  $('#return-assumption').value = '0';
  $('#inflation-assumption').value = '0';
  $('#equity-drop-assumption').value = '20';
  $('#emergency-funding').value = '';
  $('#affordable-loss').value = '';
  $('#tolerable-loss').value = '';
  $('#loss-limits-error').textContent = '';
  $('#form-error').textContent = '';
  $('#cancel-new-goal').hidden = false;
  $('#goal-form button[type="submit"]').textContent = 'Create goal →';
  $('#goal-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#goal-name').focus({ preventScroll: true });
});
$('#cancel-new-goal').addEventListener('click', () => selectGoal(state.activeGoalId));
$('#delete-goal').addEventListener('click', () => {
  if (state.goals.length <= 1 || !window.confirm(`Remove ${state.goal.name} and its holding links?`)) return;
  state.goals = state.goals.filter(goal => goal.id !== state.activeGoalId);
  selectGoal(state.goals[0].id);
});

$('#holding-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#holding-name').value.trim();
  const value = Number($('#holding-value').value);
  const asOf = $('#holding-date').value;
  const asset = $('#holding-asset').value;
  const type = $('#holding-type').value;
  const isin = $('#holding-isin').value.trim().toUpperCase();
  const shares = $('#holding-shares').value.trim();
  if (!['Equity', 'Debt', 'Gold', 'Other'].includes(asset)) {
    $('#holding-error').textContent = 'Choose the fund asset category, or choose Other / not sure if you need to check it later.';
    $('#holding-asset').focus();
    return;
  }
  if (!name || name.length > 80 || !Number.isFinite(value) || value <= 0 || value > 1e10 ||
      (type === 'Stock' && asset !== 'Equity') || !validEnteredDate(asOf)) {
    $('#holding-error').textContent = 'Enter a name, a positive value, and a date no later than today if supplied.';
    return;
  }
  if (isin && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
    $('#holding-error').textContent = 'Check the 12-character ISIN against your statement, or leave it blank.';
    return;
  }
  if (type === 'Stock' && shares && !validShares(shares)) {
    $('#holding-error').textContent = 'Enter a positive whole share count of at most nine digits, or leave it blank.';
    return;
  }
  if (type === 'Mutual fund' && state.source === 'user' &&
      state.holdings.some(holding => holding.type === 'Mutual fund' && holding.granularity === 'fund_house')) {
    $('#holding-error').textContent = 'This review already has fund-house totals that could include this fund. Replace those totals with a detailed CAS, or remove them before adding individual funds.';
    return;
  }
  $('#holding-error').textContent = '';
  const added = { id: crypto.randomUUID(), name, type, asset, value, asOf: asOf || null, entryOrigin: 'manual',
    ...(isin ? { isin } : {}), ...(type === 'Stock' && shares ? { shares } : {}),
    exposure: type === 'Stock' ? { [name]: 1 } : null };
  if (state.source === 'user') {
    if (state.holdings.length >= 500 || state.holdings.reduce((sum, holding) => sum + holding.value, value) > 1e12) {
      $('#holding-error').textContent = 'This review has reached its holding count or total value limit.';
      return;
    }
    const duplicate = possibleManualDuplicate(state.holdings, added);
    if (duplicate && !window.confirm(`“${name}” may already be counted as “${duplicate.name}”. Is this a separate position from another account or folio? Add it only if its value is not already included above.`)) return;
  }
  if (state.source === 'demo') clearCurrentReview();
  state.holdings.push(added);
  state.coverage = null;
  state.goals = setGoalHolding(state.goals, state.activeGoalId, added.id, true);
  state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
  event.target.reset();
  $('#holding-asset').disabled = false;
  $('#stock-shares-field').hidden = true;
  render();
});

$('#holding-type').addEventListener('change', () => {
  const stock = $('#holding-type').value === 'Stock';
  $('#holding-asset').value = stock ? 'Equity' : '';
  $('#holding-asset').disabled = stock;
  $('#stock-shares-field').hidden = !stock;
  if (!stock) $('#holding-shares').value = '';
});

$('#coverage-quick-check').addEventListener('click', () => {
  $('#coverage-details').open = true;
  $('#coverage-details').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#coverage-mutual-funds').focus({ preventScroll: true });
});
$('#review-next-action-link').addEventListener('click', () => {
  if ($('#review-next-action-link').getAttribute('href') === '#coverage-details') $('#coverage-details').open = true;
  if ($('#review-next-action-link').getAttribute('href') === '#goal-assumptions') $('#goal-assumptions').open = true;
});

$('#coverage-form').addEventListener('submit', event => {
  event.preventDefault();
  const mutualFunds = $('#coverage-mutual-funds').value;
  const directStocks = $('#coverage-direct-stocks').value;
  const otherInvestments = $('#coverage-other-investments').value;
  if (!['all', 'some', 'none', 'unsure'].includes(mutualFunds) ||
      !['all', 'some', 'none', 'unsure'].includes(directStocks) ||
      !['all', 'some', 'none', 'unsure'].includes(otherInvestments) ||
      mutualFunds === 'none' && state.holdings.some(holding => holding.type === 'Mutual fund') ||
      directStocks === 'none' && state.holdings.some(holding => holding.type === 'Stock') ||
      otherInvestments === 'none' && state.holdings.some(holding => holding.type === 'Other investment')) {
    $('#coverage-error').textContent = 'Answer all three questions and check “I own none” against the holdings above.';
    return;
  }
  $('#coverage-error').textContent = '';
  state.coverage = { mutualFunds, directStocks, otherInvestments };
  render();
});

function clearCurrentReview() {
  pendingImport = null;
  pendingPerformance.clear();
  $('#import-preview').hidden = true;
  state.holdings = [];
  state.coverage = null;
  state.reserve = null;
  fillReserveForm();
  const fromExample = state.source === 'demo';
  state.goals = state.goals.map(({ allocationPct: ignored, ...goal }) => ({
    ...(fromExample ? resetExampleGoal(goal) : goal), linkedIds: [] }));
  state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
  state.source = 'user';
  if (fromExample) fillGoalForm(state.goal);
  render();
}

function showInputMode(mode) {
  if (!['manual', 'active', 'broker', 'csv', 'cas'].includes(mode) || (mode === 'cas' && !casAvailable)) return;
  if (mode !== inputMode) {
    $('#active-file').value = '';
    $('#active-password').value = '';
    $('#active-password').disabled = false;
    $('#cas-file').value = '';
    $('#cas-password').value = '';
    $('#broker-file').value = '';
    $('#csv-file').value = '';
    brokerRows = null;
    brokerHeaderDate = null;
    $('#broker-date').value = '';
    $('#broker-map').hidden = true;
    for (const selector of ['#active-error', '#broker-error', '#cas-error', '#import-error']) $(selector).textContent = '';
  }
  inputMode = mode;
  $('#holding-form').hidden = mode !== 'manual';
  $('#holding-form').parentElement.classList.toggle('single-column', mode !== 'manual');
  for (const [name, selector] of [['active', '#active-import'], ['broker', '#broker-import'],
    ['csv', '#csv-import'], ['cas', '#cas-local']]) $(selector).hidden = mode !== name || (name === 'cas' && !casAvailable);
  for (const button of document.querySelectorAll('#input-choice [data-input]')) {
    button.setAttribute('aria-pressed', String(button.dataset.input === mode));
  }
}

document.querySelectorAll('#input-choice [data-input]').forEach(button => button.addEventListener('click', () => {
  const mode = button.dataset.input;
  if (mode !== inputMode && pendingImport) {
    if (!window.confirm('Discard the current import preview and choose another source?')) return;
    pendingImport = null;
    pendingPerformance.clear();
    $('#import-preview').hidden = true;
  }
  showInputMode(mode);
  if (mode === 'manual') $('#holding-name').focus();
}));

function startOwnReview() {
  if (state.source !== 'user') clearCurrentReview();
  showInputMode('manual');
  $('#input-choice').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#choose-manual').focus({ preventScroll: true });
}

$('#start-own-review').addEventListener('click', startOwnReview);
$('#start-own-review-inline').addEventListener('click', startOwnReview);
$('#reset-demo').addEventListener('click', () => {
  if (state.source !== 'demo' && (state.holdings.length || state.reserve) &&
      !window.confirm('Replace your current holdings, goals and reserve context with the fictional example? Download a review file first if you want to keep them.')) return;
  pendingImport = null;
  pendingPerformance.clear();
  $('#import-preview').hidden = true;
  state.holdings = structuredClone(sampleHoldings);
  state.coverage = null;
  state.reserve = null;
  fillReserveForm();
  state.goals = [demoGoal()];
  state.source = 'demo';
  selectGoal(state.goals[0].id);
  showInputMode('manual');
});
$('#clear-all').addEventListener('click', () => {
  if (state.source !== 'demo' && (state.holdings.length || state.reserve) &&
      !window.confirm('Clear all holdings, goal links and reserve context in this tab? Download a review file first if you want to keep them.')) return;
  clearCurrentReview();
  showInputMode('manual');
});
$('#csv-file').addEventListener('change', async event => {
  pendingImport = null;
  pendingPerformance.clear();
  $('#import-preview').hidden = true;
  $('#import-error').textContent = '';
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 1_000_000 || !file.name.toLowerCase().endsWith('.csv')) {
    $('#import-error').textContent = 'Choose a .csv file smaller than 1 MB.';
    return;
  }
  let result;
  try { result = parseHoldingsCsv(await file.text()); }
  catch { $('#import-error').textContent = 'The file could not be read in this browser.'; return; }
  if (result.errors.length) {
    $('#import-error').textContent = result.errors.slice(0, 5).join(' ');
    return;
  }
  showImportPreview(result.holdings, 'CSV', []);
});

$('#broker-file').addEventListener('change', () => {
  brokerRows = null;
  brokerHeaderDate = null;
  $('#broker-date').value = '';
  $('#broker-map').hidden = true;
  $('#broker-error').textContent = '';
});

function fillBrokerColumns(index) {
  const headers = brokerRows[index] || [];
  const guess = suggestBrokerColumns([headers]);
  for (const [id, selected] of [['broker-name', guess.name], ['broker-value', guess.value],
    ['broker-isin', guess.isin], ['broker-cost', guess.cost]]) {
    const select = $(`#${id}`);
    select.replaceChildren();
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = id === 'broker-isin' ? 'No ISIN column' :
      id === 'broker-cost' ? 'No invested amount column' : 'Choose a column';
    select.append(blank);
    headers.forEach((header, column) => {
      const option = document.createElement('option');
      option.value = String(column);
      option.textContent = `Column ${column + 1}: ${String(header ?? '').trim().slice(0, 70) || '(blank)'}`;
      select.append(option);
    });
    select.value = selected;
  }
}

$('#broker-header').addEventListener('change', event => fillBrokerColumns(Number(event.target.value)));
$('#broker-read').addEventListener('click', async () => {
  pendingImport = null;
  pendingPerformance.clear();
  brokerRows = null;
  brokerHeaderDate = null;
  $('#import-preview').hidden = true;
  $('#broker-map').hidden = true;
  $('#broker-error').textContent = '';
  const file = $('#broker-file').files?.[0];
  const button = $('#broker-read');
  button.disabled = true;
  button.textContent = 'Reading in this tab…';
  try {
    if (!file) throw new Error('Choose a broker holdings XLSX or CSV report.');
    if (file.name.toLowerCase().endsWith('.csv')) {
      if (file.size > 1_000_000) throw new Error('Choose a broker CSV smaller than 1 MB.');
      brokerRows = parseBrokerCsvRows(await file.text());
      brokerSource = 'Broker CSV';
    } else if (file.name.toLowerCase().endsWith('.xlsx')) {
      const { readBrokerWorkbook } = await import('./broker-xlsx-browser.mjs?v=65491240e0a7');
      brokerRows = await readBrokerWorkbook(file);
      brokerSource = 'Broker XLSX';
    } else throw new Error('Choose a broker holdings XLSX or CSV report.');
    const suggested = suggestBrokerColumns(brokerRows);
    const datedHeading = detectBrokerHoldingsDate(brokerRows, suggested.headerIndex);
    if (datedHeading.error) throw new Error(datedHeading.error);
    brokerHeaderDate = datedHeading.date;
    if (brokerHeaderDate) {
      if ($('#broker-date').value && $('#broker-date').value !== brokerHeaderDate)
        throw new Error('The entered valuation date differs from the holdings-as-of date printed in this report. Check the file.');
      $('#broker-date').value = brokerHeaderDate;
    }
    const select = $('#broker-header');
    select.replaceChildren();
    for (let index = 0; index < Math.min(brokerRows.length, 15); index++) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `Row ${index + 1}`;
      select.append(option);
    }
    select.value = String(suggested.headerIndex);
    fillBrokerColumns(suggested.headerIndex);
    $('#broker-map').hidden = false;
  } catch (error) {
    $('#broker-error').textContent = error?.message || 'The report could not be read in this browser.';
  } finally {
    button.disabled = false;
    button.textContent = 'Read report in this tab';
  }
});

$('#broker-preview').addEventListener('click', () => {
  $('#broker-error').textContent = '';
  if (!brokerRows) return;
  if (brokerHeaderDate && $('#broker-date').value !== brokerHeaderDate) {
    $('#broker-error').textContent = 'The valuation date differs from the holdings-as-of date printed in this report. Check the file.';
    $('#import-preview').hidden = true;
    return;
  }
  const selected = id => $(id).value === '' ? null : Number($(id).value);
  const result = parseBrokerHoldingsRows(brokerRows, Number($('#broker-header').value),
    { name: selected('#broker-name'), value: selected('#broker-value'), isin: selected('#broker-isin'),
      cost: selected('#broker-cost') },
    $('#broker-date').value, { strictWidth: brokerSource === 'Broker CSV' });
  if (result.errors.length) {
    $('#broker-error').textContent = result.errors.join(' ');
    $('#import-preview').hidden = true;
    return;
  }
  showImportPreview(result.holdings, brokerSource, result.notices);
});

function showImportPreview(holdings, label, notices, performance = []) {
  const entryOrigin = entryOriginFromImport(label);
  pendingImport = holdings.map(holding => ({ ...holding, ...(entryOrigin ? { entryOrigin } : {}) }));
  pendingPerformance = new Map(performance.map(item => [item.id, item.annualPercent]));
  $('#cas-performance-note').hidden = label !== 'CAS';
  if (!label.startsWith('Broker ')) $('#broker-map').hidden = true;
  $('#import-preview').dataset.source = label;
  $('#refresh-changes').open = false;
  $('#replace-impact').open = false;
  renderImportRows();
  $('#import-preview').hidden = false;
  $('#live-status').textContent = `${label} ready to review: ${holdings.length} holdings.`;
  const noticeList = $('#import-notices');
  noticeList.replaceChildren();
  notices.forEach(message => {
    const item = document.createElement('li');
    item.textContent = message;
    noticeList.append(item);
  });
}

const omitOverlapsButton = document.createElement('button');
omitOverlapsButton.type = 'button';
omitOverlapsButton.className = 'button button-outline';
omitOverlapsButton.hidden = true;
$('#merge-import').after(omitOverlapsButton);
const omitOverlapsNote = document.createElement('p');
omitOverlapsNote.className = 'form-hint';
omitOverlapsNote.hidden = true;
$('#merge-validation').after(omitOverlapsNote);
omitOverlapsButton.addEventListener('click', () => {
  if (!pendingImport || validateImportReview(pendingImport).length || state.source !== 'user') return;
  const overlaps = findImportMergeConflicts(state.holdings, pendingImport);
  if (!overlaps.length || overlaps.length === pendingImport.length) return;
  const omittedValue = overlaps.reduce((sum, item) => sum + Number(item.holding.value), 0);
  if (!window.confirm(`Leave out ${overlaps.length} matching ${overlaps.length === 1 ? 'row' : 'rows'} worth ${rupees(omittedValue)} and keep ${pendingImport.length - overlaps.length} for import? Matching ISINs, codes or names may be separate account positions. Check the original reports and use this only when those rows represent investments already in your review.`)) return;
  const omitted = new Set(overlaps.map(item => item.index));
  pendingImport = pendingImport.filter((_, index) => !omitted.has(index));
  renderImportRows();
  $('#live-status').textContent = `${overlaps.length} matching ${overlaps.length === 1 ? 'row was' : 'rows were'} left out of the preview. Check the remaining rows, then choose Add to my holdings.`;
});

function refreshImportSummary() {
  const count = pendingImport?.length || 0;
  const total = pendingImport?.reduce((sum, holding) => sum + Number(holding.value), 0) ?? 0;
  const label = $('#import-preview').dataset.source || 'imported';
  const unclassifiedDemat = label === 'Demat CAS' ?
    pendingImport.filter(row => row.entryOrigin === 'demat_cas' && !row.type && !row.asset) : [];
  $('#demat-batch').hidden = unclassifiedDemat.length === 0;
  $('#demat-batch-count').textContent = `${unclassifiedDemat.length} unclassified demat ${unclassifiedDemat.length === 1 ? 'row needs' : 'rows need'} a holding type.`;
  $('#import-summary').textContent = `${count} ${label} ${count === 1 ? 'holding' : 'holdings'} · ${Number.isFinite(total) ? rupees(total) : 'value needs correction'}`;
  const errors = validateImportReview(pendingImport);
  $('#import-validation').textContent = errors.join(' ');
  $('#confirm-import').disabled = errors.length > 0;
  const canAdd = state.source === 'user' && state.holdings.length > 0;
  $('#replace-impact').hidden = !canAdd;
  const replaceList = $('#replace-impact-list');
  replaceList.replaceChildren();
  if (canAdd) {
    const oldTotal = state.holdings.reduce((sum, holding) => sum + Number(holding.value), 0);
    $('#replace-impact-summary').textContent = `Replace will remove ${state.holdings.length} current ${state.holdings.length === 1 ? 'holding' : 'holdings'} (${rupees(oldTotal)}) and their goal links`;
    for (const holding of state.holdings) {
      const item = document.createElement('li');
      item.textContent = `${holding.name} · ${holding.type} · ${rupees(holding.value)}`;
      replaceList.append(item);
    }
  }
  const mergeButton = $('#merge-import');
  const mergeValidation = $('#merge-validation');
  mergeButton.hidden = !canAdd;
  const mergeErrors = canAdd && !errors.length ? validateImportMerge(state.holdings, pendingImport) : [];
  mergeButton.disabled = errors.length > 0 || mergeErrors.length > 0;
  mergeValidation.hidden = !canAdd || mergeErrors.length === 0;
  mergeValidation.textContent = mergeErrors.join(' ');
  const overlaps = canAdd && !errors.length ? findImportMergeConflicts(state.holdings, pendingImport) : [];
  omitOverlapsButton.hidden = !overlaps.length || overlaps.length === count || errors.length > 0;
  omitOverlapsNote.hidden = omitOverlapsButton.hidden;
  if (!omitOverlapsButton.hidden) {
    const omittedValue = overlaps.reduce((sum, item) => sum + Number(item.holding.value), 0);
    omitOverlapsButton.textContent = `Leave out ${overlaps.length} matching ${overlaps.length === 1 ? 'row' : 'rows'}`;
    omitOverlapsNote.textContent = `${overlaps.length} matching ${overlaps.length === 1 ? 'row' : 'rows'} (${rupees(omittedValue)}) may already be included. Check they belong to the same positions before leaving them out. The remaining ${count - overlaps.length} ${count - overlaps.length === 1 ? 'row' : 'rows'} will stay in the preview for your review; nothing is imported yet.`;
  }
  const repeated = label === 'Active Statement' && canAdd &&
    isRepeatedActiveStatement(state.holdings, pendingImport);
  const refresh = label === 'Active Statement' && canAdd && !repeated ?
    planActiveStatementRefresh(state.holdings, pendingImport) : null;
  const brokerOrigin = entryOriginFromImport(label);
  const brokerRefresh = canAdd && ['broker_xlsx', 'broker_csv'].includes(brokerOrigin) ?
    planBrokerReportRefresh(state.holdings, pendingImport, brokerOrigin) : null;
  const dematRefresh = canAdd && label === 'Demat CAS' && !errors.length ?
    planDematCasRefresh(state.holdings, pendingImport) : null;
  const casRefresh = canAdd && label === 'CAS' && !errors.length ?
    prepareAssistantCasRefresh({ version: 2, holdings: state.holdings, goals: state.goals,
      coverage: state.coverage }, pendingImport, { detailed: true }) : null;
  const casError = casRefresh?.errors?.join(' ');
  $('#refresh-statement').hidden = !refresh && !repeated && !brokerRefresh && !dematRefresh &&
    (!casRefresh || casError);
  $('#refresh-explanation').hidden = !refresh && !repeated && !brokerRefresh && !dematRefresh &&
    !casRefresh;
  $('#refresh-changes').hidden = !refresh && !brokerRefresh && !dematRefresh?.changed.length &&
    !casRefresh?.changes?.length;
  const changeList = $('#refresh-change-list');
  changeList.replaceChildren();
  if (repeated) {
    $('#refresh-statement').textContent = 'Keep my review — no changes';
    $('#refresh-explanation').textContent = `These ${count} fund rows already match the statement date and values in your review, including scheme units where available. Keep existing goal links, any added fund details and direct stocks.`;
  }
  if (refresh) {
    $('#refresh-changes summary').textContent = 'Review fund changes before updating';
    const estimateCount = state.holdings.filter(holding => holding.type === 'Mutual fund' && holding.navEstimate).length;
    if (estimateCount) $('#refresh-changes').open = true;
    $('#refresh-statement').textContent = refresh.added.length || refresh.removed.length ?
      'Update funds from this statement' : 'Refresh matched funds';
    $('#refresh-explanation').textContent = `${refresh.updatedCount} matched fund ${refresh.updatedCount === 1 ? 'row' : 'rows'} will update; ` +
      `${refresh.added.length} new fund ${refresh.added.length === 1 ? 'row' : 'rows'} will be added; ` +
      `${refresh.removed.length} fund ${refresh.removed.length === 1 ? 'row' : 'rows'} absent from the newer statement will be removed. ` +
      'Direct stocks and links for matched funds stay in place. New funds link to the selected goal.' +
      (estimateCount ? ` ${estimateCount} user-entered NAV ${estimateCount === 1 ? 'estimate' : 'estimates'} will be replaced by statement values. Download a private JSON backup first if you want to keep the earlier comparison.` : '');
    const change = message => {
      const row = document.createElement('li');
      row.textContent = message;
      changeList.append(row);
    };
    for (const holding of refresh.removed)
      change(`Absent: ${holding.name} · ${rupees(holding.value)} as of ${holding.asOf}. This row and its goal links will be removed.`);
    for (const holding of refresh.added)
      change(`New: ${holding.name} · ${rupees(holding.value)} as of ${holding.asOf}. This row will link to the selected goal.`);
    const oldById = new Map(state.holdings.map(holding => [holding.id, holding]));
    for (const holding of refresh.holdings.filter(item => item.type === 'Mutual fund')) {
      const old = oldById.get(holding.id);
      const units = old.units && holding.units ? ` · units ${old.units} → ${holding.units}` : '';
      const estimateNote = old.navEstimate ? ` The NAV estimate dated ${old.navEstimate.navAsOf} will be removed; this statement follows the original statement dated ${old.navEstimate.originalAsOf}.` : '';
      change(`Matched: ${holding.name} · ${rupees(old.value)} as of ${old.asOf} → ${rupees(holding.value)} as of ${holding.asOf}${units}. Goal links stay in place.${estimateNote}`);
    }
  }
  if (brokerRefresh) {
    $('#refresh-changes summary').textContent = 'Review matched positions before updating';
    $('#refresh-changes').open = true;
    $('#refresh-statement').textContent = 'Refresh matched positions';
    $('#refresh-explanation').textContent = `${brokerRefresh.matched.length} exact ISIN ${brokerRefresh.matched.length === 1 ? 'match' : 'matches'} can receive the newer dated value. ` +
      `${brokerRefresh.skipped} report ${brokerRefresh.skipped === 1 ? 'row is' : 'rows are'} unmatched and will not be added. ` +
      'No existing holding will be removed. Use this only for a newer view of the same account and positions; another account may hold the same ISIN. Goal links stay in place. A prior unit or share count and any manual price estimate will be cleared because this report does not verify them. Old invested amounts clear; only newly checked report amounts replace them.' +
      (brokerRefresh.skipped ? ' Your self-reported portfolio coverage answer will clear for review.' : '');
    for (const { current, next } of brokerRefresh.matched) {
      const row = document.createElement('li');
      row.textContent = `${current.name} · ISIN ${current.isin} · ${rupees(current.value)} as of ${current.asOf} → ${rupees(next.value)} as of ${next.asOf}. Goal links stay in place.`;
      changeList.append(row);
    }
  }
  if (dematRefresh) {
    $('#refresh-statement').textContent = dematRefresh.repeated ?
      dematRefresh.skipped && state.coverage ? 'Keep values; recheck coverage' :
        'Keep my review — no changes' : 'Refresh matched demat positions';
    $('#refresh-explanation').textContent = dematRefresh.repeated ?
      `The ${dematRefresh.matched.length} matched positions already use these dated values and fund units. ${dematRefresh.skipped} unmatched rows stay out. No holdings or goal links change.${dematRefresh.skipped && state.coverage ? ' Your self-reported coverage answer will clear for review.' : ''}` :
      `${dematRefresh.changed.length} matched demat ${dematRefresh.changed.length === 1 ? 'position' : 'positions'} will use newer dated values. ${dematRefresh.skipped} unmatched ${dematRefresh.skipped === 1 ? 'row stays' : 'rows stay'} out. Confirm this is the same account and positions. No holding is removed and goal links stay. Earlier estimates, share counts and checked invested costs on updated rows clear; fund units update from the statement.${dematRefresh.skipped ? ' Your self-reported coverage answer will clear for review.' : ''}`;
    if (dematRefresh.changed.length) {
      $('#refresh-changes summary').textContent = 'Review demat positions before updating';
      $('#refresh-changes').open = true;
      for (const { current, next } of dematRefresh.changed) {
        const row = document.createElement('li');
        row.textContent = `${current.name} · ISIN ${current.isin} · ${rupees(current.value)} as of ${current.asOf} → ${rupees(next.value)} as of ${next.asOf}${current.type === 'Mutual fund' ? ` · units ${current.units} → ${next.units}` : ''}. Goal links stay in place.`;
        changeList.append(row);
      }
    }
  }
  if (casRefresh) {
    $('#refresh-statement').textContent = casRefresh.scopeOnly ? 'Keep values; recheck coverage' :
      casRefresh.repeated ? 'Keep my review — no changes' : 'Refresh matched CAS schemes';
    $('#refresh-explanation').textContent = casError || casRefresh.description;
    if (casRefresh.changes?.length) {
      $('#refresh-changes summary').textContent = 'Review matched schemes before updating';
      $('#refresh-changes').open = true;
      for (const change of casRefresh.changes) {
        const row = document.createElement('li');
        row.textContent = change;
        changeList.append(row);
      }
    }
  }
}

$('#demat-batch-stock').addEventListener('click', () => {
  if (!pendingImport || $('#import-preview').dataset.source !== 'Demat CAS') return;
  const rows = pendingImport.filter(row => row.entryOrigin === 'demat_cas' && !row.type && !row.asset);
  if (!rows.length || !window.confirm(`Have you checked all ${rows.length} unclassified demat ${rows.length === 1 ? 'row' : 'rows'} in the original statement and confirmed they are ordinary company shares? ETFs, REITs and other securities need individual review. No holdings will be imported yet.`)) return;
  for (const row of rows) { row.type = 'Stock'; row.asset = 'Equity'; }
  renderImportRows();
});

function renderImportRows() {
  const list = $('#import-rows');
  list.replaceChildren();
  const broker = $('#import-preview').dataset.source.startsWith('Broker ');
  const demat = $('#import-preview').dataset.source === 'Demat CAS';
  pendingImport.forEach((holding, index) => {
    const item = document.createElement('li');
    item.className = 'import-row';
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const metadata = document.createElement('p');
    metadata.className = 'import-row-meta';
    const refreshMetadata = () => {
      const parts = [];
      if (holding.amc) parts.push(`Fund house: ${holding.amc}`);
      if (holding.isin) parts.push(`ISIN as supplied: ${holding.isin}`);
      if (holding.amfi) parts.push(`AMFI code: ${holding.amfi}`);
      if (holding.units) parts.push(`Statement units: ${holding.units}`);
      if (holding.statementCategory) parts.push(`Statement category: ${holding.statementCategory}`);
      if (holding._costCandidate !== undefined) parts.push(`${holding.costBasis !== undefined ? 'Checked' : 'Unconfirmed'} report invested amount: ${rupees(holding._costCandidate)} as of ${holding._costCandidateAsOf}`);
      if (pendingPerformance.has(holding.id)) parts.push(`Indicative statement-period XIRR: ${pendingPerformance.get(holding.id).toFixed(2)}% a year`);
      if (holding.granularity === 'fund_house') parts.push('Fund-house summary, not an individual scheme');
      metadata.textContent = parts.length ? parts.join(' · ') : 'No fund-house or instrument identifier supplied.';
    };
    refreshMetadata();
    const rowSummary = () => {
      summary.textContent = `${holding.name || 'Unnamed holding'} — ${holding.type || 'choose type'}, ${holding.asset || 'choose asset'}, ${Number.isFinite(Number(holding.value)) ? rupees(holding.value) : 'check value'}${holding.asOf ? ` as of ${holding.asOf}` : ''}${holding._costCandidate !== undefined ? ` · invested amount ${holding.costBasis !== undefined ? 'checked' : 'to check'}` : ''}`;
    };
    rowSummary();
    const fields = document.createElement('div');
    fields.className = 'import-row-fields';
    const field = (labelText, control) => {
      const label = document.createElement('label');
      label.textContent = labelText;
      label.append(control);
      fields.append(label);
    };
    const name = document.createElement('input');
    name.type = 'text'; name.maxLength = 200; name.value = holding.name;
    name.disabled = holding.granularity === 'fund_house';
    name.addEventListener('input', () => {
      if (name.value !== holding.name) { holding.name = name.value; holding.isin = null; holding.amfi = null; delete holding.statementCategory; pendingPerformance.delete(holding.id); refreshMetadata(); }
      rowSummary(); refreshImportSummary();
    });
    field('Fund or stock name', name);
    const value = document.createElement('input');
    value.type = 'number'; value.min = '0.01'; value.max = '10000000000'; value.step = '0.01'; value.value = holding.value;
    value.addEventListener('input', () => { holding.value = value.value === '' ? NaN : Number(value.value); pendingPerformance.delete(holding.id); refreshMetadata(); rowSummary(); refreshImportSummary(); });
    field('Current value (₹)', value);
    if (broker || demat) {
      const type = document.createElement('select');
      for (const label of ['Choose type', 'Stock', 'Mutual fund']) {
        const option = document.createElement('option');
        option.value = label === 'Choose type' ? '' : label;
        option.textContent = label;
        type.append(option);
      }
      type.value = holding.type || '';
      type.disabled = demat && holding.type === 'Mutual fund';
      type.addEventListener('change', () => {
        holding.type = type.value || null;
        holding.asset = type.value === 'Stock' ? 'Equity' : null;
        asset.value = holding.asset || '';
        asset.disabled = !holding.type || holding.type === 'Stock';
        rowSummary(); refreshImportSummary();
      });
      field('Holding type', type);
    }
    const asset = document.createElement('select');
    if (broker || demat && !holding.type) {
      const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Choose asset'; asset.append(blank);
    }
    for (const optionText of ['Equity', 'Debt', 'Gold', 'Other']) {
      const option = document.createElement('option'); option.value = optionText; option.textContent = optionText; asset.append(option);
    }
    asset.value = holding.asset || '';
    asset.disabled = holding.type === 'Stock' || ((broker || demat) && !holding.type);
    asset.addEventListener('change', () => {
      const previous = holding.asset;
      holding.asset = asset.value || null;
      if (previous && previous !== holding.asset) { holding.isin = null; holding.amfi = null; pendingPerformance.delete(holding.id); }
      refreshMetadata(); rowSummary(); refreshImportSummary();
    });
    field('Asset category', asset);
    const date = document.createElement('input');
    date.type = 'date'; date.value = holding.asOf || '';
    date.addEventListener('input', () => { holding.asOf = date.value || null; pendingPerformance.delete(holding.id); refreshMetadata(); rowSummary(); refreshImportSummary(); });
    field('Valuation date', date);
    if (broker && holding._costCandidate !== undefined) {
      const label = document.createElement('label');
      label.className = 'broker-cost-check';
      const confirmCost = document.createElement('input');
      confirmCost.type = 'checkbox';
      confirmCost.checked = holding.costBasis !== undefined;
      confirmCost.addEventListener('change', () => {
        if (confirmCost.checked) {
          holding.costBasis = holding._costCandidate;
          holding.costBasisAsOf = holding._costCandidateAsOf;
        } else {
          delete holding.costBasis;
          delete holding.costBasisAsOf;
        }
        refreshMetadata(); rowSummary(); refreshImportSummary();
      });
      label.append(confirmCost, document.createTextNode(` I checked that ${rupees(holding._costCandidate)} is the invested amount for the units or shares still held on ${holding._costCandidateAsOf}.`));
      fields.append(label);
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'text-button muted'; remove.textContent = 'Leave out this holding';
    remove.addEventListener('click', () => { pendingImport.splice(index, 1); renderImportRows(); });
    fields.append(remove);
    details.append(summary, metadata, fields);
    item.append(details);
    list.append(item);
  });
  refreshImportSummary();
}

$('#active-file').addEventListener('change', () => {
  const html = /\.html?$/i.test($('#active-file').files?.[0]?.name || '');
  $('#active-password').value = '';
  $('#active-password').disabled = html;
});

$('#preview-active').addEventListener('click', async () => {
  pendingImport = null;
  pendingPerformance.clear();
  $('#import-preview').hidden = true;
  $('#active-error').textContent = '';
  const file = $('#active-file').files?.[0];
  const password = $('#active-password').value;
  const button = $('#preview-active');
  button.disabled = true;
  button.textContent = 'Reading in this tab…';
  try {
    const { previewActiveStatementFile } = await import('./active-statement-pdf.mjs?v=65491240e0a7');
    const result = await previewActiveStatementFile(file, password);
    if (result.errors.length) {
      $('#active-error').textContent = result.errors.slice(0, 5).join(' ');
      return;
    }
    showImportPreview(result.holdings, 'Active Statement', result.notices);
  } catch {
    $('#active-error').textContent = 'The Active Statement preview failed in this browser.';
  } finally {
    $('#active-password').value = '';
    $('#active-password').disabled = false;
    $('#active-file').value = '';
    button.disabled = false;
    button.textContent = 'Preview statement';
  }
});

fetch('/api/cas/status', { cache: 'no-store' }).then(response => response.ok ? response.json() : null)
  .then(info => {
    if (info?.local === true) {
      casMode = 'local';
      showInputMode(inputMode);
      $('#cas-eyebrow').textContent = 'LOCAL CAS PREVIEW';
      $('#cas-description').textContent = 'The PDF and password go only to the preview server on this computer. They are not saved in project files or sent to the hosted service. Review the extracted holdings before replacing the example.';
    } else if (info?.available === true) {
      casMode = 'private';
      showInputMode(inputMode);
      $('#cas-eyebrow').textContent = 'PRIVATE CAS PREVIEW';
      $('#cas-description').textContent = 'Your signed-in server processes the PDF and password for this request. It returns a holdings preview and does not save the original PDF or password. Review every row before replacing your entries.';
      $('#cas-help').textContent = 'Up to 15 MB. Original CAMS, KFintech, NSDL or CDSL statements only. Demat statements with bonds or NPS cannot be imported yet. No Gmail connection is used. Preview attempts are limited.';
    }
  }).catch(() => {});

$('#preview-cas').addEventListener('click', async () => {
  pendingImport = null;
  pendingPerformance.clear();
  $('#import-preview').hidden = true;
  $('#cas-error').textContent = '';
  const file = $('#cas-file').files?.[0];
  const password = $('#cas-password').value;
  if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size > 15_000_000 ||
      (casMode !== 'browser' && !password)) {
    $('#cas-error').textContent = 'Choose an original PDF smaller than 15 MB and enter its password if required.';
    return;
  }
  const button = $('#preview-cas');
  button.disabled = true;
  button.textContent = casMode === 'browser' ? 'Reading in this browser…' : 'Reading privately…';
  let keepFile = false;
  try {
    let result;
    let responseOk = true;
    if (casMode === 'browser') {
      const { previewBrowserCas } = await import('./cas-browser.mjs?v=65491240e0a7');
      result = await previewBrowserCas(file, password);
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const response = await fetch('/api/cas/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json',
          'X-Thefinxperts-Local': '1', 'X-Thefinxperts-Intent': 'cas-preview' },
        body: JSON.stringify({ pdf: btoa(binary), password }),
      });
      responseOk = response.ok;
      result = await response.json();
    }
    if (!responseOk || result.errors?.length || !Array.isArray(result.holdings)) {
      $('#cas-error').textContent = result.errors?.slice(0, 5).join(' ') || result.error || 'The CAS could not be read.';
      keepFile = casMode === 'browser' && /password did not open/i.test($('#cas-error').textContent);
      return;
    }
    showImportPreview(result.holdings, result.source || 'CAS', result.notices || [], result.performance || []);
  } catch {
    $('#cas-error').textContent = 'The CAS preview failed. Try again later.';
  } finally {
    $('#cas-password').value = '';
    if (!keepFile) $('#cas-file').value = '';
    button.disabled = false;
    button.textContent = 'Preview CAS holdings';
  }
});
function applyImport(mode) {
  if (!pendingImport || validateImportReview(pendingImport).length) return;
  if (mode === 'refresh') {
    const origin = entryOriginFromImport($('#import-preview').dataset.source);
    if (state.source === 'user' && origin === 'cas') {
      const refresh = prepareAssistantCasRefresh({ version: 2, holdings: state.holdings,
        goals: state.goals, coverage: state.coverage }, pendingImport, { detailed: true });
      if (!refresh || refresh.errors?.length) return;
      if (!refresh.repeated && !window.confirm(refresh.description)) return;
      if (refresh.portfolio) {
        state.holdings = refresh.portfolio.holdings;
        state.coverage = refresh.portfolio.coverage || null;
      }
      pendingImport = null;
      pendingPerformance.clear();
      $('#cas-file').value = '';
      $('#cas-password').value = '';
      $('#import-preview').hidden = true;
      render();
      $('#live-status').textContent = refresh.repeated ?
        'Matched CAS values and fund units already match this review. No holdings or goal links changed.' :
        refresh.result;
      $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (state.source === 'user' && origin === 'demat_cas') {
      const refresh = planDematCasRefresh(state.holdings, pendingImport);
      if (!refresh) return;
      if (!refresh.repeated && !window.confirm(`Refresh ${refresh.changed.length} matched demat ${refresh.changed.length === 1 ? 'position' : 'positions'}? Confirm this is the same account and positions, not another account with the same ISIN. ${refresh.skipped} unmatched ${refresh.skipped === 1 ? 'row stays' : 'rows stay'} out. Earlier estimates, share counts and invested costs on updated rows clear. Goal links stay.`)) return;
      if (refresh.repeated && refresh.skipped && state.coverage &&
          !window.confirm(`The matched demat values are unchanged, but ${refresh.skipped} unmatched ${refresh.skipped === 1 ? 'row is' : 'rows are'} left out. Confirm this is the same account and clear your earlier portfolio coverage answer for review?`)) return;
      if (!refresh.repeated) {
        state.holdings = refresh.holdings;
      }
      if (refresh.skipped) state.coverage = null;
      pendingImport = null;
      pendingPerformance.clear();
      $('#cas-file').value = '';
      $('#cas-password').value = '';
      $('#import-preview').hidden = true;
      render();
      $('#live-status').textContent = refresh.repeated ?
        `These matched demat positions already use the same dated values and fund units. No holdings or goal links changed.${refresh.skipped ? ' Recheck what your portfolio includes.' : ''}` :
        `${refresh.changed.length} matched demat positions refreshed. ${refresh.skipped} unmatched rows left out. Goal links kept; check the newer dated values and fund units.${refresh.skipped ? ' Recheck what your portfolio includes.' : ''}`;
      $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (state.source === 'user' && ['broker_xlsx', 'broker_csv'].includes(origin)) {
      const refresh = planBrokerReportRefresh(state.holdings, pendingImport, origin);
      if (!refresh || !window.confirm(`Refresh ${refresh.matched.length} matched ${refresh.matched.length === 1 ? 'position' : 'positions'} from this newer broker report? Confirm this is the same account and positions, not another account or an extra lot. ${refresh.skipped} unmatched report ${refresh.skipped === 1 ? 'row will' : 'rows will'} be left out. No holding will be removed, and matched goal links will stay. Old invested amounts clear; only newly checked report amounts replace them.`)) return;
      state.holdings = refresh.holdings;
      if (refresh.skipped) state.coverage = null;
      pendingImport = null;
      pendingPerformance.clear();
      $('#broker-file').value = '';
      brokerRows = null;
      brokerHeaderDate = null;
      $('#broker-date').value = '';
      $('#broker-map').hidden = true;
      $('#import-preview').hidden = true;
      render();
      $('#live-status').textContent = `${refresh.matched.length} matched positions refreshed from the broker report. ${refresh.skipped} unmatched rows left out. Goal links kept. Old invested amounts cleared unless a new report amount was checked.${refresh.skipped ? ' Recheck what your portfolio includes.' : ''}`;
      $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (state.source !== 'user' || $('#import-preview').dataset.source !== 'Active Statement') return;
    if (isRepeatedActiveStatement(state.holdings, pendingImport)) {
      pendingImport = null;
      pendingPerformance.clear();
      $('#active-file').value = '';
      $('#active-password').value = '';
      $('#import-preview').hidden = true;
      $('#live-status').textContent = 'This Active Statement is already in the review. No holdings or goal links changed.';
      $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const refresh = planActiveStatementRefresh(state.holdings, pendingImport);
    if (!refresh) return;
    if (refresh.removed.length && !window.confirm(`${refresh.removed.length} existing fund ${refresh.removed.length === 1 ? 'row is' : 'rows are'} absent from this newer statement. Remove those rows and their goal links? Check the statement is complete before continuing.`)) return;
    const added = refresh.added.map(holding => ({ ...holding, id: crypto.randomUUID(), exposure: null }));
    state.holdings = [...refresh.holdings, ...added];
    state.coverage = null;
    state.goals = refresh.removed.reduce((goals, holding) =>
      removeHoldingAllocation(goals, holding.id), state.goals);
    if (added.length) state.goals = linkAddedHoldings(state.goals, state.activeGoalId, added);
    state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
    pendingImport = null;
    pendingPerformance.clear();
    $('#active-file').value = '';
    $('#active-password').value = '';
    $('#import-preview').hidden = true;
    render();
    $('#live-status').textContent = `${refresh.updatedCount} fund rows updated, ${added.length} added, ${refresh.removed.length} removed. Direct stocks kept. Recheck invested amounts for updated funds.`;
    $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (mode === 'add' && (state.source !== 'user' || !state.holdings.length || validateImportMerge(state.holdings, pendingImport).length)) return;
  if (mode === 'replace' && state.source === 'user' && state.holdings.length &&
      !window.confirm(`Replace ${state.holdings.length} current ${state.holdings.length === 1 ? 'holding' : 'holdings'} and remove their goal links? This also removes any direct stocks not in the new preview. Download a private backup first if you want to keep this review.`)) return;
  const imported = pendingImport.map(holding => {
    const name = holding.name.trim();
    const { _costCandidate, _costCandidateAsOf, ...checked } = holding;
    return { ...checked, name, id: crypto.randomUUID(), exposure: holding.type === 'Stock' ? { [name]: 1 } : null };
  });
  const fromExample = mode === 'replace' && state.source === 'demo';
  if (fromExample) state.goals = state.goals.map(resetExampleGoal);
  state.goals = mode === 'add'
    ? linkAddedHoldings(state.goals, state.activeGoalId, imported)
    : relinkAfterReplacingHoldings(state.goals, state.activeGoalId, imported);
  state.holdings = mode === 'add' ? [...state.holdings, ...imported] : imported;
  state.coverage = null;
  state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
  state.source = 'user';
  if (fromExample) fillGoalForm(state.goal);
  pendingImport = null;
  pendingPerformance.clear();
  $('#csv-file').value = '';
  $('#broker-file').value = '';
  brokerRows = null;
  brokerHeaderDate = null;
  $('#broker-date').value = '';
  $('#broker-map').hidden = true;
  $('#import-preview').hidden = true;
  render();
  $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#confirm-import').addEventListener('click', () => applyImport('replace'));
$('#merge-import').addEventListener('click', () => applyImport('add'));
$('#refresh-statement').addEventListener('click', () => applyImport('refresh'));
$('#cancel-import').addEventListener('click', () => {
  pendingImport = null;
  pendingPerformance.clear();
  $('#csv-file').value = '';
  $('#broker-file').value = '';
  brokerRows = null;
  brokerHeaderDate = null;
  $('#broker-date').value = '';
  $('#broker-map').hidden = true;
  $('#import-preview').hidden = true;
});

function updateAccountActions() {
  if (!accountAuthenticated || !accountPortfolioAccess) return;
  const unconfirmedGoals = state.goals.some(goal => goal.confirmed === false);
  $('#account-save').disabled = accountRevision === null || state.source !== 'user' || state.holdings.length === 0;
  $('#account-description').textContent = unconfirmedGoals && state.source === 'user'
    ? 'Save your holdings and unfinished goal details now; goal figures stay paused until you confirm them. Original CAS PDFs and passwords are not saved.' : state.source === 'user'
    ? 'Save normalized holdings and goal inputs for later. Original CAS PDFs and passwords are not saved.'
    : 'Clear the fictional example or import your own holdings before saving. Original CAS PDFs and passwords are not saved.';
  $('#account-load').hidden = !hasSavedPortfolio;
  $('#account-export').hidden = !hasSavedPortfolio;
  $('#account-delete').hidden = !hasSavedPortfolio;
}

function applyPortfolio(portfolio) {
  let candidate = portfolio;
  if (portfolio?.version === 1 && Array.isArray(portfolio.holdings) && portfolio.goal) {
    const holdings = portfolio.holdings.map(holding => ({ ...holding, id: holding.id || crypto.randomUUID() }));
    const goal = { ...portfolio.goal, id: crypto.randomUUID(),
      linkedIds: Array.isArray(portfolio.goal.linkedIds) ? portfolio.goal.linkedIds : holdings.map(holding => holding.id) };
    candidate = { version: 2, holdings, goals: [goal], activeGoalId: goal.id };
  }
  const parsed = parseReviewBackup(JSON.stringify(candidate));
  if (parsed.errors.length) throw new Error('Invalid portfolio');
  const saved = parsed.portfolio;
  state.holdings = saved.holdings.map(holding => ({ ...holding,
    exposure: holding.type === 'Stock' ? { [holding.name]: 1 } : null }));
  state.reserve = saved.reserve || null;
  state.coverage = saved.coverage || null;
  fillReserveForm();
  state.goals = saved.goals;
  state.activeGoalId = saved.activeGoalId;
  state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
  state.source = 'user';
  creatingGoal = false;
  $('#mix-plan-details').hidden = false;
  $('#cancel-new-goal').hidden = true;
  $('#goal-form button[type="submit"]').textContent = 'Update my view →';
  fillGoalForm(state.goal);
  render();
}

function downloadFile(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

$('#download-readable').addEventListener('click', () => {
  const report = buildReadableReport(state);
  if (!report) {
    $('#backup-status').textContent = 'Add your holdings before downloading a readable snapshot.';
    return;
  }
  downloadFile(report, 'text/plain;charset=utf-8', 'thefinxperts-readable-review.txt');
  $('#backup-status').textContent = 'Readable summary downloaded. Keep it private; the JSON backup is needed to restore your work.';
});

$('#download-review').addEventListener('click', () => {
  if (state.source !== 'user' || !state.holdings.length) return;
  const backup = buildReviewBackup(state);
  const checked = parseReviewBackup(JSON.stringify(backup));
  if (checked.errors.length) {
    $('#backup-status').textContent = 'This review could not be downloaded. Check the holdings and goal inputs.';
    return;
  }
  downloadFile(JSON.stringify(checked.portfolio, null, 2), 'application/json', 'thefinxperts-review.json');
  $('#backup-status').textContent = 'Review file downloaded. Keep it private; no copy was saved by this page.';
});

function showRestoreStatus(message) {
  $('#backup-status').textContent = message;
  $('#restore-hero-status').textContent = message;
  $('#restore-hero-status').hidden = !message;
}
$('#restore-hero').addEventListener('click', () => $('#restore-review').click());
$('#restore-shortcut').addEventListener('click', () => $('#restore-review').click());
$('#restore-review').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  showRestoreStatus('');
  try {
    if (file.size > 2_000_000 || !file.name.toLowerCase().endsWith('.json')) throw new Error('Invalid file');
    const parsed = parseReviewBackup(await file.text());
    if (parsed.errors.length) {
      showRestoreStatus(parsed.errors[0]);
      return;
    }
    if (!window.confirm('Replace the holdings and goals currently in this tab with this review file?')) return;
    applyPortfolio(parsed.portfolio);
    showRestoreStatus('Review restored in this tab. Download a new file after making changes.');
    $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    showRestoreStatus('The review file could not be read. Your current view is unchanged.');
  } finally {
    event.target.value = '';
  }
});

$('#return-guided').addEventListener('click', event => {
  if (state.source === 'user') prepareReviewHandoff(event, state, './guided-review.html', () =>
    showRestoreStatus('This browser cannot hand your review to chat. Download a review file and open it in the guided review.'));
});

async function readSavedPortfolio(apply) {
  if (apply && state.source !== 'demo' && state.holdings.length &&
      !window.confirm('Replace the holdings and goals in this tab with your saved version? Download a local backup first if you want to keep these entries.')) return;
  try {
    const response = await fetch('/api/portfolio', { cache: 'no-store' });
    if (!response.ok) throw new Error('Read failed');
    const { portfolio, revision } = await response.json();
    if (!Number.isSafeInteger(revision) || revision < 0 || Boolean(portfolio) !== (revision > 0)) throw new Error('Invalid revision');
    hasSavedPortfolio = Boolean(portfolio);
    accountRevision = revision;
    updateAccountActions();
    if (!portfolio) {
      $('#account-status').textContent = 'No saved portfolio yet.';
      return;
    }
    if (apply) {
      applyPortfolio(portfolio);
      $('#account-status').textContent = 'Saved portfolio loaded into this tab.';
    } else $('#account-status').textContent = 'A saved portfolio is available. Load it when ready.';
  } catch {
    accountRevision = null;
    updateAccountActions();
    $('#account-status').textContent = 'Could not read your saved portfolio. Try again later.';
  }
}

async function initAccount() {
  try {
    const response = await fetch('/api/me', { cache: 'no-store' });
    if (!response.ok) return;
    const info = await response.json();
    if (typeof info.authenticated !== 'boolean') return;
    accountAuthenticated = info.authenticated;
    accountPortfolioAccess = info.portfolioAccess === true;
    if (accountPortfolioAccess) {
      fetch('/api/assistant/status', { cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .then(status => {
          if (status?.available !== true) return;
          const link = $('#assistant-link');
          if (Number.isInteger(status.credits?.remaining)) {
            link.textContent = `Ask assistant · ${status.credits.remaining} free`;
          }
          link.hidden = false;
        })
        .catch(() => { /* The browser-only review remains usable without AI. */ });
    }
    accountEnrollment = accountAuthenticated && !accountPortfolioAccess &&
      info.enrollment?.noticePath === '/private-data-notice.html' &&
      /^[A-Za-z0-9._-]{1,40}$/.test(info.enrollment?.noticeVersion)
      ? info.enrollment : null;
    $('#account-card').hidden = false;
    $('#account-login').hidden = accountAuthenticated;
    $('#account-save').hidden = !accountPortfolioAccess;
    $('#account-logout').hidden = !accountAuthenticated;
    $('#account-enroll').hidden = !accountEnrollment;
    if (accountEnrollment) $('#private-notice-link').href = accountEnrollment.noticePath;
    $('#account-title').textContent = accountPortfolioAccess ? 'Your private saved review' : accountEnrollment
      ? 'Enable private saving' : accountAuthenticated
      ? 'Account access pending' : 'Save your review';
    if (accountPortfolioAccess) await readSavedPortfolio(false);
    else if (accountEnrollment) {
      $('#account-description').textContent = 'Your account is signed in. Read the private data notice before enabling saved holdings and goals. Your current entries stay in this tab until you choose Save portfolio.';
      $('#account-status').textContent = 'Private saving is optional.';
    }
    else if (accountAuthenticated) {
      $('#account-description').textContent = 'Your account is signed in. Private portfolio saving is available after beta access is enabled. You can still review holdings here and download a local backup.';
      $('#account-status').textContent = 'Private beta access is not yet enabled for this account.';
    }
    else $('#account-status').textContent = 'The example and local entries work without signing in.';
    updateAccountActions();
  } catch { /* Anonymous static preview works without an account server. */ }
}

$('#private-notice-accepted').addEventListener('change', event => {
  $('#account-enroll-button').disabled = !event.target.checked;
});
$('#account-enroll').addEventListener('submit', async event => {
  event.preventDefault();
  if (!accountAuthenticated || !accountEnrollment || !$('#private-notice-accepted').checked) return;
  const button = $('#account-enroll-button');
  button.disabled = true;
  try {
    const response = await fetch('/api/enroll', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Thefinxperts-Intent': 'enroll' },
      body: JSON.stringify({ accepted: true, noticeVersion: accountEnrollment.noticeVersion }),
    });
    if (!response.ok) throw new Error('Enrollment unavailable');
    accountPortfolioAccess = true;
    accountEnrollment = null;
    $('#account-enroll').hidden = true;
    $('#account-save').hidden = false;
    $('#account-title').textContent = 'Your private saved review';
    await readSavedPortfolio(false);
    updateAccountActions();
  } catch {
    $('#account-status').textContent = 'Private saving could not be enabled. Sign out and try again later.';
    button.disabled = false;
  }
});

$('#account-save').addEventListener('click', async () => {
  if (!accountPortfolioAccess || accountRevision === null || state.source !== 'user' || !state.holdings.length) return;
  const payload = buildReviewBackup(state);
  $('#account-save').disabled = true;
  try {
    const response = await fetch('/api/portfolio', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Thefinxperts-Intent': 'portfolio-write',
        'X-Thefinxperts-Revision': String(accountRevision) },
      body: JSON.stringify(payload),
    });
    if (response.status === 409) {
      $('#account-status').textContent = 'The saved version changed in another tab. Download this tab’s restorable JSON before loading the latest saved version.';
      return;
    }
    if (!response.ok) throw new Error('Save failed');
    const result = await response.json();
    if (!Number.isSafeInteger(result.revision) || result.revision <= accountRevision) throw new Error('Invalid revision');
    accountRevision = result.revision;
    hasSavedPortfolio = true;
    $('#account-status').textContent = 'Saved. Only normalized holdings and goal inputs were stored.';
  } catch { $('#account-status').textContent = 'Could not save. Your entries remain in this tab.'; }
  finally { updateAccountActions(); }
});
$('#account-load').addEventListener('click', () => readSavedPortfolio(true));
$('#account-export').addEventListener('click', async () => {
  if (!accountAuthenticated || !hasSavedPortfolio) return;
  try {
    const response = await fetch('/api/portfolio', { cache: 'no-store' });
    if (!response.ok) throw new Error('Export failed');
    const { portfolio } = await response.json();
    if (!portfolio || ![1, 2].includes(portfolio.version)) throw new Error('No saved portfolio');
    downloadFile(JSON.stringify(portfolio, null, 2), 'application/json', 'thefinxperts-portfolio.json');
    $('#account-status').textContent = 'Saved portfolio exported. Keep the downloaded file private.';
  } catch { $('#account-status').textContent = 'Could not export the saved portfolio. Try again later.'; }
});
$('#account-delete').addEventListener('click', async () => {
  if (!accountAuthenticated || !hasSavedPortfolio || accountRevision === null ||
      !window.confirm('Delete your saved portfolio and goals? This cannot be undone.')) return;
  $('#account-delete').disabled = true;
  try {
    const response = await fetch('/api/portfolio', { method: 'DELETE', headers: {
      'X-Thefinxperts-Intent': 'portfolio-write', 'X-Thefinxperts-Revision': String(accountRevision) } });
    if (response.status === 409) {
      $('#account-status').textContent = 'The saved version changed in another tab. Load the latest saved version before deleting.';
      return;
    }
    if (!response.ok) throw new Error('Delete failed');
    hasSavedPortfolio = false;
    accountRevision = 0;
    updateAccountActions();
    $('#account-status').textContent = 'Saved portfolio deleted. Entries still visible in this tab will disappear when it closes.';
  } catch { $('#account-status').textContent = 'Could not delete the saved portfolio. Try again later.'; }
  finally { $('#account-delete').disabled = false; }
});
render();
showInputMode('manual');
const requestedImport = new URLSearchParams(window.location.search).get('import');
if (['active', 'broker', 'csv', 'cas'].includes(requestedImport)) showInputMode(requestedImport);
receiveReviewHandoff({
  onStart: () => {
    clearCurrentReview();
    showRestoreStatus('Opening the confirmed holdings from your guided review…');
  },
  onPortfolio: portfolio => {
    applyPortfolio(portfolio);
    showRestoreStatus('Your confirmed guided review is open here. Changes on this page stay in this tab; download a review file to keep them.');
  },
  onError: () => showRestoreStatus('The guided review could not be opened. Open a saved review file here instead.'),
});
initAccount();
