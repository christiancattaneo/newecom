/**
 * ChatGPT Content Script
 * Captures ALL user prompts from ChatGPT
 */

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',

  main() {
    console.log('[Sift] ChatGPT content script loaded');
    initCapture();
  },
});

let isContextValid = true;
let lastCapturedPrompt = '';

function checkExtensionContext(): boolean {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
}

function initCapture() {
  if (!checkExtensionContext()) {
    showRefreshMessage();
    return;
  }

  // Watch for form submissions (when user sends a message)
  watchPromptSubmissions();
  
  // Also capture existing conversation on page load
  captureExistingConversation();
}

function watchPromptSubmissions() {
  // Method 1: Intercept Enter key or button click on the prompt form
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const textarea = document.querySelector('textarea[data-id], #prompt-textarea, textarea[placeholder*="Message"]') as HTMLTextAreaElement;
      if (textarea && document.activeElement === textarea) {
        const prompt = textarea.value.trim();
        if (prompt && prompt !== lastCapturedPrompt) {
          lastCapturedPrompt = prompt;
          capturePrompt(prompt);
        }
      }
    }
  }, true);

  // Method 2: Watch for clicks on send button
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const sendButton = target.closest('button[data-testid="send-button"], button[aria-label*="Send"]');
    if (sendButton) {
      const textarea = document.querySelector('textarea[data-id], #prompt-textarea, textarea[placeholder*="Message"]') as HTMLTextAreaElement;
      if (textarea) {
        const prompt = textarea.value.trim();
        if (prompt && prompt !== lastCapturedPrompt) {
          lastCapturedPrompt = prompt;
          capturePrompt(prompt);
        }
      }
    }
  }, true);

  // Method 3: MutationObserver to catch new user messages appearing
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          const userMessage = node.querySelector?.('[data-message-author-role="user"]') || 
                             (node.matches?.('[data-message-author-role="user"]') ? node : null);
          if (userMessage) {
            const text = userMessage.textContent?.trim();
            if (text && text !== lastCapturedPrompt && text.length > 3) {
              lastCapturedPrompt = text;
              capturePrompt(text);
            }
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function captureExistingConversation() {
  // Get all user messages from existing conversation
  const userMessages: string[] = [];
  document.querySelectorAll('[data-message-author-role="user"]').forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length > 3) userMessages.push(text);
  });

  if (userMessages.length > 0) {
    // Use most recent user message as the main context
    const latestPrompt = userMessages[userMessages.length - 1];
    const allPrompts = userMessages.slice(-3); // Last 3 for context
    
    console.log('[Sift] Found existing conversation:', userMessages.length, 'messages');
    capturePrompt(latestPrompt, allPrompts);
  }
}

async function capturePrompt(prompt: string, additionalContext?: string[]) {
  if (!checkExtensionContext()) {
    isContextValid = false;
    showRefreshMessage();
    return;
  }

  console.log('[Sift] Capturing prompt:', prompt.slice(0, 100));

  // Extract structured data from the prompt
  const context = parsePrompt(prompt, additionalContext);

  try {
    await browser.runtime.sendMessage({
      type: 'SAVE_CONTEXT',
      context: {
        ...context,
        timestamp: Date.now(),
        source: 'chatgpt',
      },
    });
    
    console.log('[Sift] Context saved:', context);
    showCaptureIndicator(context);
  } catch (error) {
    if (String(error).includes('Extension context invalidated')) {
      isContextValid = false;
      showRefreshMessage();
    } else {
      console.error('[Sift] Error saving context:', error);
    }
  }
}

function parsePrompt(prompt: string, additionalContext?: string[]): { 
  query: string; 
  requirements: string[]; 
  rawPrompt: string;
} {
  const allText = additionalContext ? [...additionalContext, prompt].join(' ') : prompt;
  const lowerText = allText.toLowerCase();

  // The query is the prompt itself, cleaned up
  let query = prompt
    .replace(/^(hey |hi |hello |okay |ok |so |well |um |uh |please |can you |could you |would you |i need |i want |i'm looking for |looking for |help me find |find me |recommend |what('s| is| are) the )/gi, '')
    .replace(/\?+$/, '')
    .trim();

  // Truncate if too long
  if (query.length > 100) {
    query = query.slice(0, 100).replace(/\s+\S*$/, '') + '...';
  }

  // Extract requirements
  const requirements: string[] = [];

  // Price: "under $X", "budget $X", etc.
  const priceMatch = lowerText.match(/(?:under|less than|max|budget|around)\s*\$?\s*(\d+)/i);
  if (priceMatch) {
    requirements.push(`under $${priceMatch[1]}`);
  }

  // "No X" patterns: "no plastic", "no fluoride", etc.
  const noMatches = lowerText.matchAll(/\bno\s+(\w+(?:\s+\w+)?)/gi);
  for (const match of noMatches) {
    const item = match[1].toLowerCase();
    if (item.length > 2 && !['the', 'a', 'an', 'more', 'less', 'need', 'one', 'way'].includes(item)) {
      requirements.push(`no ${item}`);
    }
  }

  // "Without X" patterns
  const withoutMatches = lowerText.matchAll(/\bwithout\s+(\w+(?:\s+\w+)?)/gi);
  for (const match of withoutMatches) {
    requirements.push(`no ${match[1].toLowerCase()}`);
  }

  // "For X" patterns: "for gaming", "for travel", etc.
  const forMatch = lowerText.match(/\bfor\s+([\w\s]+?)(?:\s+(?:that|which|under|with|and)|[,.]|$)/i);
  if (forMatch && forMatch[1].length > 2 && forMatch[1].length < 30) {
    requirements.push(`for ${forMatch[1].trim()}`);
  }

  // Quality/feature keywords
  const featureKeywords = [
    'durable', 'reliable', 'quiet', 'silent', 'fast', 'lightweight', 'portable',
    'compact', 'waterproof', 'wireless', 'bluetooth', 'premium', 'professional',
    'eco-friendly', 'organic', 'natural', 'stainless steel', 'heavy duty',
    'long lasting', 'easy to clean', 'easy to use', 'beginner friendly',
  ];
  
  for (const kw of featureKeywords) {
    if (lowerText.includes(kw) && !requirements.some(r => r.includes(kw))) {
      requirements.push(kw);
    }
  }

  return {
    query,
    requirements: [...new Set(requirements)].slice(0, 8),
    rawPrompt: prompt,
  };
}

function showRefreshMessage() {
  document.getElementById('sift-indicator')?.remove();
  
  const msg = document.createElement('div');
  msg.id = 'sift-indicator';
  msg.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #f59e0b;
      color: white;
      padding: 12px 16px;
      border-radius: 10px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 10000;
      cursor: pointer;
    " onclick="location.reload()">
      🔄 Sift: Click to refresh page
    </div>
  `;
  document.body.appendChild(msg);
}

function showCaptureIndicator(context: { query: string; requirements: string[] }) {
  document.getElementById('sift-indicator')?.remove();

  const indicator = document.createElement('div');
  indicator.id = 'sift-indicator';
  indicator.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      padding: 14px 18px;
      border-radius: 12px;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);
      z-index: 10000;
      max-width: 340px;
    ">
      <div style="font-weight: 600; margin-bottom: 8px;">✓ Sift captured</div>
      <div style="
        font-size: 12px; 
        background: rgba(0,0,0,0.15); 
        padding: 8px 10px; 
        border-radius: 6px;
        line-height: 1.4;
      ">
        ${context.query.length > 80 ? context.query.slice(0, 80) + '...' : context.query}
      </div>
      ${context.requirements.length > 0 ? `
        <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">
          ${context.requirements.slice(0, 5).map(r => 
            `<span style="
              font-size: 11px;
              background: rgba(255,255,255,0.2);
              padding: 3px 8px;
              border-radius: 4px;
            ">${r}</span>`
          ).join('')}
        </div>
      ` : ''}
    </div>
  `;

  document.body.appendChild(indicator);

  // Auto-hide after 4 seconds
  setTimeout(() => {
    indicator.style.transition = 'opacity 0.3s';
    indicator.style.opacity = '0';
    setTimeout(() => indicator.remove(), 300);
  }, 4000);
}
