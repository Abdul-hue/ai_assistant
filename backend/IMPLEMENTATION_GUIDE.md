# 🚀 WhatsApp Audit - Implementation Guide

This guide provides step-by-step instructions for implementing the fixes identified in the audit report.

## 📋 Prerequisites

1. **Database Migration:** Run migration `008_add_instance_tracking.sql` first
2. **Dependencies:** Install `express-rate-limit` package
3. **Environment Variables:** Add `CREDENTIALS_ENCRYPTION_KEY` (optional but recommended)

---

## 🔴 CRITICAL FIXES (Do First)

### 1. Run Database Migration

```bash
# Connect to your database and run:
psql -d your_database -f backend/migrations/008_add_instance_tracking.sql
```

Or via Supabase dashboard:
1. Go to SQL Editor
2. Copy contents of `backend/migrations/008_add_instance_tracking.sql`
3. Execute

---

### 2. Install Rate Limiting Package

```bash
cd backend
npm install express-rate-limit
```

---

### 3. Apply Rate Limiting to Routes

**File:** `backend/src/routes/agents.js`

Add at the top (after imports):
```javascript
// Import rate limiters from app.js
// Note: Rate limiters are defined in app.js to be shared across routes
```

**File:** `backend/app.js`

The rate limiters are already added. Now export them:

```javascript
// At the end of app.js, before module.exports
module.exports.rateLimiters = {
  whatsappInitLimiter,
  messageSendLimiter
};
```

Then in `backend/src/routes/agents.js`:
```javascript
const { whatsappInitLimiter } = require('../../app').rateLimiters || {};

// Update the route:
router.post('/:agentId/init-whatsapp', 
  authMiddleware, 
  whatsappInitLimiter || ((req, res, next) => next()), // Apply rate limiter
  validateUUID('agentId'), 
  async (req, res) => {
    // ... existing code ...
  }
);
```

---

### 4. Verify Instance Tracking

After deploying, check logs for:
```
[BAILEYS] ✅ Instance claim registered: hostname (instance-id)
```

If you see errors about missing columns, the migration didn't run successfully.

---

## ⚠️ HIGH PRIORITY FIXES

### 5. Credential Encryption (Optional but Recommended)

**File:** `backend/src/services/baileysService.js`

Add encryption functions (see audit report Issue #17 for full code).

**Environment Variable:**
```bash
# Generate a 32-byte hex key
CREDENTIALS_ENCRYPTION_KEY=your-32-byte-hex-key-here
```

**Note:** This is optional. If not implemented, credentials remain in plain text (current state).

---

### 6. Exponential Backoff for Reconnections

**File:** `backend/src/services/baileysService.js`

Update `initializeExistingSessions()` function (see audit report Issue #5).

---

## ✅ VERIFICATION

After implementing fixes, verify:

1. **Instance Tracking:**
   ```sql
   SELECT agent_id, instance_id, instance_hostname, last_heartbeat 
   FROM whatsapp_sessions 
   WHERE is_active = true;
   ```
   Should show your instance ID and hostname.

2. **Rate Limiting:**
   - Try connecting WhatsApp 6 times in 15 minutes
   - Should get rate limit error on 6th attempt

3. **Heartbeat:**
   - Check `last_heartbeat` updates every minute for active sessions

4. **Multi-Instance Prevention:**
   - Try connecting same agent from two different servers
   - Should get error: "Agent is already in use by another server instance"

---

## 📝 Testing Checklist

- [ ] Database migration runs successfully
- [ ] Instance tracking columns exist
- [ ] Rate limiting works (test with 6+ connection attempts)
- [ ] Heartbeat updates every minute
- [ ] Multi-instance conflict detected
- [ ] Existing sessions reconnect on server restart
- [ ] No memory leaks (check process memory over 24 hours)
- [ ] Health checks run properly
- [ ] Error recovery works (test with network interruption)

---

## 🔄 Rollback Plan

If issues occur:

1. **Rate Limiting:** Remove rate limiter middleware (set to `(req, res, next) => next()`)
2. **Instance Tracking:** Migration can be rolled back (columns are nullable)
3. **Heartbeat:** Can be disabled by not starting interval

---

## 📞 Support

If you encounter issues:
1. Check server logs for error messages
2. Verify database migration completed
3. Check environment variables are set
4. Review audit report for specific issue details

---

**Last Updated:** 2025-11-27

