/**
 * Background Service Worker
 * Orchestrates communication between content scripts and API
 * Manages persistent research history for intelligent matching
 */

// Types
interface ProductContext {
  query: string;
  requirements: string[];
  timestamp: number;
  source: 'chatgpt' | 'manual';
  mentionedProducts?: string[];
  trackedLinks?: Array<{
    url: string;
    domain: string;
    text: string;
  }>;
  messageCount?: number;
  conversationId?: string;
  recentMessages?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

// Persistent research history entry
interface ResearchEntry {
  id: string;
  query: string;
  productName: string;   // Clean, title-cased product name for display
  requirements: string[];
  categories: string[];  // Extracted product categories
  keywords: string[];    // Keywords for matching
  timestamp: number;
  lastUsed: number;
  conversationId?: string;
}

interface ProductData {
  title: string;
  price: number | null;
  url: string;
  description: string;
  imageUrl?: string;
}

interface RankingResult {
  rankings: Array<{
    index: number;
    score: number;
    reasons: string[];
  }>;
  summary: string;
}

interface SiteAnalysisResult {
  isShoppingSite: boolean;
  siteCategory?: string;
  matchedResearchId?: string;
  matchScore?: number;
  matchReason?: string;
}

// Storage keys
const CONTEXT_KEY = 'sift:context';           // Current session context
const HISTORY_KEY = 'sift:researchHistory';   // Persistent research history
const API_URL_KEY = 'sift:apiUrl';
const USER_PROFILE_KEY = 'sift:userProfile';  // Learned user preferences

// User profile - learned from all research sessions
interface UserProfile {
  // Core values extracted from user's research patterns
  values: string[];           // e.g., ["health-conscious", "eco-friendly", "quality-focused"]
  avoids: string[];           // e.g., ["plastic", "synthetic", "cheap materials"]
  prefers: string[];          // e.g., ["natural materials", "leather", "stainless steel"]
  priceRange: string;         // e.g., "mid-range", "premium", "budget-conscious"
  priorities: string[];       // e.g., ["durability", "safety", "aesthetics"]
  
  // Metadata
  extractedFrom: number;      // Number of research sessions analyzed
  lastUpdated: number;
}

// Production API URL
const DEFAULT_API_URL = 'https://sift-api.christiandcattaneo.workers.dev';

// ============================================
// IN-MEMORY CACHES (Performance optimization)
// ============================================

// Cache for AI site analysis results (by domain)
const siteAnalysisCache = new Map<string, {
  result: SiteAnalysisResult;
  timestamp: number;
}>();
const SITE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Cache for research history (avoid repeated storage reads)
let historyCache: ResearchEntry[] | null = null;
let historyCacheTime = 0;
const HISTORY_CACHE_TTL = 5000; // 5 seconds

// Track tabs where shopping script is already injected
const injectedTabs = new Set<number>();

// Debounce user profile updates
let profileUpdateTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProfileContext: ProductContext | null = null;
const PROFILE_UPDATE_DELAY = 2000; // 2 seconds debounce

// Product categories for intelligent matching
const PRODUCT_CATEGORIES: Record<string, string[]> = {
  'water-filter': ['water filter', 'shower filter', 'faucet filter', 'reverse osmosis', 'filtration', 'fluoride', 'chlorine', 'purifier'],
  'electronics': ['laptop', 'computer', 'phone', 'tablet', 'monitor', 'keyboard', 'mouse', 'headphones', 'earbuds', 'speaker', 'camera', 'tv', 'television'],
  'appliances': ['refrigerator', 'washer', 'dryer', 'dishwasher', 'microwave', 'oven', 'vacuum', 'air purifier', 'humidifier', 'dehumidifier', 'air conditioner'],
  'furniture': ['desk', 'chair', 'table', 'sofa', 'couch', 'bed', 'mattress', 'bookshelf', 'cabinet', 'dresser'],
  'fitness': ['treadmill', 'bike', 'weights', 'dumbbells', 'yoga mat', 'resistance bands', 'fitness tracker', 'gym equipment'],
  'kitchen': ['blender', 'mixer', 'coffee maker', 'espresso', 'toaster', 'air fryer', 'instant pot', 'cookware', 'knife', 'pan', 'pot'],
  'outdoor': ['grill', 'lawn mower', 'garden', 'patio', 'tent', 'camping', 'hiking', 'backpack'],
  'beauty': ['skincare', 'makeup', 'haircare', 'shampoo', 'conditioner', 'moisturizer', 'serum', 'sunscreen'],
  'clothing': ['shoes', 'sneakers', 'boots', 'jacket', 'coat', 'pants', 'jeans', 'shirt', 'dress', 'athletic wear'],
  'tools': ['drill', 'saw', 'hammer', 'screwdriver', 'wrench', 'tool set', 'power tool'],
  'baby': ['stroller', 'car seat', 'crib', 'baby monitor', 'diaper', 'bottle', 'formula'],
  'pet': ['dog food', 'cat food', 'pet bed', 'leash', 'collar', 'litter', 'aquarium'],
  'gaming': ['gaming', 'console', 'playstation', 'xbox', 'nintendo', 'gaming chair', 'gaming mouse', 'gaming keyboard'],
};

export default defineBackground(() => {
  console.log('[Sift] Background service worker started');

  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true;
  });

  // Listen for tab navigation to detect shopping sites
  browser.webNavigation?.onCompleted.addListener((details) => {
    if (details.frameId === 0) {
      checkIfShoppingSite(details.tabId, details.url);
    }
  });
  
  // Clean up injected tabs tracker when tabs are closed
  chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
  });
  
  // Also clear injection tracker when tab navigates to new page
  browser.webNavigation?.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) {
      injectedTabs.delete(details.tabId);
    }
  });

  // Clean up old history entries (older than 30 days)
  cleanupOldHistory();
});

async function handleMessage(message: any, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case 'SAVE_CONTEXT':
      return saveContext(message.context);
    
    case 'GET_CONTEXT':
      return getContext();
    
    case 'CLEAR_CONTEXT':
      return clearContext();
    
    case 'RANK_PRODUCTS':
      return rankProducts(message.products);
    
    case 'CHECK_CONTEXT_EXISTS':
      return checkContextExists();
    
    case 'GET_RESEARCH_HISTORY':
      return getResearchHistory();
    
    case 'DELETE_HISTORY_ENTRY':
      return deleteHistoryEntry(message.id);
    
    case 'GET_USER_PROFILE':
      return getUserProfile();
    
    case 'REBUILD_USER_PROFILE':
      return rebuildUserProfile();
    
    default:
      console.warn('[Sift] Unknown message type:', message.type);
      return { error: 'Unknown message type' };
  }
}

// ============================================
// CONTEXT MANAGEMENT (Session)
// ============================================

async function saveContext(context: ProductContext): Promise<{ success: boolean }> {
  try {
    // Save to session storage (current context)
    await chrome.storage.session.set({ [CONTEXT_KEY]: context });
    
    // Also save to persistent history
    await addToResearchHistory(context);
    
    // Update user profile with learned preferences
    await updateUserProfile(context);
    
    console.log('[Sift] Context saved:', context.query);
    return { success: true };
  } catch (error) {
    console.error('[Sift] Failed to save context:', error);
    return { success: false };
  }
}

async function getContext(): Promise<ProductContext | null> {
  try {
    const result = await chrome.storage.session.get(CONTEXT_KEY);
    return result[CONTEXT_KEY] || null;
  } catch (error) {
    console.error('[Sift] Failed to get context:', error);
    return null;
  }
}

async function clearContext(): Promise<{ success: boolean }> {
  try {
    await chrome.storage.session.remove(CONTEXT_KEY);
    return { success: true };
  } catch (error) {
    console.error('[Sift] Failed to clear context:', error);
    return { success: false };
  }
}

async function checkContextExists(): Promise<{ exists: boolean; context?: ProductContext }> {
  const context = await getContext();
  return { exists: !!context, context: context || undefined };
}

// ============================================
// PERSISTENT RESEARCH HISTORY
// ============================================

async function addToResearchHistory(context: ProductContext): Promise<void> {
  if (!context.query || context.query.length < 3) return;
  
  try {
    const history = await getResearchHistory();
    
    // Extract categories and keywords from the research
    const categories = extractCategories(context);
    const keywords = extractKeywords(context);
    
    if (categories.length === 0 && keywords.length === 0) return;
    
    // Create or update entry
    const existingIndex = history.findIndex(h => 
      h.conversationId === context.conversationId ||
      h.query.toLowerCase() === context.query.toLowerCase()
    );
    
    const entry: ResearchEntry = {
      id: context.conversationId || `research-${Date.now()}`,
      query: context.query,
      productName: extractProductName(context.query),
      requirements: context.requirements,
      categories,
      keywords,
      timestamp: existingIndex >= 0 ? history[existingIndex].timestamp : Date.now(),
      lastUsed: Date.now(),
      conversationId: context.conversationId,
    };
    
    if (existingIndex >= 0) {
      history[existingIndex] = entry;
    } else {
      history.unshift(entry);
    }
    
    // Keep only last 50 entries
    const trimmedHistory = history.slice(0, 50);
    
    await chrome.storage.local.set({ [HISTORY_KEY]: trimmedHistory });
    invalidateHistoryCache(); // Clear cache on write
    console.log('[Sift] Research history updated:', categories.join(', '));
  } catch (error) {
    console.error('[Sift] Failed to save to history:', error);
  }
}

async function getResearchHistory(): Promise<ResearchEntry[]> {
  try {
    // Use cache if fresh
    const now = Date.now();
    if (historyCache && (now - historyCacheTime) < HISTORY_CACHE_TTL) {
      return historyCache;
    }
    
    const result = await chrome.storage.local.get(HISTORY_KEY);
    historyCache = result[HISTORY_KEY] || [];
    historyCacheTime = now;
    return historyCache;
  } catch (error) {
    console.error('[Sift] Failed to get history:', error);
    return [];
  }
}

// Invalidate history cache when writing
function invalidateHistoryCache() {
  historyCache = null;
  historyCacheTime = 0;
}

async function cleanupOldHistory(): Promise<void> {
  try {
    const history = await getResearchHistory();
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const filtered = history.filter(h => h.lastUsed > thirtyDaysAgo);
    
    if (filtered.length !== history.length) {
      await chrome.storage.local.set({ [HISTORY_KEY]: filtered });
      invalidateHistoryCache();
      console.log('[Sift] Cleaned up old history entries');
    }
  } catch (error) {
    console.error('[Sift] Failed to cleanup history:', error);
  }
}

async function deleteHistoryEntry(id: string): Promise<{ success: boolean }> {
  try {
    const history = await getResearchHistory();
    const filtered = history.filter(h => h.id !== id);
    await chrome.storage.local.set({ [HISTORY_KEY]: filtered });
    invalidateHistoryCache();
    return { success: true };
  } catch (error) {
    console.error('[Sift] Failed to delete history entry:', error);
    return { success: false };
  }
}

// ============================================
// USER PROFILE - Learn from all research
// ============================================

async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const result = await chrome.storage.local.get(USER_PROFILE_KEY);
    return result[USER_PROFILE_KEY] || null;
  } catch (error) {
    console.error('[Sift] Failed to get user profile:', error);
    return null;
  }
}

// Debounced: schedules profile update, batches rapid context saves
async function updateUserProfile(context: ProductContext): Promise<void> {
  // Store the latest context
  pendingProfileContext = context;
  
  // Clear existing timer
  if (profileUpdateTimer) {
    clearTimeout(profileUpdateTimer);
  }
  
  // Schedule debounced update
  profileUpdateTimer = setTimeout(() => {
    if (pendingProfileContext) {
      doUpdateUserProfile(pendingProfileContext);
      pendingProfileContext = null;
    }
  }, PROFILE_UPDATE_DELAY);
}

// Actual profile update (called after debounce)
async function doUpdateUserProfile(context: ProductContext): Promise<void> {
  try {
    const currentProfile = await getUserProfile() || createEmptyProfile();
    const extracted = extractUserPreferences(context);
    
    // Merge new preferences with existing profile
    currentProfile.values = mergeAndDedupe(currentProfile.values, extracted.values);
    currentProfile.avoids = mergeAndDedupe(currentProfile.avoids, extracted.avoids);
    currentProfile.prefers = mergeAndDedupe(currentProfile.prefers, extracted.prefers);
    currentProfile.priorities = mergeAndDedupe(currentProfile.priorities, extracted.priorities);
    
    // Update price range if detected
    if (extracted.priceRange && extracted.priceRange !== 'unknown') {
      currentProfile.priceRange = extracted.priceRange;
    }
    
    currentProfile.extractedFrom++;
    currentProfile.lastUpdated = Date.now();
    
    // Keep lists manageable
    currentProfile.values = currentProfile.values.slice(0, 15);
    currentProfile.avoids = currentProfile.avoids.slice(0, 15);
    currentProfile.prefers = currentProfile.prefers.slice(0, 15);
    currentProfile.priorities = currentProfile.priorities.slice(0, 10);
    
    await chrome.storage.local.set({ [USER_PROFILE_KEY]: currentProfile });
    console.log('[Sift] User profile updated:', currentProfile.values.slice(0, 3));
  } catch (error) {
    console.error('[Sift] Failed to update user profile:', error);
  }
}

async function rebuildUserProfile(): Promise<UserProfile> {
  const history = await getResearchHistory();
  const profile = createEmptyProfile();
  
  for (const entry of history) {
    const context: ProductContext = {
      query: entry.query,
      requirements: entry.requirements,
      timestamp: entry.timestamp,
      source: 'chatgpt',
    };
    
    const extracted = extractUserPreferences(context);
    profile.values = mergeAndDedupe(profile.values, extracted.values);
    profile.avoids = mergeAndDedupe(profile.avoids, extracted.avoids);
    profile.prefers = mergeAndDedupe(profile.prefers, extracted.prefers);
    profile.priorities = mergeAndDedupe(profile.priorities, extracted.priorities);
  }
  
  profile.extractedFrom = history.length;
  profile.lastUpdated = Date.now();
  
  // Trim to reasonable sizes
  profile.values = profile.values.slice(0, 15);
  profile.avoids = profile.avoids.slice(0, 15);
  profile.prefers = profile.prefers.slice(0, 15);
  profile.priorities = profile.priorities.slice(0, 10);
  
  await chrome.storage.local.set({ [USER_PROFILE_KEY]: profile });
  console.log('[Sift] User profile rebuilt from', history.length, 'entries');
  
  return profile;
}

function createEmptyProfile(): UserProfile {
  return {
    values: [],
    avoids: [],
    prefers: [],
    priceRange: 'unknown',
    priorities: [],
    extractedFrom: 0,
    lastUpdated: Date.now(),
  };
}

function mergeAndDedupe(existing: string[], newItems: string[]): string[] {
  const combined = [...existing, ...newItems];
  const unique = [...new Set(combined.map(s => s.toLowerCase()))];
  return unique;
}

// Extract user preferences and values from their research
function extractUserPreferences(context: ProductContext): Partial<UserProfile> {
  const text = [
    context.query,
    ...context.requirements,
    ...(context.recentMessages?.map(m => m.content) || []),
  ].join(' ').toLowerCase();
  
  const result: Partial<UserProfile> = {
    values: [],
    avoids: [],
    prefers: [],
    priorities: [],
    priceRange: 'unknown',
  };
  
  // ========== VALUES (what the user cares about) ==========
  const valuePatterns: Record<string, string[]> = {
    'health-conscious': ['health', 'healthy', 'non-toxic', 'toxin', 'safe', 'safety', 'chemical-free', 'organic', 'natural', 'bpa-free', 'lead-free', 'voc', 'off-gas', 'fumes'],
    'eco-friendly': ['eco', 'sustainable', 'environment', 'green', 'recyclable', 'biodegradable', 'carbon', 'ethical'],
    'quality-focused': ['quality', 'premium', 'high-end', 'best', 'top-rated', 'professional', 'commercial-grade', 'durable', 'long-lasting'],
    'budget-conscious': ['budget', 'affordable', 'cheap', 'value', 'cost-effective', 'bang for buck', 'economical'],
    'safety-first': ['safe', 'safety', 'secure', 'protection', 'bulletproof', 'armored', 'protective'],
    'aesthetics-matter': ['beautiful', 'stylish', 'modern', 'design', 'aesthetic', 'look', 'appearance', 'sleek'],
    'performance-driven': ['performance', 'powerful', 'fast', 'efficient', 'high-performance', 'speed'],
    'comfort-priority': ['comfortable', 'comfort', 'ergonomic', 'soft', 'cushion', 'support'],
    'minimalist': ['minimal', 'simple', 'clean', 'no clutter', 'streamlined'],
  };
  
  for (const [value, keywords] of Object.entries(valuePatterns)) {
    if (keywords.some(kw => text.includes(kw))) {
      result.values!.push(value);
    }
  }
  
  // ========== AVOIDS (what the user doesn't want) ==========
  const avoidPatterns = [
    // Synthetic/Fake materials
    { pattern: /no\s+(plastic|synthetic|fake|faux|artificial)/gi, extract: 'synthetic materials' },
    { pattern: /without\s+(plastic|synthetic)/gi, extract: 'synthetic materials' },
    { pattern: /avoid\s+(plastic|synthetic|fake)/gi, extract: 'synthetic materials' },
    { pattern: /plastic[- ]?free/gi, extract: 'plastic' },
    // Specific materials
    { pattern: /no\s+(polyester|nylon|vinyl|pvc|pleather)/gi, extract: '$1' },
    { pattern: /no\s+(polyurethane|pu leather|bonded leather)/gi, extract: 'fake leather' },
    // Health concerns
    { pattern: /no\s+(bpa|chemicals|toxins|lead|mercury|voc|formaldehyde|phthalates)/gi, extract: '$1' },
    { pattern: /no\s+(fluoride|chlorine|pfas|pfoa)/gi, extract: '$1' },
    // Quality concerns
    { pattern: /no\s+(cheap|flimsy|low[- ]quality)/gi, extract: 'low quality' },
    { pattern: /not\s+(cheap|flimsy)/gi, extract: 'low quality' },
    // General negatives
    { pattern: /don't want\s+([^.,]+)/gi, extract: '$1' },
    { pattern: /hate\s+([^.,]+)/gi, extract: '$1' },
  ];
  
  for (const { pattern, extract } of avoidPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const avoided = extract.includes('$1') && match[1] 
        ? extract.replace('$1', match[1]) 
        : extract;
      if (avoided.length < 30) {
        result.avoids!.push(avoided.trim());
      }
    }
  }
  
  // Direct "no X" extraction
  const noMatches = text.matchAll(/\bno\s+(\w+(?:\s+\w+)?)/gi);
  for (const match of noMatches) {
    const item = match[1].trim();
    if (item.length > 2 && item.length < 20 && !['more', 'less', 'problem', 'issue', 'need'].includes(item)) {
      result.avoids!.push(item);
    }
  }
  
  // ========== PREFERS (what the user wants) ==========
  const preferPatterns = [
    // Materials
    { pattern: /real\s+(leather|wood|metal|stone|marble)/gi, extract: 'real $1' },
    { pattern: /genuine\s+(leather|wood|materials)/gi, extract: 'genuine $1' },
    { pattern: /solid\s+(wood|metal|steel|brass)/gi, extract: 'solid $1' },
    { pattern: /stainless\s+steel/gi, extract: 'stainless steel' },
    { pattern: /natural\s+(materials|fibers|wood|stone|leather)/gi, extract: 'natural $1' },
    // Quality indicators
    { pattern: /made\s+in\s+(usa|america|japan|germany|italy)/gi, extract: 'made in $1' },
    { pattern: /handmade|hand[- ]crafted/gi, extract: 'handmade' },
    { pattern: /artisan|artisanal/gi, extract: 'artisan-made' },
    // Features
    { pattern: /with\s+(warranty|guarantee)/gi, extract: 'warranty' },
    { pattern: /certified\s+(\w+)/gi, extract: '$1 certified' },
  ];
  
  for (const { pattern, extract } of preferPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const preferred = extract.includes('$1') && match[1]
        ? extract.replace('$1', match[1])
        : extract;
      if (preferred.length < 30) {
        result.prefers!.push(preferred.trim());
      }
    }
  }
  
  // ========== PRIORITIES (what matters most) ==========
  const priorityKeywords: Record<string, string[]> = {
    'durability': ['durable', 'long-lasting', 'sturdy', 'robust', 'built to last', 'heavy duty'],
    'safety': ['safe', 'safety', 'secure', 'protection', 'certified'],
    'health': ['health', 'healthy', 'non-toxic', 'safe for'],
    'value': ['value', 'worth', 'investment', 'bang for buck'],
    'aesthetics': ['look', 'design', 'style', 'aesthetic', 'beautiful'],
    'comfort': ['comfort', 'comfortable', 'ergonomic', 'cozy'],
    'performance': ['performance', 'powerful', 'efficient', 'fast'],
    'reliability': ['reliable', 'dependable', 'consistent', 'trustworthy'],
  };
  
  for (const [priority, keywords] of Object.entries(priorityKeywords)) {
    if (keywords.some(kw => text.includes(kw))) {
      result.priorities!.push(priority);
    }
  }
  
  // ========== PRICE RANGE ==========
  const budgetMatch = text.match(/under\s*\$?(\d+)/i) || text.match(/budget\s*(?:of\s*)?\$?(\d+)/i);
  if (budgetMatch) {
    const amount = parseInt(budgetMatch[1]);
    if (amount < 100) result.priceRange = 'budget';
    else if (amount < 500) result.priceRange = 'mid-range';
    else if (amount < 2000) result.priceRange = 'premium';
    else result.priceRange = 'luxury';
  }
  
  return result;
}

function extractCategories(context: ProductContext): string[] {
  const text = [
    context.query,
    ...context.requirements,
    ...(context.mentionedProducts || []),
  ].join(' ').toLowerCase();
  
  const matches: string[] = [];
  
  for (const [category, keywords] of Object.entries(PRODUCT_CATEGORIES)) {
    if (keywords.some(kw => text.includes(kw))) {
      matches.push(category);
    }
  }
  
  return matches;
}

function extractKeywords(context: ProductContext): string[] {
  const text = [
    context.query,
    ...context.requirements,
  ].join(' ').toLowerCase();
  
  // Extract significant words (3+ chars, not common words)
  const stopWords = ['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'was', 'were', 'been', 'being', 'best', 'good', 'great', 'need', 'want', 'looking'];
  const words = text.match(/\b[a-z]{3,}\b/g) || [];
  const keywords = words.filter(w => !stopWords.includes(w));
  
  // Return unique keywords
  return [...new Set(keywords)].slice(0, 20);
}

function extractProductName(query: string): string {
  // Remove common prefixes/suffixes and clean up the product name
  let cleaned = query
    // Remove action phrases at the start
    .replace(/^(list|rank|compare|show|give|tell|find|search|get|help|me|and)\s+/gi, '')
    .replace(/^(list|rank|compare|show|give|tell|find|search|get|help|me|and)\s+/gi, '') // Run twice for "list and rank"
    // Remove question words and common phrases
    .replace(/^(what|which|can you|please|i need|i want|looking for|find me|recommend|best|top|good|the)\s+/gi, '')
    .replace(/^(what|which|can you|please|i need|i want|looking for|find me|recommend|best|top|good|the)\s+/gi, '') // Run twice
    .replace(/\?+$/, '')
    // Remove requirement suffixes (for men, under $100, with X, etc.)
    .replace(/\s+(for\s+(men|women|kids|home|office|outdoor|indoor|me|us))\b.*/gi, '')
    .replace(/\s+(under|less than|around|about)\s*\$?\d+.*/gi, '')
    .replace(/\s+(with|without|no|that has|that have)\s+.*/gi, '')
    .replace(/\s*,\s*.*$/, '') // Remove everything after first comma
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
    // Don't cut mid-word
    const lastSpace = cleaned.lastIndexOf(' ');
    if (lastSpace > 20) {
      cleaned = cleaned.slice(0, lastSpace);
    }
  }
  
  return cleaned || 'Product Research';
}

// ============================================
// AI-POWERED SITE ANALYSIS (with caching)
// ============================================

async function analyzeSiteWithAI(pageInfo: { 
  url: string; 
  title: string; 
  description?: string;
}): Promise<{
  matched: boolean;
  context?: ProductContext;
  matchedEntry?: ResearchEntry;
  matchScore: number;
  reason?: string;
}> {
  // Get research history
  const history = await getResearchHistory();
  
  if (history.length === 0) {
    return { matched: false, matchScore: 0 };
  }
  
  // Skip obvious non-shopping pages
  const skipPatterns = [
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
  ];
  
  if (skipPatterns.some(p => p.test(pageInfo.url))) {
    console.log('[Sift] Skipping non-shopping site:', pageInfo.url);
    return { matched: false, matchScore: 0 };
  }
  
  // ===== CACHE CHECK =====
  // Use domain as cache key (ignore path for shopping site detection)
  let domain: string;
  try {
    domain = new URL(pageInfo.url).hostname.replace('www.', '');
  } catch {
    return { matched: false, matchScore: 0 };
  }
  
  const cached = siteAnalysisCache.get(domain);
  const now = Date.now();
  
  if (cached && (now - cached.timestamp) < SITE_CACHE_TTL) {
    console.log('[Sift] Using cached site analysis for:', domain);
    const cachedResult = cached.result;
    
    // If not a shopping site, return immediately
    if (!cachedResult.isShoppingSite) {
      return { matched: false, matchScore: 0 };
    }
    
    // Re-check match against current history (history may have changed)
    if (cachedResult.matchedResearchId && cachedResult.matchScore && cachedResult.matchScore > 50) {
      const matchedEntry = history.find(h => h.id === cachedResult.matchedResearchId);
      if (matchedEntry) {
        matchedEntry.lastUsed = Date.now();
        await chrome.storage.local.set({ [HISTORY_KEY]: history });
        invalidateHistoryCache();
        
        return {
          matched: true,
          context: {
            query: matchedEntry.query,
            requirements: matchedEntry.requirements,
            timestamp: matchedEntry.timestamp,
            source: 'chatgpt',
            conversationId: matchedEntry.conversationId,
          },
          matchedEntry,
          matchScore: cachedResult.matchScore,
          reason: cachedResult.matchReason,
        };
      }
    }
    
    return { matched: false, matchScore: cachedResult.matchScore || 0, reason: cachedResult.matchReason };
  }
  
  try {
    const apiUrlResult = await chrome.storage.local.get(API_URL_KEY);
    const apiUrl = apiUrlResult[API_URL_KEY] || DEFAULT_API_URL;
    
    console.log('[Sift] Analyzing site with AI:', pageInfo.title);
    
    const response = await fetch(`${apiUrl}/api/analyze-site`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: pageInfo.url,
        title: pageInfo.title,
        description: pageInfo.description,
        researchHistory: history.map(h => ({
          id: h.id,
          query: h.query,
          productName: h.productName,
          requirements: h.requirements,
          categories: h.categories,
        })),
      }),
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const result: SiteAnalysisResult = await response.json();
    
    console.log('[Sift] AI analysis result:', result);
    
    // ===== CACHE SAVE =====
    siteAnalysisCache.set(domain, { result, timestamp: now });
    console.log('[Sift] Cached site analysis for:', domain);
    
    if (!result.isShoppingSite) {
      return { matched: false, matchScore: 0 };
    }
    
    // Check for match
    if (result.matchedResearchId && result.matchScore && result.matchScore > 50) {
      const matchedEntry = history.find(h => h.id === result.matchedResearchId);
      
      if (matchedEntry) {
        // Update lastUsed
        matchedEntry.lastUsed = Date.now();
        await chrome.storage.local.set({ [HISTORY_KEY]: history });
        invalidateHistoryCache();
        
        // Convert to ProductContext
        const matchedContext: ProductContext = {
          query: matchedEntry.query,
          requirements: matchedEntry.requirements,
          timestamp: matchedEntry.timestamp,
          source: 'chatgpt',
          conversationId: matchedEntry.conversationId,
        };
        
        return {
          matched: true,
          context: matchedContext,
          matchedEntry,
          matchScore: result.matchScore,
          reason: result.matchReason,
        };
      }
    }
    
    // Site is shopping but no strong match
    return { 
      matched: false, 
      matchScore: result.matchScore || 0,
      reason: result.matchReason,
    };
    
  } catch (error) {
    console.error('[Sift] AI site analysis failed:', error);
    return { matched: false, matchScore: 0 };
  }
}

// ============================================
// SHOPPING SITE DETECTION (AI-POWERED)
// ============================================

async function checkIfShoppingSite(tabId: number, url: string) {
  // First check current session context for tracked links
  const { exists, context } = await checkContextExists();
  
  // Check if this URL matches any tracked link from ChatGPT conversation
  if (exists && context?.trackedLinks) {
    const matchedLink = context.trackedLinks.find(link => {
      try {
        const trackedUrl = new URL(link.url);
        const currentUrl = new URL(url);
        const trackedDomain = trackedUrl.hostname.replace('www.', '');
        const currentDomain = currentUrl.hostname.replace('www.', '');
        return currentDomain.includes(trackedDomain) || trackedDomain.includes(currentDomain);
      } catch {
        return false;
      }
    });

    if (matchedLink) {
      console.log('[Sift] TRACKED LINK from ChatGPT:', matchedLink.domain);
      await injectAndNotify(tabId, context, true);
      return;
    }
  }

  // Use AI to analyze the site and match against research history
  try {
    const tab = await chrome.tabs.get(tabId);
    
    // Wait a moment for page to settle
    await new Promise(r => setTimeout(r, 500));
    
    // Get meta description if possible
    let description = '';
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const meta = document.querySelector('meta[name="description"]');
          return meta?.getAttribute('content') || '';
        },
      });
      description = result?.result || '';
    } catch {
      // Can't inject script, proceed without description
    }
    
    const pageInfo = {
      url,
      title: tab.title || '',
      description,
    };
    
    // AI determines if this is a shopping site that matches user's research
    const match = await analyzeSiteWithAI(pageInfo);
    
    if (match.matched && match.context) {
      console.log('[Sift] AI MATCH! Score:', match.matchScore, 'Reason:', match.reason);
      await injectAndNotify(tabId, match.context, false, match.matchScore);
      return;
    }
  } catch (e) {
    console.error('[Sift] Site check failed:', e);
  }
}

function extractSearchQuery(url: string): string {
  try {
    const u = new URL(url);
    // Common search query parameters
    return u.searchParams.get('k') ||      // Amazon
           u.searchParams.get('q') ||      // Generic
           u.searchParams.get('query') ||  // Generic
           u.searchParams.get('s') ||      // Some sites
           u.searchParams.get('search') || // Generic
           '';
  } catch {
    return '';
  }
}

async function injectAndNotify(tabId: number, context: ProductContext, isTrackedLink: boolean, matchScore?: number) {
  // Skip injection if already injected for this tab
  if (!injectedTabs.has(tabId)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/shopping.js'],
      });
      injectedTabs.add(tabId);
      console.log('[Sift] Injected shopping script into tab', tabId);
    } catch (e) {
      // Script might already be injected by manifest match
      injectedTabs.add(tabId); // Mark as injected anyway
    }
  } else {
    console.log('[Sift] Script already injected in tab', tabId);
  }
  
  // Shorter delay since we're tracking injection status
  setTimeout(async () => {
    await notifyTabWithContext(tabId, context, isTrackedLink, matchScore);
  }, 500);
}

async function notifyTabWithContext(tabId: number, context: ProductContext, isTrackedLink: boolean, matchScore?: number) {
  for (let i = 0; i < 5; i++) {
    try {
      await browser.tabs.sendMessage(tabId, { 
        type: 'CONTEXT_AVAILABLE',
        context,
        isTrackedLink,
        matchScore,
        isHistoricalMatch: !isTrackedLink && matchScore !== undefined,
      });
      console.log('[Sift] Notified tab successfully');
      return;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// ============================================
// API CALLS
// ============================================

async function rankProducts(products: ProductData[]): Promise<RankingResult | { error: string }> {
  const context = await getContext();
  
  if (!context) {
    return { error: 'No context available. Research a product in ChatGPT first.' };
  }
  
  // Get user profile for personalized recommendations
  const userProfile = await getUserProfile();

  try {
    const apiUrlResult = await chrome.storage.local.get(API_URL_KEY);
    const apiUrl = apiUrlResult[API_URL_KEY] || DEFAULT_API_URL;
    
    const response = await fetch(`${apiUrl}/api/rank-products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          query: context.query,
          requirements: context.requirements,
          mentionedProducts: context.mentionedProducts || [],
          recentMessages: context.recentMessages || [],
        },
        products,
        // Include user profile for personalized recommendations
        userProfile: userProfile ? {
          values: userProfile.values,
          avoids: userProfile.avoids,
          prefers: userProfile.prefers,
          priorities: userProfile.priorities,
          priceRange: userProfile.priceRange,
        } : null,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json() as RankingResult;
  } catch (error) {
    console.error('[Sift] Failed to rank products:', error);
    return { error: 'Failed to analyze products. Please try again.' };
  }
}
