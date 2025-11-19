#!/bin/bash

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║   🚂 RAILWAY BACKEND DIAGNOSTIC - 'TRAIN NOT ARRIVED'        ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if Railway CLI is installed
if command -v railway &> /dev/null; then
    echo "✅ Railway CLI is installed"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📋 Fetching Railway Service Info..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Try to get service status
    echo ""
    echo "🔍 Service Status:"
    railway status 2>&1 || echo "❌ Not linked to Railway project"
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📊 Environment Variables:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    railway variables 2>&1 || echo "❌ Cannot fetch variables"
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📜 Recent Logs (Last 50 lines):"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    railway logs --tail 50 2>&1 || echo "❌ Cannot fetch logs"
    
else
    echo "❌ Railway CLI is NOT installed"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔧 To install Railway CLI:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "npm install -g @railway/cli"
    echo ""
    echo "Then run:"
    echo "railway login"
    echo "railway link"
    echo "./diagnose-railway.sh"
    echo ""
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Testing Backend URL..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

BACKEND_URL="https://connectbot-ai-production-05cf.up.railway.app"

echo "Testing: $BACKEND_URL/api/health"
echo ""

# Test health endpoint
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ SUCCESS - Backend is running!"
    echo "HTTP Status: $HTTP_CODE"
    curl -s "$BACKEND_URL/api/health" | jq . 2>/dev/null || curl -s "$BACKEND_URL/api/health"
    echo ""
elif [ "$HTTP_CODE" = "502" ]; then
    echo "❌ HTTP 502 - Backend is crashed or not responding"
    echo "   Likely cause: Missing environment variables or startup crash"
elif [ "$HTTP_CODE" = "404" ]; then
    echo "❌ HTTP 404 - Service not found or not deployed"
    echo "   Likely cause: Backend service doesn't exist or URL is wrong"
elif [ "$HTTP_CODE" = "503" ]; then
    echo "❌ HTTP 503 - 'The train has not arrived at the station'"
    echo "   Likely cause: App crashed during startup"
else
    echo "❌ HTTP $HTTP_CODE - Unexpected response"
    echo "   Backend is not healthy"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 MANUAL STEPS TO CHECK RAILWAY DASHBOARD"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to: https://railway.app"
echo ""
echo "2. Open your project: connectbot-ai"
echo ""
echo "3. Click on: Backend service"
echo ""
echo "4. Check these tabs:"
echo "   - Deployments → View Logs (check for errors)"
echo "   - Variables → Verify all 7 variables are set"
echo "   - Settings → Check Root Directory, Build Command, Start Command"
echo ""
echo "5. Required environment variables (must have all 7):"
echo "   ✓ DATABASE_URL"
echo "   ✓ GOOGLE_CLIENT_ID"
echo "   ✓ GOOGLE_CLIENT_SECRET"
echo "   ✓ JWT_SECRET"
echo "   ✓ FRONTEND_URL"
echo "   ✓ NODE_ENV"
echo "   ✓ GOOGLE_CALLBACK_URL"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🆘 SHARE THIS INFO FOR HELP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To get help, share:"
echo "1. The output of this script"
echo "2. Railway deployment logs (last 50 lines)"
echo "3. List of environment variables (names only, not values)"
echo "4. Service status from Railway dashboard"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
