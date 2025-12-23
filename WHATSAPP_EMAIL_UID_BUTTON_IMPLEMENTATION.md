# WhatsApp Email UID Button Implementation

## Overview
This implementation adds interactive button functionality to WhatsApp email notifications. When an email notification contains an EMAIL UID, the system automatically converts it to a button message that allows users to create a draft response with a single click.

## Implementation Details

### 1. EMAIL UID Detection (`webhookSendMessage.js`)

**Location:** `backend/src/routes/webhookSendMessage.js` (lines 59-90)

**Functionality:**
- Detects EMAIL UID pattern in incoming messages: `🆔 *EMAIL UID:* (\d+)`
- Automatically converts plain text messages with EMAIL UID to button messages
- Creates button with ID: `create_draft_{uid}` and text: `Create Draft uid({uid})`
- Button text is truncated to 20 characters (WhatsApp limit)

**Code:**
```javascript
const emailUidMatch = message.match(/🆔 \*EMAIL UID:\* (\d+)/);
if (emailUidMatch) {
  const uid = emailUidMatch[1];
  messagePayload = {
    text: message.trim(),
    footer: '⚡ Automated Email Triage System',
    buttons: [{
      id: `create_draft_${uid}`,
      text: `Create Draft uid(${uid})`.substring(0, 20)
    }]
  };
  isButtonMessage = true;
}
```

**Logging:**
- `[BUTTON-MESSAGE] Creating button for email UID: {uid}`
- `[WEBHOOK-SEND-MESSAGE] ✅ Detected EMAIL UID, converted to button message`

---

### 2. Button Response Handler (`webhookButtonResponse.js`)

**Location:** `backend/src/routes/webhookButtonResponse.js` (new file)

**Endpoint:** `POST /api/webhooks/button-response`

**Functionality:**
- Receives button click events from Baileys
- Extracts UID from button ID (`create_draft_{uid}`)
- Calls send-message webhook internally with draft message
- Maintains conversation context (agentId, phone number)

**Request Body:**
```json
{
  "agentId": "uuid",
  "from": "phone-number",
  "buttonId": "create_draft_39482",
  "buttonText": "Create Draft uid(39482)",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Button response processed successfully",
  "data": {
    "agentId": "uuid",
    "from": "phone-number",
    "buttonId": "create_draft_39482",
    "uid": "39482",
    "draftMessage": "Create Draft uid(39482)",
    "sentAt": "2024-01-01T12:00:00.000Z"
  }
}
```

**Logging:**
- `[BUTTON-HANDLER] Incoming button response`
- `[BUTTON-CLICK] User clicked: {buttonId}, extracted UID: {uid}`
- `[BUTTON-HANDLER] Sending draft message for UID: {uid}`
- `[BUTTON-HANDLER] ✅ Successfully sent draft message via send-message webhook`

---

### 3. Baileys Event Listener (`baileysService.js`)

**Location:** `backend/src/services/baileysService.js` (lines 3114-3165)

**Functionality:**
- Listens for `messages.upsert` events from Baileys
- Detects button response messages (`buttonsResponseMessage`)
- Extracts button ID and text
- Forwards EMAIL UID button clicks to button-response webhook

**Code:**
```javascript
if (msg.message.buttonsResponseMessage) {
  const buttonMsg = msg.message.buttonsResponseMessage;
  buttonResponse = {
    selectedButtonId: buttonMsg.selectedButtonId || buttonMsg.selectedId,
    selectedButtonText: buttonMsg.selectedButtonText || buttonMsg.selectedDisplayText || null,
    contextInfo: buttonMsg.contextInfo || null
  };
  
  // Check if this is an EMAIL UID button click
  if (buttonResponse.selectedButtonId && buttonResponse.selectedButtonId.startsWith('create_draft_')) {
    // Forward to button-response webhook
    axios.post(buttonResponseWebhookUrl, {
      agentId: agentId,
      from: sanitizedFromNumber,
      buttonId: buttonResponse.selectedButtonId,
      buttonText: buttonResponse.selectedButtonText,
      timestamp: timestampIso
    });
  }
}
```

**Logging:**
- `[BAILEYS] 🔘 Button response received`
- `[BUTTON-CLICK] EMAIL UID button clicked: {buttonId}`
- `[BUTTON-CLICK] Forwarding EMAIL UID button click to button-response webhook`
- `[BUTTON-CLICK] ✅ Button response webhook called successfully`

---

### 4. Route Registration (`app.js`)

**Location:** `backend/app.js` (lines 40, 448)

**Changes:**
- Added import: `const webhookButtonResponseRoute = require('./src/routes/webhookButtonResponse');`
- Registered route: `app.use('/api/webhooks/button-response', webhookButtonResponseRoute);`

---

## Message Flow

### 1. Email Notification Arrives
```
Email webhook → POST /api/webhooks/send-message
Message: "New email received! 🆔 *EMAIL UID:* 39482"
```

### 2. EMAIL UID Detection
```
webhookSendMessage.js detects pattern
→ Converts to button message
→ Button ID: "create_draft_39482"
→ Button Text: "Create Draft uid(39482)"
```

### 3. Button Message Sent
```
baileysService.js sendMessage()
→ Converts to Baileys format
→ Sends via WhatsApp
→ User sees interactive button
```

### 4. User Clicks Button
```
Baileys emits messages.upsert event
→ baileysService.js detects buttonResponseMessage
→ Extracts button ID: "create_draft_39482"
→ Forwards to POST /api/webhooks/button-response
```

### 5. Button Response Handler
```
webhookButtonResponse.js receives click
→ Extracts UID: "39482"
→ Calls POST /api/webhooks/send-message internally
→ Message: "Create Draft uid(39482)"
→ Appears in chat as user's response
```

---

## Error Handling

### 1. UID Extraction Errors
- **Location:** `webhookButtonResponse.js` (lines 67-80)
- **Handling:** Try-catch block with fallback
- **Logging:** Warning if button ID doesn't match pattern

### 2. Webhook Call Failures
- **Location:** `webhookButtonResponse.js` (lines 130-145)
- **Handling:** Returns error but doesn't fail completely
- **Logging:** Error logged, button click still acknowledged

### 3. Button Message Creation Failures
- **Location:** `baileysService.js` (lines 4598-4630)
- **Handling:** Falls back to plain text message
- **Logging:** Error logged, plain text sent instead

### 4. Missing Link Preview Module
- **Location:** Existing error handling preserved
- **Handling:** Graceful degradation (already implemented)

---

## Logging Summary

### Button Message Creation
- `[BUTTON-MESSAGE] Creating button for email UID: {uid}`
- `[WEBHOOK-SEND-MESSAGE] ✅ Detected EMAIL UID, converted to button message`

### Button Click Detection
- `[BAILEYS] 🔘 Button response received`
- `[BUTTON-CLICK] EMAIL UID button clicked: {buttonId}`
- `[BUTTON-CLICK] Forwarding EMAIL UID button click to button-response webhook`

### Button Response Processing
- `[BUTTON-HANDLER] Incoming button response`
- `[BUTTON-CLICK] User clicked: {buttonId}, extracted UID: {uid}`
- `[BUTTON-HANDLER] Sending draft message for UID: {uid}`
- `[BUTTON-HANDLER] ✅ Successfully sent draft message via send-message webhook`

---

## Testing

### Test Case 1: EMAIL UID Detection
```bash
POST /api/webhooks/send-message
{
  "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
  "to": "923336906200",
  "message": "New email received! 🆔 *EMAIL UID:* 39482"
}
```

**Expected:**
- Message converted to button message
- Button ID: `create_draft_39482`
- Button Text: `Create Draft uid(39482)`
- Log: `[BUTTON-MESSAGE] Creating button for email UID: 39482`

### Test Case 2: Button Click
```bash
POST /api/webhooks/button-response
{
  "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
  "from": "923336906200",
  "buttonId": "create_draft_39482",
  "buttonText": "Create Draft uid(39482)",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

**Expected:**
- UID extracted: `39482`
- Internal call to send-message webhook
- Message: `Create Draft uid(39482)`
- Log: `[BUTTON-HANDLER] Sending draft message for UID: 39482`

### Test Case 3: End-to-End Flow
1. Send email notification with EMAIL UID
2. Verify button appears in WhatsApp
3. Click button
4. Verify draft message appears in chat

---

## Database Storage

### Message Storage
- Button messages are stored in `message_log` table
- `source: 'dashboard'`
- `sender_type: 'agent'`
- `message_text: "{original text}\n\n*1 Create Draft uid({uid})*"`

### Button Response Storage
- Button clicks are processed as regular messages
- Stored with `source: 'whatsapp'`
- `sender_type: 'contact'`
- `message_text: "Create Draft uid({uid})"`

---

## Configuration

### Environment Variables
- `API_BASE_URL` - Base URL for internal webhook calls (optional)
- `WEBHOOK_BASE_URL` - Alternative base URL (optional)
- Default: `http://localhost:3000` (for local development)

### Rate Limiting
- Button response webhook: 30 requests per minute
- Same as send-message webhook

---

## Critical Notes

1. **Preserves Existing Functionality**
   - Non-email messages work as before
   - Existing button message support maintained
   - No breaking changes

2. **Error Handling**
   - All errors are logged
   - Fallback to plain text if button creation fails
   - Button clicks don't block message processing

3. **Message Storage**
   - Button messages stored correctly in database
   - Source and sender_type preserved
   - Button clicks appear as user messages

4. **Testing**
   - Test with agent: `b361a914-18bb-405c-92eb-8afe549ca9e1`
   - Verify button appears in WhatsApp
   - Verify draft message appears after click

---

## Files Modified

1. `backend/src/routes/webhookSendMessage.js`
   - Added EMAIL UID detection (lines 59-90)
   - Automatic button message conversion

2. `backend/src/routes/webhookButtonResponse.js`
   - New file for button click handling
   - UID extraction and webhook forwarding

3. `backend/src/services/baileysService.js`
   - Added EMAIL UID button click forwarding (lines 3127-3165)
   - Event listener for button responses

4. `backend/app.js`
   - Registered button-response webhook route (lines 40, 448)

---

## Summary

✅ **Complete Implementation:**
- EMAIL UID detection and button creation
- Button click event handling
- Internal webhook forwarding
- Comprehensive error handling
- Detailed logging
- Database storage preservation
- No breaking changes

The system now automatically converts email notifications with EMAIL UID to interactive button messages, allowing users to create draft responses with a single click.


