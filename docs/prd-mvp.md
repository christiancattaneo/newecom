# Product Requirements Document (PRD)
## AI Product Research Assistant - MVP

**Version:** 1.0  
**Date:** December 2024  
**Status:** Draft  

---

## 1. Overview

### 1.1 Product Vision
A Chrome extension that captures user's product research context from ChatGPT conversations and provides intelligent, personalized product recommendations on e-commerce sites.

### 1.2 Problem Statement
Users spend significant time researching products with AI assistants like ChatGPT, defining specific requirements (price range, features, materials, etc.). When they click through to actual product pages, they must manually re-evaluate each product against their requirements. This context is lost, and users waste time re-checking specifications they've already discussed.

### 1.3 Solution
Automatically capture the user's research context and preferences from their ChatGPT conversation, then provide real-time analysis of products they browse against their stated requirements.

### 1.4 Target Users
- Online shoppers who research before purchasing
- Users who value specific product attributes (health-conscious, eco-friendly, budget-minded)
- Tech-savvy consumers comfortable with browser extensions
- ChatGPT users researching products

---

## 2. MVP Scope

### 2.1 Core User Flow

```
1. User researches product in ChatGPT
   "I need an espresso machine without plastic parts,
    under $500, with good reviews for durability"
    
2. ChatGPT provides recommendations with links
   
3. User clicks a product link → navigates to Amazon/etc.

4. Extension activates:
   - Detects navigation from ChatGPT
   - Captures recent conversation context
   - Analyzes current product page
   
5. Extension shows overlay:
   ┌────────────────────────────────────────┐
   │ 🎯 Product Match Analysis              │
   ├────────────────────────────────────────┤
   │ Your Requirements:                     │
   │ ✅ Under $500 (Product: $449)          │
   │ ⚠️ Plastic-free (Some plastic parts)  │
   │ ✅ Durability (4.5★ on longevity)     │
   │                                        │
   │ Match Score: 78%                       │
   │                                        │
   │ [See Better Matches] [Adjust Criteria] │
   └────────────────────────────────────────┘
```

### 2.2 MVP Features (v1.0)

| Priority | Feature | Description |
|----------|---------|-------------|
| P0 | ChatGPT Context Capture | Extract conversation from ChatGPT DOM when user navigates away |
| P0 | Product Page Detection | Identify when user lands on supported e-commerce sites |
| P0 | AI Product Analysis | Analyze product against user's stated requirements |
| P0 | Results Overlay | Display match analysis as non-intrusive overlay |
| P1 | Manual Context Input | Fallback for when DOM scraping fails |
| P1 | Preference Memory | Remember user's recurring preferences |
| P2 | Alternative Products | Suggest better-matching products on same site |

### 2.3 Supported Sites (MVP)
- Amazon.com
- Best Buy
- Target
- Walmart

### 2.4 Out of Scope (v1.0)
- Full ChatGPT history access
- Price tracking/alerts
- Cross-site comparison
- Purchase facilitation
- Mobile support

---

## 3. Technical Requirements

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CHROME EXTENSION                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  manifest.json (Manifest V3)                                     │
│  ├── permissions: activeTab, storage, webNavigation             │
│  ├── host_permissions: chatgpt.com, amazon.com, etc.            │
│  └── content_security_policy: script-src 'self'                 │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Content Script  │  │ Content Script  │  │  Service Worker │  │
│  │  chatgpt.ts     │  │  product.ts     │  │  background.ts  │  │
│  │                 │  │                 │  │                 │  │
│  │ - DOM observer  │  │ - Page parser   │  │ - State mgmt    │  │
│  │ - Context       │  │ - Overlay UI    │  │ - API calls     │  │
│  │   extraction    │  │ - User input    │  │ - Tab tracking  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                     │           │
│           └────────────────────┼─────────────────────┘           │
│                                │                                 │
│                    Chrome Message Passing                        │
│                                │                                 │
└────────────────────────────────┼─────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
          ┌─────────────────┐      ┌─────────────────┐
          │  Backend API    │      │  OpenAI API     │
          │  (Firebase +    │      │  (Direct calls  │
          │   Cloud Func.)  │      │   from backend) │
          └─────────────────┘      └─────────────────┘
```

### 3.2 Tech Stack

| Layer | Technology | Justification |
|-------|------------|---------------|
| Extension | TypeScript | Type safety, better DX |
| Build | Vite + CRXJS | Modern bundling for extensions |
| UI Framework | React | Component reusability |
| Styling | Tailwind CSS | Rapid UI development |
| State | Zustand | Lightweight, works in service workers |
| Backend | Firebase Cloud Functions | Serverless, scales automatically |
| Database | Firestore | User preferences, usage tracking |
| Auth | Firebase Auth | Google sign-in for simplicity |
| AI | OpenAI GPT-4.1 | Best reasoning capability |

### 3.3 API Design

#### Extract Requirements from Conversation
```typescript
POST /api/v1/extract-requirements
{
  "conversation": "string", // Raw conversation text
  "product_category": "string" // Optional hint
}

Response: {
  "requirements": [
    { "type": "price", "operator": "lt", "value": 500, "unit": "USD" },
    { "type": "material", "avoid": ["plastic"], "prefer": ["steel"] },
    { "type": "feature", "must_have": ["programmable", "milk frother"] }
  ],
  "context_summary": "User seeking espresso machine..."
}
```

#### Analyze Product Match
```typescript
POST /api/v1/analyze-product
{
  "requirements": Requirements[],
  "product_data": {
    "title": "string",
    "price": number,
    "description": "string",
    "specifications": Record<string, string>,
    "reviews_summary": "string" // Optional
  }
}

Response: {
  "overall_score": 78,
  "matches": [
    { "requirement": "price", "status": "pass", "detail": "$449 < $500" },
    { "requirement": "material", "status": "partial", "detail": "Water tank is plastic" }
  ],
  "concerns": ["Some plastic components in water system"],
  "highlights": ["All-metal brewing group", "5-year warranty"]
}
```

### 3.4 Data Flow

```
1. User on ChatGPT
   │
   ├─► Content script observes conversation DOM
   │   └─► Stores recent messages in extension storage
   │
   └─► User clicks product link
       │
       ├─► Service worker detects navigation
       │   └─► Captures referrer = chatgpt.com
       │
       └─► New tab opens (e.g., Amazon)
           │
           ├─► Product content script loads
           │   ├─► Extracts product data from page
           │   └─► Requests conversation context from storage
           │
           ├─► Service worker orchestrates
           │   ├─► Calls /extract-requirements (if needed)
           │   └─► Calls /analyze-product
           │
           └─► Content script renders overlay with results
```

### 3.5 Security Requirements

| Requirement | Implementation |
|-------------|----------------|
| API Key Protection | Keys stored in Cloud Functions, never in extension |
| User Data Privacy | Conversation text processed, not stored long-term |
| Secure Communication | HTTPS only, Firebase App Check |
| Rate Limiting | Per-user limits enforced server-side |
| Input Sanitization | All user input validated before API calls |
| Content Security Policy | Strict CSP in manifest |

---

## 4. User Interface

### 4.1 Extension Popup

```
┌─────────────────────────────────────┐
│  🛒 ProductMatch                    │
├─────────────────────────────────────┤
│                                     │
│  Status: ● Active                   │
│                                     │
│  Current Context:                   │
│  ┌─────────────────────────────────┐│
│  │ Looking for espresso machine    ││
│  │ • Budget: <$500                 ││
│  │ • Must: no plastic, durable     ││
│  │ • Nice: programmable            ││
│  └─────────────────────────────────┘│
│                                     │
│  [Edit Context] [Clear]             │
│                                     │
│  ─────────────────────────────────  │
│  Analyses today: 3/10               │
│  [Upgrade for unlimited]            │
│                                     │
└─────────────────────────────────────┘
```

### 4.2 Product Page Overlay

```
┌────────────────────────────────────────────────────┐
│ 🎯 ProductMatch Analysis                      [×]  │
├────────────────────────────────────────────────────┤
│                                                    │
│  Overall Match: ███████░░░ 72%                     │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ ✅ Price         $449 (under your $500 max)  │  │
│  │ ⚠️ Materials    Water tank is plastic        │  │
│  │ ✅ Durability   4.5★ avg, "built to last"   │  │
│  │ ✅ Programmable Yes, with app control        │  │
│  │ ❓ Milk frother Steam wand (manual)          │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  💡 Note: Consider the Breville BES870XL -        │
│     similar price, all-metal construction          │
│                                                    │
│  [See Alternatives]  [Ask AI]  [Adjust Criteria]  │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 4.3 Design Principles

- **Non-intrusive:** Overlay doesn't block product info
- **Dismissible:** Easy to close/minimize
- **Glanceable:** Key info visible at a glance
- **Actionable:** Clear next steps available
- **Accessible:** WCAG 2.1 AA compliant

---

## 5. Development Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Project setup (Vite, TypeScript, React)
- [ ] Chrome extension scaffold (Manifest V3)
- [ ] Firebase project setup
- [ ] Basic content script injection
- [ ] Service worker message passing

### Phase 2: ChatGPT Integration (Week 3-4)
- [ ] ChatGPT DOM analysis and selectors
- [ ] Conversation extraction logic
- [ ] MutationObserver for real-time capture
- [ ] Navigation detection from ChatGPT
- [ ] Context storage in extension

### Phase 3: Product Analysis (Week 5-6)
- [ ] Product page detection
- [ ] Site-specific parsers (Amazon first)
- [ ] OpenAI integration for analysis
- [ ] Requirements extraction prompt engineering
- [ ] Product match analysis prompt engineering

### Phase 4: UI & Polish (Week 7-8)
- [ ] Extension popup UI
- [ ] Product page overlay UI
- [ ] Manual context input fallback
- [ ] Error states and loading states
- [ ] Settings/preferences page

### Phase 5: Testing & Launch (Week 9-10)
- [ ] Unit tests for parsers
- [ ] Integration tests
- [ ] Security audit
- [ ] Chrome Web Store submission
- [ ] Beta user testing

---

## 6. Success Metrics

### 6.1 MVP Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Context Capture Rate | >80% | Successful extractions / attempts |
| Analysis Accuracy | >70% user agreement | User feedback on match scores |
| Time to Analysis | <3 seconds | P95 latency |
| Daily Active Users | 100+ | Analytics |
| User Retention (D7) | >30% | Cohort analysis |

### 6.2 Key Performance Indicators

- **Activation Rate:** Users who complete first analysis
- **Analysis per User:** Avg analyses per active user
- **Conversion to Paid:** Free → paid upgrade rate
- **NPS Score:** User satisfaction

---

## 7. Cost Projections

### 7.1 Infrastructure (Monthly)

| Service | Free Tier | Est. Growth Cost |
|---------|-----------|------------------|
| Firebase Hosting | 10GB/month | $0.026/GB after |
| Cloud Functions | 2M invocations | $0.40/million after |
| Firestore | 1GB storage | $0.18/GB after |
| Firebase Auth | 50K MAU | $0.06/MAU after |

### 7.2 OpenAI API (Per Analysis)

```
Requirements Extraction:
- Input: ~2000 tokens (conversation)
- Output: ~200 tokens
- Cost: ~$0.003 (GPT-4.1)

Product Analysis:
- Input: ~1500 tokens (requirements + product)
- Output: ~300 tokens  
- Cost: ~$0.003 (GPT-4.1)

Total per analysis: ~$0.006
```

### 7.3 Monthly Projections

| Users | Analyses/User | Total Analyses | OpenAI Cost | Infra | Total |
|-------|---------------|----------------|-------------|-------|-------|
| 100 | 20 | 2,000 | $12 | $0 | $12 |
| 1,000 | 20 | 20,000 | $120 | $10 | $130 |
| 10,000 | 20 | 200,000 | $1,200 | $50 | $1,250 |

**Break-even:** ~250 paying users at $5/month covers 10K free users

---

## 8. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| ChatGPT DOM changes | HIGH | HIGH | Robust selectors, DOM change detection, quick update process |
| OpenAI API cost spikes | MEDIUM | MEDIUM | Hard limits per user, caching, model optimization |
| Chrome Web Store rejection | LOW | HIGH | Follow policies strictly, clear privacy policy |
| E-commerce site blocks | MEDIUM | MEDIUM | Multiple parsing strategies, respect rate limits |
| Low accuracy perception | MEDIUM | HIGH | User feedback loop, transparent scoring |

---

## 9. Future Roadmap (Post-MVP)

### v1.1 - Enhanced Analysis
- Review sentiment analysis
- Price history integration
- Comparison mode (side-by-side)

### v1.2 - Expanded Coverage
- More e-commerce sites
- International sites
- Mobile web support

### v2.0 - Native Experience
- Built-in chat (no ChatGPT dependency)
- Saved searches/wishlists
- Price drop alerts

### v3.0 - Social & Sharing
- Share curated lists
- Community recommendations
- Expert reviews integration

---

## 10. Appendix

### A. ChatGPT DOM Selectors (as of Dec 2024)

```javascript
// Note: These WILL change. Monitor and update.
const SELECTORS = {
  conversationContainer: '[data-testid="conversation-turn"]',
  messageContent: '.markdown',
  userMessage: '[data-message-author-role="user"]',
  assistantMessage: '[data-message-author-role="assistant"]',
  productLinks: 'a[href*="amazon.com"], a[href*="bestbuy.com"]'
};
```

### B. Amazon Product Data Points

```javascript
const AMAZON_SELECTORS = {
  title: '#productTitle',
  price: '.a-price .a-offscreen',
  rating: '#acrPopover',
  features: '#feature-bullets li',
  specifications: '#productDetails_techSpec_section_1',
  description: '#productDescription'
};
```

### C. OpenAI Prompts (Draft)

**Requirements Extraction:**
```
You are analyzing a conversation about product research.
Extract the user's requirements as structured data.

Categories to identify:
- Price constraints (max, min, range)
- Required features
- Avoided attributes (materials, brands, etc.)
- Nice-to-have features
- Use case / purpose

Return JSON format only.
```

**Product Match Analysis:**
```
Analyze how well this product matches the user's requirements.
Be specific about matches and mismatches.
Cite evidence from product data.
Score each requirement: pass/partial/fail.
Provide overall match percentage.
```

