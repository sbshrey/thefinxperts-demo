/** Whole assignments stay simple; optional integer shares let one holding serve several goals. */
export function goalShare(goal, holdingId) {
  if (!Array.isArray(goal?.linkedIds) || !goal.linkedIds.includes(holdingId)) return 0;
  return goal.allocationPct?.[holdingId] ?? 100;
}

function withShares(goal, linkedIds, allocationPct) {
  const { allocationPct: ignored, ...rest } = goal;
  return { ...rest, linkedIds, ...(Object.keys(allocationPct).length ? { allocationPct } : {}) };
}

export function setGoalHolding(goals, goalId, holdingId, checked) {
  return goals.map(goal => {
    const current = Array.isArray(goal.linkedIds) ? goal.linkedIds : [];
    const allocationPct = { ...goal.allocationPct };
    if (checked || goal.id === goalId) delete allocationPct[holdingId];
    let linkedIds = current;
    if (checked && goal.id === goalId) linkedIds = [...new Set([...current, holdingId])];
    else if (checked || goal.id === goalId) linkedIds = current.filter(id => id !== holdingId);
    return withShares(goal, linkedIds, allocationPct);
  });
}

/** Percentages are whole numbers; any remainder is explicitly unassigned. */
export function setHoldingAllocations(goals, holdingId, percentages) {
  if (!goals.every(goal => Number.isInteger(percentages[goal.id]) && percentages[goal.id] >= 0 && percentages[goal.id] <= 100) ||
      goals.reduce((sum, goal) => sum + percentages[goal.id], 0) > 100) {
    throw new Error('Goal shares must be whole percentages totalling no more than 100%.');
  }
  return goals.map(goal => {
    const share = percentages[goal.id];
    const linkedIds = (goal.linkedIds || []).filter(id => id !== holdingId);
    if (share) linkedIds.push(holdingId);
    const allocationPct = { ...goal.allocationPct };
    delete allocationPct[holdingId];
    if (share && share < 100) allocationPct[holdingId] = share;
    return withShares(goal, linkedIds, allocationPct);
  });
}

export function removeHoldingAllocation(goals, holdingId) {
  return goals.map(goal => {
    const allocationPct = { ...goal.allocationPct };
    delete allocationPct[holdingId];
    return withShares(goal, (goal.linkedIds || []).filter(id => id !== holdingId), allocationPct);
  });
}

export function relinkAfterReplacingHoldings(goals, activeGoalId, holdings) {
  const ids = holdings.map(holding => holding.id);
  return goals.map(goal => withShares(goal, goal.id === activeGoalId ? ids : [], {}));
}

/** Preserve existing assignments and add only new positions to the selected goal. */
export function linkAddedHoldings(goals, activeGoalId, holdings) {
  const newIds = holdings.map(holding => holding.id);
  return goals.map(goal => goal.id === activeGoalId ?
    { ...goal, linkedIds: [...new Set([...(goal.linkedIds || []), ...newIds])] } :
    { ...goal, linkedIds: [...(goal.linkedIds || [])] });
}

/** Show which entered value is outside the selected goal's figures. */
export function summarizeGoalCoverage(goals, activeGoalId, holdings) {
  const selectedGoal = goals.find(goal => goal.id === activeGoalId);
  const otherGoals = goals.filter(goal => goal.id !== activeGoalId);
  const summary = { elsewhereValue: 0, elsewhereCount: 0, unassignedValue: 0, unassignedCount: 0 };
  for (const holding of holdings) {
    const selectedShare = goalShare(selectedGoal, holding.id);
    const elsewhereShare = otherGoals.reduce((sum, goal) => sum + goalShare(goal, holding.id), 0);
    const unassignedShare = Math.max(0, 100 - selectedShare - elsewhereShare);
    if (elsewhereShare) {
      summary.elsewhereValue += Number(holding.value) * elsewhereShare / 100;
      summary.elsewhereCount++;
    }
    if (unassignedShare) {
      summary.unassignedValue += Number(holding.value) * unassignedShare / 100;
      summary.unassignedCount++;
    }
  }
  return summary;
}
