export const MIX_ASSETS = ['Equity', 'Debt', 'Gold', 'Other'];

/** Parse percentages supplied by the investor; never infer a target. */
export function parseMixPercentages(description) {
  const parts = description.split(/\s*(?:,|\band\b)\s*/i).filter(Boolean);
  const mix = { Equity: 0, Debt: 0, Gold: 0, Other: 0 };
  const seen = new Set();
  for (const part of parts) {
    const pctFirst = /^(\d{1,3})%\s+(equity|debt|gold|other)$/i.exec(part.trim());
    const assetFirst = /^(equity|debt|gold|other)\s+(\d{1,3})%$/i.exec(part.trim());
    if (!pctFirst && !assetFirst) return { error: 'Name each asset and its percentage, such as “Equity 60%, Debt 30%, Gold 10%”. Use your own numbers.' };
    const label = pctFirst?.[2] || assetFirst[1];
    const asset = label[0].toUpperCase() + label.slice(1).toLowerCase();
    const share = Number(pctFirst?.[1] || assetFirst[2]);
    if (seen.has(asset) || share > 100)
      return { error: 'Give each asset category once, with a percentage from 0 to 100.' };
    seen.add(asset);
    mix[asset] = share;
  }
  if (!parts.length || !validMixPlan(mix))
    return { error: 'Your chosen goal mix must total 100%. The site cannot choose a mix for you.' };
  return { mix };
}

/** A temporary scenario is distinct from the saved goal mix command. */
export function parseWhatIfMix(question) {
  if (typeof question !== 'string') return null;
  const match = /^(?:what if (?:my |the )?(?:goal )?mix (?:were|was)|compare (?:a |my )?(?:goal )?mix of)\s+(.+?)[?.!]?$/i.exec(question.trim());
  return match ? parseMixPercentages(match[1]) : null;
}

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
      !MIX_ASSETS.every(asset => Number.isFinite(goalAssets?.[asset]) && goalAssets[asset] >= 0) ||
      goalAssets.Other > 0 ||
      Math.abs(MIX_ASSETS.reduce((sum, asset) => sum + goalAssets[asset], 0) - goalTotal) > 0.01) return null;
  return MIX_ASSETS.map(asset => ({
    asset,
    currentPct: goalAssets[asset] / goalTotal * 100,
    plannedPct: plan[asset],
    differencePct: goalAssets[asset] / goalTotal * 100 - plan[asset],
    differenceValue: goalAssets[asset] - goalTotal * plan[asset] / 100,
  }));
}
