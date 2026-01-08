#!/bin/bash

# CORS and Auth Testing Script
# Run this to verify backend is working correctly

BACKEND_URL="https://connectbot-ai-production-05cf.up.railway.app"
FRONTEND_URL="https://connectbot-ai-frontend.vercel.app"

echo "╔═══════════════════════════════════════════════════════════════════════════╗"
echo "║                    🧪 CORS & AUTH TESTING SCRIPT                          ║"
echo "╚═══════════════════════════════════════════════════════════════════════════╝"
echo ""

# Test 1: Health Check
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
HEALTH_RESPONSE=$(curl -s "$BACKEND_URL/api/health")
echo "$HEALTH_RESPONSE" | jq '.' 2>/dev/null || echo "$HEALTH_RESPONSE"

if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo "✅ Health check PASSED"
else
    echo "❌ Health check FAILED"
fi
echo ""

# Test 2: CORS Test Endpoint
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: CORS Test Endpoint"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
CORS_RESPONSE=$(curl -s -H "Origin: $FRONTEND_URL" "$BACKEND_URL/api/cors-test")
echo "$CORS_RESPONSE" | jq '.' 2>/dev/null || echo "$CORS_RESPONSE"

if echo "$CORS_RESPONSE" | grep -q 'CORS is working'; then
    echo "✅ CORS test PASSED"
else
    echo "❌ CORS test FAILED"
fi
echo ""

# Test 3: Preflight Request (OPTIONS)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 3: Preflight (OPTIONS) Request"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
PREFLIGHT_HEADERS=$(curl -s -X OPTIONS \
    -H "Origin: $FRONTEND_URL" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type" \
    -I "$BACKEND_URL/api/auth/google/verify" 2>&1)

echo "Response Headers:"
echo "$PREFLIGHT_HEADERS" | grep -i "access-control" || echo "No CORS headers found"

if echo "$PREFLIGHT_HEADERS" | grep -q "access-control-allow-origin"; then
    echo "✅ Preflight PASSED"
else
    echo "❌ Preflight FAILED"
fi
echo ""

# Test 4: Auth Endpoint Exists
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 4: Auth Endpoint Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
AUTH_RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "Origin: $FRONTEND_URL" \
    -d '{}' \
    "$BACKEND_URL/api/auth/google/verify")

echo "$AUTH_RESPONSE" | jq '.' 2>/dev/null || echo "$AUTH_RESPONSE"

if echo "$AUTH_RESPONSE" | grep -q "ID token required"; then
    echo "✅ Auth endpoint EXISTS and validates input"
elif echo "$AUTH_RESPONSE" | grep -q "404"; then
    echo "❌ Auth endpoint NOT FOUND (404)"
else
    echo "⚠️  Unexpected response from auth endpoint"
fi
echo ""

# Summary
echo "╔═══════════════════════════════════════════════════════════════════════════╗"
echo "║                           📊 TEST SUMMARY                                 ║"
echo "╚═══════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Backend URL: $BACKEND_URL"
echo "Frontend URL: $FRONTEND_URL"
echo ""
echo "Next Step: Try Google login on the frontend!"
echo "URL: $FRONTEND_URL"
echo ""
