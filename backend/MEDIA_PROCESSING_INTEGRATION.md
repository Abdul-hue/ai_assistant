# WhatsApp Media Processing System - Integration Guide

## Overview

This system processes WhatsApp media files (PDF, Word, Excel, Images, Videos), uploads them to Supabase Storage, and forwards the data to N8N webhooks.

## Installation

### 1. Install Dependencies

```bash
cd backend
npm install bull@^4.11.5
```

### 2. Environment Variables

Add these to your `.env` file:

```env
# Redis Configuration (for Bull queue)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# N8N Webhook
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/whatsapp-media

# Storage Configuration
STORAGE_BUCKET_NAME=whatsapp-media-files
SIGNED_URL_EXPIRY=604800  # 7 days in seconds

# Processing Configuration
MAX_FILE_SIZE=52428800  # 50MB in bytes
QUEUE_CONCURRENCY=5
RETRY_ATTEMPTS=3
```

### 3. Supabase Storage Bucket

Ensure the bucket `whatsapp-media-files` exists in your Supabase project:

```sql
-- The bucket should already exist, but if not:
-- Create it via Supabase Dashboard or API
```

## Socket Manager Integration

The `socketManager.js` needs to be integrated with your existing Baileys connection management.

### Option 1: Integrate with baileysService.js

In `backend/src/services/baileysService.js`, after creating a socket:

```javascript
const { registerSocket, removeSocket } = require('../utils/socketManager');

// After socket is created and connected:
async function initializeWhatsApp(agentId, userId = null) {
  // ... existing code ...
  
  const sock = makeWASocket({
    // ... socket config ...
  });
  
  // Register socket for media processing
  registerSocket(agentId, sock);
  
  // ... rest of initialization ...
  
  // On disconnect/cleanup:
  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'close') {
      removeSocket(agentId);
    }
  });
}
```

### Option 2: Use Existing Session Management

If you have an existing session management system, update `socketManager.js` to use it:

```javascript
// In socketManager.js, replace getSocket function:
const sessionCache = require('./sessionCache'); // or your session manager

function getSocket(agentId) {
  // Use your existing session management
  const session = sessionCache.getSession(agentId);
  return session?.socket || null;
}
```

## Webhook Endpoint

The webhook is available at:

```
POST /webhook/:webhookId
```

Example:
```
POST /webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab
```

### Webhook Payload

```json
{
  "messageId": "3EB0EF457E9242C65E8C73",
  "from": "1234567890",
  "to": "0987654321",
  "body": "[Document] report.pdf",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "isFromMe": false,
  "agentId": "agent-uuid",
  "user_id": "user-uuid",
  "metadata": {
    "messageType": "TEXT",
    "conversationId": "1234567890@s.whatsapp.net",
    "senderName": "John Doe",
    "mimetype": "application/pdf"
  }
}
```

## Processing Flow

1. **Webhook receives message** → Stores in `message_log` table
2. **Queue job created** → Added to Bull queue for async processing
3. **Download media** (if needed) → Downloads from WhatsApp using Baileys
4. **Upload to storage** → Uploads to Supabase Storage bucket
5. **Update database** → Updates `message_log` with `media_url`
6. **Forward to N8N** → Sends complete data to N8N webhook
7. **Mark processed** → Sets `processed=true` in database

## File Organization

Files are stored in Supabase Storage with this structure:

```
{agentId}/{category}/{date}_{messageId}.{ext}
```

Categories:
- `documents/` - PDFs, Word, Excel
- `images/` - JPG, PNG, GIF, WebP
- `videos/` - MP4, 3GP, etc.
- `audio/` - OGG, MP3, etc.
- `others/` - Unknown types

## Monitoring

### Queue Status

Check queue status:
```
GET /queue/status
```

Response:
```json
{
  "status": "ok",
  "queue": {
    "waiting": 5,
    "active": 2,
    "completed": 100,
    "failed": 3
  }
}
```

### Health Check

```
GET /health
```

## Error Handling

- **Download failures**: Retried 3 times, error stored in `metadata.error`
- **Upload failures**: Retried 3 times, error stored in `metadata.error`
- **N8N failures**: Retried 3 times, message remains `processed=false`
- **Socket not found**: Error logged, job fails and retries

## Testing

### Test Text Message

```bash
curl -X POST http://localhost:3001/webhook/test-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "TEXT123",
    "from": "1234567890",
    "to": "0987654321",
    "body": "Hello, this is a test",
    "timestamp": "2025-01-15T10:00:00Z",
    "isFromMe": false,
    "agentId": "agent-123",
    "user_id": "user-456",
    "metadata": {
      "messageType": "TEXT",
      "conversationId": "1234567890@s.whatsapp.net",
      "senderName": "Test User"
    }
  }'
```

### Test PDF Document

```bash
curl -X POST http://localhost:3001/webhook/test-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "PDF456",
    "from": "1234567890",
    "body": "[Document] report.pdf",
    "timestamp": "2025-01-15T10:00:00Z",
    "agentId": "agent-123",
    "metadata": {
      "messageType": "TEXT",
      "conversationId": "1234567890@s.whatsapp.net",
      "senderName": "Test User",
      "mimetype": "application/pdf"
    }
  }'
```

## Troubleshooting

### Redis Connection Issues

```bash
# Check Redis is running
redis-cli ping

# Should return: PONG
```

### Queue Not Processing

1. Check Redis connection
2. Check queue status: `GET /queue/status`
3. Check logs for errors
4. Verify socket manager has active sockets

### Files Not Uploading

1. Verify Supabase Storage bucket exists
2. Check bucket permissions
3. Verify `SUPABASE_SERVICE_ROLE_KEY` is set
4. Check file size (must be < MAX_FILE_SIZE)

### N8N Not Receiving Data

1. Verify `N8N_WEBHOOK_URL` is correct
2. Check N8N webhook is accessible
3. Review error logs in database `metadata.error` field

## Database Schema

The system uses the existing `message_log` table:

- `message_id` - Unique WhatsApp message ID
- `media_url` - Signed URL to file in Supabase Storage
- `media_mimetype` - File MIME type
- `media_size` - File size in bytes
- `processed` - Boolean flag (true after N8N forwarding)
- `metadata` - JSONB field storing additional info (errors, storage keys, etc.)

## Next Steps

1. ✅ Install Bull package
2. ✅ Configure environment variables
3. ✅ Integrate socket manager with Baileys
4. ✅ Test webhook endpoint
5. ✅ Monitor queue processing
6. ✅ Verify N8N receives data
