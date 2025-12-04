# Phase 1 Testing Guide - WhatsApp Credential Persistence Fixes

## Pre-Deployment Checklist

### 1. Database Migration (REQUIRED)
```bash
# Run migration on your database
psql -U your_user -d your_database -f backend/migrations/011_add_disconnected_at.sql

# OR via Supabase Dashboard:
# 1. Go to SQL Editor
# 2. Copy contents of backend/migrations/011_add_disconnected_at.sql
# 3. Execute the SQL
```

**Verify migration:**
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'whatsapp_sessions' 
AND column_name = 'disconnected_at';
-- Should return: disconnected_at | timestamp without time zone
```

### 2. Backup Current State
```bash
# Backup database (recommended)
pg_dump -U your_user your_database > backup_before_phase1_$(date +%Y%m%d_%H%M%S).sql

# Backup code
git tag backup-before-phase1-$(date +%Y%m%d)
```

### 3. Code Deployment
```bash
# Pull latest changes
git pull origin main

# Verify changes are present
grep -n "disconnected_at" backend/src/services/baileysService.js
grep -n "validateCredentialFreshness" backend/src/services/baileysService.js

# Restart PM2 (if using PM2)
pm2 restart all
# OR
pm2 restart your-app-name

# OR restart Node.js service
systemctl restart your-service-name
```

---

## Testing Checklist

### Test 1: Clean Disconnect → Immediate Reconnect ✅

**Objective:** Verify manual disconnect completely removes credentials and allows immediate reconnection.

**Steps:**
1. [ ] **Connect an agent** (if not already connected)
   - Navigate to agent dashboard
   - Click "Connect WhatsApp"
   - Scan QR code
   - Wait for connection confirmation

2. [ ] **Disconnect the agent**
   - Click "Disconnect WhatsApp" button
   - **Monitor logs** for cleanup steps:
     ```
     [BAILEYS] ==================== DISCONNECT START ====================
     [BAILEYS] 🔐 Step 1: Attempting explicit logout...
     [BAILEYS] ✅ Logout successful - device unregistered from WhatsApp servers
     [BAILEYS] 🛑 Step 2: Stopping health check and heartbeat intervals...
     [BAILEYS] ✅ Intervals cleared
     [BAILEYS] 🔌 Step 3: Closing socket and removing event listeners...
     [BAILEYS] ✅ Socket closed
     [BAILEYS] 🗄️ Step 4: Clearing instance tracking in database...
     [BAILEYS] ✅ Instance tracking cleared
     [BAILEYS] 🧠 Step 5: Clearing from memory...
     [BAILEYS] ✅ Memory cleared
     [BAILEYS] 🗑️ Step 6: Deleting local auth directory...
     [BAILEYS] ✅ Local credentials deleted
     [BAILEYS] 🗄️ Step 7: Clearing database session data...
     [BAILEYS] ✅ Database cleared
     [BAILEYS] ✅ Step 8: Verifying cleanup...
     [BAILEYS] ✅ All critical cleanup steps succeeded
     [BAILEYS] ==================== DISCONNECT COMPLETE ====================
     ```

3. [ ] **Verify local files deleted**
   ```bash
   # Check if auth directory exists (should NOT exist)
   ls -la /root/pagent/backend/auth_sessions/{agentId}/
   # Expected: No such file or directory
   
   # OR check all agent directories
   ls -la /root/pagent/backend/auth_sessions/
   # Should not contain the disconnected agent's directory
   ```

4. [ ] **Verify database state**
   ```sql
   SELECT 
     agent_id,
     status,
     is_active,
     session_data,
     disconnected_at,
     updated_at
   FROM whatsapp_sessions
   WHERE agent_id = 'your-agent-id';
   
   -- Expected results:
   -- status: 'disconnected'
   -- is_active: false
   -- session_data: NULL (not {} or empty string)
   -- disconnected_at: timestamp (NOT NULL)
   -- updated_at: recent timestamp
   ```

5. [ ] **Reconnect immediately** (no waiting)
   - Click "Connect WhatsApp" immediately after disconnect
   - **Expected:** Fresh QR code should generate within 5-10 seconds
   - **No cooldown message** should appear
   - **No Bad MAC errors** in logs
   - **No 401 errors** in logs

6. [ ] **Verify reconnection logs**
   ```
   [BAILEYS] ==================== INITIALIZATION START ====================
   [BAILEYS] 🔍 Checking database status FIRST (before local files)...
   [BAILEYS] ⚠️ Database status is 'disconnected' - forcing fresh start
   [BAILEYS] 🗑️ Deleting local auth directory (disconnected session)...
   [BAILEYS] ✅ Local credentials deleted
   [BAILEYS] ✅ Database cleared - will generate fresh QR
   [BAILEYS] 🆕 Creating fresh auth state for QR generation...
   [BAILEYS] 🎯 QR CODE RECEIVED!
   ```

**Success Criteria:**
- ✅ All 8 cleanup steps succeed
- ✅ Local files deleted
- ✅ Database `session_data` is NULL
- ✅ `status` = 'disconnected'
- ✅ `disconnected_at` is set
- ✅ Fresh QR generates immediately (no cooldown)
- ✅ No Bad MAC or 401 errors

---

### Test 2: Verify Logout Attempt ✅

**Objective:** Verify explicit logout from WhatsApp servers is attempted.

**Steps:**
1. [ ] **Monitor logs during disconnect**
   - Look for one of these messages:
     - `[BAILEYS] ✅ Logout successful - device unregistered from WhatsApp servers`
     - `[BAILEYS] ℹ️ Logout skipped: Socket not connected or logout not available`
     - `[BAILEYS] ⚠️ Logout failed (non-critical): [error message]`

2. [ ] **Verify logout doesn't block cleanup**
   - Even if logout fails, cleanup should continue
   - All other steps should complete successfully

**Success Criteria:**
- ✅ Logout attempt is logged
- ✅ Cleanup continues even if logout fails
- ✅ No critical errors from logout attempt

---

### Test 3: Database Resilience (Retry Logic) ✅

**Objective:** Verify retry logic handles transient database failures.

**Steps:**
1. [ ] **Simulate slow database** (optional - for testing)
   ```sql
   -- Add artificial delay (PostgreSQL)
   -- This is just for testing - remove after
   ```

2. [ ] **Disconnect agent**
   - Monitor logs for retry attempts:
     ```
     [BAILEYS] ⚠️ Database clear failed (attempt 1/3), retrying...
     [BAILEYS] ⚠️ Database clear failed (attempt 2/3), retrying...
     [BAILEYS] ✅ Database cleared (attempt 3)
     ```

3. [ ] **Verify exponential backoff**
   - Retries should have increasing delays (500ms, 1000ms, 1500ms)
   - Check timestamps in logs

**Success Criteria:**
- ✅ Retry logic activates on failure
- ✅ Up to 3 attempts are made
- ✅ Exponential backoff is used
- ✅ Cleanup eventually succeeds

---

### Test 4: Credential Freshness Validation ✅

**Objective:** Verify stale credentials are rejected after disconnect.

**Steps:**
1. [ ] **Disconnect agent** (from Test 1)

2. [ ] **Manually create stale credentials** (simulate old state)
   ```bash
   # Create auth directory with old credentials
   mkdir -p /root/pagent/backend/auth_sessions/{agentId}
   echo '{"me":{"id":"old-device-id"},"registered":false}' > /root/pagent/backend/auth_sessions/{agentId}/creds.json
   ```

3. [ ] **Attempt reconnection**
   - Monitor logs for validation:
     ```
     [BAILEYS] 🔍 Validating credential freshness...
     [BAILEYS] ❌ Credentials rejected: Session status is 'disconnected' (manual disconnect)
     [BAILEYS] Will generate fresh QR instead
     ```

4. [ ] **Verify fresh QR is generated**
   - Stale credentials should be ignored
   - Fresh QR should appear

**Success Criteria:**
- ✅ Stale credentials are detected
- ✅ Credentials are rejected with clear reason
- ✅ Fresh QR is generated despite stale credentials

---

### Test 5: Multiple Disconnect/Reconnect Cycles ✅

**Objective:** Verify system handles multiple disconnect/reconnect cycles correctly.

**Steps:**
1. [ ] **Cycle 1:** Disconnect → Reconnect → Verify
2. [ ] **Cycle 2:** Disconnect → Reconnect → Verify
3. [ ] **Cycle 3:** Disconnect → Reconnect → Verify

**Success Criteria:**
- ✅ Each cycle completes successfully
- ✅ No credential persistence between cycles
- ✅ Fresh QR generated each time
- ✅ No errors accumulate

---

## Monitoring During Testing

### Key Success Indicators ✅

Look for these log messages:

1. **Disconnect Success:**
   ```
   [BAILEYS] ✅ All critical cleanup steps succeeded
   [BAILEYS] ==================== DISCONNECT COMPLETE ====================
   ```

2. **Reconnection Success:**
   ```
   [BAILEYS] ✅ Credentials validated: Fresh and valid
   [BAILEYS] 🎯 QR CODE RECEIVED!
   ```

3. **Fresh Start:**
   ```
   [BAILEYS] ⚠️ Database status is 'disconnected' - forcing fresh start
   [BAILEYS] 🆕 Creating fresh auth state for QR generation...
   ```

### Error Patterns to Watch For ⚠️

**If you see these, Phase 1 may not be working:**

1. **Bad MAC Errors:**
   ```
   [BAILEYS] ❌ Bad MAC Error detected - Session corruption detected
   ```
   - **Action:** Check if credentials were properly cleared

2. **401 Errors on Reconnect:**
   ```
   [BAILEYS] ❌ 401 - Clearing session due to conflict or device removal
   ```
   - **Action:** Verify logout was attempted and succeeded

3. **Stale Credentials Used:**
   ```
   [BAILEYS] ✅ Found valid credentials with paired device - loading...
   ```
   - **After disconnect:** This should NOT appear immediately after disconnect
   - **Action:** Verify database status check is running first

4. **Cooldown After Disconnect:**
   ```
   [BAILEYS] 🚫 401 error occurred recently... Auto-retry blocked
   ```
   - **After manual disconnect:** This should NOT appear
   - **Action:** Verify `last401Failure` is cleared on disconnect

---

## Database Verification Queries

### Check Disconnect State
```sql
SELECT 
  agent_id,
  status,
  is_active,
  CASE 
    WHEN session_data IS NULL THEN 'NULL ✅'
    WHEN session_data::text = '{}' THEN 'Empty Object ❌'
    WHEN session_data::text = '""' THEN 'Empty String ❌'
    ELSE 'Has Data ❌'
  END as session_data_status,
  disconnected_at,
  updated_at,
  phone_number
FROM whatsapp_sessions
WHERE agent_id = 'your-agent-id';
```

### Check All Disconnected Sessions
```sql
SELECT 
  agent_id,
  status,
  disconnected_at,
  updated_at,
  CASE 
    WHEN disconnected_at IS NOT NULL THEN 'Manual Disconnect ✅'
    WHEN status = 'disconnected' AND disconnected_at IS NULL THEN 'Error Disconnect ⚠️'
    ELSE 'Unknown'
  END as disconnect_type
FROM whatsapp_sessions
WHERE status = 'disconnected'
ORDER BY updated_at DESC;
```

### Verify No Stale Credentials
```sql
-- Should return 0 rows if cleanup worked
SELECT 
  agent_id,
  status,
  session_data
FROM whatsapp_sessions
WHERE status = 'disconnected'
AND session_data IS NOT NULL;
```

---

## Troubleshooting

### Issue: Local Files Not Deleted

**Symptoms:**
- Auth directory still exists after disconnect
- Logs show: `[BAILEYS] ❌ Failed to delete local auth directory`

**Solutions:**
1. Check file permissions:
   ```bash
   ls -la /root/pagent/backend/auth_sessions/
   chmod -R 755 /root/pagent/backend/auth_sessions/
   ```

2. Manually delete:
   ```bash
   rm -rf /root/pagent/backend/auth_sessions/{agentId}
   ```

3. Check disk space:
   ```bash
   df -h
   ```

### Issue: Database Update Fails

**Symptoms:**
- Logs show: `[BAILEYS] ❌ Failed to clear database after 3 attempts`

**Solutions:**
1. Check database connection:
   ```sql
   SELECT NOW();
   ```

2. Check for locks:
   ```sql
   SELECT * FROM pg_locks WHERE relation = 'whatsapp_sessions'::regclass;
   ```

3. Manually update:
   ```sql
   UPDATE whatsapp_sessions
   SET 
     session_data = NULL,
     status = 'disconnected',
     disconnected_at = NOW(),
     is_active = false
   WHERE agent_id = 'your-agent-id';
   ```

### Issue: Cooldown Still Applies After Disconnect

**Symptoms:**
- Reconnect shows: `Please wait X minute(s) before retrying`

**Solutions:**
1. Check `last401Failure` is cleared:
   - Look for: `[BAILEYS] ✅ 401 failure cooldown cleared (manual disconnect)`

2. Verify database status:
   ```sql
   SELECT status FROM whatsapp_sessions WHERE agent_id = 'your-agent-id';
   -- Should be 'disconnected', not 'conflict'
   ```

3. Check logs for cooldown bypass logic

---

## Rollback Plan

If Phase 1 causes issues, follow these steps:

### Quick Rollback (Code Only)
```bash
# Revert to previous commit
git revert HEAD
# OR
git reset --hard backup-before-phase1-YYYYMMDD

# Restart service
pm2 restart all
```

### Full Rollback (Code + Database)
```bash
# 1. Revert code (above)

# 2. Remove column (if needed)
psql -U your_user -d your_database -c "
ALTER TABLE whatsapp_sessions DROP COLUMN IF EXISTS disconnected_at;
"

# 3. Restore database backup (if needed)
psql -U your_user -d your_database < backup_before_phase1_YYYYMMDD_HHMMSS.sql
```

---

## Success Metrics

After completing all tests, you should see:

- ✅ **100% disconnect cleanup success rate**
- ✅ **0 Bad MAC errors** on reconnection
- ✅ **0 401 conflicts** after manual disconnect
- ✅ **0 cooldown delays** after manual disconnect
- ✅ **Fresh QR generation** within 5-10 seconds

---

## Next Steps

Once Phase 1 testing is successful:

1. ✅ Document any issues found
2. ✅ Proceed to Phase 2 (Cooldown Bypass)
3. ✅ Monitor production for 24-48 hours
4. ✅ Collect metrics on disconnect/reconnect success rates

