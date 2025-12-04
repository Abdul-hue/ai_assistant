# 📋 WhatsApp Webhook Integration - Quick Reference

## 🔄 Message Flow (1-to-1 Direct Conversation)

```
User sends WhatsApp message
    ↓
Baileys Socket receives (WebSocket)
    ↓
messages.upsert event fires
    ↓
shouldProcessMessage() filters (groups/broadcasts/status skipped)
    ↓
Extract message content (text/audio)
    ↓
Save to message_log table (Supabase)
    ↓
Build webhook payload
    ↓
forwardMessageToWebhook() → HTTP POST to n8n
    ↓
n8n workflow receives and processes
```

---

## 📁 Key Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `backend/src/services/baileysService.js` | Main message handler | `messages.upsert` listener, `forwardMessageToWebhook()` |
| `backend/src/services/n8nService.js` | Alternative webhook service (NOT used for messages) | `triggerN8nWebhook()` |
| `backend/src/routes/webhookSendMessage.js` | Outbound webhook (n8n → WhatsApp) | POST `/api/webhooks/send-message` |

---

## 🔧 Configuration

### Environment Variables

```bash
# Webhook URL (priority order)
WHATSAPP_MESSAGE_WEBHOOK=https://custom-url.com  # Highest priority
WHATSAPP_MESSAGE_WEBHOOK_PROD=https://auto.nsolbpo.com/webhook/...
WHATSAPP_MESSAGE_WEBHOOK_TEST=https://auto.nsolbpo.com/webhook-test/...

# Webhook behavior
WEBHOOK_ENV=production  # or 'test'
NODE_ENV=production     # Affects URL selection

# Retry configuration (to be added)
WEBHOOK_RETRY_MAX_ATTEMPTS=3
WEBHOOK_RETRY_INITIAL_DELAY=2000
```

### Default Webhook URLs

- **Production:** `https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab`
- **Test:** `https://auto.nsolbpo.com/webhook-test/a18ff948-9380-4abe-a8d8-0912dae2d8ab`

---

## 📦 Webhook Payload Structure

```json
{
  "agentId": "uuid",
  "user_id": "uuid",           // Optional
  "id": "message-id",
  "messageId": "message-id",
  "from": "923359503935",      // Clean phone number
  "to": "923336906200",        // Clean phone number
  "senderName": "Ahmed Khan",  // WhatsApp display name or null
  "conversationId": "923359503935@s.whatsapp.net",
  "messageType": "TEXT",       // or "AUDIO"
  "type": "text",              // lowercase
  "content": "Hello",          // Text content or null
  "mediaUrl": null,            // Signed URL for audio
  "mimetype": null,            // MIME type
  "timestamp": "2025-11-27T05:15:22.000Z",
  "metadata": {
    "platform": "whatsapp",
    "phoneNumber": "923336906200",
    "direction": "incoming",
    "remoteJid": "923359503935@s.whatsapp.net",
    "messageId": "3EB0EF457E9242C65E8C73",
    "senderName": "Ahmed Khan"  // Same as top-level senderName
  }
}
```

### Sender Name Extraction

The `senderName` field is extracted from the WhatsApp message using the following priority:

1. **`message.pushName`** - Primary source, the name set by the sender in WhatsApp
2. **`message.verifiedBisName`** - For verified business accounts (WhatsApp Business API)
3. **`message.notify`** - Fallback name field used by older WhatsApp versions
4. **`null`** - If no name is available from any source

**When senderName is null:**
- The sender has not set a display name in WhatsApp
- The contact is not saved on the agent's phone
- Privacy settings prevent name sharing
- Message from unknown/new contact

**Handling null values in n8n:**
- Use `from` (phone number) as fallback display
- Format as: `senderName || from || 'Unknown'`
- Example: `"Ahmed Khan" || "923336906200" || "Unknown"`

---

## 🚫 Messages That Are NOT Forwarded

- ❌ Group messages (`@g.us`)
- ❌ Broadcast messages (`@broadcast`)
- ❌ Status updates (`@status`)
- ❌ Newsletter messages (`@newsletter`)
- ❌ Protocol/system messages
- ❌ Messages without content
- ❌ Images/videos/documents without captions
- ❌ Stickers, contacts, locations

---

## ✅ Messages That ARE Forwarded

- ✅ TEXT messages with content
- ✅ AUDIO messages with mediaUrl (after download)

---

## ⚠️ Current Issues

### 🔴 CRITICAL
1. **No retry logic** - Failed webhooks are lost
2. **No duplicate prevention** - Same message may be sent multiple times
3. **No webhook logging** - Cannot debug failures

### 🟠 HIGH
4. **Blocking webhook calls** - Slow webhooks block message processing
5. **No circuit breaker** - Continues calling failing webhooks
6. **No rate limiting** - Could overwhelm n8n

### 🟡 MEDIUM
7. **Limited message types** - Only text and audio forwarded
8. **No quoted message extraction**
9. **No response time monitoring**

---

## 🔍 Debugging Commands

### Check Recent Messages
```sql
SELECT * FROM message_log 
WHERE agent_id = 'your-agent-id'
ORDER BY created_at DESC 
LIMIT 10;
```

### Check Webhook Logs (if implemented)
```sql
SELECT * FROM n8n_webhook_logs 
WHERE agent_id = 'your-agent-id'
ORDER BY created_at DESC 
LIMIT 10;
```

### Monitor Logs
```bash
# Watch for message reception
tail -f logs/app.log | grep "MESSAGES RECEIVED"

# Watch for webhook calls
tail -f logs/app.log | grep "WEBHOOK"
```

---

## 🧪 Testing

### Test Webhook Manually
```bash
curl -X POST https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab \
  -H "Content-Type: application/json" \
  -H "X-WhatsApp-Agent: your-agent-id" \
  -d '{
    "id": "test-123",
    "from": "923359503935",
    "to": "923336906200",
    "messageType": "TEXT",
    "content": "Test message"
  }'
```

### Test Message Flow
1. Send WhatsApp message to agent number
2. Check logs for: `[BAILEYS] ========== MESSAGES RECEIVED`
3. Check logs for: `[BAILEYS][WEBHOOK] ✅ Forwarded`
4. Verify n8n receives webhook

---

## 📊 Performance Metrics

### Current Behavior
- **Processing:** Synchronous (blocking)
- **Webhook Timeout:** 10 seconds
- **Retry Attempts:** 0 (no retry)
- **Rate Limit:** None
- **Concurrent Messages:** Supported (async handler)

### Bottlenecks
1. Database insert (blocks processing)
2. Webhook call (blocks processing, 10s timeout)
3. Audio download (blocks processing for audio messages)

---

## 🔐 Security Notes

- ✅ Phone numbers sanitized (digits only)
- ✅ JID format normalized
- ❌ No webhook authentication
- ❌ No payload encryption
- ❌ No signature verification
- ⚠️ Full phone numbers exposed in webhook

---

## 📝 Log Examples

### Message Received
```
[BAILEYS] ========== MESSAGES RECEIVED (notify) ==========
[BAILEYS] 📊 Received 1 message(s) of type: notify
[BAILEYS] ✅ Processing individual message from 923359503935@s.whatsapp.net
[BAILEYS] Message: menu
[BAILEYS] Message ID: 3EB0EF457E9242C65E8C73
```

### Webhook Success
```
[BAILEYS][WEBHOOK] ✅ Fetched user_id for agent d57f8ba9-5af7-455b-a438-dcd3df056fa1: 6b6405ee-b63c-4915-b545-443112dd28dd
[BAILEYS][WEBHOOK] ✅ Forwarded TEXT 3EB0EF457E9242C65E8C73 from 923359503935 (user_id: 6b6405ee-b63c-4915-b545-443112dd28dd)
```

### Webhook Failure
```
[BAILEYS][WEBHOOK] ❌ Failed to forward TEXT 3EB0EF457E9242C65E8C73 to https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab. Status: 404
```

---

## 🚀 Quick Fixes Priority

1. **Add retry logic** (5 minutes)
2. **Add duplicate prevention** (10 minutes)
3. **Add webhook logging** (15 minutes)
4. **Make webhook non-blocking** (2 minutes)

See `WEBHOOK_IMPROVEMENTS.md` for complete implementation code.

---

**Last Updated:** 2025-11-27

