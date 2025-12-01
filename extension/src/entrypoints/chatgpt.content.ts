/**
 * ChatGPT Content Script
 * Captures product research context from ChatGPT conversations
 */

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',

  main() {
    console.log('[Sift] ChatGPT content script loaded');
    initContextCapture();
  },
});

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastProcessedText = '';
let currentConversationId: string | null = null;
let isContextValid = true;

const DEBOUNCE_MS = 800;

// Shopping intent signals
const SHOPPING_SIGNALS = [
  'best', 'recommend', 'buy', 'purchase', 'looking for', 'need', 'want',
  'shopping', 'compare', 'vs', 'review', 'under $', 'budget', 'affordable',
  'top', 'which', 'what should', 'suggestion', 'advice',
];

function checkExtensionContext(): boolean {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
}

function initContextCapture() {
  if (!checkExtensionContext()) {
    showRefreshMessage();
    return;
  }

  updateConversationId();
  
  const observer = new MutationObserver(handleMutation);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  setupUrlChangeListener();

  console.log('[Sift] Processing existing conversation...');
  setTimeout(() => processConversation(true), 500);
  setTimeout(() => processConversation(true), 2000);
}

function updateConversationId() {
  const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
  const newId = match ? match[1] : null;
  
  if (newId !== currentConversationId) {
    console.log('[Sift] Conversation changed:', newId);
    currentConversationId = newId;
    lastProcessedText = '';
    return true;
  }
  return false;
}

function setupUrlChangeListener() {
  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    handleUrlChange();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    handleUrlChange();
  };

  window.addEventListener('popstate', handleUrlChange);
}

function handleUrlChange() {
  if (!checkExtensionContext()) {
    showRefreshMessage();
    return;
  }
  
  if (updateConversationId()) {
    console.log('[Sift] URL changed, processing new conversation...');
    setTimeout(() => processConversation(true), 1000);
  }
}

function handleMutation(mutations: MutationRecord[]) {
  if (!isContextValid) return;
  
  const isRelevant = mutations.some(mutation => {
    const target = mutation.target as HTMLElement;
    return target.closest?.('[data-message-author-role]') || 
           target.closest?.('.markdown') ||
           target.closest?.('.user-message-bubble-color');
  });

  if (isRelevant) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => processConversation(false), DEBOUNCE_MS);
  }
}

async function processConversation(isInitialLoad: boolean) {
  if (!checkExtensionContext()) {
    isContextValid = false;
    showRefreshMessage();
    return;
  }

  try {
    const { userMessages, aiMessages } = extractConversation();
    
    console.log(`[Sift] Found ${userMessages.length} user messages, ${aiMessages.length} AI messages`);
    
    if (userMessages.length === 0) {
      console.log('[Sift] No user messages found');
      return;
    }

    // Get the most recent user messages
    const recentUserMessages = userMessages.slice(-3);
    const combinedUserText = recentUserMessages.join(' ').toLowerCase();
    
    // Check if this looks like shopping research
    const hasShoppingSignal = SHOPPING_SIGNALS.some(s => combinedUserText.includes(s));
    
    if (!hasShoppingSignal) {
      console.log('[Sift] No shopping signals detected');
      return;
    }

    // Skip if no meaningful change
    const textHash = recentUserMessages.join('|');
    if (textHash === lastProcessedText && !isInitialLoad) {
      return;
    }
    lastProcessedText = textHash;

    // Extract context - use the actual user message as the query
    const context = extractProductContext(recentUserMessages, aiMessages);
    
    if (context.query) {
      try {
        await browser.runtime.sendMessage({
          type: 'SAVE_CONTEXT',
          context: {
            ...context,
            timestamp: Date.now(),
            source: 'chatgpt',
            conversationId: currentConversationId,
          },
        });
        
        console.log('[Sift] Context saved:', context);
        showCaptureIndicator(context);
      } catch (error) {
        if (String(error).includes('Extension context invalidated')) {
          isContextValid = false;
          showRefreshMessage();
        }
      }
    }
  } catch (error) {
    if (String(error).includes('Extension context invalidated')) {
      isContextValid = false;
      showRefreshMessage();
    } else {
      console.error('[Sift] Error:', error);
    }
  }
}

function extractConversation(): { userMessages: string[]; aiMessages: string[] } {
  const userMessages: string[] = [];
  const aiMessages: string[] = [];
  
  // Get USER messages
  document.querySelectorAll('[data-message-author-role="user"]').forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length > 5) userMessages.push(text);
  });
  
  // Get AI messages (just first paragraph for context)
  document.querySelectorAll('[data-message-author-role="assistant"] .markdown').forEach(el => {
    const text = el.textContent?.trim();
    if (text) aiMessages.push(text.slice(0, 500));
  });

  return { userMessages, aiMessages };
}

function extractProductContext(
  userMessages: string[], 
  aiMessages: string[]
): { query: string; requirements: string[]; rawUserMessage: string } {
  // Use the most specific user message as the query
  // Usually the first message in a shopping conversation is the main question
  const mainMessage = userMessages[0] || '';
  const allUserText = userMessages.join(' ').toLowerCase();
  
  // Clean up the query - remove common prefixes
  let query = mainMessage
    .replace(/^(what('s| is| are) the |what |which |can you |please |i need |i want |i'm looking for |looking for |find me |recommend |best )/i, '')
    .replace(/\?+$/, '')
    .trim();
  
  // If query is too long, extract the core product
  if (query.length > 80) {
    // Try to find a product pattern
    const productMatch = mainMessage.match(
      /(?:best|top|good|recommend[^\s]*)\s+(.+?)(?:\s+(?:for|under|with|that|which|\?))/i
    );
    if (productMatch) {
      query = productMatch[1].trim();
    } else {
      // Just take first 80 chars at word boundary
      query = query.slice(0, 80).replace(/\s+\S*$/, '');
    }
  }

  // Extract requirements from user messages
  const requirements: string[] = [];

  // Price requirements
  const priceMatch = allUserText.match(/(?:under|less than|budget[:\s]*|max[:\s]*|around)\s*\$?\s*(\d+)/i);
  if (priceMatch) {
    requirements.push(`budget: under $${priceMatch[1]}`);
  }

  // "No X" requirements (like "no fluoride", "no plastic")
  const noMatches = allUserText.matchAll(/\bno\s+(\w+(?:\s+\w+)?)/gi);
  for (const match of noMatches) {
    const item = match[1].toLowerCase();
    if (!['the', 'a', 'an', 'more', 'less', 'need'].includes(item)) {
      requirements.push(`no ${item}`);
    }
  }

  // "With X" or "must have X" requirements
  const withMatches = allUserText.matchAll(/(?:with|must have|needs?|want)\s+(\w+(?:\s+\w+)?)/gi);
  for (const match of withMatches) {
    const item = match[1].toLowerCase();
    if (item.length > 2 && !['the', 'a', 'an', 'to', 'be'].includes(item)) {
      requirements.push(item);
    }
  }

  // Common quality keywords
  const qualityKeywords = [
    'durable', 'reliable', 'quality', 'premium', 'professional', 'heavy duty',
    'lightweight', 'portable', 'compact', 'waterproof', 'wireless', 'quiet',
    'efficient', 'eco-friendly', 'organic', 'natural', 'stainless steel',
  ];
  
  for (const kw of qualityKeywords) {
    if (allUserText.includes(kw) && !requirements.includes(kw)) {
      requirements.push(kw);
    }
  }

  // Dedupe and limit
  const uniqueReqs = [...new Set(requirements)].slice(0, 8);

  return { 
    query, 
    requirements: uniqueReqs,
    rawUserMessage: mainMessage,
  };
}

function showRefreshMessage() {
  document.getElementById('sift-capture-indicator')?.remove();
  document.getElementById('sift-refresh-message')?.remove();
  
  const msg = document.createElement('div');
  msg.id = 'sift-refresh-message';
  msg.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: white;
      padding: 14px 18px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 20px rgba(245, 158, 11, 0.4);
      z-index: 10000;
      cursor: pointer;
    " onclick="location.reload()">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 18px;">🔄</span>
        <div>
          <div style="font-weight: 600;">Sift needs refresh</div>
          <div style="font-size: 12px; opacity: 0.9;">Click to reload</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(msg);
}

function showCaptureIndicator(context: { query: string; requirements: string[] }) {
  document.getElementById('sift-capture-indicator')?.remove();
  document.getElementById('sift-refresh-message')?.remove();

  const indicator = document.createElement('div');
  indicator.id = 'sift-capture-indicator';
  indicator.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 14px 18px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);
      z-index: 10000;
      max-width: 320px;
    ">
      <div style="display: flex; align-items: flex-start; gap: 10px;">
        <span style="font-size: 18px;">✓</span>
        <div>
          <div style="font-weight: 600; margin-bottom: 6px;">Sift captured your search</div>
          <div style="font-size: 12px; background: rgba(0,0,0,0.2); padding: 8px 10px; border-radius: 6px; margin-bottom: 6px;">
            "${context.query.slice(0, 60)}${context.query.length > 60 ? '...' : ''}"
          </div>
          ${context.requirements.length > 0 ? `
            <div style="font-size: 11px; opacity: 0.9; display: flex; flex-wrap: wrap; gap: 4px;">
              ${context.requirements.slice(0, 4).map(r => 
                `<span style="background: rgba(255,255,255,0.2); padding: 2px 6px; border-radius: 4px;">${r}</span>`
              ).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(indicator);

  setTimeout(() => {
    indicator.style.transition = 'opacity 0.3s, transform 0.3s';
    indicator.style.opacity = '0';
    indicator.style.transform = 'translateX(20px)';
    setTimeout(() => indicator.remove(), 300);
  }, 5000);
}
