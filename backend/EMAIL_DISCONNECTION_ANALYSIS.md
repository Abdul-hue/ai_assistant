# Email Account Auto-Disconnection Analysis

## 🔍 Your Account Status

**Account ID:** `21b2e788-2918-4daf-aa02-3cfb896bf068`  
**Email:** `wasay2805@gmail.com`  
**Status:** `needs_reconnection: true`  
**Last Error:** `"Authentication failed: Not authenticated"`  
**Last Connection Attempt:** `2025-12-10 11:51:51.982+00`

---

## ❌ Why Your Account Keeps Getting Disconnected

### Root Causes

#### 1. **"Not authenticated" Error** (Most Likely)
This error occurs when:
- ✅ Gmail rejects the login credentials
- ✅ App password is invalid or expired
- ✅ App password was revoked or regenerated
- ✅ Account requires 2FA but app password is missing
- ✅ Gmail security settings changed

**What happens:**
- Any sync service (IDLE, background sync, scheduled sync) tries to connect
- Gmail responds with "Not authenticated"
- System marks account as `needs_reconnection: true`
- **BUT** - other services might still try to reconnect, creating a loop

---

#### 2. **Multiple Services Competing** (Secondary Issue)
Your account is being accessed by multiple services simultaneously:

1. **IDLE Monitoring** (`imapIdleService.js`)
   - Tries to maintain real-time connection
   - Detects "Not authenticated" → marks as `needs_reconnection`
   - Has auto-reconnect logic that might retry

2. **Background Sync** (`backgroundSyncService.js`)
   - Runs periodic syncs
   - Detects "Not authenticated" → marks as `needs_reconnection`
   - Skips account if already marked

3. **Scheduled Email Check** (`fetchNewMail.js`)
   - Checks for new unread emails
   - Detects "Not authenticated" → marks as `needs_reconnection`
   - Skips account if already marked

4. **Manual Sync** (via API)
   - User-triggered syncs
   - Detects "Not authenticated" → marks as `needs_reconnection`

**Problem:** If IDLE is still running, it might try to auto-reconnect even after the account is marked as needing reconnection.

---

#### 3. **Gmail Rate Limiting** (Possible)
If you've had many failed connection attempts:
- Gmail temporarily blocks connections
- Returns "Not authenticated" even with valid credentials
- Usually clears after 10-15 minutes
- But if services keep retrying, the block persists

---

#### 4. **Encrypted Password Issues** (Less Likely)
Your passwords are encrypted:
```
imap_password: "0b1d3cfae2629d7ecb1184ad5b48c16e:c8071f974a746b2b3b0b59c97ce08c1ea23f2ddfd89380b949d4af530e182d65"
smtp_password: "dedfa3d80b4285fc45861c429939fd6e:6d3732f81515ca9f962ca494b6f644195e3a2c4b670a6947e9ea838d83483add"
```

If decryption fails or the encryption key changed, authentication will fail.

---

## 🔄 What Happens When Disconnected

### Step 1: Error Detection
```javascript
// Any sync service encounters "Not authenticated"
if (error.message?.includes('Not authenticated')) {
  // Mark account as needing reconnection
  await supabaseAdmin
    .from('email_accounts')
    .update({
      needs_reconnection: true,
      last_error: `Authentication failed: ${error.message}`,
      last_connection_attempt: new Date().toISOString()
    })
    .eq('id', accountId);
}
```

### Step 2: Services Skip Account
```javascript
// All sync services check this flag
if (account.needs_reconnection) {
  console.log('Skipping account - needs reconnection');
  return; // Skip this account
}
```

### Step 3: IDLE Auto-Reconnect (Problem!)
**IDLE service has auto-reconnect logic:**
```javascript
// If connection fails, IDLE tries to reconnect
if (error.message?.includes('Not authenticated')) {
  const reconnected = await this.reconnectAccount(accountId);
  // This might succeed temporarily, then fail again
}
```

**This creates a loop:**
1. IDLE detects "Not authenticated"
2. IDLE tries to reconnect
3. Reconnection fails (same auth error)
4. Account marked as `needs_reconnection: true`
5. IDLE stops monitoring
6. But if IDLE restarts (server restart, etc.), it tries again
7. Loop continues

---

## 🛠️ How to Fix

### Solution 1: Verify App Password (CRITICAL)

1. **Check if app password exists:**
   - Go to Google Account → Security
   - Check "App passwords" section
   - Verify the app password for `wasay2805@gmail.com` exists

2. **Regenerate app password:**
   - Delete old app password
   - Create new app password
   - Update in your system

3. **Verify 2FA is enabled:**
   - App passwords only work with 2FA enabled
   - If 2FA is disabled, enable it first

### Solution 2: Clear Reconnection Flag & Test

**Step 1: Clear the flag manually**
```sql
UPDATE email_accounts 
SET needs_reconnection = false,
    last_error = NULL,
    last_connection_attempt = NULL
WHERE id = '21b2e788-2918-4daf-aa02-3cfb896bf068';
```

**Step 2: Test connection via API**
```bash
# Test IMAP connection
POST /api/imap-smtp/test-connection
{
  "accountId": "21b2e788-2918-4daf-aa02-3cfb896bf068"
}
```

**Step 3: If test fails, check error message**
- If "Not authenticated" → App password is wrong
- If "Connection ended unexpectedly" → Rate limiting (wait 15 minutes)
- If "Invalid credentials" → Password encryption issue

### Solution 3: Stop IDLE Before Reconnecting

**If IDLE is running, stop it first:**
```bash
# Stop IDLE monitoring
POST /api/idle/stop/21b2e788-2918-4daf-aa02-3cfb896bf068
```

**Then:**
1. Clear `needs_reconnection` flag
2. Update app password if needed
3. Test connection
4. Restart IDLE if connection succeeds

### Solution 4: Check for Rate Limiting

**If you see "Connection ended unexpectedly":**
- Gmail is rate-limiting your account
- **Wait 15 minutes** before trying again
- Don't retry immediately (makes it worse)
- The system should handle this, but if IDLE keeps retrying, it won't help

---

## 🔍 Debugging Steps

### 1. Check Current Status
```sql
SELECT 
  id,
  email,
  needs_reconnection,
  last_error,
  last_connection_attempt,
  last_successful_sync_at
FROM email_accounts
WHERE id = '21b2e788-2918-4daf-aa02-3cfb896bf068';
```

### 2. Check IDLE Status
```bash
GET /api/status/idle
```

Look for your account ID in the response. If it's listed, IDLE is still trying to monitor it.

### 3. Check Server Logs
Look for these patterns:
```
[IDLE] Authentication error for account 21b2e788...
[BACKGROUND SYNC] ❌ Authentication failed for account 21b2e788...
[FETCH] ❌ Authentication failed for account 21b2e788...
```

### 4. Test Connection Manually
```bash
# Use the debug endpoint
POST /api/debug/test-connection/21b2e788-2918-4daf-aa02-3cfb896bf068
```

This will:
- Try to connect to IMAP
- Show the exact error
- Clear `needs_reconnection` if connection succeeds

---

## 🚨 Prevention

### 1. **Stop IDLE When Account Needs Reconnection**
The IDLE service should check `needs_reconnection` before attempting reconnection:

```javascript
// In imapIdleService.js
async reconnectAccount(accountId) {
  // Check if account needs reconnection
  const { data: account } = await supabaseAdmin
    .from('email_accounts')
    .select('needs_reconnection')
    .eq('id', accountId)
    .single();
  
  if (account?.needs_reconnection) {
    console.log('Account marked as needing reconnection - stopping IDLE');
    await this.stopIdleMonitoring(accountId);
    return false;
  }
  
  // ... rest of reconnect logic
}
```

### 2. **Add Cooldown Period**
After marking as `needs_reconnection`, add a cooldown before allowing reconnection attempts:

```javascript
// Don't allow reconnection attempts for 15 minutes after marking as needs_reconnection
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

if (account.needs_reconnection) {
  const timeSinceLastAttempt = Date.now() - new Date(account.last_connection_attempt).getTime();
  if (timeSinceLastAttempt < COOLDOWN_MS) {
    console.log('Account in cooldown period - skipping');
    return;
  }
}
```

### 3. **Better Error Messages**
Distinguish between:
- Invalid credentials (permanent - requires password update)
- Rate limiting (temporary - wait and retry)
- Network issues (temporary - retry)

---

## 📋 Summary

**Your account is disconnecting because:**
1. ✅ Gmail is rejecting authentication ("Not authenticated")
2. ✅ Multiple services are trying to reconnect, creating a loop
3. ✅ IDLE might be auto-reconnecting even after account is marked as needing reconnection

**To fix:**
1. ✅ Verify/regenerate Gmail app password
2. ✅ Stop IDLE monitoring for this account
3. ✅ Clear `needs_reconnection` flag
4. ✅ Test connection manually
5. ✅ If successful, restart IDLE

**To prevent:**
1. ✅ Stop IDLE when account needs reconnection
2. ✅ Add cooldown period after marking as needs_reconnection
3. ✅ Better error detection (distinguish permanent vs temporary errors)

