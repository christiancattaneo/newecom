/**
 * Background Service Worker
 * Orchestrates communication between content scripts and API
 */

// Types
interface ProductContext {
  query: string;
  requirements: string[];
  timestamp: number;
  source: 'chatgpt' | 'manual';
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

// Storage keys
const CONTEXT_KEY = 'sift:context';
const API_URL_KEY = 'sift:apiUrl';

// Production API URL
const DEFAULT_API_URL = 'https://sift-api.christiandcattaneo.workers.dev';

export default defineBackground(() => {
  console.log('[Sift] Background service worker started');

  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true; // Keep channel open for async response
  });

  // Listen for tab navigation to detect shopping sites
  browser.webNavigation?.onCompleted.addListener((details) => {
    if (details.frameId === 0) {
      checkIfShoppingSite(details.tabId, details.url);
    }
  });
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
    
    default:
      console.warn('[Sift] Unknown message type:', message.type);
      return { error: 'Unknown message type' };
  }
}

async function saveContext(context: ProductContext): Promise<{ success: boolean }> {
  try {
    await chrome.storage.session.set({ [CONTEXT_KEY]: context });
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

async function rankProducts(products: ProductData[]): Promise<RankingResult | { error: string }> {
  const context = await getContext();
  
  if (!context) {
    return { error: 'No context available. Research a product in ChatGPT first.' };
  }

  try {
    const apiUrlResult = await chrome.storage.local.get(API_URL_KEY);
    const apiUrl = apiUrlResult[API_URL_KEY] || DEFAULT_API_URL;
    
    const response = await fetch(`${apiUrl}/api/rank-products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        context: {
          query: context.query,
          requirements: context.requirements,
        },
        products,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();
    return result as RankingResult;
  } catch (error) {
    console.error('[Sift] Failed to rank products:', error);
    return { error: 'Failed to analyze products. Please try again.' };
  }
}

async function checkIfShoppingSite(tabId: number, url: string) {
  const shoppingSites = [
    'amazon.com',
    'bestbuy.com',
    'target.com',
    'walmart.com',
  ];

  const isShoppingSite = shoppingSites.some(site => url.includes(site));
  
  if (isShoppingSite) {
    const { exists } = await checkContextExists();
    if (exists) {
      // Notify the shopping content script that we have context
      try {
        await browser.tabs.sendMessage(tabId, { type: 'CONTEXT_AVAILABLE' });
      } catch {
        // Content script might not be ready yet, that's okay
      }
    }
  }
}

