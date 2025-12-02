/**
 * Sift API - Cloudflare Worker
 * Handles product ranking using Groq/OpenAI
 */

interface Env {
  GROQ_API_KEY: string;
  OPENAI_API_KEY?: string; // Optional fallback
  ENVIRONMENT: string;
}

interface ProductContext {
  query: string;
  requirements: string[];
  mentionedProducts?: string[];
  recentMessages?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

interface ProductData {
  title: string;
  price: number | null;
  url: string;
  description: string;
  rating?: number;
  reviewCount?: number;
  inStock?: boolean;
  features?: string[];
}

interface UserProfile {
  values: string[];      // e.g., ["health-conscious", "quality-focused"]
  avoids: string[];      // e.g., ["plastic", "synthetic materials"]
  prefers: string[];     // e.g., ["real leather", "stainless steel"]
  priorities: string[];  // e.g., ["durability", "safety"]
  priceRange: string;    // e.g., "premium", "budget"
}

interface RankProductsRequest {
  context: ProductContext;
  products: ProductData[];
  userProfile?: UserProfile | null;
}

interface AnalyzeSiteRequest {
  url: string;
  title: string;
  description?: string;
  researchHistory: Array<{
    id: string;
    query: string;
    productName: string;
    requirements: string[];
    categories: string[];
  }>;
}

interface AnalyzeSiteResponse {
  isShoppingSite: boolean;
  siteCategory?: string;
  matchedResearchId?: string;
  matchScore?: number;
  matchReason?: string;
}

interface ProductRanking {
  index: number;
  score: number;
  reasons: string[];
}

interface RankProductsResponse {
  rankings: ProductRanking[];
  summary: string;
}

// CORS headers for browser extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route handling
      if (path === '/api/rank-products' && request.method === 'POST') {
        return await handleRankProducts(request, env);
      }

      if (path === '/api/analyze-site' && request.method === 'POST') {
        return await handleAnalyzeSite(request, env);
      }

      if (path === '/api/health') {
        return jsonResponse({ status: 'ok', version: '0.1.0' });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },
};

// ============================================
// SITE ANALYSIS - AI determines if shopping site matches research
// ============================================

async function handleAnalyzeSite(request: Request, env: Env): Promise<Response> {
  if (!env.GROQ_API_KEY) {
    console.error('GROQ_API_KEY not configured for analyze-site');
    return jsonResponse({ isShoppingSite: false }); // Graceful fallback instead of error
  }

  let body: AnalyzeSiteRequest;
  try {
    body = await request.json();
  } catch (e) {
    console.error('Invalid JSON in analyze-site request:', e);
    return jsonResponse({ isShoppingSite: false }); // Graceful fallback
  }

  // URL is required, title can be empty
  if (!body.url) {
    console.log('Missing URL in analyze-site request');
    return jsonResponse({ isShoppingSite: false });
  }
  
  // Ensure title has a fallback
  body.title = body.title || 'Unknown Page';

  // No research history = nothing to match
  if (!body.researchHistory || body.researchHistory.length === 0) {
    return jsonResponse({ isShoppingSite: false });
  }

  try {
    const result = await analyzeSiteWithAI(body, env.GROQ_API_KEY);
    return jsonResponse(result);
  } catch (error) {
    console.error('Site analysis error:', error);
    // Fallback: not a shopping match
    return jsonResponse({ isShoppingSite: false });
  }
}

async function analyzeSiteWithAI(
  request: AnalyzeSiteRequest,
  apiKey: string
): Promise<AnalyzeSiteResponse> {
  // Build compact research list
  const researchList = request.researchHistory
    .slice(0, 8)
    .map((r) => `• [${r.id || 'unknown'}] ${r.productName || r.query || 'unknown'}`)
    .join('\n');

  // Improved prompt with B2B and specialty site support
  const prompt = `Analyze if this website sells products (any type of purchase/ordering).

URL: ${request.url}
Title: ${request.title}
${request.description ? `Description: ${request.description.slice(0, 150)}` : ''}

User's product research:
${researchList}

STEP 1 - Can users PURCHASE or ORDER products here? 
✓ SHOPPING indicators (ANY of these):
  - E-commerce: "add to cart", "buy now", checkout, prices
  - B2B/Manufacturers: "request quote", "request catalog", "contact for pricing", product configurator
  - Specialty: vehicle dealers, equipment manufacturers, custom products
  - Product pages with specs/features (even without direct cart)
  
✗ NOT SHOPPING (info-only, no purchasing):
  - Health info: healthline, webmd, mayoclinic
  - Reference: wikipedia, quora, stackoverflow
  - Social: reddit, youtube, twitter, facebook
  - News/blogs without products

STEP 2 - If shopping=true, does it match user research?
Match broadly: "armored car" ↔ "bulletproof vehicle" ✓, "apocalypse car" ↔ "armored SUV" ✓
Match category + intent, not just exact keywords.

JSON response only:
{"isShoppingSite":bool,"siteCategory":"category or null","matchedResearchId":"id or null","matchScore":0-100,"matchReason":"<15 words"}`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant', // Fast model for quick analysis
      messages: [
        {
          role: 'system',
          content: 'You analyze websites to detect shopping sites and match with user research. Respond with JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in response');
  }

  try {
    const parsed = JSON.parse(content.trim());
    return {
      isShoppingSite: !!parsed.isShoppingSite,
      siteCategory: parsed.siteCategory || undefined,
      matchedResearchId: parsed.matchedResearchId || undefined,
      matchScore: typeof parsed.matchScore === 'number' ? parsed.matchScore : 0,
      matchReason: parsed.matchReason || undefined,
    };
  } catch {
    return { isShoppingSite: false };
  }
}

// ============================================
// PRODUCT RANKING
// ============================================

async function handleRankProducts(request: Request, env: Env): Promise<Response> {
  // Validate API key exists
  if (!env.GROQ_API_KEY) {
    console.error('GROQ_API_KEY not configured');
    return jsonResponse({ error: 'Service not configured' }, 500);
  }

  // Parse request body
  let body: RankProductsRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // Validate request
  if (!body.context || !body.products || !Array.isArray(body.products)) {
    return jsonResponse({ error: 'Missing context or products' }, 400);
  }

  if (body.products.length === 0) {
    return jsonResponse({ error: 'No products to rank' }, 400);
  }

  // Limit products to prevent abuse
  const MAX_PRODUCTS = 15;
  const products = body.products.slice(0, MAX_PRODUCTS);

  try {
    // Try Groq first (faster), fall back to OpenAI
    const result = await rankWithGroq(body.context, products, env.GROQ_API_KEY, body.userProfile);
    return jsonResponse(result);
  } catch (groqError) {
    console.error('Groq error:', groqError);
    
    // Try OpenAI fallback if available
    if (env.OPENAI_API_KEY) {
      try {
        const result = await rankWithOpenAI(body.context, products, env.OPENAI_API_KEY, body.userProfile);
        return jsonResponse(result);
      } catch (openaiError) {
        console.error('OpenAI fallback error:', openaiError);
      }
    }
    
    return jsonResponse({ error: 'AI service unavailable' }, 503);
  }
}

async function rankWithGroq(
  context: ProductContext,
  products: ProductData[],
  apiKey: string,
  userProfile?: UserProfile | null
): Promise<RankProductsResponse> {
  const prompt = buildPrompt(context, products, userProfile);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile', // Updated from decommissioned 3.1
      messages: [
        {
          role: 'system',
          content: 'You are a helpful shopping assistant. Analyze products and rank them based on user requirements. Always respond with valid JSON only, no markdown.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in Groq response');
  }

  return parseAIResponse(content);
}

async function rankWithOpenAI(
  context: ProductContext,
  products: ProductData[],
  apiKey: string,
  userProfile?: UserProfile | null
): Promise<RankProductsResponse> {
  const prompt = buildPrompt(context, products, userProfile);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful shopping assistant. Analyze products and rank them based on user requirements. Always respond with valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  return parseAIResponse(content);
}

function buildPrompt(context: ProductContext, products: ProductData[], userProfile?: UserProfile | null): string {
  // Compact product format (saves ~40% tokens)
  const productList = products
    .map((p, i) => {
      const parts = [
        `[${i}] ${p.title.slice(0, 80)}`,
        p.price ? `$${p.price.toFixed(2)}` : '?',
        p.rating ? `${p.rating}★/${p.reviewCount?.toLocaleString() || '?'}` : 'unrated',
      ];
      if (p.features?.length) parts.push(p.features.slice(0, 3).join(', '));
      if (p.description) parts.push(p.description.slice(0, 100));
      return parts.join(' | ');
    })
    .join('\n');

  // Compact requirements
  const reqs = context.requirements.length > 0 
    ? context.requirements.map((r, i) => `R${i+1}: ${r}`).join('\n')
    : 'none specified';

  // Compact user profile with clear penalties
  let profileStr = '';
  if (userProfile) {
    const parts: string[] = [];
    if (userProfile.avoids?.length) parts.push(`AVOID (penalty -25 each): ${userProfile.avoids.slice(0, 5).join(', ')}`);
    if (userProfile.prefers?.length) parts.push(`PREFER (bonus +10 each): ${userProfile.prefers.slice(0, 5).join(', ')}`);
    if (userProfile.priceRange && userProfile.priceRange !== 'unknown') parts.push(`BUDGET: ${userProfile.priceRange}`);
    if (parts.length) profileStr = `\nUSER PROFILE:\n${parts.join('\n')}`;
  }

  // ChatGPT recommendations bonus
  let mentionedStr = '';
  if (context.mentionedProducts?.length) {
    mentionedStr = `\nChatGPT RECOMMENDED (bonus +15): ${context.mentionedProducts.slice(0, 3).join(', ')}`;
  }

  return `Rank products for: "${context.query}"

REQUIREMENTS (check each):
${reqs}
${profileStr}${mentionedStr}

PRODUCTS:
${productList}

SCORING RUBRIC (100 max):
+40 max: Requirements match (10 pts each met)
+25 max: User profile (+10 prefers, -25 avoids violation)
+20 max: Reviews (4.0★=10, 4.5★=15, 4.8★+=20)
+15 max: Value for price

PENALTIES (subtract from score):
-25: Contains AVOIDED material (plastic, synthetic, fake leather, PU, faux)
-15: No reviews/ratings
-10: Price way over budget

JSON response only:
{"rankings":[{"index":0,"score":85,"reasons":["R1 met","R2 met","contains plastic -25","4.5★ +15"]}],"summary":"one sentence verdict"}

Rules: score>50 only, max 5 products, cite specific features`;
}

function parseAIResponse(content: string): RankProductsResponse {
  try {
    // Clean the content in case there's markdown
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    }
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }

    const parsed = JSON.parse(cleaned);

    // Validate structure
    if (!parsed.rankings || !Array.isArray(parsed.rankings)) {
      throw new Error('Invalid response structure');
    }

    // Ensure proper types
    const rankings = parsed.rankings.map((r: any) => ({
      index: Number(r.index),
      score: Math.min(100, Math.max(0, Number(r.score))),
      reasons: Array.isArray(r.reasons) ? r.reasons.slice(0, 3) : [],
    }));

    return {
      rankings: rankings.sort((a: ProductRanking, b: ProductRanking) => b.score - a.score),
      summary: parsed.summary || 'Products ranked by match score.',
    };
  } catch (error) {
    console.error('Failed to parse AI response:', content);
    throw new Error('Failed to parse AI response');
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

