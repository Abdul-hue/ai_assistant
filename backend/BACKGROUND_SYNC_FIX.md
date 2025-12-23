# Background IMAP Sync Fix - Every 10 Minutes

## Problem
The background IMAP email sync was not working reliably because:
1. `syncAllImapAccounts()` required `comprehensive_sync_completed = true`, which prevented syncing accounts that only had `initial_sync_completed = true`
2. Only one sync mechanism was running, which could miss emails if it failed
3. Limited logging made it difficult to verify sync was working

## Solution

### 1. Fixed Account Selection Criteria
**File**: `backend/src/services/imapEmailSyncService.js`

Changed from requiring `comprehensive_sync_completed = true` to requiring `initial_sync_completed = true`:
```javascript
// Before: Only synced accounts with comprehensive sync completed
.eq('comprehensive_sync_completed', true)

// After: Sync accounts with initial sync completed (more inclusive)
.eq('initial_sync_completed', true)
```

This ensures that accounts are synced in the background as soon as they complete their initial sync, not waiting for comprehensive sync.

### 2. Added Dual Sync Mechanism
**File**: `backend/app.js`

Added two complementary sync mechanisms running every 10 minutes:

#### A. Full Sync (`syncAllImapAccounts`)
- Runs every 10 minutes
- Syncs all folders for all accounts
- Handles comprehensive folder syncing
- Better for accounts that need full folder coverage

#### B. Incremental Sync (`backgroundSyncService`)
- Runs every 10 minutes (in parallel with full sync)
- Lightweight, UID-based incremental sync
- Only syncs new emails since last UID
- Faster and more efficient for regular updates
- Focuses on primary folders: INBOX, Sent, Drafts

### 3. Enhanced Logging
Added detailed logging for both sync mechanisms:
- `[BACKGROUND SYNC]` prefix for full sync logs
- `[INCREMENTAL SYNC]` prefix for incremental sync logs
- Duration tracking for performance monitoring
- Account-by-account sync results
- Total emails synced per run

## How It Works

### Every 10 Minutes:
1. **Full Sync** runs first:
   - Fetches all active accounts with `initial_sync_completed = true`
   - Syncs all folders for each account
   - Updates sync state and account status
   - Logs: `[BACKGROUND SYNC] Running scheduled email sync...`

2. **Incremental Sync** runs in parallel:
   - Fetches active accounts (excluding those needing reconnection)
   - Uses lightweight UID-based sync
   - Only fetches emails with UID > last_synced_uid
   - Logs: `[INCREMENTAL SYNC] Running lightweight background sync...`

### Account Requirements
For an account to be synced in the background:
- ✅ `is_active = true`
- ✅ `initial_sync_completed = true` (at minimum)
- ✅ `imap_host` and `imap_username` must be set
- ✅ For incremental sync: `needs_reconnection = false`

## Benefits

1. **Reliability**: Dual sync mechanism ensures emails are caught even if one method fails
2. **Performance**: Incremental sync is faster and uses less resources
3. **Coverage**: Full sync ensures all folders are checked regularly
4. **Visibility**: Enhanced logging makes it easy to verify sync is working
5. **Inclusivity**: Accounts sync as soon as initial sync completes, not waiting for comprehensive sync

## Monitoring

### Check if sync is running:
Look for these log messages every 10 minutes:
```
🔄 [BACKGROUND SYNC] Running scheduled email sync (every 10 minutes)...
🔄 [INCREMENTAL SYNC] Running lightweight background sync (every 10 minutes)...
```

### Verify sync results:
```
✅ [BACKGROUND SYNC] Scheduled email check completed in X.XXs
✅ [INCREMENTAL SYNC] Completed in X.XXs - X total new emails synced
```

### Check for errors:
```
❌ [BACKGROUND SYNC] Error in scheduled email check: ...
❌ [INCREMENTAL SYNC] Error in lightweight background sync: ...
```

## Testing

To verify the sync is working:
1. Check server logs every 10 minutes for sync messages
2. Send a test email to a connected account
3. Wait up to 10 minutes
4. Check if the email appears in the database
5. Verify sync logs show the email was synced

## Notes

- Both syncs run on the same 10-minute interval
- They run independently and don't interfere with each other
- If one fails, the other can still succeed
- Accounts marked as `needs_reconnection = true` are skipped by incremental sync but attempted by full sync (to clear the flag if sync succeeds)

