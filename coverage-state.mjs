export const COVERAGE_FIELDS = Object.freeze(['mutualFunds', 'directStocks', 'otherInvestments']);

const ANSWERS = new Set(['all', 'some', 'none', 'unsure']);

/** Only an explicit saved answer resolves a group; missing is distinct from unsure. */
export function unansweredCoverageFields(coverage) {
  return COVERAGE_FIELDS.filter(field => !ANSWERS.has(coverage?.[field]));
}
