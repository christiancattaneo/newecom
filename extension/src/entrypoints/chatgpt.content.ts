/**
 * ChatGPT Content Script
 * Silently captures product research context from ChatGPT conversations
 * - Captures both user prompts AND AI responses
 * - Works on existing conversations when opened via URL
 * - Continuously updates as AI streams responses
 */

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',

  main() {
    console.log('[Sift] ChatGPT content script loaded');
    initContextCapture();
  },
});

// Debounce timer for processing
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastProcessedText = '';
let currentConversationId: string | null = null;

// Shorter debounce for more real-time capture during streaming
const DEBOUNCE_MS = 800;

// Shopping-related keywords to detect product research
const SHOPPING_KEYWORDS = [
  'buy', 'purchase', 'recommend', 'best', 'review', 'price', 'budget',
  'looking for', 'need', 'want', 'shopping', 'compare', 'vs', 'versus',
  'under $', 'less than', 'cheaper', 'affordable', 'quality',
  'durable', 'reliable', 'warranty', 'features', 'specs', 'specification',
  'amazon', 'best buy', 'target', 'walmart', 'ebay',
  'machine', 'device', 'appliance', 'product', 'item', 'gear', 'equipment',
  'shoes', 'footwear', 'clothing', 'jacket', 'pants',
];

// Product categories to detect (longer phrases to avoid false matches)
const PRODUCT_CATEGORIES = [
  // Electronics
  'espresso machine', 'coffee maker', 'laptop', 'smartphone', 'headphones',
  'monitor', 'keyboard', 'mouse', 'camera', 'television', '4k tv', 'smart tv',
  'tablet', 'smartwatch', 'earbuds', 'speaker', 'soundbar', 'gaming console',
  // Appliances  
  'refrigerator', 'washing machine', 'dryer', 'vacuum cleaner', 'air purifier',
  'dishwasher', 'blender', 'toaster', 'microwave', 'air fryer', 'instant pot',
  // Furniture
  'mattress', 'office chair', 'gaming chair', 'standing desk', 'sofa', 'couch',
  // Fitness
  'treadmill', 'exercise bike', 'dumbbells', 'yoga mat', 'resistance bands',
  // Fashion & Footwear
  'running shoes', 'sneakers', 'boots', 'sandals', 'dress shoes', 'hiking boots',
  'walking shoes', 'tennis shoes', 'basketball shoes', 'training shoes',
  'backpack', 'luggage', 'suitcase', 'watch', 'sunglasses',
  'winter jacket', 'rain jacket', 'hoodie', 'jeans', 'dress shirt',
  // Outdoor
  'tent', 'sleeping bag', 'camping gear', 'grill', 'lawn mower',
  // Generic but specific enough
  'wireless earbuds', 'mechanical keyboard', 'gaming mouse', 'webcam',
  'external hard drive', 'portable charger', 'power bank',
];

function initContextCapture() {
  // Get conversation ID from URL
  updateConversationId();
  
  // Set up mutation observer for live updates
  const observer = new MutationObserver(handleMutation);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Watch for URL changes (navigating between conversations)
  setupUrlChangeListener();

  // Process existing conversation immediately (for when opening a saved chat)
  console.log('[Sift] Processing existing conversation...');
  setTimeout(() => processConversation(true), 500);
  
  // Process again after page fully loads
  setTimeout(() => processConversation(true), 2000);
}

function updateConversationId() {
  const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
  const newId = match ? match[1] : null;
  
  if (newId !== currentConversationId) {
    console.log('[Sift] Conversation changed:', newId);
    currentConversationId = newId;
    lastProcessedText = ''; // Reset for new conversation
    return true;
  }
  return false;
}

function setupUrlChangeListener() {
  // Watch for URL changes using history API
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
  if (updateConversationId()) {
    // New conversation, process it
    console.log('[Sift] URL changed, processing new conversation...');
    setTimeout(() => processConversation(true), 1000);
  }
}

function handleMutation(mutations: MutationRecord[]) {
  // Check if mutation is in conversation area
  const isRelevant = mutations.some(mutation => {
    const target = mutation.target as HTMLElement;
    // Check for message content changes
    return target.closest?.('[data-message-author-role]') || 
           target.closest?.('.markdown') ||
           target.closest?.('.user-message-bubble-color') ||
           target.classList?.contains('markdown') ||
           target.classList?.contains('prose');
  });

  if (isRelevant) {
    // Debounce but keep it short for streaming updates
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => processConversation(false), DEBOUNCE_MS);
  }
}

async function processConversation(isInitialLoad: boolean) {
  try {
    const { userMessages, aiMessages, fullText } = extractConversation();
    
    console.log(`[Sift] Extracted: ${userMessages.length} user messages, ${aiMessages.length} AI messages`);
    
    // Skip if no meaningful change
    if (fullText === lastProcessedText && !isInitialLoad) {
      return;
    }
    
    if (fullText.length < 30) {
      return; // Too short
    }

    // Check if this looks like product research
    const lowerText = fullText.toLowerCase();
    const hasShoppingKeywords = SHOPPING_KEYWORDS.some(kw => lowerText.includes(kw));
    const hasProductCategory = PRODUCT_CATEGORIES.some(cat => lowerText.includes(cat));

    if (!hasShoppingKeywords && !hasProductCategory) {
      console.log('[Sift] Not product research');
      return;
    }

    // Extract context - prioritize user messages for understanding intent
    const context = extractProductContext(userMessages, aiMessages, fullText);
    
    if (context.query || context.requirements.length > 0) {
      // Only save if there's meaningful change
      const contextString = JSON.stringify(context);
      if (contextString !== lastProcessedText || isInitialLoad) {
        lastProcessedText = fullText;
        
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
      }
    }
  } catch (error) {
    console.error('[Sift] Error processing conversation:', error);
  }
}

function extractConversation(): { userMessages: string[]; aiMessages: string[]; fullText: string } {
  const userMessages: string[] = [];
  const aiMessages: string[] = [];
  
  // Extract USER messages
  const userElements = document.querySelectorAll('[data-message-author-role="user"]');
  userElements.forEach(el => {
    // User messages are in a bubble div
    const textContent = el.textContent?.trim();
    if (textContent) {
      userMessages.push(textContent);
    }
  });
  
  // Extract AI messages
  const aiElements = document.querySelectorAll('[data-message-author-role="assistant"] .markdown');
  aiElements.forEach(el => {
    const textContent = el.textContent?.trim();
    if (textContent) {
      aiMessages.push(textContent);
    }
  });

  // Combine for full context (recent messages)
  const allMessages = [
    ...userMessages.slice(-3).map(m => `USER: ${m}`),
    ...aiMessages.slice(-2).map(m => `AI: ${m.slice(0, 1000)}`), // Truncate long AI responses
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
  
  // PRIORITY: Check user messages first for product category
  let query = '';
  const sortedCategories = [...PRODUCT_CATEGORIES].sort((a, b) => b.length - a.length);
  
  // First try user messages (what they're actually looking for)
  for (const category of sortedCategories) {
    if (userText.includes(category)) {
      query = category;
      console.log('[Sift] Found category in USER message:', category);
      break;
    }
  }
  
  // Fall back to full conversation if not found in user messages
  if (!query) {
    for (const category of sortedCategories) {
      if (lowerText.includes(category)) {
        query = category;
        console.log('[Sift] Found category in conversation:', category);
        break;
      }
    }
  }

  // If no category, try to extract from user patterns
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

    // Check user messages first
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

  // Extract requirements from both user messages and AI analysis
  const requirements: string[] = [];

  // Price requirements (check user messages primarily)
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

  // Feature/quality requirements from user messages
  const requirementKeywords = [
    // Materials
    'no plastic', 'without plastic', 'plastic-free', 'stainless steel', 'metal', 'leather', 'canvas',
    // Quality
    'durable', 'reliable', 'long-lasting', 'quality', 'premium', 'professional',
    'heavy duty', 'lightweight', 'portable', 'compact',
    // Comfort/Fit
    'comfortable', 'wide fit', 'narrow fit', 'cushioning', 'arch support', 'breathable',
    'waterproof', 'water resistant', 'insulated',
    // Style
    'minimalist', 'modern', 'classic', 'casual', 'formal',
    // Tech
    'wireless', 'bluetooth', 'noise cancelling', 'long battery',
  ];
  
  for (const kw of requirementKeywords) {
    if (userText.includes(kw) || lowerText.includes(kw)) {
      requirements.push(kw);
    }
  }

  // Extract from user's specific requests
  const featurePatterns = [
    /(?:i |we )?(?:need|want|prefer|looking for)[^.]*?(?:with |that has |that have )([^.,!?\n]+)/gi,
    /must have ([^.,!?\n]+)/gi,
    /important:? ([^.,!?\n]+)/gi,
  ];

  for (const pattern of featurePatterns) {
    let match;
    const textToSearch = userMessages.join(' ');
    while ((match = pattern.exec(textToSearch)) !== null) {
      const feature = match[1].trim().toLowerCase();
      if (feature.length > 3 && feature.length < 40 && !requirements.includes(feature)) {
        requirements.push(feature);
      }
    }
  }

  // Deduplicate and limit
  const uniqueReqs = [...new Set(requirements)].slice(0, 10);

  return { query, requirements: uniqueReqs };
}

function showCaptureIndicator(context: { query: string; requirements: string[] }) {
  // Remove existing indicator
  const existing = document.getElementById('sift-capture-indicator');
  if (existing) existing.remove();

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

  // Auto-remove after 4 seconds
  setTimeout(() => {
    indicator.style.transition = 'opacity 0.3s, transform 0.3s';
    indicator.style.opacity = '0';
    indicator.style.transform = 'translateX(20px)';
    setTimeout(() => indicator.remove(), 300);
  }, 4000);
}
