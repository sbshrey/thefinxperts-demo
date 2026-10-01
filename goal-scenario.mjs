/** Pure arithmetic scenario; no expected-return forecast or suitability decision. */
export function calculateGoalScenario(currentValue, goal) {
  const years = Number(goal.years);
  const targetToday = Number(goal.target);
  const monthlyContribution = Number(goal.monthlyContribution ?? 0);
  const returnPct = Number(goal.returnPct ?? 0);
  const inflationPct = Number(goal.inflationPct ?? 0);
  if (![currentValue, years, targetToday, monthlyContribution, returnPct, inflationPct].every(Number.isFinite) ||
      currentValue < 0 || currentValue > 1e12 || !Number.isInteger(years) || years < 1 || years > 50 ||
      targetToday < 1000 || targetToday > 1e12 || monthlyContribution < 0 || monthlyContribution > 1e8 ||
      returnPct < -20 || returnPct > 13 || inflationPct < -5 || inflationPct > 15) return null;

  const months = years * 12;
  const monthlyRate = Math.pow(1 + returnPct / 100, 1 / 12) - 1;
  const contributionFactor = Math.abs(monthlyRate) < 1e-12 ? months : Math.expm1(months * Math.log1p(monthlyRate)) / monthlyRate;
  const currentFutureValue = currentValue * Math.pow(1 + returnPct / 100, years);
  const futureCost = targetToday * Math.pow(1 + inflationPct / 100, years);
  const projectedValue = currentFutureValue + monthlyContribution * contributionFactor;
  const futureGap = Math.max(0, futureCost - projectedValue);
  const monthlyTotalNeeded = Math.max(0, (futureCost - currentFutureValue) / contributionFactor);
  if (![contributionFactor, futureCost, projectedValue, futureGap, monthlyTotalNeeded].every(Number.isFinite)) return null;
  return { futureCost, projectedValue, futureGap, monthlyTotalNeeded, monthlyContribution, returnPct, inflationPct, years };
}

/** A one-time, user-chosen equity loss applied only to holdings assigned to a goal. */
export function calculateEquityShockScenario(currentValue, equityValue, targetToday, dropPct) {
  if (![currentValue, equityValue, targetToday, dropPct].every(Number.isFinite) ||
      currentValue < 0 || currentValue > 1e12 || equityValue < 0 || equityValue > currentValue ||
      targetToday < 1000 || targetToday > 1e12 || dropPct < 0 || dropPct > 60) return null;
  const loss = equityValue * dropPct / 100;
  const valueAfterLoss = currentValue - loss;
  const gapToday = Math.max(0, targetToday - currentValue);
  const gapAfterLoss = Math.max(0, targetToday - valueAfterLoss);
  return { dropPct, loss, valueAfterLoss, gapToday, gapAfterLoss, addedGap: gapAfterLoss - gapToday };
}

/** Compare a hypothetical loss with optional user-entered limits; no suitability conclusion. */
export function compareEnteredLossLimits(loss, goal) {
  if (!Number.isFinite(loss) || loss < 0 || !goal || typeof goal !== 'object') return null;
  const check = value => value === undefined ? null :
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e10
      ? { limit: value, excess: Math.max(0, loss - value) } : null;
  return { affordable: check(goal.affordableLoss), tolerable: check(goal.tolerableLoss) };
}
