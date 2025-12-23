# Webhook Source Tracking Implementation

## Overview
Implemented unified webhook system with source tracking to differentiate between WhatsApp and dashboard messages using a single webhook URL with a `source` flag in the payload.

## Implementation Summary

### 1. Database Migration
**File:** `backend/migrations/017_add_message_source_column.sql`

- Added `source` column to `message_log` table (VARCHAR(20), default 'whatsapp')
- Added index on `source` column for filtering
- Added composite index for duplicate detection queries
- Updated existing records to have `source='whatsapp'` for backward compatibility

### 2. Centralized Webhook Service
**File:** `backend/src/services/webhookService.js` (NEW)

- Created centralized webhook service with retry logic
- Implements exponential backoff (1s, 2s, 4s) for failed webhooks
- Handles errors gracefully without blocking message processing
- Logs all webhook attempts (success and failure)

### 3. Baileys Service Updates
**File:** `backend/src/services/baileysService.js`

**Added Functions:**
- `checkIfRecentDashboardMessage()` - Detects duplicate WhatsApp echoes of dashboard messages
- Updated `forwardMessageToWebhook()` - Uses centralized webhook service with standardized payload

**Updated Message Handler:**
- All WhatsApp messages now have `source='whatsapp'` in database
- Duplicate detection prevents webhook spam for dashboard message echoes
- Webhook payload includes `source` field

### 4. Dashboard Message Handler Updates
**File:** `backend/src/routes/messages.js`

- Dashboard messages now have `source='dashboard'` in database
- Webhooks are triggered for all dashboard messages
- Webhook payload includes `source='dashboard'` flag

### 5. Environment Variables
**File:** `backend/env.example`

- Updated documentation for `WHATSAPP_MESSAGE_WEBHOOK_PROD`
- Added comments explaining unified webhook with source filtering

## Webhook Payload Structure

All webhooks now use this standardized structure:

```json
{
  "source": "whatsapp" | "dashboard",
  "messageId": "string",
  "from": "string",
  "to": "string",
  "body": "string",
  "timestamp": "ISO 8601 string",
  "isFromMe": boolean,
  "agentId": "uuid",
  "user_id": "uuid",
  "metadata": {
    "messageType": "text" | "audio",
    "conversationId": "string",
    "senderName": "string",
    "mediaUrl": "string",
    "mimetype": "string"
  }
}
```

## Message Flow

### Dashboard Message Flow:
1. User sends message via dashboard → `POST /api/agents/:id/messages`
2. Message saved to database with `source='dashboard'`
3. Message sent via WhatsApp using Baileys
4. Webhook triggered with `source='dashboard'` ✅
5. WhatsApp echoes message back → Detected as duplicate → Webhook skipped ✅

### WhatsApp Message Flow:
1. External user sends message → Received via Baileys `messages.upsert`
2. Message saved to database with `source='whatsapp'`
3. Duplicate check runs (only for incoming messages)
4. Webhook triggered with `source='whatsapp'` ✅

## Duplicate Prevention Logic

When a user sends a message from dashboard to agent's own number:

1. **Dashboard message sent** → `source='dashboard'` → Webhook sent ✅
2. **WhatsApp echo received** → `source='whatsapp'` → Duplicate detected → Webhook skipped ✅

**Duplicate Detection:**
- Checks for matching dashboard message within 5-second window
- Matches on: content + phone number + source + timestamp
- Only applies to incoming messages (not outgoing)
- Fails open (sends webhook on error) for safety

## Webhook Receiver Filtering

The webhook receiver can filter messages based on the `source` field:

```javascript
// Example webhook receiver code
app.post('/webhook/messages', (req, res) => {
  const { source, messageId, from, to, body, timestamp } = req.body;
  
  if (source === 'whatsapp') {
    // Handle external WhatsApp messages
    handleWhatsAppMessage(req.body);
  } else if (source === 'dashboard') {
    // Handle dashboard chat messages
    handleDashboardMessage(req.body);
  }
  
  res.status(200).json({ success: true });
});
```

## Key Features

✅ **Unified Webhook** - Single URL with source flags
✅ **No Filtering** - All messages sent to webhook with appropriate source
✅ **Duplicate Prevention** - Detects WhatsApp echoes of dashboard messages
✅ **Retry Logic** - Exponential backoff (1s, 2s, 4s) for failed webhooks
✅ **Error Handling** - Graceful failure, never blocks message processing
✅ **Backward Compatibility** - Existing messages default to 'whatsapp'
✅ **Clear Separation** - Webhook receiver can filter by source flag

## Testing Checklist

- [ ] Verify WhatsApp messages have `source='whatsapp'` in database
- [ ] Verify dashboard messages have `source='dashboard'` in database
- [ ] Verify webhooks are sent for both sources
- [ ] Verify duplicate webhooks are prevented for dashboard message echoes
- [ ] Verify retry logic works on webhook failures
- [ ] Verify backward compatibility (existing messages default to 'whatsapp')

## Migration Steps

1. Run database migration:
   ```bash
   psql -d your_database -f backend/migrations/017_add_message_source_column.sql
   ```

2. Restart backend server to load new webhook service

3. Test with both dashboard and WhatsApp messages

4. Verify webhook receiver receives messages with correct `source` flags

## Notes

- All existing messages will have `source='whatsapp'` after migration
- Webhook failures are logged but don't block message processing
- Duplicate detection only affects echoes of dashboard messages
- Webhook receiver must handle both `source='whatsapp'` and `source='dashboard'`

