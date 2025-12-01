#!/bin/bash
# ===========================================
# Cloudflare Worker Setup Script
# Securely configures secrets without exposing them
# ===========================================

set -e

echo "🚀 Sift - Cloudflare Setup"
echo "=========================="
echo ""

cd "$(dirname "$0")/../backend"

# Check if wrangler is available
if ! npx wrangler --version > /dev/null 2>&1; then
    echo "❌ Wrangler not found. Installing..."
    npm install
fi

# Step 1: Login to Cloudflare
echo "📋 Step 1: Cloudflare Authentication"
echo "This will open your browser to authenticate..."
echo ""
npx wrangler login

echo ""
echo "✅ Logged in to Cloudflare!"
echo ""

# Step 2: Set secrets from .dev.vars
echo "📋 Step 2: Setting API secrets..."
echo ""

if [ -f ".dev.vars" ]; then
    # Read and set GROQ_API_KEY
    if grep -q "GROQ_API_KEY" .dev.vars; then
        GROQ_KEY=$(grep "GROQ_API_KEY" .dev.vars | cut -d'=' -f2)
        echo "$GROQ_KEY" | npx wrangler secret put GROQ_API_KEY
        echo "✅ GROQ_API_KEY set"
    fi
    
    # Read and set OPENAI_API_KEY if present
    if grep -q "OPENAI_API_KEY" .dev.vars; then
        OPENAI_KEY=$(grep "OPENAI_API_KEY" .dev.vars | cut -d'=' -f2)
        echo "$OPENAI_KEY" | npx wrangler secret put OPENAI_API_KEY
        echo "✅ OPENAI_API_KEY set"
    fi
else
    echo "❌ .dev.vars not found!"
    echo "Please create backend/.dev.vars with your API keys first."
    exit 1
fi

echo ""
echo "📋 Step 3: Deploying worker..."
echo ""

npx wrangler deploy

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Your API is now live. The URL will be shown above."
echo "Update the extension to use this URL for production."

