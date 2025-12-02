/**
 * ChatGPT Content Script
 * Captures ENTIRE conversation - all prompts + all AI responses
 * Accumulates context over time for smarter recommendations
 */

import { quickHash, getConversationId } from '../utils/textProcessing';

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
  trackedLinks: Array<{
    url: string;
    domain: string;
    text: string;
  }>;
  lastUpdated: number;
}

let context: ConversationContext = createEmptyContext();
let isContextValid = true;

// Efficient change detection
let lastMessageHash = '';
let lastMessageCount = 0;
let lastConversationId: string | null = null;

function createEmptyContext(): ConversationContext {
  return {
    conversationId: null,
    messages: [],
    extractedQuery: '',
    extractedRequirements: [],
    mentionedProducts: [],
    trackedLinks: [],
    lastUpdated: Date.now(),
  };
}

// quickHash imported from ../utils/textProcessing

function checkExtensionContext(): boolean {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
}

// getConversationId imported from ../utils/textProcessing
// Wrapper to use with current window location
function getCurrentConversationId(): string | null {
  return getConversationId(window.location.pathname);
}

// Debounce helper to prevent cascade
let scrapeTimeout: ReturnType<typeof setTimeout> | null = null;
let hasScrapedOnce = false;

function initCapture() {
  if (!checkExtensionContext()) {
    showRefreshMessage();
    return;
  }

  const convId = getCurrentConversationId();
  context.conversationId = convId;

  console.log('[Sift] Initializing capture, conversation:', convId);

  // 1. SCRAPE EXISTING CONVERSATION - single delayed attempt (let page load first)
  setTimeout(() => {
    scrapeEntireConversation();
    if (context.messages.length > 0) {
      showCaptureIndicator('prompt');
      hasScrapedOnce = true;
    }
  }, 2000);

  // 2. WATCH FOR NEW USER PROMPTS (lightweight)
  watchUserPrompts();

  // 3. WATCH FOR URL CHANGES (switching conversations)
  watchUrlChanges();

  // 4. ONE lightweight observer for new messages (NOT on every DOM change)
  watchForNewMessages();
}

function watchForNewMessages() {
  // Only watch the main content area, not entire body
  const checkForMain = () => {
    const main = document.querySelector('main') || document.body;
    
    let lastMessageCount = 0;
    const observer = new MutationObserver(() => {
      // Debounce - only run after 500ms of no changes
      if (scrapeTimeout) clearTimeout(scrapeTimeout);
      scrapeTimeout = setTimeout(() => {
        const currentCount = document.querySelectorAll('[data-message-author-role]').length;
        // Only scrape if message count changed
        if (currentCount > lastMessageCount) {
          lastMessageCount = currentCount;
          scrapeEntireConversation();
          if (!hasScrapedOnce && context.messages.length > 0) {
            showCaptureIndicator('prompt');
            hasScrapedOnce = true;
          }
        }
      }, 500);
    });
    
    observer.observe(main, { childList: true, subtree: true });
  };

  // Wait for main to exist
  if (document.querySelector('main')) {
    checkForMain();
  } else {
    setTimeout(checkForMain, 1000);
  }
}

function scrapeEntireConversation() {
  const convId = getCurrentConversationId();
  
  // OPTIMIZATION 1: Skip if same conversation and no changes
  const messageElements = document.querySelectorAll('[data-message-author-role]');
  const currentCount = messageElements.length;
  
  // Quick check: if same conversation and same count, check hash
  if (convId === lastConversationId && currentCount === lastMessageCount) {
    // Only compute hash if counts match (hash is more expensive)
    const currentContent = Array.from(messageElements)
      .map(el => el.textContent?.slice(0, 100) || '') // Only hash first 100 chars of each message
      .join('|');
    const currentHash = quickHash(currentContent);
    
    if (currentHash === lastMessageHash) {
      console.log('[Sift] No changes detected, skipping scrape');
      return;
    }
    lastMessageHash = currentHash;
  }
  
  // OPTIMIZATION 2: Reset only if conversation actually changed
  if (convId !== lastConversationId) {
    console.log('[Sift] New conversation detected:', convId);
    context = createEmptyContext();
    context.conversationId = convId;
    lastConversationId = convId;
    lastMessageHash = '';
    lastMessageCount = 0;
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

  const totalMessages = userMessages.length + aiMessages.length;
  
  // OPTIMIZATION 3: Only log and process if there's actual content
  if (totalMessages === 0) {
    return;
  }
  
  // OPTIMIZATION 4: Skip if message count same AND we already processed this
  if (totalMessages === context.messages.length && lastMessageCount > 0) {
    console.log('[Sift] Same message count, likely no new content');
    return;
  }
  
  console.log(`[Sift] Processing ${userMessages.length} user + ${aiMessages.length} AI messages`);
  lastMessageCount = currentCount;

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

  // Update hash after successful scrape
  const newContent = Array.from(messageElements)
    .map(el => el.textContent?.slice(0, 100) || '')
    .join('|');
  lastMessageHash = quickHash(newContent);

  // Extract structured data
  extractContextFromMessages();
  
  // Save to background
  saveContext();
}

function watchUserPrompts() {
  // Watch for Enter key on textarea (lightweight - just event listeners, no observers)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const textarea = document.querySelector('#prompt-textarea, textarea[placeholder*="Message"]') as HTMLTextAreaElement;
      if (textarea && document.activeElement === textarea && textarea.value.trim()) {
        const prompt = textarea.value.trim();
        // Delay to let ChatGPT process
        setTimeout(() => addUserMessage(prompt), 100);
      }
    }
  }, true);

  // Watch for send button click
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button[data-testid="send-button"], button[aria-label*="Send"]')) {
      const textarea = document.querySelector('#prompt-textarea, textarea[placeholder*="Message"]') as HTMLTextAreaElement;
      if (textarea?.value.trim()) {
        const prompt = textarea.value.trim();
        setTimeout(() => addUserMessage(prompt), 100);
      }
    }
  }, true);
}

// Removed watchAiResponses - it was too aggressive and caused freezing
// AI responses are now captured via the debounced watchForNewMessages observer

function watchUrlChanges() {
  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    handleUrlChange();
  };

  window.addEventListener('popstate', handleUrlChange);
}

function handleUrlChange() {
  const newConvId = getCurrentConversationId();
  
  // Only act if conversation actually changed
  if (newConvId === lastConversationId) {
    console.log('[Sift] Same conversation, URL params may have changed but ignoring');
    return;
  }
  
  console.log('[Sift] Conversation changed:', lastConversationId, '→', newConvId);
  
  // Reset tracking state
  lastConversationId = newConvId;
  lastMessageHash = '';
  lastMessageCount = 0;
  hasScrapedOnce = false;
  
  // Reset context
  context = createEmptyContext();
  context.conversationId = newConvId;
  
  // Single delayed scrape (let page load)
  setTimeout(() => {
    scrapeEntireConversation();
    if (context.messages.length > 0) {
      showCaptureIndicator('prompt');
      hasScrapedOnce = true;
    }
  }, 2000);
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

  // Extract links from AI responses (shopping links ChatGPT provides)
  extractTrackedLinks();

  context.lastUpdated = Date.now();
}

function extractTrackedLinks() {
  const links: ConversationContext['trackedLinks'] = [];
  
  // Find ALL external links in AI responses
  // 1. Citation pills (the main link buttons ChatGPT shows)
  // 2. Any anchor tags with external hrefs
  const linkElements = document.querySelectorAll(
    '[data-message-author-role="assistant"] a[href^="http"], ' +
    '[data-testid="webpage-citation-pill"] a[href^="http"]'
  );

  linkElements.forEach(el => {
    const href = (el as HTMLAnchorElement).href;
    if (!href) return;
    
    try {
      const url = new URL(href);
      
      // Skip ChatGPT internal links and chatgpt.com tracking params
      if (url.hostname.includes('chatgpt.com') || 
          url.hostname.includes('openai.com') ||
          url.hostname.includes('google.com/search')) {
        return;
      }
      
      const domain = url.hostname.replace('www.', '');
      const text = el.textContent?.trim() || domain;
      
      // Clean URL (remove utm tracking params for cleaner matching)
      url.searchParams.delete('utm_source');
      url.searchParams.delete('utm_medium');
      url.searchParams.delete('utm_campaign');
      const cleanUrl = url.toString();
      
      // Avoid duplicates (by domain + path, not full URL with params)
      const urlKey = domain + url.pathname;
      if (!links.find(l => (l.domain + new URL(l.url).pathname) === urlKey)) {
        links.push({ url: cleanUrl, domain, text });
        console.log('[Sift] Found link:', domain, url.pathname.slice(0, 50));
      }
    } catch {}
  });

  context.trackedLinks = links.slice(0, 30);
  
  if (links.length > 0) {
    console.log('[Sift] Total tracked links:', links.length, links.map(l => l.domain).join(', '));
  }
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
        trackedLinks: context.trackedLinks,
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
  const linkCount = context.trackedLinks.length;
  
  indicator.innerHTML = `
    <div style="position:fixed;bottom:20px;right:20px;background:linear-gradient(135deg,#10b981,#059669);color:white;padding:14px 18px;border-radius:12px;font-family:system-ui;font-size:13px;box-shadow:0 4px 20px rgba(16,185,129,0.4);z-index:10000;max-width:340px">
      <div style="font-weight:600;margin-bottom:6px">✓ Sift tracking conversation</div>
      <div style="font-size:12px;background:rgba(0,0,0,0.15);padding:8px 10px;border-radius:6px;margin-bottom:6px">
        "${context.extractedQuery.slice(0, 60)}${context.extractedQuery.length > 60 ? '...' : ''}"
      </div>
      <div style="font-size:11px;opacity:0.9;display:flex;flex-wrap:wrap;gap:8px">
        <span>📝 ${msgCount} messages</span>
        <span>🎯 ${reqCount} requirements</span>
        ${linkCount > 0 ? `<span>🔗 ${linkCount} links tracked</span>` : ''}
      </div>
      ${context.extractedRequirements.length > 0 ? `
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
          ${context.extractedRequirements.slice(0, 4).map(r => 
            `<span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px">${r}</span>`
          ).join('')}
        </div>
      ` : ''}
      ${linkCount > 0 ? `
        <div style="margin-top:6px;font-size:10px;opacity:0.8">
          Click any ChatGPT link → Sift will analyze
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
