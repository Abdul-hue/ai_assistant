# Baileys Library Features - Quick Reference

## 🎯 Core Baileys Components Used

| Component | Purpose | Status |
|-----------|---------|--------|
| `makeWASocket` | Main WhatsApp socket creation | ✅ Implemented |
| `useMultiFileAuthState` | Persistent authentication storage | ✅ Implemented |
| `makeCacheableSignalKeyStore` | Signal protocol key management | ✅ Implemented |
| `fetchLatestBaileysVersion` | Auto-version compatibility | ✅ Implemented |
| `downloadMediaMessage` | Media download functionality | ✅ Implemented |
| `DisconnectReason` | Connection error handling | ✅ Implemented |
| `Browsers` | Browser identification | ✅ Implemented |

---

## 📱 Message Types Supported

### ✅ Incoming Messages (Fully Implemented)

| Message Type | Handler | Storage | Webhook |
|--------------|---------|---------|---------|
| **Text** | `conversation` | ✅ Database | ✅ Forwarded |
| **Extended Text** | `extendedTextMessage` | ✅ Database | ✅ Forwarded |
| **Images** | `imageMessage` | ✅ Caption stored | ✅ Forwarded |
| **Videos** | `videoMessage` | ✅ Caption stored | ✅ Forwarded |
| **Documents** | `documentMessage` | ✅ Caption stored | ✅ Forwarded |
| **Audio/Voice** | `audioMessage` | ✅ **Full download + Storage** | ✅ Forwarded |
| **Stickers** | `stickerMessage` | ✅ Logged | ⚠️ Not forwarded |
| **Contacts** | `contactMessage` | ✅ Logged | ⚠️ Not forwarded |
| **Location** | `locationMessage` | ✅ Logged | ⚠️ Not forwarded |
| **Buttons** | `buttonsResponseMessage` | ✅ Logged | ⚠️ Not forwarded |
| **Lists** | `listResponseMessage` | ✅ Logged | ⚠️ Not forwarded |

### ⚠️ Outgoing Messages (Partially Implemented)

| Message Type | Status | Implementation |
|--------------|--------|----------------|
| **Text Messages** | ✅ Fully Working | `sendMessage()` function |
| **Media Messages** | ❌ Not Implemented | Only text sending available |
| **Interactive Messages** | ❌ Not Implemented | Buttons/lists not supported |

---

## 🔐 Authentication & Session Features

### ✅ Implemented

- **Multi-File Auth State** - Persistent credentials per agent
- **Database Backup** - Credentials synced to PostgreSQL
- **Auto-Restore** - Session recovery on server restart
- **QR Code Generation** - Automatic QR for new devices
- **QR Expiration** - 3-minute validity with cleanup
- **Agent Isolation** - Prevents credential sharing
- **Version Management** - Auto-fetch latest Baileys version

### 📊 Session States

| State | Description | Handling |
|-------|-------------|----------|
| `initializing` | Connection starting | ✅ Handled |
| `qr_pending` | Waiting for QR scan | ✅ Handled |
| `connecting` | Connecting to WhatsApp | ✅ Handled |
| `open` | Successfully connected | ✅ Handled |
| `close` | Connection closed | ✅ Handled with error codes |
| `conflict` | Session conflict (401) | ✅ Handled - clears auth |
| `error` | Connection error (405) | ✅ Handled - retries |

---

## 🎵 Audio Message Special Features

### ✅ Fully Implemented

1. **Download** - Uses `downloadMediaMessage()` with buffer output
2. **Storage** - Uploaded to Supabase Storage bucket
3. **Metadata Capture:**
   - Duration (seconds)
   - PTT (Push-to-Talk) flag
   - MIME type detection
   - File size
4. **URL Generation** - Signed URLs with 7-day TTL
5. **Format Support:**
   - OGG (default)
   - WebM
   - MP3, M4A, AAC
   - AMR, 3GP, 3G2

**Storage Path:** `{agentId}/{timestamp}-{messageId}.{extension}`

---

## 🔄 Connection Management

### Configuration

```javascript
{
  keepAliveIntervalMs: 15000,        // Keepalive every 15s
  defaultQueryTimeoutMs: 120000,     // 2 minute timeout
  connectTimeoutMs: 120000,          // 2 minute connect
  qrTimeout: 180000,                 // QR valid for 3 minutes
  retryRequestDelayMs: 250,         // Fast retries
  maxMsgRetryCount: 5,               // 5 retry attempts
  emitOwnEvents: true,               // Emit own events
  fireInitQueries: true,             // Fire queries immediately
  generateHighQualityLinkPreview: false,
  syncFullHistory: false,
  markOnlineOnConnect: false
}
```

### Error Handling

| Error Code | Meaning | Action Taken |
|------------|---------|--------------|
| **401** | Session conflict/device removed | Clear auth, regenerate QR |
| **405** | Connection failure before QR | Delete auth, retry |
| **515** | Stream error (expected after QR) | Auto-restart with saved creds |

---

## 📤 Webhook Integration

### Inbound Messages (WhatsApp → N8N)

**Endpoint:** Configurable via `WHATSAPP_MESSAGE_WEBHOOK`

**Payload:**
```json
{
  "agentId": "uuid",
  "user_id": "uuid",
  "id": "message-id",
  "from": "phone-number",
  "to": "phone-number",
  "messageType": "TEXT|AUDIO",
  "content": "message text",
  "mediaUrl": "signed-url",
  "mimetype": "audio/ogg",
  "timestamp": "ISO-8601",
  "metadata": { ... }
}
```

**Filtering:**
- ✅ Text messages with content
- ✅ Audio messages with media URL
- ❌ Empty messages skipped
- ❌ System/protocol messages skipped

### Outbound Messages (N8N → WhatsApp)

**Endpoint:** `/api/webhooks/send-message`

**Request:**
```json
{
  "agentId": "uuid",
  "to": "phone-number",
  "message": "message text"
}
```

**Validation:**
- Agent ID (UUID format)
- Phone number (10+ digits)
- Message length (max 4096 chars)
- Connection status check

---

## 🗄️ Database Integration

### Tables Used

1. **`whatsapp_sessions`**
   - Session state (JSONB)
   - QR codes
   - Phone numbers
   - Connection status

2. **`message_log`**
   - Complete message history
   - Media URLs
   - Metadata (JSONB)

3. **`agents`**
   - Agent configuration
   - User association

### Sync Operations

- **Credentials → Database:** On every `creds.update` event
- **Database → Files:** On session initialization (if files missing)
- **Messages → Database:** On every incoming message
- **Status Updates:** Real-time status tracking

---

## 🚀 Performance Features

### ✅ Implemented

1. **Connection Pooling** - In-memory session management
2. **Health Monitoring** - 30-second health checks
3. **QR Cleanup** - Automatic expired QR removal
4. **Session Recovery** - Auto-reconnect on startup
5. **Efficient Storage** - Optimized media storage paths
6. **Database Indexes** - Performance-optimized queries

### 📊 Metrics Tracked

- Socket age
- Last ping time
- Connection state
- QR generation attempts
- Message processing time
- Media download time

---

## 🔒 Security Features

### ✅ Implemented

1. **Agent Isolation** - Prevents phone number conflicts
2. **Input Validation** - Zod schemas, UUID validation
3. **Rate Limiting** - Multiple rate limiters
4. **CORS Protection** - Whitelist-based origins
5. **Secure Storage** - Signed URLs with TTL
6. **Error Sanitization** - No sensitive data in errors

---

## 📋 Event System

### Custom Events

```javascript
// Subscribe to agent events
subscribeToAgentEvents(agentId, (event) => {
  // event.type: 'status' | 'qr' | 'connected' | 'disconnected'
  // event.payload: Event-specific data
  // event.agentId: Agent identifier
  // event.timestamp: ISO timestamp
})
```

### Event Types

| Event | Trigger | Payload |
|-------|---------|---------|
| `status` | Status change | `{ status: string }` |
| `qr` | QR code generated | `{ qr: string, attempt: number }` |
| `connected` | Connection successful | `{ phoneNumber: string }` |
| `disconnected` | Connection lost | `{ reason: string, statusCode: number }` |

---

## 🎯 Baileys Features Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| **Authentication** | ✅ Complete | Multi-file + database backup |
| **QR Code** | ✅ Complete | Auto-generation, expiration, cleanup |
| **Text Messages** | ✅ Complete | Send & receive |
| **Media Download** | ✅ Complete | Audio fully implemented |
| **Media Upload** | ❌ Not Implemented | Only text sending |
| **Group Messages** | ⚠️ Filtered Out | Groups not supported |
| **Status Updates** | ⚠️ Filtered Out | Status messages ignored |
| **Interactive Messages** | ⚠️ Partial | Received but not fully processed |
| **Session Recovery** | ✅ Complete | Auto-reconnect on startup |
| **Error Handling** | ✅ Complete | All error codes handled |
| **Version Management** | ✅ Complete | Auto-fetch latest version |
| **Health Monitoring** | ✅ Complete | 30s health checks |
| **Webhook Integration** | ✅ Complete | Inbound & outbound |

---

## 📈 Statistics

- **Baileys Version:** 6.7.9
- **Node.js Requirement:** >=20.0.0
- **Supported Message Types:** 11 types
- **Media Formats:** 8 audio formats
- **Connection States:** 6 states handled
- **Error Codes:** 3 major codes handled
- **Max Concurrent Sessions:** 20 agents
- **QR Validity:** 3 minutes
- **Keepalive Interval:** 15 seconds

---

## 🔮 Missing Features (Future Enhancements)

1. **Media Sending** - Images, videos, documents
2. **Group Operations** - Group creation, management
3. **Business Features** - Catalog, products
4. **Reactions** - Message reactions
5. **Polls** - Poll creation/voting
6. **Presence** - Online/offline status
7. **Read Receipts** - Message read status
8. **Typing Indicators** - Typing status

---

*Last Updated: Based on codebase analysis*
*Baileys Version: @whiskeysockets/baileys v6.7.9*

