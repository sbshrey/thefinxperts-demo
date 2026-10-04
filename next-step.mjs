import { valuationDateIssue } from './analysis.mjs?v=a3cc883568ab';
import { goalShare } from './goals.mjs?v=a3cc883568ab';
import { confirmedGoalAssumptions } from './goal-scenario.mjs?v=a3cc883568ab';
import { unansweredCoverageFields } from './coverage-state.mjs?v=a3cc883568ab';

/** Choose one concrete next action for the selected goal, without scoring suitability. */
export function chooseNextReviewStep({ source, holdings, goal, coverage, findings = [] }, today = new Date()) {
  if (source !== 'user' || !Array.isArray(holdings) || holdings.length === 0) return null;
  if (goal?.confirmed !== true) return {
    kind: 'goal', href: '#goal-form', label: 'Enter goal details →',
    text: 'Add your age, goal amount and time horizon to see figures for this goal.',
  };
  const linkedIndices = Array.isArray(goal?.linkedIds) ?
    holdings.flatMap((holding, index) => goalShare(goal, holding.id) > 0 ? [index] : []) :
    holdings.map((_, index) => index);
  if (!linkedIndices.length) return {
    kind: 'assignment', href: '#holdings', label: 'Link a holding to this goal →',
    text: 'No entered holding is assigned to the selected goal. Choose which holdings count toward it before reading its gap or mix.',
  };
  const unanswered = unansweredCoverageFields(coverage);
  if (unanswered.length) return {
    kind: 'coverage', href: '#coverage-details', label: 'Check what is included →',
    text: `Coverage is not yet answered for ${unanswered.map(field => ({ mutualFunds: 'mutual funds',
      directStocks: 'direct stocks', otherInvestments: 'other investments' })[field]).join(', ')}. Check these groups against current statements before treating the entered total as complete.`,
  };
  if (['some', 'unsure'].includes(coverage.mutualFunds) ||
      ['some', 'unsure'].includes(coverage.directStocks) ||
      ['some', 'unsure'].includes(coverage.otherInvestments)) return {
    kind: 'scope', href: '#input-choice', label: 'Add or check a source →',
    text: 'Your coverage answer says this snapshot may be incomplete. Compare another current fund, broker or other investment statement.',
  };
  const dated = linkedIndices.find(index => valuationDateIssue(holdings[index].asOf, today)) ?? -1;
  if (dated >= 0) return {
    kind: 'valuation', href: `#holding-${dated + 1}`, label: 'Check the first dated value →',
    text: 'At least one holding has a missing, future or over-90-day value date. Check it before interpreting the mix for this goal.',
  };
  const access = linkedIndices.find(index => holdings[index].type === 'Other investment') ?? -1;
  if (access >= 0) return {
    kind: 'access', href: `#holding-${access + 1}`, label: 'Check a linked holding →',
    text: 'A manually valued investment is linked to this goal. Check its maturity or withdrawal terms against the goal date, then review whether it should stay assigned.',
  };
  const unknown = linkedIndices.find(index => holdings[index].asset === 'Other' &&
    holdings[index].type !== 'Other investment' && holdings[index].granularity !== 'fund_house') ?? -1;
  if (unknown >= 0) return {
    kind: 'classification', href: `#holding-${unknown + 1}`, label: 'Check the first fund category →',
    text: 'An individual holding is still labelled Other. Check its source before comparing Equity, Debt and Gold shares.',
  };
  if (linkedIndices.some(index => holdings[index].granularity === 'fund_house')) return {
    kind: 'detail', href: '#input-choice', label: 'Check scheme details →',
    text: 'A fund-house total may contain several schemes. A detailed statement will make the fund part of this review clearer.',
  };
  const reviewFinding = Array.isArray(findings) ? findings.find(finding =>
    ['reserve', 'emergency', 'loss-capacity', 'chosen-mix', 'horizon', 'position',
      'portfolio-position', 'issuer', 'plan', 'funds'].includes(finding?.key)) : null;
  if (reviewFinding) return {
    kind: 'finding', href: '#finding-list', label: 'Read this review check →',
    text: `${reviewFinding.title}. ${reviewFinding.question}`,
  };
  if (!confirmedGoalAssumptions(goal)) return {
    kind: 'assumptions', href: '#goal-assumptions', label: 'Confirm goal assumptions →',
    text: 'Choose a monthly amount, growth and inflation assumption before viewing a future goal illustration. You can deliberately choose zero for any of them.',
  };
  return {
    kind: 'review', href: '#finding-list', label: 'Read my review questions →',
    text: 'The entered snapshot has dates and categories to review. Read the three questions and check their evidence and limits.',
  };
}
