# Sift - Setup Guide

## Prerequisites

- Node.js 18+ 
- npm or pnpm
- Chrome browser
- (Optional) Cloudflare account for deployment

---

## 🔑 API Keys You Need

### 1. Groq API Key (REQUIRED) - FREE

Groq provides the fastest LLM inference. Get your free key:

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up / Log in
3. Navigate to **API Keys**
4. Click **Create API Key**
5. Copy the key (starts with `gsk_`)

**Free tier:** Generous rate limits, no credit card required

### 2. OpenAI API Key (OPTIONAL) - Paid

Used as fallback if Groq is unavailable:

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up / Log in  
3. Navigate to **API Keys**
4. Click **Create new secret key**
5. Copy the key (starts with `sk-`)

**Cost:** ~$0.0004 per analysis with GPT-4o-mini

### 3. Cloudflare Account (FOR DEPLOYMENT) - FREE

Only needed when you're ready to deploy:

1. Go to [cloudflare.com](https://cloudflare.com)
2. Sign up for free account
3. Run `npx wrangler login` to authenticate

---

## 🛠️ Local Development Setup

### Step 1: Install Dependencies

```bash
# Extension
cd extension
npm install

# Backend
cd ../backend
npm install
```

### Step 2: Configure API Keys

```bash
# Copy template
cp .env.example .env.local

# Edit with your keys
# Add your GROQ_API_KEY at minimum
```

### Step 3: Set Backend Secrets (for local dev)

```bash
cd backend

# Create a .dev.vars file for local development
echo "GROQ_API_KEY=your_groq_key_here" > .dev.vars
```

### Step 4: Start Development Servers

Terminal 1 - Backend:
```bash
cd backend
npm run dev
# Runs on http://localhost:8787
```

Terminal 2 - Extension:
```bash
cd extension
npm run dev
# Builds and watches for changes
```

### Step 5: Load Extension in Chrome

1. Open Chrome
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `extension/.output/chrome-mv3` folder

---

## 🧪 Testing the Extension

1. Open [ChatGPT](https://chatgpt.com)
2. Start a conversation about a product:
   ```
   "I'm looking for an espresso machine under $500, 
   preferably without plastic parts touching the water, 
   and good durability ratings"
   ```
3. You should see a green toast "Sift captured your search"
4. Click the Sift extension icon to verify context is captured
5. Navigate to [Amazon](https://amazon.com) and search for "espresso machine"
6. The Sift overlay should appear with ranked products

---

## 🚀 Deploying to Production

### Deploy Backend (Cloudflare Worker)

```bash
cd backend

# Login to Cloudflare (first time only)
npx wrangler login

# Set production secrets
npx wrangler secret put GROQ_API_KEY
# Paste your key when prompted

# Optional: Add OpenAI fallback
npx wrangler secret put OPENAI_API_KEY

# Deploy
npm run deploy
```

Your API will be available at: `https://sift-api.<your-subdomain>.workers.dev`

### Update Extension API URL

Edit `extension/src/entrypoints/background.ts`:
```typescript
const DEFAULT_API_URL = 'https://sift-api.<your-subdomain>.workers.dev';
```

### Build Extension for Chrome Web Store

```bash
cd extension
npm run zip
# Creates extension/.output/sift-extension-0.1.0-chrome.zip
```

---

## 📋 Checklist Before First Run

- [ ] Node.js 18+ installed
- [ ] Groq API key obtained
- [ ] `.dev.vars` created in backend folder
- [ ] Backend running on localhost:8787
- [ ] Extension built and loaded in Chrome
- [ ] Developer mode enabled in Chrome

---

## 🆘 Troubleshooting

### Extension not loading?
- Check `chrome://extensions` for errors
- Make sure you selected the correct output folder
- Try `npm run build` in extension folder

### Backend errors?
- Verify `.dev.vars` has correct API key format
- Check terminal for error messages
- Test API directly: `curl http://localhost:8787/api/health`

### No overlay on shopping sites?
- Check if context was captured (click extension icon)
- Open browser console (F12) for errors
- Verify you're on a supported site (Amazon, Best Buy, Target, Walmart)

### ChatGPT context not capturing?
- ChatGPT's DOM may have changed
- Check console for errors
- Try refreshing the ChatGPT page

---

## 💰 Cost Tracking

Groq is free with generous limits. If you add OpenAI fallback:

```
Per analysis: ~$0.0004
100 analyses: ~$0.04
1000 analyses: ~$0.40
```

Monitor usage at: [platform.openai.com/usage](https://platform.openai.com/usage)

