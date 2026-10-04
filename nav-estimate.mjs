const UNIT = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/;
const NAV = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,8})?$/;

export function validUnits(units) {
  return typeof units === 'string' && UNIT.test(units) && /[1-9]/.test(units);
}

function scaled(text, places) {
  const [whole, fraction = ''] = text.split('.');
  const scale = 10n ** BigInt(places);
  return BigInt(whole) * scale + BigInt(fraction.padEnd(places, '0'));
}

/** Paise rounded half up from exact six-place units and up to eight-place NAV. */
export function estimateUnitValue(units, nav) {
  if (!validUnits(units) ||
      typeof nav !== 'string' || !NAV.test(nav) || !/[1-9]/.test(nav)) return null;
  const paise = (scaled(units, 6) * scaled(nav, 8) + 500_000_000_000n) /
    1_000_000_000_000n;
  if (paise <= 0n || paise > 1_000_000_000_000n) return null;
  return Number(paise) / 100;
}
export const estimateNavValue = estimateUnitValue;

/** Public scheme lookup; only the validated mutual-fund ISIN enters the URL. */
export function fundNavLookupUrl(isin) {
  return typeof isin === 'string' && /^INF[A-Z0-9]{9}$/.test(isin) ?
    `https://mfnav.in/?q=${encodeURIComponent(isin)}` : null;
}

export function validNavEstimate(holding, today) {
  const estimate = holding?.navEstimate;
  if (!estimate || holding.type !== 'Mutual fund' || holding.granularity === 'fund_house' || !holding.units ||
      Object.keys(estimate).some(key => !['originalValue', 'originalAsOf', 'nav', 'navAsOf'].includes(key)) ||
      Object.keys(estimate).length !== 4 ||
      typeof estimate.originalValue !== 'number' || !Number.isFinite(estimate.originalValue) ||
      estimate.originalValue <= 0 || estimate.originalValue > 10_000_000_000 ||
      !realDate(estimate.originalAsOf) ||
      !realDate(estimate.navAsOf) || estimate.navAsOf > today ||
      estimate.navAsOf <= estimate.originalAsOf ||
      holding.asOf !== estimate.navAsOf) return false;
  const value = estimateNavValue(holding.units, estimate.nav);
  return value !== null && holding.value === value;
}

export function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
