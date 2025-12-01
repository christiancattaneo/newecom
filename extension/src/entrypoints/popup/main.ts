/**
 * Popup Main Script
 * Handles the extension popup UI
 */

interface ProductContext {
  query: string;
  requirements: string[];
  timestamp: number;
  source: 'chatgpt' | 'manual';
}

// DOM Elements
const statusIndicator = document.getElementById('status-indicator')!;
const statusText = statusIndicator.querySelector('.text')!;
const contextSection = document.getElementById('context-section')!;
const noContextSection = document.getElementById('no-context-section')!;
const contextQuery = document.getElementById('context-query')!;
const contextRequirements = document.getElementById('context-requirements')!;
const clearButton = document.getElementById('clear-context')!;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadContext();
  setupEventListeners();
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

  // Display context details
  contextQuery.textContent = `"${context.query}"`;
  
  contextRequirements.innerHTML = context.requirements
    .map(req => `<li>${req}</li>`)
    .join('');
}

function showNoContext() {
  // Update status
  statusIndicator.classList.remove('active');
  statusIndicator.classList.add('inactive');
  statusText.textContent = 'No active context';

  // Show empty state
  contextSection.classList.add('hidden');
  noContextSection.classList.remove('hidden');
}

function setupEventListeners() {
  // Clear context button
  clearButton.addEventListener('click', async () => {
    try {
      await browser.runtime.sendMessage({ type: 'CLEAR_CONTEXT' });
      showNoContext();
    } catch (error) {
      console.error('[Sift Popup] Failed to clear context:', error);
    }
  });
}

