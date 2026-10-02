import { isRepeatedActiveStatement, planActiveStatementRefresh } from './import-review.mjs';
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
