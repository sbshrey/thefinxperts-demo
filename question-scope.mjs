/** Shared boundary for requests to choose a personal investment action. */
export function asksForAdvice(message) {
  if (typeof message !== 'string') return false;
  return /\b(?:should i|would you|is it wise to|is it a good idea to|help me decide whether to)\s+(?:exercise|sell|hold|keep|buy)\b.{0,70}\b(?:esops?|rsus?|espps?|employee (?:stock|share) options?|stock awards?|restricted stock units?)\b/i.test(message) ||
    /\b(?:recommend|suggest|target allocation|what should i do with|should (?:i|we) (?:buy|sell|switch|rebalance|invest|allocate|increase|reduce|stop|start|continue|pause|cancel|hold|exit|move|shift)|would you (?:buy|sell|switch|invest|allocate|hold)|is it time to (?:buy|sell|switch|invest|exit))\b/i.test(message) &&
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
    /\b(?:what|which)\s+(?:(?:asset|target|portfolio)\s+)?(?:allocation|mix|equity.{0,15}debt\s+split)\s+should\s+i\s+(?:use|have|choose|set|follow)\b/i.test(message) ||
    /\bhow much\s+(?:equity|debt|gold)\s+should\s+i\s+(?:have|hold|allocate|use)\b/i.test(message) ||
    /\bwhat would you\s+(?:change|improve)\s+(?:about|in)\s+my\s+(?:portfolio|holdings?|investments?)\b/i.test(message) ||
    /\b(?:optimi[sz]e|recommend)\b.{0,35}\b(?:my\s+)?(?:portfolio|investments?|allocation)\b/i.test(message) ||
    /\b(?:right|ideal)\s+(?:asset\s+)?mix\s+for\s+me\b/i.test(message) ||
    /\bcan\s+(?:i|we)\s+(?:buy|sell|redeem|exit|switch|hold|keep|invest|allocate|rebalance|move|shift|replace|top\s+up)\b.{0,70}\b(?:fund|stock|share|investment|portfolio|sip|plan|equity|debt)\b/i.test(message) ||
    /\bcan\s+(?:i|we)\s+(?:switch|move|shift|convert)\s+from\s+regular\s+to\s+direct\b/i.test(message) ||
    /\bwould\s+it\s+be\s+(?:wise|smart|better|good)\s+to\s+(?:buy|sell|redeem|exit|switch|hold|keep|invest|allocate|rebalance|move|shift|replace)\b/i.test(message) ||
    /\b(?:is\s+(?:now|this)\s+(?:a\s+)?good\s+time\s+to|is\s+it\s+(?:a\s+)?good\s+idea\s+to)\s+(?:buy|sell|redeem|exit|switch|invest|rebalance)\b/i.test(message) ||
    /\b(?:help me decide|advise me)\s+(?:whether|if)\s+(?:to\s+)?(?:buy|sell|redeem|exit|switch|hold|keep|reduce|increase|remove|replace)\b/i.test(message) ||
    /\bcan\s+(?:i|we)\s+(?:reduce|increase|remove|drop|trim|add)\b.{0,70}\b(?:fund|stock|share|investment|portfolio|sip|position)s?\b/i.test(message) ||
    /\bwhich\b.{0,35}\b(?:fund|stock|share|investment|sip|position)s?\b.{0,25}\b(?:can|could|should)\s+(?:i|we)\s+(?:remove|drop|trim|sell|redeem|exit|replace|reduce|increase)\b/i.test(message) ||
    /\btell me\s+(?:what|which)\s+to\s+(?:buy|sell|redeem|switch|hold|keep|invest in)\b/i.test(message) ||
    /\bhow\s+(?:can|do|should)\s+i\s+optimi[sz]e\s+(?:this|it|my\s+(?:portfolio|investments?|holdings?))\s+for\s+my\s+(?:age|goal|retirement)\b/i.test(message) ||
    /\bis\s+my\s+(?:asset\s+)?allocation\s+(?:right|suitable|appropriate|ideal)\b/i.test(message) ||
    /\bwhat\s+should\s+i\s+do\s+with\s+my\s+(?:investments?|holdings?|funds?|stocks?|shares?)\b/i.test(message) ||
    /\b(?:step[ -]by[ -]step|action plan)\b.{0,70}\b(?:buy|sell|switch|redeem|rebalance|replace|move|shift|increase|reduce)\b.{0,65}\b(?:funds?|stocks?|shares?|investments?|holdings?|portfolio|allocation)\b/i.test(message) ||
    /\b(?:is|would)\s+my\s+(?:asset\s+allocation|asset\s+mix|equity.{0,15}debt\s+split)\b.{0,45}\b(?:right|suitable|appropriate|ideal)\s+for\s+(?:my\s+)?(?:retirement|goal|age|me)\b/i.test(message) ||
    /\bhow\s+(?:can|do|should)\s+i\s+(?:improve|optimi[sz]e)\s+my\s+(?:portfolio|investments?|holdings?)\b/i.test(message);
}
