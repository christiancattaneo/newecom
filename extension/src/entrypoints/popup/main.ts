/**
 * Popup Main Script
 * Shows accumulated context and research history
 * REACTIVE to all browsing activity
 */

interface ProductContext {
  query: string;
  requirements: string[];
  timestamp: number;
  source: 'chatgpt' | 'manual';
  mentionedProducts?: string[];
  trackedLinks?: Array<{ url: string; domain: string; text: string }>;
  messageCount?: number;
  conversationId?: string;
}

interface ResearchEntry {
  id: string;
  query: string;
  productName: string;
  requirements: string[];
  categories: string[];
  keywords: string[];
  timestamp: number;
  lastUsed: number;
  conversationId?: string;
}

interface CurrentPageInfo {
  url: string;
  title: string;
  domain: string;
  isChatGPT: boolean;
  isShopping: boolean;
}

// DOM Elements - Page Status Bar
const pageStatusBar = document.getElementById('page-status-bar')!;
const pageIndicator = document.getElementById('page-indicator')!;
const pageDomain = document.getElementById('page-domain')!;
const pageStatusText = document.getElementById('page-status-text')!;

// DOM Elements
const statusIndicator = document.getElementById('status-indicator')!;
const statusText = statusIndicator.querySelector('.text')!;
const contextSection = document.getElementById('context-section')!;
const noContextSection = document.getElementById('no-context-section')!;
const contextQuery = document.getElementById('context-query')!;
const contextStats = document.getElementById('context-stats')!;
const contextRequirements = document.getElementById('context-requirements')!;
const linksSection = document.getElementById('links-section')!;
const contextLinks = document.getElementById('context-links')!;
const productsSection = document.getElementById('products-section')!;
const contextProducts = document.getElementById('context-products')!;
const clearButton = document.getElementById('clear-context')!;

// History elements
const historyList = document.getElementById('history-list')!;
const noHistory = document.getElementById('no-history')!;
const historyCount = document.getElementById('history-count')!;
const clearHistoryBtn = document.getElementById('clear-history')!;

// Shop elements
const shopActive = document.getElementById('shop-active')!;
const shopProductName = document.getElementById('shop-product-name')!;
const shopRequirements = document.getElementById('shop-requirements')!;
const noShopContext = document.getElementById('no-shop-context')!;

// Track known history IDs for highlighting new entries
let knownHistoryIds: Set<string> = new Set();

// Current shop context
let currentShopContext: ProductContext | null = null;
let currentShopProductName: string = '';

// Current page tracking
let currentPageInfo: CurrentPageInfo | null = null;
let lastTabId: number | null = null;

// Tab elements
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentPage();
  await loadContext();
  await loadHistory();
  setupEventListeners();
  setupTabs();
  setupStorageListener();
  setupTabListener();
  
  // NO MORE POLLING! We use event listeners instead:
  // - Storage changes trigger via setupStorageListener()
  // - Tab changes trigger via setupTabListener()
  // - Only refresh once on popup open (above)
});

// ========================================
// REACTIVE BROWSING TRACKING (Event-driven, not polling!)
// ========================================

// Removed: refreshAll polling - now 100% event-driven

async function loadCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    
    // Skip if same tab and URL
    if (lastTabId === tab.id && currentPageInfo?.url === tab.url) return;
    lastTabId = tab.id ?? null;
    
    const url = new URL(tab.url);
    currentPageInfo = {
      url: tab.url,
      title: tab.title || '',
      domain: url.hostname.replace('www.', ''),
      isChatGPT: url.hostname.includes('chatgpt.com') || url.hostname.includes('openai.com'),
      isShopping: isShoppingSite(url.hostname),
    };
    
    updatePageStatus();
  } catch (e) {
    // Tab might not be accessible (e.g., chrome:// pages)
  }
}

function isShoppingSite(hostname: string): boolean {
  const shoppingSites = [
    'amazon', 'bestbuy', 'target', 'walmart', 'homedepot', 'lowes',
    'newegg', 'ebay', 'wayfair', 'costco', 'macys', 'nordstrom',
    'zappos', 'bhphotovideo', 'adorama', 'overstock', 'chewy', 'etsy',
    'shop', 'store', 'buy', 'cart', 'checkout'
  ];
  const h = hostname.toLowerCase();
  return shoppingSites.some(s => h.includes(s));
}

function updatePageStatus() {
  if (!currentPageInfo) {
    pageDomain.textContent = '-';
    pageStatusText.textContent = 'No active tab';
    return;
  }
  
  // Update page domain
  pageDomain.textContent = currentPageInfo.domain || '-';
  
  // Update page indicator and status text based on current page
  pageIndicator.className = 'page-indicator';
  pageStatusText.className = 'page-status-text';
  
  if (currentPageInfo.isChatGPT) {
    pageIndicator.classList.add('chatgpt');
    pageStatusText.classList.add('chatgpt');
    pageStatusText.textContent = '🔍 Capturing context...';
    
    statusIndicator.classList.remove('inactive', 'shopping');
    statusIndicator.classList.add('active', 'chatgpt');
    statusText.textContent = '🔍 Watching ChatGPT';
  } else if (currentPageInfo.isShopping) {
    pageIndicator.classList.add('shopping');
    pageStatusText.classList.add('shopping');
    pageStatusText.textContent = currentShopContext ? '🛒 Analyzing...' : '🛒 Shopping site';
    
    statusIndicator.classList.remove('inactive', 'chatgpt');
    statusIndicator.classList.add('active', 'shopping');
    statusText.textContent = '🛒 Shopping site detected';
  } else {
    // Check if we have context
    if (currentShopContext) {
      pageIndicator.classList.add('active');
      pageStatusText.classList.add('ready');
      pageStatusText.textContent = '✓ Ready to shop';
      
      statusIndicator.classList.remove('inactive', 'chatgpt', 'shopping');
      statusIndicator.classList.add('active');
      statusText.textContent = '✓ Context ready';
    } else {
      pageStatusText.textContent = 'Browsing...';
      
      statusIndicator.classList.remove('active', 'chatgpt', 'shopping');
      statusIndicator.classList.add('inactive');
      statusText.textContent = 'Browse to shop or research';
    }
  }
}

// Listen for tab changes
function setupTabListener() {
  // Tab activated
  chrome.tabs.onActivated.addListener(async () => {
    await loadCurrentPage();
    await loadContext();
  });
  
  // Tab updated (URL change, page load)
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id === tabId) {
        await loadCurrentPage();
        await loadContext();
      }
    }
  });
}

// Listen for storage changes to update history in real-time
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    // Update history when research history changes
    if (areaName === 'local' && changes['sift:researchHistory']) {
      console.log('[Sift Popup] Research history updated');
      loadHistory();
    }
    
    // Update current context when session storage changes
    if (areaName === 'session' && changes['sift:context']) {
      console.log('[Sift Popup] Current context updated');
      loadContext();
    }
  });
}

function setupTabs() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      
      // Update tab buttons
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update tab content
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `tab-${tabName}`) {
          content.classList.add('active');
        }
      });
      
      // Refresh history when switching to history tab
      if (tabName === 'history') {
        loadHistory();
      }
      
      // Load shop context when switching to shop tab
      if (tabName === 'shop') {
        loadShopContext();
      }
    });
  });
}

async function loadContext() {
  try {
    const result = await browser.runtime.sendMessage({ type: 'CHECK_CONTEXT_EXISTS' });
    
    if (result?.exists && result.context) {
      currentShopContext = result.context;
      showContext(result.context);
    } else {
      currentShopContext = null;
      showNoContext();
    }
    
    // Update page status with new context info
    updatePageStatus();
  } catch (error) {
    console.error('[Sift Popup] Failed to load context:', error);
    showNoContext();
  }
}

async function loadHistory() {
  try {
    const result = await browser.runtime.sendMessage({ type: 'GET_RESEARCH_HISTORY' });
    const history: ResearchEntry[] = result || [];
    
    const oldCount = parseInt(historyCount.textContent || '0');
    const newCount = history.length;
    historyCount.textContent = String(newCount);
    
    // Animate badge if count increased
    if (newCount > oldCount) {
      historyCount.classList.add('updated');
      setTimeout(() => historyCount.classList.remove('updated'), 500);
    }
    
    if (history.length === 0) {
      historyList.innerHTML = '';
      noHistory.classList.remove('hidden');
      clearHistoryBtn.classList.add('hidden');
    } else {
      noHistory.classList.add('hidden');
      clearHistoryBtn.classList.remove('hidden');
      renderHistory(history);
    }
  } catch (error) {
    console.error('[Sift Popup] Failed to load history:', error);
  }
}

function renderHistory(history: ResearchEntry[]) {
  // Find new entries (not in our known set)
  const newIds = new Set(history.map(h => h.id).filter(id => !knownHistoryIds.has(id)));
  
  historyList.innerHTML = history.map((entry, index) => {
    const date = new Date(entry.timestamp);
    const timeAgo = getTimeAgo(entry.timestamp);
    const categories = entry.categories.slice(0, 3).map(c => 
      `<span class="category-tag">${c}</span>`
    ).join('');
    const requirements = entry.requirements.slice(0, 3).map(r => 
      `<span class="req-tag">${r}</span>`
    ).join('');
    
    // Add 'new' class for newly added entries
    const isNew = newIds.has(entry.id);
    
    // Use productName if available, fallback to cleaned query
    const displayName = entry.productName || entry.query.slice(0, 40);
    
    return `
      <div class="history-item${isNew ? ' new' : ''}" data-index="${index}" data-id="${entry.id}">
        ${isNew ? '<span class="new-badge">NEW</span>' : ''}
        <div class="history-header">
          <span class="history-name">${displayName}</span>
          <span class="history-time" title="${date.toLocaleString()}">${timeAgo}</span>
        </div>
        <div class="history-categories">${categories}</div>
        <div class="history-requirements">${requirements || '<span class="no-reqs">No requirements</span>'}</div>
        <div class="history-actions">
          <button class="btn-use" data-id="${entry.id}">Set Current</button>
          <button class="btn-shop" data-id="${entry.id}">🛒 Shop</button>
          <button class="btn-delete" data-id="${entry.id}">×</button>
        </div>
      </div>
    `;
  }).join('');
  
  // Update known IDs
  knownHistoryIds = new Set(history.map(h => h.id));
  
  // Remove 'new' class after animation
  setTimeout(() => {
    historyList.querySelectorAll('.history-item.new').forEach(el => {
      el.classList.remove('new');
    });
    historyList.querySelectorAll('.new-badge').forEach(el => {
      el.remove();
    });
  }, 3000);
  
  // Add event listeners for buttons
  historyList.querySelectorAll('.btn-use').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      await useHistoryEntry(id!);
    });
  });
  
  historyList.querySelectorAll('.btn-shop').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      await shopHistoryEntry(id!);
    });
  });
  
  historyList.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      await deleteHistoryEntry(id!);
    });
  });
}

async function shopHistoryEntry(id: string) {
  try {
    const result = await browser.runtime.sendMessage({ type: 'GET_RESEARCH_HISTORY' });
    const history: ResearchEntry[] = result || [];
    const entry = history.find(h => h.id === id);
    
    if (entry) {
      setShopContextFromHistory(entry);
    }
  } catch (error) {
    console.error('[Sift Popup] Failed to shop history entry:', error);
  }
}

async function useHistoryEntry(id: string) {
  try {
    const result = await browser.runtime.sendMessage({ type: 'GET_RESEARCH_HISTORY' });
    const history: ResearchEntry[] = result || [];
    const entry = history.find(h => h.id === id);
    
    if (entry) {
      // Set as current context
      await browser.runtime.sendMessage({
        type: 'SAVE_CONTEXT',
        context: {
          query: entry.query,
          requirements: entry.requirements,
          timestamp: Date.now(),
          source: 'chatgpt',
          conversationId: entry.conversationId,
        }
      });
      
      // Switch to current tab
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelector('[data-tab="current"]')?.classList.add('active');
      tabContents.forEach(c => c.classList.remove('active'));
      document.getElementById('tab-current')?.classList.add('active');
      
      await loadContext();
    }
  } catch (error) {
    console.error('[Sift Popup] Failed to use history entry:', error);
  }
}

async function deleteHistoryEntry(id: string) {
  try {
    const result = await browser.runtime.sendMessage({ type: 'GET_RESEARCH_HISTORY' });
    const history: ResearchEntry[] = result || [];
    const filtered = history.filter(h => h.id !== id);
    
    await chrome.storage.local.set({ 'sift:researchHistory': filtered });
    await loadHistory();
  } catch (error) {
    console.error('[Sift Popup] Failed to delete history entry:', error);
  }
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

function showContext(context: ProductContext) {
  statusIndicator.classList.remove('inactive');
  statusIndicator.classList.add('active');
  statusText.textContent = 'Context active';

  contextSection.classList.remove('hidden');
  noContextSection.classList.add('hidden');

  contextQuery.textContent = context.query ? `"${context.query}"` : '(No specific product)';
  
  const stats: string[] = [];
  if (context.messageCount) stats.push(`📝 ${context.messageCount} messages`);
  if (context.requirements?.length) stats.push(`🎯 ${context.requirements.length} requirements`);
  if (context.trackedLinks?.length) stats.push(`🔗 ${context.trackedLinks.length} links`);
  if (context.mentionedProducts?.length) stats.push(`📦 ${context.mentionedProducts.length} products`);
  
  contextStats.innerHTML = stats.map(s => `<span class="stat">${s}</span>`).join('');
  
  if (context.requirements && context.requirements.length > 0) {
    contextRequirements.innerHTML = context.requirements
      .map(req => `<li class="requirement-tag">${req}</li>`)
      .join('');
  } else {
    contextRequirements.innerHTML = '<li class="empty">No specific requirements captured</li>';
  }

  if (context.trackedLinks && context.trackedLinks.length > 0) {
    linksSection.classList.remove('hidden');
    contextLinks.innerHTML = context.trackedLinks
      .slice(0, 5)
      .map(link => `
        <li class="tracked-link">
          <a href="${link.url}" target="_blank" title="${link.url}">
            ${link.domain}
          </a>
        </li>
      `)
      .join('');
  } else {
    linksSection.classList.add('hidden');
  }

  if (context.mentionedProducts && context.mentionedProducts.length > 0) {
    productsSection.classList.remove('hidden');
    contextProducts.innerHTML = context.mentionedProducts
      .slice(0, 5)
      .map(p => `<li class="mentioned-product">${p}</li>`)
      .join('');
  } else {
    productsSection.classList.add('hidden');
  }
}

function showNoContext() {
  statusIndicator.classList.remove('active');
  statusIndicator.classList.add('inactive');
  statusText.textContent = 'No active context';

  contextSection.classList.add('hidden');
  noContextSection.classList.remove('hidden');
}

function setupEventListeners() {
  clearButton.addEventListener('click', async () => {
    try {
      await browser.runtime.sendMessage({ type: 'CLEAR_CONTEXT' });
      showNoContext();
    } catch (error) {
      console.error('[Sift Popup] Failed to clear context:', error);
    }
  });
  
  clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Clear all research history?')) {
      try {
        await chrome.storage.local.set({ 'sift:researchHistory': [] });
        await loadHistory();
      } catch (error) {
        console.error('[Sift Popup] Failed to clear history:', error);
      }
    }
  });
  
}

// ========================================
// SHOP TAB FUNCTIONS
// ========================================

async function loadShopContext() {
  try {
    const result = await browser.runtime.sendMessage({ type: 'CHECK_CONTEXT_EXISTS' });
    
    if (result?.exists && result.context) {
      showShopReady(result.context);
    } else {
      showNoShopContext();
    }
  } catch (error) {
    console.error('[Sift Popup] Failed to load shop context:', error);
    showNoShopContext();
  }
}

function extractProductName(query: string): string {
  let cleaned = query
    // Remove action phrases at the start
    .replace(/^(list|rank|compare|show|give|tell|find|search|get|help|me|and)\s+/gi, '')
    .replace(/^(list|rank|compare|show|give|tell|find|search|get|help|me|and)\s+/gi, '')
    // Remove question words and common phrases
    .replace(/^(what|which|can you|please|i need|i want|looking for|find me|recommend|best|top|good|the)\s+/gi, '')
    .replace(/^(what|which|can you|please|i need|i want|looking for|find me|recommend|best|top|good|the)\s+/gi, '')
    .replace(/\?+$/, '')
    .replace(/\s+(for\s+(men|women|kids|home|office|outdoor|indoor|me|us))\b.*/gi, '')
    .replace(/\s+(under|less than|around|about)\s*\$?\d+.*/gi, '')
    .replace(/\s+(with|without|no|that has|that have)\s+.*/gi, '')
    .replace(/\s*,\s*.*$/, '')
    .trim();
  
  cleaned = cleaned
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  if (cleaned.length > 40) {
    cleaned = cleaned.slice(0, 40).trim();
    const lastSpace = cleaned.lastIndexOf(' ');
    if (lastSpace > 20) cleaned = cleaned.slice(0, lastSpace);
  }
  
  return cleaned || 'Product Research';
}

function showShopReady(context: ProductContext) {
  currentShopContext = context;
  currentShopProductName = extractProductName(context.query);
  
  shopProductName.textContent = currentShopProductName;
  shopActive.classList.remove('hidden');
  noShopContext.classList.add('hidden');
  
  // Show requirements
  if (context.requirements && context.requirements.length > 0) {
    shopRequirements.innerHTML = context.requirements
      .slice(0, 6)
      .map(r => `<span class="req-tag">${r}</span>`)
      .join('');
  } else {
    shopRequirements.innerHTML = '';
  }
}

function showNoShopContext() {
  currentShopContext = null;
  shopActive.classList.add('hidden');
  noShopContext.classList.remove('hidden');
}

// Set shop context from history entry (used by history "Shop" button)
function setShopContextFromHistory(entry: ResearchEntry) {
  const context: ProductContext = {
    query: entry.query,
    requirements: entry.requirements,
    timestamp: entry.timestamp,
    source: 'chatgpt',
    conversationId: entry.conversationId,
  };
  
  // Save as current context so it's used for matching
  browser.runtime.sendMessage({ type: 'SAVE_CONTEXT', context });
  
  showShopReady(context);
  
  // Switch to shop tab
  tabs.forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab="shop"]')?.classList.add('active');
  tabContents.forEach(c => c.classList.remove('active'));
  document.getElementById('tab-shop')?.classList.add('active');
}
