import { isRepeatedActiveStatement, planActiveStatementRefresh, planBrokerReportRefresh } from './import-review.mjs';
import { removeHoldingAllocation } from './goals.mjs';

const money = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

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
    description: `CAMS Active Statement refresh. Confirm this is a complete newer statement for the same investments. ${plan.updatedCount} existing fund ${plan.updatedCount === 1 ? 'row' : 'rows'} will use its newer dated value; ${added.length} new ${added.length === 1 ? 'row stays' : 'rows stay'} unassigned; ${plan.removed.length} absent ${plan.removed.length === 1 ? 'fund row is' : 'fund rows are'} removed. Direct stocks and matched goal links stay. Checked invested costs and manual NAV estimates on updated funds clear. ${added.length || plan.removed.length ? 'Your self-reported portfolio coverage answer clears. ' : ''}No trade is placed.`,
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
  const changes = plan.matched.map(({ current, next }) =>
    `${current.name} · ISIN ${current.isin}: ${money(current.value)} (${current.asOf}) → ${money(next.value)} (${next.asOf})`);
  return { portfolio, errors: [], kind: 'broker', changes,
    description: `Newer broker report. Confirm this covers the same account and positions, not another account or an extra lot. ${plan.matched.length} exact ISIN ${plan.matched.length === 1 ? 'match' : 'matches'} will receive the newer dated value. ${plan.skipped} unmatched report ${plan.skipped === 1 ? 'row stays' : 'rows stay'} out of this review. No holding is removed; goal links stay. Prior units, shares, price estimates and checked invested amounts on matched rows clear because this report does not verify them. No trade is placed.`,
    result: `Broker report refresh applied to ${plan.matched.length} exact ISIN ${plan.matched.length === 1 ? 'match' : 'matches'}. ${plan.skipped} unmatched ${plan.skipped === 1 ? 'row was' : 'rows were'} not added. Check saved units, invested amounts and the report source before relying on the newer values.` };
}

/** Update only unambiguous positions from a newer original mutual-fund CAS. */
export function prepareAssistantCasRefresh(saved, incoming) {
  if (!saved || saved.version !== 2 || !Array.isArray(saved.holdings) || !Array.isArray(saved.goals) ||
      !Array.isArray(incoming) || !incoming.length || incoming.length > 30) return null;
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
  if (!changed.length) return { repeated: true, errors: [],
    description: `These matched CAS positions already use the same dated values and units. ${incoming.length - matches.length} unmatched ${incoming.length - matches.length === 1 ? 'row was' : 'rows were'} not added. No values or goal links changed.` };
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
  return { portfolio: structuredClone({ ...saved, holdings }), errors: [], kind: 'cas',
    changes: changed.map(({ current, next }) =>
      `${current.name} · ISIN ${current.isin}: ${money(current.value)} (${current.asOf}) → ${money(next.value)} (${next.asOf})`),
    description: `Newer mutual-fund CAS. Confirm this is the same investment position, not another account or extra lot. ${changed.length} exact unique ISIN ${changed.length === 1 ? 'match' : 'matches'} will use newer dated values and units. ${skipped} unmatched CAS ${skipped === 1 ? 'row stays' : 'rows stay'} out; no holding is removed. Existing goal links and source-checked asset labels stay. Checked invested costs and manual NAV estimates on updated rows clear. No trade is placed.`,
    result: `CAS refresh applied to ${changed.length} exact ISIN ${changed.length === 1 ? 'match' : 'matches'}. ${skipped} unmatched ${skipped === 1 ? 'row was' : 'rows were'} not added. Check any newly bought or exited schemes separately.` };
}
