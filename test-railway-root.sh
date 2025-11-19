#!/bin/bash

BACKEND_URL="https://connectbot-ai-production-05cf.up.railway.app"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║          🧪 TESTING RAILWAY ROOT ROUTE                        ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: Root Route (/) - NEW!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Testing: $BACKEND_URL/"
echo ""

HTTP_CODE=$(curl -s -o /tmp/root_response.txt -w "%{http_code}" "$BACKEND_URL/" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ SUCCESS - Root route is working!"
    echo "HTTP Status: $HTTP_CODE"
    echo "Response:"
    cat /tmp/root_response.txt | jq . 2>/dev/null || cat /tmp/root_response.txt
    echo ""
elif [ "$HTTP_CODE" = "502" ]; then
    echo "❌ FAILED - HTTP 502 Bad Gateway"
    echo "   Backend crashed or not responding"
    echo "   Check Railway logs for errors"
elif [ "$HTTP_CODE" = "404" ]; then
    echo "❌ FAILED - HTTP 404 Not Found"
    echo "   Service not deployed or URL is wrong"
elif [ "$HTTP_CODE" = "503" ]; then
    echo "❌ FAILED - HTTP 503 Service Unavailable"
    echo "   'The train has not arrived at the station'"
    echo "   App crashed during startup"
else
    echo "❌ FAILED - HTTP $HTTP_CODE"
    cat /tmp/root_response.txt 2>/dev/null
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Health Check (/api/health)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Testing: $BACKEND_URL/api/health"
echo ""

HTTP_CODE=$(curl -s -o /tmp/health_response.txt -w "%{http_code}" "$BACKEND_URL/api/health" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ SUCCESS - Health endpoint working!"
    echo "HTTP Status: $HTTP_CODE"
    echo "Response:"
    cat /tmp/health_response.txt | jq . 2>/dev/null || cat /tmp/health_response.txt
    echo ""
elif [ "$HTTP_CODE" = "502" ]; then
    echo "❌ FAILED - HTTP 502"
elif [ "$HTTP_CODE" = "404" ]; then
    echo "❌ FAILED - HTTP 404"
elif [ "$HTTP_CODE" = "503" ]; then
    echo "❌ FAILED - HTTP 503"
else
    echo "❌ FAILED - HTTP $HTTP_CODE"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ROOT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/" 2>/dev/null)
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health" 2>/dev/null)

if [ "$ROOT_STATUS" = "200" ] && [ "$HEALTH_STATUS" = "200" ]; then
    echo "✅ ✅ EXCELLENT! Both endpoints working!"
    echo ""
    echo "🎉 Your backend IS running on Railway!"
    echo "   The 404 errors were likely due to Railway deploying"
    echo "   or environment variables being added."
    echo ""
    echo "Next steps:"
    echo "  1. Test frontend login at: https://connectbot-ai-frontend.vercel.app"
    echo "  2. Verify Google OAuth works"
    echo "  3. Check WhatsApp QR code generation"
elif [ "$ROOT_STATUS" = "200" ] || [ "$HEALTH_STATUS" = "200" ]; then
    echo "⚠️  Partial Success - One endpoint working"
    echo "   Root (/): $ROOT_STATUS"
    echo "   Health (/api/health): $HEALTH_STATUS"
    echo ""
    echo "   If root works but /api/* doesn't, check route configuration"
else
    echo "❌ ❌ Both endpoints failed"
    echo "   Root (/): $ROOT_STATUS"
    echo "   Health (/api/health): $HEALTH_STATUS"
    echo ""
    echo "   Backend is NOT running. Check Railway dashboard:"
    echo "   1. Go to https://railway.app"
    echo "   2. Check deployment logs"
    echo "   3. Verify environment variables are set"
    echo "   4. Check service status"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

rm -f /tmp/root_response.txt /tmp/health_response.txt 2>/dev/null

