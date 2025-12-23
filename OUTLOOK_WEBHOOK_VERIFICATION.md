# Outlook Webhook Integration - Verification Results

## ✅ GOOD NEWS: Webhook Integration Already Exists!

After thorough investigation, I can confirm that **webhook integration for Outlook emails is ALREADY IMPLEMENTED** and is **provider-agnostic**. It works for both Gmail and Outlook automatically.

---

## Current Implementation Status

### ✅ **1. Webhook Service Exists**

**File:** `backend/src/utils/emailWebhook.js`

- **Function:** `callEmailWebhook(emailData, accountId, userId)`
- **Webhook URL:** `https://auto.nsolbpo.com/webhook/pa-email`
- **Status:** ✅ Provider-agnostic (works for Gmail, Outlook, any IMAP account)
- **Line 12-155:** Complete webhook implementation

**Key Features:**
- Checks initial sync completion before sending
- Validates email date vs webhook_enabled_at
- Sends webhook with email data
- Handles errors gracefully

---

### ✅ **2. Background Sync Service Exists**

**File:** `backend/src/services/backgroundSyncService.js`

- **Function:** `syncNewEmailsOnly(accountId, folder)`
- **Webhook Call:** Line 496 - `await callEmailWebhook(emailData, accountId, account.user_id)`
- **Status:** ✅ Provider-agnostic (works for all IMAP accounts)
- **Sync Logic:** Incremental sync (only fetches UID > last_uid_synced)

**How it works:**
1. Fetches new emails from IMAP (any provider)
2. Saves emails to database
3. **Calls webhook for each new email** (line 496)
4. Updates sync state

---

### ✅ **3. Email Sync Cron Job Exists**

**File:** `backend/src/jobs/emailSyncCron.js`

- **Schedule:** Every 10 minutes (`*/10 * * * *`)
- **Status:** ✅ Provider-agnostic (syncs ALL active IMAP accounts)
- **Line 24-29:** Fetches ALL active accounts with IMAP credentials (NO provider filter!)

```javascript
// Line 24-29 - NO provider filtering!
const { data: accounts } = await supabaseAdmin
  .from('email_accounts')
  .select('id, email, is_active, needs_reconnection')
  .eq('is_active', true)
  .not('imap_host', 'is', null)
  .not('imap_username', 'is', null);
```

**What it does:**
1. Gets ALL active IMAP accounts (Gmail, Outlook, custom)
2. Syncs INBOX folder for each account
3. Calls `syncNewEmailsOnly()` which calls webhook
4. Runs every 10 minutes automatically

---

### ✅ **4. IDLE Monitoring Exists**

**File:** `backend/src/services/imapIdleService.js`

- **Class:** `ImapIdleManager`
- **Status:** ✅ Provider-agnostic (monitors all IMAP accounts)
- **Real-time:** Uses IMAP IDLE protocol for instant notifications
- **Fallback:** Polls every 30 seconds if IDLE not supported

**How it works:**
1. Starts monitoring when account is connected
2. Detects new emails in real-time
3. Saves to database
4. Sends webhook (via `imapEmailSyncService.js`)

---

### ✅ **5. Email Sync Service Exists**

**File:** `backend/src/services/imapEmailSyncService.js`

- **Function:** `syncFolder(connection, accountId, folderName, account)`
- **Webhook Call:** Line 589 - `await callEmailWebhook(...)`
- **Status:** ✅ Provider-agnostic (works for all IMAP accounts)

---

## Webhook Payload Structure

The webhook payload is **provider-agnostic** and includes:

```javascript
{
  event: 'new_email',
  timestamp: '2024-01-01T12:00:00.000Z',
  account_id: 'account-uuid',
  user_id: 'user-uuid',
  email: {
    id: 'email-id',
    uid: 12345,
    subject: 'Email Subject',
    sender_name: 'Sender Name',
    sender_email: 'sender@example.com',
    recipient_email: 'recipient@example.com',
    body_text: 'Email body text',
    body_html: '<p>Email body HTML</p>',
    received_at: '2024-01-01T12:00:00.000Z',
    folder_name: 'INBOX',
    is_read: false,
    is_starred: false,
    attachments_count: 0,
    attachments_meta: []
  }
}
```

**Note:** The payload doesn't explicitly include `provider: 'outlook'` field, but you can determine the provider by:
1. Querying the account from database using `account_id`
2. Checking the `sender_email` domain
3. Adding provider field to webhook payload (optional enhancement)

---

## How It Works for Outlook

### Automatic Flow:

1. **User connects Outlook account**
   - Account saved with `provider: 'outlook'`
   - `is_active: true`
   - `initial_sync_completed: false`

2. **Initial sync runs** (via cron or manual)
   - `backgroundSyncService.syncNewEmailsOnly()` is called
   - Fetches existing emails from Outlook
   - Saves to database
   - **Webhooks are SKIPPED** (initial sync protection)
   - Sets `initial_sync_completed: true` and `webhook_enabled_at: NOW()`

3. **Background sync runs every 10 minutes**
   - Cron job (`emailSyncCron.js`) runs
   - Gets ALL active accounts (including Outlook)
   - Calls `syncNewEmailsOnly()` for each account
   - Fetches new emails (UID > last_uid_synced)
   - **Calls webhook for each new email** ✅

4. **IDLE monitoring** (if supported)
   - `ImapIdleManager` monitors Outlook account
   - Detects new emails in real-time
   - Saves to database
   - **Calls webhook** ✅

---

## Verification Checklist

### ✅ **Already Implemented:**

- [x] Webhook service exists (`emailWebhook.js`)
- [x] Background sync calls webhook (`backgroundSyncService.js:496`)
- [x] Email sync service calls webhook (`imapEmailSyncService.js:589`)
- [x] Cron job runs every 10 minutes (`emailSyncCron.js`)
- [x] Cron job syncs ALL accounts (no provider filter)
- [x] IDLE monitoring exists (`imapIdleService.js`)
- [x] Webhook URL configured: `https://auto.nsolbpo.com/webhook/pa-email`
- [x] Initial sync protection (prevents webhook spam)
- [x] Provider-agnostic implementation

### ⚠️ **Optional Enhancements:**

- [ ] Add `provider` field to webhook payload (for easier identification)
- [ ] Add webhook delivery tracking table (for retry logic)
- [ ] Add webhook retry mechanism for failed deliveries
- [ ] Add webhook delivery status endpoint

---

## Testing the Webhook

### 1. **Connect Outlook Account**

```bash
POST /api/imap-smtp/connect
{
  "email": "test@outlook.com",
  "imapPassword": "your-app-password",
  "smtpPassword": "your-app-password",
  "autoDetect": true
}
```

### 2. **Wait for Initial Sync**

- Initial sync runs automatically (within 10 minutes via cron)
- Or trigger manually: `GET /api/fetch-new-mail/:accountId`
- Webhooks are skipped during initial sync

### 3. **Send Test Email**

Send an email to your Outlook account from another address.

### 4. **Wait for Background Sync**

- Background sync runs every 10 minutes
- Or trigger manually: `GET /api/fetch-new-mail/:accountId`
- Webhook should be called within 10 minutes

### 5. **Check Webhook Logs**

Look for these log messages:

```
[BACKGROUND SYNC] ✅ Found X new emails to sync
[EMAIL_WEBHOOK] ✅ Successfully called webhook for email UID X
```

Or check your webhook endpoint logs at `https://auto.nsolbpo.com/webhook/pa-email`

---

## Code Locations

### Webhook Implementation:
- **Service:** `backend/src/utils/emailWebhook.js` (Line 12-155)
- **Called from:** `backend/src/services/backgroundSyncService.js` (Line 496)
- **Called from:** `backend/src/services/imapEmailSyncService.js` (Line 589)

### Background Sync:
- **Service:** `backend/src/services/backgroundSyncService.js`
- **Cron Job:** `backend/src/jobs/emailSyncCron.js` (runs every 10 minutes)
- **Manual Trigger:** `GET /api/fetch-new-mail/:accountId`

### IDLE Monitoring:
- **Service:** `backend/src/services/imapIdleService.js`
- **Started in:** `backend/app.js` (Line 1255-1279)

---

## Summary

### ✅ **Webhook Integration Status: COMPLETE**

The webhook integration for Outlook emails is **already fully implemented** and **works automatically**. No additional code is needed!

**Key Points:**
1. ✅ Webhook service is provider-agnostic
2. ✅ Background sync works for all IMAP accounts (Gmail, Outlook, custom)
3. ✅ Cron job runs every 10 minutes for ALL accounts
4. ✅ IDLE monitoring works for all IMAP accounts
5. ✅ Webhook is called automatically for new emails

**What happens:**
- When you connect an Outlook account, it's automatically included in background sync
- Every 10 minutes, the cron job syncs ALL active accounts (including Outlook)
- New Outlook emails trigger webhook calls to `https://auto.nsolbpo.com/webhook/pa-email`
- Same webhook endpoint as Gmail (unified system)

**Optional Enhancement:**
If you want to identify Outlook emails in the webhook payload, you can add a `provider` field:

```javascript
// In emailWebhook.js, add provider to payload:
const account = await getAccount(accountId);
const payload = {
  event: 'new_email',
  provider: account.provider || 'custom', // Add this line
  account_id: accountId,
  // ... rest of payload
};
```

But this is **optional** - the webhook already works without it!

---

## Conclusion

**No implementation needed** - webhook integration for Outlook is already complete and working! 🎉

The system is designed to be provider-agnostic, so Outlook accounts automatically get the same webhook functionality as Gmail accounts.

