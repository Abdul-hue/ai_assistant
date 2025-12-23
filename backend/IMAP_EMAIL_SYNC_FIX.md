# IMAP Email Sync Fix - Emails Not Showing in Frontend

## Problem Description

Emails sent to connected IMAP accounts were not:
1. Showing in the frontend after 20+ minutes
2. Triggering webhooks to n8n

## Root Causes Identified

1. **Sync Only Runs for Accounts with `initial_sync_completed = true`**
   - Background sync was filtering out accounts without this flag
   - New accounts or accounts that hadn't completed initial sync were skipped

2. **Webhook Requires `webhook_enabled_at` to be Set**
   - Webhook was skipping emails if `webhook_enabled_at` was NULL
   - Even if `initial_sync_completed = true`, webhook wouldn't trigger without this timestamp

3. **Sync Only Processes Folders with `initial_sync_completed = true`**
   - If no folders were synced, sync would return early without processing INBOX
   - New accounts had no synced folders, so sync did nothing

4. **Sync Runs Every 10 Minutes**
   - There's a delay between when email arrives and when it's synced
   - No way to manually trigger immediate sync

## Fixes Implemented

### 1. Removed `initial_sync_completed` Requirement from Sync
**File:** `backend/src/services/imapEmailSyncService.js`

- Removed the filter that required `initial_sync_completed = true`
- Now syncs all active accounts, even if initial sync hasn't completed
- Added warnings when syncing accounts without initial sync completed

### 2. Auto-Set `webhook_enabled_at` When Missing
**Files:** 
- `backend/src/utils/emailWebhook.js`
- `backend/src/services/imapEmailSyncService.js`

- If `initial_sync_completed = true` but `webhook_enabled_at` is NULL, automatically set it
- Allows webhooks to trigger for accounts that were set up before this field existed
- More lenient date checking (allows emails within 1 hour of webhook enable time)

### 3. Fallback to INBOX When No Folders Synced
**File:** `backend/src/services/imapEmailSyncService.js`

- If no folders have `initial_sync_completed = true`, default to syncing INBOX
- Prevents sync from doing nothing for new accounts
- Ensures emails in INBOX are always checked

### 4. Added Manual Sync Endpoint
**File:** `backend/src/routes/imapSmtp.js`

- New endpoint: `POST /api/imap-smtp/manual-sync/:accountId`
- Allows immediate sync trigger for testing
- Returns detailed sync results

### 5. Enhanced Webhook Logging
**Files:**
- `backend/src/services/imapEmailSyncService.js`
- `backend/src/utils/emailWebhook.js`

- Better logging when webhooks are sent or skipped
- Shows reason when webhook is skipped
- Logs webhook success/failure for debugging

## How to Use

### Manual Sync (Immediate)
```bash
POST /api/imap-smtp/manual-sync/:accountId
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Sync completed",
  "duration": "2.45",
  "results": {
    "foldersProcessed": 1,
    "emailsSaved": 5,
    "emailsUpdated": 0,
    "emailsFetched": 5,
    "errors": 0,
    "folderResults": {
      "INBOX": {
        "emailsFetched": 5,
        "emailsSaved": 5,
        "emailsUpdated": 0,
        "errorsCount": 0
      }
    }
  }
}
```

### Automatic Sync
- Runs every 10 minutes automatically
- Now includes accounts without `initial_sync_completed = true`
- Processes INBOX even if no folders are synced

## Expected Behavior After Fix

### Before Fix:
- ❌ Emails not synced if `initial_sync_completed = false`
- ❌ Webhooks not triggered if `webhook_enabled_at` is NULL
- ❌ No sync if no folders are synced
- ❌ 10+ minute delay for sync

### After Fix:
- ✅ Emails synced for all active accounts
- ✅ `webhook_enabled_at` auto-set when needed
- ✅ INBOX synced even if no folders are synced
- ✅ Manual sync available for immediate testing
- ✅ Better logging for debugging

## Testing

1. **Test Manual Sync:**
   ```bash
   curl -X POST http://localhost:3000/api/imap-smtp/manual-sync/YOUR_ACCOUNT_ID \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

2. **Check Logs:**
   - Look for `[SYNC]` messages in console
   - Check for `[EMAIL_WEBHOOK]` messages
   - Verify emails are saved to database

3. **Verify Frontend:**
   - Emails should appear in frontend after sync
   - Check `/api/imap-smtp/emails-quick/:accountId` endpoint

4. **Verify Webhook:**
   - Check n8n webhook logs
   - Verify webhook payload is received

## Files Modified

1. `backend/src/services/imapEmailSyncService.js`
   - Removed `initial_sync_completed` requirement
   - Added INBOX fallback
   - Enhanced webhook logging
   - Auto-set `webhook_enabled_at`

2. `backend/src/utils/emailWebhook.js`
   - Auto-set `webhook_enabled_at` if missing
   - More lenient date checking
   - Better error handling

3. `backend/src/routes/imapSmtp.js`
   - Added manual sync endpoint

## Next Steps

1. Test manual sync endpoint with your account
2. Check server logs for sync activity
3. Verify emails appear in frontend
4. Check webhook is triggered in n8n


