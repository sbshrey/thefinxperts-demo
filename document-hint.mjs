/** Classify only a narrow unsupported source type; never return PDF text or identifiers. */
export function unsupportedPdfHint(firstPagesText) {
  if (typeof firstPagesText !== 'string' || firstPagesText.length > 60_000) return null;
  const text = firstPagesText.toLocaleLowerCase('en-IN');
  if (/\binvoice\b/.test(text) && /\bgst\b/.test(text) && /\bgold\b/.test(text) &&
      /\bquantity\b/.test(text) && !/\b(?:mutual fund|consolidated account statement)\b/.test(text))
    return 'gold_purchase_invoice';
  return null;
}

export function unsupportedPdfGuidance(hint) {
  return hint === 'gold_purchase_invoice' ?
    'This looks like a gold purchase invoice. It records a purchase, but does not establish how much gold you still own or its current value. No holding was added. If you have a current dated valuation, say “I own physical gold worth ₹50,000 as of YYYY-MM-DD” or “I own digital gold worth ₹50,000 as of YYYY-MM-DD” with your own figure, then check the draft against your source. The invoice stayed in this browser.' : null;
}
