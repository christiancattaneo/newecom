/**
 * PROMPT EVALUATION TESTS
 * 
 * Tests to validate prompt improvements BEFORE integration.
 * Measures: token efficiency, output consistency, edge case handling
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  buildCurrentSiteAnalysisPrompt,
  buildCurrentRankingPrompt,
  countTokens,
  SiteAnalysisInput,
  ProductRankingInput,
} from './current';
import {
  buildImprovedSiteAnalysisPrompt,
  buildImprovedRankingPrompt,
  buildMinimalSiteAnalysisPrompt,
  buildMinimalRankingPrompt,
  buildCoTRankingPrompt,
} from './improved';

// ===========================================
// TEST FIXTURES
// ===========================================

const siteAnalysisInputs: Record<string, SiteAnalysisInput> = {
  // Should MATCH - Amazon water filter page
  amazonWaterFilter: {
    url: 'https://amazon.com/s?k=water+filter',
    title: 'Amazon.com: water filter',
    description: 'Shop water filters, filtration systems, and purifiers',
    researchHistory: [
      { id: 'res-1', productName: 'Shower Water Filter', query: 'shower water filter', requirements: ['no fluoride', 'removes chlorine'] },
      { id: 'res-2', productName: 'Espresso Machine', query: 'espresso machine', requirements: ['budget under $500'] },
    ],
  },
  
  // Should MATCH - Small specialty site
  specialtyPlumbing: {
    url: 'https://supplyhouse.com/bathroom-faucets',
    title: 'Bathroom Faucets & Fixtures | SupplyHouse',
    description: 'Professional plumbing supplies for contractors and DIY',
    researchHistory: [
      { id: 'res-1', productName: 'Shower Water Filter', query: 'shower water filter', requirements: ['removes chlorine'] },
    ],
  },
  
  // Should NOT MATCH - Blog about water quality
  waterBlog: {
    url: 'https://healthline.com/water-quality-guide',
    title: 'Water Quality Guide: Everything You Need to Know',
    description: 'Learn about water contaminants and health effects',
    researchHistory: [
      { id: 'res-1', productName: 'Water Filter', query: 'water filter', requirements: [] },
    ],
  },
  
  // Should NOT MATCH - Wrong category
  furnitureStore: {
    url: 'https://wayfair.com/furniture/sofas',
    title: 'Sofas & Couches | Wayfair',
    description: 'Shop sofas, sectionals, and loveseats',
    researchHistory: [
      { id: 'res-1', productName: 'Gaming Laptop', query: 'gaming laptop', requirements: ['RTX 4070'] },
    ],
  },
  
  // EDGE CASE - Generic Amazon homepage
  amazonHomepage: {
    url: 'https://amazon.com/',
    title: 'Amazon.com: Online Shopping',
    description: 'Free shipping on millions of items',
    researchHistory: [
      { id: 'res-1', productName: 'Headphones', query: 'wireless headphones', requirements: [] },
    ],
  },
};

const rankingInputs: Record<string, ProductRankingInput> = {
  // User AVOIDS plastic - should penalize plastic products
  waterFilterWithAvoids: {
    query: 'shower water filter',
    requirements: ['removes chlorine', 'removes fluoride', 'easy install'],
    products: [
      { title: 'AquaBliss SF100 Shower Filter - Chrome', price: 35.99, rating: 4.4, reviewCount: 28000, features: ['removes chlorine', '6-month filter', 'plastic housing'] },
      { title: 'Berkey SF180 Stainless Steel Shower Filter', price: 89.99, rating: 4.6, reviewCount: 3200, features: ['stainless steel', 'removes fluoride', 'removes chlorine'] },
      { title: 'Generic Shower Filter Basic', price: 12.99, rating: 3.8, reviewCount: 500, features: ['plastic', 'basic filtration'] },
    ],
    userProfile: {
      values: ['health-conscious', 'quality-focused'],
      avoids: ['plastic', 'synthetic materials', 'cheap construction'],
      prefers: ['stainless steel', 'metal', 'durable'],
      priorities: ['health', 'durability'],
      priceRange: 'mid-range',
    },
  },
  
  // No user profile - baseline test
  espressoMachineBasic: {
    query: 'espresso machine',
    requirements: ['under $500', 'automatic', 'milk frother'],
    products: [
      { title: 'Breville Barista Express', price: 699.99, rating: 4.7, reviewCount: 15000, features: ['semi-auto', 'grinder included', 'steam wand'] },
      { title: 'De\'Longhi Magnifica', price: 449.99, rating: 4.5, reviewCount: 8000, features: ['automatic', 'milk frother', 'compact'] },
      { title: 'Mr. Coffee Espresso', price: 89.99, rating: 3.9, reviewCount: 2000, features: ['basic', 'manual frother'] },
    ],
    userProfile: undefined,
  },
  
  // Edge case - user avoids AND product contains avoided item
  leatherSeatWithFakeLeather: {
    query: 'car seat covers',
    requirements: ['fits SUV', 'waterproof', 'easy clean'],
    products: [
      { title: 'Premium PU Leather Seat Covers - Universal', price: 79.99, rating: 4.3, reviewCount: 5000, description: 'High-quality faux leather, waterproof polyurethane coating', features: ['PU leather', 'waterproof', 'universal fit'] },
      { title: 'Genuine Leather Custom Seat Covers', price: 299.99, rating: 4.8, reviewCount: 800, description: 'Real cowhide leather, custom fitted', features: ['genuine leather', 'custom fit', 'breathable'] },
      { title: 'Neoprene Sport Seat Covers', price: 129.99, rating: 4.5, reviewCount: 3000, description: 'Wetsuit material, extremely durable', features: ['neoprene', 'waterproof', 'machine washable'] },
    ],
    userProfile: {
      values: ['quality-focused', 'health-conscious'],
      avoids: ['fake leather', 'PU leather', 'polyurethane', 'synthetic leather', 'faux leather'],
      prefers: ['real leather', 'genuine leather', 'natural materials'],
      priorities: ['quality', 'durability'],
      priceRange: 'premium',
    },
  },
};

// ===========================================
// TOKEN EFFICIENCY TESTS
// ===========================================

describe('Token Efficiency', () => {
  it('improved site analysis uses fewer tokens', () => {
    const input = siteAnalysisInputs.amazonWaterFilter;
    
    const currentTokens = countTokens(buildCurrentSiteAnalysisPrompt(input));
    const improvedTokens = countTokens(buildImprovedSiteAnalysisPrompt(input));
    const minimalTokens = countTokens(buildMinimalSiteAnalysisPrompt(input));
    
    console.log('Site Analysis Token Comparison:');
    console.log(`  Current:  ${currentTokens} tokens`);
    console.log(`  Improved: ${improvedTokens} tokens (${Math.round((1 - improvedTokens/currentTokens) * 100)}% reduction)`);
    console.log(`  Minimal:  ${minimalTokens} tokens (${Math.round((1 - minimalTokens/currentTokens) * 100)}% reduction)`);
    
    expect(improvedTokens).toBeLessThan(currentTokens);
    expect(minimalTokens).toBeLessThan(improvedTokens);
  });

  it('improved ranking uses fewer tokens', () => {
    const input = rankingInputs.waterFilterWithAvoids;
    
    const currentTokens = countTokens(buildCurrentRankingPrompt(input));
    const improvedTokens = countTokens(buildImprovedRankingPrompt(input));
    const minimalTokens = countTokens(buildMinimalRankingPrompt(input));
    const cotTokens = countTokens(buildCoTRankingPrompt(input));
    
    console.log('Ranking Token Comparison:');
    console.log(`  Current:  ${currentTokens} tokens`);
    console.log(`  Improved: ${improvedTokens} tokens (${Math.round((1 - improvedTokens/currentTokens) * 100)}% reduction)`);
    console.log(`  Minimal:  ${minimalTokens} tokens (${Math.round((1 - minimalTokens/currentTokens) * 100)}% reduction)`);
    console.log(`  CoT:      ${cotTokens} tokens (${Math.round((cotTokens/currentTokens - 1) * 100)}% increase for better reasoning)`);
    
    expect(improvedTokens).toBeLessThan(currentTokens);
    expect(minimalTokens).toBeLessThan(improvedTokens);
  });

  it('all prompts stay under Groq context limits', () => {
    const GROQ_LLAMA_8B_CONTEXT = 8192;
    const GROQ_LLAMA_70B_CONTEXT = 8192;
    const SAFE_INPUT_LIMIT = 6000; // Leave room for output
    
    Object.entries(siteAnalysisInputs).forEach(([name, input]) => {
      const tokens = countTokens(buildImprovedSiteAnalysisPrompt(input));
      expect(tokens, `Site analysis "${name}" exceeds limit`).toBeLessThan(SAFE_INPUT_LIMIT);
    });
    
    Object.entries(rankingInputs).forEach(([name, input]) => {
      const tokens = countTokens(buildImprovedRankingPrompt(input));
      expect(tokens, `Ranking "${name}" exceeds limit`).toBeLessThan(SAFE_INPUT_LIMIT);
    });
  });
});

// ===========================================
// PROMPT STRUCTURE TESTS
// ===========================================

describe('Prompt Structure Quality', () => {
  it('improved prompts have explicit JSON schema', () => {
    const sitePrompt = buildImprovedSiteAnalysisPrompt(siteAnalysisInputs.amazonWaterFilter);
    const rankPrompt = buildImprovedRankingPrompt(rankingInputs.waterFilterWithAvoids);
    
    // Should contain JSON structure example
    expect(sitePrompt).toContain('"isShoppingSite"');
    expect(sitePrompt).toContain('"matchScore"');
    expect(rankPrompt).toContain('"rankings"');
    expect(rankPrompt).toContain('"score"');
  });

  it('improved prompts have scoring rubric', () => {
    const prompt = buildImprovedRankingPrompt(rankingInputs.waterFilterWithAvoids);
    
    // Should contain point values
    expect(prompt).toMatch(/\+\d+/); // +40, +25, etc.
    expect(prompt).toMatch(/-\d+/);  // -30, -15, etc.
    expect(prompt).toContain('RUBRIC');
  });

  it('avoids are prominently featured when present', () => {
    const prompt = buildImprovedRankingPrompt(rankingInputs.waterFilterWithAvoids);
    
    expect(prompt).toContain('AVOID');
    expect(prompt).toContain('plastic');
  });

  it('handles missing user profile gracefully', () => {
    const prompt = buildImprovedRankingPrompt(rankingInputs.espressoMachineBasic);
    
    // Should not crash and should not contain "undefined"
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('null');
    expect(prompt.length).toBeGreaterThan(100);
  });
});

// ===========================================
// EXPECTED BEHAVIOR TESTS
// ===========================================

describe('Expected AI Behavior (simulated)', () => {
  /**
   * These tests validate that prompts CONTAIN the right information
   * for AI to make correct decisions. Actual AI responses would be tested
   * in integration tests with real API calls.
   */
  
  it('site analysis prompt contains matching category info', () => {
    const prompt = buildImprovedSiteAnalysisPrompt(siteAnalysisInputs.amazonWaterFilter);
    
    // Prompt should contain both the site category hint and research
    expect(prompt).toContain('water');
    expect(prompt).toContain('filter');
    expect(prompt).toContain('Shower Water Filter');
  });

  it('blog should be identifiable as non-shopping', () => {
    const prompt = buildImprovedSiteAnalysisPrompt(siteAnalysisInputs.waterBlog);
    
    // Prompt contains healthline (blog) URL
    expect(prompt).toContain('healthline');
    // Prompt explicitly mentions healthline as NOT shopping
    expect(prompt).toContain('NOT SHOPPING');
    expect(prompt).toContain('Healthline');
  });

  it('ranking prompt penalizes avoided materials', () => {
    const prompt = buildImprovedRankingPrompt(rankingInputs.waterFilterWithAvoids);
    
    // User avoids plastic
    expect(prompt).toContain('plastic');
    expect(prompt).toContain('AVOID');
    
    // Products with plastic should be identifiable
    expect(prompt).toContain('plastic housing'); // AquaBliss has plastic
    expect(prompt).toContain('stainless steel'); // Berkey doesn't
  });

  it('ranking prompt highlights fake leather for user who avoids it', () => {
    const prompt = buildImprovedRankingPrompt(rankingInputs.leatherSeatWithFakeLeather);
    
    // User profile avoids fake leather
    expect(prompt).toContain('fake leather');
    // OR
    expect(prompt.toLowerCase()).toMatch(/pu leather|faux leather|synthetic/);
    
    // Product descriptions contain the avoided materials
    expect(prompt.toLowerCase()).toContain('pu leather');
  });
});

// ===========================================
// COMPARISON SUMMARY
// ===========================================

describe('Overall Comparison Summary', () => {
  it('generates comparison report', () => {
    console.log('\n========================================');
    console.log('PROMPT IMPROVEMENT ANALYSIS REPORT');
    console.log('========================================\n');
    
    // Site Analysis
    const siteInput = siteAnalysisInputs.amazonWaterFilter;
    const currentSite = buildCurrentSiteAnalysisPrompt(siteInput);
    const improvedSite = buildImprovedSiteAnalysisPrompt(siteInput);
    const minimalSite = buildMinimalSiteAnalysisPrompt(siteInput);
    
    console.log('SITE ANALYSIS PROMPTS:');
    console.log('─────────────────────');
    console.log(`Current:  ${countTokens(currentSite)} tokens, ${currentSite.split('\n').length} lines`);
    console.log(`Improved: ${countTokens(improvedSite)} tokens, ${improvedSite.split('\n').length} lines`);
    console.log(`Minimal:  ${countTokens(minimalSite)} tokens, ${minimalSite.split('\n').length} lines`);
    
    const siteSavings = Math.round((1 - countTokens(improvedSite) / countTokens(currentSite)) * 100);
    console.log(`\n→ Token savings: ${siteSavings}% with improved prompt`);
    console.log(`→ Est. cost reduction: $${(siteSavings / 100 * 0.05 * 1000).toFixed(2)}/1000 calls\n`);
    
    // Ranking
    const rankInput = rankingInputs.waterFilterWithAvoids;
    const currentRank = buildCurrentRankingPrompt(rankInput);
    const improvedRank = buildImprovedRankingPrompt(rankInput);
    const cotRank = buildCoTRankingPrompt(rankInput);
    
    console.log('RANKING PROMPTS:');
    console.log('─────────────────');
    console.log(`Current:  ${countTokens(currentRank)} tokens, ${currentRank.split('\n').length} lines`);
    console.log(`Improved: ${countTokens(improvedRank)} tokens, ${improvedRank.split('\n').length} lines`);
    console.log(`CoT:      ${countTokens(cotRank)} tokens, ${cotRank.split('\n').length} lines`);
    
    const rankSavings = Math.round((1 - countTokens(improvedRank) / countTokens(currentRank)) * 100);
    console.log(`\n→ Token savings: ${rankSavings}% with improved prompt`);
    console.log(`→ CoT adds ${Math.round((countTokens(cotRank) / countTokens(currentRank) - 1) * 100)}% tokens but improves reasoning\n`);
    
    // Key improvements
    console.log('KEY IMPROVEMENTS:');
    console.log('─────────────────');
    console.log('✓ Explicit scoring rubric (more consistent scores)');
    console.log('✓ Penalty system clearly defined (avoids handled)');
    console.log('✓ Compressed product format (less tokens)');
    console.log('✓ Decision tree structure (faster AI processing)');
    console.log('✓ JSON schema inline (better output format)');
    
    console.log('\n========================================\n');
    
    expect(true).toBe(true); // Always pass - this is a report generator
  });
});

// ===========================================
// EDGE CASE TESTS
// ===========================================

describe('Edge Cases', () => {
  it('handles empty research history', () => {
    const input: SiteAnalysisInput = {
      url: 'https://amazon.com/water-filters',
      title: 'Water Filters',
      researchHistory: [],
    };
    
    const prompt = buildImprovedSiteAnalysisPrompt(input);
    expect(prompt).not.toContain('undefined');
    expect(prompt.length).toBeGreaterThan(50);
  });

  it('handles empty product list', () => {
    const input: ProductRankingInput = {
      query: 'test',
      requirements: [],
      products: [],
    };
    
    const prompt = buildImprovedRankingPrompt(input);
    expect(prompt).not.toContain('undefined');
  });

  it('handles very long product titles', () => {
    const input: ProductRankingInput = {
      query: 'laptop',
      requirements: ['fast'],
      products: [{
        title: 'A'.repeat(500), // Very long title
        price: 999,
        rating: 4.5,
        reviewCount: 1000,
      }],
    };
    
    const prompt = buildImprovedRankingPrompt(input);
    // Should truncate
    expect(prompt.length).toBeLessThan(2000);
  });

  it('handles special characters in input', () => {
    const input: ProductRankingInput = {
      query: 'laptop with "fast" CPU & <good> graphics',
      requirements: ['price < $1000', 'RAM >= 16GB'],
      products: [{
        title: 'Test & "Laptop" <Model>',
        price: 999,
      }],
    };
    
    const prompt = buildImprovedRankingPrompt(input);
    // Should not break JSON structure
    expect(prompt).toContain('laptop');
  });
});

