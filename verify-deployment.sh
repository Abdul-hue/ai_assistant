#!/bin/bash

# ============================================================================
# Railway Deployment Verification Script
# ============================================================================

RAILWAY_URL="${1:-https://connectbot-ai-production-05cf.up.railway.app}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "============================================================"
echo "🚀 Railway Deployment Verification"
echo "============================================================"
echo ""
echo "Backend URL: $RAILWAY_URL"
echo ""

# Test counter
PASSED=0
FAILED=0

# ============================================================================
# Test 1: Root Endpoint
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: Root Endpoint (/)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HTTP_CODE=$(curl -s -o /tmp/root_test.json -w "%{http_code}" "$RAILWAY_URL/" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ PASSED${NC} - HTTP $HTTP_CODE"
    cat /tmp/root_test.json | jq . 2>/dev/null || cat /tmp/root_test.json
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}❌ FAILED${NC} - HTTP $HTTP_CODE"
    cat /tmp/root_test.json 2>/dev/null
    FAILED=$((FAILED + 1))
fi

echo ""

# ============================================================================
# Test 2: Health Endpoint
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Health Check (/api/health)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HTTP_CODE=$(curl -s -o /tmp/health_test.json -w "%{http_code}" "$RAILWAY_URL/api/health" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ PASSED${NC} - HTTP $HTTP_CODE"
    cat /tmp/health_test.json | jq . 2>/dev/null || cat /tmp/health_test.json
    
    # Check if environment variables are configured
    if cat /tmp/health_test.json | grep -q '"databaseUrl":"configured"'; then
        echo -e "${GREEN}  ✓ Database configured${NC}"
    else
        echo -e "${YELLOW}  ⚠ Database not configured${NC}"
    fi
    
    if cat /tmp/health_test.json | grep -q '"googleClientId":"configured"'; then
        echo -e "${GREEN}  ✓ Google OAuth configured${NC}"
    else
        echo -e "${YELLOW}  ⚠ Google OAuth not configured${NC}"
    fi
    
    if cat /tmp/health_test.json | grep -q '"jwtSecret":"configured"'; then
        echo -e "${GREEN}  ✓ JWT Secret configured${NC}"
    else
        echo -e "${YELLOW}  ⚠ JWT Secret not configured${NC}"
    fi
    
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}❌ FAILED${NC} - HTTP $HTTP_CODE"
    cat /tmp/health_test.json 2>/dev/null
    FAILED=$((FAILED + 1))
fi

echo ""

# ============================================================================
# Test 3: CORS Test Endpoint
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 3: CORS Test (/api/cors-test)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HTTP_CODE=$(curl -s -o /tmp/cors_test.json -w "%{http_code}" \
    -H "Origin: https://connectbot-ai-frontend.vercel.app" \
    "$RAILWAY_URL/api/cors-test" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ PASSED${NC} - HTTP $HTTP_CODE"
    cat /tmp/cors_test.json | jq . 2>/dev/null || cat /tmp/cors_test.json
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}❌ FAILED${NC} - HTTP $HTTP_CODE"
    cat /tmp/cors_test.json 2>/dev/null
    FAILED=$((FAILED + 1))
fi

echo ""

# ============================================================================
# Test 4: Auth Test Endpoint
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 4: Auth Routes Test (/api/auth/test)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HTTP_CODE=$(curl -s -o /tmp/auth_test.json -w "%{http_code}" "$RAILWAY_URL/api/auth/test" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ PASSED${NC} - HTTP $HTTP_CODE"
    cat /tmp/auth_test.json | jq . 2>/dev/null || cat /tmp/auth_test.json
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}❌ FAILED${NC} - HTTP $HTTP_CODE"
    cat /tmp/auth_test.json 2>/dev/null
    FAILED=$((FAILED + 1))
fi

echo ""

# ============================================================================
# Test 5: CORS Preflight (OPTIONS)
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 5: CORS Preflight (OPTIONS /api/auth/google/verify)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HTTP_CODE=$(curl -s -o /tmp/preflight_test.txt -w "%{http_code}" \
    -X OPTIONS \
    -H "Origin: https://connectbot-ai-frontend.vercel.app" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type" \
    "$RAILWAY_URL/api/auth/google/verify" 2>/dev/null)

if [ "$HTTP_CODE" = "204" ] || [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ PASSED${NC} - HTTP $HTTP_CODE"
    echo "CORS preflight successful"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}❌ FAILED${NC} - HTTP $HTTP_CODE"
    cat /tmp/preflight_test.txt 2>/dev/null
    FAILED=$((FAILED + 1))
fi

echo ""

# ============================================================================
# Test 6: Auth Endpoint Exists
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 6: Auth Endpoint (POST /api/auth/google/verify)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HTTP_CODE=$(curl -s -o /tmp/auth_endpoint_test.json -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"invalid":"test"}' \
    "$RAILWAY_URL/api/auth/google/verify" 2>/dev/null)

# We expect 400 (missing idToken) or 401 (invalid token), not 404
if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✅ PASSED${NC} - HTTP $HTTP_CODE (endpoint exists)"
    cat /tmp/auth_endpoint_test.json | jq . 2>/dev/null || cat /tmp/auth_endpoint_test.json
    PASSED=$((PASSED + 1))
elif [ "$HTTP_CODE" = "404" ]; then
    echo -e "${RED}❌ FAILED${NC} - HTTP $HTTP_CODE (endpoint not found)"
    cat /tmp/auth_endpoint_test.json 2>/dev/null
    FAILED=$((FAILED + 1))
else
    echo -e "${YELLOW}⚠ UNEXPECTED${NC} - HTTP $HTTP_CODE"
    cat /tmp/auth_endpoint_test.json 2>/dev/null
    FAILED=$((FAILED + 1))
fi

echo ""

# ============================================================================
# Summary
# ============================================================================

echo "============================================================"
echo "📊 Test Summary"
echo "============================================================"
echo ""

TOTAL=$((PASSED + FAILED))
PERCENTAGE=$((PASSED * 100 / TOTAL))

echo -e "${GREEN}✅ Passed: $PASSED${NC}"

if [ $FAILED -gt 0 ]; then
    echo -e "${RED}❌ Failed: $FAILED${NC}"
else
    echo -e "${GREEN}❌ Failed: $FAILED${NC}"
fi

echo ""
echo "Success Rate: $PERCENTAGE%"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "============================================================"
    echo -e "${GREEN}🎉 All tests passed! Backend is working!${NC}"
    echo "============================================================"
    echo ""
    echo "Next steps:"
    echo "  1. Test Google login from frontend"
    echo "  2. Verify user creation in database"
    echo "  3. Test protected endpoints with JWT"
    echo ""
    exit 0
else
    echo "============================================================"
    echo -e "${RED}⚠️  Some tests failed${NC}"
    echo "============================================================"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check Railway deployment logs"
    echo "  2. Verify environment variables are set"
    echo "  3. Ensure database is accessible"
    echo "  4. Check Railway service status"
    echo ""
    exit 1
fi

# Cleanup
rm -f /tmp/*_test.json /tmp/*_test.txt 2>/dev/null
