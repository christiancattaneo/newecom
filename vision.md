# Vision: Honey for AI Shopping Research

**One-liner:** A lightweight Chrome extension that silently captures your ChatGPT product research and automatically surfaces the best matching products when you land on a shopping site.

---

## Core Experience (Honey-style)

```
1. PASSIVE: Extension silently watches ChatGPT conversations
   - No user action required
   - Captures product requirements in background
   - Always running, zero friction
   
2. TRIGGER: User clicks link in chat OR navigates to shopping site
   - Amazon, Best Buy, Target, Walmart, etc.
   
3. POP-UP: Overlay appears (like Honey finding coupons)
   
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

4. FAST: Results in <2 seconds
```

---

## Key Principles

| Principle | What it means |
|-----------|---------------|
| **Silent until useful** | Never interrupts, only helps when relevant |
| **Context-aware** | Knows what you researched in ChatGPT |
| **Store-specific** | Shows products FROM the current site only |
| **Fast** | Instant results, no loading spinners |
| **Simple** | One overlay, clear ranking, done |

---

## Original Concept (for reference)

Goal: chrome extension that connects to (via login) chatgpt convo/chat of user researching a product in a chrome tab, then when user clicks on link suggested by llm in that chat, the chrome extension uses ai to do research on the actual currently existing products using the live/updated/current context of that chat (and if possible of the user--if all convos are pullable/scrapable from chatgpt) to determine which actual currently-live existing products on the site are best for the user (ex: user wants an espresso machine without plastic, heavy metals, at certain price point, etc)
