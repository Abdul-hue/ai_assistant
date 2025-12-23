# Interactive Chat Buttons Implementation Guide

## ✅ YES - HTML Buttons Are Already Supported!

Your dashboard **already has button support built-in**. You don't need to send HTML - the frontend automatically parses numbered options from message text and converts them to clickable buttons.

---

## Current Architecture

### Frontend (Already Implemented ✅)
1. **MessageBubble Component** (`frontend/src/components/chat/MessageBubble.tsx`)
   - Automatically parses buttons from message text
   - Only for dashboard agent messages (`source: 'dashboard'` and `sender_type: 'agent'`)
   - Renders buttons using `MessageButtons` component

2. **Button Parser** (`frontend/src/utils/messageButtonParser.ts`)
   - Parses numbered options (1-6) from message text
   - Supports formats:
     - `*1️⃣ Send Message*` (bold with emoji)
     - `*1. Send Message*` (bold with period)
     - `1️⃣ Send Message` (plain with emoji)
     - `1. Send Message` (plain with period)

3. **MessageButtons Component** (`frontend/src/components/chat/MessageButtons.tsx`)
   - Renders clickable buttons in grid layout
   - Button clicks trigger `onButtonClick` handler
   - Sends button text as a new message

### Backend (Needs Modification ⚠️)
- **Webhook Endpoint** (`/api/webhooks/send-message`)
  - Currently only sends to WhatsApp
  - **Does NOT store agent responses in database**
  - **This is the missing piece!**

---

## Problem

When n8n sends a response via `/api/webhooks/send-message`:
1. ✅ Message is sent to WhatsApp
2. ❌ Message is NOT stored in database
3. ❌ Message does NOT appear in dashboard
4. ❌ Buttons are NOT displayed

---

## Solution

### Step 1: Modify Webhook Endpoint to Store Agent Responses

Update `backend/src/routes/webhookSendMessage.js` to store agent responses in the database:

```javascript
// After successfully sending message to WhatsApp (line ~255)
// Add this code:

// ✅ NEW: Store agent response in database for dashboard display
try {
  const { data: agentData } = await supabaseAdmin
    .from('agents')
    .select('user_id, whatsapp_phone_number')
    .eq('id', agentId)
    .single();

  if (agentData && agentData.user_id) {
    const now = new Date().toISOString();
    const agentMessageId = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    // Store agent response in message_log table
    const { error: insertError } = await supabaseAdmin
      .from('message_log')
      .insert({
        message_id: agentMessageId,
        conversation_id: `${agentData.whatsapp_phone_number}@s.whatsapp.net`,
        sender_phone: agentData.whatsapp_phone_number,
        agent_id: agentId,
        user_id: agentData.user_id,
        message_text: message.trim(),
        message: message.trim(), // New column
        received_at: now,
        created_at: now,
        timestamp: now, // New column
        message_type: 'text',
        source: 'dashboard', // CRITICAL: Mark as dashboard origin
        sender_type: 'agent', // CRITICAL: Mark as agent message
        is_from_me: false, // Agent message (not from user)
        status: 'delivered',
      });

    if (insertError) {
      console.warn(`${logPrefix} ⚠️  Failed to store agent response in database:`, insertError.message);
      // Don't fail the webhook - WhatsApp message was sent successfully
    } else {
      console.log(`${logPrefix} ✅ Agent response stored in database for dashboard display`);
    }
  }
} catch (dbError) {
  console.error(`${logPrefix} ❌ Error storing agent response:`, dbError.message);
  // Don't fail the webhook - WhatsApp message was sent successfully
}
```

### Step 2: Message Format from n8n

Your n8n workflow should send messages in this format (buttons are automatically parsed):

**Example Message with Buttons:**
```
👋 Welcome to your *AI Assistant*!

Please select an option:

*1️⃣ Send Message*
*2️⃣ Schedule Meeting*
*3️⃣ Meetings / Scheduled Meetings*
*4️⃣ View Profile*
*5️⃣ Settings*
*6️⃣ Help*
```

**The frontend will automatically:**
1. Parse the numbered options
2. Extract button text
3. Display as clickable buttons
4. Handle button clicks (sends button text as new message)

### Step 3: Button Click Flow

When user clicks a button:
1. Button text (e.g., `1️⃣ Send Message`) is sent as a new message
2. Message goes to `/api/agents/:agentId/messages` endpoint
3. Message is stored in database with `source: 'dashboard'` and `sender_type: 'user'`
4. Message is sent to WhatsApp
5. n8n webhook receives the message
6. n8n processes and responds
7. n8n sends response via `/api/webhooks/send-message`
8. Response is stored in database (after Step 1 fix)
9. Frontend displays response with buttons

---

## Implementation Steps

### 1. Update Webhook Endpoint

**File:** `backend/src/routes/webhookSendMessage.js`

Add the database storage code after line 255 (after successful WhatsApp send).

### 2. Test Message Format

Send this test message from n8n:
```json
{
  "agentId": "your-agent-id",
  "to": "phone-number",
  "message": "👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
}
```

### 3. Verify Database Storage

Check `message_log` table:
- `source` = `'dashboard'`
- `sender_type` = `'agent'`
- `message` contains the button text

### 4. Verify Frontend Display

- Message should appear in dashboard chat
- Buttons should be rendered below message
- Button clicks should send button text

---

## Security Considerations

### ✅ Current Implementation (Safe)
- **No HTML rendering** - buttons are parsed from plain text
- **No XSS risk** - text is displayed as-is, buttons are React components
- **Sanitized input** - message length is limited (4096 chars)

### ⚠️ If You Want HTML Support (Not Recommended)
If you really want HTML buttons, you would need:
1. HTML sanitization library (DOMPurify)
2. React's `dangerouslySetInnerHTML` (risky)
3. Custom HTML parser
4. XSS protection

**Recommendation:** Stick with the current text-based button parsing - it's safer and already works!

---

## Alternative: Custom Button Format

If you want more control, you can extend the button parser to support JSON format:

**Current Format:**
```
*1️⃣ Send Message*
```

**Extended Format (Future):**
```json
{
  "message": "Welcome!",
  "buttons": [
    { "id": "1", "text": "Send Message", "action": "send_message" },
    { "id": "2", "text": "Schedule", "action": "schedule" }
  ]
}
```

But this requires frontend changes. The current text-based format is simpler and already works!

---

## Complete Code Example

### Backend: Updated Webhook Endpoint

```javascript
// In backend/src/routes/webhookSendMessage.js
// After line 255 (after successful WhatsApp send)

// ✅ Store agent response in database for dashboard display
try {
  const { data: agentData } = await supabaseAdmin
    .from('agents')
    .select('user_id, whatsapp_phone_number')
    .eq('id', agentId)
    .single();

  if (agentData && agentData.user_id) {
    const now = new Date().toISOString();
    const agentMessageId = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    const { error: insertError } = await supabaseAdmin
      .from('message_log')
      .insert({
        message_id: agentMessageId,
        conversation_id: `${agentData.whatsapp_phone_number}@s.whatsapp.net`,
        sender_phone: agentData.whatsapp_phone_number,
        agent_id: agentId,
        user_id: agentData.user_id,
        message_text: message.trim(),
        message: message.trim(),
        received_at: now,
        created_at: now,
        timestamp: now,
        message_type: 'text',
        source: 'dashboard',
        sender_type: 'agent',
        is_from_me: false,
        status: 'delivered',
      });

    if (insertError) {
      console.warn(`${logPrefix} ⚠️  Failed to store agent response:`, insertError.message);
    } else {
      console.log(`${logPrefix} ✅ Agent response stored for dashboard`);
    }
  }
} catch (dbError) {
  console.error(`${logPrefix} ❌ Error storing agent response:`, dbError.message);
}
```

### n8n: Message Format Example

```javascript
// In your n8n workflow, format the response like this:
{
  "agentId": "{{ $json.agentId }}",
  "to": "{{ $json.to }}",
  "message": "👋 Welcome to your *AI Assistant*!\n\nPlease select an option:\n\n*1️⃣ Send Message*\n*2️⃣ Schedule Meeting*\n*3️⃣ View Meetings*"
}
```

---

## Testing Checklist

- [ ] Update webhook endpoint to store agent responses
- [ ] Send test message from n8n with button format
- [ ] Verify message appears in dashboard
- [ ] Verify buttons are rendered
- [ ] Click a button and verify it sends as new message
- [ ] Verify button click triggers n8n webhook
- [ ] Verify n8n response appears with buttons

---

## Summary

✅ **YES - Buttons are already supported!**
- Frontend automatically parses numbered options
- No HTML needed - plain text with `*1️⃣ Option*` format
- Just need to store agent responses in database
- One backend change required

**Next Step:** Implement the database storage code in the webhook endpoint.

