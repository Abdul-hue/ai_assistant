# WhatsApp Button Implementation Guide

## ✅ Implementation Complete - Updated to Interactive Message (Native Flow) Format

**IMPORTANT:** The old `buttonsMessage` format is deprecated and blocked by WhatsApp. This implementation uses the new **Interactive Message (Native Flow)** format with `viewOnceMessage` wrapper for better compatibility.

All 5 tasks have been successfully implemented:

### Task 1: ✅ Modify webhook endpoint to parse button JSON messages
**File:** `backend/src/routes/webhookSendMessage.js`

- Added support for both plain text and button message formats
- Auto-detects button messages (JSON string or object)
- Validates button message structure:
  - Requires `text` field (max 4096 chars)
  - Requires `buttons` array (1-3 buttons)
  - Each button requires `id` and `text` (max 20 chars)

**Supported Formats:**
```javascript
// Plain text
{ "message": "Hello!" }

// Button object
{ "message": { "text": "Choose:", "buttons": [{ "id": "opt1", "text": "Option 1" }] } }

// Button JSON string
{ "message": "{\"text\":\"Choose:\",\"buttons\":[{\"id\":\"opt1\",\"text\":\"Option 1\"}]}" }
```

### Task 2: ✅ Update sendMessage function to handle objects
**File:** `backend/src/services/baileysService.js`

- Updated `sendMessage()` to accept both string and object messages
- **Uses Interactive Message (Native Flow) format** - the new WhatsApp standard
- Wraps message in `viewOnceMessage` for better compatibility
- Supports up to 3 buttons per message (WhatsApp limit)
- Supports multiple button types: `quick_reply`, `cta_url`, `cta_call`

**Function Signature:**
```javascript
async function sendMessage(agentId, to, message, isButtonMessage = false)
```

### Task 3: ✅ Add patchMessageBeforeSending to Baileys connection
**Note:** Baileys doesn't require a separate patch hook. Button messages are handled directly in `sendMessage()` by converting to Baileys format.

### Task 4: ✅ Add button response handler for incoming button clicks
**File:** `backend/src/services/baileysService.js`

- Detects `buttonsResponseMessage` in incoming messages
- Extracts `selectedButtonId` and `selectedButtonText`
- Sets `messageType` to `BUTTON_RESPONSE`
- Includes button response data in webhook payload

**Webhook Payload for Button Clicks:**
```json
{
  "messageType": "BUTTON_RESPONSE",
  "type": "button_response",
  "content": "Option 1",
  "buttonResponse": {
    "selectedButtonId": "option_1",
    "selectedButtonText": "Option 1",
    "contextInfo": {}
  }
}
```

### Task 5: ✅ Create test endpoint for validation
**File:** `backend/src/routes/webhookSendMessage.js`

- Added `GET /api/webhooks/send-message/test` endpoint
- Returns example payloads for testing
- Documents button response format
- Lists validation rules

## 📋 Usage Examples

### Send Plain Text Message
```bash
curl -X POST http://localhost:3001/api/webhooks/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
    "to": "923336906200",
    "message": "Hello! This is a plain text message."
  }'
```

### Send Button Message (Object) - Interactive Message Format
```bash
curl -X POST http://localhost:3001/api/webhooks/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
    "to": "923336906200",
    "message": {
      "text": "👋 Welcome! Please choose an option:",
      "title": "Welcome Message",
      "footer": "Powered by WhatsApp",
      "buttons": [
        { "id": "option_1", "text": "Option 1" },
        { "id": "option_2", "text": "Option 2", "url": "https://example.com" },
        { "id": "option_3", "text": "Call Support", "phone": "+1234567890" }
      ]
    }
  }'
```

**Button Types:**
- `quick_reply` (default): Simple reply button - just provide `id` and `text`
- `cta_url`: Call-to-action with URL - provide `id`, `text`, and `url`
- `cta_call`: Call-to-action with phone - provide `id`, `text`, and `phone`

### Send Button Message (JSON String)
```bash
curl -X POST http://localhost:3001/api/webhooks/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
    "to": "923336906200",
    "message": "{\"text\":\"Choose:\",\"buttons\":[{\"id\":\"opt1\",\"text\":\"Option 1\"}]}"
  }'
```

### Test Endpoint
```bash
curl http://localhost:3001/api/webhooks/send-message/test
```

## 🔍 Testing

### 1. Test Plain Text Message
```bash
node backend/test-webhook-send.js <agentId> <phoneNumber> "Hello, this is a test!"
```

### 2. Test Button Message
Create a test file `test-button-message.js`:
```javascript
const http = require('http');

const AGENT_ID = process.argv[2] || 'b361a914-18bb-405c-92eb-8afe549ca9e1';
const PHONE_NUMBER = process.argv[3] || '923336906200';

const buttonMessage = {
  text: '👋 Welcome! Please choose an option:',
  buttons: [
    { id: 'option_1', text: 'Option 1' },
    { id: 'option_2', text: 'Option 2' },
    { id: 'option_3', text: 'Option 3' }
  ]
};

const requestData = JSON.stringify({
  agentId: AGENT_ID,
  to: PHONE_NUMBER,
  message: buttonMessage
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/webhooks/send-message',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestData)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Response:', JSON.stringify(JSON.parse(data), null, 2));
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(requestData);
req.end();
```

Run: `node test-button-message.js`

## 📝 Validation Rules

- **Max Buttons:** 3 per message
- **Max Button Text:** 20 characters
- **Max Message Text:** 4096 characters
- **Button ID:** Required, must be string
- **Button Text:** Required, must be string, 1-20 characters

## 🐛 Troubleshooting

### Buttons Not Appearing
1. Check WhatsApp connection status
2. Verify button message format matches examples
3. Check console logs for validation errors

### Button Clicks Not Received
1. Verify webhook endpoint is configured
2. Check `buttonResponse` field in webhook payload
3. Ensure `messageType` is `BUTTON_RESPONSE`

### Validation Errors
- Check button count (max 3)
- Check button text length (max 20 chars)
- Verify button structure (must have `id` and `text`)

## 📚 Related Files

- `backend/src/routes/webhookSendMessage.js` - Webhook endpoint
- `backend/src/services/baileysService.js` - Message sending and receiving
- `backend/test-webhook-send.js` - Test script

## ✅ Next Steps

1. Test with plain text messages
2. Test with button messages
3. Verify button clicks are received in webhook
4. Integrate with your n8n workflow

