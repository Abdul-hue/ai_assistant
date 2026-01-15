#!/bin/bash
# WhatsApp Number Validation Testing Script (Bash version)
# Tests the validation feature before sending messages

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
AGENT_ID="${AGENT_ID:-b361a914-18bb-405c-92eb-8afe549ca9e1}"
FROM_NUMBER="${FROM_NUMBER:-923336906200}"
TO_NUMBER="${TO_NUMBER:-923047001463}"
MESSAGE="${MESSAGE:-Test message from validation script}"

echo "========================================"
echo "WhatsApp Validation Test Script"
echo "========================================"
echo ""

ENDPOINT="$BACKEND_URL/api/webhooks/send-message"

# Test 1: Valid WhatsApp Number
echo "Test 1: Valid WhatsApp Number"
echo "  From: $FROM_NUMBER"
echo "  To: $TO_NUMBER"
echo "  Agent: $AGENT_ID"
echo ""

BODY=$(cat <<EOF
{
  "agentId": "$AGENT_ID",
  "to": "$TO_NUMBER",
  "message": "$MESSAGE"
}
EOF
)

echo "Sending request..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
  SUCCESS=$(echo "$BODY_RESPONSE" | grep -o '"success":[^,]*' | cut -d: -f2)
  if [ "$SUCCESS" = "true" ]; then
    echo "✅ SUCCESS: Message sent successfully!"
    MESSAGE_ID=$(echo "$BODY_RESPONSE" | grep -o '"messageId":"[^"]*"' | cut -d'"' -f4)
    echo "   Message ID: $MESSAGE_ID"
  else
    ERROR=$(echo "$BODY_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
    DETAILS=$(echo "$BODY_RESPONSE" | grep -o '"details":"[^"]*"' | cut -d'"' -f4)
    echo "❌ FAILED: $ERROR"
    echo "   Details: $DETAILS"
  fi
else
  ERROR=$(echo "$BODY_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  DETAILS=$(echo "$BODY_RESPONSE" | grep -o '"details":"[^"]*"' | cut -d'"' -f4)
  echo "❌ ERROR (HTTP $HTTP_CODE): $ERROR"
  echo "   Details: $DETAILS"
  
  if [ "$ERROR" = "NUMBER_NOT_ON_WHATSAPP" ]; then
    echo "   ⚠️  Validation detected: Number is not on WhatsApp"
  elif [ "$ERROR" = "RATE_LIMIT_EXCEEDED" ]; then
    RETRY_AFTER=$(echo "$BODY_RESPONSE" | grep -o '"retryAfter":[^,]*' | cut -d: -f2)
    echo "   ⚠️  Rate limit exceeded. Wait $RETRY_AFTER seconds"
  fi
fi

echo ""
echo "----------------------------------------"
echo ""

# Test 2: Invalid/Non-WhatsApp Number
echo "Test 2: Invalid Number (should fail validation)"
echo "  To: 1234567890 (fake number)"
echo ""

INVALID_BODY=$(cat <<EOF
{
  "agentId": "$AGENT_ID",
  "to": "1234567890",
  "message": "This should fail validation"
}
EOF
)

echo "Sending request..."
INVALID_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$INVALID_BODY")

INVALID_HTTP_CODE=$(echo "$INVALID_RESPONSE" | tail -n1)
INVALID_BODY_RESPONSE=$(echo "$INVALID_RESPONSE" | sed '$d')

if [ "$INVALID_HTTP_CODE" -eq 400 ]; then
  INVALID_ERROR=$(echo "$INVALID_BODY_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  if [ "$INVALID_ERROR" = "NUMBER_NOT_ON_WHATSAPP" ]; then
    echo "✅ VALIDATION WORKING: Number correctly rejected"
    INVALID_DETAILS=$(echo "$INVALID_BODY_RESPONSE" | grep -o '"details":"[^"]*"' | cut -d'"' -f4)
    echo "   Error: $INVALID_ERROR"
    echo "   Details: $INVALID_DETAILS"
  else
    echo "❌ ERROR: $INVALID_ERROR"
  fi
else
  echo "⚠️  Unexpected HTTP code: $INVALID_HTTP_CODE"
fi

echo ""
echo "========================================"
echo "Test Complete"
echo "========================================"
echo ""
echo "To run with custom parameters:"
echo "  TO_NUMBER='923047001463' MESSAGE='Custom message' ./test-whatsapp-validation.sh"
echo ""

