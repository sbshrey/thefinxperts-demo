/** Classify only a narrow unsupported source type; never return PDF text or identifiers. */
export function unsupportedPdfHint(firstPagesText) {
  if (typeof firstPagesText !== 'string' || firstPagesText.length > 60_000) return null;
  const text = firstPagesText.toLocaleLowerCase('en-IN');
  if (/\binvoice\b/.test(text) && /\bgst\b/.test(text) && /\bgold\b/.test(text) &&
      /\bquantity\b/.test(text) && !/\b(?:mutual fund|consolidated account statement)\b/.test(text))
    return 'gold_purchase_invoice';
  if (/\bgold\b/.test(text) && /\bstatement\b/.test(text) && /\bbought\b/.test(text) &&
      /\bbalance\b/.test(text) && /\bgrams?\b|\d\s*g\b/.test(text) &&
      !/\b(?:mutual fund|consolidated account statement|gold loan)\b/.test(text))
    return 'gold_activity_statement';
  return null;
}

export function unsupportedPdfGuidance(hint) {
  return hint === 'gold_purchase_invoice' ?
    'This looks like a gold purchase invoice. It records a purchase, but does not establish how much gold you still own or its current value. No holding was added. If you have a current dated valuation, say “I own physical gold worth ₹50,000 as of YYYY-MM-DD” or “I own digital gold worth ₹50,000 as of YYYY-MM-DD” with your own figure, then check the draft against your source. The invoice stayed in this browser.' :
    hint === 'gold_activity_statement' ?
      'This looks like a gold activity statement. Purchases and a printed balance do not establish the gold you still own or its current rupee value. No holding was added. Check the latest balance, the value and its date in your provider account; then say “I own digital gold worth ₹50,000 as of YYYY-MM-DD” using your checked figure. The statement stayed in this browser.' : null;
}
