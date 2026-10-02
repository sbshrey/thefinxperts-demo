/** A dated public-data card needs another source review when its review date arrives. */
export function contextNeedsReview(nextReviewDate, indiaDate) {
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return !validDate(nextReviewDate) || !validDate(indiaDate) || indiaDate >= nextReviewDate;
}
