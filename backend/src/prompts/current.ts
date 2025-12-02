/**
 * CURRENT PROMPTS - Extracted for comparison testing
 */

export interface SiteAnalysisInput {
  url: string;
  title: string;
  description?: string;
  researchHistory: Array<{
    id: string;
    productName: string;
    query: string;
    requirements: string[];
  }>;
}

export interface ProductRankingInput {
  query: string;
  requirements: string[];
  products: Array<{
    title: string;
    price?: number;
    rating?: number;
    reviewCount?: number;
    description?: string;
    features?: string[];
  }>;
  userProfile?: {
    values: string[];
    avoids: string[];
    prefers: string[];
    priorities: string[];
    priceRange: string;
  };
}

export function buildCurrentSiteAnalysisPrompt(input: SiteAnalysisInput): string {
  const researchList = input.researchHistory
    .slice(0, 10)
    .map((r) => {
      const reqs = Array.isArray(r.requirements) ? r.requirements.slice(0, 3).join(', ') : '';
      return `[${r.id || 'unknown'}] "${r.productName || r.query || 'unknown'}" - Requirements: ${reqs || 'none specified'}`;
    })
    .join('\n');

  return `You are analyzing a website to determine if it's a shopping/e-commerce site and if it matches what a user previously researched.

## Website Info:
- URL: ${input.url}
- Page Title: ${input.title}
${input.description ? `- Meta Description: ${input.description}` : ''}

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
}

export function buildCurrentRankingPrompt(input: ProductRankingInput): string {
  const productList = input.products
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

  let userProfileContext = '';
  if (input.userProfile && (input.userProfile.values.length > 0 || input.userProfile.avoids.length > 0 || input.userProfile.prefers.length > 0)) {
    userProfileContext = `
## 🧠 USER PROFILE (learned from their research history):
${input.userProfile.values.length > 0 ? `• Values: ${input.userProfile.values.slice(0, 5).join(', ')}` : ''}
${input.userProfile.avoids.length > 0 ? `• AVOIDS (important!): ${input.userProfile.avoids.slice(0, 5).join(', ')}` : ''}
${input.userProfile.prefers.length > 0 ? `• Prefers: ${input.userProfile.prefers.slice(0, 5).join(', ')}` : ''}
${input.userProfile.priorities.length > 0 ? `• Priorities: ${input.userProfile.priorities.slice(0, 4).join(', ')}` : ''}
${input.userProfile.priceRange !== 'unknown' ? `• Price sensitivity: ${input.userProfile.priceRange}` : ''}

⚠️ CRITICAL: If a product contains something the user AVOIDS (synthetic, plastic, fake leather, etc.), PENALIZE heavily or exclude it!
`;
  }

  return `You are a sharp product analyst. User researched a product in ChatGPT and is now shopping. Help them decide.

## What they want:
"${input.query}"

## Their requirements:
${input.requirements.length > 0 ? input.requirements.map(r => `• ${r}`).join('\n') : '• (No specific requirements stated)'}
${userProfileContext}
## Products on this page:
${productList}

## Your analysis:
1. Does it match their SPECIFIC requirements? Check each one.
2. Does it CONFLICT with their user profile (things they avoid)? Red flag if so!
3. Does it align with their values (health-conscious, eco-friendly, etc.)?
4. Did ChatGPT mention this exact product? Huge plus if so.
5. Rating good? (4.0+ solid, 4.5+ great)
6. Price within their budget or expectations?

## Response (JSON only):
{
  "rankings": [
    { 
      "index": 0, 
      "score": 92, 
      "reasons": [
        "✓ ChatGPT specifically recommended this one",
        "✓ Real leather interior - matches preference for genuine materials",
        "✓ 4.6★ with 2,400 reviews - highly trusted",
        "⚠ Contains some plastic trim (user prefers to avoid)"
      ] 
    }
  ],
  "summary": "Quick 1-sentence verdict considering user's values"
}

Rules:
- Score 0-100 based on requirement match + user profile fit + reviews + value
- PENALIZE products that contain things user explicitly avoids
- BONUS for products matching user preferences (real leather, natural materials, etc.)
- BONUS points if ChatGPT mentioned this product
- Only products scoring 50+
- Max 5 products
- Be specific: cite actual features, prices, materials`;
}

// Token counting utility (approximate)
export function countTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters for English
  return Math.ceil(text.length / 4);
}

