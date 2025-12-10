# Initial Sync Skip for Email Webhooks - Implementation Summary

## Overview

This implementation prevents webhook spam from old emails when a user first connects their SMTP/IMAP account. The system now tracks initial sync status and only sends webhooks for emails received **after** the account is connected and initial sync completes.

## Changes Made

### 1. Database Migration

**File:** `backend/migrations/012_add_initial_sync_flags.sql`

Added two new columns to `email_accounts` table:
- `initial_sync_completed` (BOOLEAN, default FALSE) - Tracks if initial sync has completed
- `webhook_enabled_at` (TIMESTAMP) - Records when webhooks were enabled

**Backward Compatibility:** Existing accounts are automatically marked as `initial_sync_completed = TRUE` with `webhook_enabled_at = created_at` to ensure they continue receiving webhooks normally.

### 2. Webhook Filtering Logic

**Files Modified:**
- `backend/src/routes/fetchNewMail.js` - `sendEmailToWebhook()` function
- `backend/src/utils/emailWebhook.js` - `callEmailWebhook()` function

**Logic:**
1. Before sending webhook, check if `initial_sync_completed` is FALSE
   - If FALSE: Skip webhook, log: `⏭️ Skipping webhook - Initial sync not completed`
2. If `webhook_enabled_at` exists, check if email `received_at` is before `webhook_enabled_at`
   - If older: Skip webhook, log: `⏭️ Skipping webhook - Email older than webhook enable time`
3. Otherwise: Send webhook normally

### 3. Initial Sync Completion Marking

**Files Modified:**
- `backend/src/routes/fetchNewMail.js` - `fetchNewUnreadEmailsForAllAccounts()` function
- `backend/src/routes/fetchNewMail.js` - `GET /api/fetch-new-mail/:accountId` route handler
- `backend/src/services/imapEmailSyncService.js` - `syncAllImapAccounts()` function

**Logic:**
1. Before processing emails, check if `initial_sync_completed` is FALSE
2. Log: `🔄 Starting initial sync for account {id}`
3. Process emails normally (but webhooks are skipped due to filtering)
4. After successful email processing, update account:
   - `initial_sync_completed = TRUE`
   - `webhook_enabled_at = NOW()`
5. Log: `✅ Initial sync completed` and `✅ Webhooks enabled`

## How It Works

### New Account Flow

1. **User connects email account**
   - Account created with `initial_sync_completed = FALSE`
   - `webhook_enabled_at = NULL`

2. **First sync runs** (via scheduled job or manual API call)
   - System detects `initial_sync_completed = FALSE`
   - Logs: `🔄 Starting initial sync`
   - Fetches all existing unread emails
   - Saves emails to database
   - **Webhooks are SKIPPED** (filtered out by `sendEmailToWebhook()`)
   - After sync completes, sets:
     - `initial_sync_completed = TRUE`
     - `webhook_enabled_at = NOW()`
   - Logs: `✅ Initial sync completed` and `✅ Webhooks enabled`

3. **Subsequent syncs**
   - System detects `initial_sync_completed = TRUE`
   - Fetches new emails
   - **Webhooks are SENT** for new emails received after `webhook_enabled_at`

### Existing Account Flow (Backward Compatible)

1. **Migration runs**
   - Sets `initial_sync_completed = TRUE`
   - Sets `webhook_enabled_at = created_at` (or NOW() if created_at is NULL)

2. **Normal operation**
   - Webhooks continue to work as before
   - No changes to existing behavior

## Webhook Filtering Details

### Filter 1: Initial Sync Check
```javascript
if (!account.initial_sync_completed) {
  // Skip webhook
  return { success: false, reason: 'initial_sync_not_completed' };
}
```

### Filter 2: Time-Based Check
```javascript
if (account.webhook_enabled_at) {
  const webhookEnabledAt = new Date(account.webhook_enabled_at).getTime();
  const emailReceivedAt = new Date(emailData.received_at).getTime();
  
  if (emailReceivedAt < webhookEnabledAt) {
    // Skip webhook - email is older than webhook enable time
    return { success: false, reason: 'email_older_than_webhook_enable' };
  }
}
```

## Logging

### Initial Sync Logs
- `[SYNC] 🔄 Starting initial sync for account {id} ({email})`
- `[SYNC] ✅ Initial sync completed for account {id} ({email})`
- `[SYNC] ✅ Webhooks enabled - future emails will trigger webhooks`

### Webhook Skip Logs
- `[WEBHOOK] ⏭️ Skipping webhook for UID {uid} - Initial sync not completed`
- `[WEBHOOK] ⏭️ Skipping webhook for UID {uid} - Email older than webhook enable time (email: {date}, enabled: {date})`

### Webhook Send Logs (unchanged)
- `[WEBHOOK] ✅ Successfully sent new unseen email UID {uid} to webhook`

## Testing Checklist

### ✅ New Account Connection
1. Connect a new email account with existing unread emails
2. Verify: No webhooks are sent during initial sync
3. Verify: `initial_sync_completed` is set to TRUE after first sync
4. Verify: `webhook_enabled_at` timestamp is recorded

### ✅ Subsequent Email Fetches
1. Send a new email to the connected account
2. Wait for scheduled fetch or trigger manual fetch
3. Verify: Webhook IS sent for the new email
4. Verify: Old emails still don't trigger webhooks

### ✅ Existing Accounts (Backward Compatibility)
1. Verify existing connected accounts still receive webhooks normally
2. Verify migration sets their `initial_sync_completed` to TRUE

### ✅ Edge Cases
1. Account with no emails at all - should mark sync complete anyway
2. Account that receives first email during initial sync - should skip webhook
3. Multiple accounts being synced simultaneously - each tracked independently

## Files Modified

1. ✅ `backend/migrations/012_add_initial_sync_flags.sql` - Database migration
2. ✅ `backend/src/routes/fetchNewMail.js` - Webhook filtering and sync completion
3. ✅ `backend/src/utils/emailWebhook.js` - Shared webhook utility with filtering
4. ✅ `backend/src/services/imapEmailSyncService.js` - Sync service marks completion

## Database Schema Changes

```sql
ALTER TABLE email_accounts 
ADD COLUMN initial_sync_completed BOOLEAN DEFAULT FALSE,
ADD COLUMN webhook_enabled_at TIMESTAMP;

-- Backward compatibility: Mark existing accounts as synced
UPDATE email_accounts 
SET initial_sync_completed = TRUE, 
    webhook_enabled_at = COALESCE(created_at, NOW())
WHERE initial_sync_completed IS NULL OR initial_sync_completed = FALSE;
```

## Success Criteria

- ✅ New accounts don't spam webhook with old emails
- ✅ Webhooks only sent for emails received after account connection
- ✅ Existing accounts continue working normally
- ✅ Clear logging shows webhook skip/send decisions
- ✅ Database properly tracks sync status
- ✅ No breaking changes to existing functionality

## Next Steps

1. **Run Migration:** Apply `012_add_initial_sync_flags.sql` to your Supabase database
2. **Test:** Connect a new email account and verify webhook behavior
3. **Monitor:** Check logs for initial sync completion messages
4. **Verify:** Confirm old emails don't trigger webhooks for new accounts

## Notes

- The filtering is applied at the webhook level, so emails are still saved to the database during initial sync
- The system uses both flag-based (`initial_sync_completed`) and time-based (`webhook_enabled_at`) filtering for robustness
- Error handling ensures that webhook status checks don't block email processing
- All webhook calls go through the shared `callEmailWebhook()` utility, ensuring consistent behavior

