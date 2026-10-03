import { previewActiveStatementFile } from './active-statement-pdf.mjs';
import { previewBrowserCas } from './cas-browser.mjs';
import { prepareAssistantSave, findAssistantOverlap } from './assistant-save.mjs';
import { buildAssistantGoalReview, buildAssistantReviewChecks } from './assistant-review.mjs';
import { goalShare } from './goals.mjs';
import { prepareAssistantGoalSave, prepareAssistantGoalAssignment,
  parseAssistantGoalCommand, prepareAssistantGoalCommand,
  parseAssistantEmergencyFunding, namedGoalInQuestion } from './assistant-goal.mjs';
import { clarifyDrafts, classifyDraftsByNumbers, nextDraftQuestion, mergeAssistantDrafts, skipDraftFromMessage } from './assistant-clarify.mjs';
import { previewAssistantImport } from './assistant-import.mjs';
import { importValueAndDates, rupees } from './assistant-import-audit.mjs';
import { prepareAssistantCasDrafts } from './assistant-cas.mjs';
import { analyzePortfolio, valuationDateIssue } from './analysis.mjs';
import { answerReviewQuestion } from './review-questions.mjs';
import { parseReviewBackup } from './review-backup.mjs';
import { entryOriginText, valuationOriginText } from './entry-origin.mjs';
import { encryptDeviceReview, decryptDeviceReview } from './device-review.mjs';
import { parseBrowserGoalFact, parseBrowserHoldingStatement, parseBrowserHoldingList,
  nextBrowserGoalQuestion } from './assistant-local.mjs';
import { parseHoldingCorrection, prepareHoldingCorrection,
  parseCoverageAnswer, prepareCoverageAnswer } from './assistant-correction.mjs';
import { parseAssistantReserveFact, nextAssistantReserveQuestion,
  prepareAssistantReserveSave } from './assistant-reserve.mjs';
import { validReserve, reserveMonths } from './reserve.mjs';
import { prepareAssistantActiveRefresh, prepareAssistantBrokerRefresh, prepareAssistantCasRefresh,
  prepareAssistantDematRefresh } from './assistant-refresh.mjs';
import { validShares } from './stock-estimate.mjs';

const $ = selector => document.querySelector(selector);
const money = amount => `₹${Math.round(amount).toLocaleString('en-IN')}`;
const browserOnly = document.body.dataset.mode === 'browser-only';
const DEVICE_KEY = 'thefinxperts:encrypted-review:v1';
let devicePassphrase = null;
let deviceSaveRevision = 0;
let deviceBusy = false;
let assistantStatusRevision = 0;
let reviewChangeSerial = 0;
let fileSavedSerial = -1;
let deviceSavedSerial = -1;
function deviceRecord() {
  try { return localStorage.getItem(DEVICE_KEY); }
  catch { return null; }
}
function renderDeviceActions() {
  if (!browserOnly) return;
  const exists = Boolean(deviceRecord());
  $('#device-review-action').textContent = exists ? devicePassphrase ?
    deviceSavedSerial === reviewChangeSerial ? 'Saved here' : 'Retry save here' : 'Unlock here' : 'Save here';
  $('#device-review-action').disabled = deviceBusy || (!exists && !state.account?.portfolio);
  $('#forget-device-review').hidden = !exists;
  $('#forget-device-review').disabled = deviceBusy;
}
function forgetDeviceRecord() {
  deviceSaveRevision++;
  devicePassphrase = null;
  deviceSavedSerial = -1;
  try { localStorage.removeItem(DEVICE_KEY); return true; }
  catch { return false; }
}
async function saveDeviceReview(portfolio) {
  if (!devicePassphrase || !portfolio) return false;
  const revision = ++deviceSaveRevision;
  const changeSerial = reviewChangeSerial;
  try {
    const encrypted = await encryptDeviceReview(JSON.stringify(portfolio), devicePassphrase);
    if (revision !== deviceSaveRevision || !devicePassphrase) return false;
    localStorage.setItem(DEVICE_KEY, encrypted);
    deviceSavedSerial = changeSerial;
    renderDeviceActions();
    return true;
  } catch {
    if (revision === deviceSaveRevision) say('note', 'Could not save this review on this device. Choose “Retry save here” or download a private review file to keep your changes.');
    return false;
  }
}
const state = { confirmed: [], drafts: [], history: [], file: null, busy: false, available: false,
  hosted: false, credits: null, account: browserOnly ? { portfolio: null, revision: 0 } : null,
  goalFacts: null, goalDraftGoalId: null, reserveFacts: null, reserveDraftRevision: null,
  correction: null, refresh: null, casAvailable: false, casLocal: false,
  capacityReached: false, coveragePrompted: false };
const starterActions = $('#starter-actions');
function hideStarterActions() { if (starterActions) starterActions.hidden = true; }
function showStarterActions() {
  if (!browserOnly || !starterActions || state.confirmed.length) return;
  $('#messages').append(starterActions);
  starterActions.hidden = false;
}
const creditChannel = !browserOnly && typeof BroadcastChannel !== 'undefined' ?
  new BroadcastChannel('thefinxperts-assistant-credits') : null;
const toolsToggle = $('#tools-toggle');
const mobileTools = window.matchMedia('(max-width: 600px)');
function setToolsOpen(open) {
  $('.top-actions').classList.toggle('tools-open', open);
  toolsToggle.setAttribute('aria-expanded', String(open));
}
toolsToggle.addEventListener('click', () =>
  setToolsOpen(toolsToggle.getAttribute('aria-expanded') !== 'true'));
$('#tools-items').addEventListener('click', event => {
  if (event.target.closest('button,a')) setToolsOpen(false);
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.top-actions')) setToolsOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || toolsToggle.getAttribute('aria-expanded') !== 'true') return;
  setToolsOpen(false);
  toolsToggle.focus();
});
mobileTools.addEventListener('change', event => { if (!event.matches) setToolsOpen(false); });
const reviewToggle = $('#review-toggle');
const mobileReview = window.matchMedia('(max-width: 800px)');
function syncReviewAccessibility() {
  $('.chat-panel').inert = reviewToggle?.getAttribute('aria-expanded') === 'true' && mobileReview.matches;
}
function setReviewExpanded(expanded) {
  $('.workspace').classList.toggle('review-expanded', expanded);
  reviewToggle.setAttribute('aria-expanded', String(expanded));
  reviewToggle.textContent = expanded ? 'Back to chat' : 'Open review';
  syncReviewAccessibility();
}
reviewToggle?.addEventListener('click', () =>
  setReviewExpanded(reviewToggle.getAttribute('aria-expanded') !== 'true'));
mobileReview.addEventListener('change', syncReviewAccessibility);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && reviewToggle?.getAttribute('aria-expanded') === 'true')
    setReviewExpanded(false);
});
const casStatusPromise = browserOnly ? Promise.resolve(false) : fetch('/api/cas/status', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(status => {
    state.casAvailable = Boolean(status?.available || status?.local);
    state.casLocal = Boolean(status?.local);
    if (state.casLocal) $('#cas-description').textContent =
      'Read an original CAS with the loopback server on this computer. The PDF and password are processed for this preview and are not saved. This uses no AI credit.';
    else if (state.casAvailable) $('#cas-description').textContent =
      'Read an original mutual-fund CAS with the signed-in service. The PDF and password are processed for this preview and are not saved.';
    if (state.casAvailable) $('#cas-preview').textContent = 'Read as CAS';
    return state.casAvailable;
  })
  .catch(() => false);
if (browserOnly) $('#cas-description').textContent =
  'Enter this PDF’s password. This browser will try the supported CAMS statement readers; the PDF and password stay in this tab. Confirm every holding before using it.';

function renderCredits() {
  const label = $('#credit-balance');
  const remaining = state.credits?.remaining;
  label.hidden = !Number.isInteger(remaining);
  $('#credit-policy').hidden = label.hidden;
  const meter = $('#credit-meter');
  meter.hidden = label.hidden;
  if (!label.hidden) {
    const total = state.credits.freeTotal;
    label.textContent = `${remaining} of ${total} free AI credits left`;
    $('#credit-meter-title').textContent = `${total} free AI replies`;
    $('#credit-meter-detail').textContent = remaining ?
      `${remaining} remaining on this account` : 'All used. Your saved review and no-credit actions still work.';
    $('#credit-pips').replaceChildren(...Array.from({ length: total }, (_, index) => {
      const pip = document.createElement('span');
      pip.className = index < remaining ? 'available' : 'used';
      return pip;
    }));
  }
  $('#send').disabled = state.busy;
  $('#cas-preview').disabled = state.busy;
  $('#active-preview').disabled = state.busy;
  $('#remove-file').disabled = state.busy;
  renderAccountActions();
}

function assistantStatusText() {
  if (state.capacityReached) return 'AI capacity reached · free checks still work';
  if (!state.available) return 'AI unavailable · saved review still works';
  if (state.credits?.remaining === 0) return '5 AI replies used · free checks still work';
  return 'AI ready';
}

function renderAccountActions() {
  $('#account-menu').hidden = !state.hosted;
  $('#clear-review').hidden = state.hosted;
  const saved = Boolean(state.account?.portfolio);
  $('#export-saved').hidden = !saved;
  $('#delete-saved').hidden = !saved;
  $('#export-saved').disabled = state.busy;
  $('#delete-saved').disabled = state.busy;
  const localDownload = $('#download-tab-review');
  if (localDownload) localDownload.disabled = state.busy || !saved;
  renderDeviceActions();
  renderCorrection();
  renderRefresh();
  renderReserveDraft();
}

function nextFundCategoryQuestion(portfolio) {
  const index = portfolio?.holdings?.findIndex(row => row.type === 'Mutual fund' &&
    row.granularity !== 'fund_house' && row.asset === 'Other') ?? -1;
  return index < 0 ? null : `Holding #${index + 1} is labelled Other. Can you check its individual scheme source for a clear Equity, Debt or Gold category? If so, say “classify holding ${index + 1} as Equity” with the category you found, then confirm it. Otherwise keep it as Other.`;
}

function nextGoalSetupQuestion(portfolio) {
  const goal = portfolio?.goals?.find(item => item.id === portfolio.activeGoalId);
  if (!goal) return null;
  if (!goal.confirmed)
    return `For ${goal.name}: ${nextBrowserGoalQuestion(goal)}`;
  if (portfolio.goals.length === 1 && portfolio.holdings.some(row =>
    row.id && !goal.linkedIds?.includes(row.id)))
    return `Some confirmed holdings are not counted toward ${goal.name}. If they all belong to this goal, say “count all holdings toward this goal”. I will ask you to confirm before changing the goal comparison.`;
  if (!goal.targetMix)
    return `If you have already chosen an asset mix for ${goal.name}, say “goal mix 60% equity, 30% debt, 10% gold” with your percentages. I can compare them with linked holdings, but cannot choose them for you.`;
  return 'Ask “What should I check first?” to see the highest-priority factual review item for these holdings and this goal.';
}

function say(role, text, question = null) {
  if (role === 'user') hideStarterActions();
  const item = document.createElement('div');
  item.className = `message ${role}`;
  item.textContent = text;
  if (question) {
    const next = document.createElement('span');
    next.className = 'question';
    next.textContent = question;
    item.append(next);
  }
  $('#messages').append(item);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  if (role === 'user' || role === 'assistant') {
    state.history.push({ role, content: `${text}${question ? ` ${question}` : ''}`.slice(0, 1000) });
    state.history = state.history.slice(-8);
  }
}

function renderDrafts() {
  const box = $('#drafts');
  box.hidden = !state.drafts.length;
  $('#draft-list').replaceChildren();
  if (!state.drafts.length) return;
  const list = document.createElement('ul');
  for (const [index, row] of state.drafts.entries()) {
    const item = document.createElement('li');
    item.textContent = `#${index + 1} ${row.name} · ${row.granularity === 'fund_house' ? 'fund-house summary; schemes unknown' : row.type} · ${row.asset === 'Other' ? 'asset category unknown' : row.asset} · ${row.value == null ? 'value missing' : money(row.value)}${row.asOf ? ` · ${row.asOf}` : ' · date missing'}${row.shares ? ` · ${row.shares} report shares; check current balance` : ''}`;
    list.append(item);
  }
  $('#draft-list').append(list);
  $('#draft-help').textContent = nextDraftQuestion(state.drafts) ||
    'Check these against your source before using them in the dashboard.';
  $('#confirm-drafts').disabled = state.busy || state.drafts.some(row =>
    !Number.isFinite(row.value) || row.value <= 0 || row.type === 'Other' ||
    (row.type === 'Stock' && row.asset !== 'Equity'));
}

function renderGoalDraft() {
  const box = $('#goal-draft');
  box.hidden = !state.goalFacts;
  const list = $('#goal-draft-list'); list.replaceChildren();
  if (!state.goalFacts) return;
  const selected = state.account?.portfolio?.goals?.find(goal => goal.id === state.account.portfolio.activeGoalId);
  $('#goal-draft-target').textContent = selected ?
    `These facts will update ${selected.name}. Check them before saving.` :
    'Check these facts before saving. Only the listed fields will change.';
  const ul = document.createElement('ul');
  const labels = { name: 'Goal', age: 'Your current age', years: 'Years until goal',
    target: 'Target in today’s rupees', monthlyContribution: 'Monthly contribution',
    returnPct: 'Annual growth assumption', inflationPct: 'Annual inflation assumption',
    targetMix: 'Your chosen goal mix', equityDropPct: 'Hypothetical equity fall',
    affordableLoss: 'Loss you could cover', tolerableLoss: 'Loss you could tolerate',
    emergencyFunding: 'Unexpected essential expense money' };
  const expenseAnswer = { separate: 'separate accessible money', goal_holdings: 'holdings assigned to this goal',
    unsure: 'unsure' };
  for (const [key, value] of Object.entries(state.goalFacts)) {
    const item = document.createElement('li');
    item.textContent = `${labels[key]}: ${key === 'targetMix' ? value === null ? 'remove comparison' :
      Object.entries(value).map(([asset, share]) => `${asset} ${share}%`).join(', ') :
      ['target', 'monthlyContribution', 'affordableLoss', 'tolerableLoss'].includes(key) ? money(value) :
        ['returnPct', 'inflationPct', 'equityDropPct'].includes(key) ? `${value}%` :
          key === 'emergencyFunding' ? expenseAnswer[value] : value}`;
    ul.append(item);
  }
  list.append(ul);
  $('#confirm-goal').disabled = state.busy || !state.account ||
    Boolean(state.goalDraftGoalId && selected?.id !== state.goalDraftGoalId);
}

function renderReserveDraft() {
  const box = $('#reserve-draft');
  box.hidden = !state.reserveFacts;
  if (!state.reserveFacts) return;
  const stale = state.reserveDraftRevision !== state.account?.revision;
  const clearing = state.reserveFacts.clear === true;
  const combined = clearing ? null : { ...state.account?.portfolio?.reserve, ...state.reserveFacts };
  $('#reserve-draft-help').textContent = stale ?
    'The confirmed review changed after these totals were staged. Discard them and answer again.' :
    clearing ? 'Remove only the separate reserve totals after confirmation.' :
      nextAssistantReserveQuestion(state.account?.portfolio, state.reserveFacts);
  const list = $('#reserve-draft-list'); list.replaceChildren();
  const summary = document.createElement('p');
  summary.textContent = clearing ? 'Remove the saved monthly essentials and accessible money totals.' :
    `Monthly essentials: ${combined.monthlyEssentials === undefined ? 'missing' : money(combined.monthlyEssentials)} · Accessible money outside reviewed holdings: ${combined.accessibleMoney === undefined ? 'missing' : money(combined.accessibleMoney)}`;
  list.append(summary);
  $('#confirm-reserve').textContent = clearing ? 'Remove reserve totals' : 'Save reserve totals';
  $('#confirm-reserve').disabled = state.busy || stale || (!clearing && !validReserve(combined));
}

function renderCorrection() {
  const box = $('#correction-draft');
  if (!box) return;
  box.hidden = !state.correction;
  const nav = state.correction?.kind === 'nav';
  const price = state.correction?.kind === 'price';
  $('#nav-correction-checks').hidden = !nav;
  $('#price-correction-checks').hidden = !price;
  if (!state.correction) {
    $('#nav-scheme-checked').checked = false;
    $('#nav-units-checked').checked = false;
    $('#price-security-checked').checked = false;
    $('#price-shares-checked').checked = false;
    return;
  }
  const stale = state.account?.revision !== state.correction.revision;
  $('#correction-preview').textContent = stale ?
    'The confirmed review changed after this correction was prepared. Discard it and describe the correction again.' :
    state.correction.description;
  $('#confirm-correction').disabled = state.busy || stale ||
    (nav && (!$('#nav-scheme-checked').checked || !$('#nav-units-checked').checked)) ||
    (price && (!$('#price-security-checked').checked || !$('#price-shares-checked').checked));
}

for (const selector of ['#nav-scheme-checked', '#nav-units-checked',
  '#price-security-checked', '#price-shares-checked'])
  $(selector).addEventListener('change', renderCorrection);

function renderRefresh() {
  const box = $('#refresh-draft');
  if (!box) return;
  box.hidden = !state.refresh;
  if (!state.refresh) return;
  const stale = state.account?.revision !== state.refresh.revision;
  $('#refresh-help').textContent = state.refresh.kind === 'broker' ?
    'Confirm this newer report covers the same account and positions. Unmatched rows will stay out.' :
    ['cas', 'demat'].includes(state.refresh.kind) ?
      'Confirm this newer CAS covers the same investment positions. Unmatched rows will stay out.' :
      'Confirm this is a complete newer statement for the same investments.';
  $('#refresh-summary').textContent = stale ?
    'The confirmed review changed after this report was read. Discard this preview and open the statement again.' :
    state.refresh.description;
  const changes = $('#refresh-changes'); changes.replaceChildren();
  if (!stale) for (const change of state.refresh.changes) {
    const item = document.createElement('li'); item.textContent = change; changes.append(item);
  }
  $('#confirm-refresh').textContent = state.refresh.scopeOnly ?
    'Recheck coverage' : 'Apply report refresh';
  $('#confirm-refresh').disabled = state.busy || stale;
}

function renderReview() {
  const rows = state.confirmed;
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const assets = { Equity: 0, Debt: 0, Gold: 0, Other: 0 };
  for (const row of rows) assets[row.asset] += row.value;
  const stale = rows.filter(row => valuationDateIssue(row.asOf)).length;
  $('#total').textContent = money(total);
  $('#count').textContent = String(rows.length);
  $('#stale-count').textContent = String(stale);
  $('#review-badge').textContent = rows.length ? `${rows.length} confirmed` : 'No holdings yet';
  const hasNavEstimate = state.account?.portfolio?.holdings?.some(row => row.navEstimate);
  const hasStockEstimate = state.account?.portfolio?.holdings?.some(row => row.stockEstimate);
  $('#date-note').textContent = rows.length ?
    `Based on supplied values and dates, not live market quotes.${hasNavEstimate ? ' Includes your dated NAV estimate with unchanged units.' : ''}${hasStockEstimate ? ' Includes your dated stock-price estimate with unchanged shares.' : ''}` :
    'Add a holding to begin. Values are dated, not live quotes.';
  const bars = $('#asset-bars');
  bars.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p'); empty.textContent = 'Nothing to compare yet.'; bars.append(empty);
  } else {
    for (const [asset, value] of Object.entries(assets)) {
      if (!value) continue;
      const line = document.createElement('div'); line.className = 'asset-row';
      const label = document.createElement('span'); label.textContent = asset;
      const track = document.createElement('div'); track.className = 'asset-track';
      const fill = document.createElement('div'); fill.className = 'asset-fill'; fill.style.width = `${value / total * 100}%`; track.append(fill);
      const pct = document.createElement('strong'); pct.textContent = `${Math.round(value / total * 100)}%`;
      line.append(label, track, pct); bars.append(line);
    }
    const scope = document.createElement('p'); scope.className = 'coverage-note';
    const label = value => ({ all: 'all included', some: 'some missing', none: 'none owned',
      unsure: 'unsure' })[value] || 'not answered';
    const coverage = state.account?.portfolio?.coverage;
    scope.textContent = `Self-reported coverage: mutual funds ${label(coverage?.mutualFunds)}; direct stocks ${label(coverage?.directStocks)}. Only confirmed rows count here. To update this, say “I included all my mutual funds” or “I included some of my direct stocks”.`;
    bars.append(scope);
  }
  const checks = buildAssistantReviewChecks(rows, state.account?.portfolio);
  const checkList = $('#review-questions');
  checkList.replaceChildren();
  if (!checks.length) {
    const item = document.createElement('li');
    item.textContent = browserOnly ? 'Upload a CAMS Active Statement or holdings CSV/XLSX to start.' :
      'Upload a statement or describe an investment to start.';
    checkList.append(item);
  } else for (const check of checks) {
    const item = document.createElement('li'); item.className = 'review-check';
    const title = document.createElement('strong'); title.textContent = check.title;
    const detail = document.createElement('p'); detail.textContent = check.detail;
    const question = document.createElement('p'); question.className = 'review-check-question';
    question.textContent = check.question;
    const why = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Why this appeared';
    const basis = document.createElement('p'); basis.textContent = check.basis;
    const limitation = document.createElement('p'); limitation.textContent = check.limitation;
    why.append(summary, basis, limitation);
    item.append(title, detail, question, why);
    checkList.append(item);
  }
  const holdings = $('#holding-list');
  holdings.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p'); empty.textContent = 'Confirmed rows will appear here.'; holdings.append(empty);
  } else for (const [index, row] of rows.entries()) {
    const savedRow = state.account?.portfolio?.holdings?.[index];
    const item = document.createElement('div'); item.className = 'holding-item';
    const name = document.createElement('strong'); name.textContent = `#${index + 1} ${row.name}`;
    const meta = document.createElement('span'); meta.textContent = `${row.granularity === 'fund_house' ? 'Fund-house summary; schemes unknown' : row.type} · ${row.asset} · ${money(row.value)} · ${row.asOf || 'date unknown'} · originally from ${entryOriginText(row.entryOrigin)}${row.valuationOrigin ? ` · latest value from ${valuationOriginText(row.valuationOrigin)}` : ''}${row.shares ? ` · ${row.shares} reported shares; verify current balance` : ''}${savedRow?.navEstimate ? ' · user-entered NAV estimate; units assumed unchanged' : ''}${savedRow?.stockEstimate ? ' · user-entered stock-price estimate; shares assumed unchanged' : ''}${row.costBasis !== undefined ? ` · invested ${money(row.costBasis)} checked ${row.costBasisAsOf}` : ''}`;
    item.append(name, meta);
    const dateIssue = valuationDateIssue(row.asOf);
    if (dateIssue) {
      const badge = document.createElement('span');
      badge.className = 'valuation-badge';
      badge.textContent = dateIssue === 'stale' ? 'Value over 90 days old · check a newer source' :
        dateIssue === 'future' ? 'Future value date · check the source' : 'Value date missing · check the source';
      item.append(badge);
    }
    holdings.append(item);
  }
  renderGoalReview();
  renderAccountActions();
}

function renderGoalReview() {
  const root = $('#goal-review');
  root.replaceChildren();
  const review = buildAssistantGoalReview(state.account?.portfolio);
  const paragraph = message => { const p = document.createElement('p'); p.textContent = message; return p; };
  if (review.kind === 'none') {
    root.append(paragraph('No goal yet. A goal is needed for a goal-specific comparison.'));
    return;
  }
  const name = document.createElement('strong'); name.className = 'goal-name'; name.textContent = review.name;
  root.append(name);
  const portfolio = state.account?.portfolio;
  const selectedGoal = portfolio?.goals?.find(goal => goal.id === portfolio.activeGoalId);
  const shared = (portfolio?.holdings || []).flatMap(row => {
    const share = goalShare(selectedGoal, row.id);
    return share > 0 && share < 100 ? [`${row.name}: ${share}% (${money(row.value * share / 100)})`] : [];
  });
  if (shared.length) root.append(paragraph(`Shared holdings counted here: ${shared.slice(0, 3).join('; ')}${shared.length > 3 ? `; and ${shared.length - 3} more` : ''}.`));
  const otherGoals = portfolio?.goals?.filter(goal => goal.id !== portfolio.activeGoalId) || [];
  if (otherGoals.length) root.append(paragraph(`Other goals: ${otherGoals.map(goal => goal.name).join(', ')}. Say “select goal NAME” to review one, “count HOLDING toward goal NAME” to assign an unassigned holding, or “split HOLDING: 60% to goal NAME, 40% to goal OTHER” to share one.`));
  else root.append(paragraph('Need another goal? Say “create goal named Education”.'));
  if (portfolio?.reserve) root.append(paragraph(
    `Your separate accessible money of ${money(portfolio.reserve.accessibleMoney)} divided by ${money(portfolio.reserve.monthlyEssentials)} monthly essentials is ${reserveMonths(portfolio.reserve).toFixed(1)} months. These are your totals outside the reviewed holdings, not a check that this reserve is enough or available.`));
  else root.append(paragraph('Optional context: say “monthly essentials ₹50,000” and “accessible money outside holdings ₹3 lakh” to compare separate money with essential spending. You will confirm both totals before they are saved.'));
  if (review.kind === 'draft') {
    root.append(paragraph(review.missing.length ?
      `This goal still needs your ${review.missing.join(', ')}. No goal scenario is shown yet.` :
      'The saved goal is unfinished. Confirm its details before using a goal scenario.'));
    root.append(paragraph(`${review.linkedCount} confirmed holding${review.linkedCount === 1 ? '' : 's'} assigned: ${money(review.linkedValue)} in supplied values. These are included in the portfolio total only once.`));
    if (review.mixPlan) root.append(paragraph(`Your chosen mix is saved: ${Object.entries(review.mixPlan).map(([asset, share]) => `${asset} ${share}%`).join(', ')}. The comparison waits for confirmed goal details.`));
    return;
  }
  const expenseText = { separate: 'You said a nearer unexpected essential expense would use separate money outside this goal.',
    goal_holdings: 'You said a nearer unexpected essential expense may use holdings assigned to this goal. Check how using them early would change the goal plan.',
    unsure: 'You are unsure where money for a nearer unexpected essential expense would come from. Check this before relying on the goal illustration.' };
  root.append(paragraph(review.emergencyFunding ? expenseText[review.emergencyFunding] :
    'For this goal, where would money for a nearer unexpected essential expense come from? In chat, say “unexpected expense from separate money”, “unexpected expense from goal holdings”, or “unsure about unexpected expenses”. Your answer needs confirmation.'));
  const stats = document.createElement('div'); stats.className = 'goal-stats';
  for (const [label, value] of [
    ['Target today', money(review.target)], ['Assigned now', money(review.linkedValue)],
    ['Years away', String(review.years)], ['Gap today', money(review.gapToday)],
  ]) {
    const cell = document.createElement('div');
    const small = document.createElement('span'); small.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    cell.append(small, strong); stats.append(cell);
  }
  root.append(stats);
  if (Number.isInteger(review.age)) root.append(paragraph(
    `You entered your age as ${review.age} today. This should be your age, even if the goal is for someone else; it does not set an asset mix.`));
  const coverageLabel = value => ({ all: 'all included', some: 'some missing',
    none: 'none owned', unsure: 'unsure' })[value] || 'not answered';
  root.append(paragraph(`Snapshot scope: mutual funds ${coverageLabel(review.coverage?.mutualFunds)}; direct stocks ${coverageLabel(review.coverage?.directStocks)}. These are your answers, not verified account coverage. Goal figures use only confirmed holdings assigned here; missing investments are outside the calculation.`));
  root.append(paragraph(`${review.linkedCount} confirmed holding${review.linkedCount === 1 ? '' : 's'} assigned to this goal; ${review.dateCheckCount} need a valuation-date check. Other confirmed holdings are excluded from these goal figures.`));
  if (review.accessCheck.count) root.append(paragraph(
    `${money(review.accessCheck.value)} in manually entered other investments is linked to this goal. The gap today includes that gross value; access at the goal date has not been checked.`));
  if (review.mixPlan) {
    const heading = document.createElement('h4'); heading.textContent = 'Your chosen mix'; root.append(heading);
    if (review.mixComparison) {
      const comparison = document.createElement('div'); comparison.className = 'mix-compare';
      for (const row of review.mixComparison) {
        const line = document.createElement('p');
        line.textContent = `${row.asset}: ${row.currentPct.toFixed(1)}% in linked holdings · ${row.plannedPct.toFixed(1)}% you chose · ${Math.abs(row.differencePct).toFixed(1)} percentage points ${row.differencePct >= 0 ? 'above' : 'below'}`;
        comparison.append(line);
      }
      root.append(comparison);
      root.append(paragraph('This compares dated values and asset labels you supplied. It does not account for fund constituents, tax or transaction costs, and it is not a trade instruction. Say “clear goal mix” to remove the comparison.'));
    } else {
      const pause = { no_holdings: 'Link at least one holding to this goal first.',
        other_investment: 'Linked NPS, EPF, deposit or other manual savings have no verified asset split; compare only what their source confirms.',
        unclassified: 'Classify linked holdings labelled Other from their source before comparing.',
        valuation_dates: 'Check missing, future or old valuation dates on linked holdings before comparing.',
        conflicting_identity: 'Check holdings with conflicting labels for the same ISIN before comparing.',
        fund_house: 'A linked fund-house total needs scheme detail before comparing.' };
      root.append(paragraph(`Comparison paused. ${pause[review.mixPause] || 'Check the goal and its linked holdings before comparing.'}`));
    }
  } else root.append(paragraph('Already chosen a mix for this goal? Say “goal mix 60% equity, 30% debt, 10% gold” to compare your linked holdings. The percentages are yours to choose.'));
  const stressHeading = document.createElement('h4'); stressHeading.textContent = 'What if equity fell?'; root.append(stressHeading);
  if (review.stressPause === 'no_assumption') {
    root.append(paragraph('Choose a hypothetical fall by saying “equity fall 25%”. This is a one-time calculation, not a prediction.'));
    if (review.lossInputs.affordable !== undefined || review.lossInputs.tolerable !== undefined)
      root.append(paragraph(`Your saved loss amounts: could cover ${review.lossInputs.affordable === undefined ? 'not entered' : money(review.lossInputs.affordable)}; could tolerate ${review.lossInputs.tolerable === undefined ? 'not entered' : money(review.lossInputs.tolerable)}. Choose a hypothetical fall to compare them.`));
  } else if (review.stressPause) {
    const pause = { no_holdings: 'Link a holding to this goal first.',
      valuation_dates: 'Check missing, future or old dates on linked holdings first.',
      access_uncertain: 'Check when linked other investments can be used for this goal first.',
      unclassified: 'Classify linked holdings labelled Other from their source first.',
      fund_house: 'A linked fund-house total needs scheme detail first.' };
    root.append(paragraph(`Stress calculation paused. ${pause[review.stressPause] || 'Check the goal and its linked holdings first.'}`));
  } else {
    const shock = review.shock;
    root.append(paragraph(`If linked Equity holdings fell ${shock.dropPct}% once: their entered value would fall by ${money(shock.loss)}; assigned value would be ${money(shock.valueAfterLoss)}; the gap to today’s goal cost would be ${money(shock.gapAfterLoss)}. Other asset values are held fixed in this illustration.`));
    const { affordable, tolerable, capacityGap } = review.lossLimits;
    if (affordable || tolerable) root.append(paragraph(`${affordable ? `You said you could cover ${money(affordable.limit)}; this loss ${affordable.excess > 0 ? `exceeds that by ${money(affordable.excess)}` : 'does not exceed it'}. ` : ''}${tolerable ? `You said you could tolerate ${money(tolerable.limit)}; this loss ${tolerable.excess > 0 ? `exceeds that by ${money(tolerable.excess)}` : 'does not exceed it'}. ` : ''}${capacityGap !== null ? `Your tolerable amount is ${money(capacityGap)} above the amount you said you could cover; check whether that could delay the goal or essential spending. ` : ''}These are your own amounts, not a risk score.`));
    else root.append(paragraph('Optional: say “loss I can cover ₹50,000” or “loss I can tolerate ₹50,000” to compare this example with your own amounts.'));
    root.append(paragraph('This uses supplied dated values and asset labels. It excludes future growth, contributions, inflation, taxes and changes in other assets; actual losses could be larger.'));
  }
  if (portfolio?.goals?.length === 1) {
    const linked = new Set(portfolio.goals[0].linkedIds);
    const unassigned = portfolio.holdings.filter(row => row.id && !linked.has(row.id));
    if (unassigned.length) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'goal-assign';
      button.textContent = `Count ${unassigned.length} unassigned holding${unassigned.length === 1 ? '' : 's'} for this goal`;
      button.disabled = state.busy;
      button.addEventListener('click', assignGoalHoldings);
      root.append(button);
    }
  }
  if (review.scenarioStatus === 'assumptions') {
    const names = { monthlyContribution: 'monthly contribution', returnPct: 'annual growth assumption',
      inflationPct: 'annual inflation assumption' };
    root.append(paragraph(`Future illustration paused until you confirm your ${review.missingAssumptions.map(field => names[field]).join(', ')}. In chat, use “monthly contribution ₹5,000”, “growth assumption 0%” and “inflation assumption 0%” with values you choose. A zero is valid when you deliberately choose it.`));
  } else if (review.scenarioStatus === 'valuation_dates') {
    root.append(paragraph('Future illustration paused until the linked holding dates are checked. Refresh missing, future or old values from their source.'));
  } else if (review.scenarioStatus === 'access_uncertain') {
    root.append(paragraph(`Future illustration paused while linked other investments have no checked access date. This review cannot record a spendable amount from them at the goal date. Check the product terms; if one should not fund this goal, say “uncount HOLDING from goal ${review.name}”. The holding stays in your portfolio.`));
  } else if (review.scenario) root.append(paragraph(
    `Illustration at the goal date: ${money(review.scenario.projectedValue)} against ${money(review.scenario.futureCost)} future cost; gap ${money(review.scenario.futureGap)}. Your confirmed assumptions: ${money(review.assumptions.monthlyContribution)}/month added at each month’s end, ${review.assumptions.returnPct}% constant annual growth and ${review.assumptions.inflationPct}% constant inflation. Only the assigned confirmed holdings start this calculation. This is arithmetic, not a forecast.`));
}

async function assignGoalHoldings() {
  if (state.busy) return;
  if (!state.account) { say('note', 'Add and confirm a holding and goal before assigning them.'); return; }
  if (state.drafts.length || state.goalFacts || state.reserveFacts || state.correction || state.refresh) {
    say('note', 'Confirm or discard the pending holding, goal, reserve or report change before assigning holdings.');
    return;
  }
  const prepared = prepareAssistantGoalAssignment(state.account.portfolio);
  if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
  if (!window.confirm(`Count ${prepared.addedCount} currently unassigned confirmed holding${prepared.addedCount === 1 ? '' : 's'} toward the selected goal? Their value will appear in its comparison.`)) return;
  state.busy = true; renderCredits(); renderGoalReview();
  try {
    await writeAccount(prepared.portfolio,
      'The saved review changed in another tab. Check the latest goal and holdings before assigning them.');
    say('note', `${prepared.addedCount} holding${prepared.addedCount === 1 ? '' : 's'} now counted toward the selected goal. The portfolio total has not changed.`);
    if (browserOnly) {
      const next = nextGoalSetupQuestion(state.account?.portfolio);
      if (next) say('assistant', next);
    }
  } catch (error) { say('note', error.message || 'The goal assignment could not be saved.'); }
  finally { state.busy = false; renderCredits(); renderGoalReview(); renderGoalDraft(); }
}

function normalizedDraft(row, defaultOrigin = 'manual') {
  if (!row || typeof row.name !== 'string' || !row.name.trim() ||
      !['Mutual fund', 'Stock', 'Other investment', 'Other'].includes(row.type) ||
      !['Equity', 'Debt', 'Gold', 'Other'].includes(row.asset) ||
      (row.shares !== undefined && (row.type !== 'Stock' || !validShares(row.shares))) ||
      (row.granularity != null && (row.granularity !== 'fund_house' || row.type !== 'Mutual fund' ||
        typeof row.amc !== 'string' || !row.amc.trim()))) return null;
  const value = Number(row.value);
  return { name: row.name.trim().slice(0, 80), type: row.type, asset: row.asset,
    value: row.value == null || !Number.isFinite(value) ? null : value,
    asOf: /^\d{4}-\d{2}-\d{2}$/.test(row.asOf || '') ? row.asOf : null,
    entryOrigin: row.entryOrigin || defaultOrigin,
    ...(row.valuationOrigin && ['manual', 'broker_xlsx', 'broker_csv'].includes(row.valuationOrigin) ?
      { valuationOrigin: row.valuationOrigin } : {}),
    ...(row.isin ? { isin: row.isin } : {}),
    ...(row.amc ? { amc: row.amc } : {}),
    ...(row.amfi ? { amfi: row.amfi } : {}),
    ...(row.units ? { units: row.units } : {}),
    ...(row.shares ? { shares: row.shares } : {}),
    ...(row.granularity === 'fund_house' ? { granularity: 'fund_house' } : {}),
    ...(row.statementCategory ? { statementCategory: row.statementCategory } : {}),
    ...(Number.isFinite(row.costBasis) && row.costBasis > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.costBasisAsOf || '') ?
      { costBasis: row.costBasis, costBasisAsOf: row.costBasisAsOf } : {}) };
}

function acceptAccount(payload) {
  state.account = { portfolio: payload.portfolio, revision: payload.revision };
  if (browserOnly) reviewChangeSerial++;
  const sourceRows = Array.isArray(payload.portfolio?.holdings) ? payload.portfolio.holdings : [];
  state.confirmed = sourceRows.map(row => normalizedDraft(row)).filter(row => row &&
    Number.isFinite(row.value) && row.value > 0);
  if (state.confirmed.length) hideStarterActions();
  renderGoalDraft(); renderReview();
  return { loaded: state.confirmed.length, omitted: sourceRows.length - state.confirmed.length };
}

async function writeAccount(portfolio, conflictMessage) {
  if (browserOnly) {
    acceptAccount({ portfolio, revision: state.account.revision + 1 });
    await saveDeviceReview(portfolio);
    return;
  }
  const response = await fetch('/api/portfolio', { method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Thefinxperts-Intent': 'portfolio-write',
      'X-Thefinxperts-Revision': String(state.account.revision) },
    body: JSON.stringify(portfolio) });
  const result = await response.json();
  if (response.status === 409) {
    const latest = await fetch('/api/portfolio', { cache: 'no-store' });
    if (latest.ok) acceptAccount(await latest.json());
    throw new Error(conflictMessage);
  }
  if (!response.ok) throw new Error(result.error || 'The account save failed. Your draft is still here.');
  acceptAccount({ portfolio, revision: result.revision });
}

async function aiTurn(message, pdf = null) {
  if (browserOnly) {
    const portfolio = state.account?.portfolio;
    const holdings = portfolio?.holdings || state.confirmed;
    const goal = portfolio?.goals?.find(item => item.id === portfolio.activeGoalId) ||
      { name: 'My goal', age: null, years: null, target: null, confirmed: false, linkedIds: [] };
    const result = analyzePortfolio(holdings, goal, new Date(), portfolio?.reserve, portfolio?.coverage);
    const response = answerReviewQuestion(message, { holdings, goal,
      source: 'user', coverage: portfolio?.coverage || null, reserve: portfolio?.reserve || null, result });
    if (response) say('assistant', `${response.text}\n\nHow I worked this out: ${response.basis}\n\nKeep in mind: ${response.limitation}`);
    else say('assistant', 'Ask about the holdings you entered, or upload a supported CAMS Active Statement or broker report.');
    return;
  }
  // The server answers some bounded questions without a provider call or credit.
  // Let it decide whether this message needs AI, even when the displayed balance
  // is zero or the provider-wide attempt budget has been reached.
  if (!state.available && !state.capacityReached) {
    say('note', 'The assistant is unavailable for this account. Your confirmed dashboard still works in this tab.');
    return;
  }
  assistantStatusRevision++;
  state.busy = true; $('#send').disabled = true; $('#service-status').textContent = 'Reviewing…';
  try {
    const response = await fetch('/api/assistant', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Thefinxperts-Local': '1', 'X-Thefinxperts-Intent': 'assistant' },
      body: JSON.stringify({ message, history: state.history.slice(0, -1).slice(-8),
        holdings: state.confirmed.slice(0, 100).map(({ name, type, asset, value, asOf }) => ({ name, type, asset, value, asOf })),
        drafts: state.drafts.map(({ name, type, asset, value, asOf }) => ({ name, type, asset, value, asOf })),
        ...(pdf ? { pdf } : {}) }) });
    const result = await response.json();
    if (result.credits && Number.isInteger(result.credits.remaining)) {
      state.credits = result.credits;
      renderCredits();
      creditChannel?.postMessage({ type: 'balance-changed' });
    }
    if (result.code === 'service_capacity') state.capacityReached = true;
    if (!response.ok) throw new Error(result.error || 'The assistant could not answer.');
    state.capacityReached = false;
    say('assistant', result.answer, result.nextQuestion);
    if (result.creditUsed === true && Number.isInteger(result.credits?.remaining)) {
      say('note', `1 free AI credit used · ${result.credits.remaining} of ${result.credits.freeTotal} left on this account.`);
    }
    const drafts = (result.draftHoldings || []).map(row => normalizedDraft(row)).filter(Boolean);
    if (drafts.length) { state.drafts = mergeAssistantDrafts(state.drafts, drafts); renderDrafts(); }
    if (result.goalFacts && typeof result.goalFacts === 'object' && Object.keys(result.goalFacts).length) {
      state.goalFacts = { ...(state.goalFacts || {}), ...result.goalFacts };
      state.goalDraftGoalId = state.account?.portfolio?.activeGoalId || null;
      renderGoalDraft();
    }
    renderReview();
  } catch (error) { say('note', error.message || 'The assistant could not answer.'); }
  finally { state.busy = false; renderCredits(); renderDrafts(); renderGoalDraft(); $('#service-status').textContent = assistantStatusText(); }
}

function clearFile() {
  state.file = null; $('#upload').value = ''; $('#file-chip').hidden = true;
  $('#file-label').textContent = ''; $('#remove-file').hidden = true;
  $('#active-option').hidden = true; $('#active-password').value = '';
  $('#cas-option').hidden = true; $('#cas-password').value = '';
  $('#pdf-consent-label').hidden = true; $('#pdf-consent').checked = false;
}

function setFileLabel(message) {
  $('#file-chip').hidden = false;
  $('#file-label').textContent = message;
  $('#remove-file').hidden = !state.file;
}

async function encodedPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

$('#remove-file').addEventListener('click', () => {
  if (state.busy) return;
  clearFile(); say('note', 'Selected PDF removed. You can ask a question or attach another report.');
});

function stageActiveStatement(parsed) {
  if (!parsed.holdings.length || parsed.errors.length) return false;
  if (parsed.holdings.length > 30) {
    say('note', 'This guided chat can confirm up to 30 holdings at once. Use the detailed review on the main page for a larger Active Statement.');
    clearFile();
    return true;
  }
  const drafts = parsed.holdings.map(row => normalizedDraft(row, 'active_statement'));
  if (drafts.some(row => !row)) {
    say('note', 'A statement row could not be represented safely in this chat. Use the detailed review to inspect the whole statement.');
    clearFile();
    return true;
  }
  const existingFunds = state.account?.portfolio?.holdings?.filter(row => row.type === 'Mutual fund') || [];
  if (existingFunds.some(row => row.entryOrigin === 'active_statement')) {
    const prepared = prepareAssistantActiveRefresh(state.account.portfolio, drafts);
    if (prepared.repeated) say('note', prepared.description);
    else if (prepared.errors.length) say('note', prepared.errors.join(' '));
    else {
      state.refresh = { ...prepared, revision: state.account.revision };
      renderRefresh();
      say('assistant', 'I found a newer CAMS snapshot. Review every updated, added and absent fund row before applying it. The dashboard has not changed yet.');
    }
    clearFile();
    return true;
  }
  state.drafts = drafts;
  renderDrafts();
  const summaries = state.drafts.filter(row => row.granularity === 'fund_house').length;
  const detail = parsed.schemeDetailStatus === 'reconciled' ?
    'Scheme rows reconciled to the fund-house totals.' : parsed.schemeDetailStatus === 'unreconciled_fallback' ?
      'Scheme rows did not fully reconcile; only fund-house summaries were staged. Scheme-level holdings are missing.' :
      'This statement supplied fund-house summaries without scheme rows.';
  say('note', `Found ${state.drafts.length} possible fund ${state.drafts.length === 1 ? 'holding' : 'holdings'} in the CAMS Active Statement. ${importValueAndDates(state.drafts)} Fund-house source total ${rupees(parsed.summaryTotal)}. ${detail} ${summaries ? `${summaries} ${summaries === 1 ? 'is a fund-house summary' : 'are fund-house summaries'} without scheme detail. ` : ''}The PDF stayed in this browser. Check the rows before using them.`);
  clearFile();
  return true;
}

async function offerUnsupportedPdf(file, parsed, allowAi = true) {
  if (browserOnly) {
    if (!/\.pdf$/i.test(file.name)) {
      say('note', parsed.errors[0] || 'This is not a supported statement or holdings report. No holdings were added.');
      clearFile(); return;
    }
    state.file = file;
    setFileLabel('PDF selected · not sent');
    $('#active-option').hidden = true;
    $('#cas-option').hidden = false;
    $('#pdf-consent-label').hidden = true;
    say('note', `${parsed.errors[0] || 'This PDF is not a supported CAMS Active Statement.'} If it is an original CAMS, KFintech, NSDL or CDSL CAS, enter its password if needed and choose “Read as CAS in browser”.`);
    return;
  }
  const casAvailable = await casStatusPromise;
  if (!/\.pdf$/i.test(file.name) || file.size > (casAvailable ? 15_000_000 : 4_000_000)) {
    say('note', parsed.errors[0] || 'This file could not be read. Try a supported PDF or a holdings export.');
    clearFile(); return;
  }
  state.file = file;
  setFileLabel('PDF selected · not sent yet');
  $('#active-option').hidden = true;
  $('#cas-option').hidden = !casAvailable;
  $('#pdf-consent-label').hidden = !allowAi || file.size > 4_000_000;
  say('note', casAvailable ?
    `This is not a supported CAMS Active Statement preview. If it is an original CAS, enter its password and choose private CAS reading.${allowAi && file.size <= 4_000_000 ? ' You may instead explicitly allow AI extraction. Extracted rows need your confirmation.' : ''}` :
    `This is not a supported CAMS Active Statement preview.${allowAi && file.size <= 4_000_000 ? ' You can explicitly allow AI extraction of this PDF, or describe the holdings in chat instead. Extracted rows need your confirmation.' : ' You can describe the holdings in chat instead.'}`);
}

function stageCasResult(result) {
  const prepared = prepareAssistantCasDrafts(result, { local: state.casLocal, browser: browserOnly });
  if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return false; }
  const drafts = prepared.drafts.map(row => normalizedDraft(row));
  if (drafts.some(row => !row)) { say('note', 'A CAS row could not be staged safely. No rows were added.'); return false; }
  if (state.account?.portfolio) {
    const refresh = result.source === 'Demat CAS' ?
      prepareAssistantDematRefresh(state.account.portfolio, drafts) :
      prepareAssistantCasRefresh(state.account.portfolio, drafts);
    if (refresh) {
      if (refresh.repeated) say('note', refresh.description);
      else if (refresh.errors.length) say('note', refresh.errors.join(' '));
      else {
        state.refresh = { ...refresh, revision: state.account.revision };
        renderRefresh();
        say('assistant', `I found exact ${refresh.kind === 'demat' ? 'demat position' : 'scheme'} matches in a newer CAS. Review each dated update before applying it. Unmatched rows remain outside this refresh.`);
      }
      clearFile(); return true;
    }
  }
  state.drafts = drafts;
  renderDrafts(); say('note', prepared.message); clearFile();
  return true;
}

$('#active-preview').addEventListener('click', async () => {
  if (state.busy || !state.file) return;
  const password = $('#active-password').value;
  if (!password) { say('note', 'Enter this PDF’s password to read it in your browser.'); return; }
  state.busy = true; renderCredits();
  try {
    const parsed = await previewActiveStatementFile(state.file, password);
    if (stageActiveStatement(parsed)) return;
    if (parsed.errors.some(error => /different password/i.test(error))) {
      say('note', 'That password did not open the PDF. Try again.'); return;
    }
    await offerUnsupportedPdf(state.file, parsed, false);
  } finally { $('#active-password').value = ''; state.busy = false; renderCredits(); renderDrafts(); }
});

$('#cas-preview').addEventListener('click', async () => {
  if (state.busy || !state.file || (!state.casAvailable && !browserOnly)) return;
  const password = $('#cas-password').value;
  if (!password && !browserOnly) { say('note', 'Enter this original CAS PDF’s password to read it privately.'); return; }
  state.busy = true; renderCredits(); setFileLabel(browserOnly ?
    'Reading the selected CAS in this browser…' : 'Reading the selected CAS with the signed-in server…');
  try {
    let result;
    if (browserOnly) {
      const active = await previewActiveStatementFile(state.file, password);
      if (stageActiveStatement(active)) return;
      result = await previewBrowserCas(state.file, password);
    }
    else {
      const response = await fetch('/api/cas/preview', { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Thefinxperts-Intent': 'cas-preview',
        ...(state.casLocal ? { 'X-Thefinxperts-Local': '1' } : {}),
      }, body: JSON.stringify({ pdf: await encodedPdf(state.file), password }) });
      result = await response.json();
      if (!response.ok && result.error) { say('note', result.error); return; }
    }
    stageCasResult(result);
  } catch { say('note', browserOnly ? 'The browser CAS preview failed. Try again or remove the PDF.' :
    'The private CAS preview failed. Try again or remove the PDF.'); }
  finally { $('#cas-password').value = ''; state.busy = false; renderCredits(); renderDrafts();
    if (state.file) setFileLabel('PDF selected · not sent to AI'); }
});

$('#upload').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  hideStarterActions();
  if (state.reserveFacts) { say('note', 'Save or discard the separate reserve totals before opening another report.'); clearFile(); return; }
  if (state.refresh) { say('note', 'Apply or discard the pending statement refresh before opening another report.'); clearFile(); return; }
  if (state.correction) { say('note', 'Apply or discard the pending holding correction before opening another report.'); clearFile(); return; }
  if (state.drafts.length && !window.confirm('Replace the unconfirmed holdings already in this chat with this report?')) {
    clearFile(); return;
  }
  if (state.drafts.length) { state.drafts = []; renderDrafts(); }
  if (/\.(?:csv|xlsx)$/i.test(file.name)) {
    state.busy = true; renderCredits();
    setFileLabel('Reading selected report in this browser…');
    try {
      const result = await previewAssistantImport(file, { aiAvailable: !browserOnly });
      if (result.errors.length) say('note', result.errors.join(' '));
      else {
        const drafts = result.drafts.map(row => normalizedDraft(row));
        if (drafts.some(row => !row)) say('note', 'A report row could not be staged safely. No rows were added. Use the detailed review to inspect the report.');
        else {
          const origin = drafts[0]?.entryOrigin;
          const prepared = prepareAssistantBrokerRefresh(state.account?.portfolio, drafts, origin);
          if (prepared?.errors?.length) say('note', prepared.errors.join(' '));
          else if (prepared) {
            state.refresh = { ...prepared, revision: state.account.revision };
            renderRefresh();
            say('assistant', 'I found newer values for saved positions with exact ISIN matches. Review the changes before applying them. The dashboard has not changed yet.');
          } else { state.drafts = drafts; renderDrafts(); say('note', result.message); }
        }
      }
    } finally { state.busy = false; clearFile(); renderCredits(); renderDrafts(); }
    return;
  }
  if (file.size > 15_000_000) { say('note', 'Choose a PDF smaller than 15 MB.'); clearFile(); return; }
  setFileLabel('Reading selected statement in this browser…');
  let parsed = await previewActiveStatementFile(file);
  if (parsed.errors.some(error => /different password/i.test(error))) {
    state.file = file;
    setFileLabel('Password-protected PDF selected · not sent');
    $('#active-option').hidden = browserOnly;
    $('#cas-option').hidden = !(browserOnly || await casStatusPromise);
    $('#pdf-consent-label').hidden = true;
    say('note', browserOnly ?
      'Enter the PDF password once and choose “Read statement”. This browser will try a CAMS Active Statement and supported CAMS, KFintech, NSDL or CDSL CAS without sending the PDF or password.' :
      'Enter the PDF password in a masked field to try the browser preview. For an original CAS, signed-in private reading is available when enabled.');
    return;
  }
  if (stageActiveStatement(parsed)) return;
  if (browserOnly && /\.pdf$/i.test(file.name)) {
    state.busy = true; renderCredits(); setFileLabel('Trying supported statement readers in this browser…');
    try {
      stageCasResult(await previewBrowserCas(file));
    } catch { say('note', 'This PDF could not be safely read as a supported statement. No holdings were added.'); }
    finally { state.busy = false; clearFile(); renderCredits(); renderDrafts(); }
    return;
  }
  await offerUnsupportedPdf(file, parsed);
});

$('#composer').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  const message = $('#message').value.trim();
  if (!message && !state.file) return;
  if (message && !state.file && /^count all (?:unassigned )?holdings toward (?:this|selected) goal[.!]?$/i.test(message)) {
    say('user', message); $('#message').value = '';
    await assignGoalHoldings();
    return;
  }
  const goalCommand = message && !state.file ? parseAssistantGoalCommand(message) : null;
  if (goalCommand) {
    say('user', message); $('#message').value = '';
    if (!state.account) { say('note', 'Saved goal commands need a signed-in portfolio account.'); return; }
    if (state.goalFacts || state.reserveFacts) {
      say('note', 'Confirm or discard the current goal or reserve draft before changing goals or assignments.'); return;
    }
    let prepared = prepareAssistantGoalCommand(state.account.portfolio, goalCommand);
    if (browserOnly && goalCommand.kind === 'create' && state.account.portfolio?.goals?.length === 1) {
      const placeholder = state.account.portfolio.goals[0];
      if (placeholder.name === 'My goal' && placeholder.confirmed === false &&
          placeholder.age == null && placeholder.years == null && placeholder.target == null &&
          goalCommand.goalName.length >= 2 && goalCommand.goalName.length <= 60) {
        const portfolio = structuredClone(state.account.portfolio);
        portfolio.goals[0].name = goalCommand.goalName;
        prepared = { portfolio, errors: [], description: `Named the unfinished goal ${goalCommand.goalName}.` };
      }
    }
    if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
    state.busy = true; renderCredits(); renderGoalDraft();
    try {
      await writeAccount(prepared.portfolio,
        'The saved review changed in another tab. Check the latest goals and holdings, then repeat the command.');
      const selected = prepared.portfolio.goals.find(goal => goal.id === prepared.portfolio.activeGoalId);
      say('assistant', prepared.description, browserOnly ? nextBrowserGoalQuestion(selected) : null);
    } catch (error) { say('note', error.message || 'The goal change could not be saved.'); }
    finally { state.busy = false; renderCredits(); renderGoalDraft(); renderGoalReview(); }
    return;
  }
  if (message && !state.file && state.drafts.length) {
    const batch = classifyDraftsByNumbers(state.drafts, message);
    if (batch) {
      say('user', message); $('#message').value = '';
      if (batch.error) say('note', batch.error);
      else {
        state.drafts = batch.drafts; renderDrafts();
        say('assistant', `Drafts ${batch.numbers.map(number => `#${number}`).join(', ')} are labelled ${batch.asset}. Check every row against its individual scheme source before confirming. Saved holdings have not changed.`, batch.nextQuestion);
      }
      return;
    }
    const skipped = skipDraftFromMessage(state.drafts, message);
    if (skipped) {
      say('user', message); $('#message').value = '';
      if (skipped.error) say('note', skipped.error);
      else {
        state.drafts = skipped.drafts; renderDrafts();
        say('assistant', `${skipped.changedName} removed from the unconfirmed list. The saved review has not changed.`,
          nextDraftQuestion(state.drafts));
      }
      return;
    }
    const clarified = clarifyDrafts(state.drafts, message);
    if (clarified) {
      say('user', message);
      $('#message').value = '';
      state.drafts = clarified.drafts; renderDrafts();
      say('assistant', `${clarified.changedName} updated. Check the row against your source before confirming.`,
        clarified.nextQuestion);
      return;
    }
  }
  const correction = message && !state.file ? parseHoldingCorrection(message) : null;
  if (correction) {
    say('user', message); $('#message').value = '';
    if (correction.error) { say('note', correction.error); return; }
    if (state.correction) { say('note', 'Apply or discard the change already shown before preparing another.'); return; }
    if (state.drafts.length || state.goalFacts || state.reserveFacts) {
      say('note', 'Confirm or discard the current holding, goal or reserve draft before correcting a confirmed row.'); return;
    }
    if (!state.account?.portfolio) {
      say('note', 'Add and confirm a holding before correcting it.'); return;
    }
    const prepared = prepareHoldingCorrection(state.account.portfolio, correction);
    if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
    state.correction = { ...prepared, kind: correction.kind, revision: state.account.revision };
    renderCorrection();
    say('assistant', 'I prepared this change to your confirmed review. Check the holding and supplied facts in the preview, then choose “Apply correction” or discard it.');
    return;
  }
  const coverageAnswer = message && !state.file ? parseCoverageAnswer(message) : null;
  if (coverageAnswer) {
    say('user', message); $('#message').value = '';
    if (state.correction) { say('note', 'Apply or discard the change already shown before preparing another.'); return; }
    if (state.drafts.length || state.goalFacts || state.reserveFacts) {
      say('note', 'Confirm or discard the current holding, goal or reserve draft before changing review coverage.'); return;
    }
    const prepared = prepareCoverageAnswer(state.account?.portfolio, coverageAnswer);
    if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
    state.correction = { ...prepared, kind: 'coverage',
      firstCoverageAnswer: !state.account?.portfolio?.coverage, revision: state.account.revision };
    renderCorrection();
    say('assistant', 'I staged your coverage answer. Check it against current statements, then apply or discard it.');
    return;
  }
  const reserveAnswer = message && !state.file ? parseAssistantReserveFact(message) : null;
  if (reserveAnswer) {
    say('user', message); $('#message').value = '';
    if (reserveAnswer.error) { say('note', reserveAnswer.error); return; }
    if (!state.account) { say('note', 'The saved review has not loaded yet. Try again when it is available.'); return; }
    if (state.drafts.length || state.goalFacts || state.correction || state.refresh) {
      say('note', 'Confirm or discard the current review change before adding separate reserve totals.'); return;
    }
    if (reserveAnswer.clear && !state.account.portfolio?.reserve) {
      say('note', 'No separate reserve totals are saved in this review.'); return;
    }
    if (state.reserveFacts === null) state.reserveDraftRevision = state.account.revision;
    state.reserveFacts = reserveAnswer.clear ? { clear: true } :
      { ...(state.reserveFacts?.clear ? {} : state.reserveFacts || {}), ...reserveAnswer.facts };
    renderReserveDraft();
    say('assistant', reserveAnswer.clear ?
      'I staged removal of the two separate reserve totals. Check the preview, then confirm or discard.' :
      `I staged that separate reserve amount. ${nextAssistantReserveQuestion(state.account.portfolio, state.reserveFacts)}`);
    return;
  }
  const emergencyAnswer = message && !state.file ? parseAssistantEmergencyFunding(message) : null;
  if (emergencyAnswer) {
    say('user', message); $('#message').value = '';
    if (emergencyAnswer.error) { say('note', emergencyAnswer.error); return; }
    if (!state.account) { say('note', 'The saved review has not loaded yet. Try again when it is available.'); return; }
    const selectedGoal = state.account.portfolio?.goals?.find(goal => goal.id === state.account.portfolio.activeGoalId);
    if (!selectedGoal?.confirmed) { say('note', 'Confirm a selected goal before answering where a nearer expense would come from.'); return; }
    if (state.reserveFacts || state.drafts.length || state.correction || state.refresh) {
      say('note', 'Confirm or discard the current review change before answering for a goal.'); return;
    }
    if (state.goalFacts && state.goalDraftGoalId !== selectedGoal.id) {
      say('note', 'Confirm or discard the current goal draft before answering for the selected goal.'); return;
    }
    state.goalFacts = { ...(state.goalFacts || {}), ...emergencyAnswer.facts };
    state.goalDraftGoalId = selectedGoal.id;
    renderGoalDraft();
    say('assistant', 'I staged your answer for the selected goal. Check it in the goal draft, then save or discard it. This does not change any holding or select a trade.');
    return;
  }
  if (browserOnly && message && !state.file) {
    const portfolio = state.account?.portfolio;
    const selected = portfolio?.goals?.find(goal => goal.id === portfolio.activeGoalId);
    const parsed = parseBrowserGoalFact(message, selected, state.goalFacts || {});
    if (parsed) {
      say('user', message); $('#message').value = '';
      if (parsed.error) { say('note', parsed.error); return; }
      if (state.reserveFacts) { say('note', 'Save or discard the separate reserve draft before changing goal facts.'); return; }
      state.goalFacts = { ...(state.goalFacts || {}), ...parsed.facts };
      state.goalDraftGoalId = selected.id;
      renderGoalDraft();
      say('assistant', `I staged ${Object.keys(parsed.facts).length === 1 ? 'that goal fact' : 'those goal facts'} for you to check.`,
        parsed.clarification || nextBrowserGoalQuestion(selected, state.goalFacts));
      return;
    }
  }
  if (message && !state.file) {
    const holding = parseBrowserHoldingList(message) || parseBrowserHoldingStatement(message);
    if (holding) {
      say('user', message); $('#message').value = '';
      if (holding.error) { say('note', holding.error); return; }
      if (state.reserveFacts) { say('note', 'Save or discard the separate reserve draft before adding holdings.'); return; }
      if (state.drafts.length) {
        say('note', 'Confirm or discard the possible holdings already shown before describing another one.');
        return;
      }
      const drafts = (holding.drafts || [holding.draft]).map(row => normalizedDraft(row));
      if (drafts.some(row => !row)) { say('note', 'I could not stage these holdings. Please check their names and values.'); return; }
      state.drafts = drafts; renderDrafts();
      say('assistant', `I staged ${drafts.length} possible ${drafts.length === 1 ? 'holding' : 'holdings'} for you to check. ${drafts.length === 1 ? 'It is' : 'They are'} not in the dashboard yet.`,
        nextDraftQuestion(state.drafts));
      return;
    }
  }
  if (browserOnly && state.file) {
    say('note', 'Read the selected Active Statement with its password in the browser, or remove the file before asking a question. This page does not send PDFs to AI.');
    return;
  }
  let pdf = null;
  if (state.file) {
    if (state.file.size > 4_000_000) { say('note', 'This PDF is too large for AI extraction. Use private CAS reading or remove the file.'); return; }
    if (!$('#pdf-consent').checked) { say('note', 'Tick the PDF consent box before sending this file, or remove it and describe the holdings in chat.'); return; }
    pdf = await encodedPdf(state.file);
  }
  const namedGoal = !pdf && namedGoalInQuestion(message, state.account?.portfolio);
  if (namedGoal) {
    if (namedGoal.error) { say('user', message); $('#message').value = ''; say('note', namedGoal.error); return; }
    if (namedGoal.goal.id !== state.account.portfolio.activeGoalId) {
      say('user', message); $('#message').value = '';
      if (state.drafts.length || state.goalFacts || state.reserveFacts || state.correction || state.refresh) {
        say('note', 'Confirm or discard the pending review change before asking about a different goal.'); return;
      }
      const prepared = prepareAssistantGoalCommand(state.account.portfolio,
        { kind: 'select', goalName: namedGoal.goal.name });
      if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
      try {
        await writeAccount(prepared.portfolio,
          'The saved review changed in another tab. Check the selected goal, then ask again.');
      } catch (error) { say('note', error.message || 'Could not select that goal.'); return; }
      say('note', `Showing ${namedGoal.goal.name} in the review.`);
      await aiTurn(message);
      return;
    }
  }
  say('user', message || 'Please review this selected PDF.');
  $('#message').value = '';
  clearFile();
  await aiTurn(message || 'Extract only possible investment holdings from this PDF.', pdf);
});

$('#message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#composer').requestSubmit(); }
});
$('#report-help-open')?.addEventListener('click', () => $('#report-help-dialog').showModal());
$('#report-help-close')?.addEventListener('click', () => $('#report-help-dialog').close());
$('#starter-upload')?.addEventListener('click', () => $('#upload').click());
$('#starter-open')?.addEventListener('click', () => {
  if (deviceRecord()) $('#device-review-action').click();
  else $('#restore-tab-file').click();
});
$('#starter-report')?.addEventListener('click', () => $('#report-help-dialog').showModal());
for (const prompt of document.querySelectorAll('[data-guided-question]')) {
  prompt.addEventListener('click', () => {
    if (state.busy) return;
    $('#message').value = prompt.dataset.guidedQuestion;
    $('#composer').requestSubmit();
  });
}

$('#confirm-drafts').addEventListener('click', async () => {
  if (state.busy || !state.drafts.length) return;
  if (state.hosted && !state.account) {
    say('note', 'The saved account has not loaded. Your drafts remain in this tab; try again after the account is available.'); return;
  }
  if (state.account) {
    const prepared = prepareAssistantSave(state.account.portfolio, state.drafts);
    if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
    state.busy = true; renderDrafts(); renderCredits();
    try {
      await writeAccount(prepared.portfolio,
        'The saved portfolio changed in another tab. Its latest holdings are shown here; your drafts are still waiting. Check them, then confirm again.');
      state.drafts = []; renderDrafts();
      say('note', `${prepared.addedCount} checked holding${prepared.addedCount === 1 ? '' : 's'} ${browserOnly ? 'added to this tab' : 'saved to your account'}. Ask a question when you are ready.`);
      if (!state.coveragePrompted && !state.account?.portfolio?.coverage) {
        state.coveragePrompted = true;
        say('assistant', 'Before treating this as your full portfolio, have you included all your mutual funds and directly held stocks? You can reply “I included all my mutual funds”, “I included some of my direct stocks”, or “I have no mutual funds”. I will ask you to confirm the answer.');
      } else {
        const next = nextFundCategoryQuestion(state.account?.portfolio) ||
          nextGoalSetupQuestion(state.account?.portfolio);
        if (next) say('assistant', next);
      }
    } catch (error) { say('note', error.message || 'The account save failed. Your drafts are still here.'); }
    finally { state.busy = false; renderDrafts(); renderCredits(); renderGoalReview(); renderGoalDraft(); }
    return;
  }
  if (state.drafts.some(row => !Number.isFinite(row.value) || row.value <= 0 || row.type === 'Other')) {
    say('note', 'Confirm a supported investment type and positive value before adding these holdings.'); return;
  }
  const added = [];
  for (const row of state.drafts) {
    const overlap = findAssistantOverlap([...state.confirmed, ...added], row);
    if (overlap) {
      say('note', `${row.name} may already be counted as ${overlap.existingName} (${overlap.reason} match). Check the source before adding both. Reply “skip ${row.name}” to leave this draft out.`);
      return;
    }
    added.push(row);
  }
  state.confirmed.push(...added);
  const count = state.drafts.length;
  state.drafts = []; renderDrafts(); renderReview();
  say('note', `${count} checked holding${count === 1 ? '' : 's'} added to this tab. Ask a question when you are ready.`);
});

$('#discard-drafts').addEventListener('click', () => {
  state.drafts = []; renderDrafts(); say('note', 'Draft holdings discarded.');
});

$('#confirm-goal').addEventListener('click', async () => {
  if (state.busy || !state.goalFacts || !state.account) return;
  if (state.goalDraftGoalId && state.goalDraftGoalId !== state.account.portfolio?.activeGoalId) {
    say('note', 'The selected goal changed. Discard these possible details and ask again for the intended goal.'); return;
  }
  const prepared = prepareAssistantGoalSave(state.account.portfolio, state.goalFacts);
  if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
  const completingGoalSetup = Object.keys(state.goalFacts).some(field =>
    ['name', 'age', 'years', 'target'].includes(field));
  state.busy = true; renderGoalDraft(); renderCredits();
  try {
    await writeAccount(prepared.portfolio,
      'The saved review changed in another tab. Its latest facts are shown here; check your goal draft, then confirm again.');
    state.goalFacts = null; state.goalDraftGoalId = null; renderGoalDraft();
    const goal = prepared.portfolio.goals.find(item => item.id === prepared.portfolio.activeGoalId);
    say('note', goal.confirmed ? `Goal facts ${browserOnly ? 'added to this tab' : 'saved to your account'}. The goal review has been recalculated.` :
      'Goal facts saved as an unfinished draft. Share the remaining details when you are ready.');
    if (browserOnly && completingGoalSetup && goal.confirmed) {
      const next = nextGoalSetupQuestion(state.account?.portfolio);
      if (next) say('assistant', next);
    }
  } catch (error) { say('note', error.message || 'The goal save failed. Your draft is still here.'); }
  finally { state.busy = false; renderGoalDraft(); renderCredits(); renderGoalReview(); }
});

$('#discard-goal').addEventListener('click', () => {
  state.goalFacts = null; state.goalDraftGoalId = null; renderGoalDraft(); say('note', 'Possible goal details discarded.');
});

$('#confirm-reserve').addEventListener('click', async () => {
  if (state.busy || !state.reserveFacts || !state.account ||
      state.reserveDraftRevision !== state.account.revision) return;
  const prepared = prepareAssistantReserveSave(state.account.portfolio, state.reserveFacts);
  if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
  state.busy = true; renderReserveDraft(); renderCredits();
  try {
    await writeAccount(prepared.portfolio,
      'The saved review changed in another tab. Discard these reserve totals and answer again.');
    state.reserveFacts = null; state.reserveDraftRevision = null; renderReserveDraft();
    say('note', prepared.result);
    const selected = prepared.portfolio.goals?.find(goal => goal.id === prepared.portfolio.activeGoalId);
    if (browserOnly && selected?.confirmed && !selected.emergencyFunding && prepared.portfolio.reserve)
      say('assistant', 'For this goal, would an unexpected essential expense use separate money, the holdings assigned here, or are you unsure? Reply “unexpected expense from separate money”, “unexpected expense from goal holdings”, or “unsure about unexpected expenses”.');
  } catch (error) { say('note', error.message || 'The separate reserve totals could not be saved.'); }
  finally { state.busy = false; renderReserveDraft(); renderCredits(); }
});
$('#discard-reserve').addEventListener('click', () => {
  state.reserveFacts = null; state.reserveDraftRevision = null; renderReserveDraft();
  say('note', 'The separate reserve draft was discarded. The confirmed review did not change.');
});

$('#confirm-correction')?.addEventListener('click', async () => {
  const correction = state.correction;
  if (state.busy || !correction || !state.account || correction.revision !== state.account.revision) return;
  if (correction.kind === 'nav' &&
      (!$('#nav-scheme-checked').checked || !$('#nav-units-checked').checked)) return;
  if (correction.kind === 'price' &&
      (!$('#price-security-checked').checked || !$('#price-shares-checked').checked)) return;
  state.busy = true; renderAccountActions();
  try {
    await writeAccount(correction.portfolio,
      'The saved review changed in another tab. Check the latest holdings, discard this correction and describe it again.');
    state.correction = null;
    say('note', correction.result);
    if (correction.kind === 'classify' || correction.firstCoverageAnswer) {
      const question = nextFundCategoryQuestion(state.account?.portfolio) ||
        nextGoalSetupQuestion(state.account?.portfolio);
      if (question) say('assistant', question);
    }
  } catch (error) { say('note', error.message || 'The correction could not be saved. Check the preview and try again.'); }
  finally { state.busy = false; renderAccountActions(); }
});
$('#discard-correction')?.addEventListener('click', () => {
  state.correction = null; renderCorrection(); say('note', 'The proposed correction was discarded. Your confirmed review did not change.');
});

$('#confirm-refresh')?.addEventListener('click', async () => {
  const refresh = state.refresh;
  if (state.busy || !refresh || !state.account || refresh.revision !== state.account.revision) return;
  state.busy = true; renderAccountActions();
  try {
    await writeAccount(refresh.portfolio,
      'The saved review changed in another tab. Discard this report preview and open the report again.');
    state.refresh = null;
    say('note', refresh.result);
  } catch (error) { say('note', error.message || 'The report refresh could not be saved. Check the preview and try again.'); }
  finally { state.busy = false; renderAccountActions(); }
});
$('#discard-refresh')?.addEventListener('click', () => {
  state.refresh = null; renderRefresh(); say('note', 'The report refresh was discarded. Your confirmed review did not change.');
});

$('#export-saved').addEventListener('click', async () => {
  if (state.busy || !state.account?.portfolio) return;
  state.busy = true; renderAccountActions();
  try {
    const response = await fetch('/api/portfolio', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not download the saved review. Try again later.');
    const payload = await response.json();
    if (!payload.portfolio || ![1, 2].includes(payload.portfolio.version)) {
      acceptAccount(payload);
      throw new Error('There is no saved review to download. The account view has been refreshed.');
    }
    const blob = new Blob([JSON.stringify(payload.portfolio, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'thefinxperts-portfolio.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('note', payload.revision === state.account.revision ?
      'Saved review downloaded. Keep the file private; it contains your investment values and goals.' :
      'The latest saved review was downloaded. Another tab changed it, so check this tab before making further edits. Keep the file private.');
  } catch (error) { say('note', error.message || 'Could not download the saved review.'); }
  finally { state.busy = false; renderAccountActions(); }
});

$('#delete-saved').addEventListener('click', async () => {
  if (state.busy || !state.account?.portfolio || !window.confirm(
    'Delete the saved holdings, goals, reserve and coverage for this account? This cannot be undone. Your assistant credit count remains.')) return;
  state.busy = true; renderAccountActions();
  try {
    const response = await fetch('/api/portfolio', { method: 'DELETE', headers: {
      'X-Thefinxperts-Intent': 'portfolio-write', 'X-Thefinxperts-Revision': String(state.account.revision) } });
    if (response.status === 409) {
      const latest = await fetch('/api/portfolio', { cache: 'no-store' });
      if (latest.ok) acceptAccount(await latest.json());
      throw new Error('The saved review changed in another tab. Check the latest holdings and confirm deletion again.');
    }
    if (!response.ok) throw new Error('The saved review could not be deleted. Try again later.');
    state.drafts = []; state.goalFacts = null; state.goalDraftGoalId = null;
    state.reserveFacts = null; state.reserveDraftRevision = null;
    state.correction = null; state.refresh = null; state.history = []; clearFile();
    acceptAccount({ portfolio: null, revision: 0 });
    renderDrafts(); renderGoalDraft(); renderReserveDraft();
    $('#messages').replaceChildren();
    say('assistant', 'Your saved review has been deleted. Tell me what you own to begin a new review.');
    say('note', 'Saved holdings, goals, reserve and coverage were deleted. The assistant credit count remains for this account.');
  } catch (error) { say('note', error.message || 'The saved review could not be deleted.'); }
  finally { state.busy = false; renderAccountActions(); }
});

$('#new-chat').addEventListener('click', () => {
  if ((state.drafts.length || state.goalFacts || state.reserveFacts || state.correction || state.refresh || state.file) &&
      !window.confirm('Start a new chat and discard the unconfirmed holdings, goal or reserve details, report change and selected file? Confirmed holdings and goals stay in your review.')) return;
  state.drafts = []; state.goalFacts = null; state.goalDraftGoalId = null;
  state.reserveFacts = null; state.reserveDraftRevision = null;
  state.correction = null; state.refresh = null; state.history = []; clearFile();
  $('#messages').replaceChildren();
  say('assistant', state.confirmed.length ?
    `I still have ${state.confirmed.length} confirmed holding${state.confirmed.length === 1 ? '' : 's'} in this tab. What would you like to understand next?` :
    browserOnly ? 'Choose Upload for a CAMS statement, supported CAS or broker report. I’ll show possible holdings to confirm before answering questions.' :
      'Tell me what you own, upload a CAMS Active Statement, or ask a question about your portfolio.');
  showStarterActions();
  renderDrafts(); renderGoalDraft(); renderReserveDraft(); renderReview();
});

$('#clear-review').addEventListener('click', () => {
  if (state.hosted) return;
  if ((state.confirmed.length || deviceRecord()) && !window.confirm(browserOnly ?
    'Clear the holdings and conversation in this tab and the encrypted copy saved on this device? Download a review file first if you want to continue later.' :
    'Clear the holdings and conversation in this tab? Saved account holdings remain available after reload.')) return;
  if (browserOnly && !forgetDeviceRecord()) {
    say('note', 'Could not remove the saved device copy. Use “Forget here” when browser storage is available.');
    return;
  }
  if (browserOnly) {
    state.account = { portfolio: null, revision: 0 };
    reviewChangeSerial++;
  }
  state.confirmed = []; state.drafts = []; state.goalFacts = null; state.goalDraftGoalId = null;
  state.reserveFacts = null; state.reserveDraftRevision = null;
  state.correction = null; state.refresh = null; state.history = []; state.coveragePrompted = false; clearFile();
  $('#messages').replaceChildren();
  say('assistant', browserOnly ? 'Choose Upload for a CAMS statement, supported CAS or broker report. I’ll show possible holdings to confirm before answering questions. You can also describe one holding.' :
    'Tell me what you own, upload a CAMS Active Statement, or ask a question about your portfolio.');
  showStarterActions();
  renderDrafts(); renderGoalDraft(); renderReserveDraft(); renderReview();
});

function applyAssistantStatus(status) {
  state.available = Boolean(status?.available);
  state.hosted = status?.local === false;
  state.capacityReached = Boolean(status?.capacityReached);
  if (status?.credits && Number.isInteger(status.credits.remaining)) state.credits = status.credits;
  renderCredits();
  $('#service-status').textContent = assistantStatusText();
}

async function refreshAssistantStatus() {
  if (browserOnly || !state.hosted || state.busy) return;
  const revision = ++assistantStatusRevision;
  try {
    const response = await fetch('/api/assistant/status', { cache: 'no-store' });
    if (!response.ok) return;
    const status = await response.json();
    if (revision === assistantStatusRevision && !state.busy) applyAssistantStatus(status);
  } catch { /* Keep the last known balance until the account is reachable. */ }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshAssistantStatus();
});
window.addEventListener('focus', () => { void refreshAssistantStatus(); });
creditChannel?.addEventListener('message', event => {
  if (event.data?.type === 'balance-changed') void refreshAssistantStatus();
});

if (browserOnly) {
  $('#service-status').textContent = 'Browser-only answers · no AI credits';
  renderAccountActions();
  if (deviceRecord()) say('note', 'An encrypted review is saved on this device. Choose “Unlock here” and enter its passphrase to continue.');
} else fetch('/api/assistant/status').then(response => response.ok ? response.json() : null).then(async status => {
  applyAssistantStatus(status);
  if (state.hosted && !state.confirmed.length) {
    try {
      const response = await fetch('/api/portfolio', { cache: 'no-store' });
      if (!response.ok) return;
      const { loaded, omitted } = acceptAccount(await response.json());
      if (loaded) say('note', `${loaded} saved holding${loaded === 1 ? '' : 's'} loaded into this review.`);
      if (omitted) say('note', `${omitted} saved holding${omitted === 1 ? '' : 's'} could not be represented in this chat view and were omitted.`);
    } catch { say('note', 'Could not load saved holdings. You can still review holdings added in this tab.'); }
  }
}).catch(() => { $('#service-status').textContent = 'Local AI unavailable'; });

$('#download-tab-review')?.addEventListener('click', () => {
  const portfolio = state.account?.portfolio;
  if (!browserOnly || !portfolio) return;
  const blob = new Blob([JSON.stringify(portfolio, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'thefinxperts-review.json';
  document.body.append(link); link.click(); link.remove();
  fileSavedSerial = reviewChangeSerial;
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('note', 'Your review file was downloaded. Keep it private; it contains your holdings and goal details.');
});

$('#restore-tab-review')?.addEventListener('click', () => $('#restore-tab-file').click());
$('#restore-tab-file')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!browserOnly || !file) return;
  if (file.size > 2_000_000) { say('note', 'Choose a review JSON file smaller than 2 MB.'); return; }
  let parsed;
  try { parsed = parseReviewBackup(await file.text()); }
  catch { say('note', 'The selected review file could not be read. Try another copy.'); return; }
  if (parsed.errors.length) { say('note', parsed.errors[0]); return; }
  if (state.account?.portfolio && !window.confirm('Replace the review in this tab with the selected file?')) return;
  state.drafts = []; state.goalFacts = null; state.goalDraftGoalId = null; state.correction = null; state.refresh = null;
  acceptAccount({ portfolio: parsed.portfolio, revision: state.account.revision + 1 });
  fileSavedSerial = reviewChangeSerial;
  await saveDeviceReview(parsed.portfolio);
  renderDrafts(); renderGoalDraft();
  say('note', `Restored ${state.confirmed.length} holding${state.confirmed.length === 1 ? '' : 's'} from your private file. Check the dates before using this review.`);
});
$('#device-review-action')?.addEventListener('click', async () => {
  if (!browserOnly || deviceBusy) return;
  if (devicePassphrase && deviceRecord()) {
    if (deviceSavedSerial !== reviewChangeSerial) {
      deviceBusy = true; renderDeviceActions();
      try {
        if (await saveDeviceReview(state.account?.portfolio)) say('note', 'Current review saved on this device.');
      } finally { deviceBusy = false; renderDeviceActions(); }
      return;
    }
    say('note', 'This review saves on this device after each confirmed change. Keep your passphrase; you will need it after a refresh.');
    return;
  }
  const unlock = Boolean(deviceRecord());
  if (!unlock && !state.account?.portfolio) return;
  $('#device-dialog-title').textContent = unlock ? 'Unlock review on this device' : 'Save this review on this device';
  $('#device-dialog-copy').textContent = unlock ?
    'Enter your passphrase to load the encrypted review. A review file can restore it if you forgot the passphrase.' :
    'Choose a passphrase of at least 12 characters. You will need it after a refresh. There is no recovery if you forget it, so keep a private review file too.';
  $('#device-dialog-submit').textContent = unlock ? 'Unlock review' : 'Save encrypted review';
  $('#device-dialog-error').hidden = true;
  $('#device-passphrase').value = '';
  $('#device-review-dialog').showModal();
  $('#device-passphrase').focus();
});
$('#device-dialog-cancel')?.addEventListener('click', () => $('#device-review-dialog').close());
$('#device-review-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (deviceBusy) return;
  const passphrase = $('#device-passphrase').value;
  const saved = deviceRecord();
  deviceBusy = true;
  $('#device-dialog-submit').disabled = true;
  renderDeviceActions();
  try {
    if (saved) {
      const plain = await decryptDeviceReview(saved, passphrase);
      const parsed = parseReviewBackup(plain);
      if (parsed.errors.length) throw new Error('The saved review is damaged or uses an unsupported format.');
      if (state.account?.portfolio && !window.confirm('Replace the current tab review with the saved device review?')) return;
      devicePassphrase = passphrase;
      state.drafts = []; state.goalFacts = null; state.goalDraftGoalId = null; state.correction = null; state.refresh = null;
      acceptAccount({ portfolio: parsed.portfolio, revision: state.account.revision + 1 });
      deviceSavedSerial = reviewChangeSerial;
      renderDrafts(); renderGoalDraft();
      say('note', `Unlocked ${state.confirmed.length} holding${state.confirmed.length === 1 ? '' : 's'} from this device. Check the dates before using this review.`);
    } else {
      if (!state.account?.portfolio) throw new Error('Add and confirm a holding or goal before saving on this device.');
      const encrypted = await encryptDeviceReview(JSON.stringify(state.account.portfolio), passphrase);
      localStorage.setItem(DEVICE_KEY, encrypted);
      devicePassphrase = passphrase;
      deviceSavedSerial = reviewChangeSerial;
      say('note', 'Encrypted review saved on this device. Confirmed changes will save here while this tab is open. Keep your passphrase and a private backup file.');
    }
    $('#device-passphrase').value = '';
    $('#device-review-dialog').close();
  } catch (error) {
    $('#device-dialog-error').textContent = error.message || 'Could not save or unlock this review.';
    $('#device-dialog-error').hidden = false;
  } finally {
    deviceBusy = false;
    $('#device-dialog-submit').disabled = false;
    renderDeviceActions();
  }
});
$('#forget-device-review')?.addEventListener('click', () => {
  if (!browserOnly || !deviceRecord()) return;
  if (!window.confirm('Remove the encrypted review from this device? The current tab and any downloaded review file will stay available.')) return;
  if (forgetDeviceRecord()) say('note', 'Encrypted device copy removed. Your current tab review is still open.');
  else say('note', 'Could not remove the saved device copy. Check browser storage settings.');
  renderDeviceActions();
});
window.addEventListener('storage', event => {
  if (!browserOnly || event.key !== DEVICE_KEY) return;
  deviceSaveRevision++;
  devicePassphrase = null;
  deviceSavedSerial = -1;
  renderDeviceActions();
  say('note', 'The saved review changed in another tab. This tab stopped saving to this device; unlock again to load the latest copy.');
});
window.addEventListener('beforeunload', event => {
  if (!browserOnly) return;
  const pending = state.drafts.length || state.goalFacts || state.reserveFacts ||
    state.correction || state.refresh || state.file || $('#message').value.trim();
  const unsaved = state.account?.portfolio && fileSavedSerial !== reviewChangeSerial &&
    deviceSavedSerial !== reviewChangeSerial;
  if (!pending && !unsaved) return;
  event.preventDefault();
  event.returnValue = '';
});
renderReview();
