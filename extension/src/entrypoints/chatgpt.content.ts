/**
 * ChatGPT Content Script
 * Captures ENTIRE conversation - all prompts + all AI responses
 * Accumulates context over time for smarter recommendations
 */

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',

  main() {
    console.log('[Sift] ChatGPT content script loaded');
    initCapture();
  },
});

// Accumulated context for current conversation
interface ConversationContext {
  conversationId: string | null;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
  extractedQuery: string;
  extractedRequirements: string[];
  mentionedProducts: string[];
  lastUpdated: number;
}

let context: ConversationContext = createEmptyContext();
let isContextValid = true;
let aiResponseObserver: MutationObserver | null = null;
let lastAiContent = '';

function createEmptyContext(): ConversationContext {
  return {
    conversationId: null,
    messages: [],
    extractedQuery: '',
    extractedRequirements: [],
    mentionedProducts: [],
    lastUpdated: Date.now(),
  };
}

function checkExtensionContext(): boolean {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
}

function getConversationId(): string | null {
  const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
  return match ? match[1] : null;
}

function initCapture() {
  if (!checkExtensionContext()) {
    showRefreshMessage();
    return;
  }

  const convId = getConversationId();
  context.conversationId = convId;

  // 1. SCRAPE ENTIRE EXISTING CONVERSATION
  console.log('[Sift] Scraping existing conversation...');
  setTimeout(() => scrapeEntireConversation(), 500);
  setTimeout(() => scrapeEntireConversation(), 2000); // Retry after page loads

  // 2. WATCH FOR NEW USER PROMPTS
  watchUserPrompts();

  // 3. WATCH FOR AI RESPONSES (real-time streaming)
  watchAiResponses();

  // 4. WATCH FOR URL CHANGES (switching conversations)
  watchUrlChanges();
}

function scrapeEntireConversation() {
  const convId = getConversationId();
  
  // Reset if conversation changed
  if (convId !== context.conversationId) {
    console.log('[Sift] New conversation detected, resetting context');
    context = createEmptyContext();
    context.conversationId = convId;
  }

  // Get ALL user messages
  const userMessages: string[] = [];
  document.querySelectorAll('[data-message-author-role="user"]').forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length > 2) userMessages.push(text);
  });

  // Get ALL AI messages
  const aiMessages: string[] = [];
  document.querySelectorAll('[data-message-author-role="assistant"] .markdown').forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length > 10) aiMessages.push(text);
  });

  console.log(`[Sift] Found ${userMessages.length} user messages, ${aiMessages.length} AI messages`);

  if (userMessages.length === 0 && aiMessages.length === 0) {
    return;
  }

  // Build message history
  context.messages = [];
  
  // Interleave messages (assume alternating user/ai)
  const maxLen = Math.max(userMessages.length, aiMessages.length);
  for (let i = 0; i < maxLen; i++) {
    if (userMessages[i]) {
      context.messages.push({
        role: 'user',
        content: userMessages[i],
        timestamp: Date.now() - (maxLen - i) * 1000,
      });
    }
    if (aiMessages[i]) {
      context.messages.push({
        role: 'assistant',
        content: aiMessages[i].slice(0, 2000), // Limit AI response length
        timestamp: Date.now() - (maxLen - i) * 1000 + 500,
      });
    }
  }

  // Extract structured data
  extractContextFromMessages();
  
  // Save to background
  saveContext();
}

function watchUserPrompts() {
  // Watch for Enter key on textarea
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const textarea = document.querySelector('#prompt-textarea, textarea[placeholder*="Message"], textarea[data-id]') as HTMLTextAreaElement;
      if (textarea && document.activeElement === textarea && textarea.value.trim()) {
        const prompt = textarea.value.trim();
        addUserMessage(prompt);
      }
    }
  }, true);

  // Watch for send button click
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button[data-testid="send-button"], button[aria-label*="Send"]')) {
      const textarea = document.querySelector('#prompt-textarea, textarea[placeholder*="Message"]') as HTMLTextAreaElement;
      if (textarea?.value.trim()) {
        addUserMessage(textarea.value.trim());
      }
    }
  }, true);

  // Watch for new user message elements appearing
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          const userMsg = node.querySelector?.('[data-message-author-role="user"]') || 
                         (node.matches?.('[data-message-author-role="user"]') ? node : null);
          if (userMsg) {
            const text = userMsg.textContent?.trim();
            if (text && text.length > 2) {
              // Check if we already have this message
              const lastUserMsg = context.messages.filter(m => m.role === 'user').pop();
              if (!lastUserMsg || lastUserMsg.content !== text) {
                addUserMessage(text);
              }
            }
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function watchAiResponses() {
  // Watch for AI response elements being updated (streaming)
  const observer = new MutationObserver((mutations) => {
    // Find the latest AI message being streamed
    const aiMessages = document.querySelectorAll('[data-message-author-role="assistant"] .markdown');
    if (aiMessages.length === 0) return;
    
    const latestAiEl = aiMessages[aiMessages.length - 1];
    const currentContent = latestAiEl.textContent?.trim() || '';
    
    // Only update if content has grown (streaming)
    if (currentContent.length > lastAiContent.length + 50) {
      lastAiContent = currentContent;
      updateLatestAiMessage(currentContent);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  aiResponseObserver = observer;
}

function watchUrlChanges() {
  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    handleUrlChange();
  };

  window.addEventListener('popstate', handleUrlChange);
}

function handleUrlChange() {
  const newConvId = getConversationId();
  if (newConvId !== context.conversationId) {
    console.log('[Sift] Conversation changed, scraping new conversation');
    context = createEmptyContext();
    context.conversationId = newConvId;
    lastAiContent = '';
    setTimeout(() => scrapeEntireConversation(), 1000);
  }
}

function addUserMessage(content: string) {
  if (!checkExtensionContext()) {
    showRefreshMessage();
    return;
  }

  // Avoid duplicates
  const lastMsg = context.messages[context.messages.length - 1];
  if (lastMsg?.role === 'user' && lastMsg.content === content) {
    return;
  }

  console.log('[Sift] Adding user message:', content.slice(0, 50));
  
  context.messages.push({
    role: 'user',
    content,
    timestamp: Date.now(),
  });

  extractContextFromMessages();
  saveContext();
  showCaptureIndicator('prompt');
}

function updateLatestAiMessage(content: string) {
  if (!checkExtensionContext()) return;

  // Find or create latest AI message
  const lastMsg = context.messages[context.messages.length - 1];
  
  if (lastMsg?.role === 'assistant') {
    // Update existing
    lastMsg.content = content.slice(0, 3000);
    lastMsg.timestamp = Date.now();
  } else {
    // Add new
    context.messages.push({
      role: 'assistant',
      content: content.slice(0, 3000),
      timestamp: Date.now(),
    });
  }

  extractContextFromMessages();
  saveContext();
}

function extractContextFromMessages() {
  const allUserText = context.messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join(' ')
    .toLowerCase();

  const allAiText = context.messages
    .filter(m => m.role === 'assistant')
    .map(m => m.content)
    .join(' ')
    .toLowerCase();

  const allText = allUserText + ' ' + allAiText;

  // Extract main query from first user message
  const firstUserMsg = context.messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    context.extractedQuery = firstUserMsg.content
      .replace(/^(what|which|can you|please|i need|i want|looking for|find me|recommend|best|top)\s+/gi, '')
      .replace(/\?+$/, '')
      .slice(0, 100)
      .trim();
  }

  // Extract requirements from ALL messages
  const requirements = new Set<string>();

  // Price patterns
  const priceMatch = allUserText.match(/(?:under|less than|budget|max|around)\s*\$?\s*(\d+)/i);
  if (priceMatch) requirements.add(`under $${priceMatch[1]}`);

  // "No X" patterns
  const noMatches = allText.matchAll(/\bno\s+(\w+(?:\s+\w+)?)/gi);
  for (const match of noMatches) {
    const item = match[1].toLowerCase();
    if (item.length > 2 && !['the', 'a', 'an', 'more', 'less', 'need', 'one', 'way', 'problem'].includes(item)) {
      requirements.add(`no ${item}`);
    }
  }

  // "Without X" patterns  
  const withoutMatches = allText.matchAll(/\bwithout\s+(\w+(?:\s+\w+)?)/gi);
  for (const match of withoutMatches) {
    requirements.add(`no ${match[1].toLowerCase()}`);
  }

  // "For X" purpose
  const forMatch = allUserText.match(/\bfor\s+([\w\s]+?)(?:\s+(?:that|which|under|with)|[,.]|$)/i);
  if (forMatch && forMatch[1].length > 2 && forMatch[1].length < 25) {
    requirements.add(`for ${forMatch[1].trim()}`);
  }

  // Feature keywords from entire conversation
  const featureKeywords = [
    'durable', 'reliable', 'quiet', 'silent', 'fast', 'lightweight', 'portable',
    'compact', 'waterproof', 'wireless', 'bluetooth', 'premium', 'professional',
    'eco-friendly', 'organic', 'natural', 'stainless steel', 'heavy duty',
    'easy to clean', 'easy to use', 'beginner', 'long lasting', 'efficient',
  ];
  
  for (const kw of featureKeywords) {
    if (allUserText.includes(kw)) requirements.add(kw);
  }

  context.extractedRequirements = [...requirements].slice(0, 12);

  // Extract mentioned products from AI responses
  const productPatterns = [
    /(?:recommend|suggest|consider|try|look at|check out)\s+(?:the\s+)?([A-Z][A-Za-z0-9\s]+?)(?:\s*[-–—]|\s*\(|\.|\,|$)/g,
    /([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){1,3})(?:\s+(?:is|are|has|offers|provides|features))/g,
  ];

  const products = new Set<string>();
  for (const pattern of productPatterns) {
    let match;
    while ((match = pattern.exec(allAiText)) !== null) {
      const product = match[1].trim();
      if (product.length > 3 && product.length < 50) {
        products.add(product);
      }
    }
  }
  context.mentionedProducts = [...products].slice(0, 10);

  context.lastUpdated = Date.now();
}

async function saveContext() {
  if (!checkExtensionContext()) {
    isContextValid = false;
    showRefreshMessage();
    return;
  }

  try {
    await browser.runtime.sendMessage({
      type: 'SAVE_CONTEXT',
      context: {
        query: context.extractedQuery,
        requirements: context.extractedRequirements,
        mentionedProducts: context.mentionedProducts,
        messageCount: context.messages.length,
        conversationId: context.conversationId,
        // Include recent messages for richer context
        recentMessages: context.messages.slice(-6).map(m => ({
          role: m.role,
          content: m.content.slice(0, 500),
        })),
        timestamp: Date.now(),
        source: 'chatgpt',
      },
    });
    
    console.log('[Sift] Context saved:', {
      query: context.extractedQuery,
      requirements: context.extractedRequirements.length,
      messages: context.messages.length,
    });
  } catch (error) {
    if (String(error).includes('Extension context invalidated')) {
      isContextValid = false;
      showRefreshMessage();
    }
  }
}

function showRefreshMessage() {
  document.getElementById('sift-indicator')?.remove();
  const msg = document.createElement('div');
  msg.id = 'sift-indicator';
  msg.innerHTML = `
    <div style="position:fixed;bottom:20px;right:20px;background:#f59e0b;color:white;padding:12px 16px;border-radius:10px;font-family:system-ui;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.2);z-index:10000;cursor:pointer" onclick="location.reload()">
      🔄 Sift: Click to refresh
    </div>`;
  document.body.appendChild(msg);
}

function showCaptureIndicator(type: 'prompt' | 'response') {
  document.getElementById('sift-indicator')?.remove();
  const indicator = document.createElement('div');
  indicator.id = 'sift-indicator';
  
  const msgCount = context.messages.length;
  const reqCount = context.extractedRequirements.length;
  
  indicator.innerHTML = `
    <div style="position:fixed;bottom:20px;right:20px;background:linear-gradient(135deg,#10b981,#059669);color:white;padding:14px 18px;border-radius:12px;font-family:system-ui;font-size:13px;box-shadow:0 4px 20px rgba(16,185,129,0.4);z-index:10000;max-width:320px">
      <div style="font-weight:600;margin-bottom:6px">✓ Sift tracking conversation</div>
      <div style="font-size:12px;background:rgba(0,0,0,0.15);padding:8px 10px;border-radius:6px;margin-bottom:6px">
        "${context.extractedQuery.slice(0, 60)}${context.extractedQuery.length > 60 ? '...' : ''}"
      </div>
      <div style="font-size:11px;opacity:0.9;display:flex;gap:12px">
        <span>📝 ${msgCount} messages</span>
        <span>🎯 ${reqCount} requirements</span>
      </div>
      ${context.extractedRequirements.length > 0 ? `
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
          ${context.extractedRequirements.slice(0, 4).map(r => 
            `<span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px">${r}</span>`
          ).join('')}
        </div>
      ` : ''}
    </div>`;

  document.body.appendChild(indicator);
  setTimeout(() => {
    indicator.style.transition = 'opacity 0.3s';
    indicator.style.opacity = '0';
    setTimeout(() => indicator.remove(), 300);
  }, 3000);
}
