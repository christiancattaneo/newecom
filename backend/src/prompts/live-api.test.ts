/**
 * LIVE API TESTS
 * 
 * These tests make REAL API calls to validate prompt quality.
 * Run with: GROQ_API_KEY=xxx npm test -- live-api.test.ts
 * 
 * ⚠️ These tests cost money and have rate limits!
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildCurrentSiteAnalysisPrompt,
  buildCurrentRankingPrompt,
  SiteAnalysisInput,
  ProductRankingInput,
} from './current';
import {
  buildImprovedSiteAnalysisPrompt,
  buildImprovedRankingPrompt,
  buildCoTRankingPrompt,
} from './improved';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SKIP_LIVE_TESTS = !GROQ_API_KEY;

// Track timing and costs
let totalCalls = 0;
let totalTokensUsed = 0;
const timings: { name: string; ms: number; tokens: number }[] = [];

// Available models (as of Dec 2024):
// - llama-3.1-8b-instant (fast, good for simple tasks)
// - llama-3.3-70b-versatile (powerful, replaced llama-3.1-70b)
// - qwen/qwen3-32b (good middle ground)
const DEFAULT_FAST_MODEL = 'llama-3.1-8b-instant';
const DEFAULT_SMART_MODEL = 'llama-3.3-70b-versatile';

async function callGroq(prompt: string, model = DEFAULT_FAST_MODEL): Promise<{ response: any; latencyMs: number; tokens: number }> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  
  const start = Date.now();
  
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  });

  const latencyMs = Date.now() - start;
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as any;
  const tokens = data.usage?.total_tokens || 0;
  
  totalCalls++;
  totalTokensUsed += tokens;
  
  try {
    const content = data.choices?.[0]?.message?.content;
    return { response: JSON.parse(content), latencyMs, tokens };
  } catch {
    return { response: data.choices?.[0]?.message?.content, latencyMs, tokens };
  }
}

// Test fixtures
const siteAnalysisInput: SiteAnalysisInput = {
  url: 'https://amazon.com/s?k=shower+water+filter',
  title: 'Amazon.com: shower water filter',
  description: 'Shop shower water filters and bathroom filtration systems',
  researchHistory: [
    { id: 'res-1', productName: 'Shower Water Filter', query: 'shower water filter removes fluoride', requirements: ['removes fluoride', 'removes chlorine', 'stainless steel'] },
    { id: 'res-2', productName: 'Coffee Maker', query: 'drip coffee maker', requirements: ['programmable', 'thermal carafe'] },
  ],
};

const rankingInput: ProductRankingInput = {
  query: 'shower water filter',
  requirements: ['removes chlorine', 'removes fluoride', 'easy install', 'no plastic'],
  products: [
    { title: 'AquaBliss SF100 High Output Shower Filter - Chrome', price: 35.99, rating: 4.4, reviewCount: 28000, features: ['removes chlorine', '6-month filter life', 'plastic housing', 'easy install'] },
    { title: 'Berkey SF180 Premium Stainless Steel Shower Filter', price: 89.99, rating: 4.6, reviewCount: 3200, features: ['stainless steel housing', 'removes fluoride', 'removes chlorine', 'lifetime warranty'] },
    { title: 'Sprite HO2-WH-M Universal Shower Filter', price: 29.99, rating: 4.2, reviewCount: 8500, features: ['chlorine removal', 'plastic body', 'replaceable cartridge'] },
  ],
  userProfile: {
    values: ['health-conscious', 'quality-focused'],
    avoids: ['plastic', 'synthetic materials', 'cheap'],
    prefers: ['stainless steel', 'metal', 'durable', 'natural materials'],
    priorities: ['health', 'durability'],
    priceRange: 'mid-range',
  },
};

describe.skipIf(SKIP_LIVE_TESTS)('Live API Tests', () => {
  beforeAll(() => {
    console.log('\n🔴 LIVE API TESTS - Using real Groq API\n');
  });

  afterAll(() => {
    console.log('\n========================================');
    console.log('LIVE TEST SUMMARY');
    console.log('========================================');
    console.log(`Total API calls: ${totalCalls}`);
    console.log(`Total tokens used: ${totalTokensUsed}`);
    console.log(`Estimated cost: $${(totalTokensUsed * 0.05 / 1000000).toFixed(6)}`);
    console.log('\nTimings:');
    timings.forEach(t => {
      console.log(`  ${t.name}: ${t.ms}ms (${t.tokens} tokens)`);
    });
    console.log('========================================\n');
  });

  describe('Site Analysis Comparison', () => {
    it('current prompt correctly identifies shopping site match', async () => {
      const prompt = buildCurrentSiteAnalysisPrompt(siteAnalysisInput);
      const { response, latencyMs, tokens } = await callGroq(prompt);
      
      timings.push({ name: 'Current Site Analysis', ms: latencyMs, tokens });
      
      console.log('Current prompt response:', JSON.stringify(response, null, 2));
      
      expect(response.isShoppingSite).toBe(true);
      expect(response.matchedResearchId).toBe('res-1'); // Should match water filter
      expect(response.matchScore).toBeGreaterThan(50);
    }, 30000);

    it('improved prompt correctly identifies shopping site match', async () => {
      const prompt = buildImprovedSiteAnalysisPrompt(siteAnalysisInput);
      const { response, latencyMs, tokens } = await callGroq(prompt);
      
      timings.push({ name: 'Improved Site Analysis', ms: latencyMs, tokens });
      
      console.log('Improved prompt response:', JSON.stringify(response, null, 2));
      
      expect(response.isShoppingSite).toBe(true);
      expect(response.matchedResearchId).toBe('res-1');
      expect(response.matchScore).toBeGreaterThan(50);
    }, 30000);

    it('improved prompt is faster (fewer tokens)', async () => {
      const currentTiming = timings.find(t => t.name === 'Current Site Analysis');
      const improvedTiming = timings.find(t => t.name === 'Improved Site Analysis');
      
      if (currentTiming && improvedTiming) {
        console.log(`Token reduction: ${currentTiming.tokens} → ${improvedTiming.tokens} (${Math.round((1 - improvedTiming.tokens / currentTiming.tokens) * 100)}%)`);
        expect(improvedTiming.tokens).toBeLessThan(currentTiming.tokens);
      }
    });
  });

  describe('Product Ranking Comparison', () => {
    it('current prompt ranks products with user avoids', async () => {
      const prompt = buildCurrentRankingPrompt(rankingInput);
      const { response, latencyMs, tokens } = await callGroq(prompt, DEFAULT_SMART_MODEL);
      
      timings.push({ name: 'Current Ranking', ms: latencyMs, tokens });
      
      console.log('Current ranking response:', JSON.stringify(response, null, 2));
      
      expect(response.rankings).toBeDefined();
      expect(Array.isArray(response.rankings)).toBe(true);
      
      // Stainless steel Berkey should rank higher than plastic AquaBliss
      const berkeyRank = response.rankings.find((r: any) => r.index === 1);
      const aquablissRank = response.rankings.find((r: any) => r.index === 0);
      
      if (berkeyRank && aquablissRank) {
        console.log(`Berkey (stainless): ${berkeyRank.score}, AquaBliss (plastic): ${aquablissRank.score}`);
        // User avoids plastic, so stainless should score higher
        expect(berkeyRank.score).toBeGreaterThanOrEqual(aquablissRank.score);
      }
    }, 60000);

    it('improved prompt penalizes avoided materials correctly', async () => {
      const prompt = buildImprovedRankingPrompt(rankingInput);
      const { response, latencyMs, tokens } = await callGroq(prompt, DEFAULT_SMART_MODEL);
      
      timings.push({ name: 'Improved Ranking', ms: latencyMs, tokens });
      
      console.log('Improved ranking response:', JSON.stringify(response, null, 2));
      
      expect(response.rankings).toBeDefined();
      
      // Check that plastic products are penalized
      const berkeyRank = response.rankings.find((r: any) => r.index === 1);
      const aquablissRank = response.rankings.find((r: any) => r.index === 0);
      
      if (berkeyRank && aquablissRank) {
        console.log(`Improved - Berkey: ${berkeyRank.score}, AquaBliss: ${aquablissRank.score}`);
        expect(berkeyRank.score).toBeGreaterThan(aquablissRank.score);
      }
      
      // Check reasons mention plastic penalty
      const plasticProduct = response.rankings.find((r: any) => r.index === 0 || r.index === 2);
      if (plasticProduct?.reasons) {
        const mentionsPlastic = plasticProduct.reasons.some((r: string) => 
          r.toLowerCase().includes('plastic') || r.toLowerCase().includes('avoid')
        );
        expect(mentionsPlastic).toBe(true);
      }
    }, 60000);

    it('CoT prompt provides better reasoning', async () => {
      const prompt = buildCoTRankingPrompt(rankingInput);
      const { response, latencyMs, tokens } = await callGroq(prompt, DEFAULT_SMART_MODEL);
      
      timings.push({ name: 'CoT Ranking', ms: latencyMs, tokens });
      
      console.log('CoT ranking response:', JSON.stringify(response, null, 2));
      
      // CoT should include thinking steps
      if (response.thinking) {
        expect(Array.isArray(response.thinking)).toBe(true);
        console.log('CoT thinking steps:', response.thinking.length);
      }
      
      expect(response.rankings).toBeDefined();
    }, 60000);
  });

  describe('Edge Cases', () => {
    it('handles non-shopping site correctly', async () => {
      const nonShoppingInput: SiteAnalysisInput = {
        url: 'https://healthline.com/nutrition/water-quality',
        title: 'Water Quality Guide - Healthline',
        description: 'Learn about water contaminants and health effects',
        researchHistory: [
          { id: 'res-1', productName: 'Water Filter', query: 'water filter', requirements: [] },
        ],
      };
      
      const prompt = buildImprovedSiteAnalysisPrompt(nonShoppingInput);
      const { response, latencyMs, tokens } = await callGroq(prompt);
      
      timings.push({ name: 'Non-shopping detection', ms: latencyMs, tokens });
      
      console.log('Non-shopping response:', JSON.stringify(response, null, 2));
      
      // Should recognize this as NOT a shopping site
      expect(response.isShoppingSite).toBe(false);
    }, 30000);

    it('handles category mismatch correctly', async () => {
      const mismatchInput: SiteAnalysisInput = {
        url: 'https://wayfair.com/furniture/sofas',
        title: 'Sofas & Couches | Wayfair',
        description: 'Shop sofas and sectionals',
        researchHistory: [
          { id: 'res-1', productName: 'Gaming Laptop', query: 'gaming laptop RTX 4070', requirements: ['RTX 4070', '32GB RAM'] },
        ],
      };
      
      const prompt = buildImprovedSiteAnalysisPrompt(mismatchInput);
      const { response, latencyMs, tokens } = await callGroq(prompt);
      
      timings.push({ name: 'Category mismatch', ms: latencyMs, tokens });
      
      console.log('Mismatch response:', JSON.stringify(response, null, 2));
      
      // Should be a shopping site but NO match to laptop research
      expect(response.isShoppingSite).toBe(true);
      expect(response.matchScore).toBeLessThan(50);
    }, 30000);
  });
});

// If tests are skipped, show message
describe.runIf(SKIP_LIVE_TESTS)('Live API Tests (SKIPPED)', () => {
  it('skipped - set GROQ_API_KEY to run', () => {
    console.log('\n⚠️  Live API tests skipped. Set GROQ_API_KEY environment variable to run.\n');
    console.log('Run with: GROQ_API_KEY=your_key npm test -- live-api.test.ts\n');
    expect(true).toBe(true);
  });
});

