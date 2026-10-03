/** Shared boundary for requests to choose a personal investment action. */
export function asksForAdvice(message) {
  if (typeof message !== 'string') return false;
  return /\b(?:recommend|suggest|target allocation|what should i do with|should (?:i|we) (?:buy|sell|switch|rebalance|invest|allocate|increase|reduce|stop|start|hold|exit|move|shift)|would you (?:buy|sell|switch|invest|allocate|hold)|is it time to (?:buy|sell|switch|invest|exit))\b/i.test(message) &&
      /\b(?:buy|sell|switch|rebalance|invest|fund|stock|share|portfolio|allocate|allocation|sip|increase|reduce|stop|start|hold|exit|move|shift)\b/i.test(message) ||
    /\b(?:best|top)\s+(?:fund|stock|share|investment)s?\b.{0,50}\b(?:for me|for my|to buy|to invest)\b/i.test(message) ||
    /\b(?:fund|stock|share|investment)s?\s+is\s+(?:the\s+)?best\b.{0,50}\b(?:for me|for my)\b/i.test(message) ||
    /^\s*(?:buy|sell|switch|rebalance|allocate|recommend|suggest)\b/i.test(message) ||
    /\b(?:which|what)\b.{0,55}\b(?:fund|stock|share|investment|sip|plan)s?\b.{0,30}\bshould\s+(?:i|we)\s+(?:buy|sell|switch|redeem|exit|hold|keep|increase|reduce|stop|start)\b/i.test(message) ||
    /\b(?:best|top)\b.{0,25}\b(?:fund|stock|share|investment|sip|plan)s?\b.{0,35}\b(?:to buy|to invest|for me|for my)\b/i.test(message) ||
    /\b(?:where|how)\s+should\s+(?:i|we)\s+(?:invest|allocate|rebalance)\b/i.test(message) ||
    /\b(?:tell me|help me decide)\s+which\s+(?:fund|stock|share|investment)s?\s+to\s+(?:buy|sell|switch|redeem|exit|hold|keep)\b/i.test(message) ||
    /\bwhich\b.{0,60}\b(?:fund|stock|share|investment|sip)s?\b.{0,35}\bwould you\s+(?:buy|sell|switch|redeem|exit|hold|keep)\b/i.test(message) ||
    /\b(?:is|would)\s+(?:this|my)\s+(?:fund|stock|share|investment|sip|portfolio|allocation)\b.{0,45}\b(?:right|suitable|appropriate)\s+for\s+me\b/i.test(message) ||
    /\b(?:should|do)\s+i\s+(?:need to\s+)?(?:replace|move|shift|trim|add|drop|keep|redeem|reduce|increase)\b.{0,60}\b(?:fund|stock|share|investment|sip|portfolio|position|plan)\b/i.test(message) ||
    /\bhow would you\s+(?:rebalance|allocate|change|improve)\b.{0,45}\b(?:portfolio|holdings?|investments?|allocation)\b/i.test(message) ||
    /\b(?:pick|choose|select)\s+(?:the\s+)?best\s+(?:fund|stock|share|investment|sip)\b/i.test(message) ||
    /\bwhere should my next\b.{0,50}\b(?:go|be invested|be allocated)\b/i.test(message) ||
    /\bwhat should my\s+(?:equity.{0,15}debt\s+split|asset mix|allocation)\s+be\b/i.test(message) ||
    /\bwhat would you\s+(?:change|improve)\s+(?:about|in)\s+my\s+(?:portfolio|holdings?|investments?)\b/i.test(message) ||
    /\b(?:optimi[sz]e|recommend)\b.{0,35}\b(?:my\s+)?(?:portfolio|investments?|allocation)\b/i.test(message) ||
    /\b(?:right|ideal)\s+(?:asset\s+)?mix\s+for\s+me\b/i.test(message);
}
