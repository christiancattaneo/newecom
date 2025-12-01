/**
 * Shopping Site Content Script
 * Displays product recommendations overlay on e-commerce sites
 */

export default defineContentScript({
  matches: [
    'https://www.amazon.com/*',
    'https://www.bestbuy.com/*',
    'https://www.target.com/*',
    'https://www.walmart.com/*',
  ],
  runAt: 'document_idle',

  main() {
    console.log('[Sift] Shopping content script loaded');
    initShoppingAssistant();
  },
});

// Types
interface ProductData {
  title: string;
  price: number | null;
  url: string;
  description: string;
  imageUrl?: string;
}

interface RankedProduct extends ProductData {
  score: number;
  reasons: string[];
}

interface ProductContext {
  query: string;
  requirements: string[];
}

// State
let overlayElement: HTMLElement | null = null;
let isAnalyzing = false;

async function initShoppingAssistant() {
  console.log('[Sift] Initializing shopping assistant on:', window.location.href);
  
  // Check if we have context from ChatGPT research
  const result = await browser.runtime.sendMessage({ type: 'CHECK_CONTEXT_EXISTS' });
  console.log('[Sift] Context check result:', result);
  
  if (result?.exists && result.context) {
    console.log('[Sift] Context found:', result.context.query);
    // Small delay to let page fully load
    setTimeout(() => analyzeCurrentPage(result.context), 1500);
  } else {
    console.log('[Sift] No context available - research a product in ChatGPT first');
  }

  // Listen for context updates
  browser.runtime.onMessage.addListener((message) => {
    console.log('[Sift] Received message:', message.type);
    if (message.type === 'CONTEXT_AVAILABLE') {
      browser.runtime.sendMessage({ type: 'GET_CONTEXT' }).then((context) => {
        if (context) {
          analyzeCurrentPage(context);
        }
      });
    }
  });
}

async function analyzeCurrentPage(context: ProductContext) {
  if (isAnalyzing) {
    console.log('[Sift] Already analyzing, skipping');
    return;
  }
  isAnalyzing = true;
  console.log('[Sift] Starting page analysis for:', context.query);

  try {
    // Show loading state
    showOverlay({ loading: true, context });

    // Scrape products from current page
    const products = scrapeProducts();
    console.log('[Sift] Scraped products:', products.length);
    
    if (products.length === 0) {
      console.log('[Sift] No products found on page');
      showOverlay({ error: 'No products found on this page. Try a search results page.', context });
      isAnalyzing = false;
      return;
    }
    
    console.log('[Sift] First product:', products[0]?.title?.slice(0, 50));

    // Get rankings from backend
    const result = await browser.runtime.sendMessage({
      type: 'RANK_PRODUCTS',
      products,
    });

    if ('error' in result) {
      showOverlay({ error: result.error, context });
    } else {
      // Combine products with rankings
      const rankedProducts: RankedProduct[] = result.rankings
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 5)
        .map((ranking: any) => ({
          ...products[ranking.index],
          score: ranking.score,
          reasons: ranking.reasons,
        }));

      showOverlay({ products: rankedProducts, context, summary: result.summary });
    }
  } catch (error) {
    console.error('[Sift] Analysis error:', error);
    showOverlay({ error: 'Failed to analyze products', context });
  } finally {
    isAnalyzing = false;
  }
}

function scrapeProducts(): ProductData[] {
  const hostname = window.location.hostname;
  
  if (hostname.includes('amazon.com')) {
    return scrapeAmazon();
  } else if (hostname.includes('bestbuy.com')) {
    return scrapeBestBuy();
  } else if (hostname.includes('target.com')) {
    return scrapeTarget();
  } else if (hostname.includes('walmart.com')) {
    return scrapeWalmart();
  }
  
  return [];
}

function scrapeAmazon(): ProductData[] {
  const products: ProductData[] = [];
  console.log('[Sift] Scraping Amazon page...');
  
  // Search results page - multiple selector strategies
  const searchSelectors = [
    '[data-component-type="s-search-result"]',
    '[data-asin]:not([data-asin=""])',
    '.s-result-item[data-asin]',
    '.sg-col-inner .s-result-item',
  ];
  
  let searchItems: NodeListOf<Element> | null = null;
  for (const selector of searchSelectors) {
    const items = document.querySelectorAll(selector);
    if (items.length > 0) {
      searchItems = items;
      console.log('[Sift] Found items with selector:', selector, 'count:', items.length);
      break;
    }
  }
  
  if (searchItems) {
    searchItems.forEach((item, index) => {
      if (index >= 10) return; // Limit to 10 products
      
      // Multiple title selectors
      const titleEl = item.querySelector('h2 a span') || 
                      item.querySelector('h2 span') ||
                      item.querySelector('.a-text-normal') ||
                      item.querySelector('[data-cy="title-recipe"] span') ||
                      item.querySelector('.a-link-normal .a-text-normal');
      
      // Multiple price selectors
      const priceEl = item.querySelector('.a-price .a-offscreen') ||
                      item.querySelector('.a-price-whole') ||
                      item.querySelector('[data-cy="price-recipe"] .a-offscreen');
      
      // Link selectors
      const linkEl = item.querySelector('h2 a') || 
                     item.querySelector('a.a-link-normal[href*="/dp/"]') ||
                     item.querySelector('a[href*="/dp/"]');
      
      const imageEl = item.querySelector('img.s-image') || item.querySelector('img[data-image-latency]');
      
      if (titleEl) {
        const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
        const url = linkEl ? (linkEl as HTMLAnchorElement).href : window.location.href;
        
        products.push({
          title: titleEl.textContent?.trim() || '',
          price: priceText ? parseFloat(priceText) : null,
          url,
          description: '',
          imageUrl: (imageEl as HTMLImageElement)?.src,
        });
      }
    });
  }

  // Single product page
  if (products.length === 0) {
    console.log('[Sift] Checking for single product page...');
    const title = document.querySelector('#productTitle')?.textContent?.trim() ||
                  document.querySelector('#title span')?.textContent?.trim();
    
    const priceSelectors = [
      '.a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice', 
      '.a-price-whole',
      '#corePrice_feature_div .a-offscreen',
      '.priceToPay .a-offscreen',
    ];
    
    let priceText = '';
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el?.textContent) {
        priceText = el.textContent.replace(/[^0-9.]/g, '');
        break;
      }
    }
    
    if (title) {
      console.log('[Sift] Found single product:', title.slice(0, 50));
      const features = document.querySelector('#feature-bullets')?.textContent?.trim() || 
                       document.querySelector('#productDescription')?.textContent?.trim() || '';
      
      products.push({
        title,
        price: priceText ? parseFloat(priceText) : null,
        url: window.location.href,
        description: features.slice(0, 500),
        imageUrl: (document.querySelector('#landingImage, #imgBlkFront') as HTMLImageElement)?.src,
      });
    }
  }

  console.log('[Sift] Amazon scrape result:', products.length, 'products');
  return products;
}

function scrapeBestBuy(): ProductData[] {
  const products: ProductData[] = [];
  
  const items = document.querySelectorAll('.sku-item, [data-sku-id]');
  
  items.forEach((item, index) => {
    if (index >= 10) return;
    
    const titleEl = item.querySelector('.sku-title a, h4.sku-header a');
    const priceEl = item.querySelector('[data-testid="customer-price"] span');
    
    if (titleEl) {
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
      
      products.push({
        title: titleEl.textContent?.trim() || '',
        price: priceText ? parseFloat(priceText) : null,
        url: (titleEl as HTMLAnchorElement).href,
        description: '',
      });
    }
  });

  return products;
}

function scrapeTarget(): ProductData[] {
  const products: ProductData[] = [];
  
  const items = document.querySelectorAll('[data-test="product-grid"] > div, [data-test="@web/ProductCard"]');
  
  items.forEach((item, index) => {
    if (index >= 10) return;
    
    const titleEl = item.querySelector('[data-test="product-title"] a, a[data-test="product-title"]');
    const priceEl = item.querySelector('[data-test="current-price"] span');
    
    if (titleEl) {
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
      
      products.push({
        title: titleEl.textContent?.trim() || '',
        price: priceText ? parseFloat(priceText) : null,
        url: (titleEl as HTMLAnchorElement).href,
        description: '',
      });
    }
  });

  return products;
}

function scrapeWalmart(): ProductData[] {
  const products: ProductData[] = [];
  
  const items = document.querySelectorAll('[data-item-id], .search-result-gridview-item');
  
  items.forEach((item, index) => {
    if (index >= 10) return;
    
    const titleEl = item.querySelector('[data-automation-id="product-title"] a, .product-title-link');
    const priceEl = item.querySelector('[data-automation-id="product-price"] .f2, .price-main .visuallyhidden');
    
    if (titleEl) {
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
      
      products.push({
        title: titleEl.textContent?.trim() || '',
        price: priceText ? parseFloat(priceText) : null,
        url: (titleEl as HTMLAnchorElement).href,
        description: '',
      });
    }
  });

  return products;
}

function showOverlay(options: {
  loading?: boolean;
  error?: string;
  products?: RankedProduct[];
  context: ProductContext;
  summary?: string;
}) {
  // Remove existing overlay
  hideOverlay();

  overlayElement = document.createElement('div');
  overlayElement.id = 'sift-overlay';
  
  let content = '';
  
  if (options.loading) {
    content = `
      <div class="sift-header">
        <span class="sift-logo">🎯 Sift</span>
        <button class="sift-close" onclick="document.getElementById('sift-overlay').remove()">×</button>
      </div>
      <div class="sift-body">
        <div class="sift-loading">
          <div class="sift-spinner"></div>
          <p>Analyzing products...</p>
          <p class="sift-context">"${options.context.query}"</p>
        </div>
      </div>
    `;
  } else if (options.error) {
    content = `
      <div class="sift-header">
        <span class="sift-logo">🎯 Sift</span>
        <button class="sift-close" onclick="document.getElementById('sift-overlay').remove()">×</button>
      </div>
      <div class="sift-body">
        <div class="sift-error">
          <p>⚠️ ${options.error}</p>
        </div>
      </div>
    `;
  } else if (options.products && options.products.length > 0) {
    const productCards = options.products.map((p, i) => `
      <div class="sift-product" onclick="window.location.href='${p.url}'">
        <div class="sift-rank">#${i + 1}</div>
        <div class="sift-product-info">
          <div class="sift-product-title">${p.title.slice(0, 60)}${p.title.length > 60 ? '...' : ''}</div>
          <div class="sift-product-meta">
            ${p.price ? `<span class="sift-price">$${p.price.toFixed(2)}</span>` : ''}
            <span class="sift-score">${p.score}% match</span>
          </div>
          <div class="sift-reasons">
            ${p.reasons.slice(0, 2).map(r => `<span class="sift-reason">✓ ${r}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');

    content = `
      <div class="sift-header">
        <span class="sift-logo">🎯 Sift</span>
        <button class="sift-close" onclick="document.getElementById('sift-overlay').remove()">×</button>
      </div>
      <div class="sift-summary">
        <span>Your search:</span> "${options.context.query}"
      </div>
      <div class="sift-body">
        ${productCards}
      </div>
      <div class="sift-footer">
        <button class="sift-dismiss" onclick="document.getElementById('sift-overlay').remove()">Dismiss</button>
      </div>
    `;
  } else {
    content = `
      <div class="sift-header">
        <span class="sift-logo">🎯 Sift</span>
        <button class="sift-close" onclick="document.getElementById('sift-overlay').remove()">×</button>
      </div>
      <div class="sift-body">
        <p>No products found to analyze on this page.</p>
      </div>
    `;
  }

  overlayElement.innerHTML = `
    <style>
      #sift-overlay {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 340px;
        max-height: 500px;
        background: #1a1a2e;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 2147483647;
        overflow: hidden;
        animation: sift-slide-up 0.3s ease-out;
        color: #e0e0e0;
      }
      @keyframes sift-slide-up {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .sift-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: linear-gradient(135deg, #16213e 0%, #1a1a2e 100%);
        border-bottom: 1px solid #2a2a4a;
      }
      .sift-logo {
        font-weight: 600;
        font-size: 16px;
        color: #fff;
      }
      .sift-close {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #888;
        padding: 0 4px;
      }
      .sift-close:hover { color: #fff; }
      .sift-summary {
        padding: 10px 16px;
        background: #16213e;
        font-size: 13px;
        color: #10b981;
        border-bottom: 1px solid #2a2a4a;
      }
      .sift-summary span { color: #888; }
      .sift-body {
        max-height: 350px;
        overflow-y: auto;
        padding: 8px;
      }
      .sift-loading {
        text-align: center;
        padding: 30px;
      }
      .sift-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid #2a2a4a;
        border-top-color: #10b981;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 12px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .sift-context {
        color: #10b981;
        font-size: 13px;
        margin-top: 8px;
      }
      .sift-error {
        padding: 20px;
        text-align: center;
        color: #f87171;
      }
      .sift-product {
        display: flex;
        gap: 12px;
        padding: 12px;
        background: #16213e;
        border-radius: 8px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: background 0.2s;
      }
      .sift-product:hover {
        background: #1f2b47;
      }
      .sift-rank {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 12px;
        color: #fff;
      }
      .sift-product-info {
        flex: 1;
        min-width: 0;
      }
      .sift-product-title {
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 4px;
        color: #fff;
      }
      .sift-product-meta {
        display: flex;
        gap: 8px;
        font-size: 12px;
        margin-bottom: 6px;
      }
      .sift-price {
        font-weight: 600;
        color: #10b981;
      }
      .sift-score {
        color: #888;
      }
      .sift-reasons {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .sift-reason {
        font-size: 11px;
        background: #0f3d0f;
        color: #4ade80;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .sift-footer {
        padding: 12px 16px;
        border-top: 1px solid #2a2a4a;
        display: flex;
        justify-content: flex-end;
      }
      .sift-dismiss {
        background: #2a2a4a;
        border: none;
        color: #888;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
      }
      .sift-dismiss:hover {
        background: #3a3a5a;
        color: #fff;
      }
    </style>
    ${content}
  `;

  document.body.appendChild(overlayElement);

  // Auto-dismiss after 15 seconds if no interaction
  setTimeout(() => {
    if (overlayElement && !options.loading) {
      overlayElement.style.animation = 'sift-fade-out 0.3s ease-out forwards';
      setTimeout(() => hideOverlay(), 300);
    }
  }, 15000);
}

function hideOverlay() {
  if (overlayElement) {
    overlayElement.remove();
    overlayElement = null;
  }
}

