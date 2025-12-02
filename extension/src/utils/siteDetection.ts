/**
 * Shared site detection utilities
 * Single source of truth for shopping site detection
 */

// Known shopping site domains/patterns
export const SHOPPING_DOMAINS = [
  'amazon', 'bestbuy', 'target', 'walmart', 'homedepot', 'lowes',
  'newegg', 'ebay', 'wayfair', 'costco', 'macys', 'nordstrom',
  'zappos', 'bhphotovideo', 'adorama', 'overstock', 'chewy', 'etsy',
  'alibaba', 'aliexpress', 'wish', 'shopify', 'bigcommerce',
];

// Shopping-related URL patterns
export const SHOPPING_URL_PATTERNS = [
  'shop', 'store', 'buy', 'cart', 'checkout', 'product', 'item',
];

// Non-shopping sites to always skip
export const SKIP_PATTERNS = [
  /google\.(com|[a-z]{2})\/search/i,
  /youtube\.com/i,
  /facebook\.com/i,
  /twitter\.com|x\.com/i,
  /instagram\.com/i,
  /reddit\.com/i,
  /wikipedia\.org/i,
  /chatgpt\.com|openai\.com/i,
  /github\.com/i,
  /linkedin\.com/i,
  /healthline\.com/i,
  /webmd\.com/i,
  /mayoclinic\.org/i,
  /medium\.com/i,
  /stackoverflow\.com/i,
];

/**
 * Check if a URL is a known non-shopping site
 */
export function isDefinitelyNotShopping(url: string): boolean {
  return SKIP_PATTERNS.some(p => p.test(url));
}

/**
 * Check if a hostname looks like a shopping site
 * Used for quick UI hints (not for final AI decision)
 */
export function isLikelyShoppingSite(hostname: string): boolean {
  const h = hostname.toLowerCase().replace('www.', '');
  
  // Check known shopping domains
  if (SHOPPING_DOMAINS.some(d => h.includes(d))) {
    return true;
  }
  
  // Check shopping URL patterns
  if (SHOPPING_URL_PATTERNS.some(p => h.includes(p))) {
    return true;
  }
  
  return false;
}

/**
 * Extract domain from URL safely
 */
export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return null;
  }
}

