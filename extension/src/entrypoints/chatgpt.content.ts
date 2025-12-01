/**
 * ChatGPT Content Script
 * Silently captures product research context from ChatGPT conversations
 */

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',

  main() {
    console.log('[Sift] ChatGPT content script loaded');
    
    // Initialize the context capture system
    initContextCapture();
  },
});

// Debounce timer for processing
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000; // Wait 2s after last change before processing

// Shopping-related keywords to detect product research
const SHOPPING_KEYWORDS = [
  'buy', 'purchase', 'recommend', 'best', 'review', 'price', 'budget',
  'looking for', 'need', 'want', 'shopping', 'compare', 'vs', 'versus',
  'under $', 'less than', 'cheaper', 'affordable', 'quality',
  'durable', 'reliable', 'warranty', 'features', 'specs', 'specification',
  'amazon', 'best buy', 'target', 'walmart', 'ebay',
  'machine', 'device', 'appliance', 'product', 'item', 'gear', 'equipment',
];

// Product categories to detect
const PRODUCT_CATEGORIES = [
  'espresso machine', 'coffee maker', 'laptop', 'phone', 'headphones',
  'monitor', 'keyboard', 'mouse', 'camera', 'tv', 'television',
  'refrigerator', 'washer', 'dryer', 'vacuum', 'air purifier',
  'mattress', 'chair', 'desk', 'sofa', 'couch',
  'blender', 'toaster', 'microwave', 'air fryer',
  'bike', 'scooter', 'treadmill', 'weights',
];

function initContextCapture() {
  // Set up mutation observer to watch for conversation changes
  const observer = new MutationObserver(handleMutation);
  
  // Observe the main content area
  const observeTarget = document.body;
  observer.observe(observeTarget, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Also check immediately in case conversation already exists
  setTimeout(() => processConversation(), 1000);
}

function handleMutation(mutations: MutationRecord[]) {
  // Check if any mutation is relevant (conversation content)
  const isRelevant = mutations.some(mutation => {
    const target = mutation.target as HTMLElement;
    return target.closest?.('[data-message-author-role]') || 
           target.closest?.('.markdown') ||
           target.classList?.contains('markdown');
  });

  if (isRelevant) {
    // Debounce to avoid processing on every keystroke
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => processConversation(), DEBOUNCE_MS);
  }
}

async function processConversation() {
  try {
    const conversationText = extractConversation();
    
    if (!conversationText || conversationText.length < 50) {
      return; // Too short to be meaningful
    }

    // Check if this looks like product research
    const lowerText = conversationText.toLowerCase();
    const hasShoppingKeywords = SHOPPING_KEYWORDS.some(kw => lowerText.includes(kw));
    const hasProductCategory = PRODUCT_CATEGORIES.some(cat => lowerText.includes(cat));

    if (!hasShoppingKeywords && !hasProductCategory) {
      return; // Doesn't look like product research
    }

    // Extract context using simple heuristics (will be enhanced by AI on backend)
    const context = extractProductContext(conversationText);
    
    if (context.query && context.requirements.length > 0) {
      // Save to background
      await browser.runtime.sendMessage({
        type: 'SAVE_CONTEXT',
        context: {
          ...context,
          timestamp: Date.now(),
          source: 'chatgpt',
        },
      });
      
      console.log('[Sift] Product context captured:', context.query);
      showCaptureIndicator();
    }
  } catch (error) {
    console.error('[Sift] Error processing conversation:', error);
  }
}

function extractConversation(): string {
  // Try multiple selectors as ChatGPT's DOM may change
  const selectors = [
    '[data-message-author-role] .markdown',
    '.text-message .markdown',
    '[class*="message"] .markdown',
    '.prose',
  ];

  let messages: string[] = [];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      messages = Array.from(elements).map(el => el.textContent?.trim() || '');
      break;
    }
  }

  // Get last 5 messages for context (recent conversation)
  return messages.slice(-5).join('\n\n');
}

function extractProductContext(text: string): { query: string; requirements: string[] } {
  const lowerText = text.toLowerCase();
  
  // Try to find the product category
  let query = '';
  for (const category of PRODUCT_CATEGORIES) {
    if (lowerText.includes(category)) {
      query = category;
      break;
    }
  }

  // If no category found, try to extract from "looking for X" patterns
  if (!query) {
    const patterns = [
      /looking for (?:a |an )?([^.,!?]+)/i,
      /need (?:a |an )?([^.,!?]+)/i,
      /want (?:a |an )?([^.,!?]+)/i,
      /recommend (?:a |an )?([^.,!?]+)/i,
      /best ([^.,!?]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        query = match[1].trim().slice(0, 50); // Limit length
        break;
      }
    }
  }

  // Extract requirements
  const requirements: string[] = [];

  // Price requirements
  const pricePatterns = [
    /under \$?(\d+)/i,
    /less than \$?(\d+)/i,
    /budget (?:of |is )?\$?(\d+)/i,
    /\$(\d+) (?:or less|max|maximum)/i,
    /around \$?(\d+)/i,
  ];

  for (const pattern of pricePatterns) {
    const match = text.match(pattern);
    if (match) {
      requirements.push(`budget under $${match[1]}`);
      break;
    }
  }

  // Material requirements
  const materialKeywords = [
    'no plastic', 'without plastic', 'plastic-free', 'plastic free',
    'stainless steel', 'metal', 'glass', 'wooden', 'bamboo',
    'no bpa', 'bpa-free', 'bpa free',
  ];
  for (const kw of materialKeywords) {
    if (lowerText.includes(kw)) {
      requirements.push(kw);
    }
  }

  // Quality requirements
  const qualityKeywords = [
    'durable', 'reliable', 'long-lasting', 'quality',
    'professional', 'commercial grade', 'heavy duty',
  ];
  for (const kw of qualityKeywords) {
    if (lowerText.includes(kw)) {
      requirements.push(kw);
    }
  }

  // Feature requirements - look for "must have" or "need" + feature
  const featurePatterns = [
    /must have ([^.,!?]+)/gi,
    /needs? (?:to have )?([^.,!?]+)/gi,
    /with (?:a )?([^.,!?]+)/gi,
  ];

  for (const pattern of featurePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const feature = match[1].trim().toLowerCase();
      if (feature.length > 3 && feature.length < 30 && !requirements.includes(feature)) {
        requirements.push(feature);
      }
    }
  }

  // Deduplicate and limit
  const uniqueReqs = [...new Set(requirements)].slice(0, 8);

  return { query, requirements: uniqueReqs };
}

function showCaptureIndicator() {
  // Remove existing indicator if any
  const existing = document.getElementById('sift-capture-indicator');
  if (existing) {
    existing.remove();
  }

  // Create a subtle indicator that context was captured
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
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 8px;
      animation: sift-slide-in 0.3s ease-out;
    ">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Sift captured your search</span>
    </div>
    <style>
      @keyframes sift-slide-in {
        from { transform: translateX(100px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes sift-fade-out {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    </style>
  `;

  document.body.appendChild(indicator);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    indicator.style.animation = 'sift-fade-out 0.3s ease-out forwards';
    setTimeout(() => indicator.remove(), 300);
  }, 3000);
}

