const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Preserve paise in investor-supplied cost and calculated change. */
export function rupeesWithPaise(value) {
  const rounded = Math.round(value * 100) / 100;
  return `₹${rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function realDay(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validCostBasis(amount, checkedOn, today = new Date()) {
  const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 &&
    amount <= 10_000_000_000 && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001 &&
    realDay(checkedOn) && checkedOn <= indiaToday;
}

/** One supplied cost figure for the units or shares still held; no realized or annualized return. */
export function summarizeUnrealizedChange(holdings, today = new Date()) {
  const indiaToday = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  let coveredValue = 0;
  let invested = 0;
  let coveredCount = 0;
  let missingCount = 0;
  let costAfterValueCount = 0;
  const valueDates = [];
  for (const holding of holdings || []) {
    if (!holding || !Number.isFinite(holding.value) || holding.value <= 0 ||
        holding.value > 10_000_000_000) continue;
    if (holding.granularity === 'fund_house' ||
        !validCostBasis(holding.costBasis, holding.costBasisAsOf, today) ||
        !realDay(holding.asOf) || holding.asOf > indiaToday ||
        holding.costBasisAsOf > holding.asOf) {
      if (holding.granularity !== 'fund_house' && realDay(holding.asOf) && holding.asOf <= indiaToday &&
          validCostBasis(holding.costBasis, holding.costBasisAsOf, today) &&
          holding.costBasisAsOf > holding.asOf) costAfterValueCount++;
      missingCount++;
      continue;
    }
    coveredValue += holding.value;
    invested += holding.costBasis;
    coveredCount++;
    valueDates.push(holding.asOf);
  }
  valueDates.sort();
  return { coveredValue, invested, change: coveredValue - invested, coveredCount, missingCount,
    costAfterValueCount,
    earliestValueDate: valueDates[0] || null, latestValueDate: valueDates.at(-1) || null };
}
