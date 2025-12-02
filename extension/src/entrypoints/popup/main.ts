/**
 * Popup Main Script
 * Shows accumulated context and research history
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
const shopContext = document.getElementById('shop-context')!;
const shopProductName = document.getElementById('shop-product-name')!;
const shopStoreSection = document.getElementById('shop-store-section')!;
const storeSelect = document.getElementById('store-select') as HTMLSelectElement;
const shopSearchBtn = document.getElementById('shop-search')!;
const shopResults = document.getElementById('shop-results')!;
const shopLoading = document.getElementById('shop-loading')!;
const shopProducts = document.getElementById('shop-products')!;
const shopSummary = document.getElementById('shop-summary')!;
const noShopContext = document.getElementById('no-shop-context')!;

// Track known history IDs for highlighting new entries
let knownHistoryIds: Set<string> = new Set();

// Current shop context
let currentShopContext: ProductContext | null = null;
let currentShopProductName: string = '';

// Tab elements
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadContext();
  await loadHistory();
  setupEventListeners();
  setupTabs();
  setupStorageListener();
  
  // Refresh current context every 2 seconds
  setInterval(loadContext, 2000);
});

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
      showContext(result.context);
    } else {
      showNoContext();
    }
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
  
  // Shop tab listeners
  storeSelect.addEventListener('change', () => {
    shopSearchBtn.disabled = !storeSelect.value || !currentShopContext;
  });
  
  shopSearchBtn.addEventListener('click', async () => {
    if (!currentShopContext || !storeSelect.value) return;
    await searchAndAnalyze(storeSelect.value);
  });
}

// ========================================
// SHOP TAB FUNCTIONS
// ========================================

async function loadShopContext() {
  try {
    const result = await browser.runtime.sendMessage({ type: 'CHECK_CONTEXT_EXISTS' });
    
    if (result?.exists && result.context) {
      setShopContext(result.context, extractProductName(result.context.query));
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
    .replace(/^(what|which|can you|please|i need|i want|looking for|find me|recommend|best|top|good)\s+/gi, '')
    .replace(/\?+$/, '')
    .replace(/\s+(for\s+(men|women|kids|home|office|outdoor|indoor))\b.*/gi, '')
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

function setShopContext(context: ProductContext, productName: string) {
  currentShopContext = context;
  currentShopProductName = productName;
  
  shopProductName.textContent = productName;
  shopContext.classList.remove('hidden');
  shopStoreSection.classList.remove('hidden');
  noShopContext.classList.add('hidden');
  
  shopSearchBtn.disabled = !storeSelect.value;
  
  // Clear previous results
  shopResults.classList.add('hidden');
  shopProducts.innerHTML = '';
  shopSummary.classList.add('hidden');
}

function showNoShopContext() {
  currentShopContext = null;
  shopContext.classList.add('hidden');
  shopStoreSection.classList.add('hidden');
  noShopContext.classList.remove('hidden');
  shopResults.classList.add('hidden');
}

// Set shop context from history entry
export function setShopContextFromHistory(entry: ResearchEntry) {
  const context: ProductContext = {
    query: entry.query,
    requirements: entry.requirements,
    timestamp: entry.timestamp,
    source: 'chatgpt',
    conversationId: entry.conversationId,
  };
  
  setShopContext(context, entry.productName || extractProductName(entry.query));
  
  // Switch to shop tab
  tabs.forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab="shop"]')?.classList.add('active');
  tabContents.forEach(c => c.classList.remove('active'));
  document.getElementById('tab-shop')?.classList.add('active');
}

const STORE_URLS: Record<string, string> = {
  amazon: 'https://www.amazon.com/s?k=',
  bestbuy: 'https://www.bestbuy.com/site/searchpage.jsp?st=',
  target: 'https://www.target.com/s?searchTerm=',
  walmart: 'https://www.walmart.com/search?q=',
  homedepot: 'https://www.homedepot.com/s/',
  lowes: 'https://www.lowes.com/search?searchTerm=',
  newegg: 'https://www.newegg.com/p/pl?d=',
  costco: 'https://www.costco.com/CatalogSearch?dept=All&keyword=',
};

async function searchAndAnalyze(store: string) {
  if (!currentShopContext) return;
  
  shopResults.classList.remove('hidden');
  shopLoading.classList.remove('hidden');
  shopProducts.innerHTML = '';
  shopSummary.classList.add('hidden');
  
  try {
    const searchUrl = STORE_URLS[store] + encodeURIComponent(currentShopContext.query);
    
    // Open in new tab and inject scraper
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });
    
    // Wait for page load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Try to get products from the tab
    let products: any[] = [];
    
    try {
      // Inject content script to scrape
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: ['content-scripts/shopping.js'],
      });
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Request products from tab
      const result = await chrome.tabs.sendMessage(tab.id!, { type: 'SCRAPE_PRODUCTS' });
      products = result?.products || [];
    } catch (e) {
      console.error('[Sift Popup] Failed to scrape:', e);
    }
    
    // Close the background tab
    await chrome.tabs.remove(tab.id!);
    
    if (products.length === 0) {
      shopLoading.classList.add('hidden');
      shopProducts.innerHTML = `
        <div class="empty-state" style="padding: 20px;">
          <div class="icon">🔍</div>
          <p>No products found</p>
          <p class="hint">Try a different store or search term</p>
          <a href="${searchUrl}" target="_blank" class="shop-product-link" style="margin-top: 12px;">Open ${store} search →</a>
        </div>
      `;
      return;
    }
    
    // Get AI rankings
    const rankings = await browser.runtime.sendMessage({
      type: 'RANK_PRODUCTS',
      products,
    });
    
    shopLoading.classList.add('hidden');
    
    if (rankings?.error) {
      shopProducts.innerHTML = `<div class="empty-state"><p>${rankings.error}</p></div>`;
      return;
    }
    
    renderShopProducts(products, rankings);
    
  } catch (error) {
    console.error('[Sift Popup] Search failed:', error);
    shopLoading.classList.add('hidden');
    shopProducts.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>Search failed</p>
        <p class="hint">Please try again</p>
      </div>
    `;
  }
}

interface ProductData {
  title: string;
  price: number | null;
  url: string;
  description?: string;
  imageUrl?: string;
}

interface RankingResult {
  rankings: Array<{ index: number; score: number; reasons: string[] }>;
  summary: string;
}

function renderShopProducts(products: ProductData[], rankings: RankingResult) {
  const sortedProducts = rankings.rankings
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => ({
      ...products[r.index],
      score: r.score,
      reasons: r.reasons,
    }));
  
  shopProducts.innerHTML = sortedProducts.map((product, idx) => `
    <div class="shop-product-card${idx === 0 ? ' top-pick' : ''}">
      <div class="shop-product-header">
        <span class="shop-product-rank">${idx === 0 ? '🏆 Best Match' : `#${idx + 1}`}</span>
        <span class="shop-product-score">${product.score}/100</span>
      </div>
      <div class="shop-product-title">${product.title?.slice(0, 80) || 'Unknown Product'}${product.title?.length > 80 ? '...' : ''}</div>
      ${product.price ? `<div class="shop-product-price">$${product.price.toFixed(2)}</div>` : ''}
      <div class="shop-product-reasons">
        ${product.reasons?.slice(0, 3).map(r => `<div class="shop-product-reason">${r}</div>`).join('') || ''}
      </div>
      <a href="${product.url}" target="_blank" class="shop-product-link">View Product →</a>
    </div>
  `).join('');
  
  if (rankings.summary) {
    shopSummary.innerHTML = `<p>${rankings.summary}</p>`;
    shopSummary.classList.remove('hidden');
  }
}
