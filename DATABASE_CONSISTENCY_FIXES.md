# ✅ Database Consistency & Account Validation Fixes

## 🎯 Overview

All sync services now validate account existence before processing, preventing foreign key violations and orphaned records.

---

## ✅ Changes Implemented

### 1. Database Cleanup Script

**File:** `backend/scripts/cleanup-db.js` (NEW)

**Purpose:** Removes orphaned emails and sync states that reference deleted accounts

**Usage:**
```bash
npm run cleanup-db
# or
node backend/scripts/cleanup-db.js
```

**What it does:**
- Finds emails with `email_account_id` that doesn't exist in `email_accounts`
- Finds sync states with `account_id` that doesn't exist
- Deletes orphaned records
- Provides summary of cleanup

---

### 2. Account Validation in All Sync Services

#### ✅ `backgroundSyncService.js`
- Validates account exists and is active before sync
- Improved error messages: "Email account {id} not found or inactive. Please reconnect your account."

#### ✅ `imapEmailSyncService.js`
- Validates accounts before global sync
- Filters out invalid accounts (missing ID, missing IMAP settings)
- Re-validates account before processing each account (prevents race conditions)
- Uses revalidated account data throughout sync process

#### ✅ `imapIdleService.js`
- Validates account exists and is active before starting IDLE monitoring
- Verifies account in database before setting up monitoring
- Skips invalid accounts gracefully

#### ✅ `imapSmtpService.js` (fetchEmails)
- Validates account exists and is active
- Improved error messages with account ID
- Checks IMAP settings are configured

#### ✅ `fetchNewMail.js` route
- Validates account exists, is active, and belongs to user
- Checks IMAP settings before processing
- Returns helpful error messages

#### ✅ `app.js` (IDLE initialization)
- Validates accounts before starting IDLE monitoring
- Filters out invalid accounts (missing IMAP settings)
- Logs skipped accounts for debugging

---

## 🔍 Validation Checks

Every sync operation now checks:

1. **Account Exists:** `account.id` is not null/undefined
2. **Account is Active:** `account.is_active === true`
3. **IMAP Settings:** `account.imap_host` and `account.imap_username` are present
4. **User Ownership:** (for user-specific routes) Account belongs to requesting user

---

## 📋 Error Messages

All error messages now include:
- Account ID for debugging
- Clear action items ("Please reconnect your account")
- Specific issue (not found, inactive, missing settings)

**Examples:**
- `Email account {id} not found or inactive. Please reconnect your account.`
- `IMAP settings not configured for account {email}. Please check your account configuration.`

---

## 🧪 Testing

### Test Database Cleanup:
```bash
npm run cleanup-db
```

**Expected Output:**
```
🧹 Starting database cleanup...

📧 Checking for orphaned emails...
   Found 2 valid accounts
   Found 5 orphaned emails
   ✅ Deleted 5 orphaned emails

📊 Checking for orphaned sync states...
   Found 2 orphaned sync states
   ✅ Deleted 2 orphaned sync states

✅ Database cleanup completed!
   Total accounts: 2
   Orphaned emails removed: 5
   Orphaned sync states removed: 2
```

### Test Account Validation:

1. **Delete an account while sync is running:**
   - Should see: `⚠️ Account {id} was deleted or deactivated during sync. Skipping.`
   - No foreign key violations

2. **Try to sync with invalid account:**
   - Should see: `❌ Account {id} not found or inactive`
   - No crashes

3. **IDLE monitoring with deleted account:**
   - Should skip gracefully
   - No errors in logs

---

## 📊 Summary

### Files Modified:
1. ✅ `backend/scripts/cleanup-db.js` (NEW)
2. ✅ `backend/src/services/backgroundSyncService.js`
3. ✅ `backend/src/services/imapEmailSyncService.js`
4. ✅ `backend/src/services/imapIdleService.js`
5. ✅ `backend/src/services/imapSmtpService.js`
6. ✅ `backend/src/routes/fetchNewMail.js`
7. ✅ `backend/app.js`
8. ✅ `backend/package.json` (added cleanup-db script)

### Protection Added:
- ✅ Account existence validation
- ✅ Account active status check
- ✅ IMAP settings validation
- ✅ Race condition prevention (re-validation)
- ✅ Orphaned record cleanup
- ✅ Improved error messages

---

## 🚀 Next Steps

1. **Run cleanup script:**
   ```bash
   npm run cleanup-db
   ```

2. **Restart backend server**

3. **Monitor logs for validation messages:**
   - Should see account validation logs
   - Should NOT see foreign key violations
   - Invalid accounts should be skipped gracefully

---

**Status: ✅ ALL VALIDATION FIXES COMPLETE**

Every sync operation now validates account existence before processing, preventing all foreign key violations.

