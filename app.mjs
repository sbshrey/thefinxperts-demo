import { analyzePortfolio, sampleHoldings, overlapPercent } from './analysis.mjs';
import { parseHoldingsCsv, parseBrokerCsvRows } from './csv.mjs';
import { suggestBrokerColumns, parseBrokerHoldingsRows } from './broker-xlsx.mjs';
import { validateImportReview, validateImportMerge } from './import-review.mjs';
import { setGoalHolding, relinkAfterReplacingHoldings, linkAddedHoldings, summarizeGoalCoverage } from './goals.mjs';
import { buildReviewBackup, parseReviewBackup } from './review-backup.mjs';
import { buildReadableReport } from './readable-report.mjs';
import { MIX_ASSETS, compareMixPlan, validMixPlan } from './mix-plan.mjs';

function demoGoal() {
  return { id: crypto.randomUUID(), years: 3, target: 2000000, age: 32, name: 'Home down payment', monthlyContribution: 0,
    returnPct: 0, inflationPct: 0, equityDropPct: 20, confirmed: false, linkedIds: sampleHoldings.map(holding => holding.id) };
}
const firstGoal = demoGoal();
const state = { holdings: structuredClone(sampleHoldings), source: 'demo', goals: [firstGoal], activeGoalId: firstGoal.id, goal: firstGoal };
const rupees = value => '₹' + Math.round(value).toLocaleString('en-IN');
const $ = selector => document.querySelector(selector);
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
function validEnteredDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > indiaToday()) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
let pendingImport = null;
let pendingPerformance = new Map();
let brokerRows = null;
let brokerSource = 'Broker XLSX';
let accountAuthenticated = false;
let accountPortfolioAccess = false;
let accountEnrollment = null;
let hasSavedPortfolio = false;
let accountRevision = null;
let creatingGoal = false;
let inputMode = 'manual';
let casAvailable = false;

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
    ['#goal-target', goal.target], ['#monthly-contribution', goal.monthlyContribution],
    ['#return-assumption', goal.returnPct], ['#inflation-assumption', goal.inflationPct],
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
  if (result.goalAssets.Other > 0) {
    container.textContent = `${rupees(result.goalAssets.Other)} of holdings linked to this goal is labelled Other. Check those holdings against a detailed statement or scheme information before comparing the chosen mix; debt and gold gaps would be unreliable.`;
    return;
  }
  const rows = compareMixPlan(result.goalAssets, result.goalTotal, state.goal.targetMix);
  if (!rows) {
    container.textContent = 'Assign holdings to this goal to see the comparison.';
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
  $('#holding-date').max = indiaToday();
  syncGoalSelector();
  const needsGoalConfirmation = state.source !== 'demo' && state.goal.confirmed === false;
  const pauseGoalFigures = needsGoalConfirmation;
  const result = analyzePortfolio(state.holdings, pauseGoalFigures ? { ...state.goal, years: 0, target: 0 } : state.goal);
  renderMixPlan(result, pauseGoalFigures);
  $('#portfolio-value').textContent = rupees(result.total);
  $('#holding-count').textContent = `${state.holdings.length} ${state.holdings.length === 1 ? 'holding' : 'holdings'}`;
  $('#goal-years-value').textContent = needsGoalConfirmation ? 'Goal details needed' : `${state.goal.years} years`;
  $('#age-at-goal').textContent = pauseGoalFigures ? 'Goal figures paused' : `Age ${Number(state.goal.age) + Number(state.goal.years)} at the goal date`;
  $('#goal-gap').textContent = result.goalGap === null ? '—' : rupees(result.goalGap);
  $('#goal-gap-note').textContent = needsGoalConfirmation ? 'Confirm age, cost and time horizon below.' : 'Simple arithmetic before growth, inflation or tax';
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
    result.goalHoldingCount === state.holdings.length ? 'All entered holdings are linked to this goal.' :
    `${result.goalHoldingCount} of ${state.holdings.length} holdings are linked here. ${rupees(goalCoverage.elsewhereValue)} is assigned to other goals; ${rupees(goalCoverage.unassignedValue)} is unassigned. Neither amount is included in this goal's figures.`;
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
  const scenario = result.scenario;
  $('#scenario-cost').textContent = scenario ? rupees(scenario.futureCost) : '—';
  $('#scenario-value').textContent = scenario ? rupees(scenario.projectedValue) : '—';
  $('#scenario-gap').textContent = scenario ? rupees(scenario.futureGap) : '—';
  $('#scenario-monthly').textContent = scenario ? rupees(Math.ceil(scenario.monthlyAdditionalNeeded)) : '—';
  const shock = pauseGoalFigures ? null : result.shock;
  $('#shock-drop').textContent = shock ? `${shock.dropPct}%` : '—';
  $('#shock-loss').textContent = shock ? rupees(shock.loss) : '—';
  $('#shock-value').textContent = shock ? rupees(shock.valueAfterLoss) : '—';
  $('#shock-gap').textContent = shock ? rupees(shock.gapAfterLoss) : '—';
  $('#shock-note').textContent = needsGoalConfirmation ? 'Confirm goal details to see this illustration.' : shock
    ? `This subtracts ${shock.dropPct}% once from only the holdings marked Equity and linked to this goal. It uses today's entered values and goal cost; it excludes future growth, contributions, inflation, taxes and changes in other assets. It is a what-if loss, not a prediction or a target allocation.`
    : 'Enter a valid equity-loss percentage to see this illustration.';
  const shockContinuation = pauseGoalFigures ? null : result.shockContinuation;
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
      `${limitText('Amount you could cover', limits.affordable)} ${limitText('Amount you could tolerate', limits.tolerable)} This is your own comparison, not a formal risk profile; real losses may be larger.`.trim();
  $('#scenario-note').textContent = needsGoalConfirmation ? 'Confirm goal details to see this illustration.' : scenario
    ? `Uses ${scenario.returnPct}% annual growth, ${scenario.inflationPct}% inflation and your planned ${rupees(scenario.monthlyContribution)} in month-end contributions for ${scenario.years} years. The total mathematical monthly amount would be ${rupees(Math.ceil(scenario.monthlyTotalNeeded))}; the number above is only the extra beyond your plan. This is arithmetic, not a return forecast or investment recommendation. Entered valuations may be dated; taxes, fees and market losses may differ.`
    : 'Enter valid goal assumptions to see an illustrative scenario.';
  if (scenario && result.goalDateCheck.count) {
    $('#scenario-note').textContent += ' Check the linked valuation dates flagged in your goal view before relying on these figures.';
  }
  $('#workspace-note').textContent = state.source === 'demo' ? 'Illustrative portfolio · values are entered, not live' : 'Your entries · values are entered, not live';
  $('#holding-form-hint').textContent = `${state.source === 'demo' ? 'Adding your first holding removes the fictional example. ' : ''}New holdings count toward the selected goal. Untick them below to change that. Fund constituents remain unknown until verified data is available.`;
  $('#entry-state').hidden = state.source === 'user';
  $('#entry-state-note').textContent = 'These holdings are fictional. Start blank, then add yours and check the goal details.';
  $('#start-own-review').textContent = state.source === 'user' ? 'Continue my review' : 'Start with my holdings';
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
    identity: ['#holdings', 'Review holding labels'], summary: ['#input-choice', 'See import choices'],
    valuation: ['#holdings', 'Check entered values'], emergency: ['#goal-form', 'Review goal context'],
    horizon: ['#goal-form', 'Explore goal timing'], position: ['#holdings', 'Review linked holdings'],
    issuer: ['#holdings', 'Review holdings'], plan: ['#holdings', 'Review fund names'],
    funds: ['#holdings', 'Review fund list'], review: ['#holdings', 'Review holdings'],
  };
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
  state.holdings.forEach(holding => {
    const row = document.createElement('div');
    row.className = 'holding-row';
    const info = document.createElement('div');
    info.className = 'holding-info';
    const name = document.createElement('strong');
    name.textContent = holding.name;
    const meta = document.createElement('small');
    meta.textContent = `${holding.type} · ${holding.asset}${holding.amc ? ` · ${holding.amc}` : ''}${holding.granularity === 'fund_house' ? ' · fund-house summary' : ''}${holding.isin ? ` · ISIN ${holding.isin}` : ''}${holding.units ? ` · ${holding.units} statement units` : ''}${holding.asOf ? ` · as of ${holding.asOf}` : ' · valuation date unknown'}`;
    const goalLink = document.createElement('label');
    goalLink.className = 'holding-goal-link';
    const goalCheckbox = document.createElement('input');
    goalCheckbox.type = 'checkbox';
    goalCheckbox.checked = !Array.isArray(state.goal.linkedIds) || state.goal.linkedIds.includes(holding.id);
    goalCheckbox.setAttribute('aria-label', `Count ${holding.name} toward ${state.goal.name}`);
    goalCheckbox.addEventListener('change', () => {
      state.goals = setGoalHolding(state.goals, state.activeGoalId, holding.id, goalCheckbox.checked);
      state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
      render();
    });
    const goalLinkText = document.createElement('span');
    const otherGoal = state.goals.find(goal => goal.id !== state.activeGoalId && goal.linkedIds.includes(holding.id));
    goalLinkText.textContent = otherGoal ? `Assigned to ${otherGoal.name}` : 'For this goal';
    goalLink.append(goalCheckbox, goalLinkText);
    const update = document.createElement('details');
    update.className = 'holding-update';
    const updateTitle = document.createElement('summary');
    updateTitle.textContent = holding.granularity === 'fund_house' ? 'Update value or date' : 'Update value, date, asset or ISIN';
    const updateForm = document.createElement('form');
    const valueLabel = document.createElement('label');
    valueLabel.textContent = 'Current value (₹)';
    const valueInput = document.createElement('input');
    valueInput.type = 'number';
    valueInput.inputMode = 'decimal';
    valueInput.min = '1';
    valueInput.max = '10000000000';
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
    assetInput.disabled = holding.type === 'Stock' || holding.granularity === 'fund_house';
    assetLabel.append(assetInput);
    const assetHint = document.createElement('p');
    assetHint.className = 'form-hint';
    assetHint.textContent = holding.type === 'Stock' ? 'Direct stocks stay in Equity.' :
      holding.granularity === 'fund_house' ? 'A fund-house total may contain several asset categories. Use a detailed scheme statement before classifying it.' :
        'Check the scheme objective or original statement before changing its category.';
    let isinInput = null;
    let isinLabel = null;
    let isinHint = null;
    if (holding.granularity !== 'fund_house') {
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
      isinHint.textContent = 'Format checked only. Changing this code removes any linked AMFI code and fund constituent estimate.';
    }
    const updateError = document.createElement('p');
    updateError.className = 'form-error';
    updateError.setAttribute('role', 'alert');
    const updateButton = document.createElement('button');
    updateButton.type = 'submit';
    updateButton.className = 'text-button';
    updateButton.textContent = 'Save holding changes';
    updateForm.append(valueLabel, dateLabel, assetLabel, assetHint);
    if (isinLabel) updateForm.append(isinLabel, isinHint);
    updateForm.append(updateError, updateButton);
    updateForm.addEventListener('submit', event => {
      event.preventDefault();
      const value = Number(valueInput.value);
      const asOf = dateInput.value;
      const asset = assetInput.value;
      const isin = isinInput?.value.trim().toUpperCase() || '';
      if (!Number.isFinite(value) || value <= 0 || value > 1e10 || !validEnteredDate(asOf)) {
        updateError.textContent = 'Enter a positive value and a valid date no later than today.';
        return;
      }
      if (!['Equity', 'Debt', 'Gold', 'Other'].includes(asset) ||
          ((holding.type === 'Stock' || holding.granularity === 'fund_house') && asset !== holding.asset)) {
        updateError.textContent = 'Check the asset category against the source before saving.';
        return;
      }
      if (isin && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
        updateError.textContent = 'Check the 12-character ISIN against your statement, or leave it blank.';
        return;
      }
      state.holdings = state.holdings.map(item => {
        if (item.id !== holding.id) return item;
        const identifierChanged = isinInput && isin !== (item.isin || '');
        const updated = { ...item, value, asOf: asOf || null, asset,
          ...((asset !== item.asset || (identifierChanged && item.type === 'Mutual fund')) ? { exposure: null } : {}) };
        if (isinInput) {
          if (isin) updated.isin = isin;
          else delete updated.isin;
          if (identifierChanged) delete updated.amfi;
        }
        return updated;
      });
      render();
    });
    update.append(updateTitle, updateForm);
    info.append(name, meta, goalLink, update);
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
      state.goals = state.goals.map(goal => ({ ...goal, linkedIds: goal.linkedIds.filter(id => id !== holding.id) }));
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
      'Your holdings are entered. Check the goal name, then enter your age, goal cost and time horizon to see goal figures and download your review.' :
      `${pendingGoals.length} ${pendingGoals.length === 1 ? 'other goal needs' : 'other goals need'} details before you can download a review. Choose a goal above, then enter its details.`;
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
  $('#coverage-note').textContent = result.classifiedPct < 100 ? 'Unknown fund constituents are excluded from this measure' : 'All entered value has named issuer coverage';
  $('#live-status').textContent = `Review updated. ${state.holdings.length} holdings, ${result.findings.length + result.additionalFindings.length} review items.`;
  const canDownload = state.source === 'user' && state.holdings.length > 0 && state.goals.every(goal => goal.confirmed === true);
  $('#download-review').disabled = !canDownload;
  $('#download-readable').disabled = !canDownload;
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
  const monthlyContribution = Number($('#monthly-contribution').value);
  const returnPct = Number($('#return-assumption').value);
  const inflationPct = Number($('#inflation-assumption').value);
  const equityDropPct = Number($('#equity-drop-assumption').value);
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
  const details = { name: $('#goal-name').value.trim() || 'My goal', years, target, age, monthlyContribution, returnPct, inflationPct, equityDropPct, confirmed: true };
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
  if (!name || name.length > 80 || !Number.isFinite(value) || value <= 0 || value > 1e10 ||
      (type === 'Stock' && asset !== 'Equity') || !validEnteredDate(asOf)) {
    $('#holding-error').textContent = 'Enter a name, a positive value, and a date no later than today if supplied.';
    return;
  }
  if (isin && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
    $('#holding-error').textContent = 'Check the 12-character ISIN against your statement, or leave it blank.';
    return;
  }
  $('#holding-error').textContent = '';
  const added = { id: crypto.randomUUID(), name, type, asset, value, asOf: asOf || null,
    ...(isin ? { isin } : {}), exposure: type === 'Stock' ? { [name]: 1 } : null };
  if (state.source === 'demo') clearCurrentReview();
  state.holdings.push(added);
  state.goals = setGoalHolding(state.goals, state.activeGoalId, added.id, true);
  state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
  event.target.reset();
  $('#holding-asset').disabled = false;
  render();
});

$('#holding-type').addEventListener('change', () => {
  const stock = $('#holding-type').value === 'Stock';
  if (stock) $('#holding-asset').value = 'Equity';
  $('#holding-asset').disabled = stock;
});

function clearCurrentReview() {
  pendingImport = null;
  pendingPerformance.clear();
  $('#import-preview').hidden = true;
  state.holdings = [];
  const fromExample = state.source === 'demo';
  state.goals = state.goals.map(goal => ({ ...goal, linkedIds: [],
    ...(fromExample ? { age: null, years: null, target: null, confirmed: false } : {}) }));
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
    $('#cas-file').value = '';
    $('#cas-password').value = '';
    $('#broker-file').value = '';
    $('#csv-file').value = '';
    brokerRows = null;
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
  if (state.source !== 'demo' && state.holdings.length &&
      !window.confirm('Replace your current holdings and goals with the fictional example? Download a review file first if you want to keep them.')) return;
  pendingImport = null;
  pendingPerformance.clear();
  $('#import-preview').hidden = true;
  state.holdings = structuredClone(sampleHoldings);
  state.goals = [demoGoal()];
  state.source = 'demo';
  selectGoal(state.goals[0].id);
  showInputMode('manual');
});
$('#clear-all').addEventListener('click', () => {
  if (state.source !== 'demo' && state.holdings.length &&
      !window.confirm('Clear all holdings and goal links in this tab? Download a review file first if you want to keep them.')) return;
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
  $('#broker-map').hidden = true;
  $('#broker-error').textContent = '';
});

function fillBrokerColumns(index) {
  const headers = brokerRows[index] || [];
  const guess = suggestBrokerColumns([headers]);
  for (const [id, selected] of [['broker-name', guess.name], ['broker-value', guess.value], ['broker-isin', guess.isin]]) {
    const select = $(`#${id}`);
    select.replaceChildren();
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = id === 'broker-isin' ? 'No ISIN column' : 'Choose a column';
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
      const { readBrokerWorkbook } = await import('./broker-xlsx-browser.mjs');
      brokerRows = await readBrokerWorkbook(file);
      brokerSource = 'Broker XLSX';
    } else throw new Error('Choose a broker holdings XLSX or CSV report.');
    const suggested = suggestBrokerColumns(brokerRows);
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
  const selected = id => $(id).value === '' ? null : Number($(id).value);
  const result = parseBrokerHoldingsRows(brokerRows, Number($('#broker-header').value),
    { name: selected('#broker-name'), value: selected('#broker-value'), isin: selected('#broker-isin') },
    $('#broker-date').value, { strictWidth: brokerSource === 'Broker CSV' });
  if (result.errors.length) {
    $('#broker-error').textContent = result.errors.join(' ');
    $('#import-preview').hidden = true;
    return;
  }
  showImportPreview(result.holdings, brokerSource, result.notices);
});

function showImportPreview(holdings, label, notices, performance = []) {
  pendingImport = holdings.map(holding => ({ ...holding }));
  pendingPerformance = new Map(performance.map(item => [item.id, item.annualPercent]));
  $('#cas-performance-note').hidden = label !== 'CAS';
  if (!label.startsWith('Broker ')) $('#broker-map').hidden = true;
  $('#import-preview').dataset.source = label;
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

function refreshImportSummary() {
  const count = pendingImport?.length || 0;
  const total = pendingImport?.reduce((sum, holding) => sum + Number(holding.value), 0) ?? 0;
  const label = $('#import-preview').dataset.source || 'imported';
  $('#import-summary').textContent = `${count} ${label} ${count === 1 ? 'holding' : 'holdings'} · ${Number.isFinite(total) ? rupees(total) : 'value needs correction'}`;
  const errors = validateImportReview(pendingImport);
  $('#import-validation').textContent = errors.join(' ');
  $('#confirm-import').disabled = errors.length > 0;
  const canAdd = state.source === 'user' && state.holdings.length > 0;
  const mergeButton = $('#merge-import');
  const mergeValidation = $('#merge-validation');
  mergeButton.hidden = !canAdd;
  const mergeErrors = canAdd && !errors.length ? validateImportMerge(state.holdings, pendingImport) : [];
  mergeButton.disabled = errors.length > 0 || mergeErrors.length > 0;
  mergeValidation.hidden = !canAdd || mergeErrors.length === 0;
  mergeValidation.textContent = mergeErrors.join(' ');
}

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
      if (pendingPerformance.has(holding.id)) parts.push(`Indicative statement-period XIRR: ${pendingPerformance.get(holding.id).toFixed(2)}% a year`);
      if (holding.granularity === 'fund_house') parts.push('Fund-house summary, not an individual scheme');
      metadata.textContent = parts.length ? parts.join(' · ') : 'No fund-house or instrument identifier supplied.';
    };
    refreshMetadata();
    const rowSummary = () => {
      summary.textContent = `${holding.name || 'Unnamed holding'} — ${holding.type || 'choose type'}, ${holding.asset || 'choose asset'}, ${Number.isFinite(Number(holding.value)) ? rupees(holding.value) : 'check value'}${holding.asOf ? ` as of ${holding.asOf}` : ''}`;
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
      if (name.value !== holding.name) { holding.name = name.value; holding.isin = null; holding.amfi = null; pendingPerformance.delete(holding.id); refreshMetadata(); }
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
    const { previewActiveStatementPdf } = await import('./active-statement-pdf.mjs');
    const result = await previewActiveStatementPdf(file, password);
    if (result.errors.length) {
      $('#active-error').textContent = result.errors.slice(0, 5).join(' ');
      return;
    }
    showImportPreview(result.holdings, 'Active Statement', result.notices);
  } catch {
    $('#active-error').textContent = 'The Active Statement preview failed in this browser.';
  } finally {
    $('#active-password').value = '';
    $('#active-file').value = '';
    button.disabled = false;
    button.textContent = 'Preview fund-house totals';
  }
});

fetch('/api/cas/status', { cache: 'no-store' }).then(response => response.ok ? response.json() : null)
  .then(info => {
    if (info?.local === true) {
      casAvailable = true;
      $('#choose-cas').hidden = false;
      showInputMode(inputMode);
      $('#cas-eyebrow').textContent = 'LOCAL CAS PREVIEW';
      $('#cas-description').textContent = 'The PDF and password go only to the preview server on this computer. They are not saved in project files or sent to the hosted service. Review the extracted holdings before replacing the example.';
    } else if (info?.available === true) {
      casAvailable = true;
      $('#choose-cas').hidden = false;
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
  if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size > 15_000_000 || !password) {
    $('#cas-error').textContent = 'Choose an original PDF smaller than 15 MB and enter its password.';
    return;
  }
  const button = $('#preview-cas');
  button.disabled = true;
  button.textContent = 'Reading locally…';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const response = await fetch('/api/cas/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Thefinxperts-Local': '1', 'X-Thefinxperts-Intent': 'cas-preview' },
      body: JSON.stringify({ pdf: btoa(binary), password }),
    });
    const result = await response.json();
    if (!response.ok || result.errors?.length || !Array.isArray(result.holdings)) {
      $('#cas-error').textContent = result.errors?.slice(0, 5).join(' ') || result.error || 'The CAS could not be read.';
      return;
    }
    showImportPreview(result.holdings, result.source || 'CAS', result.notices || [], result.performance || []);
  } catch {
    $('#cas-error').textContent = 'The CAS preview failed. Try again later.';
  } finally {
    $('#cas-password').value = '';
    $('#cas-file').value = '';
    button.disabled = false;
    button.textContent = 'Preview CAS holdings';
  }
});
function applyImport(mode) {
  if (!pendingImport || validateImportReview(pendingImport).length) return;
  if (mode === 'add' && (state.source !== 'user' || !state.holdings.length || validateImportMerge(state.holdings, pendingImport).length)) return;
  const imported = pendingImport.map(holding => {
    const name = holding.name.trim();
    return { ...holding, name, id: crypto.randomUUID(), exposure: holding.type === 'Stock' ? { [name]: 1 } : null };
  });
  const fromExample = mode === 'replace' && state.source === 'demo';
  if (fromExample) state.goals = state.goals.map(goal =>
    ({ ...goal, age: null, years: null, target: null, confirmed: false }));
  state.goals = mode === 'add'
    ? linkAddedHoldings(state.goals, state.activeGoalId, imported)
    : relinkAfterReplacingHoldings(state.goals, state.activeGoalId, imported);
  state.holdings = mode === 'add' ? [...state.holdings, ...imported] : imported;
  state.goal = state.goals.find(goal => goal.id === state.activeGoalId);
  state.source = 'user';
  if (fromExample) fillGoalForm(state.goal);
  pendingImport = null;
  pendingPerformance.clear();
  $('#csv-file').value = '';
  $('#broker-file').value = '';
  brokerRows = null;
  $('#broker-map').hidden = true;
  $('#import-preview').hidden = true;
  render();
  $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#confirm-import').addEventListener('click', () => applyImport('replace'));
$('#merge-import').addEventListener('click', () => applyImport('add'));
$('#cancel-import').addEventListener('click', () => {
  pendingImport = null;
  pendingPerformance.clear();
  $('#csv-file').value = '';
  $('#broker-file').value = '';
  brokerRows = null;
  $('#broker-map').hidden = true;
  $('#import-preview').hidden = true;
});

function updateAccountActions() {
  if (!accountAuthenticated || !accountPortfolioAccess) return;
  const unconfirmedGoals = state.goals.some(goal => goal.confirmed === false);
  $('#account-save').disabled = accountRevision === null || state.source !== 'user' || state.holdings.length === 0 || unconfirmedGoals;
  $('#account-description').textContent = unconfirmedGoals && state.source === 'user'
    ? 'Confirm each goal’s details before saving. Original CAS PDFs and passwords are not saved.' : state.source === 'user'
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
    $('#backup-status').textContent = 'Confirm your personal holdings and every goal before downloading a summary.';
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
    $('#backup-status').textContent = 'This review could not be downloaded. Check the holdings and goals.';
    return;
  }
  downloadFile(JSON.stringify(checked.portfolio, null, 2), 'application/json', 'thefinxperts-review.json');
  $('#backup-status').textContent = 'Review file downloaded. Keep it private; no copy was saved by this page.';
});

$('#restore-review').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000 || !file.name.toLowerCase().endsWith('.json')) throw new Error('Invalid file');
    const parsed = parseReviewBackup(await file.text());
    if (parsed.errors.length) {
      $('#backup-status').textContent = parsed.errors[0];
      return;
    }
    if (!window.confirm('Replace the holdings and goals currently in this tab with this review file?')) return;
    applyPortfolio(parsed.portfolio);
    $('#backup-status').textContent = 'Review restored in this tab. Download a new file after making changes.';
    $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    $('#backup-status').textContent = 'The review file could not be read. Your current view is unchanged.';
  } finally {
    event.target.value = '';
  }
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
initAccount();
