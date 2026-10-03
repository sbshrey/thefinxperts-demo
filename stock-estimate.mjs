import { estimateUnitValue, realDate } from './nav-estimate.mjs?v=7c0f7987ef9e';

export function validShares(shares) {
  return typeof shares === 'string' && /^[1-9]\d{0,8}$/.test(shares);
}

export function estimateStockValue(shares, price) {
  return validShares(shares) ? estimateUnitValue(shares, price) : null;
}

export function validStockEstimate(holding, today) {
  const estimate = holding?.stockEstimate;
  if (!estimate || holding.type !== 'Stock' || !validShares(holding.shares) ||
      Object.keys(estimate).some(key => !['originalValue', 'originalAsOf', 'price', 'priceAsOf'].includes(key)) ||
      Object.keys(estimate).length !== 4 ||
      typeof estimate.originalValue !== 'number' || !Number.isFinite(estimate.originalValue) ||
      estimate.originalValue <= 0 || estimate.originalValue > 10_000_000_000 ||
      !realDate(estimate.originalAsOf) || !realDate(estimate.priceAsOf) ||
      estimate.priceAsOf <= estimate.originalAsOf || estimate.priceAsOf > today ||
      holding.asOf !== estimate.priceAsOf) return false;
  const value = estimateStockValue(holding.shares, estimate.price);
  return value !== null && value === holding.value;
}
