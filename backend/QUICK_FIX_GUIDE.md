# Quick Fix Guide for Email Account Disconnection

## 🔍 Current Status (from logs)

Your account `wasay2805@gmail.com` is:
- ✅ **Correctly being skipped** by all sync services
- ✅ **Preventing disconnection loop** (this is good!)
- ❌ **Not syncing emails** (because it needs reconnection)

## 🚀 Quick Fix Steps

### Step 1: Verify Gmail App Password

1. Go to: https://myaccount.google.com/security
2. Navigate to: **2-Step Verification** → **App passwords**
3. Check if an app password exists for your email
4. If missing or expired, create a new one:
   - Click "Select app" → Choose "Mail"
   - Click "Select device" → Choose "Other (Custom name)"
   - Enter name: "PA Agent"
   - Click "Generate"
   - **Copy the 16-character password** (you'll need this)

### Step 2: Test Connection (via API)

Use PowerShell to test if your current credentials work:

```powershell
# Test connection (this will clear the flag if successful)
Invoke-RestMethod -Uri "http://localhost:3001/api/debug/test-connection/21b2e788-2918-4daf-aa02-3cfb896bf068" -Method POST -ContentType "application/json" | ConvertTo-Json
```

**Expected Results:**
- ✅ **Success**: Connection works, flag cleared automatically
- ❌ **Failure**: Shows error message (likely "Not authenticated")

### Step 3A: If Test Succeeds ✅

The account should automatically start syncing. Check logs for:
```
[IDLE] ✅ Starting IDLE for wasay2805@gmail.com
[SYNC] ✅ Syncing account wasay2805@gmail.com
```

### Step 3B: If Test Fails ❌

You need to update the app password. Use the connect endpoint:

```powershell
$body = @{
    email = "wasay2805@gmail.com"
    imap_host = "imap.gmail.com"
    imap_port = 993
    smtp_host = "smtp.gmail.com"
    smtp_port = 587
    imap_username = "wasay2805@gmail.com"
    imap_password = "YOUR_NEW_16_CHAR_APP_PASSWORD"
    smtp_username = "wasay2805@gmail.com"
    smtp_password = "YOUR_NEW_16_CHAR_APP_PASSWORD"
    use_ssl = $true
    use_tls = $true
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3001/api/imap-smtp/connect" -Method POST -Body $body -ContentType "application/json" | ConvertTo-Json
```

**Note:** Replace `YOUR_NEW_16_CHAR_APP_PASSWORD` with the actual app password from Step 1.

### Step 4: Verify Fix

After updating credentials, check the logs. You should see:
```
[IDLE] ✅ Starting IDLE for wasay2805@gmail.com
[SYNC] ✅ Syncing account wasay2805@gmail.com
```

---

## 🔍 Check Account Status

To see current account status:

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/imap-smtp/debug/21b2e788-2918-4daf-aa02-3cfb896bf068" -Method GET | ConvertTo-Json
```

Look for:
- `needs_reconnection`: Should be `false` after fix
- `last_error`: Should be `null` after fix
- `last_successful_sync_at`: Should have a recent timestamp

---

## 📋 Summary

**Current State:**
- ✅ System is working correctly (skipping broken account)
- ❌ Account needs credentials fixed

**Action Required:**
1. Verify/regenerate Gmail app password
2. Test connection
3. Update credentials if test fails
4. Account will automatically start syncing once fixed

**No Action Needed:**
- The system is correctly preventing disconnection loops
- All services are properly skipping the broken account
- Once credentials are fixed, everything will resume automatically

