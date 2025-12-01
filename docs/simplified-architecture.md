# Simplified Architecture: Honey-Style Extension

## Design Philosophy

**Be like Honey, not like a complex app.**

| Honey | Our Extension |
|-------|---------------|
| Silently watches for checkout pages | Silently watches ChatGPT for product research |
| Pops up when coupons found | Pops up when matching products found |
| One-click to apply | One-click to view product |
| Fast, non-intrusive | Fast, non-intrusive |

---

## Simplified Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER JOURNEY                              │
└──────────────────────────────────────────────────────────────────┘

  ChatGPT Tab                              Shopping Tab
  ──────────                               ────────────
       │                                        │
       │  User researches product               │
       │  "I need an espresso machine           │
       │   without plastic, under $500"         │
       │                                        │
       ▼                                        │
  ┌─────────────┐                               │
  │ Extension   │  ← Silently captures context  │
  │ (passive)   │                               │
  └─────────────┘                               │
       │                                        │
       │  User clicks link / navigates ─────────┤
       │                                        │
       │                                        ▼
       │                               ┌─────────────────┐
       │                               │  Amazon.com     │
       │                               │  /espresso      │
       └──────────────────────────────►│                 │
                                       │  ┌───────────┐  │
           Context sent to             │  │ POP-UP    │  │
           analyze products            │  │ "3 match" │  │
                                       │  └───────────┘  │
                                       └─────────────────┘
```

---

## Technical Simplification

### What We DON'T Need (MVP)
- ❌ User accounts / login
- ❌ Complex popup UI
- ❌ Settings page
- ❌ History tracking
- ❌ Cross-site comparison
- ❌ Price alerts
- ❌ Wishlists

### What We DO Need (MVP)
- ✅ Content script on ChatGPT (capture context)
- ✅ Content script on shopping sites (show overlay)
- ✅ Service worker (coordinate + API calls)
- ✅ Simple overlay UI
- ✅ OpenAI API integration

---

## Minimal Extension Structure

```
extension/
├── manifest.json           # Permissions, scripts
├── src/
│   ├── background.ts       # Service worker - orchestration
│   ├── chatgpt.ts          # Content script - capture context
│   ├── shopping.ts         # Content script - show overlay
│   ├── overlay.tsx         # The popup UI component
│   └── api.ts              # OpenAI calls
└── styles/
    └── overlay.css         # Minimal styling
```

---

## Data Flow (Simplified)

```typescript
// 1. ChatGPT content script captures context
interface CapturedContext {
  query: string;           // "espresso machine"
  requirements: string[];  // ["no plastic", "under $500", "durable"]
  timestamp: number;
}

// 2. Service worker stores it
chrome.storage.session.set({ context: capturedContext });

// 3. Shopping site content script retrieves & analyzes
const context = await chrome.storage.session.get('context');
const products = await scrapeCurrentPage();
const ranked = await rankProducts(context, products);

// 4. Show overlay with results
showOverlay(ranked);
```

---

## API Calls (Minimal)

### Single Endpoint: Rank Products

```typescript
POST /api/rank-products

Request:
{
  "context": {
    "query": "espresso machine",
    "requirements": ["no plastic", "under $500", "durable"]
  },
  "products": [
    { "title": "...", "price": 449, "description": "...", "url": "..." },
    { "title": "...", "price": 599, "description": "...", "url": "..." }
  ]
}

Response:
{
  "rankings": [
    { "index": 0, "score": 94, "reasons": ["Steel construction", "Within budget"] },
    { "index": 1, "score": 72, "reasons": ["Over budget", "Great durability"] }
  ],
  "summary": "Based on your need for no plastic under $500"
}
```

---

## Overlay UI (Honey-inspired)

```
┌────────────────────────────────────────────────┐
│ 🎯 ProductMatch                           [×]  │
├────────────────────────────────────────────────┤
│                                                │
│  Your search: "espresso machine, no plastic"   │
│                                                │
│  Best matches on this page:                    │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ 1. Breville Barista Express              │  │
│  │    ████████████░░░ 94% match             │  │
│  │    ✓ All-metal  ✓ $449  ✓ 4.7★          │  │
│  │                              [View →]    │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ 2. Gaggia Classic Pro                    │  │
│  │    ██████████░░░░░ 87% match             │  │
│  │    ✓ Steel body  ⚠ $529  ✓ 4.5★         │  │
│  │                              [View →]    │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ 3. De'Longhi Dedica                      │  │
│  │    ████████░░░░░░░ 76% match             │  │
│  │    ⚠ Some plastic  ✓ $349  ✓ 4.3★       │  │
│  │                              [View →]    │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  [Show More]              Powered by AI        │
└────────────────────────────────────────────────┘
```

**Position:** Bottom-right corner, slides in  
**Behavior:** Auto-dismiss after 10s if no interaction  
**Animation:** Smooth slide-in from right

---

## Speed Optimizations

| Optimization | Implementation |
|--------------|----------------|
| **Pre-fetch** | Start analyzing when user hovers over link |
| **Cache** | Cache context extraction results |
| **Parallel** | Scrape page + call API simultaneously |
| **Streaming** | Show overlay immediately, update as results come |
| **Lightweight** | Minimal DOM manipulation |

**Target:** < 2 seconds from page load to overlay

---

## MVP Timeline (4 Weeks)

### Week 1: Foundation
- [ ] Extension scaffold (Manifest V3)
- [ ] ChatGPT content script (context capture)
- [ ] Basic service worker

### Week 2: Shopping Integration  
- [ ] Shopping site content script
- [ ] Product scraping (Amazon first)
- [ ] OpenAI integration

### Week 3: Overlay UI
- [ ] Slide-in overlay component
- [ ] Product ranking display
- [ ] Click-to-navigate

### Week 4: Polish & Test
- [ ] Speed optimization
- [ ] Error handling
- [ ] Chrome Web Store prep

---

## Cost (Simplified)

```
Per ranking request: ~$0.005 (GPT-4.1-mini)
Per user per day:    ~2 requests = $0.01
Per user per month:  ~$0.30

Free tier viable:    Yes (10 rankings/day free)
Monetization:        Affiliate links on ranked products
```

---

## Success = Simplicity

**If it feels complicated, we're doing it wrong.**

The extension should:
1. Install in 1 click
2. Work immediately (no setup)
3. Be invisible until helpful
4. Show results instantly
5. Get out of the way

That's it.

