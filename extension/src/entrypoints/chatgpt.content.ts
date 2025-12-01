/**
 * ChatGPT Content Script
 * Silently captures product research context from ChatGPT conversations
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

const SHOPPING_KEYWORDS = [
  'buy', 'purchase', 'recommend', 'best', 'review', 'price', 'budget',
  'looking for', 'need', 'want', 'shopping', 'compare', 'vs', 'versus',
  'under $', 'less than', 'cheaper', 'affordable', 'quality',
  'durable', 'reliable', 'warranty', 'features', 'specs', 'specification',
  'amazon', 'best buy', 'target', 'walmart', 'ebay',
  'machine', 'device', 'appliance', 'product', 'item', 'gear', 'equipment',
  'shoes', 'footwear', 'clothing', 'jacket', 'pants',
];

const PRODUCT_CATEGORIES = [
  'espresso machine', 'coffee maker', 'laptop', 'smartphone', 'headphones',
  'monitor', 'keyboard', 'mouse', 'camera', 'television', '4k tv', 'smart tv',
  'tablet', 'smartwatch', 'earbuds', 'speaker', 'soundbar', 'gaming console',
  'refrigerator', 'washing machine', 'dryer', 'vacuum cleaner', 'air purifier',
  'dishwasher', 'blender', 'toaster', 'microwave', 'air fryer', 'instant pot',
  'mattress', 'office chair', 'gaming chair', 'standing desk', 'sofa', 'couch',
  'treadmill', 'exercise bike', 'dumbbells', 'yoga mat', 'resistance bands',
  'running shoes', 'sneakers', 'boots', 'sandals', 'dress shoes', 'hiking boots',
  'walking shoes', 'tennis shoes', 'basketball shoes', 'training shoes',
  'backpack', 'luggage', 'suitcase', 'watch', 'sunglasses',
  'winter jacket', 'rain jacket', 'hoodie', 'jeans', 'dress shirt',
  'tent', 'sleeping bag', 'camping gear', 'grill', 'lawn mower',
  'wireless earbuds', 'mechanical keyboard', 'gaming mouse', 'webcam',
  'external hard drive', 'portable charger', 'power bank',
];

function checkExtensionContext(): boolean {
  try {
    // This will throw if context is invalidated
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
           target.closest?.('.user-message-bubble-color') ||
           target.classList?.contains('markdown') ||
           target.classList?.contains('prose');
  });

  if (isRelevant) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => processConversation(false), DEBOUNCE_MS);
  }
}

async function processConversation(isInitialLoad: boolean) {
  // Check if extension context is still valid
  if (!checkExtensionContext()) {
    isContextValid = false;
    showRefreshMessage();
    return;
  }

  try {
    const { userMessages, aiMessages, fullText } = extractConversation();
    
    console.log(`[Sift] Extracted: ${userMessages.length} user messages, ${aiMessages.length} AI messages`);
    
    if (fullText === lastProcessedText && !isInitialLoad) return;
    if (fullText.length < 30) return;

    const lowerText = fullText.toLowerCase();
    const hasShoppingKeywords = SHOPPING_KEYWORDS.some(kw => lowerText.includes(kw));
    const hasProductCategory = PRODUCT_CATEGORIES.some(cat => lowerText.includes(cat));

    if (!hasShoppingKeywords && !hasProductCategory) {
      console.log('[Sift] Not product research');
      return;
    }

    const context = extractProductContext(userMessages, aiMessages, fullText);
    
    if (context.query || context.requirements.length > 0) {
      const contextString = JSON.stringify(context);
      if (contextString !== lastProcessedText || isInitialLoad) {
        lastProcessedText = fullText;
        
        // Try to send message, handle context invalidation
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
          
          console.log('[Sift] Context captured:', context.query, context.requirements);
          showCaptureIndicator(context);
        } catch (error) {
          if (String(error).includes('Extension context invalidated')) {
            isContextValid = false;
            showRefreshMessage();
          } else {
            console.error('[Sift] Error sending context:', error);
          }
        }
      }
    }
  } catch (error) {
    if (String(error).includes('Extension context invalidated')) {
      isContextValid = false;
      showRefreshMessage();
    } else {
      console.error('[Sift] Error processing conversation:', error);
    }
  }
}

function extractConversation(): { userMessages: string[]; aiMessages: string[]; fullText: string } {
  const userMessages: string[] = [];
  const aiMessages: string[] = [];
  
  // Get USER messages - they're in the bubble div
  document.querySelectorAll('[data-message-author-role="user"]').forEach(el => {
    const text = el.textContent?.trim();
    if (text) userMessages.push(text);
  });
  
  // Get AI messages - they're in .markdown inside assistant role
  document.querySelectorAll('[data-message-author-role="assistant"] .markdown').forEach(el => {
    const text = el.textContent?.trim();
    if (text) aiMessages.push(text);
  });

  // Combine recent messages
  const allMessages = [
    ...userMessages.slice(-3).map(m => `USER: ${m}`),
    ...aiMessages.slice(-2).map(m => `AI: ${m.slice(0, 1000)}`),
  ];

  return {
    userMessages,
    aiMessages,
    fullText: allMessages.join('\n\n'),
  };
}

function extractProductContext(
  userMessages: string[], 
  aiMessages: string[],
  fullText: string
): { query: string; requirements: string[] } {
  const lowerText = fullText.toLowerCase();
  const userText = userMessages.join(' ').toLowerCase();
  
  let query = '';
  const sortedCategories = [...PRODUCT_CATEGORIES].sort((a, b) => b.length - a.length);
  
  // Check user messages first
  for (const category of sortedCategories) {
    if (userText.includes(category)) {
      query = category;
      console.log('[Sift] Found category in USER message:', category);
      break;
    }
  }
  
  // Fall back to full conversation
  if (!query) {
    for (const category of sortedCategories) {
      if (lowerText.includes(category)) {
        query = category;
        console.log('[Sift] Found category in conversation:', category);
        break;
      }
    }
  }

  // Try pattern extraction
  if (!query) {
    const patterns = [
      /looking for (?:a |an |some )?(?:good |great |best )?([^.,!?\n]+)/i,
      /need (?:a |an |some )?(?:good |great |new )?([^.,!?\n]+)/i,
      /want (?:a |an |some )?(?:good |great |new )?([^.,!?\n]+)/i,
      /recommend(?:ation)?s? (?:for |on )?(?:a |an |some )?([^.,!?\n]+)/i,
      /best ([^.,!?\n]+?) (?:for|under|around|that)/i,
      /shopping for (?:a |an |some )?([^.,!?\n]+)/i,
      /buy(?:ing)? (?:a |an |some )?([^.,!?\n]+)/i,
      /help (?:me )?(?:find|choose|pick|select) (?:a |an |some )?([^.,!?\n]+)/i,
    ];

    for (const userMsg of userMessages) {
      for (const pattern of patterns) {
        const match = userMsg.match(pattern);
        if (match && match[1] && match[1].length > 3) {
          query = match[1].trim().slice(0, 60);
          console.log('[Sift] Extracted query from user message:', query);
          break;
        }
      }
      if (query) break;
    }
  }

  const requirements: string[] = [];

  // Price patterns
  const pricePatterns = [
    /under \$?(\d+)/i,
    /less than \$?(\d+)/i,
    /budget (?:of |is |around )?\$?(\d+)/i,
    /\$(\d+) (?:or less|max|maximum|budget)/i,
    /around \$?(\d+)/i,
    /(\d+) (?:dollars|bucks)/i,
  ];

  for (const pattern of pricePatterns) {
    const match = userText.match(pattern) || fullText.match(pattern);
    if (match) {
      requirements.push(`budget under $${match[1]}`);
      break;
    }
  }

  // Feature keywords
  const requirementKeywords = [
    'no plastic', 'without plastic', 'plastic-free', 'stainless steel', 'metal', 'leather', 'canvas',
    'durable', 'reliable', 'long-lasting', 'quality', 'premium', 'professional',
    'heavy duty', 'lightweight', 'portable', 'compact',
    'comfortable', 'wide fit', 'narrow fit', 'cushioning', 'arch support', 'breathable',
    'waterproof', 'water resistant', 'insulated',
    'minimalist', 'modern', 'classic', 'casual', 'formal',
    'wireless', 'bluetooth', 'noise cancelling', 'long battery',
  ];
  
  for (const kw of requirementKeywords) {
    if (userText.includes(kw) || lowerText.includes(kw)) {
      requirements.push(kw);
    }
  }

  const uniqueReqs = [...new Set(requirements)].slice(0, 10);
  return { query, requirements: uniqueReqs };
}

function showRefreshMessage() {
  // Remove any existing indicators
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
      max-width: 280px;
      cursor: pointer;
    " onclick="location.reload()">
      <div style="display: flex; align-items: center; gap: 10px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6"></path>
          <path d="M1 20v-6h6"></path>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
        <div>
          <div style="font-weight: 600;">Sift needs refresh</div>
          <div style="font-size: 12px; opacity: 0.9; margin-top: 2px;">Click here to reload page</div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(msg);
}

function showCaptureIndicator(context: { query: string; requirements: string[] }) {
  document.getElementById('sift-capture-indicator')?.remove();
  document.getElementById('sift-refresh-message')?.remove();

  const reqPreview = context.requirements.slice(0, 3).join(', ');
  
  const indicator = document.createElement('div');
  indicator.id = 'sift-capture-indicator';
  indicator.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 12px 16px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);
      z-index: 10000;
      max-width: 300px;
      animation: sift-slide-in 0.3s ease-out;
    ">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span style="font-weight: 600;">Sift captured your search</span>
      </div>
      <div style="font-size: 12px; opacity: 0.9;">
        ${context.query ? `<div style="margin-bottom: 4px;">"${context.query}"</div>` : ''}
        ${reqPreview ? `<div style="font-size: 11px; opacity: 0.8;">${reqPreview}</div>` : ''}
      </div>
    </div>
    <style>
      @keyframes sift-slide-in {
        from { transform: translateX(100px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    </style>
  `;

  document.body.appendChild(indicator);

  setTimeout(() => {
    indicator.style.transition = 'opacity 0.3s, transform 0.3s';
    indicator.style.opacity = '0';
    indicator.style.transform = 'translateX(20px)';
    setTimeout(() => indicator.remove(), 300);
  }, 4000);
}
