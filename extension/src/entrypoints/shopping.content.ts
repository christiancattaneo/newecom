/**
 * Shopping Site Content Script
 * Displays product recommendations overlay on e-commerce sites
 */

export default defineContentScript({
  // Load on ALL https sites - AI decides what's relevant, not a hardcoded list
  matches: ['https://*/*'],
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

// Cache for scraped products (avoids re-scraping same DOM)
let cachedProducts: ProductData[] | null = null;
let cacheTime = 0;
const PRODUCT_CACHE_TTL = 2000; // 2 seconds

function getCachedOrScrapeProducts(): ProductData[] {
  const now = Date.now();
  if (cachedProducts && (now - cacheTime) < PRODUCT_CACHE_TTL) {
    return cachedProducts;
  }
  cachedProducts = scrapeProducts();
  cacheTime = now;
  return cachedProducts;
}

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
  browser.runtime.onMessage.addListener((message: { 
    type: string; 
    context?: ProductContext;
    isTrackedLink?: boolean;
    matchScore?: number;
    isHistoricalMatch?: boolean;
  }, _sender, sendResponse) => {
    // PING handler for ready check (fast path)
    if (message.type === 'PING') {
      sendResponse({ ready: true });
      return true;
    }
    
    console.log('[Sift Shopping] Received message:', message.type);
    
    // Handle scrape request from popup
    if (message.type === 'SCRAPE_PRODUCTS') {
      console.log('[Sift Shopping] Scraping products for popup...');
      const products = scrapeProducts();
      console.log('[Sift Shopping] Found', products.length, 'products');
      sendResponse({ products });
      return true;
    }
    
    if (message.type === 'CONTEXT_AVAILABLE') {
      const context = message.context;
      if (context) {
        const matchInfo = {
          isTrackedLink: message.isTrackedLink || false,
          matchScore: message.matchScore,
          isHistoricalMatch: message.isHistoricalMatch || false,
        };
        console.log('[Sift] Context received:', context.query, matchInfo);
        waitForProductsAndAnalyze(context, matchInfo);
      } else {
        browser.runtime.sendMessage({ type: 'GET_CONTEXT' }).then((ctx: ProductContext) => {
          if (ctx) {
            waitForProductsAndAnalyze(ctx);
          }
        });
      }
    }
  });
}

interface MatchInfo {
  isTrackedLink: boolean;
  matchScore?: number;
  isHistoricalMatch: boolean;
}

function waitForProductsAndAnalyze(context: ProductContext, matchInfo?: MatchInfo) {
  // First check: is this a single product page?
  const singleProduct = scrapeSingleProductPage();
  
  if (singleProduct) {
    console.log('[Sift] Single product page detected:', singleProduct.title.slice(0, 40));
    showSingleProductView(singleProduct, context, matchInfo);
    return;
  }
  
  // Immediate check for products (uses cache)
  const immediateProducts = getCachedOrScrapeProducts();
  if (immediateProducts.length > 1) {
    console.log('[Sift] Products found immediately, analyzing...');
    analyzeCurrentPage(context, matchInfo);
    return;
  } else if (immediateProducts.length === 1) {
    console.log('[Sift] Single product found, showing quick view');
    showSingleProductView(immediateProducts[0], context, matchInfo);
    return;
  }
  
  // Use MutationObserver instead of polling
  console.log('[Sift] Waiting for products via MutationObserver...');
  let resolved = false;
  const startTime = Date.now();
  const maxWaitTime = 5000; // 5 seconds max (was 8 seconds with polling)
  
  const observer = new MutationObserver(() => {
    if (resolved) return;
    
    // Check timeout
    if (Date.now() - startTime > maxWaitTime) {
      cleanup();
      handleNoProducts(context, matchInfo);
      return;
    }
    
    // Invalidate cache on mutation, then check
    cachedProducts = null;
    const products = getCachedOrScrapeProducts();
    if (products.length > 1) {
      cleanup();
      console.log('[Sift] Products detected via observer, analyzing...');
      analyzeCurrentPage(context, matchInfo);
    } else if (products.length === 1) {
      cleanup();
      console.log('[Sift] Single product detected via observer');
      showSingleProductView(products[0], context, matchInfo);
    }
  });
  
  const cleanup = () => {
    resolved = true;
    observer.disconnect();
  };
  
  // Observe main content area
  const target = document.querySelector('main') || document.body;
  observer.observe(target, { childList: true, subtree: true });
  
  // Fallback timeout (in case no mutations occur)
  setTimeout(() => {
    if (resolved) return;
    cleanup();
    
    // Final check
    const products = scrapeProducts();
    if (products.length > 1) {
      analyzeCurrentPage(context, matchInfo);
    } else if (products.length === 1) {
      showSingleProductView(products[0], context, matchInfo);
    } else {
      handleNoProducts(context, matchInfo);
    }
  }, maxWaitTime);
}

function handleNoProducts(context: ProductContext, matchInfo?: MatchInfo) {
  const lastCheck = scrapeSingleProductPage();
  if (lastCheck) {
    showSingleProductView(lastCheck, context, matchInfo);
  } else {
    console.log('[Sift] No products found');
    showOverlay({ error: 'No products found. Try searching for a product.', context, matchInfo });
  }
}

// Show a simple view for single product pages (not the full analysis)
function showSingleProductView(product: ProductData, context: ProductContext, matchInfo?: MatchInfo) {
  hideOverlay();
  
  overlayElement = document.createElement('div');
  overlayElement.id = 'sift-overlay';
  
  // Quick relevance check based on keywords
  const productText = `${product.title} ${product.description}`.toLowerCase();
  const contextText = `${context.query} ${context.requirements.join(' ')}`.toLowerCase();
  const contextWords = contextText.split(/\s+/).filter(w => w.length > 3);
  const matchedWords = contextWords.filter(w => productText.includes(w));
  const relevance = contextWords.length > 0 ? Math.round((matchedWords.length / contextWords.length) * 100) : 50;
  
  const relevanceColor = relevance >= 70 ? '#10b981' : relevance >= 40 ? '#fbbf24' : '#f87171';
  const relevanceText = relevance >= 70 ? 'Good match' : relevance >= 40 ? 'Partial match' : 'May not match';
  
  const reqTags = context.requirements.slice(0, 3).map(r => 
    `<span class="sift-req-tag">${r}</span>`
  ).join('');

  overlayElement.innerHTML = `
    <style>
      #sift-overlay {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 320px;
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
        padding: 10px 14px;
        background: linear-gradient(135deg, #16213e 0%, #1a1a2e 100%);
        border-bottom: 1px solid #2a2a4a;
      }
      .sift-logo { font-weight: 600; font-size: 15px; color: #fff; }
      .sift-badge {
        font-size: 10px;
        color: #10b981;
        background: #0f3d0f;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: 8px;
      }
      .sift-close {
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        color: #888;
        padding: 0 4px;
      }
      .sift-close:hover { color: #fff; }
      .sift-single-body {
        padding: 14px;
      }
      .sift-viewing-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #666;
        margin-bottom: 6px;
      }
      .sift-product-name {
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        margin-bottom: 8px;
        line-height: 1.3;
      }
      .sift-product-price {
        font-size: 18px;
        font-weight: 700;
        color: #10b981;
        margin-bottom: 10px;
      }
      .sift-relevance {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        padding: 8px 10px;
        background: #16213e;
        border-radius: 6px;
      }
      .sift-relevance-score {
        font-size: 12px;
        font-weight: 600;
        color: ${relevanceColor};
      }
      .sift-relevance-text {
        font-size: 11px;
        color: #888;
      }
      .sift-context-info {
        font-size: 11px;
        color: #888;
        margin-bottom: 8px;
      }
      .sift-context-query {
        color: #10b981;
        font-weight: 500;
      }
      .sift-req-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 6px;
      }
      .sift-req-tag {
        font-size: 9px;
        background: #2a2a4a;
        color: #888;
        padding: 2px 6px;
        border-radius: 8px;
      }
      .sift-footer {
        padding: 10px 14px;
        border-top: 1px solid #2a2a4a;
        display: flex;
        justify-content: flex-end;
      }
      .sift-dismiss {
        background: #2a2a4a;
        border: none;
        color: #888;
        padding: 5px 12px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.2s;
      }
      .sift-dismiss:hover {
        background: #10b981;
        color: #fff;
      }
    </style>
    <div class="sift-header">
      <span><span class="sift-logo">🎯 Sift</span><span class="sift-badge">Viewing</span></span>
      <button class="sift-close" onclick="document.getElementById('sift-overlay').remove()">×</button>
    </div>
    <div class="sift-single-body">
      <div class="sift-viewing-label">You're viewing</div>
      <div class="sift-product-name">${product.title.slice(0, 80)}${product.title.length > 80 ? '...' : ''}</div>
      ${product.price ? `<div class="sift-product-price">$${product.price.toLocaleString()}</div>` : ''}
      <div class="sift-relevance">
        <span class="sift-relevance-score">${relevance}% ${relevanceText}</span>
        <span class="sift-relevance-text">to your research</span>
      </div>
      <div class="sift-context-info">
        Researching: <span class="sift-context-query">"${context.query}"</span>
        ${reqTags ? `<div class="sift-req-tags">${reqTags}</div>` : ''}
      </div>
    </div>
    <div class="sift-footer">
      <button class="sift-dismiss" onclick="document.getElementById('sift-overlay').remove()">Got it</button>
    </div>
  `;

  document.body.appendChild(overlayElement);

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    if (overlayElement) {
      overlayElement.style.animation = 'sift-fade-out 0.3s ease-out forwards';
      setTimeout(() => hideOverlay(), 300);
    }
  }, 8000);
}

async function analyzeCurrentPage(context: ProductContext, matchInfo?: MatchInfo) {
  if (isAnalyzing) {
    console.log('[Sift] Already analyzing, skipping');
    return;
  }
  isAnalyzing = true;
  console.log('[Sift] Starting page analysis for:', context.query);

  try {
    // Show loading state
    showOverlay({ loading: true, context, matchInfo });

    // Scrape products from current page
    const products = scrapeProducts();
    console.log('[Sift] Scraped products:', products.length);
    
    if (products.length === 0) {
      console.log('[Sift] No products found on page');
      showOverlay({ error: 'No products found on this page. Try a search results page.', context, matchInfo });
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
      showOverlay({ error: result.error, context, matchInfo });
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

      showOverlay({ products: rankedProducts, context, summary: result.summary, matchInfo });
    }
  } catch (error) {
    console.error('[Sift] Analysis error:', error);
    showOverlay({ error: 'Failed to analyze products', context, matchInfo });
  } finally {
    isAnalyzing = false;
  }
}

function scrapeProducts(): ProductData[] {
  const hostname = window.location.hostname;
  
  if (hostname.includes('amazon.com') || hostname.includes('amazon.co')) {
    return scrapeAmazon();
  } else if (hostname.includes('bestbuy.com')) {
    return scrapeBestBuy();
  } else if (hostname.includes('target.com')) {
    return scrapeTarget();
  } else if (hostname.includes('walmart.com')) {
    return scrapeWalmart();
  } else if (hostname.includes('homedepot.com')) {
    return scrapeHomeDepot();
  } else if (hostname.includes('lowes.com')) {
    return scrapeLowes();
  } else {
    // Generic scraper for any other site
    return scrapeGeneric();
  }
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

function scrapeHomeDepot(): ProductData[] {
  const products: ProductData[] = [];
  console.log('[Sift] Scraping Home Depot...');
  
  // Search results
  const items = document.querySelectorAll('[data-testid="product-pod"], .browse-search__pod, .product-pod');
  
  items.forEach((item, index) => {
    if (index >= 10) return;
    
    const titleEl = item.querySelector('[data-testid="product-header"] a, .product-title, a.product-header__title');
    const priceEl = item.querySelector('[data-testid="price-format"] span, .price-format__main-price, .price__dollars');
    const ratingEl = item.querySelector('[data-testid="ratings"] span, .ratings__average');
    const reviewEl = item.querySelector('[data-testid="ratings-count"], .ratings__count');
    const imageEl = item.querySelector('img[data-testid="product-image"], img.product-image') as HTMLImageElement;
    
    if (titleEl) {
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
      let rating: number | undefined;
      if (ratingEl?.textContent) {
        const match = ratingEl.textContent.match(/(\d+\.?\d*)/);
        if (match) rating = parseFloat(match[1]);
      }
      let reviewCount: number | undefined;
      if (reviewEl?.textContent) {
        const countText = reviewEl.textContent.replace(/[^0-9]/g, '');
        if (countText) reviewCount = parseInt(countText);
      }
      
      products.push({
        title: titleEl.textContent?.trim() || '',
        price: priceText ? parseFloat(priceText) : null,
        url: (titleEl as HTMLAnchorElement).href || window.location.href,
        description: '',
        imageUrl: imageEl?.src,
        rating,
        reviewCount,
        inStock: true,
      });
    }
  });

  // Single product page
  if (products.length === 0) {
    const title = document.querySelector('h1.product-details__title, [data-testid="product-title"]')?.textContent?.trim();
    if (title) {
      const priceEl = document.querySelector('[data-testid="price-format"], .price-format__main-price');
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
      
      products.push({
        title,
        price: priceText ? parseFloat(priceText) : null,
        url: window.location.href,
        description: document.querySelector('[data-testid="product-description"]')?.textContent?.trim() || '',
        imageUrl: (document.querySelector('[data-testid="product-image"] img, .mediagallery__mainimage img') as HTMLImageElement)?.src,
      });
    }
  }

  return products;
}

function scrapeLowes(): ProductData[] {
  const products: ProductData[] = [];
  console.log('[Sift] Scraping Lowes...');
  
  const items = document.querySelectorAll('[data-selector="splp-prd-pod"], .product-card');
  
  items.forEach((item, index) => {
    if (index >= 10) return;
    
    const titleEl = item.querySelector('a[data-selector="splp-prd-title"], .product-title a');
    const priceEl = item.querySelector('[data-selector="splp-prd-act-$"], .art-pd-price');
    
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

// Generic scraper for ANY site - multiple strategies for finding products
function scrapeGeneric(): ProductData[] {
  console.log('[Sift] Using generic scraper for:', window.location.hostname);
  
  // Strategy 1: Single product page detection
  const singleProduct = scrapeSingleProductPage();
  if (singleProduct) {
    console.log('[Sift] Found single product page');
    return [singleProduct];
  }
  
  // Strategy 2: Look for common product card patterns
  let products = scrapeByProductCards();
  if (products.length >= 2) {
    console.log('[Sift] Found products via card patterns:', products.length);
    return products;
  }
  
  // Strategy 3: Find elements with prices and work backwards
  products = scrapeByPriceElements();
  if (products.length >= 2) {
    console.log('[Sift] Found products via price detection:', products.length);
    return products;
  }
  
  // Strategy 4: Look for repeated list structures (li, article, div grids)
  products = scrapeByRepeatedElements();
  if (products.length >= 2) {
    console.log('[Sift] Found products via repeated elements:', products.length);
    return products;
  }
  
  // Strategy 5: Find links with images (likely product cards)
  products = scrapeByImageLinks();
  if (products.length >= 2) {
    console.log('[Sift] Found products via image links:', products.length);
    return products;
  }

  console.log('[Sift] Generic scrape found:', products.length, 'products');
  return products;
}

function scrapeByProductCards(): ProductData[] {
  const products: ProductData[] = [];
  
  const productSelectors = [
    '[data-product]', '[data-sku]', '[data-item]', '[data-id]',
    '.product-card', '.product-item', '.product-tile', '.product',
    '[class*="product-card"]', '[class*="productCard"]', '[class*="ProductCard"]',
    '[class*="product-item"]', '[class*="productItem"]',
    'article[class*="product"]', 'div[class*="product"]',
    '.sku-item', '.search-result-item', '.listing-item',
    '.item-card', '.card', '[class*="listing"]',
    '.vehicle-card', '.car-card', '[class*="vehicle"]', '[class*="listing-card"]',
  ];
  
  for (const selector of productSelectors) {
    try {
      const items = document.querySelectorAll(selector);
      if (items.length >= 2) {
        console.log('[Sift] Trying selector:', selector, 'found:', items.length);
        items.forEach((item, index) => {
          if (index >= 12) return;
          const product = extractProductFromElement(item);
          if (product) products.push(product);
        });
        if (products.length >= 2) break;
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }
  
  return products;
}

function scrapeByPriceElements(): ProductData[] {
  const products: ProductData[] = [];
  const seen = new Set<string>();
  
  // Find all elements containing price patterns
  const allElements = document.querySelectorAll('*');
  const priceElements: Element[] = [];
  
  allElements.forEach(el => {
    const text = el.textContent || '';
    // Look for price patterns: $X,XXX or $XXX.XX
    if (/\$[\d,]+\.?\d*/.test(text) && text.length < 50) {
      // Check if this is a leaf or near-leaf element
      if (el.children.length <= 2) {
        priceElements.push(el);
      }
    }
  });
  
  console.log('[Sift] Found price elements:', priceElements.length);
  
  // For each price, find the containing product card
  for (const priceEl of priceElements.slice(0, 20)) {
    // Walk up to find a reasonable container
    let container = priceEl.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      // Good container if it has both a link and the price
      const hasLink = container.querySelector('a[href]');
      const hasImage = container.querySelector('img');
      const hasHeading = container.querySelector('h1, h2, h3, h4, h5, a');
      
      if (hasLink && (hasImage || hasHeading)) {
        const product = extractProductFromElement(container);
        if (product && !seen.has(product.title.toLowerCase())) {
          seen.add(product.title.toLowerCase());
          products.push(product);
        }
        break;
      }
      container = container.parentElement;
    }
    
    if (products.length >= 10) break;
  }
  
  return products;
}

function scrapeByRepeatedElements(): ProductData[] {
  const products: ProductData[] = [];
  
  // Find grids/lists that might contain products
  const gridSelectors = [
    'ul > li', 'ol > li',
    '[class*="grid"] > div', '[class*="Grid"] > div',
    '[class*="list"] > div', '[class*="List"] > div',
    '[class*="results"] > div', '[class*="Results"] > div',
    'main article', 'section article',
    '[role="list"] > *', '[role="listitem"]',
  ];
  
  for (const selector of gridSelectors) {
    try {
      const items = document.querySelectorAll(selector);
      // Need at least 3 similar items
      if (items.length >= 3) {
        // Check if items have similar structure (likely products)
        let validCount = 0;
        items.forEach((item, index) => {
          if (index >= 12) return;
          const hasPrice = (item.textContent || '').includes('$');
          const hasLink = item.querySelector('a');
          if (hasPrice && hasLink) validCount++;
        });
        
        if (validCount >= 3) {
          console.log('[Sift] Found repeated structure:', selector, 'valid:', validCount);
          items.forEach((item, index) => {
            if (index >= 12) return;
            const product = extractProductFromElement(item);
            if (product) products.push(product);
          });
        }
        
        if (products.length >= 3) break;
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }
  
  return products;
}

function scrapeByImageLinks(): ProductData[] {
  const products: ProductData[] = [];
  const seen = new Set<string>();
  
  // Find all links that contain images (likely product cards)
  const imageLinks = document.querySelectorAll('a img');
  
  imageLinks.forEach((img, index) => {
    if (index >= 20 || products.length >= 10) return;
    
    // Find the parent link
    const link = img.closest('a') as HTMLAnchorElement;
    if (!link || !link.href || link.href === '#') return;
    
    // Find a reasonable container
    let container = link.parentElement;
    for (let i = 0; i < 3 && container; i++) {
      const hasPrice = (container.textContent || '').includes('$');
      if (hasPrice) {
        const product = extractProductFromElement(container);
        if (product && !seen.has(product.url)) {
          seen.add(product.url);
          products.push(product);
        }
        break;
      }
      container = container.parentElement;
    }
  });
  
  return products;
}

function extractProductFromElement(element: Element): ProductData | null {
  // Find title - prioritize headings, then links
  let title = '';
  const titleSelectors = [
    'h1', 'h2', 'h3', 'h4', 'h5',
    '[class*="title"]', '[class*="Title"]', '[class*="name"]', '[class*="Name"]',
    'a[href]',
  ];
  
  for (const sel of titleSelectors) {
    const el = element.querySelector(sel);
    if (el?.textContent?.trim() && el.textContent.trim().length > 3) {
      title = el.textContent.trim();
      // Clean up title - remove price if included
      title = title.replace(/\$[\d,]+\.?\d*/g, '').trim();
      if (title.length > 5 && title.length < 200) break;
    }
  }
  
  if (!title || title.length < 5) return null;
  
  // Find price
  let price: number | null = null;
  const text = element.textContent || '';
  const priceMatch = text.match(/\$\s*([\d,]+\.?\d*)/);
  if (priceMatch) {
    price = parseFloat(priceMatch[1].replace(/,/g, ''));
  }
  
  // Find URL
  let url = window.location.href;
  const linkEl = element.querySelector('a[href]') as HTMLAnchorElement;
  if (linkEl?.href && linkEl.href !== '#' && !linkEl.href.startsWith('javascript:')) {
    url = linkEl.href;
  }
  
  // Find image
  let imageUrl: string | undefined;
  const imgEl = element.querySelector('img') as HTMLImageElement;
  if (imgEl?.src && !imgEl.src.includes('data:') && !imgEl.src.includes('placeholder')) {
    imageUrl = imgEl.src;
  }
  
  // Get any description text
  const descEl = element.querySelector('[class*="desc"], [class*="Desc"], p');
  const description = descEl?.textContent?.trim().slice(0, 300) || '';
  
  return {
    title: title.slice(0, 150),
    price,
    url,
    description,
    imageUrl,
  };
}

function scrapeSingleProductPage(): ProductData | null {
  // Detect if this is a single product page by looking for key indicators
  const url = window.location.href.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();
  
  // Check URL patterns that suggest single product
  const productUrlPatterns = [
    /\/product\//i, /\/p\//i, /\/dp\//i, /\/item\//i,
    /\/vehicle\//i, /\/car\//i, /\/inventory\//i,
    /\/listing\//i, /\/detail/i, /\/view\//i,
    /[\/-]\d{4,}/, // ID in URL
  ];
  
  const isLikelyProductPage = productUrlPatterns.some(p => p.test(pathname));
  
  // Title selectors - look for main heading
  const titleSelectors = [
    'h1[class*="product"]', 'h1[class*="Product"]', 'h1[class*="title"]',
    'h1[class*="name"]', 'h1[class*="Name"]', 'h1[class*="heading"]',
    'h1[data-testid*="product"]', 'h1[data-testid*="title"]',
    '[class*="product-title"]', '[class*="productTitle"]',
    '[class*="vehicle-title"]', '[class*="listing-title"]',
    '[itemprop="name"]', '#productTitle', '.product-name h1',
    'main h1', 'article h1', // Generic fallbacks
  ];
  
  let title = '';
  for (const sel of titleSelectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim() && el.textContent.trim().length > 5) {
      title = el.textContent.trim();
      break;
    }
  }
  
  // Fallback: just grab the first h1 if on a product-like URL
  if (!title && isLikelyProductPage) {
    const h1 = document.querySelector('h1');
    if (h1?.textContent?.trim()) {
      title = h1.textContent.trim();
    }
  }
  
  if (!title || title.length < 5) return null;
  
  // Find price - search entire page for price patterns
  let price: number | null = null;
  const priceSelectors = [
    '[class*="price"]:not([class*="prices"])', '[itemprop="price"]',
    '[data-testid*="price"]', '.product-price', '#priceblock',
    '[class*="Price"]', '.price', '#price',
    '[class*="cost"]', '[class*="amount"]',
  ];
  
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el?.textContent) {
      const match = el.textContent.match(/\$\s*([\d,]+\.?\d*)/);
      if (match) {
        price = parseFloat(match[1].replace(/,/g, ''));
        break;
      }
    }
  }
  
  // Fallback: search body text for first price-like number
  if (!price) {
    const bodyText = document.body.textContent || '';
    const priceMatch = bodyText.match(/\$\s*([\d,]+\.?\d*)/);
    if (priceMatch) {
      price = parseFloat(priceMatch[1].replace(/,/g, ''));
    }
  }
  
  // Find image - main product/hero image
  const imageSelectors = [
    '[class*="product-image"] img', '[class*="productImage"] img',
    '[class*="hero"] img', '[class*="main-image"] img',
    '[class*="gallery"] img:first-child', '[class*="Gallery"] img:first-child',
    '[data-testid*="product-image"] img', '#product-image img',
    'img[itemprop="image"]', 'main img', 'article img',
  ];
  
  let imageUrl = '';
  for (const sel of imageSelectors) {
    const el = document.querySelector(sel) as HTMLImageElement;
    if (el?.src && !el.src.includes('data:') && !el.src.includes('placeholder') && el.width > 100) {
      imageUrl = el.src;
      break;
    }
  }
  
  // Fallback: largest image on page
  if (!imageUrl) {
    let largestImg: HTMLImageElement | null = null;
    let maxArea = 0;
    document.querySelectorAll('img').forEach((img: HTMLImageElement) => {
      const area = (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
      if (area > maxArea && img.src && !img.src.includes('data:')) {
        maxArea = area;
        largestImg = img;
      }
    });
    if (largestImg && maxArea > 10000) {
      imageUrl = (largestImg as HTMLImageElement).src;
    }
  }
  
  // Find description
  const descSelectors = [
    '[class*="description"]', '[itemprop="description"]',
    '[data-testid*="description"]', '#product-description',
    '[class*="details"]', '[class*="specs"]', '[class*="overview"]',
    'main p', 'article p',
  ];
  
  let description = '';
  for (const sel of descSelectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim() && el.textContent.trim().length > 20) {
      description = el.textContent.trim().slice(0, 500);
      break;
    }
  }

  console.log('[Sift] Found single product:', title.slice(0, 50), 'Price:', price);
  
  return {
    title: title.slice(0, 200),
    price,
    url: window.location.href,
    description,
    imageUrl,
  };
}

function showOverlay(options: {
  loading?: boolean;
  error?: string;
  products?: RankedProduct[];
  context: ProductContext;
  summary?: string;
  matchInfo?: MatchInfo;
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

    const matchBadge = options.matchInfo?.isHistoricalMatch 
      ? `<span class="sift-match-badge">📚 From your research history</span>`
      : options.matchInfo?.isTrackedLink 
        ? `<span class="sift-match-badge">🔗 From ChatGPT link</span>`
        : '';

    content = `
      <div class="sift-header">
        <span class="sift-logo">🎯 Sift</span>
        <span class="sift-subtitle">AI Analysis</span>
        <button class="sift-close" onclick="document.getElementById('sift-overlay').remove()">×</button>
      </div>
      ${matchBadge ? `<div class="sift-match-info">${matchBadge}</div>` : ''}
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
      .sift-match-info {
        padding: 8px 16px;
        background: linear-gradient(135deg, #1e3a5f 0%, #16213e 100%);
        border-bottom: 1px solid #2a2a4a;
      }
      .sift-match-badge {
        font-size: 11px;
        color: #60a5fa;
        display: flex;
        align-items: center;
        gap: 6px;
      }
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

