# Vision: Honey for AI Shopping Research

**One-liner:** A lightweight Chrome extension that silently captures your ChatGPT product research and **automatically** surfaces the best matching products when you land on ANY shopping site.

---

## Core Experience (Honey-style)

```
1. PASSIVE: Extension silently watches ChatGPT conversations
   - No user action required
   - Captures product requirements in background
   - Always running, zero friction
   - Builds history of researched products
   
2. AUTOMATIC MATCHING: AI determines when you're shopping for something you researched
   - No store selection or manual matching required
   - Works on ANY e-commerce site
   - Matches products based on context (category, keywords, requirements)
   
3. TRIGGER: User visits any shopping site/product page
   - AI detects: "This looks like the espresso machine they researched"
   - Automatically activates when context matches
   
4. POP-UP: Overlay appears (like Honey finding coupons)
   
   ┌─────────────────────────────────────────┐
   │ 🎯 Found 3 products matching your needs │
   │                                         │
   │ Based on your research:                 │
   │ "espresso machine, no plastic, <$500"   │
   │                                         │
   │ #1 Breville BES870 - 94% match    →     │
   │ #2 Gaggia Classic Pro - 87% match →     │
   │ #3 Rancilio Silvia - 82% match    →     │
   │                                         │
   │ [View All]  [Dismiss]                   │
   └─────────────────────────────────────────┘

5. FAST: Results in <2 seconds
```

---

## Key Principles

| Principle | What it means |
|-----------|---------------|
| **Fully automatic** | NEVER ask user to choose/select stores - AI matches automatically |
| **Silent until useful** | Never interrupts, only helps when relevant |
| **Context-aware** | Knows what you researched in ChatGPT |
| **Works everywhere** | Any e-commerce site, not hardcoded list |
| **Fast** | Instant results, no loading spinners |
| **Simple** | One overlay, clear ranking, done |

---

## Original Concept (for reference)

Goal: chrome extension that connects to (via login) chatgpt convo/chat of user researching a product in a chrome tab, then when user clicks on link suggested by llm in that chat, the chrome extension uses ai to do research on the actual currently existing products using the live/updated/current context of that chat (and if possible of the user--if all convos are pullable/scrapable from chatgpt) to determine which actual currently-live existing products on the site are best for the user (ex: user wants an espresso machine without plastic, heavy metals, at certain price point, etc)
