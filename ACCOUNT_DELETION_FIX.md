# Email Account Deletion Fix - Complete

## Issue Fixed

### Problem: Duplicate Key Constraint Error on Reconnection

**Error:**
```
POST http://localhost:3001/api/imap-smtp/connect 500 (Internal Server Error)
{
    "error": "Failed to save account",
    "details": "duplicate key value violates unique constraint \"unique_user_email_provider\""
}
```

**Root Cause:**
1. When user disconnects/logs out, the account was only marked as `is_active: false` but NOT deleted
2. When user tries to reconnect, the connect endpoint only checks for `is_active: true` accounts
3. It doesn't find the inactive account, so tries to insert a new one
4. Database unique constraint `unique_user_email_provider` prevents duplicate (user_id, email, provider) combinations
5. Error occurs because inactive account still exists in database

---

## Fixes Applied

### Fix 1: Disconnect Endpoint Now Deletes Account

**Before:**
- Only set `is_active: false`
- Account remained in database
- Caused duplicate key errors on reconnection

**After:**
- **Actually DELETES the account** from database
- Stops IDLE monitoring before deletion
- Cascade delete automatically removes:
  - Related emails (via `email_account_id` foreign key)
  - Email sync state (via `account_id` foreign key)
  - Other related data

**File Modified:**
- `backend/src/routes/imapSmtp.js` (lines 712-749)

**Benefits:**
- No duplicate accounts in database
- Clean slate for reconnection
- No orphaned data

---

### Fix 2: Connect Endpoint Handles Inactive Accounts

**Before:**
- Only checked for `is_active: true` accounts
- Didn't find inactive accounts
- Tried to insert new account → duplicate key error

**After:**
- Checks for both active AND inactive accounts
- If inactive account found:
  - Stops IDLE monitoring
  - Deletes the inactive account
  - Proceeds with new connection
- If active account found:
  - Returns existing account (no duplicate)

**File Modified:**
- `backend/src/routes/imapSmtp.js` (lines 47-71)

**Benefits:**
- Prevents duplicate key errors
- Allows seamless reconnection
- Handles edge cases gracefully

---

## How It Works Now

### Disconnect Flow:
1. User clicks "Disconnect" on email account
2. Frontend calls `DELETE /api/imap-smtp/accounts/:accountId`
3. Backend:
   - Verifies account belongs to user
   - Stops IDLE monitoring
   - **DELETES account from database** (not just deactivate)
   - Cascade delete removes related emails and sync state
4. Account completely removed - user can reconnect fresh

### Reconnect Flow:
1. User tries to connect same email account
2. Frontend calls `POST /api/imap-smtp/connect`
3. Backend:
   - Checks for existing account (active or inactive)
   - If active: Returns existing account
   - If inactive: Deletes it, then creates new account
   - If none: Creates new account
4. No duplicate key errors!

---

## Database Cascade Delete

When an account is deleted, the following are automatically removed (via foreign key CASCADE):

1. **emails** table - All emails with `email_account_id = accountId`
2. **email_sync_state** table - All sync states with `account_id = accountId`
3. **Other related data** - Any other tables with foreign keys to `email_accounts`

This ensures no orphaned data remains in the database.

---

## Testing

### Test Disconnect:
1. Connect an email account
2. Click "Disconnect" button
3. **Expected:** Account removed from list immediately
4. Check database: `SELECT * FROM email_accounts WHERE email = 'your@email.com'`
   - Should return 0 rows (account deleted)
5. Check related data: `SELECT * FROM emails WHERE email_account_id = 'account-id'`
   - Should return 0 rows (cascade deleted)

### Test Reconnect:
1. Disconnect an account (from test above)
2. Try to reconnect the same email account
3. **Expected:** 
   - No duplicate key error
   - Account connects successfully
   - New account created with fresh ID
4. Check database: Should have 1 account (the new one)

### Test Inactive Account Cleanup:
1. Manually set account to inactive: `UPDATE email_accounts SET is_active = false WHERE id = 'account-id'`
2. Try to connect the same email
3. **Expected:**
   - Inactive account is automatically deleted
   - New account is created
   - No errors

---

## Migration Notes

### Existing Inactive Accounts

If you have existing inactive accounts in your database, they will be automatically handled:

1. **On next disconnect:** They'll be properly deleted
2. **On reconnect:** They'll be deleted before creating new account
3. **Manual cleanup (optional):**
   ```sql
   -- Find inactive accounts
   SELECT id, email, user_id, provider, is_active 
   FROM email_accounts 
   WHERE is_active = false;
   
   -- Delete them if needed (cascade will clean up related data)
   DELETE FROM email_accounts WHERE is_active = false;
   ```

---

## Key Changes Summary

1. **Disconnect:** Now deletes account instead of deactivating
2. **Connect:** Handles inactive accounts by deleting them first
3. **IDLE Monitoring:** Properly stopped before account deletion
4. **Cascade Delete:** Ensures no orphaned data

---

## Expected Behavior After Fix

- ✅ Disconnect removes account completely from database
- ✅ Reconnect works without duplicate key errors
- ✅ Inactive accounts are automatically cleaned up
- ✅ No orphaned emails or sync state data
- ✅ Clean database state for all accounts

---

*Fixes Applied: 2024*
*Status: ✅ Complete - Ready for Testing*

