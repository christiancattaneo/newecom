# ProductMatch - AI Product Research Assistant

A Chrome extension that bridges your ChatGPT product research with real-world shopping by automatically analyzing products against your stated requirements.

## 🎯 Problem

You spend 30 minutes with ChatGPT defining exactly what espresso machine you need:
- Under $500
- No plastic touching water
- Durable (5+ year lifespan)
- Has a milk frother

Then you click through to Amazon and... have to manually re-check every single requirement for each product. Your research context is lost.

## 💡 Solution

ProductMatch captures your ChatGPT conversation context and automatically analyzes products on e-commerce sites against your requirements.

```
┌────────────────────────────────────────┐
│ 🎯 Product Match Analysis              │
├────────────────────────────────────────┤
│ Your Requirements:                     │
│ ✅ Under $500 (Product: $449)          │
│ ⚠️ Plastic-free (Some plastic parts)  │
│ ✅ Durability (4.5★ on longevity)     │
│                                        │
│ Match Score: 78%                       │
└────────────────────────────────────────┘
```

## 📁 Project Structure

```
newecom/
├── docs/                    # Documentation
│   ├── feasibility-analysis.md
│   ├── prd-mvp.md
│   └── path-to-mvp.md
├── extension/               # Chrome extension source
│   ├── src/
│   │   ├── background/      # Service worker
│   │   ├── content/         # Content scripts
│   │   ├── popup/           # Extension popup UI
│   │   ├── components/      # Shared React components
│   │   └── utils/           # Shared utilities
│   ├── public/              # Static assets
│   └── manifest.json        # Extension manifest
├── backend/                 # Firebase Cloud Functions
│   ├── functions/
│   │   ├── src/
│   │   │   ├── api/         # API endpoints
│   │   │   ├── services/    # Business logic
│   │   │   └── utils/       # Utilities
│   │   └── index.ts
│   └── firebase.json
├── scripts/                 # Build & utility scripts
├── tests/                   # Test files
└── vision.md               # Original vision
```

## 🛠️ Tech Stack

- **Extension:** TypeScript, React, Tailwind CSS, Vite + CRXJS
- **Backend:** Firebase Cloud Functions (Node.js)
- **Database:** Firestore
- **Auth:** Firebase Auth
- **AI:** OpenAI GPT-4.1

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Firebase CLI
- Chrome browser

### Installation

```bash
# Clone and install
cd newecom
pnpm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your keys

# Development
pnpm dev           # Start extension dev server
pnpm dev:backend   # Start Firebase emulators

# Build
pnpm build         # Build extension
pnpm build:prod    # Production build
```

### Load Extension in Chrome

1. Build the extension: `pnpm build`
2. Open Chrome → `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `extension/dist` folder

## 🔒 Security

- API keys stored in Cloud Functions only
- User data processed, not stored long-term
- All communication over HTTPS
- Rate limiting enforced server-side
- See [Security Policy](docs/SECURITY.md)

## 📊 Cost Structure

| Component | Cost per Analysis |
|-----------|-------------------|
| Requirements Extraction | ~$0.003 |
| Product Analysis | ~$0.003 |
| **Total** | **~$0.006** |

Free tier: 5 analyses/day
Pro: Unlimited @ $5/month

## 🗺️ Roadmap

- [x] Feasibility analysis
- [x] PRD & architecture
- [ ] Project scaffolding
- [ ] ChatGPT context capture
- [ ] Product page parsers
- [ ] AI analysis integration
- [ ] UI polish
- [ ] Chrome Web Store launch

## 📄 License

Proprietary - All rights reserved

## 🤝 Contributing

This is currently a private project. Contact for collaboration inquiries.

