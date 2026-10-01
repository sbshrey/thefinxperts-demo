export const MIX_ASSETS = ['Equity', 'Debt', 'Gold', 'Other'];

/** A user-entered mix must total 100%; no target is generated from age or goal details. */
export function validMixPlan(plan) {
  return plan && MIX_ASSETS.every(asset => typeof plan[asset] === 'number' && Number.isFinite(plan[asset]) &&
    plan[asset] >= 0 && plan[asset] <= 100) &&
    Object.keys(plan).length === MIX_ASSETS.length &&
    Math.abs(MIX_ASSETS.reduce((sum, asset) => sum + plan[asset], 0) - 100) < 0.000001;
}

/** Difference in percentage points between linked holdings and the investor's own plan. */
export function compareMixPlan(goalAssets, goalTotal, plan) {
  if (!validMixPlan(plan) || !Number.isFinite(goalTotal) || goalTotal <= 0 ||
      !MIX_ASSETS.every(asset => Number.isFinite(goalAssets?.[asset]) && goalAssets[asset] >= 0)) return null;
  return MIX_ASSETS.map(asset => ({
    asset,
    currentPct: goalAssets[asset] / goalTotal * 100,
    plannedPct: plan[asset],
    differencePct: goalAssets[asset] / goalTotal * 100 - plan[asset],
  }));
}
