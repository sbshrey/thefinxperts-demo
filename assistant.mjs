import { previewActiveStatementFile } from './active-statement-pdf.mjs?v=1aa14dcc379e';
import { previewBrowserCas } from './cas-browser.mjs?v=1aa14dcc379e';
import { prepareAssistantSave, findAssistantOverlap, findSavedDraftOverlaps,
  findDraftBatchOverlaps, findCrossAccountDrafts } from './assistant-save.mjs?v=1aa14dcc379e';
import { buildAssistantGoalReview, buildAssistantReviewChecks, goalNextCheck } from './assistant-review.mjs?v=1aa14dcc379e';
import { goalShare } from './goals.mjs?v=1aa14dcc379e';
import { prepareAssistantGoalSave, prepareAssistantGoalAssignment,
  parseAssistantGoalCommand, prepareAssistantGoalCommand,
  parseAssistantEmergencyFunding, namedGoalInQuestion } from './assistant-goal.mjs?v=1aa14dcc379e';
import { clarifyDrafts, classifyDraftsByNumbers, dateDraftsByNumbers, nextDraftQuestion, mergeAssistantDrafts, skipDraftFromMessage } from './assistant-clarify.mjs?v=1aa14dcc379e';
import { previewAssistantImport } from './assistant-import.mjs?v=1aa14dcc379e';
import { importValueAndDates, rupees } from './assistant-import-audit.mjs?v=1aa14dcc379e';
import { prepareAssistantCasDrafts } from './assistant-cas.mjs?v=1aa14dcc379e';
import { analyzePortfolio, freshFictionalHoldings, valuationAgeSummary, valuationDateIssue,
  valuationRowsNeedingCheck, marketValueDateChecks } from './analysis.mjs?v=1aa14dcc379e';
import { buildReadableReport } from './readable-report.mjs?v=1aa14dcc379e';
import { answerReviewQuestion, isShortReviewFollowUp, resolveReviewFollowUp } from './review-questions.mjs?v=1aa14dcc379e';
import { parseReviewBackup } from './review-backup.mjs?v=1aa14dcc379e';
import { prepareReviewHandoff, receiveReviewHandoff } from './review-handoff.mjs?v=1aa14dcc379e';
import { entryOriginText, valuationOriginText } from './entry-origin.mjs?v=1aa14dcc379e';
import { brokerAccountKey, validBrokerAccountLabel } from './broker-account.mjs?v=1aa14dcc379e';
import { encryptDeviceReview, decryptDeviceReview } from './device-review.mjs?v=1aa14dcc379e';
import { buildCompleteGuidedDeviceBundle, parseGuidedDeviceBundle } from './guided-device-bundle.mjs?v=1aa14dcc379e';
import { parseBrowserGoalStart, parseBrowserGoalNameReply, parseBrowserGoalSetup, parseBrowserGoalFact, parseBrowserHoldingStatement, parseBrowserHoldingList,
  parseGuidedHoldingReply,
  nextBrowserGoalQuestion } from './assistant-local.mjs?v=1aa14dcc379e';
import { parseHoldingCorrection, prepareHoldingCorrection,
  parseCoverageAnswer, prepareCoverageAnswer } from './assistant-correction.mjs?v=1aa14dcc379e';
import { unansweredCoverageFields } from './coverage-state.mjs?v=1aa14dcc379e';
import { parseAssistantReserveFact, nextAssistantReserveQuestion,
  prepareAssistantReserveSave } from './assistant-reserve.mjs?v=1aa14dcc379e';
import { validReserve, reserveMonths } from './reserve.mjs?v=1aa14dcc379e';
import { prepareAssistantActiveRefresh, prepareAssistantBrokerRefresh, prepareAssistantSimpleCsvRefresh, prepareAssistantCasRefresh,
  prepareAssistantDematRefresh, prepareAssistantEpfoRefresh, prepareAssistantNpsRefresh } from './assistant-refresh.mjs?v=1aa14dcc379e';
import { validShares } from './stock-estimate.mjs?v=1aa14dcc379e';
import { rupeesWithPaise, validCostBasis } from './cost-basis.mjs?v=1aa14dcc379e';
import { fundNavLookupUrl } from './nav-estimate.mjs?v=1aa14dcc379e';
import { beginQuoteFollowUp, beginTerFollowUp, advanceQuoteFollowUp } from './quote-follow-up.mjs?v=1aa14dcc379e';
import { inflationContext, observeIndiaDateChange } from './market-context.mjs?v=1aa14dcc379e';
import { unsupportedPdfGuidance } from './document-hint.mjs?v=1aa14dcc379e';
import { compareFundDisclosures, datedSourceIssue, disclosureSchemeKey, estimateVisibleIssuerExposure,
  matchFundDisclosure, sharedFundIssuers } from './fund-disclosure.mjs?v=1aa14dcc379e';

const $ = selector => document.querySelector(selector);
const money = amount => `₹${Math.round(amount).toLocaleString('en-IN')}`;
const browserOnly = document.body.dataset.mode === 'browser-only';
const DEVICE_KEY = 'thefinxperts:encrypted-review:v1';
const casPreviewPerformance = new WeakMap();
let aiConsentGranted = false;
let devicePassphrase = null;
let deviceSaveRevision = 0;
let deviceBusy = false;
let assistantStatusRevision = 0;
let reviewChangeSerial = 0;
let fileSavedSerial = -1;
let deviceSavedSerial = -1;
let portableMode = null;
let pendingPortableText = null;
let portableBusy = false;
function deviceRecord() {
  try { return localStorage.getItem(DEVICE_KEY); }
  catch { return null; }
}
function renderDeviceActions() {
  if (!browserOnly) return;
  const exists = Boolean(deviceRecord());
  $('#device-review-action').textContent = exists ? devicePassphrase ?
    deviceSavedSerial === reviewChangeSerial ? 'Saved here' : 'Retry save here' : 'Unlock here' : 'Save here';
  $('#device-review-action').disabled = deviceBusy || (!exists && (!state.account?.portfolio || state.demo));
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
    const encrypted = await encryptDeviceReview(buildCompleteGuidedDeviceBundle(portfolio, state.disclosures), devicePassphrase);
    if (revision !== deviceSaveRevision || !devicePassphrase) return false;
    localStorage.setItem(DEVICE_KEY, encrypted);
    deviceSavedSerial = changeSerial;
    renderDeviceActions();
    return true;
  } catch (error) {
    if (revision === deviceSaveRevision) say('note', error.message?.startsWith('Some checked fund disclosures') ?
      `${error.message} The earlier device copy remains unchanged. A plain JSON file keeps holdings and goals but not checked fund sheets.` :
      'Could not save this review on this device. Choose “Retry save here” or download a private review file to keep your changes.');
    return false;
  }
}
const state = { confirmed: [], drafts: [], history: [], lastReviewQuestion: null,
  lastReviewAnswer: null, sipSummary: null, file: null, busy: false, available: false,
  mixWhatIf: null, stressWhatIf: null, goalWhatIf: null,
  hosted: false, credits: null, account: browserOnly ? { portfolio: null, revision: 0 } : null,
  demo: false,
  goalFacts: null, goalDraftGoalId: null, reserveFacts: null, reserveDraftRevision: null,
  correction: null, refresh: null, casAvailable: false, casLocal: false,
  quoteFollowUp: null,
  capacityReached: false, coveragePrompted: false, coverageQueue: null, pendingGoalName: false,
  awaitingHoldingName: false, disclosureDraft: null, disclosureQueue: [], disclosures: [] };
const isEmptyGoalPlaceholder = goal => goal?.name === 'My goal' && goal.confirmed === false &&
  goal.age == null && goal.years == null && goal.target == null;
const starterActions = $('#starter-actions');
if (!browserOnly && $('#starter-demo')) $('#starter-demo').hidden = true;
function addPublicInflationContext() {
  if (!browserOnly) return;
  const card = document.createElement('section');
  card.className = 'section-card public-context';
  card.id = 'inflation-context';
  card.setAttribute('aria-labelledby', 'inflation-context-title');
  const title = document.createElement('h3');
  title.id = 'inflation-context-title';
  const source = document.createElement('p');
  source.className = 'context-source';
  const detail = document.createElement('p');
  const status = document.createElement('p');
  status.className = 'context-status';
  const links = document.createElement('div');
  links.className = 'context-links';
  card.append(title, source, detail, links, status);
  $('#review-questions').closest('.section-card').after(card);
  observeIndiaDateChange(indiaDate => {
    const context = inflationContext(indiaDate);
    title.textContent = context.title;
    source.textContent = context.source;
    detail.textContent = context.detail;
    status.textContent = context.status;
    links.replaceChildren(...context.links.map(([label, url]) => {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      return link;
    }));
  });
}
addPublicInflationContext();
function hideStarterActions() { if (starterActions) starterActions.hidden = true; }
function showStarterActions() {
  if (!browserOnly || !starterActions || state.confirmed.length) return;
  $('#messages').append(starterActions);
  starterActions.hidden = false;
}
function fictionalPortfolio() {
  const fictionalCosts = { broad: 400000, banking: 150000, 'bank-stock': 90000 };
  const holdings = freshFictionalHoldings().map(row => ({ ...row, entryOrigin: 'manual',
    ...(fictionalCosts[row.id] ? { costBasis: fictionalCosts[row.id], costBasisAsOf: row.asOf } : {}) }));
  return { source: 'demo', holdings, coverage: null, reserve: null,
    goals: [{ id: 'fictional-education', name: 'Example education goal', age: 35, years: 10,
      target: 2000000, confirmed: true, linkedIds: holdings.map(row => row.id),
      monthlyContribution: 0, returnPct: 0, inflationPct: 0,
      assumptionsChecked: { monthlyContribution: true, returnPct: true, inflationPct: true } }],
    activeGoalId: 'fictional-education' };
}
function appendStartMyReviewAction(item) {
  const action = document.createElement('button');
  action.type = 'button'; action.className = 'holding-review-action';
  action.textContent = 'Start my review';
  action.addEventListener('click', () => $('#clear-review').click());
  item.append(action);
}
function sayFictionalIntro() {
  const item = say('assistant', 'This is a fictional portfolio and goal. Ask what the holdings show, or open the live review. When you are ready to use your own investments, start a fresh review; the example will be removed.');
  appendStartMyReviewAction(item);
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
  reviewToggle.textContent = expanded ? 'Back to chat' :
    state.drafts.length ? `Review ${state.drafts.length} possible ${state.drafts.length === 1 ? 'holding' : 'holdings'}` : 'Open review';
  syncReviewAccessibility();
}
function addReviewAnswerAction(item, response) {
  const reviewTargets = {
    '#holdings': '#holding-list', '#goals': '#goal-card',
    '#goal-form': '#goal-card', '#goal-assumptions': '#goal-card',
    '#review': '#review-questions',
  };
  if (!Object.hasOwn(reviewTargets, response.href) &&
      !['#input-choice', '#report-help-dialog', '#start-review'].includes(response.href)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'holding-review-action review-answer-action';
  button.textContent = response.action;
  button.addEventListener('click', () => {
    if (response.href === '#start-review') {
      $('#clear-review').click();
      return;
    }
    if (response.href === '#report-help-dialog') {
      $('#report-help-dialog').showModal();
      return;
    }
    if (response.href === '#input-choice') {
      $('#upload-trigger').click();
      return;
    }
    const target = response.scenarioGoal ? $('.goal-what-if') : $(reviewTargets[response.href]);
    if (!target) return;
    if (response.href === '#holdings' && target.closest('.section-card')?.hidden) {
      $('#starter-describe').click();
      return;
    }
    if (['#goals', '#goal-form', '#goal-assumptions'].includes(response.href) && target.hidden) {
      $('#quick-goal').click();
      return;
    }
    if (['Confirm goal details', 'Set up a goal'].includes(response.action) ||
        response.href === '#goal-assumptions') {
      if (sayGoalSetupQuestion(state.account?.portfolio,
        { continueProjection: response.href === '#goal-assumptions' })) {
        $('#message').focus();
        return;
      }
    }
    if (mobileReview.matches) setReviewExpanded(true);
    target.tabIndex = -1;
    target.scrollIntoView({ block: 'center' });
    target.focus({ preventScroll: true });
  });
  item.append(button);
}
function sayHoldingsAdded(count) {
  const total = state.confirmed.reduce((sum, row) => sum + Number(row.value || 0), 0);
  const firstUnsavedReview = browserOnly && !state.demo && state.confirmed.length === count &&
    !devicePassphrase;
  const hasExistingDeviceReview = firstUnsavedReview && Boolean(deviceRecord());
  const note = say('note', `${count} checked holding${count === 1 ? '' : 's'} ${browserOnly ? 'added to this tab' : 'saved to your account'}. Entered investments now total ${money(total)} from supplied values. This may be only part of your portfolio.${firstUnsavedReview ? ' This review will be lost on refresh unless you save it.' : ''}`);
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'holding-review-action';
  action.textContent = 'Open live review';
  action.addEventListener('click', () => {
    if (mobileReview.matches) {
      setReviewExpanded(true);
      reviewToggle.focus({ preventScroll: true });
    } else {
      const title = $('#review-title');
      title.tabIndex = -1;
      title.scrollIntoView({ block: 'start' });
      title.focus({ preventScroll: true });
    }
  });
  note.append(action);
  if (firstUnsavedReview) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'holding-review-action';
    save.textContent = hasExistingDeviceReview ? 'Save secure file' : 'Save securely on this device';
    save.addEventListener('click', () =>
      $(hasExistingDeviceReview ? '#download-encrypted-review' : '#device-review-action').click());
    note.append(save);
  }
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
  'Enter this PDF’s password. This browser will try supported CAMS, NPS and demat statement readers; the PDF and password stay in this tab. Confirm every holding before using it.';

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
  $('#clear-review').textContent = state.demo ? 'Start my review' : 'Clear tab';
  if ($('#starter-demo')) $('#starter-demo').hidden = !browserOnly || Boolean(state.account?.portfolio);
  const saved = Boolean(state.account?.portfolio) && !state.demo;
  $('#export-saved').hidden = !saved;
  $('#delete-saved').hidden = !saved;
  $('#export-saved').disabled = state.busy;
  $('#delete-saved').disabled = state.busy;
  const localDownload = $('#download-tab-review');
  if (localDownload) localDownload.disabled = state.busy || !saved;
  const encryptedDownload = $('#download-encrypted-review');
  if (encryptedDownload) encryptedDownload.disabled = state.busy || !saved;
  const readableDownload = $('#download-readable-review');
  if (readableDownload) readableDownload.disabled = state.busy || !saved;
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

function askCoverageGroup() {
  const field = state.coverageQueue?.[0];
  if (!field) return false;
  const group = { mutualFunds: 'mutual funds', directStocks: 'directly held stocks',
    otherInvestments: 'other investments such as NPS, EPF, PPF, deposits or gold' }[field];
  const type = { mutualFunds: 'Mutual fund', directStocks: 'Stock',
    otherInvestments: 'Other investment' }[field];
  const hasRows = state.account?.portfolio?.holdings?.some(row => row.type === type);
  const choices = hasRows ? [['all', 'All included'], ['some', 'Some missing'], ['unsure', 'Unsure']] :
    [['some', 'Some missing'], ['none', 'None owned'], ['unsure', 'Unsure']];
  document.querySelectorAll('.coverage-replies').forEach(row => row.remove());
  const item = say('assistant', hasRows ?
    `Have you included all your ${group} in this review? Choose all, some or unsure, then confirm the answer. You can plan a goal first and leave this unanswered.` :
    `No ${group} are entered yet. Do you own any? Choose some missing, none owned or unsure, then confirm the answer. You can plan a goal first and leave this unanswered.`);
  const replies = document.createElement('div');
  replies.className = 'coverage-replies';
  replies.setAttribute('role', 'group');
  replies.setAttribute('aria-label', `Your ${group} coverage choices`);
  for (const [value, label] of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (state.coverageQueue?.[0] !== field || state.busy || state.correction || state.drafts.length ||
          state.goalFacts || state.reserveFacts || state.refresh) {
        say('note', 'Finish the pending review change before answering this coverage question.'); return;
      }
      if ($('#message').value.trim() || state.file) {
        say('note', 'Send or clear your draft message or selected file before choosing a coverage reply.');
        $('#message').focus(); return;
      }
      $('#message').value = value;
      $('#composer').requestSubmit();
    });
    replies.append(button);
  }
  const planGoal = document.createElement('button');
  planGoal.type = 'button';
  planGoal.textContent = 'Plan a goal instead';
  planGoal.addEventListener('click', () => {
    if (state.coverageQueue?.[0] !== field || state.busy || state.correction || state.drafts.length ||
        state.goalFacts || state.reserveFacts || state.refresh) {
      say('note', 'Finish the pending review change before starting a goal.'); return;
    }
    if ($('#message').value.trim() || state.file) {
      say('note', 'Send or clear your draft message or selected file before starting a goal.');
      $('#message').focus(); return;
    }
    state.coverageQueue = null;
    document.querySelectorAll('.coverage-replies').forEach(row => row.remove());
    askGoalName();
  });
  replies.append(planGoal);
  item.append(replies);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  return true;
}

function askGoalName() {
  state.pendingGoalName = true;
  document.querySelectorAll('.goal-replies').forEach(row => row.remove());
  const item = say('assistant', 'What goal would you like to plan for? Reply with a short name such as Retirement, Education or Home, and I will ask for missing details. If you know everything, you can say “I want to plan for retirement; I am 32, goal in 20 years, target ₹50 lakh in today’s rupees”. I will show those facts for you to confirm.');
  const replies = document.createElement('div');
  replies.className = 'goal-replies';
  replies.setAttribute('role', 'group');
  replies.setAttribute('aria-label', 'Choose a goal name');
  for (const name of ['Retirement', 'Education', 'Home']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', () => {
      if (!state.pendingGoalName || state.busy) return;
      if ($('#message').value.trim() || state.file) {
        say('note', 'Send or clear your draft message or selected file before choosing a goal.');
        $('#message').focus(); return;
      }
      $('#message').value = name;
      $('#composer').requestSubmit();
    });
    replies.append(button);
  }
  item.append(replies);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  $('#message').focus();
}

function resumeCoverageQuestions(portfolio) {
  if (!portfolio?.holdings?.length) {
    state.coveragePrompted = false;
    state.coverageQueue = null;
    return false;
  }
  state.coveragePrompted = true;
  state.coverageQueue = unansweredCoverageFields(portfolio.coverage);
  return askCoverageGroup();
}

function nextGoalSetupQuestion(portfolio, { continueProjection = false } = {}) {
  const goal = portfolio?.goals?.find(item => item.id === portfolio.activeGoalId);
  if (!goal) return null;
  if (!goal.confirmed)
    return `For ${goal.name}: ${nextBrowserGoalQuestion(goal)}`;
  if (!portfolio.holdings?.length)
    return `For ${goal.name}, add one holding first. Choose Upload for a supported statement or holdings file, or describe one investment in chat. I will ask for its value and date before you confirm it.`;
  if (portfolio.goals.length === 1 && portfolio.holdings.some(row =>
    row.id && !goal.linkedIds?.includes(row.id)))
    return `Some confirmed holdings are not counted toward ${goal.name}. If they all belong to this goal, say “count all holdings toward this goal”. I will ask you to confirm before changing the goal comparison.`;
  if (continueProjection) {
    if (goal.assumptionsChecked?.monthlyContribution !== true)
      return `For an optional future illustration of ${goal.name}, what monthly amount do you plan to add? Say “monthly contribution” with your own amount, including ₹0 if deliberate. If you know all three inputs, say “monthly contribution ₹5,000, growth assumption 8%, inflation assumption 6%” to check them together. These are your what-if assumptions, not forecasts.`;
    if (goal.assumptionsChecked?.returnPct !== true)
      return `What annual growth rate would you like to test for ${goal.name}? Say “growth assumption” with your own rate from -20% to 13%. This is a what-if input, not an expected return.`;
    if (goal.assumptionsChecked?.inflationPct !== true)
      return `What annual inflation rate would you like to test for ${goal.name}? Say “inflation assumption” with your own rate from -5% to 15%. This is a what-if input, not a forecast.`;
    return `The optional future illustration for ${goal.name} has all three inputs you chose. Ask “What is my future goal gap?” to inspect its calculation and limits.`;
  }
  return `For ${goal.name}, ask “What should I check first?” for the leading source check or “How diversified is my goal?” for the assigned mix. A future illustration and a chosen asset mix are optional.`;
}

function sayGoalSetupQuestion(portfolio, options) {
  const question = nextGoalSetupQuestion(portfolio, options);
  if (!question) return false;
  const item = say('assistant', question);
  const goal = portfolio?.goals?.find(row => row.id === portfolio.activeGoalId);
  if (goal?.confirmed && portfolio.goals.length === 1 && portfolio.holdings.some(row =>
    row.id && !goal.linkedIds?.includes(row.id))) {
    const replies = document.createElement('div');
    replies.className = 'goal-replies goal-assign-replies';
    replies.setAttribute('role', 'group');
    replies.setAttribute('aria-label', 'Choose whether to count all holdings toward this goal');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Count all toward this goal';
    button.addEventListener('click', () => {
      if (state.account?.portfolio?.activeGoalId !== goal.id ||
          state.account.portfolio.goals.length !== 1) {
        say('note', 'The selected goal changed. Check the current goal before assigning holdings.'); return;
      }
      if ($('#message').value.trim() || state.file) {
        say('note', 'Send or clear your draft message or selected file before assigning holdings.');
        $('#message').focus(); return;
      }
      assignGoalHoldings();
    });
    replies.append(button);
    item.append(replies);
    $('#messages').scrollTop = $('#messages').scrollHeight;
  }
  return true;
}

function say(role, text, question = null, remember = true) {
  if (role === 'user') {
    hideStarterActions();
    document.querySelectorAll('.coverage-replies, .goal-replies').forEach(row => row.remove());
  }
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
  if (remember && (role === 'user' || role === 'assistant')) {
    state.history.push({ role, content: `${text}${question ? ` ${question}` : ''}`.slice(0, 1000) });
    state.history = state.history.slice(-8);
  }
  return item;
}

function sayImportNote(message, visibleWarning = '', visibleAudit = '') {
  const sentenceEnd = message.indexOf('. ');
  if (sentenceEnd < 0) return say('note', message);
  const item = say('note', `${message.slice(0, sentenceEnd + 1)}${visibleAudit ? ` ${visibleAudit}` : ''} Check the rows against your source before using them.${visibleWarning ? ` ${visibleWarning}` : ''}`);
  const details = document.createElement('details');
  details.className = 'import-details';
  const summary = document.createElement('summary');
  summary.textContent = 'Import checks and limits';
  const explanation = document.createElement('p');
  explanation.textContent = message.slice(sentenceEnd + 2);
  details.append(summary, explanation);
  item.append(details);
  return item;
}

function sayDetailedHandoff(message, source) {
  if (!['active', 'broker', 'csv', 'cas'].includes(source)) throw new Error('Unsupported detailed review source.');
  const item = say('note', `${message} Select the file again there; it stays on your device and is not carried between tabs.${state.confirmed.length ? ' If you need the holdings already confirmed here, save a private review file and open it in the detailed review first.' : ''}`);
  const link = document.createElement('a');
  link.className = 'detailed-handoff';
  link.href = `./detailed-review.html?import=${source}#input-choice`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open detailed review ↗';
  item.append(document.createTextNode('\n'), link);
}

function unclassifiedDematDrafts() {
  return state.drafts.filter(row => row.entryOrigin === 'demat_cas' &&
    row.type === 'Other' && row.asset === 'Other');
}

function unclassifiedBrokerDrafts() {
  return state.drafts.filter(row => ['broker_csv', 'broker_xlsx'].includes(row.entryOrigin) &&
    row.type === 'Other' && row.asset === 'Other');
}

function previewDraftOverlaps() {
  const matches = [...findSavedDraftOverlaps(state.account?.portfolio?.holdings || state.confirmed, state.drafts),
    ...findDraftBatchOverlaps(state.drafts)];
  return matches.filter((match, index) => matches.findIndex(item => item.index === match.index) === index);
}

function renderDrafts() {
  const box = $('#drafts');
  box.hidden = !state.drafts.length;
  $('#draft-title').textContent = state.drafts.length ? `Possible holdings (${state.drafts.length})` : 'Possible holdings';
  $('#draft-list').replaceChildren();
  const matches = previewDraftOverlaps();
  const brokerDrafts = state.drafts.filter(row => ['broker_csv', 'broker_xlsx'].includes(row.entryOrigin));
  const needsBrokerLabel = brokerDrafts.some(row => !brokerAccountKey(row.accountLabel) ||
    brokerAccountKey(row.accountLabel) !== brokerAccountKey($('#broker-account-name').value));
  const accountChoice = $('#broker-account-choice');
  accountChoice.hidden = !brokerDrafts.length;
  box.classList.toggle('has-account-choice', brokerDrafts.length > 0);
  if (brokerDrafts.length) {
    const choices = $('#broker-account-options'); choices.replaceChildren();
    const seen = new Set();
    for (const row of state.account?.portfolio?.holdings || []) {
      const label = row.accountLabel, key = brokerAccountKey(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const option = document.createElement('option'); option.value = label; choices.append(option);
    }
  }
  const crossAccount = findCrossAccountDrafts(state.account?.portfolio?.holdings || state.confirmed,
    state.drafts);
  box.classList.toggle('has-overlaps', matches.length > 0);
  const preview = $('#draft-preview');
  if (preview) preview.hidden = !state.drafts.length;
  if (preview && state.drafts.length) {
    const valued = state.drafts.filter(row => Number.isFinite(row.value) && row.value > 0);
    const missingValue = state.drafts.length - valued.length;
    const unknownType = state.drafts.filter(row => row.type === 'Other').length;
    const dateChecks = state.drafts.filter(row => valuationDateIssue(row.asOf)).length;
    const total = valued.reduce((sum, row) => sum + row.value, 0);
    $('#draft-preview-title').textContent = `${state.drafts.length} possible ${state.drafts.length === 1 ? 'holding' : 'holdings'}`;
    $('#draft-preview-total').textContent = Number.isFinite(total) ? money(total) : 'Value too large to show';
    $('#draft-preview-value-note').textContent = `From ${valued.length} of ${state.drafts.length} rows with a positive value. Not included in your confirmed total.`;
    const checks = [
      missingValue && `${missingValue} ${missingValue === 1 ? 'value' : 'values'} missing`,
      unknownType && `${unknownType} ${unknownType === 1 ? 'type' : 'types'} to classify`,
      dateChecks && `${dateChecks} ${dateChecks === 1 ? 'date' : 'dates'} to check`,
      matches.length && `${matches.length} possible ${matches.length === 1 ? 'overlap' : 'overlaps'}`,
      needsBrokerLabel && 'broker account nickname needed',
      crossAccount.length && `${crossAccount.length} same-security ${crossAccount.length === 1 ? 'row' : 'rows'} in another labelled account`
    ].filter(Boolean);
    $('#draft-preview-checks').textContent = checks.length ? `Check before using: ${checks.join(' · ')}.` : 'Check every row against its source before using it.';
  }
  if (reviewToggle.getAttribute('aria-expanded') !== 'true')
    reviewToggle.textContent = state.drafts.length ?
      `Review ${state.drafts.length} possible ${state.drafts.length === 1 ? 'holding' : 'holdings'}` : 'Open review';
  const omitButton = $('#omit-matching-drafts');
  omitButton.hidden = !matches.length;
  omitButton.disabled = state.busy;
  omitButton.textContent = `Leave out ${matches.length} matching ${matches.length === 1 ? 'row' : 'rows'}`;
  const dematButton = $('#demat-drafts-stock');
  const unclassifiedDemat = unclassifiedDematDrafts();
  dematButton.hidden = !unclassifiedDemat.length;
  dematButton.disabled = state.busy;
  dematButton.textContent = `Mark ${unclassifiedDemat.length} checked demat ${unclassifiedDemat.length === 1 ? 'row' : 'rows'} as direct stocks`;
  const brokerButton = $('#broker-drafts-stock');
  const unclassifiedBroker = unclassifiedBrokerDrafts();
  brokerButton.hidden = !unclassifiedBroker.length;
  brokerButton.disabled = state.busy;
  brokerButton.textContent = `Mark ${unclassifiedBroker.length} checked broker ${unclassifiedBroker.length === 1 ? 'row' : 'rows'} as direct stocks`;
  if (!state.drafts.length) return;
  const matchesByIndex = new Map(matches.map(match => [match.index, match]));
  const list = document.createElement('ul');
  for (const [index, row] of state.drafts.entries()) {
    const item = document.createElement('li');
    const match = matchesByIndex.get(index);
    const rate = casPreviewPerformance.get(row);
    item.textContent = `#${index + 1} ${row.name} · ${row.granularity === 'fund_house' ? 'fund-house summary; schemes unknown' : row.type} · ${row.asset === 'Other' ? 'asset category unknown' : row.asset} · ${row.value == null ? 'value missing' : money(row.value)}${row.asOf ? ` · ${row.asOf}` : ' · date missing'}${row.accountLabel ? ` · broker account ${row.accountLabel}` : ''}${row.units ? ` · ${row.units} ${row.entryOrigin === 'manual' ? 'entered' : 'statement'} units; check current balance` : ''}${row.shares ? ` · ${row.shares} ${row.entryOrigin === 'manual' ? 'entered' : 'report'} shares; check current balance` : ''}${rate == null ? '' : ` · Indicative CAS statement-period XIRR ${rate.toFixed(2)}%/yr (preview only)`}${match ? ` · May overlap ${match.existingName} (${match.reason} match)` : ''}`;
    if (match) {
      const details = document.createElement('details');
      details.className = 'overlap-evidence';
      const summary = document.createElement('summary');
      summary.textContent = `Compare ${match.location === 'saved' ? 'saved holding' : 'earlier draft'}`;
      const existing = document.createElement('p');
      existing.textContent = `${match.location === 'saved' ? 'Saved holding' : 'Earlier draft'}: ${match.existingName} · ${Number.isFinite(match.existingValue) ? money(match.existingValue) : 'value missing'} · ${match.existingAsOf || 'date missing'} · ${entryOriginText(match.existingOrigin)}${match.existingShares ? ` · ${match.existingShares} shares` : ''}${match.existingUnits ? ` · ${match.existingUnits} units` : ''}.`;
      const incoming = document.createElement('p');
      incoming.textContent = `New draft: ${row.name} · ${Number.isFinite(row.value) ? money(row.value) : 'value missing'} · ${row.asOf || 'date missing'} · ${entryOriginText(row.entryOrigin)}${row.shares ? ` · ${row.shares} shares` : ''}${row.units ? ` · ${row.units} units` : ''}. Compare both original reports; different dates or values do not prove separate accounts.`;
      details.append(summary, existing, incoming);
      item.append(details);
    }
    if (row._costCandidate !== undefined) {
      const label = document.createElement('label');
      label.className = 'broker-cost-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = row.costBasis !== undefined;
      checkbox.disabled = state.busy || !validCostBasis(row._costCandidate, row.asOf);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          row.costBasis = row._costCandidate;
          row.costBasisAsOf = row.asOf;
        } else {
          delete row.costBasis;
          delete row.costBasisAsOf;
        }
        renderDrafts();
      });
      label.append(checkbox, document.createTextNode(row.asOf ?
        ` I checked that ${rupeesWithPaise(row._costCandidate)} is the invested amount for the units or shares still held on ${row.asOf}.` :
        ` Report says invested ${rupeesWithPaise(row._costCandidate)}. Check the value date before using this amount.`));
      item.append(label);
    }
    list.append(item);
  }
  $('#draft-list').append(list);
  $('#draft-help').textContent = needsBrokerLabel ?
    'Name this broker account before using or comparing its report. Use letters and spaces, not an account number or PAN.' : matches.length ?
    `${matches.length} ${matches.length === 1 ? 'row may' : 'rows may'} already be counted in saved holdings or another draft. Check the source and leave out matching rows before using this batch. Separate account positions need source-aware reconciliation. ${nextDraftQuestion(state.drafts) || ''}` :
    `${crossAccount.length ? `${crossAccount.length} ${crossAccount.length === 1 ? 'security also appears' : 'securities also appear'} in another labelled broker account. Confirm these really are separate accounts before saving. ` : ''}${nextDraftQuestion(state.drafts) || 'Check these against your source before using them in the dashboard.'}`;
  if (unclassifiedDemat.length)
    $('#draft-help').textContent += ' If every unclassified demat row is an ordinary company share, use the checked-rows button after checking the original statement.';
  if (unclassifiedBroker.length)
    $('#draft-help').textContent += ' If every unclassified broker row is an ordinary company share, use the checked-rows button after checking the report.';
  $('#confirm-drafts').textContent = needsBrokerLabel ? 'Name account first' : 'Use these holdings';
  $('#confirm-drafts').disabled = state.busy || matches.length > 0 || needsBrokerLabel || state.drafts.some(row =>
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
  const navReport = state.refresh.kind === 'nav_report';
  const navCheck = $('#nav-report-check');
  if (navCheck) navCheck.hidden = !navReport;
  $('#refresh-help').textContent = ['broker', 'simple_csv'].includes(state.refresh.kind) ?
    'Confirm this newer report covers the same account and positions. Unmatched rows will stay out.' :
    state.refresh.kind === 'epfo' ?
      'Confirm this newer passbook covers the same EPF member account. Check the printed date and balance.' :
    navReport ?
      'Check each exact scheme, plan and option, its NAV date and your current units before applying these estimates.' :
    state.refresh.replacesManual ?
      'Confirm the manual NPS row and this Tier I statement are for the same PRAN. The manual value will be replaced, not added.' :
    state.refresh.kind === 'nps' ?
      'Confirm this newer statement covers the same NPS Tier I account. Check the investment date and scheme total.' :
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
    'Recheck coverage' : state.refresh.replacesManual ? 'Replace checked NPS row' :
      navReport ? 'Apply NAV estimates' : 'Apply report refresh';
  $('#confirm-refresh').disabled = state.busy || stale ||
    (navReport && !$('#nav-report-units-checked')?.checked);
}
$('#nav-report-units-checked')?.addEventListener('change', renderRefresh);

function renderDisclosureDraft() {
  const draft = state.disclosureDraft;
  const box = $('#disclosure-draft');
  if (!box) return;
  box.hidden = !draft;
  if (!draft) { $('#disclosure-match-checked').checked = false;
    $('#disclosure-matches').replaceChildren(); return; }
  const { scheme, asOf, coveredPct, notIncludedPct, securities } = draft;
  const match = matchFundDisclosure(draft, state.confirmed);
  $('#disclosure-preview').textContent = `${scheme} · ${asOf} · ${securities.length} listed shares · ${coveredPct.toFixed(2)}% of fund net assets in this section · ${notIncludedPct.toFixed(2)}% outside this section. ${match ? `${match.count} matching confirmed fund row${match.count === 1 ? '' : 's'}; check the exact scheme, plan and option.` : 'No exact confirmed scheme match. Import that holding first.'}`;
  const list = $('#disclosure-matches');
  list.replaceChildren();
  if (match) {
    for (const row of match.matches.slice(0, 5)) {
      const item = document.createElement('li');
      item.textContent = `Saved #${state.confirmed.indexOf(row) + 1}: ${row.name} · ${row.amc || 'AMC not recorded'} · ${money(row.value)} as of ${row.asOf || 'date unknown'}${row.isin ? ` · scheme ISIN ${row.isin}` : ''}${row.asOf && row.asOf < asOf ? ' · entered value predates this disclosure' : ''}`;
      list.append(item);
    }
    if (match.count > 5) {
      const extra = document.createElement('li');
      extra.textContent = `${match.count - 5} further matching rows are in the confirmed holdings list; check their plans and dates before attaching this sheet.`;
      list.append(extra);
    }
  }
  $('#confirm-disclosure').disabled = state.busy || !match || !$('#disclosure-match-checked').checked;
}

function renderDisclosureReview() {
  const card = $('#fund-disclosure-card');
  if (!card) return;
  const root = $('#fund-disclosure-review');
  root.replaceChildren();
  const matched = state.disclosures.filter(item => matchFundDisclosure(item, state.confirmed));
  card.hidden = !matched.length;
  if (!matched.length) return;
  const todayIso = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const recent = matched.filter(item => !datedSourceIssue(item.asOf, todayIso));
  for (const item of matched) {
    const line = document.createElement('p');
    const old = datedSourceIssue(item.asOf, todayIso);
    line.textContent = `${item.scheme} · disclosure ${item.asOf} · ${item.securities.length} listed shares covering ${item.coveredPct.toFixed(2)}% of fund net assets. ${item.notIncludedPct.toFixed(2)}% is outside this listed equity section.${old ? ' This sheet is over 90 days old or has an unusable date; add a newer one before comparing present exposure.' : ''}`;
    root.append(line);
  }
  const pairDetails = document.createElement('details');
  const pairSummary = document.createElement('summary');
  pairSummary.textContent = 'Technical fund-pair comparison';
  pairDetails.append(pairSummary);
  let pairCount = 0;
  for (let first = 0; first < recent.length; first++) for (let second = first + 1; second < recent.length; second++) {
    const overlap = compareFundDisclosures(recent[first], recent[second]);
    if (!overlap) continue;
    pairCount++;
    const line = document.createElement('p');
    line.textContent = `${recent[first].scheme} and ${recent[second].scheme}: ${overlap.common.length} shared listed security ISIN${overlap.common.length === 1 ? '' : 's'}; minimum observed shared listed equity weight ${overlap.sharedPct.toFixed(2)}%, using the smaller reported weight for each shared security. ${overlap.sameDate ? 'Same disclosure date.' : 'Disclosure dates differ.'} This is only the supplied listed equity sections, not full fund overlap, your rupee exposure, or a current price.`;
    pairDetails.append(line);
  }
  const exposure = estimateVisibleIssuerExposure(state.confirmed, matched);
  if (exposure?.sources.length || exposure?.directCovered) {
    const heading = document.createElement('h4');
    heading.textContent = 'Visible issuer exposure from dated values';
    const coverage = document.createElement('p');
    coverage.textContent = `${money(exposure.coveredValue)} (${exposure.coveragePct.toFixed(2)}%) of ${money(exposure.total)} entered portfolio value is mapped to listed share ISINs. ${money(exposure.unknownValue)} remains outside this view, including unsupported funds, assets and holding values with missing or older than 90-day dates.`;
    root.append(heading, coverage);
    if (exposure.sources.length >= 2) {
      const repeated = sharedFundIssuers(exposure);
      const line = document.createElement('p');
      line.textContent = repeated.length ?
        `${repeated.length} listed ${repeated.length === 1 ? 'company ISIN appears' : 'company ISINs appear'} in at least two usable checked fund sections. Largest repeated exposures: ${repeated.slice(0, 3).map(row => `${row.name} (${row.isin}) in ${row.fundCount} funds: ${money(row.fundValue)} estimated through those funds${row.directValue ? ` plus ${money(row.directValue)} held directly` : ''}`).join('; ')}.${repeated.length > 3 ? ` ${repeated.length - 3} further repeated ${repeated.length - 3 === 1 ? 'ISIN is' : 'ISINs are'} outside this short list.` : ''}` :
        `No listed share ISIN repeats across the ${exposure.sources.length} usable checked fund sections. Unlisted assets, unsupported sections and later trades remain unknown.`;
      root.append(line);
    }
    for (const source of exposure.sources) {
      const line = document.createElement('p');
      line.textContent = `${source.scheme}: ${money(source.value)} entered fund value dated ${source.holdingDates.join(', ')}; AMC listed shares dated ${source.disclosureDate} cover ${source.coveredPct.toFixed(2)}% (${money(source.coveredValue)} estimated).`;
      root.append(line);
    }
    if (exposure.directCovered) {
      const line = document.createElement('p');
      line.textContent = `${money(exposure.directCovered)} of dated direct-stock value with identified ISINs is included, dated ${exposure.directDates.join(', ')}. A stock need not also appear in a fund sheet to count here.`;
      root.append(line);
    }
    const list = document.createElement('ol');
    for (const issuer of exposure.issuers.slice(0, 3)) {
      const item = document.createElement('li');
      item.textContent = `${issuer.name} (${issuer.isin}): ${money(issuer.visibleValue)} estimated visible value (${issuer.portfolioPct.toFixed(2)}% of entered portfolio), comprising ${money(issuer.fundValue)} through these funds and ${money(issuer.directValue)} in directly held stock.`;
      list.append(item);
    }
    root.append(list);
  }
  if (pairCount) root.append(pairDetails);
  const note = document.createElement('small');
  note.textContent = 'This uses user-supplied dated values and any usable AMC sheets. It is not current prices, full issuer exposure, or a buy or sell recommendation. The raw workbook is not saved; checked weights can be kept in an encrypted device copy or secure review file.';
  root.append(note);
}

function stageFundDisclosure(disclosure) {
  if (!matchFundDisclosure(disclosure, state.confirmed)) {
    say('note', `The dated scheme file for ${disclosure.scheme} was read, but no exact scheme is in the confirmed review. Upload or confirm your own fund holding first. No values changed.`);
    stageNextFundDisclosure();
    return;
  }
  state.disclosureDraft = disclosure;
  renderDisclosureDraft();
  say('assistant', 'I found a dated AMC scheme disclosure. Check that its scheme and date match the fund you own, then confirm the preview. The file describes the fund’s assets, not your account balance.');
}

function stageNextFundDisclosure() {
  const next = state.disclosureQueue.shift();
  if (next) stageFundDisclosure(next);
}

function renderReview() {
  const rows = state.confirmed;
  $('#review-title').textContent = state.demo ? 'Fictional picture' : 'Your picture';
  $('#total-label').textContent = state.demo ? 'FICTIONAL HOLDINGS VALUE' : 'CONFIRMED HOLDINGS VALUE';
  const selectedGoal = state.account?.portfolio?.goals?.find(goal =>
    goal.id === state.account.portfolio.activeGoalId);
  $('#count').closest('.stat-grid').hidden = !rows.length;
  $('#goal-card').hidden = !selectedGoal || isEmptyGoalPlaceholder(selectedGoal);
  $('#asset-bars').closest('.section-card').hidden = !rows.length;
  $('#holding-list').closest('.section-card').hidden = !rows.length;
  const inflationCard = $('#inflation-context');
  if (inflationCard) inflationCard.hidden = selectedGoal?.confirmed !== true;
  const quickGoal = $('#quick-goal');
  if (quickGoal) {
    const goals = state.account?.portfolio?.goals || [];
    const hasNamedGoal = goals.some(goal => !isEmptyGoalPlaceholder(goal));
    quickGoal.hidden = state.demo || goals.some(goal => !goal.confirmed && !isEmptyGoalPlaceholder(goal));
    quickGoal.textContent = hasNamedGoal ? 'Add a goal' : 'Start a goal';
    const quickNext = $('#quick-next');
    quickNext.dataset.guidedQuestion = hasNamedGoal ?
      'Can you give me a simple step by step plan to improve this portfolio?' : 'What should I check first?';
    quickNext.textContent = hasNamedGoal ? 'Review plan' : 'Next check';
    const quickExposure = $('#quick-exposure');
    quickExposure.dataset.guidedQuestion = selectedGoal?.confirmed === true ?
      'Is my portfolio good for my age and goal?' : 'How diversified am I?';
    quickExposure.textContent = selectedGoal?.confirmed === true ? 'Age & goal' : 'Diversification';
    for (const prompt of document.querySelectorAll('.suggested-questions [data-guided-question]')) {
      prompt.hidden = rows.length === 0 ||
        (prompt.dataset.requires === 'fund' && !rows.some(row => row.type === 'Mutual fund')) ||
        (prompt.dataset.requires === 'stock' && !rows.some(row => row.type === 'Stock')) ||
        (prompt.dataset.requires === 'two-funds' && rows.filter(row =>
          row.type === 'Mutual fund' && row.granularity !== 'fund_house').length < 2) ||
        (prompt.dataset.requires === 'confirmed-goal' && selectedGoal?.confirmed !== true);
    }
    $('.suggested-questions span').textContent = rows.length ? 'Ask this review' : 'Start here';
  }
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const assets = { Equity: 0, Debt: 0, Gold: 0, Other: 0 };
  for (const row of rows) assets[row.asset] += row.value;
  const datedChecks = valuationRowsNeedingCheck(rows);
  const stale = datedChecks.length;
  const dateCheckValue = datedChecks.reduce((sum, item) => sum + Number(item.row.value), 0);
  $('#total').textContent = money(total);
  $('#count').textContent = String(rows.length);
  $('#stale-count').textContent = String(stale);
  $('#review-badge').textContent = state.demo ? `${rows.length} fictional holdings` : rows.length ? `${rows.length} confirmed` : 'No holdings yet';
  const hasNavEstimate = state.account?.portfolio?.holdings?.some(row => row.navEstimate);
  const hasStockEstimate = state.account?.portfolio?.holdings?.some(row => row.stockEstimate);
  const age = valuationAgeSummary(rows);
  const ageNote = age ? age.oldestDate === age.newestDate ?
    ` Entered values dated ${age.oldestDate} (${age.oldestDays} ${age.oldestDays === 1 ? 'day' : 'days'} old).` :
    ` Oldest value ${age.oldestDate} (${age.oldestDays} days old); newest ${age.newestDate} (${age.newestDays} ${age.newestDays === 1 ? 'day' : 'days'} old).` :
    ' No valid nonfuture value dates were supplied.';
  $('#date-note').textContent = rows.length ?
    `${state.demo ? 'Fictional example. ' : ''}Based on supplied values and dates, not live market quotes.${ageNote}${stale ? ` ${money(dateCheckValue)} of entered value needs a date check.` : ''}${hasNavEstimate ? ' Includes your dated NAV estimate with unchanged units.' : ''}${hasStockEstimate ? ' Includes your dated stock-price estimate with unchanged shares.' : ''}` :
    'Add a holding to begin. Values are dated, not live quotes.';
  const recentChecks = marketValueDateChecks(rows);
  const recentValue = recentChecks.reduce((sum, item) => sum + Number(item.row.value), 0);
  $('#freshness-check').hidden = recentChecks.length === 0;
  $('#freshness-note').textContent = recentChecks.length ?
    `${state.demo ? 'Fictional example: ' : ''}${money(recentValue)} across ${recentChecks.length} fund or stock ${recentChecks.length === 1 ? 'holding has' : 'holdings have'} no value date within the last 7 days. ${state.demo ? 'These dates are invented.' : 'Check a newer source before reading the total as today’s balance.'}` : '';
  const freshnessAction = $('#freshness-action');
  freshnessAction.hidden = state.demo || recentChecks.length === 0;
  freshnessAction.onclick = recentChecks.length && !state.demo ? () => {
    const { row, index } = recentChecks[0];
    guideValueRefresh(index, row, valuationDateIssue(row.asOf));
  } : null;
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
    scope.textContent = state.demo ? 'Fictional example only. Its entries do not describe your investments or establish complete account coverage.' :
      `Self-reported coverage: mutual funds ${label(coverage?.mutualFunds)}; direct stocks ${label(coverage?.directStocks)}; other investments ${label(coverage?.otherInvestments)}. Only confirmed rows count here. To update this, say “I included all my mutual funds”, “I included some of my direct stocks”, or “I have no other investments”.`;
    bars.append(scope);
  }
  const checks = buildAssistantReviewChecks(state.demo ? state.account.portfolio.holdings : rows,
    state.account?.portfolio);
  const checkList = $('#review-questions');
  const moreChecks = $('#review-more');
  const moreList = $('#review-more-questions');
  checkList.replaceChildren();
  moreList.replaceChildren();
  const extraCount = Math.max(0, checks.length - 3);
  moreChecks.hidden = extraCount === 0;
  if (!extraCount) moreChecks.open = false;
  $('#review-more-label').textContent = `See ${extraCount} more review check${extraCount === 1 ? '' : 's'}`;
  if (!checks.length) {
    const item = document.createElement('li');
    item.textContent = browserOnly ? 'After you confirm holdings, this view can show your asset mix, largest positions, dated values and goal gap. Start with a supported statement, broker file or one checked holding.' :
      'Upload a statement or describe an investment to start.';
    checkList.append(item);
  } else for (const [index, check] of checks.entries()) {
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
    const action = document.createElement('button'); action.type = 'button';
    action.className = 'review-check-action';
    const firstDated = datedChecks[0]?.index ?? -1;
    const firstOther = rows.findIndex(row => row.asset === 'Other' && row.type === 'Mutual fund' && row.granularity !== 'fund_house');
    const targetRow = check.key === 'classification' ? firstOther :
      check.key === 'goal-access' ? rows.findIndex(row => row.type === 'Other investment' &&
        goalShare(state.account?.portfolio?.goals?.find(goal => goal.id === state.account.portfolio.activeGoalId), row.id) > 0) : -1;
    if (check.key === 'valuation' && firstDated >= 0) {
      action.textContent = 'Check largest flagged value';
      action.addEventListener('click', () => guideValueRefresh(firstDated, rows[firstDated], valuationDateIssue(rows[firstDated].asOf)));
    } else if (check.key === 'summary') {
      action.textContent = 'How to get a detailed CAS';
      action.addEventListener('click', () => $('#report-help-dialog').showModal());
    } else if (check.key === 'scope') {
      action.textContent = 'Check what is included';
      action.addEventListener('click', () => {
        if (mobileReview.matches) setReviewExpanded(false);
        if (state.demo) {
          const item = say('assistant', 'This fictional example has no answer about investments outside its sample holdings. To check coverage for your own portfolio, start your review and compare your fund, broker and other investment records with the holdings you confirm here.');
          appendStartMyReviewAction(item);
          return;
        }
        if ($('#message').value.trim() || state.file || state.busy || state.drafts.length ||
            state.correction || state.goalFacts || state.reserveFacts || state.refresh ||
            state.disclosureDraft) {
          say('note', 'Finish the pending message or review change before checking portfolio coverage.');
          return;
        }
        if (unansweredCoverageFields(state.account?.portfolio?.coverage).length) {
          resumeCoverageQuestions(state.account?.portfolio);
        } else {
          $('#message').value = 'How complete is my portfolio?';
          $('#composer').requestSubmit();
        }
      });
    } else if (check.key === 'position') {
      action.textContent = 'Test a fall you choose';
      action.addEventListener('click', () => {
        if (mobileReview.matches) setReviewExpanded(false);
        $('#message').value = 'What if my largest holding falls for my goal?';
        $('#composer').requestSubmit();
      });
    } else {
      const goalCheck = ['chosen-mix', 'horizon', 'emergency', 'reserve', 'loss-capacity'].includes(check.key);
      action.textContent = goalCheck ? 'Review selected goal' : targetRow >= 0 ? 'See related holding' : 'Review holdings';
      action.addEventListener('click', () => {
        const target = targetRow >= 0 ? $('#holding-list').children[targetRow] :
          goalCheck ? $('#goal-card') : $('#holding-list');
        if (!target) return;
        target.tabIndex = -1;
        target.scrollIntoView({ block: 'center' });
        target.focus({ preventScroll: true });
      });
    }
    item.append(title, detail, question, action, why);
    (index < 3 ? checkList : moreList).append(item);
  }
  const holdings = $('#holding-list');
  holdings.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p'); empty.textContent = 'Confirmed rows will appear here.'; holdings.append(empty);
  } else for (const [index, row] of rows.entries()) {
    const savedRow = state.account?.portfolio?.holdings?.[index];
    const item = document.createElement('div'); item.className = 'holding-item';
    const name = document.createElement('strong'); name.textContent = `#${index + 1} ${row.name}`;
    const meta = document.createElement('span'); meta.textContent = `${row.granularity === 'fund_house' ? 'Fund-house summary; schemes unknown' : row.type} · ${row.asset} · ${money(row.value)} · ${row.asOf || 'date unknown'} · originally from ${entryOriginText(row.entryOrigin)}${row.accountLabel ? ` · broker account ${row.accountLabel}` : ''}${row.valuationOrigin ? ` · latest value from ${valuationOriginText(row.valuationOrigin)}` : ''}${row.units ? ` · ${row.units} ${row.entryOrigin === 'manual' ? 'entered' : 'statement'} units; verify current balance` : ''}${row.shares ? ` · ${row.shares} ${row.entryOrigin === 'manual' ? 'entered' : 'reported'} shares; verify current balance` : ''}${savedRow?.navEstimate ? ' · investor-checked NAV estimate; units assumed unchanged' : ''}${savedRow?.stockEstimate ? ' · user-entered stock-price estimate; shares assumed unchanged' : ''}${row.costBasis !== undefined ? ` · invested ${money(row.costBasis)} checked ${row.costBasisAsOf}` : ''}${savedRow?.expenseRatioPct !== undefined ? ` · entered TER ${savedRow.expenseRatioPct}% · source date ${savedRow.expenseRatioAsOf}` : ''}`;
    item.append(name, meta);
    const ask = document.createElement('button'); ask.className = 'holding-review-action'; ask.type = 'button';
    ask.textContent = 'Review this holding';
    ask.addEventListener('click', () => {
      if (state.busy || $('#message').value.trim() || state.file || state.drafts.length || state.goalFacts ||
          state.reserveFacts || state.correction || state.refresh) {
        say('note', 'Finish the pending review change, or send or clear your draft message or file, before opening a holding review.'); return;
      }
      if (mobileReview.matches) setReviewExpanded(false);
      $('#message').value = `Review holding ${index + 1}`;
      $('#composer').requestSubmit();
    });
    item.append(ask);
    const dateIssue = valuationDateIssue(row.asOf);
    const canEstimate = Boolean(row.asOf &&
      ((row.type === 'Mutual fund' && row.granularity !== 'fund_house' && row.units) ||
        (row.type === 'Stock' && row.shares)));
    if (dateIssue) {
      const badge = document.createElement('span');
      badge.className = 'valuation-badge';
      badge.textContent = dateIssue === 'stale' ? 'Value over 90 days old · check a newer source' :
        dateIssue === 'future' ? 'Future value date · check the source' : 'Value date missing · check the source';
      item.append(badge);
    }
    if ((dateIssue || canEstimate) && !state.demo && state.account?.portfolio?.holdings?.length === rows.length) {
      const action = document.createElement('button');
      action.className = 'value-check-action';
      action.type = 'button';
      action.textContent = dateIssue ? 'Check or update this value' :
        row.type === 'Mutual fund' ? 'Check newer NAV' : 'Check newer share price';
      action.addEventListener('click', () => guideValueRefresh(index, row, dateIssue));
      item.append(action);
    }
    if (browserOnly && row.type === 'Mutual fund' && row.granularity !== 'fund_house' && !state.demo &&
        state.account?.portfolio?.holdings?.length === rows.length && savedRow?.name === row.name) {
      const terAction = document.createElement('button');
      terAction.className = 'ter-check-action'; terAction.type = 'button';
      terAction.textContent = savedRow?.expenseRatioPct === undefined ? 'Check fund TER' : 'Update fund TER';
      terAction.addEventListener('click', () => guideFundTer(index, savedRow));
      item.append(terAction);
    }
    holdings.append(item);
  }
  renderGoalReview();
  renderDisclosureReview();
  renderDisclosureDraft();
  renderAccountActions();
}

function guideValueRefresh(index, row, dateIssue) {
  if (state.busy) return;
  if ($('#message').value.trim() || state.file || state.drafts.length || state.goalFacts ||
      state.reserveFacts || state.correction || state.refresh) {
    say('note', 'Finish the pending review change, or send or clear your draft message or file, before checking a newer value.');
    return;
  }
  if (mobileReview.matches && reviewToggle?.getAttribute('aria-expanded') === 'true')
    setReviewExpanded(false);
  const number = index + 1;
  state.quoteFollowUp = dateIssue === 'future' ? null :
    beginQuoteFollowUp(row, index, state.account?.revision);
  let message;
  if (dateIssue !== 'future' && row.type === 'Mutual fund' && row.granularity !== 'fund_house' && row.units && row.asOf) {
    message = `For holding #${number}, check the exact scheme, Direct/Regular plan, Growth/IDCW option and published NAV date. Then check whether the ${row.entryOrigin === 'manual' ? 'entered' : "statement's"} ${row.units} units are still your current balance. If they are, reply with the checked NAV in rupees; I will ask for its date and show the dated estimate before you confirm it. If the units changed, import a newer CAS instead. You can start at AMFI’s home page or your AMC’s site.`;
  } else if (dateIssue !== 'future' && row.type === 'Stock' && row.shares && row.asOf) {
    message = `For holding #${number}, check the exact listed security, exchange, current settled shares after trades or corporate actions, and the date of a newer price. If the ${row.shares} ${row.entryOrigin === 'manual' ? 'entered' : 'reported'} shares are still current, reply with the checked share price in rupees; I will ask for its date and show the dated estimate before you confirm it. A newer broker holdings report can check both quantity and value.`;
  } else {
    message = `For holding #${number}, check a newer statement or holdings report for its current total value and valuation date. Then say “update value of holding ${number} to ₹50,000 as of YYYY-MM-DD” using your checked amount and date. I will show the change before you confirm it. A missing or future date cannot be treated as current.`;
  }
  const note = say('assistant', message, null, false);
  if (dateIssue !== 'future' && row.type === 'Mutual fund' && row.units && row.asOf && row.granularity !== 'fund_house') {
    const lookup = fundNavLookupUrl(row.isin);
    if (lookup) {
      const scheme = document.createElement('a');
      scheme.className = 'value-source-link';
      scheme.href = lookup;
      scheme.target = '_blank';
      scheme.rel = 'noopener noreferrer';
      scheme.textContent = 'Search this ISIN on MFnav ↗';
      note.append(document.createTextNode('\n'), scheme,
        document.createTextNode(' (independent site; opening sends only the scheme ISIN). Check the plan, option and NAV date with the AMC.'));
    }
    const source = document.createElement('a');
    source.className = 'value-source-link';
    source.href = 'https://www.amfiindia.com/';
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = 'Open AMFI home page ↗';
    note.append(document.createTextNode('\n'), source);
  }
  $('#message').focus();
}

function guideFundTer(index, row) {
  if (!browserOnly || state.busy || !state.account?.portfolio || state.demo) return;
  if ($('#message').value.trim() || state.file || state.drafts.length || state.goalFacts ||
      state.reserveFacts || state.correction || state.refresh) {
    say('note', 'Finish the pending review change, or send or clear your draft message or file, before checking a fund TER.');
    return;
  }
  const followUp = beginTerFollowUp(row, index, state.account.revision);
  if (!followUp) return;
  if (mobileReview.matches && reviewToggle?.getAttribute('aria-expanded') === 'true')
    setReviewExpanded(false);
  state.quoteFollowUp = followUp;
  const note = say('assistant', `For holding #${index + 1}, check the published total annual TER for the exact mutual-fund scheme and Direct or Regular plan. On AMFI, choose the year, month and fund, then check the total TER rather than the base expense ratio alone. Reply with the rate, such as “1.25%”. I will ask for its publication date and show a preview before saving.${followUp.hasRate ? ' If the saved rate is wrong and you have no replacement, reply “clear” to preview removing it.' : ''} TER is already reflected in the fund NAV, so this is not an extra bill.`, null, false);
  const source = document.createElement('a');
  source.className = 'value-source-link'; source.href = 'https://www.amfiindia.com/ter-of-mf-schemes';
  source.target = '_blank'; source.rel = 'noopener noreferrer';
  source.textContent = 'Open AMFI scheme TER page ↗';
  note.append(source);
  $('#message').focus();
}

function renderGoalReview() {
  const root = $('#goal-review');
  const previousName = root.querySelector('.goal-name')?.textContent;
  const detailsWereOpen = root.querySelector('.goal-review-details')?.open === true;
  root.replaceChildren();
  const review = buildAssistantGoalReview(state.account?.portfolio);
  const paragraph = message => { const p = document.createElement('p'); p.textContent = message; return p; };
  if (review.kind === 'none') {
    root.append(paragraph('No goal yet. A goal is needed for a goal-specific comparison.'));
    return;
  }
  const portfolio = state.account?.portfolio;
  if (portfolio?.goals?.length > 1) {
    const switcher = document.createElement('div');
    switcher.className = 'goal-switcher';
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Choose a goal to review');
    for (const option of portfolio.goals) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'goal-switch';
      button.dataset.goalId = option.id;
      button.setAttribute('aria-pressed', String(option.id === portfolio.activeGoalId));
      const label = document.createElement('strong'); label.textContent = option.name;
      const detail = document.createElement('small');
      if (option.confirmed !== true) detail.textContent = 'Needs goal details';
      else {
        const summary = analyzePortfolio(portfolio.holdings, option, new Date(), portfolio.reserve, portfolio.coverage);
        detail.textContent = !summary.goalTotal ? 'No holdings linked' :
          `Assigned ${money(summary.goalTotal)} · ${summary.goalGap === null ? 'Check goal details' : `gross gap ${money(summary.goalGap)}`}${summary.goalDateCheck.count ? ' · check value dates' : ''}`;
      }
      button.append(label, detail);
      button.addEventListener('click', async () => {
        if (option.id === state.account?.portfolio?.activeGoalId || state.busy) return;
        if (state.drafts.length || state.goalFacts || state.reserveFacts || state.correction ||
            state.refresh || state.disclosureDraft || state.disclosureQueue.length || state.file ||
            state.quoteFollowUp || state.pendingGoalName || state.awaitingHoldingName ||
            $('#message').value.trim()) {
          say('note', 'Finish the pending message, file or review change before switching goals.');
          return;
        }
        const prepared = prepareAssistantGoalCommand(state.account.portfolio,
          { kind: 'select', goalName: option.name });
        if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
        state.busy = true;
        try {
          await writeAccount(prepared.portfolio,
            'The saved review changed in another tab. Check the selected goal, then try again.');
          const selected = prepared.portfolio.goals.find(goal => goal.id === option.id);
          const followUp = browserOnly && selected && (!selected.confirmed || !prepared.portfolio.holdings.length) ?
            nextGoalSetupQuestion(prepared.portfolio) : null;
          say('assistant', `Showing ${option.name} in the review.`,
            followUp, false);
          if (followUp && mobileReview.matches && reviewToggle.getAttribute('aria-expanded') === 'true') {
            setReviewExpanded(false);
            $('#message').focus();
          }
          [...root.querySelectorAll('.goal-switch')].find(item => item.dataset.goalId === option.id)?.focus({ preventScroll: true });
        } catch (error) { say('note', error.message || 'Could not select that goal.'); }
        finally { state.busy = false; }
      });
      switcher.append(button);
    }
    root.append(switcher);
  }
  const name = document.createElement('strong'); name.className = 'goal-name'; name.textContent = review.name;
  root.append(name);
  const scenario = state.mixWhatIf;
  if (browserOnly && scenario && scenario.goalId === state.account?.portfolio?.activeGoalId) {
    const section = document.createElement('section'); section.className = 'mix-what-if';
    const heading = document.createElement('h4'); heading.textContent = 'Your temporary mix preview'; section.append(heading);
    section.append(paragraph(Object.entries(scenario.mix).map(([asset, share]) => `${asset} ${share}%`).join(' · ')));
    if (scenario.rows) {
      const lines = document.createElement('div'); lines.className = 'mix-compare';
      for (const row of scenario.rows) {
        const line = paragraph(`${row.asset}: ${row.currentPct.toFixed(1)}% entered · ${row.plannedPct.toFixed(1)}% proposed · ${Math.abs(row.differencePct).toFixed(1)} percentage points ${row.differencePct >= 0 ? 'above' : 'below'} · ${money(Math.abs(row.differenceValue))} ${row.differenceValue >= 0 ? 'above' : 'below'} a same-total reference`);
        lines.append(line);
      }
      section.append(lines);
      section.append(paragraph(`Based on ${money(scenario.total)} linked value. The rupee reference is not an amount to move or add. This preview does not change your saved mix or assess suitability.`));
    } else section.append(paragraph('Comparison paused while linked goal details need checking. Your saved mix has not changed.'));
    root.append(section);
  }
  const stress = state.stressWhatIf;
  if (browserOnly && stress && stress.goalId === state.account?.portfolio?.activeGoalId) {
    const section = document.createElement('section'); section.className = 'mix-what-if stress-what-if';
    const heading = document.createElement('h4'); heading.textContent = 'Your temporary fall preview'; section.append(heading);
    section.append(paragraph(`${stress.scope} · ${stress.dropPct}% one-time fall`));
    section.append(paragraph(`${money(stress.affectedValue)} affected value × ${stress.dropPct}% = ${money(stress.loss)} illustrated loss. ${money(stress.startingValue)} linked value would become ${money(stress.after)}; gap to your entered goal cost today would be ${money(stress.gap)}.`));
    section.append(paragraph('Other values are held fixed. This is not a forecast, loss limit or trade instruction; your saved goal has not changed.'));
    root.append(section);
  }
  const goalWhatIf = state.goalWhatIf;
  if (browserOnly && goalWhatIf && goalWhatIf.goalId === state.account?.portfolio?.activeGoalId) {
    const section = document.createElement('section'); section.className = 'mix-what-if goal-what-if';
    const heading = document.createElement('h4'); heading.textContent = 'Your temporary goal comparison';
    section.append(heading, paragraph(`${goalWhatIf.label}: saved ${goalWhatIf.savedInput} · alternative ${goalWhatIf.alternativeInput}`));
    const table = document.createElement('div'); table.className = 'mix-compare';
    for (const [label, scenario] of [['Saved', goalWhatIf.base], ['Alternative', goalWhatIf.alternative]]) {
      table.append(paragraph(`${label}: goal-date cost ${money(scenario.futureCost)} · illustrated value ${money(scenario.projectedValue)} · gap ${money(scenario.futureGap)} · total mathematical monthly amount ${money(Math.ceil(scenario.monthlyTotalNeeded))}`));
    }
    section.append(table, paragraph(`${goalWhatIf.label === 'Time until goal' ? 'These rupee amounts refer to different goal dates. ' : ''}Only your chosen input changed. This is fixed-assumption arithmetic, not a forecast or savings instruction. Your saved goal has not changed.`));
    root.append(section);
  }
  const selectedGoal = portfolio?.goals?.find(goal => goal.id === portfolio.activeGoalId);
  const shared = (portfolio?.holdings || []).flatMap(row => {
    const share = goalShare(selectedGoal, row.id);
    return share > 0 && share < 100 ? [`${row.name}: ${share}% (${money(row.value * share / 100)})`] : [];
  });
  if (shared.length) root.append(paragraph(`Shared holdings counted here: ${shared.slice(0, 3).join('; ')}${shared.length > 3 ? `; and ${shared.length - 3} more` : ''}.`));
  const otherGoals = portfolio?.goals?.filter(goal => goal.id !== portfolio.activeGoalId) || [];
  if (otherGoals.length) root.append(paragraph('Choose another goal above to review it. To change which holdings count toward a goal, say “use holding 1 for my NAME goal” using the displayed holding number, or “split holding 1: 60% to goal NAME, 40% to goal OTHER” to share one.'));
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
    ['Years away', String(review.years)], ['Gap today', review.linkedCount ? money(review.gapToday) : '—'],
  ]) {
    const cell = document.createElement('div');
    const small = document.createElement('span'); small.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    cell.append(small, strong); stats.append(cell);
  }
  root.append(stats);
  let currentMix = null;
  if (review.linkedValue > 0) {
    const parts = Object.entries(review.goalAssets)
      .filter(([, value]) => value > 0)
      .map(([asset, value]) => `${asset === 'Other' ? 'Other / unclassified' : asset} ${(value / review.linkedValue * 100).toFixed(1)}%`);
    currentMix = paragraph(`Entered goal mix: ${parts.join(' · ')}. ${review.dateCheckCount ? `${review.dateCheckCount} linked value date${review.dateCheckCount === 1 ? '' : 's'} need checking. ` : ''}Only your assigned holdings and supplied asset labels are counted; this is not a suitable or recommended mix.`);
    currentMix.className = 'goal-current-mix';
    root.append(currentMix);
  }
  if (review.straightLineGap) {
    const straight = review.straightLineGap;
    root.append(paragraph(straight.gapToday > 0 ?
      `Simple monthly gap: ${money(straight.gapToday)} in today's rupees spread across ${straight.months} months is about ${money(straight.roundedMonthly)} per month, rounded up. This is division only; it excludes inflation, returns, taxes, future contributions and any holdings missing from your review. It is not an amount to invest or a forecast.` :
      'The entered value assigned here meets or exceeds this target in today’s rupees. That does not establish whether the goal will be funded when it arrives; future costs and access to money may differ.'));
  }
  if (Number.isInteger(review.age)) {
    const ageAtGoal = review.age + review.years;
    root.append(paragraph(
      `You entered your age as ${review.age} today. Your ${review.years}-year horizon implies age ${ageAtGoal} at the goal date.${ageAtGoal > 100 ? ' Check your age and horizon inputs.' : ''} This should be your age, even if the goal is for someone else; it does not set an asset mix.`));
  }
  const coverageLabel = value => ({ all: 'all included', some: 'some missing',
    none: 'none owned', unsure: 'unsure' })[value] || 'not answered';
  root.append(paragraph(`Snapshot scope: mutual funds ${coverageLabel(review.coverage?.mutualFunds)}; direct stocks ${coverageLabel(review.coverage?.directStocks)}; other investments ${coverageLabel(review.coverage?.otherInvestments)}. These are your answers, not verified account coverage. Goal figures use only confirmed holdings assigned here; missing investments are outside the calculation.`));
  root.append(paragraph(`${review.linkedCount} confirmed holding${review.linkedCount === 1 ? '' : 's'} assigned to this goal; ${review.dateCheckCount} need a valuation-date check. Other confirmed holdings are excluded from these goal figures.`));
  if (review.accessCheck.count) root.append(paragraph(
    `${money(review.accessCheck.value)} in manually entered other investments is linked to this goal. The gap today includes that gross value. If none of those amounts can be used for this goal, the gap in today's rupees would be ${money(review.gapIfOtherUnavailable)}. This is a what-if bound, not a finding that those amounts are locked; check their withdrawal or maturity terms. Future projections remain paused.`));
  const mixPauseReason = { no_holdings: 'Link at least one holding to this goal first.',
    other_investment: 'Linked NPS, EPF, deposit or other manual savings have no verified asset split; compare only what their source confirms.',
    unclassified: 'Classify linked holdings labelled Other from their source before comparing.',
    valuation_dates: 'Check missing, future or old valuation dates on linked holdings before comparing.',
    conflicting_identity: 'Check holdings with conflicting labels for the same ISIN before comparing.',
    fund_house: 'A linked fund-house total needs scheme detail before comparing.' };
  let compactMix = null;
  if (review.mixPlan) {
    const largest = review.mixComparison?.reduce((best, row) =>
      !best || Math.abs(row.differencePct) > Math.abs(best.differencePct) ? row : best, null);
    compactMix = paragraph(largest ? Math.abs(largest.differencePct) < 0.05 ?
      'Your linked asset mix matches the percentages you chose to one decimal place.' :
      `Your chosen mix: ${largest.asset} is ${largest.currentPct.toFixed(1)}% of linked value versus ${largest.plannedPct.toFixed(1)}% you chose, ${Math.abs(largest.differencePct).toFixed(1)} percentage points ${largest.differencePct > 0 ? 'above' : 'below'}.` :
      `Your chosen-mix comparison is paused. ${mixPauseReason[review.mixPause] || 'Check the goal and its linked holdings before comparing.'}`);
    compactMix.className = 'goal-mix-headline';
    const heading = document.createElement('h4'); heading.textContent = 'Your chosen mix'; root.append(heading);
    if (review.mixComparison) {
      const comparison = document.createElement('div'); comparison.className = 'mix-compare';
      for (const row of review.mixComparison) {
        const line = document.createElement('p');
        const difference = Math.abs(row.differenceValue) < 0.5 ? 'at your rupee reference' :
          `${money(Math.abs(row.differenceValue))} ${row.differenceValue > 0 ? 'above' : 'below'} the rupee reference at this total`;
        line.textContent = `${row.asset}: ${row.currentPct.toFixed(1)}% in linked holdings · ${row.plannedPct.toFixed(1)}% you chose · ${Math.abs(row.differencePct).toFixed(1)} percentage points ${row.differencePct >= 0 ? 'above' : 'below'} · ${difference}`;
        comparison.append(line);
      }
      root.append(comparison);
      root.append(paragraph('The rupee reference applies your chosen percentages to the same linked total; it is not money to move or add. This compares dated values and asset labels you supplied. It does not account for fund constituents, tax or transaction costs. Say “clear goal mix” to remove the comparison.'));
    } else {
      root.append(paragraph(`Comparison paused. ${mixPauseReason[review.mixPause] || 'Check the goal and its linked holdings before comparing.'}`));
    }
  } else root.append(paragraph('Want to test your own percentages without saving? Ask “What if my goal mix were Equity 60%, Debt 30%, Gold 10%?” with your own numbers. To save a mix you have chosen, say “my chosen mix is” followed by your percentages; you will check a draft first.'));
  const stressHeading = document.createElement('h4'); stressHeading.textContent = 'What if equity fell?'; root.append(stressHeading);
  if (review.stressPause === 'no_assumption') {
    root.append(paragraph('To test your own percentage without saving it, ask “What if equity falls 25% for my goal?” using your chosen number. To keep an equity-fall input with this goal, say “equity fall 25%” and confirm the draft. Neither is a prediction.'));
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
    root.append(paragraph(`Optional future illustration paused until you confirm your ${review.missingAssumptions.map(field => names[field]).join(', ')}. Ask “What is my future goal gap?” to see what it needs, then give your own monthly contribution, growth and inflation assumptions in chat. A zero is valid when you deliberately choose it.`));
  } else if (review.scenarioStatus === 'no_holdings') {
    root.append(paragraph('Future illustration paused until a confirmed holding is linked to this goal.'));
  } else if (review.scenarioStatus === 'valuation_dates') {
    root.append(paragraph('Future illustration paused until the linked holding dates are checked. Refresh missing, future or old values from their source.'));
  } else if (review.scenarioStatus === 'access_uncertain') {
    root.append(paragraph(`Future illustration paused while linked other investments have no checked access date. This review cannot record a spendable amount from them at the goal date. Check the product terms; if one should not fund this goal, say “uncount holding NUMBER from goal ${review.name}” using its displayed number. The holding stays in your portfolio.`));
  } else if (review.scenario) root.append(paragraph(
    `Illustration at the goal date: ${money(review.scenario.projectedValue)} against ${money(review.scenario.futureCost)} future cost; gap ${money(review.scenario.futureGap)}. Your confirmed assumptions: ${money(review.assumptions.monthlyContribution)}/month added at each month’s end, ${review.assumptions.returnPct}% constant annual growth and ${review.assumptions.inflationPct}% constant inflation. Only the assigned confirmed holdings start this calculation. The monthly amount is a planning input, not a verified SIP or payment. ${review.flatScenario ? `For comparison, with 0% growth and the same monthly amount and inflation, the gap would be ${money(review.flatScenario.futureGap)}. ` : ''}This arithmetic is illustrative, not a forecast. Ask “What if I save ₹10,000 per month?” or “What if I delay my goal by 2 years?” to compare without changing this goal.`));
  const nextCheck = goalNextCheck(review);
  const next = paragraph(`Next check: ${nextCheck} The figures use only your supplied, linked holdings.`);
  next.className = 'goal-next';
  const details = document.createElement('details');
  details.className = 'goal-review-details';
  details.open = detailsWereOpen && previousName === review.name;
  const summary = document.createElement('summary');
  summary.textContent = 'Show calculations, assumptions and limits';
  const nameNode = root.querySelector('.goal-name');
  const switcherNode = root.querySelector('.goal-switcher');
  const statsNode = root.querySelector('.goal-stats');
  const assignButton = root.querySelector('.goal-assign');
  const previews = [...root.querySelectorAll(':scope > .mix-what-if')];
  details.append(summary, ...[...root.children].filter(node =>
    node !== nameNode && node !== switcherNode && node !== statsNode && node !== assignButton && !previews.includes(node)));
  root.replaceChildren(...[switcherNode, nameNode, statsNode, currentMix, compactMix, ...previews, next, assignButton, details].filter(Boolean));
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
    document.querySelectorAll('.goal-assign-replies').forEach(row => row.remove());
    say('note', `${prepared.addedCount} holding${prepared.addedCount === 1 ? '' : 's'} now counted toward the selected goal. The portfolio total has not changed.`);
    if (browserOnly) {
      sayGoalSetupQuestion(state.account?.portfolio);
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
    ...(row.accountLabel && validBrokerAccountLabel(row.accountLabel) ?
      { accountLabel: row.accountLabel.trim().replace(/\s+/g, ' ') } : {}),
    ...(row.valuationOrigin && ['manual', 'broker_xlsx', 'broker_csv', 'amfi_nav_report'].includes(row.valuationOrigin) ?
      { valuationOrigin: row.valuationOrigin } : {}),
    ...(row.isin ? { isin: row.isin } : {}),
    ...(row.amc ? { amc: row.amc } : {}),
    ...(row.amfi ? { amfi: row.amfi } : {}),
    ...(row.units ? { units: row.units } : {}),
    ...(row.shares ? { shares: row.shares } : {}),
    ...(row.granularity === 'fund_house' ? { granularity: 'fund_house' } : {}),
    ...(row.statementCategory ? { statementCategory: row.statementCategory } : {}),
    ...(['broker_csv', 'broker_xlsx'].includes(row.entryOrigin) &&
      Number.isFinite(row._costCandidate) && row._costCandidate > 0 &&
      row._costCandidate <= 10_000_000_000 &&
      Math.abs(row._costCandidate * 100 - Math.round(row._costCandidate * 100)) < 0.000001 ?
      { _costCandidate: row._costCandidate } : {}),
    ...(Number.isFinite(row.costBasis) && row.costBasis > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.costBasisAsOf || '') ?
      { costBasis: row.costBasis, costBasisAsOf: row.costBasisAsOf } : {}) };
}

function acceptAccount(payload) {
  state.account = { portfolio: payload.portfolio, revision: payload.revision };
  state.mixWhatIf = null; state.stressWhatIf = null; state.goalWhatIf = null;
  state.quoteFollowUp = null;
  state.lastReviewQuestion = null; state.lastReviewAnswer = null;
  state.demo = browserOnly && payload.portfolio?.source === 'demo';
  state.awaitingHoldingName = false;
  if (browserOnly) reviewChangeSerial++;
  const sourceRows = Array.isArray(payload.portfolio?.holdings) ? payload.portfolio.holdings : [];
  state.confirmed = sourceRows.map(row => normalizedDraft(row)).filter(row => row &&
    Number.isFinite(row.value) && row.value > 0);
  state.disclosures = state.disclosures.filter(item => matchFundDisclosure(item, state.confirmed));
  if (state.confirmed.length) hideStarterActions();
  renderGoalDraft(); renderReview();
  return { loaded: state.confirmed.length, omitted: sourceRows.length - state.confirmed.length };
}

async function writeAccount(portfolio, conflictMessage) {
  if (state.demo) throw new Error('Start your own review before changing the fictional example.');
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

function chooseAiConsent() {
  const dialog = $('#ai-consent-dialog');
  if (!dialog) return Promise.resolve(false);
  return new Promise(resolve => {
    let finished = false;
    const finish = accepted => {
      if (finished) return;
      finished = true;
      $('#ai-consent-continue').removeEventListener('click', approve);
      $('#ai-consent-cancel').removeEventListener('click', decline);
      dialog.removeEventListener('cancel', escape);
      dialog.close();
      resolve(accepted);
    };
    const approve = () => finish(true);
    const decline = () => finish(false);
    const escape = event => { event.preventDefault(); finish(false); };
    $('#ai-consent-continue').addEventListener('click', approve);
    $('#ai-consent-cancel').addEventListener('click', decline);
    dialog.addEventListener('cancel', escape);
    dialog.showModal();
  });
}

async function aiTurn(message, pdf = null) {
  if (browserOnly) {
    const portfolio = state.account?.portfolio;
    const holdings = portfolio?.holdings || state.confirmed;
    const goal = portfolio?.goals?.find(item => item.id === portfolio.activeGoalId) ||
      { name: 'My goal', age: null, years: null, target: null, confirmed: false, linkedIds: [] };
    const result = analyzePortfolio(holdings, goal, new Date(), portfolio?.reserve, portfolio?.coverage);
    const canFollowUp = state.lastReviewAnswer && state.history.at(-2)?.role === 'assistant' &&
      state.history.at(-2).content === state.lastReviewAnswer && !state.drafts.length &&
      !state.correction && !state.refresh;
    const carriedQuestion = canFollowUp ? resolveReviewFollowUp(message, state.lastReviewQuestion) : null;
    if (!carriedQuestion && isShortReviewFollowUp(message)) {
      state.lastReviewQuestion = null; state.lastReviewAnswer = null;
      say('assistant', /\b(?:gains?|profits?|loss(?:es)?)\b/i.test(message) ?
        'Do you mean funds, direct stocks, or all entered holdings? Ask a full question such as “Which funds show gains?” or “Which stocks are in loss?” so I use the right rows.' :
        'What would you like to check about those holdings: their largest positions or a dated gain or loss? Ask a full question such as “What are my top stocks?” or “Which stocks are in loss?”');
      return;
    }
    const reviewQuestion = carriedQuestion || message;
    const response = answerReviewQuestion(reviewQuestion, { holdings, goal, goals: portfolio?.goals || [],
      source: state.demo ? 'demo' : 'user', coverage: portfolio?.coverage || null,
      reserve: portfolio?.reserve || null, result, sipSummary: state.sipSummary,
      disclosures: state.disclosures });
    state.mixWhatIf = response?.scenarioMix || null;
    state.stressWhatIf = response?.scenarioStress || null;
    state.goalWhatIf = response?.scenarioGoal || null;
    renderGoalReview();
    if (response) {
      const item = say('assistant', response.text);
      const details = document.createElement('details');
      details.className = 'review-answer-details';
      const summary = document.createElement('summary');
      summary.textContent = 'Basis and limits · entered data';
      const basis = document.createElement('p');
      basis.textContent = `How I worked this out: ${response.basis}`;
      const limitation = document.createElement('p');
      limitation.textContent = `Keep in mind: ${response.limitation}`;
      details.append(summary, basis, limitation);
      item.append(details);
      state.lastReviewQuestion = reviewQuestion;
      state.lastReviewAnswer = state.history.at(-1)?.content || null;
      addReviewAnswerAction(item, response.scenarioGoal ?
        { ...response, href: '#goals', action: 'View comparison' } : response);
      if (response.href?.startsWith('https://investor.sebi.gov.in/')) {
        const source = document.createElement('a');
        source.className = 'definition-source';
        source.href = response.href;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = `${response.action} ↗`;
        item.append(source);
      }
      $('#messages').scrollTop = $('#messages').scrollHeight;
    }
    else {
      state.lastReviewQuestion = null; state.lastReviewAnswer = null;
      say('assistant', 'Ask about the holdings you entered, or upload a supported CAMS Active Statement or broker report.');
    }
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
    const send = consent => fetch('/api/assistant', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Thefinxperts-Local': '1',
        'X-Thefinxperts-Intent': 'assistant', ...(consent ? { 'X-Thefinxperts-AI-Consent': '1' } : {}) },
      body: JSON.stringify({ message, history: state.history.slice(0, -1).slice(-8),
        holdings: state.confirmed.slice(0, 100).map(({ name, type, asset, value, asOf }) => ({ name, type, asset, value, asOf })),
        drafts: state.drafts.map(({ name, type, asset, value, asOf }) => ({ name, type, asset, value, asOf })),
        ...(pdf ? { pdf } : {}) }) });
    let response = await send(aiConsentGranted);
    let result = await response.json();
    if (response.status === 428 && result.code === 'consent_required') {
      if (!await chooseAiConsent()) {
        if (state.history.at(-1)?.role === 'user') state.history.pop();
        say('note', 'Nothing was sent to OpenAI and no credit was used. You can still ask factual questions about your saved review.');
        return;
      }
      aiConsentGranted = true;
      response = await send(true);
      result = await response.json();
    }
    if (result.credits && Number.isInteger(result.credits.remaining)) {
      state.credits = result.credits;
      renderCredits();
      creditChannel?.postMessage({ type: 'balance-changed' });
    }
    if (result.code === 'service_capacity') state.capacityReached = true;
    if (!response.ok) throw new Error(result.error || 'The assistant could not answer.');
    state.capacityReached = false;
    const drafts = (result.draftHoldings || []).map(row => normalizedDraft(row)).filter(Boolean);
    if (drafts.length) { state.drafts = mergeAssistantDrafts(state.drafts, drafts); renderDrafts(); }
    say('assistant', result.answer, drafts.length ? nextDraftQuestion(state.drafts) : result.nextQuestion);
    if (result.creditUsed === true && Number.isInteger(result.credits?.remaining)) {
      say('note', `1 free AI credit used · ${result.credits.remaining} of ${result.credits.freeTotal} left on this account.`);
    }
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
  const maxDrafts = browserOnly ? 200 : 30;
  if (parsed.holdings.length > maxDrafts) {
    sayDetailedHandoff(`This guided chat can confirm up to ${maxDrafts} holdings at once. Open the detailed review to inspect this larger Active Statement.`, 'active');
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
  const importSummary = importValueAndDates(state.drafts);
  const detail = parsed.schemeDetailStatus === 'reconciled' ?
    'Scheme rows reconciled to the fund-house totals.' : parsed.schemeDetailStatus === 'unreconciled_fallback' ?
      'Scheme rows did not fully reconcile; only fund-house summaries were staged. Scheme-level holdings are missing.' :
      'This statement supplied fund-house summaries without scheme rows.';
  sayImportNote(`Found ${state.drafts.length} possible fund ${state.drafts.length === 1 ? 'holding' : 'holdings'} in the CAMS Active Statement. ${importSummary} Fund-house source total ${rupees(parsed.summaryTotal)}. ${detail} ${summaries ? `${summaries} ${summaries === 1 ? 'is a fund-house summary' : 'are fund-house summaries'} without scheme detail. ` : ''}The PDF stayed in this browser. Check the rows before using them.`,
    summaries ? `${summaries} fund-house ${summaries === 1 ? 'summary lacks' : 'summaries lack'} scheme detail.` : '',
    `${importSummary} Fund-house source total ${rupees(parsed.summaryTotal)}.`);
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
    say('note', `${parsed.errors[0] || 'This PDF is not a supported CAMS Active Statement.'} If it is an NPS transaction statement or original CAMS, KFintech, NSDL or CDSL CAS, enter its password if needed and choose “Read statement”.`);
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
  if (prepared.errors.length) {
    if (prepared.handoffSource) sayDetailedHandoff(prepared.errors.join(' '), prepared.handoffSource);
    else say('note', prepared.errors.join(' '));
    return false;
  }
  const drafts = prepared.drafts.map(row => normalizedDraft(row));
  if (drafts.some(row => !row)) { say('note', 'A CAS row could not be staged safely. No rows were added.'); return false; }
  state.sipSummary = prepared.sipSummary;
  for (const item of prepared.performance) casPreviewPerformance.set(drafts[item.index], item.annualPercent);
  if (state.account?.portfolio) {
    const refresh = result.source === 'Demat CAS' ?
      prepareAssistantDematRefresh(state.account.portfolio, drafts) :
      prepareAssistantCasRefresh(state.account.portfolio, drafts);
    if (refresh) {
      if (prepared.sipMessage) say('note', prepared.sipMessage);
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
  const ownershipWarning = result.ownershipUnverified === true ?
    result.source === 'Demat CAS' ?
      'The parsed CAS does not establish every demat owner PAN; check account ownership in the original statement.' :
      'The parsed CAS does not establish every folio owner PAN; check ownership in the original statement.' : '';
  renderDrafts(); sayImportNote(prepared.message,
    `Compare the parsed value with your statement total.${ownershipWarning ? ` ${ownershipWarning}` : ''}`,
    importValueAndDates(drafts)); clearFile();
  return true;
}

function stageEpfoResult(result) {
  if (!result?.holding || result.errors?.length) {
    if (result?.recognized) {
      say('note', result.errors?.[0] || 'This EPFO report has no supported current balance. No holding was added.');
      clearFile();
      return true;
    }
    return false;
  }
  const draft = normalizedDraft(result.holding);
  if (!draft || !Number.isFinite(draft.value) || draft.value <= 0 || !draft.asOf) return false;
  const refresh = prepareAssistantEpfoRefresh(state.account?.portfolio, draft);
  if (refresh) {
    if (refresh.repeated) say('note', refresh.description);
    else if (refresh.errors.length) say('note', refresh.errors.join(' '));
    else {
      state.refresh = { ...refresh, revision: state.account.revision };
      renderRefresh();
      say('assistant', 'I found a newer EPF passbook for an account already in this review. Check the date and balance change before applying it.');
    }
    clearFile();
    return true;
  }
  state.drafts = [draft];
  renderDrafts();
  sayImportNote(`I found one EPF member passbook balance of ${money(draft.value)}. Its report was printed on ${draft.asOf}; this is a dated passbook snapshot, not proof that later contributions or transfers are included. The employee and employer balances match the final Grand Total; the separate pension contribution is not counted. The account is labelled with a short one-way code so a later upload of the same member account is caught as an overlap. Check the passbook and confirm the draft before it changes your review. EPF withdrawal and access conditions still need checking for your goal. The PDF stayed in this browser.`,
    'Check the report balance, date and member account before confirming.', `Report printed on ${draft.asOf}.`);
  clearFile();
  return true;
}

function stageNpsResult(result) {
  if (!result?.holding || result.errors?.length) {
    if (result?.recognized) {
      const item = say('note', `${result.errors?.[0] || 'This NPS statement layout could not be reconciled. No holding was added.'} Check whether your CRA report has one dated “Investment Details as on” table for Tier I, with scheme units, NAV, values and a total. You can also enter one checked, dated Tier I balance from your own account as a draft. Keep different accounts and Tier II separate.`);
      clearFile();
      const guide = document.createElement('button');
      guide.type = 'button'; guide.className = 'holding-review-action';
      guide.textContent = 'Which NPS report works?';
      guide.addEventListener('click', () => {
        document.querySelector('[data-report-choice="other"]')?.click();
        $('#report-help-dialog').showModal();
      });
      const describe = document.createElement('button');
      describe.type = 'button'; describe.className = 'holding-review-action';
      describe.textContent = 'Enter a checked NPS balance';
      describe.addEventListener('click', () => $('#starter-describe').click());
      item.append(guide, describe);
      return true;
    }
    return false;
  }
  const draft = normalizedDraft(result.holding);
  if (!draft || !Number.isFinite(draft.value) || draft.value <= 0 || !draft.asOf ||
      draft.entryOrigin !== 'nps_statement') return false;
  const refresh = prepareAssistantNpsRefresh(state.account?.portfolio, draft);
  if (refresh) {
    if (refresh.repeated) say('note', refresh.description);
    else if (refresh.errors.length) say('note', refresh.errors.join(' '));
    else {
      state.refresh = { ...refresh, revision: state.account.revision };
      renderRefresh();
      say('assistant', refresh.replacesManual ?
        'This statement may cover your manually entered NPS Tier I row. Check that both use the same PRAN and tier before replacing the manual value.' :
        'I found a newer NPS statement for an account already in this review. Check its dated balance before applying it.');
    }
    clearFile();
    return true;
  }
  state.drafts = [draft];
  renderDrafts();
  sayImportNote(`I found ${result.checks.schemes} NPS scheme values totalling ${money(draft.value)} as of ${draft.asOf}. Each displayed value reconciled with its units and NAV within a rounding tolerance. This is one Tier I account labelled with a short one-way code; the PRAN and PDF text are not retained. Check the scheme list and total against the original before confirming. The underlying asset mix and access for your goal remain unverified. The PDF stayed in this browser.`,
    'Check the Tier I account, scheme total and investment date before confirming.',
    `Scheme value total ${rupees(draft.value)} as of ${draft.asOf}.`);
  clearFile();
  return true;
}

function stageGoldResult(result) {
  if (!result?.recognized) return false;
  if (result.errors?.length || !result.holding) {
    say('note', result.errors?.[0] || 'The gold statement could not be safely reviewed. No holding was added.');
    clearFile();
    return true;
  }
  const draft = normalizedDraft(result.holding);
  if (!draft || draft.entryOrigin !== 'digital_gold_statement' || !Number.isFinite(draft.value) ||
      draft.value <= 0 || draft.asOf) return false;
  state.drafts = [draft];
  renderDrafts();
  sayImportNote(`I found a Jar digital-gold statement summary showing ${money(draft.value)} and ${result.checks.grams} g. The statement does not clearly date this rupee valuation. Check the value, quantity and valuation date in your Jar account before confirming the draft. Until a date is checked, the dashboard will show its value as undated. The PDF stayed in this browser.`,
    'Check whether you still own this balance and whether another gold row already covers it.',
    'Value date missing; this is not a live gold quote.');
  clearFile();
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
    let unsupportedHint = null;
    if (browserOnly) {
      const active = await previewActiveStatementFile(state.file, password);
      if (active.errors?.some(error => /different password/i.test(error))) {
        say('note', 'That password did not open the PDF. Check the password instructions from its issuer and try again. No holding was added.');
        return;
      }
      if (stageActiveStatement(active)) return;
      unsupportedHint = active.documentHint;
      const { previewNpsStatement } = await import('./nps-browser.mjs?v=1aa14dcc379e');
      if (stageNpsResult(await previewNpsStatement(state.file, password))) return;
      const { previewGoldStatement } = await import('./gold-browser.mjs?v=1aa14dcc379e');
      if (stageGoldResult(await previewGoldStatement(state.file, password))) return;
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
    if (browserOnly && result.errors?.length && unsupportedPdfGuidance(unsupportedHint)) {
      say('note', unsupportedPdfGuidance(unsupportedHint));
      clearFile();
    } else stageCasResult(result);
  } catch { say('note', browserOnly ? 'The browser CAS preview failed. Try again or remove the PDF.' :
    'The private CAS preview failed. Try again or remove the PDF.'); }
  finally { $('#cas-password').value = ''; state.busy = false; renderCredits(); renderDrafts();
    if (state.file) setFileLabel('PDF selected · not sent to AI'); }
});

$('#upload').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.quoteFollowUp = null;
  if (state.demo) { clearFile(); say('note', 'Choose “Start my review” to remove the fictional example before adding your own statement.'); return; }
  state.awaitingHoldingName = false;
  hideStarterActions();
  if (state.reserveFacts) { say('note', 'Save or discard the separate reserve totals before opening another report.'); clearFile(); return; }
  if (state.refresh) { say('note', 'Apply or discard the pending statement refresh before opening another report.'); clearFile(); return; }
  if (state.correction) { say('note', 'Apply or discard the pending holding correction before opening another report.'); clearFile(); return; }
  if (state.disclosureDraft) { say('note', 'Use or discard the pending fund disclosure before opening another file.'); clearFile(); return; }
  if (browserOnly && /\.xlsx$/i.test(file.name)) {
    state.busy = true; renderCredits(); setFileLabel('Checking for a dated fund disclosure in this browser…');
    try {
      const { previewFundDisclosures } = await import('./fund-disclosure-browser.mjs?v=1aa14dcc379e');
      const disclosures = await previewFundDisclosures(file, state.confirmed);
      state.disclosureQueue = disclosures.slice(1);
      stageFundDisclosure(disclosures[0]);
      return;
    } catch (error) {
      if (error.disclosureWorkbook) {
        say('note', `${error.message} No holding values changed.`);
        return;
      }
      /* A broker holdings XLSX may use a different, supported layout. */
    }
    finally { state.busy = false; clearFile(); renderCredits(); renderDisclosureDraft(); }
  }
  if (state.drafts.length && !window.confirm('Replace the unconfirmed holdings already in this chat with this report?')) {
    clearFile(); return;
  }
  if (state.drafts.length) { state.drafts = []; renderDrafts(); }
  state.sipSummary = null;
  if (/\.(?:csv|xlsx)$/i.test(file.name)) {
    state.busy = true; renderCredits();
    setFileLabel('Reading selected report in this browser…');
    try {
      const result = await previewAssistantImport(file, { aiAvailable: !browserOnly, browserOnly });
      if (result.errors.length) {
        if (result.handoffSource) sayDetailedHandoff(result.errors.join(' '), result.handoffSource);
        else say('note', result.errors.join(' '));
      }
      else {
        const drafts = result.drafts.map(row => normalizedDraft(row));
        if (drafts.some(row => !row)) say('note', 'A report row could not be staged safely. No rows were added. Use the detailed review to inspect the report.');
        else {
          const origin = drafts[0]?.entryOrigin;
          if (['broker_csv', 'broker_xlsx'].includes(origin)) {
            state.drafts = drafts;
            $('#broker-account-name').value = '';
            renderDrafts();
            sayImportNote(result.message, '', result.audit);
            say('assistant', 'Which broker account is this report from? Give it a short nickname in the review, and reuse that nickname for future reports from the same account.');
          } else {
            const prepared = prepareAssistantSimpleCsvRefresh(state.account?.portfolio, drafts);
            if (prepared?.errors?.length) {
              state.drafts = drafts; renderDrafts();
              say('note', `${prepared.errors.join(' ')} The file remains unconfirmed. Compare matching rows and leave out any already counted before using unrelated positions.`);
              sayImportNote(result.message, '', result.audit);
            } else if (prepared?.repeated) say('note', prepared.description);
            else if (prepared) {
              state.refresh = { ...prepared, revision: state.account.revision };
              renderRefresh();
              say('assistant', 'I found newer values for saved positions with exact ISIN matches. Review the changes before applying them. The dashboard has not changed yet.');
            } else { state.drafts = drafts; renderDrafts(); sayImportNote(result.message, '', result.audit); }
          }
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
       'Enter the PDF password once and choose “Read statement”. This browser will try a CAMS Active Statement, NPS or digital-gold statement, and supported CAMS, KFintech, NSDL or CDSL CAS without sending the PDF or password.' :
      'Enter the PDF password in a masked field to try the browser preview. For an original CAS, signed-in private reading is available when enabled.');
    return;
  }
  if (stageActiveStatement(parsed)) return;
  if (/\.pdf$/i.test(file.name)) {
    state.busy = true; renderCredits(); setFileLabel('Checking for an EPF passbook in this browser…');
    try {
      const { previewEpfoPassbook } = await import('./epfo-browser.mjs?v=1aa14dcc379e');
      if (stageEpfoResult(await previewEpfoPassbook(file))) return;
    } catch { /* Other supported readers may still recognize the PDF. */ }
    finally { state.busy = false; renderCredits(); renderDrafts(); }
  }
  if (browserOnly && /\.pdf$/i.test(file.name)) {
    state.busy = true; renderCredits(); setFileLabel('Checking for an NPS statement in this browser…');
    try {
      const { previewNpsStatement } = await import('./nps-browser.mjs?v=1aa14dcc379e');
      if (stageNpsResult(await previewNpsStatement(file))) return;
    } catch { /* Other supported readers may still recognize the PDF. */ }
    finally { state.busy = false; renderCredits(); renderDrafts(); }
  }
  if (browserOnly && /\.pdf$/i.test(file.name)) {
    state.busy = true; renderCredits(); setFileLabel('Checking for a digital-gold statement in this browser…');
    try {
      const { previewGoldStatement } = await import('./gold-browser.mjs?v=1aa14dcc379e');
      if (stageGoldResult(await previewGoldStatement(file))) return;
    } catch { /* Other supported readers may still recognize the PDF. */ }
    finally { state.busy = false; renderCredits(); renderDrafts(); }
  }
  if (browserOnly && /\.pdf$/i.test(file.name)) {
    state.busy = true; renderCredits(); setFileLabel('Trying supported statement readers in this browser…');
    try {
      const casResult = await previewBrowserCas(file);
      const guidance = casResult.errors?.length ? unsupportedPdfGuidance(parsed.documentHint) : null;
      if (guidance) say('note', guidance);
      else stageCasResult(casResult);
    } catch { say('note', 'This PDF could not be safely read as a supported statement. No holdings were added.'); }
    finally { state.busy = false; clearFile(); renderCredits(); renderDrafts(); }
    return;
  }
  await offerUnsupportedPdf(file, parsed);
});

$('#disclosure-match-checked')?.addEventListener('change', renderDisclosureDraft);
$('#discard-disclosure')?.addEventListener('click', () => {
  state.disclosureDraft = null;
  renderDisclosureDraft();
  say('note', 'The scheme disclosure preview was discarded. No holding values changed.');
  stageNextFundDisclosure();
});
$('#confirm-disclosure')?.addEventListener('click', () => {
  const draft = state.disclosureDraft;
  if (!browserOnly || !draft || state.busy || !$('#disclosure-match-checked').checked) return;
  if (!matchFundDisclosure(draft, state.confirmed)) {
    say('note', 'The matching fund holding changed. Check the scheme and upload its disclosure again.');
    state.disclosureDraft = null; renderDisclosureDraft(); stageNextFundDisclosure(); return;
  }
  const existing = state.disclosures.findIndex(item => disclosureSchemeKey(item) === disclosureSchemeKey(draft));
  if (existing >= 0 && state.disclosures[existing].asOf >= draft.asOf) {
    say('note', 'This scheme already has an equally recent or newer disclosure in this tab. No change was made.');
    state.disclosureDraft = null; renderDisclosureDraft(); stageNextFundDisclosure();
    return;
  }
  if (existing < 0 && state.disclosures.length >= 5) {
    say('note', 'This tab can compare up to five fund disclosures. Clear the tab to start a different set.');
    return;
  }
  if (existing < 0) state.disclosures.push(draft);
  else state.disclosures[existing] = draft;
  state.disclosureDraft = null;
  reviewChangeSerial++;
  renderDisclosureDraft(); renderDisclosureReview();
  renderDeviceActions();
  if (devicePassphrase) void saveDeviceReview(state.account?.portfolio);
  say('assistant', `Added the ${draft.asOf} listed equity disclosure for ${draft.scheme} to this tab’s review. Your confirmed holdings and saved values did not change.`);
  stageNextFundDisclosure();
});

const chatDropZone = document.querySelector('.chat-panel');
const draggedFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
document.addEventListener('dragover', event => {
  if (draggedFiles(event)) event.preventDefault();
});
document.addEventListener('drop', event => {
  if (!draggedFiles(event)) return;
  event.preventDefault();
  chatDropZone.classList.remove('dragging');
  if (!chatDropZone.contains(event.target))
    say('note', 'Drop one supported statement or holdings file onto the chat area.');
});
chatDropZone.addEventListener('dragenter', event => {
  if (draggedFiles(event)) chatDropZone.classList.add('dragging');
});
chatDropZone.addEventListener('dragleave', event => {
  if (!chatDropZone.contains(event.relatedTarget)) chatDropZone.classList.remove('dragging');
});
chatDropZone.addEventListener('drop', event => {
  if (!draggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  chatDropZone.classList.remove('dragging');
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  if (files.length !== 1) { say('note', 'Drop one file at a time so you can check each preview before adding holdings.'); return; }
  const file = files[0];
  if (!/\.(?:pdf|html?|csv|xlsx)$/i.test(file.name)) {
    say('note', 'Use a PDF, HTML, CSV or XLSX statement or holdings file. No data was added.');
    return;
  }
  if (state.busy) { say('note', 'Wait for the current report preview to finish before opening another file.'); return; }
  $('#upload').files = files;
  $('#upload').dispatchEvent(new Event('change', { bubbles: true }));
});

$('#composer').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  const message = $('#message').value.trim();
  if (!message && !state.file) return;
  if (browserOnly && (state.mixWhatIf || state.stressWhatIf || state.goalWhatIf)) {
    state.mixWhatIf = null; state.stressWhatIf = null; state.goalWhatIf = null; renderGoalReview();
  }
  if (state.demo) {
    if (/^(?:start my review|use my own investments|clear example)[.!]?$/i.test(message)) {
      $('#clear-review').click(); return;
    }
    if (state.file) { clearFile(); say('note', 'Start your own review before adding a statement.'); return; }
    const sampleGoal = state.account?.portfolio?.goals?.find(goal =>
      goal.id === state.account.portfolio.activeGoalId);
    if (parseBrowserHoldingStatement(message) || parseBrowserHoldingList(message) ||
        parseBrowserGoalFact(message, sampleGoal) || parseBrowserGoalSetup(message) ||
        parseBrowserGoalStart(message) || parseAssistantReserveFact(message)) {
      say('user', message); $('#message').value = '';
      say('assistant', 'That sounds like your own investment or goal detail. Choose “Start my review” to remove the fictional example, then enter it there. I have not added this to the sample.');
      return;
    }
    say('user', message); $('#message').value = '';
    await aiTurn(message);
    return;
  }
  if (browserOnly && state.quoteFollowUp && message && !state.file) {
    if (!state.account?.portfolio || state.account.revision !== state.quoteFollowUp.revision) {
      state.quoteFollowUp = null;
      say('note', 'The saved holding changed. Start a newer-value check again from the current review.');
      return;
    }
    const step = advanceQuoteFollowUp(state.quoteFollowUp, message);
    if (step) {
      say('user', message); $('#message').value = '';
      if (step.cancelled) {
        state.quoteFollowUp = null;
        say('note', 'The newer-value check was cancelled. Your confirmed holding did not change.');
      } else if (step.error) say('note', step.error);
      else if (step.pending) {
        state.quoteFollowUp = step.pending;
        say('assistant', step.question);
      } else if (step.command) {
        state.quoteFollowUp = null;
        const prepared = prepareHoldingCorrection(state.account.portfolio, step.command);
        if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
        state.correction = { ...prepared, kind: step.command.kind, revision: state.account.revision };
        renderCorrection();
        say('assistant', step.command.kind.startsWith('ter') ?
          'I prepared the fund TER change. Check the exact holding and published rate or removal in the preview before applying it.' :
          'I prepared the dated estimate. Check the source, current units or shares, and calculated value in the preview before applying it.');
      }
      return;
    }
    state.quoteFollowUp = null;
  }
  const guidedHolding = state.awaitingHoldingName && message && !state.file ?
    parseGuidedHoldingReply(message) : null;
  if (state.awaitingHoldingName && !guidedHolding) state.awaitingHoldingName = false;
  if (state.coverageQueue && message && !state.file &&
      !parseCoverageAnswer(message, state.coverageQueue[0])) state.coverageQueue = null;
  if (message && !state.file && /^count all (?:unassigned )?holdings toward (?:this|selected) goal[.!]?$/i.test(message)) {
    say('user', message); $('#message').value = '';
    await assignGoalHoldings();
    return;
  }
  const goalSetup = browserOnly && message && !state.file ? parseBrowserGoalSetup(message) : null;
  const goalStart = browserOnly && message && !state.file ?
    goalSetup || parseBrowserGoalStart(message) ||
      (state.pendingGoalName ? parseBrowserGoalNameReply(message) : null) : null;
  if (state.pendingGoalName && !goalStart && (message || state.file)) state.pendingGoalName = false;
  const goalCommand = goalStart?.goalName ? { kind: 'create', goalName: goalStart.goalName } :
    message && !state.file ? parseAssistantGoalCommand(message) : null;
  if (goalStart?.error) {
    say('user', message); $('#message').value = ''; say('note', goalStart.error);
    if (state.pendingGoalName) askGoalName();
    return;
  }
  if (goalCommand) {
    say('user', message); $('#message').value = '';
    if (!state.account) { say('note', 'Saved goal commands need a signed-in portfolio account.'); return; }
    if (state.goalFacts || state.reserveFacts) {
      say('note', 'Confirm or discard the current goal or reserve draft before changing goals or assignments.'); return;
    }
    let prepared = prepareAssistantGoalCommand(state.account.portfolio, goalCommand);
    if (browserOnly && goalCommand.kind === 'create' && state.account.portfolio?.goals?.length === 1) {
      const placeholder = state.account.portfolio.goals[0];
       if (isEmptyGoalPlaceholder(placeholder) &&
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
      state.pendingGoalName = false;
      const selected = prepared.portfolio.goals.find(goal => goal.id === prepared.portfolio.activeGoalId);
      if (goalSetup?.facts) {
        state.goalFacts = goalSetup.facts;
        state.goalDraftGoalId = selected.id;
        say('assistant', `I staged your age, time horizon and target for ${selected.name}. Check all three in the goal draft, then confirm them. No goal scenario is shown until you do.`);
      } else say('assistant', prepared.description, browserOnly ? nextBrowserGoalQuestion(selected) : null);
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
        const selected = batch.numbers.length <= 5 ? batch.numbers.map(number => `#${number}`).join(', ') :
          `${batch.numbers.length} selected rows`;
        say('assistant', `Drafts ${selected} are labelled ${batch.type || batch.asset}. Check every row against its source before confirming. Saved holdings have not changed.`, batch.nextQuestion);
      }
      return;
    }
    const datedBatch = dateDraftsByNumbers(state.drafts, message);
    if (datedBatch) {
      say('user', message); $('#message').value = '';
      if (datedBatch.error) say('note', datedBatch.error);
      else {
        state.drafts = datedBatch.drafts; renderDrafts();
        say('assistant', `${datedBatch.numbers.length} selected ${datedBatch.numbers.length === 1 ? 'draft has' : 'drafts have'} the checked report date ${datedBatch.date}. Check every row against its source before confirming. Saved holdings have not changed.`, datedBatch.nextQuestion);
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
  const coverageAnswer = message && !state.file ? parseCoverageAnswer(message, state.coverageQueue?.[0]) : null;
  if (coverageAnswer) {
    say('user', message); $('#message').value = '';
    if (coverageAnswer.error) { say('note', coverageAnswer.error); askCoverageGroup(); return; }
    if (state.correction) { say('note', 'Apply or discard the change already shown before preparing another.'); return; }
    if (state.drafts.length || state.goalFacts || state.reserveFacts) {
      say('note', 'Confirm or discard the current holding, goal or reserve draft before changing review coverage.'); return;
    }
    const prepared = prepareCoverageAnswer(state.account?.portfolio, coverageAnswer);
    if (prepared.errors.length) { say('note', prepared.errors.join(' ')); askCoverageGroup(); return; }
    state.correction = { ...prepared, kind: 'coverage', coverageField: coverageAnswer.field,
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
  if (browserOnly && message && !state.file && !guidedHolding) {
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
    const holding = parseBrowserHoldingList(message) || guidedHolding || parseBrowserHoldingStatement(message);
    if (holding) {
      say('user', message); $('#message').value = '';
      if (holding.error) { say('note', holding.error); return; }
      state.awaitingHoldingName = false;
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
$('#nav-report-open')?.addEventListener('click', () => $('#nav-report-file').click());
$('#nav-report-file')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!browserOnly || !file) return;
  $('#report-help-dialog').close();
  if (state.busy || state.demo || !state.account?.portfolio || state.drafts.length ||
      state.refresh || state.correction || state.reserveFacts || state.disclosureDraft) {
    say('note', 'Finish or discard the current preview and confirm individual mutual-fund holdings with units before opening a NAV report.');
    return;
  }
  if (!/\.txt$/i.test(file.name) || file.size > 4_000_000) {
    say('note', 'Choose the Complete NAV Report .txt file from AMFI, smaller than 4 MB. No values changed.');
    return;
  }
  state.busy = true;
  renderAccountActions();
  try {
    const { parseAmfiNavReport, prepareNavReportRefresh } = await import('./nav-report.mjs?v=1aa14dcc379e');
    const report = parseAmfiNavReport(await file.text());
    const prepared = prepareNavReportRefresh(state.account.portfolio, report);
    if (prepared.errors?.length) say('note', prepared.errors.join(' '));
    else if (prepared.repeated) say('note', prepared.description);
    else {
      state.refresh = { ...prepared, revision: state.account.revision };
      $('#nav-report-units-checked').checked = false;
      say('assistant', 'I found newer exact NAV matches for saved funds. Review every change and check your current units before applying. Your dashboard has not changed yet.');
    }
  } catch {
    say('note', 'The NAV text file could not be read. No values changed.');
  } finally {
    state.busy = false;
    renderAccountActions();
  }
});
const reportChoices = [...document.querySelectorAll('[data-report-choice]')];
const reportPanels = [...document.querySelectorAll('[data-report-panel]')];
for (const button of reportChoices) button.addEventListener('click', () => {
  for (const choice of reportChoices)
    choice.setAttribute('aria-pressed', String(choice === button));
  for (const panel of reportPanels)
    panel.hidden = panel.dataset.reportPanel !== button.dataset.reportChoice;
});
$('#starter-upload')?.addEventListener('click', () => $('#upload').click());
$('#starter-demo')?.addEventListener('click', () => {
  if (!browserOnly || state.busy || state.account?.portfolio || state.drafts.length || state.file ||
      state.goalFacts || state.reserveFacts || state.correction || state.refresh || $('#message').value.trim()) return;
  acceptAccount({ portfolio: fictionalPortfolio(), revision: 0 });
  sayFictionalIntro();
});
$('#starter-describe')?.addEventListener('click', () => {
  if (state.busy || state.drafts.length || state.file || state.pendingGoalName ||
      state.goalFacts || state.reserveFacts || state.correction || state.refresh || $('#message').value.trim()) {
    say('note', 'Finish the selected file, possible holdings or draft message before describing another investment.');
    return;
  }
  state.awaitingHoldingName = true;
  hideStarterActions();
  say('assistant', 'What is the name of one investment you own? Reply with just its name and I will ask what is missing. If you know the details, you can give them together: “I own an Equity mutual fund called NAME worth ₹50,000 as of 2026-09-30” or “I own a stock called NAME worth ₹50,000 as of 2026-09-30”. Use the value and date from your own report. Leave out account numbers and PAN. I will show a draft for you to confirm.');
  $('#message').focus();
});
$('#upload-trigger')?.addEventListener('click', () => {
  if (state.demo) { say('note', 'Choose “Start my review” to remove the fictional example before adding your own statement.'); return; }
  $('#upload').click();
});
$('#starter-open')?.addEventListener('click', () => {
  if (deviceRecord()) $('#device-review-action').click();
  else $('#restore-tab-file').click();
});
$('#starter-goal')?.addEventListener('click', () => $('#quick-goal').click());
$('#quick-goal')?.addEventListener('click', () => {
  if (state.busy || state.drafts.length || state.goalFacts || state.reserveFacts || state.correction || state.refresh) {
    say('note', 'Finish the pending review change before starting a goal.'); return;
  }
  hideStarterActions();
  if (!browserOnly) {
    say('assistant', 'What goal would you like to plan for? Say “I want to plan for retirement” with your own goal name. I will ask for your age, time horizon and amount before showing goal figures.');
    $('#message').focus(); return;
  }
  askGoalName();
});
for (const prompt of document.querySelectorAll('[data-guided-question]')) {
  prompt.addEventListener('click', () => {
    if (state.busy) return;
    $('#message').value = prompt.dataset.guidedQuestion;
    $('#composer').requestSubmit();
  });
}

$('#broker-account-name').addEventListener('input', renderDrafts);
$('#broker-account-apply').addEventListener('click', () => {
  if (state.busy || !state.drafts.length ||
      !state.drafts.every(row => ['broker_csv', 'broker_xlsx'].includes(row.entryOrigin))) return;
  const label = $('#broker-account-name').value.trim().replace(/\s+/g, ' ');
  if (!validBrokerAccountLabel(label)) {
    say('note', 'Use a 2–40 character nickname with letters, spaces or hyphens. Do not enter an account number, PAN or password.');
    return;
  }
  state.drafts = state.drafts.map(row => ({ ...row, accountLabel: label }));
  const origin = state.drafts[0].entryOrigin;
  const prepared = prepareAssistantBrokerRefresh(state.account?.portfolio, state.drafts, origin);
  if (prepared?.errors?.length) {
    renderDrafts();
    say('note', `${prepared.errors.join(' ')} The report remains unconfirmed.`);
  } else if (prepared?.repeated) {
    state.drafts = []; renderDrafts(); say('note', prepared.description);
  } else if (prepared) {
    state.refresh = { ...prepared, revision: state.account.revision };
    state.drafts = []; renderDrafts(); renderRefresh();
    say('assistant', `I found newer values for positions in broker account “${label}”. Review each dated change before applying it; other account positions stay as they are.`);
  } else {
    renderDrafts();
    say('note', `Broker account “${label}” is set for these drafts. Check the rows and choose Use these holdings when ready.`);
  }
});

$('#confirm-drafts').addEventListener('click', async () => {
  if (state.busy || !state.drafts.length) return;
  if (previewDraftOverlaps().length) {
    say('note', 'Possible matching holdings need checking before this batch can be used. Leave out rows already counted, or reconcile separate account positions from their sources.'); return;
  }
  if (state.hosted && !state.account) {
    say('note', 'The saved account has not loaded. Your drafts remain in this tab; try again after the account is available.'); return;
  }
  if (state.account) {
    const crossAccount = findCrossAccountDrafts(state.account.portfolio?.holdings || [], state.drafts);
    if (crossAccount.length && !window.confirm(`${crossAccount.length} ${crossAccount.length === 1 ? 'security also appears' : 'securities also appear'} in another labelled broker account. Confirm these are separate accounts and that both positions belong in your portfolio. The values will be counted separately.`)) return;
    const prepared = prepareAssistantSave(state.account.portfolio, state.drafts,
      { maxDrafts: browserOnly ? 200 : 30 });
    if (prepared.errors.length) { say('note', prepared.errors.join(' ')); return; }
    state.busy = true; renderDrafts(); renderCredits();
    try {
      await writeAccount(prepared.portfolio,
        'The saved portfolio changed in another tab. Its latest holdings are shown here; your drafts are still waiting. Check them, then confirm again.');
      state.drafts = []; renderDrafts();
      sayHoldingsAdded(prepared.addedCount);
      if (!(state.coveragePrompted ? askCoverageGroup() :
        resumeCoverageQuestions(state.account?.portfolio))) {
        const category = nextFundCategoryQuestion(state.account?.portfolio);
        if (category) say('assistant', category);
        else sayGoalSetupQuestion(state.account?.portfolio);
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
    const overlap = findAssistantOverlap(state.confirmed, row) ||
      findAssistantOverlap(added, row, { allowComplementarySummary: true });
    if (overlap) {
      say('note', `${row.name} may already be counted as ${overlap.existingName} (${overlap.reason} match). Check the source before adding both. Reply “skip ${row.name}” to leave this draft out.`);
      return;
    }
    added.push(row);
  }
  state.confirmed.push(...added);
  const count = state.drafts.length;
  state.drafts = []; renderDrafts(); renderReview();
  sayHoldingsAdded(count);
});

$('#omit-matching-drafts').addEventListener('click', () => {
  if (state.busy || !state.drafts.length) return;
  const matches = previewDraftOverlaps();
  if (!matches.length) return;
  const value = matches.reduce((sum, match) => sum + (Number.isFinite(match.draft.value) ? match.draft.value : 0), 0);
  const remaining = state.drafts.length - matches.length;
  if (!window.confirm(`Leave out ${matches.length} matching ${matches.length === 1 ? 'row' : 'rows'} worth ${money(value)} and keep ${remaining} for review? A matching name, ISIN or AMFI code may be a separate account position; a fund-house summary may already include individual schemes. Check both reports and use this only when those rows are already counted. No saved holding changes yet.`)) return;
  const omitted = new Set(matches.map(match => match.index));
  state.drafts = state.drafts.filter((_, index) => !omitted.has(index));
  renderDrafts();
  say('note', `${matches.length} matching ${matches.length === 1 ? 'row was' : 'rows were'} left out of the unconfirmed list. ${remaining ? `${remaining} ${remaining === 1 ? 'row remains' : 'rows remain'} for checking and confirmation.` : 'No drafts remain.'} Saved holdings have not changed.`);
});

$('#demat-drafts-stock').addEventListener('click', () => {
  if (state.busy) return;
  const rows = unclassifiedDematDrafts();
  if (!rows.length || !window.confirm(`Have you checked all ${rows.length} unclassified demat ${rows.length === 1 ? 'row' : 'rows'} in the original statement and confirmed they are ordinary company shares? ETFs, REITs and other securities need individual review. No holdings will be imported yet.`)) return;
  const selected = new Set(rows);
  state.drafts = state.drafts.map(row => selected.has(row) ?
    { ...row, type: 'Stock', asset: 'Equity' } : row);
  renderDrafts();
  say('note', `${rows.length} checked demat ${rows.length === 1 ? 'row is' : 'rows are'} now labelled direct stocks in this preview. No holdings were added; check the list before choosing Use these holdings.`);
});

$('#broker-drafts-stock').addEventListener('click', () => {
  if (state.busy) return;
  const rows = unclassifiedBrokerDrafts();
  if (!rows.length || !window.confirm(`Have you checked all ${rows.length} unclassified broker ${rows.length === 1 ? 'row' : 'rows'} against the report and confirmed they are ordinary company shares? Fund units, ETFs, REITs, bonds and other securities need individual review. No holdings will be imported yet.`)) return;
  const selected = new Set(rows);
  state.drafts = state.drafts.map(row => selected.has(row) ?
    { ...row, type: 'Stock', asset: 'Equity' } : row);
  renderDrafts();
  say('note', `${rows.length} checked broker ${rows.length === 1 ? 'row is' : 'rows are'} now labelled direct stocks in this preview. No holdings were added; check the list before choosing Use these holdings.`);
});

$('#discard-drafts').addEventListener('click', () => {
  state.drafts = []; state.sipSummary = null; renderDrafts(); say('note', 'Draft holdings discarded.');
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
  const confirmingFutureAssumption = Object.keys(state.goalFacts).some(field =>
    ['monthlyContribution', 'returnPct', 'inflationPct'].includes(field));
  state.busy = true; renderGoalDraft(); renderCredits();
  try {
    await writeAccount(prepared.portfolio,
      'The saved review changed in another tab. Its latest facts are shown here; check your goal draft, then confirm again.');
    state.goalFacts = null; state.goalDraftGoalId = null; renderGoalDraft();
    const goal = prepared.portfolio.goals.find(item => item.id === prepared.portfolio.activeGoalId);
    say('note', goal.confirmed ? `Goal facts ${browserOnly ? 'added to this tab' : 'saved to your account'}. The goal review has been recalculated.` :
      'Goal facts saved as an unfinished draft. Share the remaining details when you are ready.');
    if (browserOnly && goal.confirmed && (completingGoalSetup || confirmingFutureAssumption)) {
      sayGoalSetupQuestion(state.account?.portfolio, { continueProjection: confirmingFutureAssumption });
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
    if (correction.kind === 'coverage' && state.coverageQueue)
      state.coverageQueue = state.coverageQueue.filter(field => field !== correction.coverageField);
    if (correction.kind === 'coverage' && !state.coverageQueue)
      state.coverageQueue = unansweredCoverageFields(correction.portfolio.coverage);
    if (correction.kind === 'classify' || correction.kind === 'coverage' && state.coverageQueue) {
      if (!askCoverageGroup()) {
        const category = nextFundCategoryQuestion(state.account?.portfolio);
        if (category) say('assistant', category);
        else sayGoalSetupQuestion(state.account?.portfolio);
      }
    }
  } catch (error) { say('note', error.message || 'The correction could not be saved. Check the preview and try again.'); }
  finally { state.busy = false; renderAccountActions(); }
});
$('#discard-correction')?.addEventListener('click', () => {
  const wasCoverage = state.correction?.kind === 'coverage';
  state.correction = null; renderCorrection(); say('note', 'The proposed correction was discarded. Your confirmed review did not change.');
  if (wasCoverage) askCoverageGroup();
});

$('#confirm-refresh')?.addEventListener('click', async () => {
  const refresh = state.refresh;
  if (state.busy || !refresh || !state.account || refresh.revision !== state.account.revision) return;
  if (refresh.kind === 'nav_report' && !$('#nav-report-units-checked')?.checked) return;
  state.busy = true; renderAccountActions();
  try {
    await writeAccount(refresh.portfolio,
      'The saved review changed in another tab. Discard this report preview and open the report again.');
    state.refresh = null;
    if ($('#nav-report-units-checked')) $('#nav-report-units-checked').checked = false;
    say('note', refresh.result);
  } catch (error) { say('note', error.message || 'The report refresh could not be saved. Check the preview and try again.'); }
  finally { state.busy = false; renderAccountActions(); }
});
$('#discard-refresh')?.addEventListener('click', () => {
  state.refresh = null;
  if ($('#nav-report-units-checked')) $('#nav-report-units-checked').checked = false;
  renderRefresh(); say('note', 'The report refresh was discarded. Your confirmed review did not change.');
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
    state.drafts = []; state.sipSummary = null; state.goalFacts = null; state.goalDraftGoalId = null;
    state.reserveFacts = null; state.reserveDraftRevision = null;
    state.correction = null; state.refresh = null; state.disclosureDraft = null; state.disclosureQueue = []; state.disclosures = []; state.history = []; state.coverageQueue = null; state.pendingGoalName = false; clearFile();
    acceptAccount({ portfolio: null, revision: 0 });
    renderDrafts(); renderGoalDraft(); renderReserveDraft();
    $('#messages').replaceChildren();
    say('assistant', 'Your saved review has been deleted. Tell me what you own to begin a new review.');
    say('note', 'Saved holdings, goals, reserve and coverage were deleted. The assistant credit count remains for this account.');
  } catch (error) { say('note', error.message || 'The saved review could not be deleted.'); }
  finally { state.busy = false; renderAccountActions(); }
});

$('#new-chat').addEventListener('click', () => {
  if ((state.drafts.length || state.goalFacts || state.reserveFacts || state.correction || state.refresh || state.disclosureDraft || state.file) &&
      !window.confirm('Start a new chat and discard the unconfirmed holdings, goal or reserve details, report change and selected file? Confirmed holdings and goals stay in your review.')) return;
  state.drafts = []; state.sipSummary = null; state.goalFacts = null; state.goalDraftGoalId = null;
  state.reserveFacts = null; state.reserveDraftRevision = null;
  state.correction = null; state.refresh = null; state.quoteFollowUp = null; state.disclosureDraft = null; state.disclosureQueue = []; state.history = []; state.lastReviewQuestion = null; state.lastReviewAnswer = null; state.mixWhatIf = null; state.stressWhatIf = null; state.goalWhatIf = null; state.coverageQueue = null; state.pendingGoalName = false; state.awaitingHoldingName = false; clearFile();
  $('#messages').replaceChildren();
  if (state.demo) sayFictionalIntro();
  else {
    say('assistant', state.confirmed.length ?
      `I still have ${state.confirmed.length} confirmed holding${state.confirmed.length === 1 ? '' : 's'} in this tab. What would you like to understand next?` :
      browserOnly ? 'Choose Upload for a CAMS statement, supported CAS or broker report. I’ll show possible holdings to confirm before answering questions.' :
        'Tell me what you own, upload a CAMS Active Statement, or ask a question about your portfolio.');
    resumeCoverageQuestions(state.account?.portfolio);
  }
  showStarterActions();
  renderDrafts(); renderGoalDraft(); renderReserveDraft(); renderReview();
});

$('#clear-review').addEventListener('click', () => {
  if (state.hosted) return;
  if (!state.demo && (state.confirmed.length || deviceRecord()) && !window.confirm(browserOnly ?
    'Clear the holdings and conversation in this tab and the encrypted copy saved on this device? Download a review file first if you want to continue later.' :
    'Clear the holdings and conversation in this tab? Saved account holdings remain available after reload.')) return;
  if (browserOnly && !state.demo && !forgetDeviceRecord()) {
    say('note', 'Could not remove the saved device copy. Use “Forget here” when browser storage is available.');
    return;
  }
  if (browserOnly) {
    state.account = { portfolio: null, revision: 0 };
    state.demo = false;
    reviewChangeSerial++;
  }
  state.confirmed = []; state.drafts = []; state.sipSummary = null; state.goalFacts = null; state.goalDraftGoalId = null;
  state.reserveFacts = null; state.reserveDraftRevision = null;
  state.correction = null; state.refresh = null; state.disclosureDraft = null; state.disclosureQueue = []; state.disclosures = []; state.history = []; state.lastReviewQuestion = null; state.lastReviewAnswer = null; state.mixWhatIf = null; state.stressWhatIf = null; state.goalWhatIf = null; state.coveragePrompted = false; state.coverageQueue = null; state.pendingGoalName = false; state.awaitingHoldingName = false; clearFile();
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
      resumeCoverageQuestions(state.account?.portfolio);
    } catch { say('note', 'Could not load saved holdings. You can still review holdings added in this tab.'); }
  }
}).catch(() => { $('#service-status').textContent = 'Local AI unavailable'; });

function downloadPrivateFile(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#download-readable-review')?.addEventListener('click', () => {
  const portfolio = state.account?.portfolio;
  if (!portfolio) return;
  const report = buildReadableReport({ ...portfolio, source: 'user' });
  if (!report) {
    say('note', 'Add and confirm a holding before downloading a readable portfolio snapshot.');
    return;
  }
  downloadPrivateFile(report, 'text/plain;charset=utf-8', 'thefinxperts-readable-review.txt');
  say('note', 'Readable report downloaded. Keep it private; it contains holdings and values. Save a separate review file if you want to restore this work later.');
});

$('.detailed-link')?.addEventListener('click', event => {
  if (browserOnly && !state.demo) prepareReviewHandoff(event, state.account?.portfolio, './detailed-review.html', () =>
    say('note', 'This browser cannot hand your review to the detailed tab. Save a private review file here and open it there.'));
});

$('#download-tab-review')?.addEventListener('click', () => {
  const portfolio = state.account?.portfolio;
  if (!browserOnly || !portfolio) return;
  downloadPrivateFile(JSON.stringify(portfolio, null, 2), 'application/json', 'thefinxperts-review.json');
  fileSavedSerial = state.disclosures.length ? -1 : reviewChangeSerial;
  say('note', `Plain JSON downloaded. Keep it private; it contains your holdings and goal details.${state.disclosures.length ? ' It does not include the checked AMC disclosure weights; use Save secure file to back those up.' : ''}`);
});

function closePortableDialog() {
  $('#portable-review-dialog').close();
  $('#portable-review-form').reset();
  $('#portable-review-error').hidden = true;
  portableMode = null;
  pendingPortableText = null;
}
function openPortableDialog(mode, encryptedText = null) {
  portableMode = mode;
  pendingPortableText = encryptedText;
  const restore = mode === 'restore';
  $('#portable-review-title').textContent = restore ? 'Open encrypted review file' : 'Save encrypted review file';
  $('#portable-review-copy').textContent = restore ?
    'Enter the passphrase used when this file was saved. Its holdings, goals and checked fund disclosure weights will replace this tab after you confirm.' :
    'Choose a passphrase of at least 12 characters. This file includes confirmed holdings, goals and checked fund disclosure weights. Keep both the file and passphrase safe; there is no recovery.';
  $('#portable-confirm-label').hidden = restore;
  $('#portable-confirm').hidden = restore;
  $('#portable-confirm').required = !restore;
  $('#portable-review-submit').textContent = restore ? 'Open encrypted file' : 'Save encrypted file';
  $('#portable-review-error').hidden = true;
  $('#portable-review-form').reset();
  $('#portable-review-dialog').showModal();
  $('#portable-passphrase').focus();
}
$('#download-encrypted-review')?.addEventListener('click', () => {
  if (browserOnly && state.account?.portfolio && !state.demo) openPortableDialog('save');
});
$('#portable-review-cancel')?.addEventListener('click', closePortableDialog);
$('#portable-review-dialog')?.addEventListener('cancel', event => { event.preventDefault(); if (!portableBusy) closePortableDialog(); });
$('#portable-review-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!browserOnly || portableBusy || !portableMode) return;
  const passphrase = $('#portable-passphrase').value;
  if (portableMode === 'save' && passphrase !== $('#portable-confirm').value) {
    $('#portable-review-error').textContent = 'The two passphrases do not match.';
    $('#portable-review-error').hidden = false;
    return;
  }
  portableBusy = true;
  $('#portable-review-submit').disabled = true;
  $('#portable-review-cancel').disabled = true;
  try {
    if (portableMode === 'save') {
      const savedSerial = reviewChangeSerial;
      const plain = buildCompleteGuidedDeviceBundle(state.account.portfolio, state.disclosures);
      const encrypted = await encryptDeviceReview(plain, passphrase);
      downloadPrivateFile(encrypted, 'application/json', 'thefinxperts-review-encrypted.json');
      fileSavedSerial = savedSerial;
      say('note', 'Encrypted review file downloaded with holdings, goals and checked fund disclosure weights. Keep its passphrase safe; it cannot be recovered.');
    } else {
      const plain = await decryptDeviceReview(pendingPortableText, passphrase);
      const parsed = parseGuidedDeviceBundle(plain);
      if (parsed.errors.length) throw new Error('The encrypted review is damaged or uses an unsupported format.');
      if (state.account?.portfolio && !window.confirm('Replace the review in this tab with the encrypted file?')) return;
      state.drafts = []; state.sipSummary = null; state.goalFacts = null; state.goalDraftGoalId = null;
      state.correction = null; state.refresh = null; state.disclosureDraft = null;
      state.disclosureQueue = []; state.disclosures = []; state.pendingGoalName = false;
      acceptAccount({ portfolio: parsed.portfolio, revision: state.account.revision + 1 });
      state.disclosures = parsed.disclosures;
      renderDisclosureReview();
      fileSavedSerial = reviewChangeSerial;
      await saveDeviceReview(parsed.portfolio);
      renderDrafts(); renderGoalDraft();
      say('note', `Restored ${state.confirmed.length} holding${state.confirmed.length === 1 ? '' : 's'} from your encrypted file. Check the dates before using this review.`);
      resumeCoverageQuestions(parsed.portfolio);
    }
    closePortableDialog();
  } catch (error) {
    $('#portable-review-error').textContent = error.message || 'Could not process this encrypted review.';
    $('#portable-review-error').hidden = false;
  } finally {
    portableBusy = false;
    $('#portable-review-submit').disabled = false;
    $('#portable-review-cancel').disabled = false;
  }
});

$('#restore-tab-review')?.addEventListener('click', () => $('#restore-tab-file').click());
$('#restore-tab-file')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!browserOnly || !file) return;
  if (file.size > 3_000_000) { say('note', 'Choose a review JSON file smaller than 3 MB.'); return; }
  let parsed;
  try {
    const contents = await file.text();
    const document = JSON.parse(contents);
    if (document && typeof document === 'object' &&
        (Object.hasOwn(document, 'ciphertext') || Object.hasOwn(document, 'kdf'))) {
      openPortableDialog('restore', contents);
      return;
    }
    parsed = parseReviewBackup(contents);
  }
  catch { say('note', 'The selected review file could not be read. Try another copy.'); return; }
  if (parsed.errors.length) { say('note', parsed.errors[0]); return; }
  if (state.account?.portfolio && !window.confirm('Replace the review in this tab with the selected file?')) return;
  state.drafts = []; state.sipSummary = null; state.goalFacts = null; state.goalDraftGoalId = null; state.correction = null; state.refresh = null; state.disclosureDraft = null; state.disclosureQueue = []; state.disclosures = []; state.pendingGoalName = false;
  acceptAccount({ portfolio: parsed.portfolio, revision: state.account.revision + 1 });
  fileSavedSerial = reviewChangeSerial;
  await saveDeviceReview(parsed.portfolio);
  renderDrafts(); renderGoalDraft();
  say('note', `Restored ${state.confirmed.length} holding${state.confirmed.length === 1 ? '' : 's'} from your private file. Check the dates before using this review.`);
  resumeCoverageQuestions(parsed.portfolio);
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
    'Enter your passphrase to load the encrypted review, including checked fund disclosure weights. A separately downloaded secure file can restore those details with its own passphrase.' :
    'Choose a passphrase of at least 12 characters. This saves confirmed holdings, goals and checked fund disclosure weights on this device. You will need the passphrase after a refresh. There is no recovery if you forget it; save a separate secure file as a backup.';
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
      const parsed = parseGuidedDeviceBundle(plain);
      if (parsed.errors.length) throw new Error('The saved review is damaged or uses an unsupported format.');
      if (state.account?.portfolio && !window.confirm('Replace the current tab review with the saved device review?')) return;
      devicePassphrase = passphrase;
      state.drafts = []; state.sipSummary = null; state.goalFacts = null; state.goalDraftGoalId = null; state.correction = null; state.refresh = null; state.disclosureDraft = null; state.disclosureQueue = []; state.disclosures = []; state.pendingGoalName = false;
      acceptAccount({ portfolio: parsed.portfolio, revision: state.account.revision + 1 });
      state.disclosures = parsed.disclosures;
      renderDisclosureReview();
      deviceSavedSerial = reviewChangeSerial;
      renderDrafts(); renderGoalDraft();
      say('note', `Unlocked ${state.confirmed.length} holding${state.confirmed.length === 1 ? '' : 's'} from this device. Check the dates before using this review.`);
      resumeCoverageQuestions(parsed.portfolio);
    } else {
      if (!state.account?.portfolio) throw new Error('Add and confirm a holding or goal before saving on this device.');
      const encrypted = await encryptDeviceReview(buildCompleteGuidedDeviceBundle(state.account.portfolio, state.disclosures), passphrase);
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
if (browserOnly) receiveReviewHandoff({
  onStart: () => say('note', 'Opening your confirmed holdings from Detailed review…'),
  onPortfolio: portfolio => {
    state.drafts = []; state.sipSummary = null; state.goalFacts = null; state.goalDraftGoalId = null;
    state.correction = null; state.refresh = null; state.disclosureDraft = null; state.disclosureQueue = []; state.disclosures = []; state.pendingGoalName = false;
    acceptAccount({ portfolio, revision: state.account.revision + 1 });
    say('note', 'Your Detailed review is open in chat. The two tabs do not sync; save a private review file to keep later changes.');
    resumeCoverageQuestions(portfolio);
  },
  onError: () => say('note', 'The Detailed review could not be opened in chat. Open a saved review file here instead.'),
});
