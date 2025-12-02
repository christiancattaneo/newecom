/**
 * Tests for recently added features
 * Run: npm test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// ============================================
// TEST UTILITIES
// ============================================

const setupDOM = (html: string, url = 'https://example.com') => {
  const dom = new JSDOM(html, { url });
  global.document = dom.window.document;
  global.window = dom.window as any;
  return dom;
};

// ============================================
// 1. LINK TRACKING EXTRACTION
// ============================================

describe('Feature: Link Tracking from ChatGPT', () => {
  function extractTrackedLinks(): Array<{ url: string; domain: string; text: string }> {
    const links: Array<{ url: string; domain: string; text: string }> = [];
    
    const linkElements = document.querySelectorAll(
      '[data-message-author-role="assistant"] a[href^="http"], ' +
      '[data-testid="webpage-citation-pill"] a[href^="http"]'
    );

    linkElements.forEach(el => {
      const href = (el as HTMLAnchorElement).href;
      if (!href) return;
      
      try {
        const url = new URL(href);
        
        if (url.hostname.includes('chatgpt.com') || 
            url.hostname.includes('openai.com') ||
            url.hostname.includes('google.com/search')) {
          return;
        }
        
        const domain = url.hostname.replace('www.', '');
        const text = el.textContent?.trim() || domain;
        
        url.searchParams.delete('utm_source');
        const cleanUrl = url.toString();
        
        const urlKey = domain + url.pathname;
        if (!links.find(l => (l.domain + new URL(l.url).pathname) === urlKey)) {
          links.push({ url: cleanUrl, domain, text });
        }
      } catch {}
    });

    return links;
  }

  it('should extract links from AI responses', () => {
    setupDOM(`
      <div data-message-author-role="assistant">
        <a href="https://www.amazon.com/dp/B123">Amazon Product</a>
        <a href="https://homedepot.com/p/water-filter/123">Home Depot Link</a>
      </div>
    `);
    
    const links = extractTrackedLinks();
    expect(links.length).toBe(2);
    expect(links[0].domain).toBe('amazon.com');
    expect(links[1].domain).toBe('homedepot.com');
  });

  it('should extract links from citation pills', () => {
    setupDOM(`
      <div data-testid="webpage-citation-pill">
        <a href="https://www.supplyhouse.com/product/123">SupplyHouse</a>
      </div>
    `);
    
    const links = extractTrackedLinks();
    expect(links.length).toBe(1);
    expect(links[0].domain).toBe('supplyhouse.com');
  });

  it('should skip ChatGPT internal links', () => {
    setupDOM(`
      <div data-message-author-role="assistant">
        <a href="https://chatgpt.com/share/123">Share link</a>
        <a href="https://openai.com/policies">OpenAI policy</a>
        <a href="https://amazon.com/dp/B123">Valid product</a>
      </div>
    `);
    
    const links = extractTrackedLinks();
    expect(links.length).toBe(1);
    expect(links[0].domain).toBe('amazon.com');
  });

  it('should remove UTM tracking params', () => {
    setupDOM(`
      <div data-message-author-role="assistant">
        <a href="https://amazon.com/dp/B123?utm_source=chatgpt&ref=abc">Product</a>
      </div>
    `);
    
    const links = extractTrackedLinks();
    expect(links[0].url).not.toContain('utm_source');
    expect(links[0].url).toContain('ref=abc');
  });

  it('should deduplicate links by domain+path', () => {
    setupDOM(`
      <div data-message-author-role="assistant">
        <a href="https://amazon.com/dp/B123?ref=1">First</a>
        <a href="https://amazon.com/dp/B123?ref=2">Second</a>
        <a href="https://amazon.com/dp/B456">Different product</a>
      </div>
    `);
    
    const links = extractTrackedLinks();
    expect(links.length).toBe(2);
  });

  it('should handle any external domain', () => {
    setupDOM(`
      <div data-message-author-role="assistant">
        <a href="https://random-water-store.com/filters/123">Random Store</a>
        <a href="https://obscure-retailer.co.uk/products/xyz">UK Retailer</a>
      </div>
    `);
    
    const links = extractTrackedLinks();
    expect(links.length).toBe(2);
    expect(links[0].domain).toBe('random-water-store.com');
    expect(links[1].domain).toBe('obscure-retailer.co.uk');
  });
});

// ============================================
// 2. URL MATCHING FOR TRACKED LINKS
// ============================================

describe('Feature: URL Matching for Tracked Links', () => {
  interface TrackedLink { url: string; domain: string; text: string }
  
  function isTrackedLink(currentUrl: string, trackedLinks: TrackedLink[]): TrackedLink | undefined {
    return trackedLinks.find(link => {
      try {
        const trackedUrl = new URL(link.url);
        const current = new URL(currentUrl);
        const trackedDomain = trackedUrl.hostname.replace('www.', '');
        const currentDomain = current.hostname.replace('www.', '');
        return currentDomain.includes(trackedDomain) || trackedDomain.includes(currentDomain);
      } catch {
        return false;
      }
    });
  }

  it('should match exact domain', () => {
    const trackedLinks = [
      { url: 'https://amazon.com/dp/B123', domain: 'amazon.com', text: 'Product' }
    ];
    
    const match = isTrackedLink('https://www.amazon.com/dp/B456', trackedLinks);
    expect(match).toBeDefined();
    expect(match?.domain).toBe('amazon.com');
  });

  it('should match subdomain variations', () => {
    const trackedLinks = [
      { url: 'https://www.homedepot.com/p/123', domain: 'homedepot.com', text: 'HD' }
    ];
    
    expect(isTrackedLink('https://homedepot.com/browse', trackedLinks)).toBeDefined();
    expect(isTrackedLink('https://www.homedepot.com/search', trackedLinks)).toBeDefined();
  });

  it('should not match different domains', () => {
    const trackedLinks = [
      { url: 'https://amazon.com/dp/B123', domain: 'amazon.com', text: 'Product' }
    ];
    
    expect(isTrackedLink('https://bestbuy.com/products', trackedLinks)).toBeUndefined();
    expect(isTrackedLink('https://google.com/search', trackedLinks)).toBeUndefined();
  });

  it('should match any page on tracked domain', () => {
    const trackedLinks = [
      { url: 'https://supplyhouse.com/specific-product', domain: 'supplyhouse.com', text: 'Product' }
    ];
    
    // User might navigate to different page on same site
    expect(isTrackedLink('https://www.supplyhouse.com/', trackedLinks)).toBeDefined();
    expect(isTrackedLink('https://supplyhouse.com/category/filters', trackedLinks)).toBeDefined();
  });
});

// ============================================
// 3. GENERIC SCRAPER
// ============================================

describe('Feature: Generic Scraper', () => {
  interface ProductData {
    title: string;
    price: number | null;
    url: string;
    description: string;
    imageUrl?: string;
  }

  function scrapeGeneric(): ProductData[] {
    const products: ProductData[] = [];
    
    // Single product page
    const singleProduct = scrapeSingleProductPage();
    if (singleProduct) {
      products.push(singleProduct);
      return products;
    }
    
    // Product cards
    const productSelectors = [
      '[data-product]', '[data-sku]', '[data-item]',
      '.product-card', '.product-item', '.product-tile',
    ];
    
    for (const selector of productSelectors) {
      const items = document.querySelectorAll(selector);
      if (items.length >= 2) {
        items.forEach((item, index) => {
          if (index >= 10) return;
          
          const titleEl = item.querySelector('h2, h3, h4, a[class*="title"], [class*="name"]');
          if (!titleEl) return;
          
          let priceText = '';
          const priceEl = item.querySelector('[class*="price"], .price');
          if (priceEl?.textContent) {
            const match = priceEl.textContent.match(/\$?([\d,]+\.?\d*)/);
            if (match) priceText = match[1].replace(',', '');
          }
          
          const linkEl = item.querySelector('a') as HTMLAnchorElement;
          const imageEl = item.querySelector('img') as HTMLImageElement;
          
          products.push({
            title: titleEl.textContent?.trim() || '',
            price: priceText ? parseFloat(priceText) : null,
            url: linkEl?.href || window.location.href,
            description: '',
            imageUrl: imageEl?.src,
          });
        });
        
        if (products.length > 0) break;
      }
    }

    return products;
  }

  function scrapeSingleProductPage(): ProductData | null {
    const titleSelectors = [
      'h1[class*="product"]', '[class*="product-title"]',
      '[itemprop="name"]', '#productTitle',
    ];
    
    let title = '';
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) {
        title = el.textContent.trim();
        break;
      }
    }
    
    if (!title) return null;
    
    let price: number | null = null;
    const priceEl = document.querySelector('[class*="price"], [itemprop="price"]');
    if (priceEl?.textContent) {
      const match = priceEl.textContent.match(/\$?([\d,]+\.?\d*)/);
      if (match) price = parseFloat(match[1].replace(',', ''));
    }

    return { title, price, url: window.location.href, description: '' };
  }

  it('should scrape product cards with data-product attribute', () => {
    setupDOM(`
      <div data-product="1">
        <h3>Product A</h3>
        <span class="price">$29.99</span>
        <a href="/product/a">Link</a>
      </div>
      <div data-product="2">
        <h3>Product B</h3>
        <span class="price">$49.99</span>
        <a href="/product/b">Link</a>
      </div>
    `);
    
    const products = scrapeGeneric();
    expect(products.length).toBe(2);
    expect(products[0].title).toBe('Product A');
    expect(products[0].price).toBe(29.99);
    expect(products[1].title).toBe('Product B');
    expect(products[1].price).toBe(49.99);
  });

  it('should scrape product cards with class names', () => {
    setupDOM(`
      <div class="product-card">
        <h2>Water Filter Pro</h2>
        <div class="price-container">$79.00</div>
      </div>
      <div class="product-card">
        <h2>Filter Deluxe</h2>
        <div class="price-container">$99.00</div>
      </div>
    `);
    
    const products = scrapeGeneric();
    expect(products.length).toBe(2);
  });

  it('should detect single product page', () => {
    setupDOM(`
      <h1 class="product-title">Premium Water Filtration System</h1>
      <div class="price">$199.99</div>
      <div class="description">High quality water filter</div>
    `);
    
    const products = scrapeGeneric();
    expect(products.length).toBe(1);
    expect(products[0].title).toBe('Premium Water Filtration System');
    expect(products[0].price).toBe(199.99);
  });

  it('should handle prices with commas', () => {
    setupDOM(`
      <h1 class="product-title">Expensive Item</h1>
      <div class="price">$1,299.99</div>
    `);
    
    const products = scrapeGeneric();
    expect(products[0].price).toBe(1299.99);
  });

  it('should return empty array for non-product pages', () => {
    setupDOM(`
      <div>
        <h1>About Us</h1>
        <p>We are a company</p>
      </div>
    `);
    
    const products = scrapeGeneric();
    expect(products.length).toBe(0);
  });
});

// ============================================
// 4. HOME DEPOT SCRAPER
// ============================================

describe('Feature: Home Depot Scraper', () => {
  interface ProductData {
    title: string;
    price: number | null;
    url: string;
    imageUrl?: string;
    rating?: number;
    reviewCount?: number;
  }

  function scrapeHomeDepot(): ProductData[] {
    const products: ProductData[] = [];
    
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
          url: (titleEl as HTMLAnchorElement).href || '',
          imageUrl: imageEl?.src,
          rating,
          reviewCount,
        });
      }
    });

    return products;
  }

  it('should scrape Home Depot search results', () => {
    setupDOM(`
      <div class="product-pod">
        <a class="product-title" href="/p/water-filter/123">
          Whole House Water Filter
        </a>
        <span class="price-format__main-price">$299</span>
        <span class="ratings__average">4.5</span>
        <span class="ratings__count">(1,234)</span>
      </div>
      <div class="product-pod">
        <a class="product-title" href="/p/filter-cartridge/456">
          Replacement Filter
        </a>
        <span class="price-format__main-price">$49</span>
      </div>
    `, 'https://www.homedepot.com/s/water%20filter');
    
    const products = scrapeHomeDepot();
    expect(products.length).toBe(2);
    expect(products[0].title).toContain('Whole House Water Filter');
    expect(products[0].price).toBe(299);
    expect(products[0].rating).toBe(4.5);
    expect(products[0].reviewCount).toBe(1234);
  });

  it('should handle missing ratings', () => {
    setupDOM(`
      <div class="product-pod">
        <a class="product-title" href="/p/new-product/789">
          New Product No Reviews
        </a>
        <span class="price-format__main-price">$99</span>
      </div>
    `);
    
    const products = scrapeHomeDepot();
    expect(products.length).toBe(1);
    expect(products[0].rating).toBeUndefined();
    expect(products[0].reviewCount).toBeUndefined();
  });
});

// ============================================
// 5. REQUIREMENT EXTRACTION
// ============================================

describe('Feature: Requirement Extraction', () => {
  function extractRequirements(userText: string, fullText: string): string[] {
    const requirements: string[] = [];
    const allText = (userText + ' ' + fullText).toLowerCase();

    // Price patterns
    const priceMatch = userText.match(/(?:under|less than|budget|max|around)\s*\$?\s*(\d+)/i);
    if (priceMatch) requirements.push(`under $${priceMatch[1]}`);

    // "No X" patterns - capture single word only to avoid "no fluoride and"
    const noMatches = allText.matchAll(/\bno\s+(\w+)/gi);
    for (const match of noMatches) {
      const item = match[1].toLowerCase();
      if (item.length > 2 && !['the', 'a', 'an', 'more', 'less', 'need', 'one', 'way', 'problem', 'and', 'or'].includes(item)) {
        requirements.push(`no ${item}`);
      }
    }

    // "Without X" patterns  
    const withoutMatches = allText.matchAll(/\bwithout\s+(\w+)/gi);
    for (const match of withoutMatches) {
      const item = match[1].toLowerCase();
      if (!['the', 'a', 'an'].includes(item)) {
        requirements.push(`no ${item}`);
      }
    }

    // Feature keywords
    const featureKeywords = ['durable', 'reliable', 'quiet', 'wireless', 'portable', 'waterproof'];
    for (const kw of featureKeywords) {
      if (userText.toLowerCase().includes(kw)) requirements.push(kw);
    }

    return [...new Set(requirements)];
  }

  it('should extract budget requirements', () => {
    const reqs = extractRequirements('looking for headphones under $100', '');
    expect(reqs).toContain('under $100');
  });

  it('should extract "no X" requirements', () => {
    const reqs = extractRequirements('water filter with no fluoride and no chlorine', '');
    expect(reqs).toContain('no fluoride');
    expect(reqs).toContain('no chlorine');
  });

  it('should extract "without X" requirements', () => {
    const reqs = extractRequirements('shower filter without plastic components', '');
    expect(reqs).toContain('no plastic');
  });

  it('should extract feature keywords', () => {
    const reqs = extractRequirements('need durable and waterproof speaker', '');
    expect(reqs).toContain('durable');
    expect(reqs).toContain('waterproof');
  });

  it('should deduplicate requirements', () => {
    const reqs = extractRequirements('no fluoride no fluoride no fluoride', '');
    const fluorideCount = reqs.filter(r => r === 'no fluoride').length;
    expect(fluorideCount).toBe(1);
  });

  it('should skip common words', () => {
    const reqs = extractRequirements('no problem, no need to worry', '');
    expect(reqs).not.toContain('no problem');
    expect(reqs).not.toContain('no need');
  });
});

// ============================================
// 6. CONTEXT ACCUMULATION
// ============================================

describe('Feature: Context Accumulation', () => {
  interface Message { role: 'user' | 'assistant'; content: string }
  interface Context {
    messages: Message[];
    extractedQuery: string;
  }

  function addMessage(context: Context, role: 'user' | 'assistant', content: string): Context {
    // Avoid duplicates
    const lastMsg = context.messages[context.messages.length - 1];
    if (lastMsg?.role === role && lastMsg.content === content) {
      return context;
    }
    
    context.messages.push({ role, content });
    
    // Update query from first user message
    if (!context.extractedQuery && role === 'user') {
      context.extractedQuery = content
        .replace(/^(what|which|can you|please|i need|looking for)\s+/gi, '')
        .slice(0, 100);
    }
    
    return context;
  }

  it('should accumulate messages in order', () => {
    let ctx: Context = { messages: [], extractedQuery: '' };
    ctx = addMessage(ctx, 'user', 'best water filter?');
    ctx = addMessage(ctx, 'assistant', 'Here are some options...');
    ctx = addMessage(ctx, 'user', 'which removes fluoride?');
    
    expect(ctx.messages.length).toBe(3);
    expect(ctx.messages[0].role).toBe('user');
    expect(ctx.messages[1].role).toBe('assistant');
    expect(ctx.messages[2].role).toBe('user');
  });

  it('should not duplicate identical messages', () => {
    let ctx: Context = { messages: [], extractedQuery: '' };
    ctx = addMessage(ctx, 'user', 'hello');
    ctx = addMessage(ctx, 'user', 'hello'); // duplicate
    
    expect(ctx.messages.length).toBe(1);
  });

  it('should extract query from first user message', () => {
    let ctx: Context = { messages: [], extractedQuery: '' };
    ctx = addMessage(ctx, 'user', 'looking for best shower filter');
    
    expect(ctx.extractedQuery).toBe('best shower filter');
  });

  it('should not overwrite query with subsequent messages', () => {
    let ctx: Context = { messages: [], extractedQuery: '' };
    ctx = addMessage(ctx, 'user', 'best laptop for coding');
    ctx = addMessage(ctx, 'user', 'what about gaming laptops?');
    
    expect(ctx.extractedQuery).toBe('best laptop for coding');
  });
});

// ============================================
// 7. CONVERSATION ID DETECTION
// ============================================

describe('Feature: Conversation ID Detection', () => {
  function getConversationId(pathname: string): string | null {
    const match = pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  }

  it('should extract conversation ID from URL', () => {
    expect(getConversationId('/c/abc123-def-456')).toBe('abc123-def-456');
    expect(getConversationId('/c/692e0fc8-8300-8331-8c69-fe88a9b23868')).toBe('692e0fc8-8300-8331-8c69-fe88a9b23868');
  });

  it('should return null for non-conversation URLs', () => {
    expect(getConversationId('/')).toBeNull();
    expect(getConversationId('/new')).toBeNull();
    expect(getConversationId('/settings')).toBeNull();
  });

  it('should handle edge cases', () => {
    expect(getConversationId('/c/')).toBeNull();
    expect(getConversationId('/chat/abc')).toBeNull();
  });
});

console.log('All feature tests defined!');

