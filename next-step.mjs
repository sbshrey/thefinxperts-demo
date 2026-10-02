import { valuationDateIssue } from './analysis.mjs';

/** Choose one concrete next action for the selected goal, without scoring suitability. */
export function chooseNextReviewStep({ source, holdings, goal, coverage }, today = new Date()) {
  if (source !== 'user' || !Array.isArray(holdings) || holdings.length === 0) return null;
  if (goal?.confirmed !== true) return {
    kind: 'goal', href: '#goal-form', label: 'Enter goal details →',
    text: 'Add your age, goal amount and time horizon to see figures for this goal.',
  };
  if (!coverage) return {
    kind: 'coverage', href: '#coverage-details', label: 'Check what is included →',
    text: 'Confirm whether these rows include all your mutual funds and direct stocks before reading portfolio percentages.',
  };
  if (['some', 'unsure'].includes(coverage.mutualFunds) ||
      ['some', 'unsure'].includes(coverage.directStocks)) return {
    kind: 'scope', href: '#input-choice', label: 'Add or check a source →',
    text: 'Your coverage answer says this snapshot may be incomplete. Compare another current fund or broker report.',
  };
  const dated = holdings.findIndex(holding => valuationDateIssue(holding.asOf, today));
  if (dated >= 0) return {
    kind: 'valuation', href: `#holding-${dated + 1}`, label: 'Check the first dated value →',
    text: 'At least one holding has a missing, future or over-90-day value date. Check it before interpreting the mix for this goal.',
  };
  const unknown = holdings.findIndex(holding => holding.asset === 'Other' && holding.granularity !== 'fund_house');
  if (unknown >= 0) return {
    kind: 'classification', href: `#holding-${unknown + 1}`, label: 'Check the first fund category →',
    text: 'An individual holding is still labelled Other. Check its source before comparing Equity, Debt and Gold shares.',
  };
  if (holdings.some(holding => holding.granularity === 'fund_house')) return {
    kind: 'detail', href: '#input-choice', label: 'Check scheme details →',
    text: 'A fund-house total may contain several schemes. A detailed statement will make the fund part of this review clearer.',
  };
  return {
    kind: 'review', href: '#finding-list', label: 'Read my review questions →',
    text: 'The entered snapshot has dates and categories to review. Read the three questions and check their evidence and limits.',
  };
}
