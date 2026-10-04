/** Awards need ownership evidence before they can be counted as directly held stock. */
export function mentionsEmployeeStockAward(text) {
  return typeof text === 'string' &&
    /\b(?:rsus?|restricted stock units?|esops?|employee stock options?|employee share options?|espps?|employee stock purchase plans?|stock awards?|unvested shares?)\b/i.test(text);
}
