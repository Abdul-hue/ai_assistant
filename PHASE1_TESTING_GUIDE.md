# Phase 1 Testing Guide - Connection Stability & Security

**Date:** 2025-01-15  
**Phase:** Phase 1 - Critical Fixes  
**Status:** Ready for Testing

---

## 🎯 Overview

This guide covers testing for Phase 1 optimizations:
1. **Automatic Reconnection** with exponential backoff
2. **QR Code Expiration** and regeneration
3. **Credential Encryption** in database

---

## 📋 Prerequisites

### 1. Environment Setup

Ensure these environment variables are set in `.env`:

```bash
# Required
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
CREDENTIALS_ENCRYPTION_KEY=your_64_hex_character_key

# Optional (with defaults)
RECONNECTION_MAX_ATTEMPTS=10
RECONNECTION_BASE_DELAY_MS=2000
```

### 2. Generate Encryption Key

If you don't have `CREDENTIALS_ENCRYPTION_KEY`, generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the 64-character hex string to your `.env` file.

---

## 🧪 Automated Testing

### Run Test Script

```bash
cd backend
node scripts/test-phase1.js
```

### Expected Output

```
🧪 ============================================
🧪 PHASE 1 TESTING - Connection Stability
🧪 ============================================

📋 Test 1: Encryption Configuration
─────────────────────────────────────
✅ Encryption key configured
   Key length: 64 characters
   Key preview: a1b2c3d4...

📋 Test 2: Database Encryption Status
─────────────────────────────────────
✅ Found 3 session(s) with credentials
   Encrypted: 2
   Unencrypted: 1 (legacy data)

📋 Test 3: Reconnection Configuration
─────────────────────────────────────
✅ Max attempts: 10
✅ Base delay: 2000ms
✅ Max delay: 60000ms
✅ Exponential backoff: 2s → 4s → 8s → 16s → 32s → 60s (max)

📋 Test 4: Service Module Loading
─────────────────────────────────────
✅ baileysService.js loaded successfully
✅ Encryption key validation passed

📋 Test 5: Environment Configuration
─────────────────────────────────────
✅ SUPABASE_URL: Set
✅ SUPABASE_SERVICE_KEY: Set
✅ CREDENTIALS_ENCRYPTION_KEY: Set

📊 ============================================
📊 TEST SUMMARY
📊 ============================================

🎉 All Phase 1 tests passed!
```

---

## 🔍 Manual Testing Checklist

### Test 1: QR Code Generation & Expiration

**Steps:**
1. ✅ Start backend server
2. ✅ Navigate to agent creation/WhatsApp connection page
3. ✅ Click "Connect WhatsApp" or similar button
4. ✅ Verify QR code appears in UI
5. ✅ **Wait 60 seconds without scanning**
6. ✅ Verify QR code expires and clears from database
7. ✅ Click "Connect" again - verify new QR code generates

**Expected Behavior:**
- QR code generated within 2-3 seconds
- QR code expires after 60 seconds if not scanned
- New QR code generates on next connection attempt
- Logs show: `[QR] ⏰ QR code expired` and `[QR] ✅ QR cleared`

**Logs to Monitor:**
```
[BAILEYS] 📱 QR code generated for agent abc12345...
[QR] ⏱️  QR will expire in 60 seconds for agent abc12345...
[QR] ⏰ QR code expired for agent abc12345, clearing for regeneration
[QR] ✅ QR cleared for agent abc12345, new QR will be generated on next connection attempt
```

---

### Test 2: Connection & Credential Encryption

**Steps:**
1. ✅ Generate QR code
2. ✅ Scan QR code with WhatsApp mobile app
3. ✅ Wait for connection to establish
4. ✅ Verify connection success in UI
5. ✅ Check database: `whatsapp_sessions` table
6. ✅ Verify `session_data.encrypted = true`
7. ✅ Verify `session_data.creds` contains encrypted data structure

**Expected Behavior:**
- Connection establishes within 5-10 seconds after QR scan
- Credentials are encrypted before saving to database
- Logs show: `[SECURITY] 🔐 Credentials encrypted and saved`
- Database contains encrypted credentials with `encrypted: true` flag

**Database Query:**
   ```sql
   SELECT 
     agent_id,
  session_data->>'encrypted' as is_encrypted,
  session_data->'creds'->>'encrypted' as has_encrypted_creds,
     updated_at
   FROM whatsapp_sessions
WHERE session_data IS NOT NULL
ORDER BY updated_at DESC
LIMIT 5;
```

**Expected Result:**
- `is_encrypted` = `"true"`
- `has_encrypted_creds` = encrypted hex string (not plain JSON)

**Logs to Monitor:**
```
[BAILEYS] 🎉 CONNECTION SUCCESS 🎉
[SECURITY] 🔐 Credentials encrypted and saved for agent abc12345
[BAILEYS] ✅ Credentials synced to database successfully
```

---

### Test 3: Automatic Reconnection

**Steps:**
1. ✅ Connect agent successfully
2. ✅ Verify connection is active (send a test message)
3. ✅ **Disable network connection** (unplug ethernet or disable WiFi)
4. ✅ Wait 10-15 seconds
5. ✅ **Re-enable network connection**
6. ✅ Monitor logs for reconnection attempts
7. ✅ Verify connection re-establishes automatically

**Expected Behavior:**
- Connection drops when network is disabled
- Automatic reconnection triggers after disconnect
- Exponential backoff: 2s → 4s → 8s → 16s → 32s → 60s
- Connection re-establishes within 1-2 minutes
- No manual intervention required

**Logs to Monitor:**
```
[BAILEYS] 🔌 Connection closed for abc12345
[BAILEYS] Status code: 428, Reason: Connection Lost
[RECONNECT] 🔄 Agent abc12345 - scheduling attempt 1/10 in 2s
[RECONNECT] 🔌 Agent abc12345 - attempting reconnection...
[RECONNECT] ✅ Agent abc12345 - reconnection successful!
[BAILEYS] 🎉 CONNECTION SUCCESS 🎉
```

**Reconnection Timeline:**
- **Attempt 1:** 2 seconds (base delay)
- **Attempt 2:** 4 seconds (2^1 * base)
- **Attempt 3:** 8 seconds (2^2 * base)
- **Attempt 4:** 16 seconds (2^3 * base)
- **Attempt 5:** 32 seconds (2^4 * base)
- **Attempt 6+:** 60 seconds (max delay)

---

### Test 4: Credential Decryption on Restore

**Steps:**
1. ✅ Ensure agent has encrypted credentials in database
2. ✅ Restart backend server
3. ✅ Verify agent reconnects automatically on startup
4. ✅ Check logs for decryption messages
5. ✅ Verify connection succeeds

**Expected Behavior:**
- Server starts without errors
- Credentials are decrypted when restoring from database
- Connection re-establishes using decrypted credentials
- Logs show: `[SECURITY] 🔓 Credentials decrypted`

**Logs to Monitor:**
```
[BAILEYS] 🔄 Attempting to restore credentials from database...
[SECURITY] 🔓 Credentials decrypted for agent abc12345
[BAILEYS] ✅ Credentials restored from database
[BAILEYS] 🎉 CONNECTION SUCCESS 🎉
```

---

### Test 5: Non-Retryable Errors

**Steps:**
1. ✅ Connect agent
2. ✅ Manually logout from WhatsApp mobile app
3. ✅ Verify connection closes
4. ✅ Verify **NO** automatic reconnection attempts
5. ✅ Verify status set to 'error' in database

**Expected Behavior:**
- Connection closes with status code 401 (logged out)
- No reconnection attempts (non-retryable error)
- Database status: `error`
- User must reconnect manually

**Logs to Monitor:**
```
[BAILEYS] 🔌 Connection closed for abc12345
[BAILEYS] Status code: 401, Reason: Logged Out
[RECONNECT] ⏭️  Agent abc12345 - skipping non-retryable error 401
```

---

### Test 6: Memory Leak Check

**Steps:**
1. ✅ Start backend server
2. ✅ Connect 5-10 agents
3. ✅ Let run for 1 hour
4. ✅ Monitor memory usage
5. ✅ Check for interval leaks
6. ✅ Verify no memory growth

**Expected Behavior:**
- Memory usage stable (no continuous growth)
- No orphaned intervals
- No memory leaks in reconnection timers
- All cleanup functions working

**Monitoring Commands:**
```bash
# Check memory usage
node -e "console.log(process.memoryUsage())"

# Monitor over time (every 5 minutes)
watch -n 300 "node -e 'console.log(process.memoryUsage())'"
```

**Success Criteria:**
- Memory usage stays within 200-500 MB per agent
- No memory growth > 10% over 1 hour
- No "MaxListenersExceededWarning" in logs

---

## 🐛 Troubleshooting

### Issue: Encryption Key Not Set

**Error:**
```
❌ CREDENTIALS_ENCRYPTION_KEY not set in environment!
```

**Solution:**
1. Generate key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Add to `.env`: `CREDENTIALS_ENCRYPTION_KEY=<generated-key>`
3. Restart server

---

### Issue: Reconnection Not Working

**Symptoms:**
- Connection drops but no reconnection attempts
- Logs show: `⏭️ skipping reconnection`

**Check:**
1. Verify status code is not in `nonRetryableCodes` (440, 401, 403, 428)
2. Check database status is not 'disconnected' (user-initiated)
3. Verify `attemptReconnection()` is being called

**Debug:**
```javascript
// Add to connection.close handler
console.log('Reconnection check:', {
  statusCode,
  isNonRetryable: RECONNECTION_CONFIG.nonRetryableCodes.includes(statusCode),
  shouldReconnect
});
```

---

### Issue: Credentials Not Encrypting

**Symptoms:**
- Database shows `encrypted: false` or missing
- No `[SECURITY] 🔐` logs

**Check:**
1. Verify `encryptCredentials()` is called in `syncCredsToDatabase`
2. Check encryption key is valid (64 hex characters)
3. Verify no errors in encryption function

**Debug:**
```javascript
// Add to syncCredsToDatabase
try {
  const encryptedCreds = encryptCredentials(credsData);
  console.log('Encryption result:', {
    hasEncrypted: !!encryptedCreds.encrypted,
    hasIV: !!encryptedCreds.iv,
    hasAuthTag: !!encryptedCreds.authTag
  });
} catch (error) {
  console.error('Encryption error:', error);
}
```

---

### Issue: QR Code Not Expiring

**Symptoms:**
- QR code remains in database after 60 seconds
- No expiration logs

**Check:**
1. Verify `QR_EXPIRATION_TIMERS` Map is working
2. Check timer is set: `QR_EXPIRATION_TIMERS.set(agentId, qrTimerId)`
3. Verify timer callback executes

**Debug:**
```javascript
// Add to QR handler
console.log('QR timer set:', {
  agentId: agentId.substring(0, 8),
  timerId: qrTimerId,
  expiresIn: '60s'
});
```

---

## 📊 Success Criteria

### ✅ All Tests Pass

- [x] Automated test script passes
- [x] QR code expires after 60 seconds
- [x] Credentials encrypted in database
- [x] Automatic reconnection works
- [x] No memory leaks after 1 hour
- [x] No errors in logs

### ✅ Performance Metrics

- **Connection Time:** < 5 seconds
- **Reconnection Time:** < 2 minutes (with exponential backoff)
- **Memory per Agent:** < 100 MB
- **QR Expiration:** Exactly 60 seconds

### ✅ Security Metrics

- **Encryption:** 100% of new credentials encrypted
- **Key Validation:** Key validated on startup
- **Decryption:** Successful for all encrypted credentials

---

## 📝 Test Report Template

After completing tests, fill out:

```markdown
## Phase 1 Test Report

**Date:** YYYY-MM-DD
**Tester:** [Your Name]
**Environment:** [Development/Staging/Production]

### Test Results

| Test | Status | Notes |
|------|--------|-------|
| QR Expiration | ✅/❌ | |
| Credential Encryption | ✅/❌ | |
| Automatic Reconnection | ✅/❌ | |
| Memory Leak Check | ✅/❌ | |

### Issues Found

1. [Issue description]
   - **Severity:** High/Medium/Low
   - **Status:** Fixed/Pending

### Performance Metrics

- Average connection time: ___ seconds
- Average reconnection time: ___ seconds
- Memory usage: ___ MB per agent

### Recommendations

[Any recommendations for improvements]
```

---

## 🚀 Next Steps After Testing

1. **If All Tests Pass:**
   - Deploy to staging environment
   - Run extended tests (24 hours)
   - Monitor production metrics

2. **If Tests Fail:**
   - Review error logs
   - Check troubleshooting section
   - Fix issues and re-test

3. **Documentation:**
   - Update deployment guide
   - Document encryption key management
   - Create runbook for operations team

---

## 📞 Support

If you encounter issues during testing:

1. Check logs: `backend/logs/` or console output
2. Review this guide's troubleshooting section
3. Check GitHub issues for known problems
4. Contact development team with:
   - Test case that failed
   - Error logs
   - Environment details

---

**Last Updated:** 2025-01-15  
**Version:** 1.0.0
