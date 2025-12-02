/**
 * SHARED TEXT PROCESSING UTILITIES
 * These functions are used by content scripts AND tested directly
 */

/**
 * Fast hash for change detection (DJB2 algorithm)
 * NOT cryptographic - only for comparison
 */
export function quickHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Extract conversation ID from ChatGPT URL path
 */
export function getConversationId(pathname: string): string | null {
  const match = pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
  return match ? match[1] : null;
}

/**
 * Extract clean product name from user query
 */
export function extractProductName(query: string): string {
  let cleaned = query
    // Remove action phrases at the start (run twice for "list and rank")
    .replace(/^(list|rank|compare|show|give|tell|find|search|get|help|me|and)\s+/gi, '')
    .replace(/^(list|rank|compare|show|give|tell|find|search|get|help|me|and)\s+/gi, '')
    // Remove question words and common phrases (run twice)
    .replace(/^(what|which|can you|please|i need|i want|looking for|find me|recommend|best|top|good|the)\s+/gi, '')
    .replace(/^(what|which|can you|please|i need|i want|looking for|find me|recommend|best|top|good|the)\s+/gi, '')
    .replace(/\?+$/, '')
    // Remove requirement suffixes
    .replace(/\s+(for\s+(men|women|kids|home|office|outdoor|indoor|me|us))\b.*/gi, '')
    .replace(/\s+(under|less than|around|about)\s*\$?\d+.*/gi, '')
    .replace(/\s+(with|without|no|that has|that have)\s+.*/gi, '')
    .replace(/\s*,\s*.*$/, '')
    .trim();

  // Title case
  cleaned = cleaned
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  // Limit length
  if (cleaned.length > 40) {
    cleaned = cleaned.slice(0, 40).trim();
    const lastSpace = cleaned.lastIndexOf(' ');
    if (lastSpace > 20) {
      cleaned = cleaned.slice(0, lastSpace);
    }
  }

  return cleaned || 'Product Research';
}

/**
 * Extract user query from first message (remove common prefixes)
 */
export function extractQuery(firstUserMessage: string): string {
  return firstUserMessage
    .replace(/^(what|which|can you|please|i need|i want|looking for|find me|recommend|help me find)\s+/gi, '')
    .replace(/\?+$/, '')
    .slice(0, 100)
    .trim();
}

/**
 * Pre-computed stop words Set for O(1) lookup
 */
export const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are',
  'was', 'were', 'been', 'being', 'best', 'good', 'great', 'need', 'want', 'looking'
]);

/**
 * Extract keywords from text (single pass, deduplicated)
 */
export function extractKeywords(text: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  const regex = /\b[a-z]{3,}\b/g;
  const lowerText = text.toLowerCase();
  let match;
  
  while ((match = regex.exec(lowerText)) !== null && keywords.length < 20) {
    const word = match[0];
    if (!STOP_WORDS.has(word) && !seen.has(word)) {
      seen.add(word);
      keywords.push(word);
    }
  }
  
  return keywords;
}

