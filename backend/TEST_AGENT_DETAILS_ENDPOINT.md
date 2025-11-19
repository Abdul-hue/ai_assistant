# Agent Details Endpoint - Testing Guide

**Endpoint:** `GET /api/agents/:id/details`  
**Date:** November 4, 2025  
**Status:** ✅ Ready for testing

---

## 📋 Endpoint Specification

### URL
```
GET /api/agents/:id/details
```

### Authentication
Required: `Authorization: Bearer <token>` or `sb_access_token` cookie

### Response Structure

**Success (200 OK):**
```json
{
  "agent": {
    "id": "uuid",
    "user_id": "uuid",
    "agent_name": "My Agent",
    "description": "Agent description",
    "initial_prompt": "System prompt for AI",
    "webhook_url": "https://webhook.example.com",
    "chat_history_enabled": true,
    "company_data": {},
    "features": {},
    "is_active": true,
    "created_at": "2025-11-04T10:00:00Z",
    "updated_at": "2025-11-04T10:00:00Z",
    "whatsapp_session": {
      "id": "uuid",
      "phone_number": "+1234567890",
      "is_active": true,
      "last_connected": "2025-11-04T10:30:00Z",
      "status": "connected",
      "created_at": "2025-11-04T10:00:00Z",
      "updated_at": "2025-11-04T10:30:00Z",
      "qr_code": null
    }
  },
  "statistics": {
    "total_messages": 42,
    "last_message_at": "2025-11-04T11:00:00Z"
  }
}
```

**Agent without WhatsApp session:**
```json
{
  "agent": {
    ...agent fields,
    "whatsapp_session": null
  },
  "statistics": {
    "total_messages": 0,
    "last_message_at": null
  }
}
```

**Error (404 Not Found):**
```json
{
  "error": "Agent not found",
  "message": "Agent does not exist or you do not have access to it"
}
```

**Error (401 Unauthorized):**
```json
{
  "error": "Authentication required",
  "message": "No access token found in cookies or headers"
}
```

**Error (400 Bad Request - Invalid UUID):**
```json
{
  "error": "Invalid ID format",
  "message": "id must be a valid UUID"
}
```

---

## 🧪 Test Cases

### Test 1: Valid Agent with WhatsApp Session

**Request:**
```bash
curl -X GET 'http://localhost:3001/api/agents/{VALID_AGENT_ID}/details' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json'
```

**Expected Response:** 200 OK with complete agent details

**Verify:**
- ✅ Agent information is complete
- ✅ `whatsapp_session` is present with phone_number
- ✅ `statistics.total_messages` is a number
- ✅ No `session_state` field (security - encrypted data excluded)

---

### Test 2: Valid Agent without WhatsApp Session

**Request:**
```bash
curl -X GET 'http://localhost:3001/api/agents/{AGENT_ID_NO_SESSION}/details' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

**Expected Response:** 200 OK

**Verify:**
- ✅ Agent information is complete
- ✅ `whatsapp_session` is `null`
- ✅ `statistics.total_messages` is 0
- ✅ `statistics.last_message_at` is `null`

---

### Test 3: Agent with QR Code Pending

**Scenario:** Agent is initializing WhatsApp connection

**Expected Response:** 200 OK

**Verify:**
- ✅ `whatsapp_session.status` is `"qr_pending"`
- ✅ `whatsapp_session.is_active` is `false`
- ✅ `whatsapp_session.qr_code` is present (base64 or data URL)
- ✅ `whatsapp_session.phone_number` is `null`

---

### Test 4: Agent Belonging to Different User

**Request:**
```bash
curl -X GET 'http://localhost:3001/api/agents/{ANOTHER_USERS_AGENT_ID}/details' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

**Expected Response:** 404 Not Found

**Verify:**
- ✅ Status code is 404
- ✅ Error message: "Agent not found"
- ✅ Does not reveal if agent exists (security)

---

### Test 5: Non-existent Agent ID

**Request:**
```bash
curl -X GET 'http://localhost:3001/api/agents/00000000-0000-0000-0000-000000000000/details' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

**Expected Response:** 404 Not Found

**Verify:**
- ✅ Status code is 404
- ✅ Error message: "Agent not found"

---

### Test 6: Invalid UUID Format

**Request:**
```bash
curl -X GET 'http://localhost:3001/api/agents/invalid-uuid/details' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

**Expected Response:** 400 Bad Request

**Verify:**
- ✅ Status code is 400
- ✅ Error message: "id must be a valid UUID"

---

### Test 7: No Authentication Token

**Request:**
```bash
curl -X GET 'http://localhost:3001/api/agents/{VALID_AGENT_ID}/details'
```

**Expected Response:** 401 Unauthorized

**Verify:**
- ✅ Status code is 401
- ✅ Error message: "Authentication required"

---

## 🔍 Database Query Breakdown

The endpoint performs 4 optimized queries:

### Query 1: Agent Data
```sql
SELECT * FROM agents 
WHERE id = :id AND user_id = :userId
```

**Purpose:** Get agent information and verify ownership  
**Security:** Ensures user owns the agent

---

### Query 2: WhatsApp Session
```sql
SELECT id, phone_number, is_active, last_connected, qr_code, status, 
       connection_state, created_at, updated_at
FROM whatsapp_sessions
WHERE agent_id = :id
```

**Purpose:** Get WhatsApp connection status  
**Security:** Excludes `session_state` (contains encryption keys)  
**Note:** Uses `maybeSingle()` - returns null if no session exists

---

### Query 3: Message Count
```sql
SELECT COUNT(*) FROM chat_messages
WHERE agent_id = :id
```

**Purpose:** Get total number of messages  
**Optimization:** Uses `count: 'exact', head: true` for efficiency

---

### Query 4: Last Message
```sql
SELECT created_at FROM chat_messages
WHERE agent_id = :id
ORDER BY created_at DESC
LIMIT 1
```

**Purpose:** Get timestamp of most recent message  
**Optimization:** Only fetches created_at field, single row

---

## 🔒 Security Features

### 1. User Ownership Verification
```javascript
.eq('user_id', userId)  // Only returns agent if user owns it
```

**Prevents:** Unauthorized access to other users' agents

---

### 2. Sensitive Data Exclusion
```javascript
// IMPORTANT: Do NOT expose session_state (contains encryption keys)
```

**Protects:** WhatsApp session encryption keys

---

### 3. Conditional QR Code Exposure
```javascript
qr_code: (!sessionData.is_active && sessionData.status === 'qr_pending') 
  ? sessionData.qr_code 
  : null
```

**Only returns QR code when:**
- Connection is NOT active yet
- Status is "qr_pending"

**Prevents:** Exposing QR codes for already-connected sessions

---

### 4. UUID Validation
```javascript
validateUUID('id')  // Middleware validates UUID format
```

**Prevents:** SQL injection via malformed IDs

---

## 📊 Performance Considerations

### Query Optimization:
- **Agent query:** Indexed on `user_id` and `id` (composite)
- **Session query:** Indexed on `agent_id`
- **Message count:** Indexed on `agent_id`
- **Last message:** Indexed on `agent_id` and `created_at`

### Expected Response Time:
- **With indexes:** < 100ms
- **Without indexes:** 200-500ms (run migration 002!)

---

## 🧪 Testing with HTTP Client

### Using Postman / Insomnia:

**Request:**
```
GET http://localhost:3001/api/agents/{AGENT_ID}/details
Headers:
  Authorization: Bearer YOUR_ACCESS_TOKEN
  Cookie: sb_access_token=YOUR_COOKIE_TOKEN
```

**Or via browser fetch:**
```javascript
// In browser console (when logged in):
fetch('/api/agents/YOUR_AGENT_ID/details', {
  credentials: 'include'
})
.then(r => r.json())
.then(data => console.log('Agent details:', data))
.catch(e => console.error('Error:', e));
```

---

## 📝 Sample Response

```json
{
  "agent": {
    "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    "user_id": "f9e8d7c6-b5a4-3210-fedc-ba9876543210",
    "agent_name": "Customer Support Bot",
    "description": "Handles customer inquiries",
    "initial_prompt": "You are a helpful customer support agent...",
    "webhook_url": "https://n8n.example.com/webhook/customer-support",
    "chat_history_enabled": true,
    "company_data": {
      "name": "ACME Corp",
      "industry": "Technology"
    },
    "features": {
      "auto_reply": true,
      "sentiment_analysis": false
    },
    "is_active": true,
    "created_at": "2025-11-01T08:00:00.000Z",
    "updated_at": "2025-11-04T10:30:00.000Z",
    "whatsapp_session": {
      "id": "w1x2y3z4-a5b6-c7d8-e9f0-123456789abc",
      "phone_number": "+14155551234",
      "is_active": true,
      "last_connected": "2025-11-04T10:30:00.000Z",
      "status": "connected",
      "created_at": "2025-11-01T08:05:00.000Z",
      "updated_at": "2025-11-04T10:30:00.000Z",
      "qr_code": null
    }
  },
  "statistics": {
    "total_messages": 127,
    "last_message_at": "2025-11-04T11:45:32.000Z"
  }
}
```

---

## 🚨 Common Issues

### Issue: Always returns 404

**Possible causes:**
1. Agent doesn't exist
2. Agent belongs to different user
3. Using wrong user token

**Debug:**
```javascript
// Check what user ID you're authenticated as:
fetch('/api/auth/me', { credentials: 'include' })
  .then(r => r.json())
  .then(d => console.log('My user ID:', d.user.id));

// Check if agent exists:
fetch('/api/agents', { credentials: 'include' })
  .then(r => r.json())
  .then(d => console.log('My agents:', d));
```

---

### Issue: whatsapp_session is always null

**Possible causes:**
1. No WhatsApp session initialized yet
2. Session exists but linked to different agent_id

**Debug:**
Check database directly:
```sql
SELECT agent_id, phone_number, is_active, status 
FROM whatsapp_sessions 
WHERE agent_id = 'YOUR_AGENT_ID';
```

---

### Issue: total_messages is 0 but messages exist

**Possible causes:**
1. Messages linked to different agent_id
2. Table name mismatch

**Debug:**
```sql
SELECT COUNT(*) FROM chat_messages WHERE agent_id = 'YOUR_AGENT_ID';
```

---

## ✅ Success Criteria

The endpoint works correctly when:

- ✅ Returns 200 for valid agent owned by user
- ✅ Returns 404 for non-existent agent
- ✅ Returns 404 for agent owned by different user
- ✅ Returns 400 for invalid UUID
- ✅ Returns 401 when not authenticated
- ✅ Includes whatsapp_session when session exists
- ✅ whatsapp_session is null when no session
- ✅ QR code only shown when status is 'qr_pending'
- ✅ session_state is NEVER exposed
- ✅ Statistics are accurate
- ✅ Response time < 200ms with indexes

---

## 🎯 Next Steps

1. **Restart backend** to load new endpoint
2. **Test with your own agent ID** using the fetch examples
3. **Verify response structure** matches specification
4. **Test all error cases** (404, 401, 400)
5. **Use in frontend** to build agent detail pages

---

**Document Version:** 1.0  
**Last Updated:** November 4, 2025  
**Endpoint Status:** ✅ Implemented and ready for testing

