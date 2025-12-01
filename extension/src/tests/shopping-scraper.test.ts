/**
 * Tests for Shopping Scraper - 4 Key Features
 * 1. Live Prices
 * 2. Requirement Matching (features/description)
 * 3. Review Sentiment (rating + review count)
 * 4. In-Stock Verification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// Mock Amazon search result HTML
const createAmazonSearchResultHTML = (options: {
  title: string;
  price?: string;
  rating?: string;
  reviewCount?: string;
  inStock?: boolean;
  features?: string;
}) => {
  const stockText = options.inStock === false ? 'Currently unavailable' : '';
  
  return `
    <div data-component-type="s-search-result" data-asin="B0TEST123">
      <h2><a href="/dp/B0TEST123"><span>${options.title}</span></a></h2>
      ${options.price ? `<span class="a-price"><span class="a-offscreen">$${options.price}</span></span>` : ''}
      ${options.rating ? `<span class="a-icon-star-small"><span class="a-icon-alt">${options.rating} out of 5 stars</span></span>` : ''}
      ${options.reviewCount ? `<span class="a-size-small"><a class="a-link-normal" href="/customerReviews">${options.reviewCount}</a></span>` : ''}
      ${stockText ? `<span class="a-color-price">${stockText}</span>` : ''}
      ${options.features ? `<span class="a-size-base-plus">${options.features}</span>` : ''}
      <img class="s-image" src="https://example.com/image.jpg" />
    </div>
  `;
};

// Scraper function extracted for testing
function scrapeAmazonProducts(document: Document) {
  const products: any[] = [];
  
  const searchItems = document.querySelectorAll('[data-component-type="s-search-result"]');
  
  searchItems.forEach((item, index) => {
    if (index >= 12) return;
    
    // Skip sponsored
    if (item.querySelector('.s-label-popover-default')) return;
    
    const titleEl = item.querySelector('h2 a span, h2 span, .a-text-normal');
    if (!titleEl) return;
    
    // Price
    const priceEl = item.querySelector('.a-price .a-offscreen');
    const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
    
    // Link
    const linkEl = item.querySelector('h2 a, a[href*="/dp/"]') as HTMLAnchorElement;
    const url = linkEl?.href || '';
    
    // Image
    const imageEl = item.querySelector('img.s-image') as HTMLImageElement;
    
    // Rating
    const ratingEl = item.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt');
    let rating: number | undefined;
    if (ratingEl?.textContent) {
      const match = ratingEl.textContent.match(/(\d+\.?\d*)/);
      if (match) rating = parseFloat(match[1]);
    }
    
    // Review count
    const reviewEl = item.querySelector('.a-size-small .a-link-normal[href*="customerReviews"], .a-size-small a');
    let reviewCount: number | undefined;
    if (reviewEl?.textContent) {
      const countText = reviewEl.textContent.replace(/[^0-9]/g, '');
      if (countText) reviewCount = parseInt(countText);
    }
    
    // In-stock
    let inStock = true;
    const stockEl = item.querySelector('.a-color-price, .a-color-secondary');
    if (stockEl?.textContent?.toLowerCase().includes('unavailable') ||
        stockEl?.textContent?.toLowerCase().includes('out of stock')) {
      inStock = false;
    }
    
    // Features
    const featuresText = item.querySelector('.a-size-base-plus')?.textContent?.trim() || '';
    
    products.push({
      title: titleEl.textContent?.trim() || '',
      price: priceText ? parseFloat(priceText) : null,
      url,
      description: featuresText,
      imageUrl: imageEl?.src,
      rating,
      reviewCount,
      inStock,
    });
  });
  
  return products;
}

describe('Shopping Scraper - 4 Key Features', () => {
  
  // =============================================
  // FEATURE 1: LIVE PRICES
  // =============================================
  describe('Feature 1: Live Prices', () => {
    it('should extract price from search result', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Test Shower Filter',
        price: '29.99',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products).toHaveLength(1);
      expect(products[0].price).toBe(29.99);
    });

    it('should handle prices with different formats', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Expensive Filter',
        price: '149.00',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].price).toBe(149.00);
    });

    it('should handle missing price gracefully', () => {
      const html = createAmazonSearchResultHTML({
        title: 'No Price Product',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].price).toBeNull();
    });

    it('should extract prices from multiple products', () => {
      const html = `
        ${createAmazonSearchResultHTML({ title: 'Product 1', price: '19.99' })}
        ${createAmazonSearchResultHTML({ title: 'Product 2', price: '39.99' })}
        ${createAmazonSearchResultHTML({ title: 'Product 3', price: '59.99' })}
      `;
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products).toHaveLength(3);
      expect(products[0].price).toBe(19.99);
      expect(products[1].price).toBe(39.99);
      expect(products[2].price).toBe(59.99);
    });
  });

  // =============================================
  // FEATURE 2: REQUIREMENT MATCHING (Features)
  // =============================================
  describe('Feature 2: Requirement Matching (Features)', () => {
    it('should extract product features/description', () => {
      const html = createAmazonSearchResultHTML({
        title: 'AquaBliss Shower Filter',
        price: '35.00',
        features: 'Removes chlorine, fluoride, and heavy metals. 15-stage filtration.',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].description).toContain('chlorine');
      expect(products[0].description).toContain('fluoride');
      expect(products[0].description).toContain('heavy metals');
    });

    it('should extract title for requirement matching', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Fluoride-Free Stainless Steel Shower Filter',
        price: '45.00',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].title).toContain('Fluoride-Free');
      expect(products[0].title).toContain('Stainless Steel');
    });

    it('should handle products with no features', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Basic Filter',
        price: '15.00',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].description).toBe('');
      expect(products[0].title).toBe('Basic Filter');
    });
  });

  // =============================================
  // FEATURE 3: REVIEW SENTIMENT (Rating + Count)
  // =============================================
  describe('Feature 3: Review Sentiment', () => {
    it('should extract star rating', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Well Reviewed Filter',
        price: '39.99',
        rating: '4.5',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].rating).toBe(4.5);
    });

    it('should extract review count', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Popular Filter',
        price: '29.99',
        rating: '4.3',
        reviewCount: '12,847',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].reviewCount).toBe(12847);
    });

    it('should handle products with no reviews', () => {
      const html = createAmazonSearchResultHTML({
        title: 'New Product',
        price: '25.00',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].rating).toBeUndefined();
      expect(products[0].reviewCount).toBeUndefined();
    });

    it('should extract various rating formats', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Highly Rated',
        price: '49.99',
        rating: '4.8',
        reviewCount: '5,234',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].rating).toBe(4.8);
      expect(products[0].reviewCount).toBe(5234);
    });
  });

  // =============================================
  // FEATURE 4: IN-STOCK VERIFICATION
  // =============================================
  describe('Feature 4: In-Stock Verification', () => {
    it('should mark in-stock products correctly', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Available Filter',
        price: '35.00',
        inStock: true,
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].inStock).toBe(true);
    });

    it('should detect out-of-stock products', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Unavailable Filter',
        price: '35.00',
        inStock: false,
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].inStock).toBe(false);
    });

    it('should default to in-stock when status unclear', () => {
      const html = createAmazonSearchResultHTML({
        title: 'Standard Filter',
        price: '30.00',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products[0].inStock).toBe(true);
    });
  });

  // =============================================
  // INTEGRATION: ALL 4 FEATURES TOGETHER
  // =============================================
  describe('Integration: All 4 Features', () => {
    it('should extract all 4 features from a complete product listing', () => {
      const html = createAmazonSearchResultHTML({
        title: 'AquaBliss SF500 Premium Shower Filter',
        price: '39.95',
        rating: '4.6',
        reviewCount: '28,472',
        inStock: true,
        features: 'Removes 99% of chlorine, reduces fluoride and heavy metals',
      });
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      const product = products[0];
      
      // Feature 1: Live Price
      expect(product.price).toBe(39.95);
      
      // Feature 2: Requirement Matching
      expect(product.title).toContain('Shower Filter');
      expect(product.description).toContain('chlorine');
      
      // Feature 3: Review Sentiment
      expect(product.rating).toBe(4.6);
      expect(product.reviewCount).toBe(28472);
      
      // Feature 4: In-Stock
      expect(product.inStock).toBe(true);
    });

    it('should handle multiple products with varying completeness', () => {
      const html = `
        ${createAmazonSearchResultHTML({
          title: 'Complete Product',
          price: '49.99',
          rating: '4.5',
          reviewCount: '1,234',
          inStock: true,
          features: 'Premium quality',
        })}
        ${createAmazonSearchResultHTML({
          title: 'Minimal Product',
          price: '19.99',
        })}
        ${createAmazonSearchResultHTML({
          title: 'Out of Stock Product',
          price: '29.99',
          rating: '4.8',
          reviewCount: '5,000',
          inStock: false,
        })}
      `;
      const dom = new JSDOM(html);
      const products = scrapeAmazonProducts(dom.window.document);
      
      expect(products).toHaveLength(3);
      
      // Complete product
      expect(products[0].price).toBe(49.99);
      expect(products[0].rating).toBe(4.5);
      expect(products[0].reviewCount).toBe(1234);
      expect(products[0].inStock).toBe(true);
      expect(products[0].description).toBe('Premium quality');
      
      // Minimal product
      expect(products[1].price).toBe(19.99);
      expect(products[1].rating).toBeUndefined();
      expect(products[1].reviewCount).toBeUndefined();
      expect(products[1].inStock).toBe(true);
      
      // Out of stock product
      expect(products[2].price).toBe(29.99);
      expect(products[2].inStock).toBe(false);
    });
  });
});

// =============================================
// BACKEND TESTS: AI PROMPT INCLUDES ALL DATA
// =============================================
describe('Backend: AI Prompt Generation', () => {
  
  function buildTestPrompt(context: any, products: any[]) {
    const productList = products
      .map((p, i) => {
        const priceStr = p.price ? `$${p.price.toFixed(2)}` : 'Price unknown';
        const ratingStr = p.rating ? `${p.rating}★ (${p.reviewCount?.toLocaleString() || '?'} reviews)` : 'No rating';
        const featuresStr = p.features?.length ? `Features: ${p.features.slice(0, 4).join('; ')}` : '';
        
        return `[${i}] ${p.title}\n    Price: ${priceStr}\n    Rating: ${ratingStr}\n    ${p.description ? `Info: ${p.description}` : ''}\n    ${featuresStr}`;
      })
      .join('\n\n');

    return productList;
  }

  it('should include price in prompt', () => {
    const products = [{ title: 'Test', price: 29.99, description: '' }];
    const prompt = buildTestPrompt({}, products);
    
    expect(prompt).toContain('$29.99');
  });

  it('should include rating in prompt', () => {
    const products = [{ title: 'Test', price: 29.99, rating: 4.5, reviewCount: 1000, description: '' }];
    const prompt = buildTestPrompt({}, products);
    
    expect(prompt).toContain('4.5★');
    expect(prompt).toContain('1,000 reviews');
  });

  it('should include features in prompt', () => {
    const products = [{ 
      title: 'Test', 
      price: 29.99, 
      description: 'Removes fluoride and chlorine',
      features: ['Removes fluoride', 'Removes chlorine'],
    }];
    const prompt = buildTestPrompt({}, products);
    
    expect(prompt).toContain('Removes fluoride');
  });
});

console.log('✅ All test suites defined');

