/** Existing reviews store years; a valid horizon now represents a whole number of months. */
export function goalMonths(years) {
  if (typeof years !== 'number' || !Number.isFinite(years)) return null;
  const months = Math.round(years * 12);
  return months >= 1 && months <= 600 && Math.abs(years * 12 - months) < 1e-8 ? months : null;
}

export function yearsForMonths(months) {
  return Number.isInteger(months) && months >= 1 && months <= 600 ? months / 12 : null;
}

export function formatGoalHorizon(years) {
  const months = goalMonths(years);
  if (months === null) return 'time horizon not confirmed';
  const wholeYears = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (!wholeYears) return `${months} ${months === 1 ? 'month' : 'months'}`;
  const yearsText = `${wholeYears} ${wholeYears === 1 ? 'year' : 'years'}`;
  return remainingMonths ? `${yearsText} ${remainingMonths} ${remainingMonths === 1 ? 'month' : 'months'}` : yearsText;
}
