# Path to MVP: Honey-Style Extension

## The Product in One Sentence

**"Honey for AI shopping research"** - silently captures your ChatGPT product research, pops up with best matches when you land on a shopping site.

---

## Core Loop

```
ChatGPT: User researches "espresso machine, no plastic, <$500"
            │
            │  Extension silently captures context
            ▼
User: Clicks link or goes to Amazon
            │
            │  Extension activates
            ▼
Overlay: "🎯 3 products match your needs"
         #1 Breville - 94% match [View]
         #2 Gaggia - 87% match [View]
```

**Time to value: < 2 seconds**

---

## 4-Week Build Plan

| Week | Focus | Deliverable |
|------|-------|-------------|
| **1** | Foundation | Extension captures ChatGPT context |
| **2** | Shopping | Scrapes products, calls AI, gets rankings |
| **3** | UI | Honey-style overlay slides in |
| **4** | Polish | Speed, errors, Chrome Web Store |

---

## What We're Building (Minimal)

```
extension/
├── manifest.json        # Permissions
├── background.ts        # Orchestration
├── chatgpt.ts          # Capture context
├── shopping.ts         # Show overlay
└── overlay.css         # Styling
```

**That's it.** No settings, no accounts, no complexity.

---

## What We're NOT Building (MVP)

- ❌ User accounts
- ❌ Settings page
- ❌ History/saved searches
- ❌ Cross-site comparison
- ❌ Price tracking
- ❌ Complex UI

---

## Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Context capture | DOM scraping | Only option; accept fragility |
| Product parsing | Site-specific selectors | Faster than AI parsing |
| AI model | GPT-4.1-mini | Fast + cheap (~$0.005/call) |
| Backend | Firebase Functions | Simple, serverless |
| UI framework | Vanilla JS/CSS | Lighter, faster |

---

## Speed Requirements

| Action | Target |
|--------|--------|
| Context capture | < 100ms |
| Page detection | < 50ms |
| Product scraping | < 500ms |
| AI ranking | < 1500ms |
| **Total** | **< 2 seconds** |

---

## Cost Model

```
Per AI call:      $0.005
Per user/day:     2 calls = $0.01
Per user/month:   $0.30

1,000 users:      $300/month
Break-even:       60 users @ $5/month (or affiliate revenue)
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| ChatGPT DOM changes | Monitor daily, fast update process |
| Slow API response | Use GPT-4.1-mini, cache aggressively |
| Low accuracy | User feedback loop, iterate on prompts |

---

## Success Criteria

**Week 4 ship if:**
- [ ] Captures ChatGPT context reliably (>90%)
- [ ] Overlay appears in <2 seconds
- [ ] Rankings feel accurate (user testing)
- [ ] Works on Amazon (minimum)

---

## Go Decision

Before full build, validate in Week 1:
- [ ] Can we reliably scrape ChatGPT conversations?
- [ ] Can we detect product links being clicked?

If YES → Continue to Week 2
If NO → Pivot to manual context input

---

## Next Step

**Build the extension scaffold and ChatGPT content script first** - this is the highest-risk technical component. If it works reliably, everything else is straightforward.
