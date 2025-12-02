/**
 * IMPROVED PROMPTS - Optimized versions for comparison testing
 * 
 * Key improvements:
 * 1. Compressed token usage (removed redundant text)
 * 2. Explicit scoring rubric (deterministic scoring)
 * 3. Chain-of-thought reasoning (better accuracy)
 * 4. Negative examples (prevent common errors)
 * 5. Structured decision tree (faster processing)
 */

import { SiteAnalysisInput, ProductRankingInput, countTokens } from './current';

/**
 * IMPROVED SITE ANALYSIS PROMPT
 * 
 * Changes:
 * - Removed verbose explanations
 * - Added decision tree structure
 * - Moved examples to be more compact
 * - Added explicit non-shopping indicators
 */
export function buildImprovedSiteAnalysisPrompt(input: SiteAnalysisInput): string {
  const researchList = input.researchHistory
    .slice(0, 8)
    .map((r) => `• [${r.id}] ${r.productName || r.query}`)
    .join('\n');

  return `Analyze if this website is an e-commerce site where users can BUY products.

URL: ${input.url}
Title: ${input.title}
${input.description ? `Description: ${input.description.slice(0, 150)}` : ''}

User's product research:
${researchList}

STEP 1 - Is this a SHOPPING site? Check for:
✓ SHOPPING indicators: "add to cart", "buy now", product listings with prices, checkout, shopping cart
✗ NOT SHOPPING: blog, news, Wikipedia, health info sites (WebMD, Healthline, Mayo Clinic), forums, social media, educational content, reviews-only sites

CRITICAL: Sites like healthline.com, webmd.com, mayoclinic.org are HEALTH INFO sites, NOT shopping sites!
If the URL contains: healthline, webmd, mayoclinic, wikipedia, medium, reddit, quora → isShoppingSite = false

STEP 2 - If shopping=true, does category match user research?
Match examples: "water filter" ↔ plumbing/bathroom/filtration ✓
Mismatch: "laptop" ↔ furniture ✗

JSON response only:
{"isShoppingSite":bool,"siteCategory":"category or null","matchedResearchId":"id or null","matchScore":0-100,"matchReason":"<15 words"}`;
}

/**
 * IMPROVED PRODUCT RANKING PROMPT
 * 
 * Changes:
 * - Explicit scoring rubric with point values
 * - Penalty system clearly defined
 * - Chain-of-thought format
 * - Removed emoji fluff
 * - Compressed product format
 */
export function buildImprovedRankingPrompt(input: ProductRankingInput): string {
  // Compact product format
  const productList = input.products
    .map((p, i) => {
      const parts = [
        `[${i}] ${p.title.slice(0, 80)}`,
        p.price ? `$${p.price}` : '?',
        p.rating ? `${p.rating}★/${p.reviewCount || '?'}` : 'unrated',
      ];
      if (p.features?.length) parts.push(p.features.slice(0, 3).join(', '));
      return parts.join(' | ');
    })
    .join('\n');

  // Compact requirements
  const reqs = input.requirements.length > 0 
    ? input.requirements.join(', ') 
    : 'none specified';

  // Compact user profile
  let profileStr = '';
  if (input.userProfile) {
    const parts: string[] = [];
    if (input.userProfile.avoids.length) parts.push(`AVOID: ${input.userProfile.avoids.slice(0, 4).join(', ')}`);
    if (input.userProfile.prefers.length) parts.push(`PREFER: ${input.userProfile.prefers.slice(0, 4).join(', ')}`);
    if (input.userProfile.priceRange !== 'unknown') parts.push(`BUDGET: ${input.userProfile.priceRange}`);
    if (parts.length) profileStr = `\nProfile: ${parts.join(' | ')}`;
  }

  return `Rank products for: "${input.query}"
Requirements: ${reqs}${profileStr}

Products:
${productList}

SCORING RUBRIC (100 total):
+40 max: Requirements match (10 pts each requirement met)
+25 max: User profile fit (+15 prefers match, -20 avoids violation)
+20 max: Reviews (4.0★=10, 4.5★=15, 4.8★+=20)
+15 max: Value (good price for category)

PENALTIES:
-30: Contains avoided material (plastic, synthetic, fake)
-15: No reviews/ratings
-10: Price >50% over typical

Output JSON:
{"rankings":[{"index":0,"score":85,"reasons":["requirement X met","avoids Y - penalty","4.5★ trusted"]}],"summary":"one sentence"}

Rules: score>50 only, max 5 products, cite specific features/prices`;
}

/**
 * V2: Even more compressed - for testing minimum viable prompt
 */
export function buildMinimalSiteAnalysisPrompt(input: SiteAnalysisInput): string {
  const research = input.researchHistory.slice(0, 5).map(r => r.productName || r.query).join(', ');
  
  return `Is "${input.url}" (title: "${input.title}") a shopping site? Does it sell: ${research}?
JSON: {"isShoppingSite":bool,"matchedResearchId":"id|null","matchScore":0-100,"matchReason":"brief"}`;
}

/**
 * V2: Minimal ranking prompt
 */
export function buildMinimalRankingPrompt(input: ProductRankingInput): string {
  const products = input.products.map((p, i) => 
    `${i}:${p.title.slice(0, 50)}|$${p.price || '?'}|${p.rating || '?'}★`
  ).join('\n');

  const avoid = input.userProfile?.avoids.join(',') || '';
  
  return `Rank for "${input.query}" (avoid: ${avoid}):
${products}
JSON: {"rankings":[{"index":0,"score":0-100,"reasons":["..."]}],"summary":"..."}`;
}

/**
 * V3: Chain-of-thought prompt for better reasoning
 */
export function buildCoTRankingPrompt(input: ProductRankingInput): string {
  const productList = input.products
    .map((p, i) => {
      return `[${i}] ${p.title} - $${p.price || '?'} - ${p.rating || '?'}★ (${p.reviewCount || '?'} reviews)
   ${p.description?.slice(0, 150) || ''}`;
    })
    .join('\n');

  const reqs = input.requirements.map((r, i) => `R${i+1}: ${r}`).join('\n');
  
  let avoidStr = '';
  if (input.userProfile?.avoids.length) {
    avoidStr = `\n\nUSER AVOIDS (penalize -25 each): ${input.userProfile.avoids.join(', ')}`;
  }

  return `You are ranking products for: "${input.query}"

REQUIREMENTS (check each):
${reqs}
${avoidStr}

PRODUCTS:
${productList}

Think step by step for each product:
1. List which requirements it meets (R1, R2, etc.)
2. Check if it contains anything user avoids → heavy penalty
3. Evaluate rating/reviews
4. Calculate final score

Then output JSON:
{
  "thinking": [
    {"product": 0, "meets": ["R1", "R3"], "violates": [], "rating_bonus": 15, "final": 75},
    ...
  ],
  "rankings": [{"index": 0, "score": 75, "reasons": ["meets R1, R3", "4.5★ trusted"]}],
  "summary": "Best pick because..."
}`;
}

// Comparison utilities
export function comparePromptStats(name: string, promptFn: (input: any) => string, input: any) {
  const prompt = promptFn(input);
  const tokens = countTokens(prompt);
  const lines = prompt.split('\n').length;
  
  return {
    name,
    tokens,
    lines,
    charsPerLine: Math.round(prompt.length / lines),
    prompt: prompt.slice(0, 200) + '...',
  };
}

