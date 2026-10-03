/** Identify the tier stated in a user-entered NPS account label. */
export function npsTier(name) {
  if (typeof name !== 'string' ||
      !/\b(?:NPS|National Pension (?:System|Scheme))\b/i.test(name)) return null;
  const one = /\bTier[\s-]*(?:I|1)\b/i.test(name);
  const two = /\bTier[\s-]*(?:II|2)\b/i.test(name);
  if (one && !two) return 'one';
  if (two && !one) return 'two';
  return 'unclear';
}
