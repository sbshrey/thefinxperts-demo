/** Keep a holding assigned to at most one goal. An unchecked holding is unassigned. */
export function setGoalHolding(goals, goalId, holdingId, checked) {
  return goals.map(goal => {
    const current = Array.isArray(goal.linkedIds) ? goal.linkedIds : [];
    return {
      ...goal,
      linkedIds: checked && goal.id === goalId
        ? [...new Set([...current, holdingId])]
        : current.filter(id => id !== holdingId),
    };
  });
}

export function relinkAfterReplacingHoldings(goals, activeGoalId, holdings) {
  const ids = holdings.map(holding => holding.id);
  return goals.map(goal => ({ ...goal, linkedIds: goal.id === activeGoalId ? ids : [] }));
}

/** Preserve existing assignments and add only new positions to the selected goal. */
export function linkAddedHoldings(goals, activeGoalId, holdings) {
  const newIds = holdings.map(holding => holding.id);
  return goals.map(goal => goal.id === activeGoalId ?
    { ...goal, linkedIds: [...new Set([...(goal.linkedIds || []), ...newIds])] } :
    { ...goal, linkedIds: [...(goal.linkedIds || [])] });
}
