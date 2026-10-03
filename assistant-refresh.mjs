import { isRepeatedActiveStatement, planActiveStatementRefresh, planBrokerReportRefresh,
  planDematCasRefresh } from './import-review.mjs?v=e001308747dc';
import { removeHoldingAllocation } from './goals.mjs?v=e001308747dc';
import { rupees } from './assistant-import-audit.mjs?v=e001308747dc';
import { npsTier } from './account-label.mjs?v=e001308747dc';

const money = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const paise = rows => rows.reduce((total, row) => total + Math.round(row.value * 100), 0);
const realDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(new Date(`${value}T00:00:00Z`).valueOf()) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function refreshValueCoverage(incoming, matched) {
  const report = paise(incoming);
  const included = paise(matched.map(pair => pair.next));
  const excluded = report - included;
  return `Parsed report value ${rupees(report / 100)}: ${rupees(included / 100)} in exact matched rows; ${excluded ?
    `${rupees(excluded / 100)} in unmatched rows stays outside this refresh` :
    'no unmatched value stays outside this refresh'}.`;
}

/** A newer passbook may refresh one already confirmed EPF member account. */
export function prepareAssistantEpfoRefresh(saved, incoming) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals) ||
      !incoming || incoming.entryOrigin !== 'epfo_passbook' || incoming.type !== 'Other investment' ||
      incoming.asset !== 'Other' || !/^EPF account [A-F0-9]{12}$/.test(incoming.name) ||
      !Number.isFinite(incoming.value) || incoming.value <= 0 || incoming.value > 10_000_000_000 ||
      !realDate(incoming.asOf)) return null;
  const matches = saved.holdings.filter(row => row.name === incoming.name);
  if (!matches.length) return null;
  const current = matches[0];
  if (matches.length !== 1 || current.entryOrigin !== 'epfo_passbook' ||
      current.type !== 'Other investment' || current.asset !== 'Other' ||
      typeof current.id !== 'string' || !current.id || !realDate(current.asOf) ||
      !Number.isFinite(current.value) || current.value <= 0)
    return { errors: ['This EPF account matches an ambiguous saved row. Check the earlier report before changing it.'] };
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (incoming.asOf > today || incoming.asOf < current.asOf)
    return { errors: ['This EPF passbook is not newer than the saved report. The balance was not changed.'] };
  if (incoming.asOf === current.asOf) return incoming.value === current.value ?
    { errors: [], repeated: true, description: 'This EPF account already has the same report date and balance. No holding or goal link changed.' } :
    { errors: ['This EPF passbook has the saved report date but a different balance. Check the source before changing it.'] };
  const portfolio = structuredClone(saved);
  portfolio.holdings = portfolio.holdings.map(row => row.id === current.id ?
    { ...row, value: incoming.value, asOf: incoming.asOf } : row);
  return { portfolio, errors: [], kind: 'epfo', repeated: false,
    changes: [`${current.name}: ${money(current.value)} (${current.asOf}) → ${money(incoming.value)} (${incoming.asOf})`],
    description: `Newer EPF member passbook for the same account code. Confirm this is the same member account. The reported employee and employer balance will change from ${money(current.value)} (${current.asOf}) to ${money(incoming.value)} (${incoming.asOf}). Other holdings and goal links stay. The date is when the report was printed; later activity may be missing. Pension contribution is excluded. No trade is placed.`,
    result: `EPF balance refreshed from the newer passbook. Check whether later contributions or transfers are missing before relying on the dated value. Goal links stayed.` };
}

/** A newer, reconciled Tier I statement may refresh one NPS account balance. */
export function prepareAssistantNpsRefresh(saved, incoming) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals) ||
      !incoming || incoming.entryOrigin !== 'nps_statement' || incoming.type !== 'Other investment' ||
      incoming.asset !== 'Other' || !/^NPS Tier I account [A-F0-9]{12}$/.test(incoming.name) ||
      !Number.isFinite(incoming.value) || incoming.value <= 0 || incoming.value > 10_000_000_000 ||
      !realDate(incoming.asOf)) return null;
  const matches = saved.holdings.filter(row => row.name === incoming.name);
  const possibleTierOne = saved.holdings.filter(row => row.type === 'Other investment' &&
    npsTier(row.name) !== null && npsTier(row.name) !== 'two');
  if (!matches.length && !possibleTierOne.length) return null;
  if (matches.length > 1 || possibleTierOne.length > 1 ||
      (matches.length && possibleTierOne[0] !== matches[0]))
    return { errors: ['This review has more than one possible NPS Tier I row. Check which account each covers before importing; no value changed.'] };
  const current = matches[0] || possibleTierOne[0];
  if (!matches.length) {
    if (npsTier(current.name) !== 'one' ||
        ![undefined, 'manual'].includes(current.entryOrigin) ||
        current.asset !== 'Other' || typeof current.id !== 'string' || !current.id ||
        !Number.isFinite(current.value) || current.value <= 0 ||
        (current.asOf != null && !realDate(current.asOf)))
      return { errors: ['A saved NPS row may overlap this statement, but its tier or source is unclear. Check that row before importing; no value changed.'] };
    if (current.asOf && incoming.asOf < current.asOf)
      return { errors: ['This NPS statement is older than the manually entered value. Check the dates before replacing it; no value changed.'] };
    const portfolio = structuredClone(saved);
    portfolio.holdings = portfolio.holdings.map(row => row.id === current.id ?
      { ...incoming, id: current.id } : row);
    return { portfolio, errors: [], kind: 'nps', replacesManual: true,
      changes: [`Replace ${current.name}: ${money(current.value)} (${current.asOf || 'date unknown'}) → ${incoming.name}: ${money(incoming.value)} (${incoming.asOf})`],
      description: `Replace one manually entered NPS Tier I row with the dated statement preview. Check that both describe the same PRAN and Tier I balance, and that the manual row did not include Tier II or another account. The entered value changes from ${money(current.value)} (${current.asOf || 'date unknown'}) to ${money(incoming.value)} (${incoming.asOf}); it is not added a second time. The holding's goal links stay. If you cannot confirm the same account, discard this change. Verify every statement scheme and the total; the asset mix and goal access remain unknown.`,
      result: 'The checked NPS Tier I statement replaced the manual row without adding another holding. Its goal links stayed; verify the dated balance against the original.' };
  }
  if (current.entryOrigin !== 'nps_statement' ||
      current.type !== 'Other investment' || current.asset !== 'Other' ||
      typeof current.id !== 'string' || !current.id || !realDate(current.asOf) ||
      !Number.isFinite(current.value) || current.value <= 0)
    return { errors: ['This NPS account matches an ambiguous saved row. Check the earlier statement before changing it.'] };
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (incoming.asOf > today || incoming.asOf < current.asOf)
    return { errors: ['This NPS statement is older than the saved balance. No value changed.'] };
  if (incoming.asOf === current.asOf) return incoming.value === current.value ?
    { errors: [], repeated: true, description: 'This NPS account already has the same investment date and balance. No holding or goal link changed.' } :
    { errors: ['This NPS statement has the saved investment date but a different balance. Check the source before changing it.'] };
  const portfolio = structuredClone(saved);
  portfolio.holdings = portfolio.holdings.map(row => row.id === current.id ?
    { ...row, value: incoming.value, asOf: incoming.asOf } : row);
  return { portfolio, errors: [], kind: 'nps', repeated: false,
    changes: [`${current.name}: ${money(current.value)} (${current.asOf}) → ${money(incoming.value)} (${incoming.asOf})`],
    description: `Newer NPS Tier I statement for the same account code. Confirm this is the same PRAN and tier. The dated scheme total will change from ${money(current.value)} (${current.asOf}) to ${money(incoming.value)} (${incoming.asOf}). Other holdings and goal links stay. The scheme asset mix and access conditions remain unverified. No trade is placed.`,
    result: 'NPS Tier I balance refreshed from the newer statement. Check later contributions and goal access before relying on the dated value. Goal links stayed.' };
}

/** Prepare a complete, newer CAMS Active Statement refresh without changing the saved review. */
export function prepareAssistantActiveRefresh(saved, incoming, makeId = () => crypto.randomUUID()) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals))
    return { errors: ['Add confirmed Active Statement holdings before refreshing them.'] };
  const funds = saved.holdings.filter(row => row.type === 'Mutual fund');
  if (!funds.length || funds.some(row => row.entryOrigin !== 'active_statement'))
    return { errors: ['This review includes funds from another source. Use the detailed review to reconcile a complete statement before replacing fund rows.'] };
  if (isRepeatedActiveStatement(saved.holdings, incoming))
    return { repeated: true, errors: [], description: 'This Active Statement is already in the review. No values or goal links changed.' };
  const plan = planActiveStatementRefresh(saved.holdings, incoming);
  if (!plan) return { errors: ['This statement could not be safely matched as a complete newer snapshot. Check its date, fund names, categories and identifiers in the detailed review.'] };
  const added = plan.added.map(row => ({ ...row, id: makeId() }));
  let goals = structuredClone(saved.goals);
  for (const row of plan.removed) goals = removeHoldingAllocation(goals, row.id);
  const portfolio = structuredClone({ ...saved, holdings: [...plan.holdings, ...added], goals });
  if (added.length || plan.removed.length) delete portfolio.coverage;
  const previousById = new Map(saved.holdings.map(row => [row.id, row]));
  const updated = plan.holdings.filter(row => row.type === 'Mutual fund').map(row => {
    const previous = previousById.get(row.id);
    return `${row.name}: ${money(previous.value)} (${previous.asOf}) → ${money(row.value)} (${row.asOf})`;
  });
  const changes = [
    ...updated,
    ...added.map(row => `Add ${row.name}: ${money(row.value)} (${row.asOf}); goal unassigned`),
    ...plan.removed.map(row => `Remove absent fund ${row.name}: ${money(row.value)} (${row.asOf}); goal links removed`),
  ];
  return { portfolio, errors: [], addedCount: added.length, removedCount: plan.removed.length,
    description: `CAMS Active Statement refresh. Confirm this is a complete newer statement for the same investments. Current confirmed fund value ${rupees(paise(funds) / 100)}; parsed newer fund snapshot ${rupees(paise(incoming) / 100)}. ${plan.updatedCount} existing fund ${plan.updatedCount === 1 ? 'row' : 'rows'} will use its newer dated value; ${added.length} new ${added.length === 1 ? 'row stays' : 'rows stay'} unassigned; ${plan.removed.length} absent ${plan.removed.length === 1 ? 'fund row is' : 'fund rows are'} removed. Direct stocks and matched goal links stay. Checked invested costs and manual NAV estimates on updated funds clear. ${added.length || plan.removed.length ? 'Your self-reported portfolio coverage answer clears. ' : ''}No trade is placed.`,
    changes,
    result: `CAMS refresh applied: ${plan.updatedCount} existing fund ${plan.updatedCount === 1 ? 'row' : 'rows'} updated, ${added.length} added, ${plan.removed.length} removed. Direct stocks and matched goal links stayed. Recheck cost and goal assignment for new rows.` };
}

/** A newer broker snapshot may update only unique exact ISIN matches after review. */
export function prepareAssistantBrokerRefresh(saved, incoming, origin) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(incoming) ||
      !['broker_csv', 'broker_xlsx'].includes(origin)) return null;
  const known = new Set(saved.holdings.map(row => row.isin).filter(Boolean));
  if (!incoming.some(row => row.isin && known.has(row.isin))) return null;
  const plan = planBrokerReportRefresh(saved.holdings, incoming, origin);
  if (!plan) return { errors: ['This report matches a saved ISIN, but it is not a safe newer valuation for that position. Check that it is the same account and holding, with a later ISO valuation date and matching type and asset class. Use the detailed review if the report needs manual reconciliation.'] };
  const portfolio = structuredClone({ ...saved, holdings: plan.holdings });
  if (plan.skipped) delete portfolio.coverage;
  const changes = plan.matched.map(({ current, next }) =>
    `${current.name} · ISIN ${current.isin}: ${money(current.value)} (${current.asOf}) → ${money(next.value)} (${next.asOf})`);
  return { portfolio, errors: [], kind: 'broker', changes,
    description: `Newer broker report. Confirm this covers the same account and positions, not another account or an extra lot. ${plan.matched.length} exact ISIN ${plan.matched.length === 1 ? 'match' : 'matches'} will receive the newer dated value. ${plan.skipped} unmatched report ${plan.skipped === 1 ? 'row stays' : 'rows stay'} out of this review. ${refreshValueCoverage(incoming, plan.matched)} No holding is removed; goal links stay. Prior units, shares, price estimates and checked invested amounts on matched rows clear because this report does not verify them. ${plan.skipped ? 'Recheck your self-reported portfolio coverage. ' : ''}No trade is placed.`,
    result: `Broker report refresh applied to ${plan.matched.length} exact ISIN ${plan.matched.length === 1 ? 'match' : 'matches'}. ${plan.skipped} unmatched ${plan.skipped === 1 ? 'row was' : 'rows were'} not added. Check saved units, invested amounts and the report source before relying on the newer values.` };
}

/** Revalue only unique positions from a newer demat CAS after account confirmation. */
export function prepareAssistantDematRefresh(saved, incoming) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals) ||
      !Array.isArray(incoming) || !incoming.length) return null;
  const known = new Set(saved.holdings.map(row => row.isin).filter(Boolean));
  if (!incoming.some(row => row.isin && known.has(row.isin))) return null;
  const plan = planDematCasRefresh(saved.holdings, incoming);
  if (!plan) return { errors: ['This demat CAS shares an ISIN with the review but cannot safely refresh it. Check for another account, repeated ISINs, changed security names or categories, an old report, or unclassified rows. No values changed.'] };
  if (plan.repeated) {
    if (plan.skipped && saved.coverage) {
      const portfolio = structuredClone(saved);
      delete portfolio.coverage;
      return { portfolio, errors: [], kind: 'demat', scopeOnly: true, changes: [],
        description: `The matched demat positions already use these dated values and fund units. ${plan.skipped} unmatched ${plan.skipped === 1 ? 'row stays' : 'rows stay'} out. ${refreshValueCoverage(incoming, plan.matched)} Confirm this is the same account; your self-reported coverage answer will clear so you can review it again. Holdings and goal links stay.`,
        result: `Matched demat values stayed the same. ${plan.skipped} unmatched ${plan.skipped === 1 ? 'row was' : 'rows were'} not added. Your coverage answer was cleared for review.` };
    }
    return { repeated: true, errors: [],
      description: `The ${plan.matched.length} matched demat ${plan.matched.length === 1 ? 'position already uses' : 'positions already use'} the same dated value and units. ${plan.skipped} unmatched ${plan.skipped === 1 ? 'row was' : 'rows were'} left out. ${refreshValueCoverage(incoming, plan.matched)} No holdings or goal links changed.` };
  }
  const portfolio = structuredClone({ ...saved, holdings: plan.holdings });
  if (plan.skipped) delete portfolio.coverage;
  return { portfolio, errors: [], kind: 'demat',
    changes: plan.changed.map(({ current, next }) =>
      `${current.name} · ISIN ${current.isin}: ${money(current.value)} (${current.asOf}) → ${money(next.value)} (${next.asOf})${current.type === 'Mutual fund' ? ` · units ${current.units} → ${next.units}` : ''}`),
    description: `Newer demat CAS. Confirm this covers the same account and positions, not another account with the same ISIN. ${plan.changed.length} unique matched ${plan.changed.length === 1 ? 'position' : 'positions'} will use newer dated values; ${plan.skipped} unmatched ${plan.skipped === 1 ? 'row stays' : 'rows stay'} out. ${refreshValueCoverage(incoming, plan.matched)} No holding is removed and goal links stay. Earlier price estimates, share counts and checked invested costs on updated rows clear; fund units update from the new statement. ${plan.skipped ? 'Recheck your self-reported portfolio coverage. ' : ''}No trade is placed.`,
    result: `Demat CAS refresh applied to ${plan.changed.length} matched ${plan.changed.length === 1 ? 'position' : 'positions'}. ${plan.skipped} unmatched ${plan.skipped === 1 ? 'row was' : 'rows were'} not added. Check source account, unit counts and dated values.` };
}

/** Update only unambiguous positions from a newer original mutual-fund CAS. */
export function prepareAssistantCasRefresh(saved, incoming, { detailed = false } = {}) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals) ||
      !Array.isArray(incoming) || !incoming.length || incoming.length > (detailed ? 500 : 30)) return null;
  const currentByIsin = new Map();
  for (const row of saved.holdings) {
    if (!row.isin) continue;
    currentByIsin.set(row.isin, currentByIsin.has(row.isin) ? null : row);
  }
  const incomingByIsin = new Map();
  for (const row of incoming) {
    if (!row.isin) continue;
    incomingByIsin.set(row.isin, incomingByIsin.has(row.isin) ? null : row);
  }
  const shared = [...incomingByIsin.keys()].filter(isin => currentByIsin.has(isin));
  if (!shared.length) return null;
  const error = message => ({ errors: [message] });
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const clean = text => text?.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ');
  const realDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  };
  const matches = [];
  for (const isin of shared) {
    const current = currentByIsin.get(isin);
    const next = incomingByIsin.get(isin);
    if (!current || !next) return error('A repeated ISIN has more than one position in the review or this CAS. Reconcile the folios before refreshing; no values changed.');
    if (current.entryOrigin !== 'cas' || next.entryOrigin !== 'cas' ||
        current.type !== 'Mutual fund' || next.type !== 'Mutual fund' ||
        current.granularity || next.granularity || clean(current.name) !== clean(next.name) ||
        current.amc && next.amc && clean(current.amc) !== clean(next.amc) ||
        current.amfi && next.amfi && current.amfi !== next.amfi ||
        !/^INF[A-Z0-9]{9}$/.test(isin) || !realDate(current.asOf) || !realDate(next.asOf) ||
        current.asOf > today || next.asOf > today ||
        !Number.isFinite(next.value) || next.value <= 0 || next.value > 10_000_000_000 ||
        typeof next.units !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(next.units) ||
        !/[1-9]/.test(next.units) ||
        next.asset !== 'Other' && current.asset !== 'Other' && next.asset !== current.asset)
      return error('A matched CAS scheme differs in source, name, identifiers, asset category, units or date. Check both statements before changing this review.');
    if (next.asOf < current.asOf || next.asOf === current.asOf &&
        (next.value !== current.value || next.units !== current.units))
      return error('A matched CAS position is older or conflicts on the same valuation date. No values changed.');
    matches.push({ current, next });
  }
  const changed = matches.filter(({ current, next }) => next.asOf > current.asOf);
  if (!changed.length) {
    const skipped = incoming.length - matches.length;
    if (skipped && saved.coverage) {
      const portfolio = structuredClone(saved);
      delete portfolio.coverage;
      return { portfolio, errors: [], kind: 'cas', scopeOnly: true, changes: [],
        description: `The matched CAS positions already use these dated values and units. ${skipped} unmatched ${skipped === 1 ? 'row stays' : 'rows stay'} out. ${refreshValueCoverage(incoming, matches)} Confirm this is the same investment account; your self-reported coverage answer will clear so you can review it again. Holdings and goal links stay.`,
        result: `Matched CAS values stayed the same. ${skipped} unmatched ${skipped === 1 ? 'row was' : 'rows were'} not added. Your coverage answer was cleared for review.` };
    }
    return { repeated: true, errors: [],
      description: `These matched CAS positions already use the same dated values and units. ${skipped} unmatched ${skipped === 1 ? 'row was' : 'rows were'} not added. ${refreshValueCoverage(incoming, matches)} No values or goal links changed.` };
  }
  const byId = new Map(changed.map(({ current, next }) => [current.id, next]));
  const holdings = saved.holdings.map(row => {
    const next = byId.get(row.id);
    if (!next) return row;
    const { navEstimate: _navEstimate, costBasis: _costBasis,
      costBasisAsOf: _costBasisAsOf, valuationOrigin: _valuationOrigin, ...prior } = row;
    return { ...prior, value: next.value, units: next.units, asOf: next.asOf };
  });
  if (holdings.reduce((sum, row) => sum + Number(row.value), 0) > 1_000_000_000_000)
    return error('The refreshed portfolio would exceed the supported value limit.');
  const skipped = incoming.length - matches.length;
  const portfolio = structuredClone({ ...saved, holdings });
  if (skipped) delete portfolio.coverage;
  return { portfolio, errors: [], kind: 'cas',
    changes: changed.map(({ current, next }) =>
      `${current.name} · ISIN ${current.isin}: ${money(current.value)} (${current.asOf}) → ${money(next.value)} (${next.asOf})`),
    description: `Newer mutual-fund CAS. Confirm this is the same investment position, not another account or extra lot. ${changed.length} exact unique ISIN ${changed.length === 1 ? 'match' : 'matches'} will use newer dated values and units. ${skipped} unmatched CAS ${skipped === 1 ? 'row stays' : 'rows stay'} out; no holding is removed. ${refreshValueCoverage(incoming, matches)} Existing goal links and source-checked asset labels stay. Checked invested costs and manual NAV estimates on updated rows clear. ${skipped ? 'Recheck your self-reported portfolio coverage. ' : ''}No trade is placed.`,
    result: `CAS refresh applied to ${changed.length} exact ISIN ${changed.length === 1 ? 'match' : 'matches'}. ${skipped} unmatched ${skipped === 1 ? 'row was' : 'rows were'} not added. Check any newly bought or exited schemes separately.` };
}
