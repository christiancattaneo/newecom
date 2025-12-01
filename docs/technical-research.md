# Technical Research: Stack & Tools Selection

## 1. AI/LLM API Comparison for Speed

**Our requirement:** < 2 seconds total response time, including network + inference

### Speed Champions (Ranked)

| Provider | Model | Speed | Cost (per 1M tokens) | Quality | Best For |
|----------|-------|-------|---------------------|---------|----------|
| **🥇 Groq** | Llama 3.1 70B | ~500 tok/sec | $0.59 in / $0.79 out | Good | **FASTEST inference** |
| **🥇 Groq** | Llama 3.1 8B | ~750 tok/sec | $0.05 in / $0.08 out | Decent | Ultra-fast, simple tasks |
| **🥈 Google** | Gemini 2.0 Flash | ~150 tok/sec | $0.075 in / $0.30 out | Good | Fast + multimodal |
| **🥈 Google** | Gemini 1.5 Flash | ~200 tok/sec | $0.075 in / $0.30 out | Good | Battle-tested speed |
| **🥉 OpenAI** | GPT-4o-mini | ~100 tok/sec | $0.15 in / $0.60 out | Great | Best quality/speed balance |
| **🥉 OpenAI** | GPT-4o | ~80 tok/sec | $2.50 in / $10 out | Excellent | When quality matters most |
| Anthropic | Claude 3.5 Haiku | ~100 tok/sec | $0.25 in / $1.25 out | Great | Structured output |
| Anthropic | Claude 3.5 Sonnet | ~60 tok/sec | $3 in / $15 out | Excellent | Complex reasoning |

### Latency Breakdown (Time to First Token)

| Provider | Model | TTFT | Notes |
|----------|-------|------|-------|
| **Groq** | Llama 3.1 | ~100-200ms | Custom LPU hardware |
| **Gemini Flash** | 2.0 Flash | ~200-400ms | Optimized for speed |
| **GPT-4o-mini** | - | ~300-500ms | Good balance |
| Claude Haiku | 3.5 | ~400-600ms | Consistent |

### 🏆 Recommendation: **Groq (Primary) + GPT-4o-mini (Fallback)**

```
Why Groq:
- 3-5x faster than competitors
- Cheaper than OpenAI
- Good enough quality for product ranking
- ~$0.003 per analysis

Why GPT-4o-mini fallback:
- Better reasoning when needed
- More reliable uptime
- Slightly higher quality
```

### Cost Comparison (Per Product Analysis)

```
Input:  ~1500 tokens (context + products)
Output: ~300 tokens (rankings)

Groq Llama 3.1 70B:   $0.0009 + $0.0002 = $0.0011
Gemini 2.0 Flash:     $0.0001 + $0.0001 = $0.0002
GPT-4o-mini:          $0.0002 + $0.0002 = $0.0004
GPT-4o:               $0.0038 + $0.0030 = $0.0068

Winner for cost: Gemini Flash
Winner for speed: Groq
Winner for quality: GPT-4o-mini
Best balance: Groq or GPT-4o-mini
```

---

## 2. Chrome Extension Framework Comparison

### Framework Options

| Framework | Stars | DX | Build Speed | TypeScript | React | Manifest V3 |
|-----------|-------|-----|-------------|------------|-------|-------------|
| **🥇 WXT** | 5k+ | ⭐⭐⭐⭐⭐ | Fast (Vite) | Native | Optional | ✅ |
| **🥈 Plasmo** | 10k+ | ⭐⭐⭐⭐ | Medium | Good | Native | ✅ |
| CRXJS | 2k+ | ⭐⭐⭐ | Fast (Vite) | Plugin | Optional | ✅ |
| Vanilla | - | ⭐⭐ | Manual | Manual | Manual | ✅ |

### WXT (Recommended)

```typescript
// Why WXT:
// 1. Vite-powered = instant HMR
// 2. TypeScript-first
// 3. Auto-reloads extension on save
// 4. Built-in support for content scripts, background, popup
// 5. Framework-agnostic (React, Vue, Svelte, or vanilla)
// 6. Excellent documentation

// Example structure:
wxt.config.ts
entrypoints/
  ├── background.ts      // Service worker
  ├── chatgpt.content.ts // ChatGPT content script
  ├── shopping.content.ts // Shopping site overlay
  └── popup/
      ├── index.html
      └── main.ts
```

### Plasmo (Alternative)

```typescript
// Why Plasmo:
// 1. Larger community
// 2. React-first
// 3. Good for complex UIs
// 4. More examples available

// Trade-offs:
// - Slower builds than WXT
// - More opinionated
// - Heavier
```

### 🏆 Recommendation: **WXT**

```
Reasons:
1. Fastest build times (Vite)
2. TypeScript-native
3. Minimal boilerplate
4. Framework flexibility
5. Perfect for our "simple & fast" philosophy
```

---

## 3. Recommended Stack

### Extension (Frontend)

| Layer | Technology | Why |
|-------|------------|-----|
| Framework | **WXT** | Fast builds, TypeScript, minimal |
| Language | **TypeScript** | Type safety, better DX |
| UI | **Vanilla JS + CSS** | Fastest, smallest bundle |
| Styling | **Tailwind CSS** (optional) | Utility classes, tree-shaking |
| State | **chrome.storage.session** | Built-in, persists across tabs |

### Backend (API)

| Layer | Technology | Why |
|-------|------------|-----|
| Runtime | **Cloudflare Workers** | Edge = fast, cheap, simple |
| Alternative | **Firebase Functions** | If need Firestore |
| Language | **TypeScript** | Consistency |
| AI | **Groq API** | Speed |
| Fallback | **GPT-4o-mini** | Quality |

### Why Cloudflare Workers over Firebase?

```
Cloudflare Workers:
+ Edge deployment (faster globally)
+ 100K requests/day FREE
+ Sub-10ms cold starts
+ Simpler deployment
+ Built-in KV storage

Firebase Functions:
+ Firestore integration
+ Better for complex apps
- Cold starts (1-2 seconds)
- More expensive at scale
```

---

## 4. Speed Optimization Strategies

### Pre-computation
```typescript
// Start API call when user hovers over link (before click)
link.addEventListener('mouseenter', () => {
  prefetchAnalysis(getContext(), link.href);
});
```

### Streaming Responses
```typescript
// Show overlay immediately, stream results
const stream = await groq.chat.completions.create({
  stream: true,
  // ...
});

for await (const chunk of stream) {
  updateOverlay(chunk);
}
```

### Caching
```typescript
// Cache context extraction (doesn't change often)
const contextKey = hashConversation(conversation);
const cached = await chrome.storage.session.get(contextKey);
if (cached) return cached;
```

### Parallel Requests
```typescript
// Scrape page + call AI simultaneously
const [pageData, context] = await Promise.all([
  scrapePage(),
  getStoredContext()
]);
```

---

## 5. Architecture Decision

### Option A: Direct API Calls (Simpler, faster for MVP)

```
Extension ──► Groq API
         └─► (API key in extension - less secure)
```

**Pros:** Simpler, no backend to maintain
**Cons:** API key exposed, no rate limiting

### Option B: Backend Proxy (More secure, scalable)

```
Extension ──► Cloudflare Worker ──► Groq API
```

**Pros:** Secure, rate limiting, usage tracking
**Cons:** Additional latency (~20-50ms)

### 🏆 Recommendation: **Option B (Cloudflare Worker)**

Even with extra latency, benefits outweigh:
- API key never exposed
- Can switch AI providers without extension update
- Rate limiting prevents abuse
- Usage analytics

---

## 6. Final Stack Recommendation

```
┌─────────────────────────────────────────────────────┐
│                   EXTENSION                          │
│  WXT + TypeScript + Vanilla JS/CSS                  │
│  - chatgpt.content.ts (capture)                     │
│  - shopping.content.ts (overlay)                    │
│  - background.ts (orchestration)                    │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS
                     ▼
┌─────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKER                       │
│  TypeScript                                         │
│  - /api/rank-products                               │
│  - Rate limiting                                    │
│  - KV for caching                                   │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│                 GROQ API                             │
│  Llama 3.1 70B                                      │
│  ~500 tokens/sec                                    │
│  ~$0.001/analysis                                   │
└─────────────────────────────────────────────────────┘
```

---

## 7. MVP Timeline with This Stack

| Week | Focus | Stack Component |
|------|-------|-----------------|
| 1 | Extension scaffold | WXT setup, content scripts |
| 2 | ChatGPT capture | DOM scraping, storage |
| 3 | Backend + AI | Cloudflare Worker + Groq |
| 4 | Overlay UI | Vanilla JS overlay |

**Total: 4 weeks to functional prototype**

---

## 8. Cost Projections

### Free Tier Limits

| Service | Free Tier |
|---------|-----------|
| Cloudflare Workers | 100K requests/day |
| Groq | $0 (pay as you go) |
| Chrome Web Store | $5 one-time |

### Per-User Costs

```
5 analyses/day × 30 days = 150 analyses/month
150 × $0.001 = $0.15/user/month

1,000 users = $150/month
10,000 users = $1,500/month
```

### Break-even

```
At $5/month subscription:
Break-even = 30 paying users (covers 1000 free users)
```

