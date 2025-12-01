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

  return `You are a sharp product analyst. User researched a product and now is shopping. Help them decide.

## What they want:
"${context.query}"

## Their requirements:
${context.requirements.length > 0 ? context.requirements.map(r => `• ${r}`).join('\n') : '• (No specific requirements stated)'}

## Products available:
${productList}

## Analyze each product:
1. Does it match their requirements? Check EACH requirement.
2. Is the rating good? (4.0+ is solid, 4.5+ is great)
3. Enough reviews to trust? (100+ is decent, 1000+ is reliable)
4. Price reasonable for what they get?

## Response (JSON only):
{
  "rankings": [
    { 
      "index": 0, 
      "score": 85, 
      "reasons": [
        "✓ 4.6★ with 2,400 reviews - highly trusted",
        "✓ Specifically mentions fluoride removal",
        "⚠ At $45, slightly above budget but justified"
      ] 
    }
  ],
  "summary": "Quick 1-sentence verdict on best pick"
}

Rules:
- Score 0-100 based on requirement match + reviews + value
- Only products scoring 50+ 
- Max 5 products
- Be specific: cite actual features, prices, ratings
- Reasons should directly reference their requirements`;
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

