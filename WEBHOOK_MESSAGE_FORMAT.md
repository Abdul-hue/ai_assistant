# Webhook Message Format and File Handling

## Overview

This document explains how the WhatsApp agent sends messages to the webhook endpoint `https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab` when a new message is received, and how different file types (PDF, Word, Excel, Images) are handled.

---

## Webhook Endpoint

**Production URL:** `https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab`

**Test URL:** `https://auto.nsolbpo.com/webhook-test/a18ff948-9380-4abe-a8d8-0912dae2d8ab`

The webhook is triggered automatically when a new WhatsApp message is received by any connected agent.

---

## Webhook Payload Structure

When a new message is received, the system sends a POST request to the webhook with the following JSON payload:

```json
{
  "source": "whatsapp",
  "messageId": "3EB0EF457E9242C65E8C73",
  "from": "1234567890",
  "to": "0987654321",
  "body": "Message content or placeholder text",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "isFromMe": false,
  "agentId": "agent-uuid-here",
  "user_id": "user-uuid-here",
  "metadata": {
    "messageType": "TEXT",
    "conversationId": "1234567890@s.whatsapp.net",
    "senderName": "John Doe",
    "mediaUrl": "https://storage.example.com/file.pdf",
    "mimetype": "application/pdf"
  }
}
```

### Payload Fields Explained

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Message source: `"whatsapp"` (from WhatsApp) or `"dashboard"` (from dashboard UI) |
| `messageId` | string | Unique WhatsApp message ID |
| `from` | string | Phone number of the sender (sanitized, no @s.whatsapp.net) |
| `to` | string | Phone number of the recipient (sanitized) |
| `body` | string | Message text content, caption, or placeholder text |
| `timestamp` | string | ISO 8601 timestamp when message was received |
| `isFromMe` | boolean | `true` if message was sent by the agent, `false` if received |
| `agentId` | string | UUID of the agent that received the message |
| `user_id` | string | UUID of the user who owns the agent (optional, only if available) |
| `metadata.messageType` | string | Type of message: `"TEXT"`, `"AUDIO"`, `"BUTTON_RESPONSE"` |
| `metadata.conversationId` | string | WhatsApp conversation JID |
| `metadata.senderName` | string | Display name of the sender (if available) |
| `metadata.mediaUrl` | string\|null | URL to the media file (if downloaded and uploaded) |
| `metadata.mimetype` | string\|null | MIME type of the media file (if available) |

---

## File Handling Scenarios

### 1. Text Messages

**Scenario:** User sends a plain text message.

**Webhook Payload:**
```json
{
  "source": "whatsapp",
  "messageId": "ABC123",
  "from": "1234567890",
  "to": "0987654321",
  "body": "Hello, how are you?",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "isFromMe": false,
  "agentId": "agent-uuid",
  "user_id": "user-uuid",
  "metadata": {
    "messageType": "TEXT",
    "conversationId": "1234567890@s.whatsapp.net",
    "senderName": "John Doe",
    "mediaUrl": null,
    "mimetype": null
  }
}
```

**How it works:**
- Text content is extracted directly from the message
- No media processing required
- `body` contains the actual message text
- `metadata.mediaUrl` and `metadata.mimetype` are `null`

---

### 2. Image Messages

**Scenario:** User sends an image (JPG, PNG, GIF, etc.).

**Webhook Payload:**
```json
{
  "source": "whatsapp",
  "messageId": "IMG456",
  "from": "1234567890",
  "to": "0987654321",
  "body": "[Image] Optional caption text here",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "isFromMe": false,
  "agentId": "agent-uuid",
  "user_id": "user-uuid",
  "metadata": {
    "messageType": "TEXT",
    "conversationId": "1234567890@s.whatsapp.net",
    "senderName": "John Doe",
    "mediaUrl": null,
    "mimetype": "image/jpeg"
  }
}
```

**How it works:**
- **Image files are NOT downloaded or uploaded to storage**
- If the image has a caption, `body` contains `"[Image] {caption}"`
- If no caption, `body` contains just `"[Image]"`
- `metadata.mimetype` contains the MIME type (e.g., `"image/jpeg"`, `"image/png"`)
- `metadata.mediaUrl` is `null` (image is not stored)
- The webhook receiver can use the WhatsApp message ID to download the image if needed

**Note:** The actual image file is not automatically downloaded. The webhook receives metadata about the image, but the file remains on WhatsApp's servers. To access the image, the webhook receiver would need to use the WhatsApp API with the `messageId` to download it.

---

### 3. PDF Documents

**Scenario:** User sends a PDF file.

**Webhook Payload:**
```json
{
  "source": "whatsapp",
  "messageId": "PDF789",
  "from": "1234567890",
  "to": "0987654321",
  "body": "[Document] Invoice_2024.pdf",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "isFromMe": false,
  "agentId": "agent-uuid",
  "user_id": "user-uuid",
  "metadata": {
    "messageType": "TEXT",
    "conversationId": "1234567890@s.whatsapp.net",
    "senderName": "John Doe",
    "mediaUrl": null,
    "mimetype": "application/pdf"
  }
}
```

**How it works:**
- **PDF files are NOT downloaded or uploaded to storage**
- If the document has a caption or filename, `body` contains `"[Document] {caption/filename}"`
- If no caption, `body` contains just `"[Document]"`
- `metadata.mimetype` contains `"application/pdf"`
- `metadata.mediaUrl` is `null` (PDF is not stored)
- The webhook receiver can use the WhatsApp message ID to download the PDF if needed

**Note:** Similar to images, PDF files are not automatically downloaded. The webhook receives metadata about the document, but the file remains on WhatsApp's servers.

---

### 4. Word Documents (.doc, .docx)

**Scenario:** User sends a Microsoft Word document.

**Webhook Payload:**
```json
{
  "source": "whatsapp",
  "messageId": "DOC321",
  "from": "1234567890",
  "to": "0987654321",
  "body": "[Document] Report.docx",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "isFromMe": false,
  "agentId": "agent-uuid",
  "user_id": "user-uuid",
  "metadata": {
    "messageType": "TEXT",
    "conversationId": "1234567890@s.whatsapp.net",
    "senderName": "John Doe",
    "mediaUrl": null,
    "mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
}
```

**How it works:**
- **Word documents are NOT downloaded or uploaded to storage**
- `body` contains `"[Document] {filename}"` if filename is available, or just `"[Document]"`
- `metadata.mimetype` contains:
  - `"application/vnd.openxmlformats-officedocument.wordprocessingml.document"` for .docx files
  - `"application/msword"` for .doc files
- `metadata.mediaUrl` is `null` (document is not stored)

**Supported Word MIME Types:**
- `.doc`: `application/msword`
- `.docx`: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

---

### 5. Excel Spreadsheets (.xls, .xlsx)

**Scenario:** User sends a Microsoft Excel spreadsheet.

**Webhook Payload:**
```json
{
  "source": "whatsapp",
  "messageId": "XLS654",
  "from": "1234567890",
  "to": "0987654321",
  "body": "[Document] Sales_Data.xlsx",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "isFromMe": false,
  "agentId": "agent-uuid",
  "user_id": "user-uuid",
  "metadata": {
    "messageType": "TEXT",
    "conversationId": "1234567890@s.whatsapp.net",
    "senderName": "John Doe",
    "mediaUrl": null,
    "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
}
```

**How it works:**
- **Excel files are NOT downloaded or uploaded to storage**
- `body` contains `"[Document] {filename}"` if filename is available, or just `"[Document]"`
- `metadata.mimetype` contains:
  - `"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"` for .xlsx files
  - `"application/vnd.ms-excel"` for .xls files
- `metadata.mediaUrl` is `null` (spreadsheet is not stored)

---

### 6. Audio/Voice Messages

**Scenario:** User sends an audio or voice message.

**Webhook Payload:**
```json
{
  "source": "whatsapp",
  "messageId": "AUD987",
  "from": "1234567890",
  "to": "0987654321",
  "body": "[Audio/Voice Message]",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "isFromMe": false,
  "agentId": "agent-uuid",
  "user_id": "user-uuid",
  "metadata": {
    "messageType": "AUDIO",
    "conversationId": "1234567890@s.whatsapp.net",
    "senderName": "John Doe",
    "mediaUrl": "https://storage.supabase.co/object/sign/agent-audio-messages/agent-id/1234567890-AUD987.ogg?token=...",
    "mimetype": "audio/ogg"
  }
}
```

**How it works:**
- **Audio files ARE downloaded and uploaded to Supabase storage**
- The audio file is downloaded from WhatsApp
- Uploaded to Supabase storage bucket (`agent-audio-messages`)
- A signed URL is generated and included in `metadata.mediaUrl`
- `body` contains `"[Audio/Voice Message]"`
- `metadata.mimetype` contains the audio MIME type (e.g., `"audio/ogg"`, `"audio/mpeg"`)
- `metadata.messageType` is `"AUDIO"` (not `"TEXT"`)

**Supported Audio Formats:**
- OGG/Opus (`audio/ogg`)
- MP3 (`audio/mpeg`)
- M4A (`audio/mp4`)
- AAC (`audio/aac`)
- AMR (`audio/amr`)
- 3GP (`audio/3gpp`)

**Storage Details:**
- Files are stored in: `{agentId}/{timestamp}-{messageId}.{extension}`
- Signed URLs have a TTL (Time To Live) for security
- Files are stored in a private bucket (not publicly accessible)

---

## Summary Table

| File Type | Downloaded? | Uploaded? | mediaUrl | Body Content | mimetype | Processing Required |
|-----------|-------------|-----------|----------|-------------|----------|-------------------|
| **Text** | N/A | N/A | `null` | Actual message text | `null` | Direct processing |
| **Image** | ❌ No | ❌ No | `null` | `"[Image]"` or `"[Image] {caption}"` | `image/jpeg`, `image/png`, etc. | Download via API |
| **PDF** | ❌ No | ❌ No | `null` | `"[Document]"` or `"[Document] {filename}"` | `application/pdf` | Download via API |
| **Word (.doc/.docx)** | ❌ No | ❌ No | `null` | `"[Document]"` or `"[Document] {filename}"` | `application/msword` or `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | Download via API |
| **Excel (.xls/.xlsx)** | ❌ No | ❌ No | `null` | `"[Document]"` or `"[Document] {filename}"` | `application/vnd.ms-excel` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | Download via API |
| **Audio/Voice** | ✅ Yes | ✅ Yes | Signed URL | `"[Audio/Voice Message]"` | `audio/ogg`, `audio/mpeg`, etc. | Direct download from URL |
| **Video** | ❌ No | ❌ No | `null` | `"[Video]"` or `"[Video] {caption}"` | `video/mp4`, etc. | Download via API |
| **Contact** | N/A | N/A | `null` | `"[Contact: {name}]"` | `null` | Extract from message |
| **Location** | N/A | N/A | `null` | `"[Location]"` | `null` | Extract from message |

---

## Important Notes

### For Images, PDFs, Word, and Excel Files:

1. **Files are NOT automatically downloaded** - The webhook receives metadata about the file, but the actual file remains on WhatsApp's servers.

2. **To access the file**, the webhook receiver would need to:
   - Use the WhatsApp Business API or Baileys library
   - Use the `messageId` from the webhook payload
   - Download the file using the WhatsApp media download endpoint

3. **The `metadata.mimetype` field** is reliable and can be used to determine the file type.

4. **The `body` field** may contain:
   - A caption (for images/videos)
   - A filename (for documents)
   - Or just a placeholder like `"[Image]"` or `"[Document]"`

### For Audio Files:

1. **Files ARE automatically downloaded and stored** in Supabase storage.

2. **The `metadata.mediaUrl`** contains a signed URL that can be used to access the file directly.

3. **The signed URL has an expiration time** (TTL), so it should be used promptly or the file should be downloaded and stored by the webhook receiver.

---

## Webhook Retry Logic

The webhook service includes automatic retry logic:

- **Max Retries:** 3 attempts (configurable via `WEBHOOK_RETRY_MAX_ATTEMPTS`)
- **Retry Delay:** Exponential backoff (2s, 4s, 8s)
- **Timeout:** 10 seconds per request
- **Headers:** 
  - `Content-Type: application/json`
  - `User-Agent: WhatsApp-Dashboard/1.0`
  - `X-Webhook-Source: whatsapp` or `dashboard`

If all retries fail, the error is logged but message processing continues (webhook failures don't block message storage).

---

## Recommended Approaches for Processing Messages

### Overview

This section outlines recommended approaches for processing different message types, downloading files, and extracting contact information from webhook payloads.

---

## Processing Images, PDFs, Word, and Excel Files

### Approach 1: Download Files via API Endpoint (Recommended)

**Recommended for:** Production environments where you need reliable file access.

The recommended approach is to create an API endpoint in your webhook receiver that can download files from WhatsApp using the `messageId` and `agentId` from the webhook payload.

#### Implementation Steps:

1. **Create a download endpoint** that accepts `messageId` and `agentId`
2. **Use Baileys `downloadMediaMessage`** function to download the file
3. **Process or store the file** as needed

#### Example Implementation:

```javascript
// In your webhook receiver service
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');

// Endpoint to download media files
async function downloadMediaFile(agentId, messageId, mimetype) {
  try {
    // 1. Get the WhatsApp socket instance for this agent
    const socket = await getSocketForAgent(agentId);
    
    // 2. Retrieve the message from WhatsApp
    const message = await socket.store.messages.get(messageId);
    
    if (!message) {
      throw new Error('Message not found');
    }
    
    // 3. Download the media file
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger: pino({ level: 'error' }),
        reuploadRequest: socket.updateMediaMessage,
      }
    );
    
    // 4. Determine file extension from mimetype
    const extension = getExtensionFromMimetype(mimetype);
    const filename = `${messageId}.${extension}`;
    
    return {
      buffer,
      filename,
      mimetype,
      size: buffer.length
    };
  } catch (error) {
    console.error('Error downloading media file:', error);
    throw error;
  }
}

// Helper function to get file extension
function getExtensionFromMimetype(mimetype) {
  const mapping = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return mapping[mimetype] || 'bin';
}
```

#### Webhook Handler with File Download:

```javascript
app.post('/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab', async (req, res) => {
  const { body, metadata, messageId, agentId, from } = req.body;
  
  try {
    // Handle images
    if (metadata.mimetype?.startsWith('image/')) {
      const caption = body.replace('[Image]', '').trim();
      
      // Download the image
      const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
      
      // Process the image (e.g., save to cloud storage, analyze, etc.)
      await processImageFile(fileData, {
        messageId,
        from,
        caption,
        agentId
      });
    }
    
    // Handle PDFs
    if (metadata.mimetype === 'application/pdf') {
      const filename = body.replace('[Document]', '').trim();
      
      // Download the PDF
      const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
      
      // Process the PDF (e.g., extract text, save to storage, etc.)
      await processPDFFile(fileData, {
        messageId,
        from,
        filename,
        agentId
      });
    }
    
    // Handle Word documents
    if (metadata.mimetype?.includes('wordprocessingml') || 
        metadata.mimetype === 'application/msword') {
      const filename = body.replace('[Document]', '').trim();
      
      const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
      
      await processWordDocument(fileData, {
        messageId,
        from,
        filename,
        agentId
      });
    }
    
    // Handle Excel spreadsheets
    if (metadata.mimetype?.includes('spreadsheetml') || 
        metadata.mimetype === 'application/vnd.ms-excel') {
      const filename = body.replace('[Document]', '').trim();
      
      const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
      
      await processExcelFile(fileData, {
        messageId,
        from,
        filename,
        agentId
      });
    }
    
    res.status(200).json({ received: true, processed: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### Approach 2: Asynchronous Processing Queue (Recommended for High Volume)

**Recommended for:** High-volume environments where immediate processing isn't required.

Use a message queue (Redis, RabbitMQ, AWS SQS) to process file downloads asynchronously:

```javascript
const Queue = require('bull');
const downloadQueue = new Queue('file-downloads', {
  redis: { host: 'localhost', port: 6379 }
});

app.post('/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab', async (req, res) => {
  const payload = req.body;
  
  // Immediately respond to webhook
  res.status(200).json({ received: true });
  
  // Queue file download for processing
  if (payload.metadata.mimetype && 
      (payload.metadata.mimetype.startsWith('image/') ||
       payload.metadata.mimetype === 'application/pdf' ||
       payload.metadata.mimetype.includes('wordprocessingml') ||
       payload.metadata.mimetype.includes('spreadsheetml'))) {
    
    await downloadQueue.add('download-file', {
      agentId: payload.agentId,
      messageId: payload.messageId,
      mimetype: payload.metadata.mimetype,
      from: payload.from,
      body: payload.body,
      timestamp: payload.timestamp
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });
  }
});

// Process queue jobs
downloadQueue.process('download-file', async (job) => {
  const { agentId, messageId, mimetype, from, body } = job.data;
  
  try {
    const fileData = await downloadMediaFile(agentId, messageId, mimetype);
    await processFile(fileData, { agentId, messageId, from, body });
    return { success: true };
  } catch (error) {
    console.error('Error processing file download:', error);
    throw error; // Will trigger retry
  }
});
```

### Approach 3: Callback to Agent Service (Alternative)

**Recommended for:** When you want the agent service to handle downloads.

Instead of downloading in the webhook receiver, send a callback request to the agent service:

```javascript
app.post('/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab', async (req, res) => {
  const payload = req.body;
  
  // Immediately respond
  res.status(200).json({ received: true });
  
  // If file needs to be downloaded, request it from agent service
  if (payload.metadata.mimetype && !payload.metadata.mediaUrl) {
    try {
      const agentServiceUrl = process.env.AGENT_SERVICE_URL;
      await axios.post(`${agentServiceUrl}/api/download-media`, {
        agentId: payload.agentId,
        messageId: payload.messageId,
        mimetype: payload.metadata.mimetype
      });
    } catch (error) {
      console.error('Error requesting file download:', error);
    }
  }
});
```

---

## Processing Contact Messages

### Contact Message Structure

When a user shares a contact card, the webhook receives:

```json
{
  "source": "whatsapp",
  "messageId": "CONT123",
  "from": "1234567890",
  "to": "0987654321",
  "body": "[Contact: John Doe]",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "isFromMe": false,
  "agentId": "agent-uuid",
  "user_id": "user-uuid",
  "metadata": {
    "messageType": "TEXT",
    "conversationId": "1234567890@s.whatsapp.net",
    "senderName": "Jane Smith",
    "mediaUrl": null,
    "mimetype": null
  }
}
```

### Extracting Contact Information

To extract full contact details, you need to retrieve the original message from WhatsApp:

```javascript
async function extractContactInfo(agentId, messageId) {
  try {
    const socket = await getSocketForAgent(agentId);
    const message = await socket.store.messages.get(messageId);
    
    if (!message?.message?.contactMessage) {
      throw new Error('Not a contact message');
    }
    
    const contact = message.message.contactMessage;
    
    return {
      displayName: contact.displayName || null,
      vcard: contact.vcard || null,
      // Parse vCard to extract details
      phoneNumbers: parseVCard(contact.vcard)?.phones || [],
      emails: parseVCard(contact.vcard)?.emails || [],
      organization: parseVCard(contact.vcard)?.org || null,
      address: parseVCard(contact.vcard)?.address || null
    };
  } catch (error) {
    console.error('Error extracting contact info:', error);
    throw error;
  }
}

// Simple vCard parser (you may want to use a library like 'vcard-json')
function parseVCard(vcardString) {
  if (!vcardString) return null;
  
  const lines = vcardString.split('\n');
  const contact = {
    phones: [],
    emails: [],
    org: null,
    address: null
  };
  
  for (const line of lines) {
    if (line.startsWith('TEL')) {
      const phone = line.split(':')[1]?.trim();
      if (phone) contact.phones.push(phone);
    } else if (line.startsWith('EMAIL')) {
      const email = line.split(':')[1]?.trim();
      if (email) contact.emails.push(email);
    } else if (line.startsWith('ORG')) {
      contact.org = line.split(':')[1]?.trim();
    } else if (line.startsWith('ADR')) {
      contact.address = line.split(':')[1]?.trim();
    }
  }
  
  return contact;
}
```

### Webhook Handler for Contact Messages:

```javascript
app.post('/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab', async (req, res) => {
  const { body, metadata, messageId, agentId, from } = req.body;
  
  try {
    // Check if it's a contact message
    if (body.startsWith('[Contact:')) {
      const contactName = body.replace('[Contact:', '').replace(']', '').trim();
      
      // Extract full contact information
      const contactInfo = await extractContactInfo(agentId, messageId);
      
      // Process contact (save to CRM, database, etc.)
      await processContact(contactInfo, {
        sharedBy: from,
        agentId,
        messageId,
        timestamp: req.body.timestamp
      });
      
      // Optionally, send contact info to another webhook or service
      await sendContactToExternalService(contactInfo, {
        sharedBy: from,
        agentId
      });
    }
    
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing contact:', error);
    res.status(500).json({ error: error.message });
  }
});
```

---

## Processing Other Message Types

### Location Messages

```javascript
async function extractLocationInfo(agentId, messageId) {
  const socket = await getSocketForAgent(agentId);
  const message = await socket.store.messages.get(messageId);
  
  if (!message?.message?.locationMessage) {
    return null;
  }
  
  const location = message.message.locationMessage;
  
  return {
    latitude: location.degreesLatitude,
    longitude: location.degreesLongitude,
    name: location.name || null,
    address: location.address || null,
    url: location.url || null
  };
}
```

### Video Messages

Videos are handled similarly to images - they're not automatically downloaded. Use the same download approach as images:

```javascript
if (metadata.mimetype?.startsWith('video/')) {
  const caption = body.replace('[Video]', '').trim();
  const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
  await processVideoFile(fileData, { messageId, from, caption, agentId });
}
```

---

## Forwarding Processed Data to External Services

### Overview

After processing messages and files, you may want to forward the processed data to external services, CRMs, or other webhooks. This section outlines recommended approaches.

### Approach 1: Forward Contact Information

When a contact is shared, extract and forward the contact details:

```javascript
async function forwardContactToExternalService(contactInfo, metadata) {
  const externalWebhookUrl = process.env.EXTERNAL_CONTACT_WEBHOOK_URL;
  
  if (!externalWebhookUrl) {
    console.warn('No external contact webhook URL configured');
    return;
  }
  
  const payload = {
    contact: {
      displayName: contactInfo.displayName,
      phoneNumbers: contactInfo.phoneNumbers,
      emails: contactInfo.emails,
      organization: contactInfo.organization,
      address: contactInfo.address,
      vcard: contactInfo.vcard
    },
    metadata: {
      sharedBy: metadata.sharedBy,
      sharedAt: metadata.timestamp,
      agentId: metadata.agentId,
      messageId: metadata.messageId,
      source: 'whatsapp'
    }
  };
  
  try {
    const response = await axios.post(externalWebhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.EXTERNAL_WEBHOOK_TOKEN}`
      },
      timeout: 10000
    });
    
    console.log('Contact forwarded successfully:', response.status);
    return response.data;
  } catch (error) {
    console.error('Error forwarding contact:', error.message);
    throw error;
  }
}
```

### Approach 2: Forward Processed Files

After downloading and processing files, forward metadata and file URLs:

```javascript
async function forwardFileToExternalService(fileData, metadata) {
  const externalWebhookUrl = process.env.EXTERNAL_FILE_WEBHOOK_URL;
  
  if (!externalWebhookUrl) {
    return;
  }
  
  // Upload file to your storage (S3, Google Cloud, etc.)
  const fileUrl = await uploadToStorage(fileData.buffer, {
    filename: fileData.filename,
    mimetype: fileData.mimetype,
    agentId: metadata.agentId,
    messageId: metadata.messageId
  });
  
  const payload = {
    file: {
      url: fileUrl,
      filename: fileData.filename,
      mimetype: fileData.mimetype,
      size: fileData.size,
      type: getFileType(fileData.mimetype) // 'image', 'document', 'pdf', etc.
    },
    metadata: {
      from: metadata.from,
      to: metadata.to,
      timestamp: metadata.timestamp,
      agentId: metadata.agentId,
      messageId: metadata.messageId,
      caption: metadata.caption || null,
      source: 'whatsapp'
    }
  };
  
  try {
    await axios.post(externalWebhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.EXTERNAL_WEBHOOK_TOKEN}`
      },
      timeout: 15000
    });
    
    console.log('File metadata forwarded successfully');
  } catch (error) {
    console.error('Error forwarding file:', error.message);
    // Don't throw - file processing should continue even if forwarding fails
  }
}

function getFileType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype === 'application/pdf') return 'pdf';
  if (mimetype.includes('wordprocessingml') || mimetype === 'application/msword') return 'word';
  if (mimetype.includes('spreadsheetml') || mimetype === 'application/vnd.ms-excel') return 'excel';
  return 'document';
}
```

### Approach 3: Unified Data Forwarding

Create a unified service that forwards all processed data:

```javascript
class DataForwardingService {
  constructor() {
    this.endpoints = {
      contacts: process.env.EXTERNAL_CONTACT_WEBHOOK_URL,
      files: process.env.EXTERNAL_FILE_WEBHOOK_URL,
      messages: process.env.EXTERNAL_MESSAGE_WEBHOOK_URL,
      locations: process.env.EXTERNAL_LOCATION_WEBHOOK_URL
    };
  }
  
  async forward(data, type) {
    const endpoint = this.endpoints[type];
    
    if (!endpoint) {
      console.warn(`No endpoint configured for type: ${type}`);
      return;
    }
    
    try {
      const response = await axios.post(endpoint, {
        type,
        data,
        timestamp: new Date().toISOString(),
        source: 'whatsapp-webhook-processor'
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.EXTERNAL_WEBHOOK_TOKEN}`,
          'X-Data-Type': type
        },
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      console.error(`Error forwarding ${type}:`, error.message);
      // Implement retry logic or queue for later processing
      await this.queueForRetry(data, type);
    }
  }
  
  async queueForRetry(data, type) {
    // Implement retry queue (Redis, database, etc.)
    console.log(`Queued ${type} for retry`);
  }
}

// Usage
const forwardingService = new DataForwardingService();

// After processing contact
await forwardingService.forward(contactInfo, 'contacts');

// After processing file
await forwardingService.forward(fileMetadata, 'files');

// After processing location
await forwardingService.forward(locationInfo, 'locations');
```

### Approach 4: Batch Forwarding

For high-volume scenarios, batch and forward data periodically:

```javascript
class BatchForwardingService {
  constructor() {
    this.batch = {
      contacts: [],
      files: [],
      messages: []
    };
    this.batchSize = 50;
    this.flushInterval = 30000; // 30 seconds
    
    // Start periodic flush
    setInterval(() => this.flushAll(), this.flushInterval);
  }
  
  add(data, type) {
    if (!this.batch[type]) {
      this.batch[type] = [];
    }
    
    this.batch[type].push({
      ...data,
      receivedAt: new Date().toISOString()
    });
    
    // Flush if batch is full
    if (this.batch[type].length >= this.batchSize) {
      this.flush(type);
    }
  }
  
  async flush(type) {
    const items = this.batch[type];
    if (items.length === 0) return;
    
    this.batch[type] = []; // Clear batch
    
    try {
      const endpoint = process.env[`EXTERNAL_${type.toUpperCase()}_WEBHOOK_URL`];
      if (!endpoint) return;
      
      await axios.post(endpoint, {
        type,
        items,
        count: items.length,
        timestamp: new Date().toISOString()
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.EXTERNAL_WEBHOOK_TOKEN}`
        },
        timeout: 30000
      });
      
      console.log(`Flushed ${items.length} ${type} items`);
    } catch (error) {
      console.error(`Error flushing ${type}:`, error.message);
      // Re-add items to batch for retry
      this.batch[type].unshift(...items);
    }
  }
  
  async flushAll() {
    await Promise.all([
      this.flush('contacts'),
      this.flush('files'),
      this.flush('messages')
    ]);
  }
}

// Usage
const batchService = new BatchForwardingService();

// Add items to batch
batchService.add(contactInfo, 'contacts');
batchService.add(fileMetadata, 'files');
```

### Recommended Webhook Payload Format for External Services

When forwarding to external services, use a consistent payload format:

```json
{
  "event": "whatsapp.message.processed",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "type": "contact|file|location|message",
    "content": {
      // Type-specific content
    },
    "source": {
      "agentId": "agent-uuid",
      "messageId": "message-id",
      "from": "1234567890",
      "to": "0987654321",
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

**Example for Contact:**
```json
{
  "event": "whatsapp.message.processed",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "type": "contact",
    "content": {
      "displayName": "John Doe",
      "phoneNumbers": ["+1234567890"],
      "emails": ["john@example.com"],
      "organization": "Acme Corp",
      "vcard": "BEGIN:VCARD\n..."
    },
    "source": {
      "agentId": "agent-uuid",
      "messageId": "CONT123",
      "from": "1234567890",
      "to": "0987654321"
    }
  }
}
```

**Example for File:**
```json
{
  "event": "whatsapp.message.processed",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "type": "file",
    "content": {
      "fileType": "pdf",
      "url": "https://storage.example.com/files/invoice.pdf",
      "filename": "invoice.pdf",
      "mimetype": "application/pdf",
      "size": 245678,
      "caption": "Invoice for January 2024"
    },
    "source": {
      "agentId": "agent-uuid",
      "messageId": "PDF789",
      "from": "1234567890",
      "to": "0987654321"
    }
  }
}
```

---

## Best Practices

### 1. Error Handling

Always implement robust error handling:

```javascript
async function processWebhookMessage(payload) {
  try {
    // Process message
    await handleMessage(payload);
  } catch (error) {
    // Log error for monitoring
    console.error('Webhook processing error:', {
      messageId: payload.messageId,
      agentId: payload.agentId,
      error: error.message,
      stack: error.stack
    });
    
    // Optionally, send to error tracking service
    await sendToErrorTracking(error, payload);
    
    // Don't throw - allow webhook to return success
    // (so WhatsApp doesn't retry)
  }
}
```

### 2. Rate Limiting

Implement rate limiting to prevent overwhelming your system:

```javascript
const rateLimit = require('express-rate-limit');

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: 'Too many webhook requests'
});

app.post('/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab', 
  webhookLimiter,
  async (req, res) => {
    // Handler code
  }
);
```

### 3. File Size Validation

Always validate file sizes before processing:

```javascript
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

async function downloadMediaFile(agentId, messageId, mimetype) {
  const fileData = await downloadFile(agentId, messageId, mimetype);
  
  if (fileData.size > MAX_FILE_SIZE) {
    throw new Error(`File size ${fileData.size} exceeds maximum ${MAX_FILE_SIZE}`);
  }
  
  return fileData;
}
```

### 4. Secure File Storage

Store downloaded files securely:

```javascript
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

async function storeFile(fileData, metadata) {
  const bucket = storage.bucket('your-bucket-name');
  const file = bucket.file(`${metadata.agentId}/${metadata.messageId}`);
  
  await file.save(fileData.buffer, {
    metadata: {
      contentType: metadata.mimetype,
      metadata: {
        messageId: metadata.messageId,
        from: metadata.from,
        timestamp: metadata.timestamp
      }
    }
  });
  
  // Make file publicly accessible (or use signed URLs)
  await file.makePublic();
  
  return file.publicUrl();
}
```

### 5. Async Processing

For better performance, process files asynchronously:

```javascript
app.post('/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab', async (req, res) => {
  const payload = req.body;
  
  // Immediately respond
  res.status(200).json({ received: true });
  
  // Process asynchronously (don't await)
  processMessageAsync(payload).catch(error => {
    console.error('Async processing error:', error);
  });
});
```

### 6. Webhook Verification

Verify webhook requests come from the expected source:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(req, secret) {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

app.post('/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab', (req, res, next) => {
  if (!verifyWebhookSignature(req, process.env.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  next();
}, async (req, res) => {
  // Handler code
});
```

---

## Example Webhook Receiver Implementation

Complete example of a webhook receiver that handles all message types:

```javascript
const express = require('express');
const app = express();
app.use(express.json());

// Store for agent sockets (you'd implement this based on your architecture)
const agentSockets = new Map();

app.post('/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab', async (req, res) => {
  const { body, metadata, messageId, agentId, from, to, timestamp } = req.body;
  
  // Immediately respond to prevent timeouts
  res.status(200).json({ received: true });
  
  // Process message asynchronously
  processMessage(req.body).catch(error => {
    console.error('Error processing message:', error);
  });
});

async function processMessage(payload) {
  const { body, metadata, messageId, agentId, from } = payload;
  
  try {
    // Handle text messages
    if (metadata.messageType === 'TEXT' && !metadata.mimetype) {
      await handleTextMessage(payload);
      return;
    }
    
    // Handle images
    if (metadata.mimetype?.startsWith('image/')) {
      await handleImageMessage(payload);
      return;
    }
    
    // Handle PDFs
    if (metadata.mimetype === 'application/pdf') {
      await handlePDFMessage(payload);
      return;
    }
    
    // Handle Word documents
    if (metadata.mimetype?.includes('wordprocessingml') || 
        metadata.mimetype === 'application/msword') {
      await handleWordMessage(payload);
      return;
    }
    
    // Handle Excel spreadsheets
    if (metadata.mimetype?.includes('spreadsheetml') || 
        metadata.mimetype === 'application/vnd.ms-excel') {
      await handleExcelMessage(payload);
      return;
    }
    
    // Handle audio (file is already downloaded)
    if (metadata.messageType === 'AUDIO' && metadata.mediaUrl) {
      await handleAudioMessage(payload);
      return;
    }
    
    // Handle contact messages
    if (body.startsWith('[Contact:')) {
      await handleContactMessage(payload);
      return;
    }
    
    // Handle location messages
    if (body === '[Location]') {
      await handleLocationMessage(payload);
      return;
    }
    
    // Handle video messages
    if (metadata.mimetype?.startsWith('video/')) {
      await handleVideoMessage(payload);
      return;
    }
    
    console.log('Unhandled message type:', metadata.messageType, metadata.mimetype);
  } catch (error) {
    console.error('Error in processMessage:', error);
    throw error;
  }
}

async function handleTextMessage(payload) {
  console.log('Processing text message:', payload.body);
  // Save to database, send to AI, etc.
}

async function handleImageMessage(payload) {
  const { messageId, agentId, metadata, body } = payload;
  const caption = body.replace('[Image]', '').trim();
  
  // Download image
  const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
  
  // Process image
  await processImageFile(fileData, {
    messageId,
    from: payload.from,
    caption,
    agentId: payload.agentId
  });
}

async function handlePDFMessage(payload) {
  const { messageId, agentId, metadata, body } = payload;
  const filename = body.replace('[Document]', '').trim();
  
  const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
  await processPDFFile(fileData, { messageId, from: payload.from, filename, agentId });
}

async function handleWordMessage(payload) {
  const { messageId, agentId, metadata, body } = payload;
  const filename = body.replace('[Document]', '').trim();
  
  const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
  await processWordDocument(fileData, { messageId, from: payload.from, filename, agentId });
}

async function handleExcelMessage(payload) {
  const { messageId, agentId, metadata, body } = payload;
  const filename = body.replace('[Document]', '').trim();
  
  const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
  await processExcelFile(fileData, { messageId, from: payload.from, filename, agentId });
}

async function handleAudioMessage(payload) {
  const { metadata } = payload;
  
  // Audio file is already downloaded and available at metadata.mediaUrl
  const audioResponse = await fetch(metadata.mediaUrl);
  const audioBuffer = await audioResponse.buffer();
  
  await processAudioFile(audioBuffer, {
    messageId: payload.messageId,
    from: payload.from,
    mimetype: metadata.mimetype,
    agentId: payload.agentId
  });
}

async function handleContactMessage(payload) {
  const { messageId, agentId } = payload;
  
  const contactInfo = await extractContactInfo(agentId, messageId);
  
  // Save contact to database or send to CRM
  await saveContact(contactInfo, {
    sharedBy: payload.from,
    agentId,
    messageId
  });
}

async function handleLocationMessage(payload) {
  const { messageId, agentId } = payload;
  
  const locationInfo = await extractLocationInfo(agentId, messageId);
  
  // Process location (save, send to mapping service, etc.)
  await processLocation(locationInfo, {
    from: payload.from,
    agentId,
    messageId
  });
}

async function handleVideoMessage(payload) {
  const { messageId, agentId, metadata, body } = payload;
  const caption = body.replace('[Video]', '').trim();
  
  const fileData = await downloadMediaFile(agentId, messageId, metadata.mimetype);
  await processVideoFile(fileData, { messageId, from: payload.from, caption, agentId });
}

// Helper function to download media files
async function downloadMediaFile(agentId, messageId, mimetype) {
  const socket = agentSockets.get(agentId);
  if (!socket) {
    throw new Error(`No socket found for agent ${agentId}`);
  }
  
  const message = await socket.store.messages.get(messageId);
  if (!message) {
    throw new Error(`Message ${messageId} not found`);
  }
  
  const { downloadMediaMessage } = require('@whiskeysockets/baileys');
  const buffer = await downloadMediaMessage(
    message,
    'buffer',
    {},
    {
      logger: require('pino')({ level: 'error' }),
      reuploadRequest: socket.updateMediaMessage,
    }
  );
  
  return {
    buffer,
    mimetype,
    size: buffer.length
  };
}

app.listen(3000, () => {
  console.log('Webhook receiver listening on port 3000');
});
```

---

## Configuration

The webhook URL can be configured via environment variables:

- `WHATSAPP_MESSAGE_WEBHOOK` - General webhook URL
- `WHATSAPP_MESSAGE_WEBHOOK_PROD` - Production-specific URL
- `WHATSAPP_MESSAGE_WEBHOOK_TEST` - Test-specific URL
- `WEBHOOK_ENV` - Environment mode (`production` or `test`)

If not configured, defaults to:
- Production: `https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab`
- Test: `https://auto.nsolbpo.com/webhook-test/a18ff948-9380-4abe-a8d8-0912dae2d8ab`
