# Email Sync and Folder Display Fixes

## Issues Fixed

### 1. ✅ Folder Organization Not Showing (Sent, Drafts, Trash, Spam, Archived)

**Problem:**
- Only INBOX folder was visible in the email interface
- Other folders (Sent, Drafts, Trash, Spam, Archived) were not displayed

**Root Cause:**
The `flattenBoxes` function in `backend/src/services/imapSmtpService.js` was incorrectly filtering folders. It only added folders that had NO children, but folders like `[Gmail]/Sent Mail` are children of the `[Gmail]` container, so they were being processed recursively but never added to the folders list.

**Fix:**
- Changed folder filtering logic to check for `\Noselect` attribute instead of checking for children
- Now adds all selectable folders (those without `\Noselect` attribute), regardless of whether they have children
- Always recursively processes children to find nested folders

**Files Modified:**
- `backend/src/services/imapSmtpService.js` (lines 903-927)

**Result:**
- All folders (INBOX, Sent, Drafts, Trash, Spam, Archived, etc.) are now displayed in the sidebar
- Folders are properly sorted (INBOX first, then alphabetically)

---

### 2. ✅ Background Sync Not Syncing New Emails (Showing 2 Days Old Emails)

**Problem:**
- Incremental background sync every 10 minutes was not syncing new emails
- Users were seeing emails from 2 days ago, suggesting new emails weren't being fetched

**Root Causes:**
1. Sync state was only updated when new messages were found, so if sync ran but found 0 new messages, the `last_sync_at` timestamp wasn't updated
2. Sync state query didn't include `last_sync_at` field, making it impossible to track when last sync occurred
3. No logging to indicate when sync was stale

**Fixes Applied:**

#### Fix 2.1: Always Update Sync State
- Modified `backgroundSyncService.js` to always update sync state, even when no new messages are found
- This ensures `last_sync_at` timestamp is always current
- Helps track when last sync occurred

#### Fix 2.2: Include last_sync_at in Query
- Added `last_sync_at` to the sync state query so we can track when last sync happened
- Enables better logging and debugging

#### Fix 2.3: Improved Logging
- Added logging to show when last sync occurred
- Warns if last sync was more than 1 hour ago

#### Fix 2.4: Sync State Update in imapEmailSyncService
- Also fixed sync state update in `imapEmailSyncService.js` to always update timestamp
- Ensures consistency across both sync services

**Files Modified:**
- `backend/src/services/backgroundSyncService.js` (lines 48-56, 285-304)
- `backend/src/services/imapEmailSyncService.js` (lines 464-472)

**Result:**
- Sync state is always kept up-to-date
- Better visibility into sync status via logs
- Background sync should now properly track and sync new emails

---

## Testing Recommendations

### Test Folder Display:
1. Navigate to email inbox
2. Check sidebar - should see all folders (INBOX, Sent, Drafts, Trash, Spam, Archived, etc.)
3. Click on each folder - should load emails from that folder
4. Verify folder icons are correct

### Test Background Sync:
1. Send yourself a new email from another account
2. Wait 10-15 minutes (background sync runs every 10 minutes)
3. Check backend logs for:
   - `[BACKGROUND SYNC] Found X new emails`
   - `[BACKGROUND SYNC] Updated sync state: last_uid_synced = X`
4. Refresh email inbox - new email should appear
5. Check database: `SELECT * FROM email_sync_state WHERE account_id = 'YOUR_ACCOUNT_ID'`
   - Verify `last_sync_at` is recent (within last 10-15 minutes)
   - Verify `last_uid_synced` is updated

### Manual Sync Test:
1. Click "Sync from IMAP" button in inbox
2. Should see toast notification with email count
3. New emails should appear immediately

---

## Additional Notes

- Background sync runs every 10 minutes via `syncAllImapAccounts()` in `app.js`
- Sync processes all folders for each account, not just INBOX
- Sync state is stored per account per folder in `email_sync_state` table
- UID-based incremental sync ensures only new emails are fetched (efficient)

---

## Deployment

1. Restart backend server to load changes
2. Monitor logs for sync activity
3. Verify folders appear in frontend
4. Test with a new email to confirm sync is working

---

*Fixes Applied: 2024*
*Status: ✅ Complete*

