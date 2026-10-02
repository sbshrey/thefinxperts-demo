/** Portfolio-wide context, separate from investments assigned to a goal. */
export function validReserve(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 2 && Object.hasOwn(value, 'monthlyEssentials') &&
    Object.hasOwn(value, 'accessibleMoney') &&
    Number.isFinite(value.monthlyEssentials) && value.monthlyEssentials > 0 &&
    value.monthlyEssentials <= 100_000_000 && Number.isFinite(value.accessibleMoney) &&
    value.accessibleMoney >= 0 && value.accessibleMoney <= 10_000_000_000;
}

export function reserveMonths(value) {
  return validReserve(value) ? value.accessibleMoney / value.monthlyEssentials : null;
}
