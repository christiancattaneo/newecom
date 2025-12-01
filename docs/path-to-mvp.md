# Path to MVP: Executive Summary

## TL;DR

**Can we build this? YES, with modifications.**

The original vision of "connecting to ChatGPT" isn't possible via official API, but we can achieve the same outcome through DOM scraping (fragile but works) or by building our own chat interface (more robust).

---

## Recommended Approach

### Start Here: "ChatGPT Companion" Extension

```
Week 1-2:  Foundation & Setup
Week 3-4:  ChatGPT context capture (DOM scraping)  
Week 5-6:  Product page analysis (AI-powered)
Week 7-8:  UI & user experience
Week 9-10: Testing & Chrome Web Store launch
```

**Total: ~10 weeks to functional MVP**

---

## Key Technical Decisions

### 1. How to get ChatGPT context?
**→ DOM Scraping** (MVP) with manual fallback

```
Pros: Works now, captures real conversation
Cons: Fragile, may break with ChatGPT updates
Plan: Build robust selectors, monitor for changes
```

### 2. How to analyze products?
**→ Hybrid approach**

```
1. Extract structured data (JSON-LD) - FREE, fast
2. Parse HTML with site-specific selectors - FREE, reliable
3. Fall back to LLM analysis - ~$0.003/page
```

### 3. Where to call OpenAI?
**→ Backend (Firebase Cloud Functions)**

```
Reasons:
- API keys never exposed to browser
- Rate limiting enforced server-side
- Usage tracking for billing
- Can cache responses
```

### 4. How to monetize?
**→ Freemium model**

```
Free:  5 analyses/day
Pro:   Unlimited @ $5/month

Break-even: ~250 paying users
```

---

## What Makes This Work

| Component | Solution | Confidence |
|-----------|----------|------------|
| Get user's requirements | Parse ChatGPT conversation | 🟡 MEDIUM (fragile) |
| Know when to activate | Detect navigation from ChatGPT | 🟢 HIGH |
| Understand products | AI + structured data extraction | 🟢 HIGH |
| Show useful results | Overlay UI on product pages | 🟢 HIGH |

---

## What Could Kill This

1. **ChatGPT DOM changes frequently** → Need monitoring + quick updates
2. **OpenAI blocks extension** → Unlikely if we're respectful
3. **E-commerce sites block scraping** → Multiple fallback strategies
4. **Users don't find it valuable** → MVP validation critical

---

## Next Steps

1. **Create project structure** (this session)
2. **Build extension scaffold** with Manifest V3
3. **Implement ChatGPT content script** first (highest risk)
4. **Validate with 5-10 beta users** before full build

---

## Quick Cost Math

```
Per analysis:     ~$0.006 (OpenAI)
Per user/month:   ~$0.12 (20 analyses)
Free tier cost:   $120/month @ 1000 users
Revenue needed:   24 paying users @ $5 = $120

Verdict: Sustainable with modest conversion
```

---

## Alternative Paths

If ChatGPT integration proves too fragile:

### Option B: Standalone AI Shopping Assistant
- Build our own chat interface
- Use OpenAI API directly (reliable)
- Same product analysis features
- No ChatGPT dependency

### Option C: Browser-Wide Context
- Track all shopping-related browsing
- Build user profile from behavior
- Less accurate but more robust

---

## Go/No-Go Checklist

Before building, validate:

- [ ] Can we reliably extract ChatGPT conversations? (build prototype)
- [ ] Do users actually want this? (user interviews)
- [ ] Can we parse major e-commerce sites? (build parsers)
- [ ] Is the value prop clear? (landing page test)

**Recommendation: Build weeks 1-4 as spike to validate feasibility before full commitment.**

