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
  rating?: number;        // Star rating (1-5)
  reviewCount?: number;   // Number of reviews
  inStock?: boolean;      // Availability
  features?: string[];    // Bullet point features
}

interface RankedProduct extends ProductData {
  score: number;
  reasons: string[];
  rating?: number;
  reviewCount?: number;
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
    // Wait for page to load product listings
    waitForProductsAndAnalyze(result.context);
  } else {
    console.log('[Sift] No context available - research a product in ChatGPT first');
  }

  // Listen for context updates from background
  browser.runtime.onMessage.addListener((message) => {
    console.log('[Sift] Received message:', message.type);
    if (message.type === 'CONTEXT_AVAILABLE') {
      // Context may be passed directly or we fetch it
      const context = message.context;
      if (context) {
        console.log('[Sift] Context received directly:', context.query);
        waitForProductsAndAnalyze(context);
      } else {
        browser.runtime.sendMessage({ type: 'GET_CONTEXT' }).then((ctx) => {
          if (ctx) {
            waitForProductsAndAnalyze(ctx);
          }
        });
      }
    }
  });
}

function waitForProductsAndAnalyze(context: ProductContext) {
  // Wait for product listings to appear on the page
  let attempts = 0;
  const maxAttempts = 10;
  
  const checkForProducts = () => {
    attempts++;
    const products = scrapeProducts();
    
    if (products.length > 0) {
      console.log('[Sift] Products found, analyzing...');
      analyzeCurrentPage(context);
    } else if (attempts < maxAttempts) {
      console.log(`[Sift] Waiting for products... attempt ${attempts}/${maxAttempts}`);
      setTimeout(checkForProducts, 800);
    } else {
      console.log('[Sift] No products found after waiting');
      showOverlay({ error: 'No products found. Try searching for a product.', context });
    }
  };
  
  // Start checking after initial delay
  setTimeout(checkForProducts, 1000);
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
  
  // Search results page
  const searchSelectors = [
    '[data-component-type="s-search-result"]',
    '[data-asin]:not([data-asin=""])',
    '.s-result-item[data-asin]',
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
      if (index >= 12) return; // Limit to 12 products
      
      // Skip sponsored/ad items
      if (item.querySelector('.s-label-popover-default')) return;
      
      // Title
      const titleEl = item.querySelector('h2 a span, h2 span, .a-text-normal');
      if (!titleEl) return;
      
      // Price
      const priceEl = item.querySelector('.a-price .a-offscreen');
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
      
      // Link
      const linkEl = item.querySelector('h2 a, a[href*="/dp/"]') as HTMLAnchorElement;
      const url = linkEl?.href || window.location.href;
      
      // Image
      const imageEl = item.querySelector('img.s-image') as HTMLImageElement;
      
      // ⭐ RATING - scrape star rating
      const ratingEl = item.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt, [data-cy="reviews-ratings-slot"] .a-icon-alt');
      let rating: number | undefined;
      if (ratingEl?.textContent) {
        const match = ratingEl.textContent.match(/(\d+\.?\d*)/);
        if (match) rating = parseFloat(match[1]);
      }
      
      // 📊 REVIEW COUNT - scrape number of reviews
      const reviewEl = item.querySelector('.a-size-small .a-link-normal[href*="customerReviews"], [data-cy="reviews-ratings-slot"] .a-size-base');
      let reviewCount: number | undefined;
      if (reviewEl?.textContent) {
        const countText = reviewEl.textContent.replace(/[^0-9]/g, '');
        if (countText) reviewCount = parseInt(countText);
      }
      
      // ✅ IN-STOCK - check availability
      let inStock = true;
      const stockEl = item.querySelector('.a-color-price, .a-color-secondary');
      if (stockEl?.textContent?.toLowerCase().includes('out of stock') ||
          stockEl?.textContent?.toLowerCase().includes('currently unavailable')) {
        inStock = false;
      }
      
      // 📝 FEATURES - get visible product features
      const featuresText = item.querySelector('.a-size-base-plus, .a-text-bold + span')?.textContent?.trim() || '';
      
      products.push({
        title: titleEl.textContent?.trim() || '',
        price: priceText ? parseFloat(priceText) : null,
        url,
        description: featuresText.slice(0, 300),
        imageUrl: imageEl?.src,
        rating,
        reviewCount,
        inStock,
      });
    });
  }

  // Single product page
  if (products.length === 0) {
    console.log('[Sift] Checking for single product page...');
    const title = document.querySelector('#productTitle, #title span')?.textContent?.trim();
    
    if (title) {
      // Price
      const priceSelectors = ['.a-price .a-offscreen', '#priceblock_ourprice', '.priceToPay .a-offscreen', '#corePrice_feature_div .a-offscreen'];
      let priceText = '';
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (el?.textContent) {
          priceText = el.textContent.replace(/[^0-9.]/g, '');
          break;
        }
      }
      
      // Rating
      const ratingEl = document.querySelector('#acrPopover .a-icon-alt, .reviewCountTextLinkedHistogram .a-icon-alt');
      let rating: number | undefined;
      if (ratingEl?.textContent) {
        const match = ratingEl.textContent.match(/(\d+\.?\d*)/);
        if (match) rating = parseFloat(match[1]);
      }
      
      // Review count
      const reviewEl = document.querySelector('#acrCustomerReviewText, #reviewsMedley [data-hook="total-review-count"]');
      let reviewCount: number | undefined;
      if (reviewEl?.textContent) {
        const countText = reviewEl.textContent.replace(/[^0-9]/g, '');
        if (countText) reviewCount = parseInt(countText);
      }
      
      // Stock status
      let inStock = true;
      const stockEl = document.querySelector('#availability span, #outOfStock');
      if (stockEl?.textContent?.toLowerCase().includes('out of stock') ||
          stockEl?.textContent?.toLowerCase().includes('unavailable')) {
        inStock = false;
      }
      
      // Features - get bullet points
      const features: string[] = [];
      document.querySelectorAll('#feature-bullets li span.a-list-item').forEach(li => {
        const text = li.textContent?.trim();
        if (text && text.length > 5 && text.length < 200) {
          features.push(text);
        }
      });
      
      products.push({
        title,
        price: priceText ? parseFloat(priceText) : null,
        url: window.location.href,
        description: features.slice(0, 5).join(' | '),
        imageUrl: (document.querySelector('#landingImage, #imgBlkFront') as HTMLImageElement)?.src,
        rating,
        reviewCount,
        inStock,
        features: features.slice(0, 8),
      });
    }
  }

  // Filter out of stock items
  const inStockProducts = products.filter(p => p.inStock !== false);
  console.log('[Sift] Amazon scrape: ${products.length} total, ${inStockProducts.length} in-stock');
  
  return inStockProducts.length > 0 ? inStockProducts : products;
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
    const productCards = options.products.map((p, i) => {
      const ratingStars = p.rating ? '★'.repeat(Math.floor(p.rating)) + (p.rating % 1 >= 0.5 ? '½' : '') : '';
      const reviewText = p.reviewCount ? `(${p.reviewCount.toLocaleString()})` : '';
      
      return `
      <div class="sift-product" onclick="window.open('${p.url}', '_blank')">
        <div class="sift-product-left">
          <div class="sift-rank-badge">${i + 1}</div>
          ${p.imageUrl ? `<img class="sift-product-img" src="${p.imageUrl}" alt="" />` : '<div class="sift-product-img-placeholder">📦</div>'}
        </div>
        <div class="sift-product-info">
          <div class="sift-product-title">${p.title.slice(0, 55)}${p.title.length > 55 ? '...' : ''}</div>
          <div class="sift-product-meta">
            ${p.price ? `<span class="sift-price">$${p.price.toFixed(2)}</span>` : '<span class="sift-price-na">Price N/A</span>'}
            <span class="sift-score-badge">${p.score}%</span>
          </div>
          ${p.rating ? `<div class="sift-rating"><span class="sift-stars">${ratingStars}</span> <span class="sift-rating-num">${p.rating}</span> <span class="sift-reviews">${reviewText}</span></div>` : ''}
          <div class="sift-reasons">
            ${p.reasons.slice(0, 3).map(r => `<div class="sift-reason">${r}</div>`).join('')}
          </div>
        </div>
      </div>
    `;
    }).join('');

    const reqTags = options.context.requirements.slice(0, 4).map(r => 
      `<span class="sift-req-tag">${r}</span>`
    ).join('');

    content = `
      <div class="sift-header">
        <span class="sift-logo">🎯 Sift</span>
        <span class="sift-subtitle">AI Analysis</span>
        <button class="sift-close" onclick="document.getElementById('sift-overlay').remove()">×</button>
      </div>
      <div class="sift-context">
        <div class="sift-query">"${options.context.query}"</div>
        <div class="sift-req-tags">${reqTags}</div>
      </div>
      ${options.summary ? `<div class="sift-ai-summary">💡 ${options.summary}</div>` : ''}
      <div class="sift-body">
        ${productCards}
      </div>
      <div class="sift-footer">
        <span class="sift-powered">Powered by AI</span>
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
      .sift-subtitle {
        font-size: 11px;
        color: #10b981;
        background: #0f3d0f;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: 8px;
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
      .sift-context {
        padding: 10px 16px;
        background: #16213e;
        border-bottom: 1px solid #2a2a4a;
      }
      .sift-query {
        font-size: 14px;
        font-weight: 600;
        color: #10b981;
        margin-bottom: 8px;
      }
      .sift-req-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .sift-req-tag {
        font-size: 10px;
        background: #2a2a4a;
        color: #888;
        padding: 3px 8px;
        border-radius: 12px;
      }
      .sift-ai-summary {
        padding: 10px 16px;
        background: linear-gradient(135deg, #1a3a2a 0%, #16213e 100%);
        font-size: 12px;
        color: #a7f3d0;
        border-bottom: 1px solid #2a2a4a;
        line-height: 1.4;
      }
      .sift-product {
        display: flex;
        gap: 10px;
        padding: 12px;
        background: #16213e;
        border-radius: 8px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.2s;
        border: 1px solid transparent;
      }
      .sift-product:hover {
        background: #1f2b47;
        border-color: #10b981;
        transform: translateX(2px);
      }
      .sift-product-left {
        flex-shrink: 0;
        position: relative;
        width: 60px;
      }
      .sift-rank-badge {
        position: absolute;
        top: -4px;
        left: -4px;
        width: 20px;
        height: 20px;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 11px;
        color: #fff;
        z-index: 1;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      }
      .sift-product-img {
        width: 60px;
        height: 60px;
        object-fit: contain;
        background: #fff;
        border-radius: 6px;
      }
      .sift-product-img-placeholder {
        width: 60px;
        height: 60px;
        background: #2a2a4a;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
      }
      .sift-product-info {
        flex: 1;
        min-width: 0;
      }
      .sift-product-title {
        font-size: 12px;
        font-weight: 500;
        margin-bottom: 4px;
        color: #fff;
        line-height: 1.3;
      }
      .sift-product-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .sift-price {
        font-weight: 700;
        font-size: 14px;
        color: #10b981;
      }
      .sift-score-badge {
        font-size: 11px;
        font-weight: 600;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: #fff;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .sift-price-na {
        font-size: 12px;
        color: #666;
      }
      .sift-rating {
        font-size: 11px;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .sift-stars {
        color: #fbbf24;
        letter-spacing: -1px;
      }
      .sift-rating-num {
        color: #fbbf24;
        font-weight: 600;
      }
      .sift-reviews {
        color: #666;
        font-size: 10px;
      }
      .sift-reasons {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .sift-reason {
        font-size: 11px;
        color: #a0aec0;
        line-height: 1.3;
        padding-left: 2px;
      }
      .sift-footer {
        padding: 10px 16px;
        border-top: 1px solid #2a2a4a;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .sift-powered {
        font-size: 10px;
        color: #555;
      }
      .sift-dismiss {
        background: #2a2a4a;
        border: none;
        color: #888;
        padding: 6px 14px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      .sift-dismiss:hover {
        background: #10b981;
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

