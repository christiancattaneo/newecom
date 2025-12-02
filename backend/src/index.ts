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

interface RankProductsRequest {
  context: ProductContext;
  products: ProductData[];
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
    return jsonResponse({ error: 'Service not configured' }, 500);
  }

  let body: AnalyzeSiteRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body.url || !body.title) {
    return jsonResponse({ error: 'Missing url or title' }, 400);
  }

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
  // Build the research history for the prompt
  const researchList = request.researchHistory
    .slice(0, 10)
    .map((r, i) => `[${r.id}] "${r.productName}" - Requirements: ${r.requirements.slice(0, 3).join(', ') || 'none specified'}`)
    .join('\n');

  const prompt = `You are analyzing a website to determine if it's a shopping/e-commerce site and if it matches what a user previously researched.

## Website Info:
- URL: ${request.url}
- Page Title: ${request.title}
${request.description ? `- Meta Description: ${request.description}` : ''}

## User's Previous Product Research:
${researchList}

## Your Task:
1. Is this a shopping/e-commerce site where users can buy products? (Not just a blog, news site, or informational page)
2. If yes, what product category does this page/site sell?
3. Does this match ANY of the user's research items? Match by product category, not exact words.

Examples of MATCHES:
- Research "shower water filter" → Site selling "bathroom fixtures" or "water filtration" = MATCH
- Research "espresso machine" → Site selling "coffee equipment" or "kitchen appliances" = MATCH
- Research "running shoes" → Site selling "athletic footwear" or "sports gear" = MATCH

Examples of NON-MATCHES:
- Research "laptop" → Site selling "furniture" = NO MATCH
- Research "water filter" → Blog about water quality = NO MATCH (not a shopping site)
- Research "headphones" → Amazon homepage with no search = WEAK MATCH (too generic)

## Response (JSON only):
{
  "isShoppingSite": true/false,
  "siteCategory": "what this site/page sells",
  "matchedResearchId": "ID from research list if matched, or null",
  "matchScore": 0-100,
  "matchReason": "brief explanation"
}

Be smart about fuzzy matching - "bathroom water filter" matches "shower filter research".
Only return matchScore > 50 if there's a genuine category/product match.`;

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
    const result = await rankWithGroq(body.context, products, env.GROQ_API_KEY);
    return jsonResponse(result);
  } catch (groqError) {
    console.error('Groq error:', groqError);
    
    // Try OpenAI fallback if available
    if (env.OPENAI_API_KEY) {
      try {
        const result = await rankWithOpenAI(body.context, products, env.OPENAI_API_KEY);
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
  apiKey: string
): Promise<RankProductsResponse> {
  const prompt = buildPrompt(context, products);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-70b-versatile',
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
  apiKey: string
): Promise<RankProductsResponse> {
  const prompt = buildPrompt(context, products);

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

function buildPrompt(context: ProductContext, products: ProductData[]): string {
  const productList = products
    .map((p, i) => {
      const priceStr = p.price ? `$${p.price.toFixed(2)}` : 'Price unknown';
      const ratingStr = p.rating ? `${p.rating}★ (${p.reviewCount?.toLocaleString() || '?'} reviews)` : 'No rating';
      const featuresStr = p.features?.length ? `Features: ${p.features.slice(0, 4).join('; ')}` : '';
      
      return `[${i}] ${p.title}
    Price: ${priceStr}
    Rating: ${ratingStr}
    ${p.description ? `Info: ${p.description.slice(0, 200)}` : ''}
    ${featuresStr}`;
    })
    .join('\n\n');

  // Build conversation context if available
  let conversationContext = '';
  if (context.recentMessages && context.recentMessages.length > 0) {
    conversationContext = `
## Their research conversation:
${context.recentMessages.map(m => `${m.role === 'user' ? 'USER' : 'AI'}: ${m.content.slice(0, 300)}${m.content.length > 300 ? '...' : ''}`).join('\n')}
`;
  }

  // Products mentioned by ChatGPT
  let mentionedContext = '';
  if (context.mentionedProducts && context.mentionedProducts.length > 0) {
    mentionedContext = `
## Products ChatGPT recommended:
${context.mentionedProducts.slice(0, 5).map(p => `• ${p}`).join('\n')}
(If any of these are available, note the match!)
`;
  }

  return `You are a sharp product analyst. User researched a product in ChatGPT and is now shopping. Help them decide.

## What they want:
"${context.query}"

## Their requirements:
${context.requirements.length > 0 ? context.requirements.map(r => `• ${r}`).join('\n') : '• (No specific requirements stated)'}
${conversationContext}${mentionedContext}
## Products on this page:
${productList}

## Your analysis:
1. Does it match their SPECIFIC requirements? Check each one.
2. Did ChatGPT mention this exact product? Huge plus if so.
3. Rating good? (4.0+ solid, 4.5+ great)
4. Enough reviews? (100+ decent, 1000+ reliable)
5. Price within their budget or expectations?

## Response (JSON only):
{
  "rankings": [
    { 
      "index": 0, 
      "score": 92, 
      "reasons": [
        "✓ ChatGPT specifically recommended this one",
        "✓ 4.6★ with 2,400 reviews - highly trusted",
        "✓ Description confirms fluoride removal",
        "⚠ $45 is reasonable for quality"
      ] 
    }
  ],
  "summary": "Quick 1-sentence verdict"
}

Rules:
- Score 0-100 based on requirement match + reviews + value
- BONUS points if ChatGPT mentioned this product
- Only products scoring 50+
- Max 5 products
- Be specific: cite actual features, prices, ratings`;
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

