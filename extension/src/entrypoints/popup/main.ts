/**
 * Popup Main Script
 * Shows accumulated context and current analysis state
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

interface AnalysisState {
  tabId: number;
  url: string;
  status: 'analyzing' | 'done' | 'error';
  isTrackedLink: boolean;
  timestamp: number;
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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadContext();
  setupEventListeners();
  
  // Refresh every 2 seconds to show live updates
  setInterval(loadContext, 2000);
});

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

function showContext(context: ProductContext) {
  // Update status
  statusIndicator.classList.remove('inactive');
  statusIndicator.classList.add('active');
  statusText.textContent = 'Context active';

  // Show context section
  contextSection.classList.remove('hidden');
  noContextSection.classList.add('hidden');

  // Display query
  contextQuery.textContent = context.query ? `"${context.query}"` : '(No specific product)';
  
  // Stats
  const stats: string[] = [];
  if (context.messageCount) stats.push(`📝 ${context.messageCount} messages`);
  if (context.requirements?.length) stats.push(`🎯 ${context.requirements.length} requirements`);
  if (context.trackedLinks?.length) stats.push(`🔗 ${context.trackedLinks.length} links`);
  if (context.mentionedProducts?.length) stats.push(`📦 ${context.mentionedProducts.length} products`);
  
  contextStats.innerHTML = stats.map(s => `<span class="stat">${s}</span>`).join('');
  
  // Requirements
  if (context.requirements && context.requirements.length > 0) {
    contextRequirements.innerHTML = context.requirements
      .map(req => `<li class="requirement-tag">${req}</li>`)
      .join('');
  } else {
    contextRequirements.innerHTML = '<li class="empty">No specific requirements captured</li>';
  }

  // Tracked Links
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

  // Mentioned Products
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
}
