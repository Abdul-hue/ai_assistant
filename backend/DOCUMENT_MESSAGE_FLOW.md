# WhatsApp Document Message Processing Flow

## Overview
This document explains how WhatsApp messages containing document files (PDF, Word, Excel, etc.) are processed and sent to webhooks.

---

## Complete Processing Flow

### **STEP 1: Message Reception** 
**File:** `backend/src/services/baileysService.js` (line ~3998)

**Event:** `messages.upsert` event fires when WhatsApp receives a message

**Process:**
1. Baileys library receives the message from WhatsApp servers
2. Message is deduplicated (60-second TTL cache)
3. Message is validated (skips system messages, broadcasts, etc.)

**Code Location:**
```javascript
sock.ev.on('messages.upsert', async ({ messages, type }) => {
  // Deduplication logic
  // Message validation
  // Processing...
});
```

---

### **STEP 2: Document Detection**
**File:** `backend/src/services/baileysService.js` (lines ~4351-4362, ~4721-4743)

**Process:**
1. Message type is identified as `DOCUMENT`
2. Document metadata is extracted:
   - `mimetype` (e.g., `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
   - `fileName` (if available)
   - `caption` (if document has a caption)
   - `fileLength` (file size in bytes)

**Code:**
```javascript
// Line ~4351-4352: Extract caption if available
if (msg.message.documentMessage?.caption) {
  messageText = `[Document] ${msg.message.documentMessage.caption}`;
}

// Line ~4361-4362: Fallback to placeholder
else if (msg.message.documentMessage) {
  messageText = '[Document]';
}

// Line ~4721-4743: Extract document metadata
if (documentMessage) {
  messageType = 'DOCUMENT';
  mediaMimetype = documentMessage.mimetype || 'application/octet-stream';
  mediaSize = documentMessage.fileLength ? Number(documentMessage.fileLength) : null;
  
  if (documentMessage.fileName) {
    messageMetadata.fileName = documentMessage.fileName;
  }
  
  if (documentMessage.caption) {
    content = documentMessage.caption;
  }
}
```

---

### **STEP 3: Message Saved to Database**
**File:** `backend/src/services/baileysService.js` (lines ~4970-5025)

**Process:**
1. Message is saved to `message_log` table with:
   - `message_id`: WhatsApp message ID
   - `agent_id`: Agent UUID
   - `message_type`: `'DOCUMENT'`
   - `content`: Caption or `'[Document]'` placeholder
   - `media_mimetype`: MIME type (e.g., `application/pdf`)
   - `metadata`: JSON containing `fileName`, `fileLength`, etc.
   - `media_url`: `null` (will be set after upload)
   - `media_size`: `null` (will be set after upload)

**Database Schema:**
```sql
INSERT INTO message_log (
  message_id,
  agent_id,
  message_type,
  content,
  media_mimetype,
  metadata,
  media_url,  -- NULL initially
  media_size, -- NULL initially
  created_at
) VALUES (...)
```

---

### **STEP 4: Message Persisted to Baileys Store**
**File:** `backend/src/services/baileysService.js` (lines ~5148-5189)

**CRITICAL:** Before queuing media processing, the message MUST be persisted to Baileys store so it can be retrieved during download.

**Process:**
1. Message is explicitly saved to `store.messages[remoteJid][messageId]`
2. Persistence is verified before proceeding
3. If persistence fails, media job is skipped (prevents download errors)

**Code:**
```javascript
// Ensure store structure exists
if (!store.messages[storeRemoteJid]) {
  store.messages[storeRemoteJid] = {};
}

// Persist message
store.messages[storeRemoteJid][messageId] = msg;
persisted = true;

// Verify persistence
const verifyMessage = store.messages[storeRemoteJid]?.[messageId];
if (!verifyMessage) {
  throw new Error('Message not found in store after persistence');
}
```

---

### **STEP 5: Media Job Queued**
**File:** `backend/src/services/baileysService.js` (lines ~5191-5230)

**Process:**
1. Media processing job is queued to Bull queue (`whatsapp-media-processing`)
2. Job includes:
   - `messageId`: WhatsApp message ID
   - `agentId`: Agent UUID
   - `mimetype`: Document MIME type
   - `metadata.webhookPayload`: Complete webhook payload (without `mediaUrl` yet)
   - `metadata.storeRemoteJid`: JID used in store (for @lid message lookup)

**Code:**
```javascript
const { queueMessage: queueMediaMessage } = require('../workers/mediaWorker');

await queueMediaMessage({
  messageId: messageId,
  agentId: agentId,
  metadata: {
    messageType: 'DOCUMENT',
    mimetype: mediaMimetype,
    mediaUrl: null, // Will be set after upload
    webhookPayload: {
      id: messageId,
      messageId,
      from: sanitizedFromNumber,
      to: sanitizedToNumber,
      messageType: 'DOCUMENT',
      content: content || null,
      mediaUrl: null, // Will be set after upload
      mimetype: mediaMimetype,
      timestamp: timestampIso,
      // ... other fields
    }
  }
});
```

**Note:** At this point, the webhook is NOT sent yet. It will be sent after media processing completes.

---

### **STEP 6: Media Processing (Background Job)**
**File:** `backend/src/workers/mediaWorker.js` (lines ~37-282)

**Queue:** Bull queue processes the job asynchronously

**Process:**

#### **6.1: Check if Already Processed**
- Checks if `media_url` already exists in database
- If exists, sends webhook immediately with existing URL
- Prevents duplicate processing

#### **6.2: Download Document from WhatsApp**
**File:** `backend/src/services/downloadService.js`

**Process:**
1. Retrieves socket and store for the agent
2. Finds message in store using `messageId` and `storeRemoteJid`
3. Downloads document using Baileys `downloadMediaMessage()` function
4. Returns buffer and file size

**Code:**
```javascript
const { buffer, size } = await downloadMediaFile(socket, messageId, mimetype, storeRemoteJid);
```

**Storage Path:**
- Documents are categorized by MIME type:
  - PDFs → `documents/`
  - Word docs → `documents/`
  - Excel files → `spreadsheets/`
  - Others → `others/`

**File Naming:**
- Format: `{agentId}/{category}/{date}_{messageId}.{ext}`
- Example: `b361a914.../documents/2026-02-02_ABC123.pdf`

#### **6.3: Upload to Supabase Storage**
**File:** `backend/src/services/storageService.js`

**Process:**
1. Uses Redis distributed lock to prevent concurrent uploads
2. Uploads buffer to Supabase Storage bucket (`whatsapp-media-files` by default)
3. Generates signed URL (valid for 7 days by default)
4. Returns: `{ url, storageKey, expiresAt }`

**Code:**
```javascript
uploadResult = await uploadFile(buffer, messageId, agentId, mimetype);
// Returns: { url: 'https://...', storageKey: '...', expiresAt: '...' }
```

**Storage Bucket:**
- Default: `whatsapp-media-files` (configurable via `STORAGE_BUCKET_NAME` env var)
- Path structure: `{agentId}/{category}/{date}_{messageId}.{ext}`

#### **6.4: Update Database with Media URL**
**File:** `backend/src/services/dbService.js`

**Process:**
1. Updates `message_log` table:
   - `media_url`: Signed URL to file
   - `media_mimetype`: MIME type
   - `media_size`: File size in bytes
   - `metadata.storageKey`: Storage path
   - `metadata.urlExpiresAt`: URL expiration timestamp

**Code:**
```javascript
await updateMessageMedia(messageId, {
  url: uploadResult.url,
  mimetype: mimetype,
  storageKey: uploadResult.storageKey,
  expiresAt: uploadResult.expiresAt,
  size: size
});
```

---

### **STEP 7: Webhook Sent**
**File:** `backend/src/workers/mediaWorker.js` (lines ~254-274)

**Process:**
1. After media upload completes, webhook payload is updated with `mediaUrl`
2. Webhook is sent via `forwardMessageToWebhook()`
3. Webhook includes complete document metadata

**Code:**
```javascript
if (job.data.metadata?.webhookPayload) {
  const { forwardMessageToWebhook } = require('../services/baileysService');
  const webhookPayload = {
    ...job.data.metadata.webhookPayload,
    mediaUrl: uploadResult.url, // ✅ Include uploaded media URL
    hasMediaUrl: true,
  };
  
  await forwardMessageToWebhook(agentId, webhookPayload);
}
```

**Webhook Payload Example:**
```json
{
  "id": "ABC123",
  "messageId": "ABC123",
  "from": "923359503935",
  "to": "923336906200",
  "senderName": "John Doe",
  "conversationId": "923359503935@s.whatsapp.net",
  "messageType": "DOCUMENT",
  "type": "document",
  "content": "[Document] Invoice_2024.pdf",
  "mediaUrl": "https://supabase.co/storage/v1/object/sign/whatsapp-media-files/b361a914.../documents/2026-02-02_ABC123.pdf?token=...",
  "mimetype": "application/pdf",
  "timestamp": "2026-02-02T23:22:00.000Z",
  "fromMe": false,
  "metadata": {
    "fileName": "Invoice_2024.pdf",
    "fileLength": 245678,
    "storageKey": "b361a914.../documents/2026-02-02_ABC123.pdf",
    "urlExpiresAt": "2026-02-09T23:22:00.000Z"
  },
  "source": "whatsapp"
}
```

---

### **STEP 8: Webhook Delivery**
**File:** `backend/src/services/baileysService.js` (function: `forwardMessageToWebhook`)

**Process:**
1. Fetches webhook URL from environment variables or agent settings
2. Fetches `user_id` from `agents` table
3. Sends HTTP POST request to webhook URL with:
   - Headers: `Content-Type: application/json`, `X-WhatsApp-Agent: {agentId}`
   - Timeout: 30 seconds (configurable via `N8N_WEBHOOK_TIMEOUT`)
   - Retry logic: 3 attempts with exponential backoff

**Webhook URL Priority:**
1. `process.env.WHATSAPP_MESSAGE_WEBHOOK` (explicit)
2. `process.env.WHATSAPP_MESSAGE_WEBHOOK_PROD` (if production)
3. `process.env.WHATSAPP_MESSAGE_WEBHOOK_TEST` (if test)
4. Default fallback URLs

---

## Key Points

### **1. Document Files ARE Downloaded and Stored**
- Unlike images/videos (which are NOT automatically downloaded), **document files ARE downloaded and uploaded to Supabase Storage**
- The webhook includes a `mediaUrl` pointing to the stored file
- The file is accessible via signed URL for 7 days (configurable)

### **2. Storage Bucket**
- **Default bucket:** `whatsapp-media-files`
- **Configurable via:** `STORAGE_BUCKET_NAME` environment variable
- **Path structure:** `{agentId}/{category}/{date}_{messageId}.{ext}`

### **3. File Categories**
Documents are categorized based on MIME type:
- **PDFs** → `documents/`
- **Word (.doc, .docx)** → `documents/`
- **Excel (.xls, .xlsx)** → `spreadsheets/`
- **Other documents** → `others/`

### **4. Webhook Timing**
- **Initial webhook:** NOT sent immediately when message is received
- **Final webhook:** Sent AFTER media download and upload completes
- **Webhook includes:** Complete document metadata + `mediaUrl` to stored file

### **5. Error Handling**
- If download fails: Job retries up to 3 times with exponential backoff
- If upload fails: Job retries, but webhook may be sent without `mediaUrl`
- If webhook fails: Logged but doesn't fail the job (webhook is non-critical)

### **6. Deduplication**
- Messages are deduplicated at reception (60-second TTL)
- Media jobs check if `media_url` already exists before processing
- Redis distributed lock prevents concurrent uploads

---

## Flow Diagram

```
WhatsApp Message Received
         ↓
[STEP 1] messages.upsert event fires
         ↓
[STEP 2] Document detected (messageType = 'DOCUMENT')
         ↓
[STEP 3] Message saved to database (media_url = null)
         ↓
[STEP 4] Message persisted to Baileys store
         ↓
[STEP 5] Media job queued (with webhook payload, mediaUrl = null)
         ↓
[STEP 6] Background job processes:
         ├─ 6.1: Check if already processed
         ├─ 6.2: Download document from WhatsApp
         ├─ 6.3: Upload to Supabase Storage
         └─ 6.4: Update database with media_url
         ↓
[STEP 7] Webhook sent with mediaUrl
         ↓
[STEP 8] Webhook delivered to endpoint
```

---

## Environment Variables

```bash
# Storage
STORAGE_BUCKET_NAME=whatsapp-media-files  # Default bucket name

# Webhook
N8N_WEBHOOK_TIMEOUT=30000                 # Webhook timeout (30 seconds)
WEBHOOK_RETRY_MAX_ATTEMPTS=3              # Max retry attempts
WHATSAPP_MESSAGE_WEBHOOK=https://...       # Webhook URL

# Queue
QUEUE_CONCURRENCY=5                        # Concurrent media jobs
RETRY_ATTEMPTS=3                           # Job retry attempts
```

---

## Summary

**When a WhatsApp message with a document file is received:**

1. ✅ Message is detected and saved to database
2. ✅ Document is downloaded from WhatsApp servers
3. ✅ Document is uploaded to Supabase Storage
4. ✅ Database is updated with `media_url` (signed URL)
5. ✅ Webhook is sent with complete document metadata including `mediaUrl`
6. ✅ Webhook receiver can download the file directly from `mediaUrl`

**The webhook includes:**
- Document metadata (fileName, mimetype, size)
- `mediaUrl`: Direct link to stored file (valid for 7 days)
- Complete message context (from, to, timestamp, etc.)
