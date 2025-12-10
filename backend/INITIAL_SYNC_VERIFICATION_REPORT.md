# Initial Sync Webhook Implementation - Verification Report

## 1. Error Handling in Webhook Functions

### `sendEmailToWebhook()` in `fetchNewMail.js`

**Location:** Lines 130-156

```javascript
// CRITICAL: Check if initial sync is completed and webhook is enabled
const { data: account, error: accountError } = await supabaseAdmin
  .from('email_accounts')
  .select('initial_sync_completed, webhook_enabled_at')
  .eq('id', accountId)
  .single();

if (accountError) {
  console.error(`[WEBHOOK] ❌ Error fetching account sync status:`, accountError.message);
  // Continue anyway - don't block webhook if query fails
} else {
  // ... filtering logic
}
```

**Issue Found:** ⚠️ **If the Supabase query fails, the webhook is sent anyway!** This means if there's a database error, old emails could still trigger webhooks.

**Recommendation:** Should return early if `accountError` exists:
```javascript
if (accountError) {
  console.error(`[WEBHOOK] ❌ Error fetching account sync status:`, accountError.message);
  return { success: false, reason: 'database_error', error: accountError.message };
}
```

### `callEmailWebhook()` in `emailWebhook.js`

**Location:** Lines 20-52

```javascript
// CRITICAL: Check if initial sync is completed and webhook is enabled
try {
  const { data: account, error: accountError } = await supabaseAdmin
    .from('email_accounts')
    .select('initial_sync_completed, webhook_enabled_at')
    .eq('id', accountId)
    .single();

  if (accountError) {
    console.error(`[EMAIL_WEBHOOK] ❌ Error fetching account sync status:`, accountError.message);
    // Continue anyway - don't block webhook if query fails
  } else {
    // ... filtering logic
  }
} catch (checkError) {
  console.error(`[EMAIL_WEBHOOK] ❌ Error checking sync status:`, checkError.message);
  // Continue anyway - don't block webhook if check fails
}
```

**Issue Found:** ⚠️ **Same issue - if query fails, webhook is sent anyway!** The outer try-catch also continues on error.

**Recommendation:** Should return early on errors:
```javascript
if (accountError) {
  console.error(`[EMAIL_WEBHOOK] ❌ Error fetching account sync status:`, accountError.message);
  return { success: false, reason: 'database_error', error: accountError.message };
}
```

---

## 2. IDLE Service Modification

**File:** `backend/src/services/imapIdleService.js`

**Location:** Line 657

```javascript
// Call webhook/API for new emails
try {
  await callEmailWebhook(emailData, accountId, connectionData.account.user_id);
} catch (webhookError) {
  console.error(`[IDLE] Error calling webhook for email UID ${numericUid}:`, webhookError.message);
  // Don't fail the whole process if webhook fails
}
```

**Status:** ✅ **IDLE service is correctly using `callEmailWebhook()`**, which has the filtering logic. No additional changes needed.

---

## 3. Race Conditions for `initial_sync_completed`

### Current Implementation

**Location 1:** `fetchNewMail.js` - Line 933-939
```javascript
const { error: updateError } = await supabaseAdmin
  .from('email_accounts')
  .update({
    initial_sync_completed: true,
    webhook_enabled_at: new Date().toISOString()
  })
  .eq('id', account.id);
```

**Location 2:** `fetchNewMail.js` - Route handler - Line 416-422
```javascript
const { error: updateError } = await supabaseAdmin
  .from('email_accounts')
  .update({
    initial_sync_completed: true,
    webhook_enabled_at: new Date().toISOString()
  })
  .eq('id', accountId);
```

**Location 3:** `imapEmailSyncService.js` - Line 629-632
```javascript
await supabaseAdmin
  .from('email_accounts')
  .update(updateData)
  .eq('id', account.id);
```

**Issue Found:** ⚠️ **No explicit race condition handling.** If two processes try to update simultaneously:
- Both might read `initial_sync_completed = FALSE`
- Both might try to update to `TRUE`
- Supabase should handle this at the database level (last write wins), but there's no atomic check-and-set

**Recommendation:** Use conditional update:
```sql
UPDATE email_accounts 
SET initial_sync_completed = TRUE,
    webhook_enabled_at = NOW()
WHERE id = $1 
  AND initial_sync_completed = FALSE;  -- Only update if still FALSE
```

Or use Supabase's conditional update:
```javascript
.update({
  initial_sync_completed: true,
  webhook_enabled_at: new Date().toISOString()
})
.eq('id', account.id)
.eq('initial_sync_completed', false);  // Only update if still false
```

---

## 4. Database Update Failure Handling

### `fetchNewMail.js` - `fetchNewUnreadEmailsForAllAccounts()`

**Location:** Lines 930-950

```javascript
// CRITICAL: Mark initial sync as completed after first successful fetch
if (isInitialSync) {
  try {
    const { error: updateError } = await supabaseAdmin
      .from('email_accounts')
      .update({
        initial_sync_completed: true,
        webhook_enabled_at: new Date().toISOString()
      })
      .eq('id', account.id);

    if (updateError) {
      console.error(`[SYNC] ❌ Error marking initial sync complete for account ${account.id}:`, updateError.message);
    } else {
      console.log(`[SYNC] ✅ Initial sync completed for account ${account.id} (${account.email})`);
      console.log(`[SYNC] ✅ Webhooks enabled - future emails will trigger webhooks`);
    }
  } catch (updateError) {
    console.error(`[SYNC] ❌ Error updating sync status:`, updateError.message);
    // Don't throw - continue processing
  }
}
```

**Status:** ✅ **Properly wrapped in try-catch, continues on error**

### `fetchNewMail.js` - Route Handler

**Location:** Lines 413-430

```javascript
// CRITICAL: Mark initial sync as completed after first successful fetch
if (isInitialSync) {
  try {
    const { error: updateError } = await supabaseAdmin
      .from('email_accounts')
      .update({
        initial_sync_completed: true,
        webhook_enabled_at: new Date().toISOString()
      })
      .eq('id', accountId);

    if (updateError) {
      console.error(`[SYNC] ❌ Error marking initial sync complete for account ${accountId}:`, updateError.message);
    } else {
      console.log(`[SYNC] ✅ Initial sync completed for account ${accountId} (${account.email})`);
      console.log(`[SYNC] ✅ Webhooks enabled - future emails will trigger webhooks`);
    }
  } catch (updateError) {
    console.error(`[SYNC] ❌ Error updating sync status:`, updateError.message);
    // Don't throw - continue processing
  }
}
```

**Status:** ✅ **Properly wrapped in try-catch, continues on error**

### `imapEmailSyncService.js` - `syncAllImapAccounts()`

**Location:** Lines 616-637

```javascript
// Update account after successful sync
const updateData = {
  sync_status: 'idle',
  last_successful_sync_at: new Date().toISOString(),
  sync_error_details: null,
};

// CRITICAL: Mark initial sync as completed after first successful sync
if (isInitialSync) {
  updateData.initial_sync_completed = true;
  updateData.webhook_enabled_at = new Date().toISOString();
}

await supabaseAdmin
  .from('email_accounts')
  .update(updateData)
  .eq('id', account.id);

if (isInitialSync) {
  console.log(`[SYNC] ✅ Initial sync completed for account ${account.id} (${account.email})`);
  console.log(`[SYNC] ✅ Webhooks enabled - future emails will trigger webhooks`);
}
```

**Issue Found:** ⚠️ **NOT wrapped in try-catch!** If the update fails, it will throw and stop processing. This is inside a larger try-catch (line 590), but the error handling doesn't specifically handle the update failure.

**Recommendation:** Wrap the update in try-catch:
```javascript
try {
  await supabaseAdmin
    .from('email_accounts')
    .update(updateData)
    .eq('id', account.id);

  if (isInitialSync) {
    console.log(`[SYNC] ✅ Initial sync completed for account ${account.id} (${account.email})`);
    console.log(`[SYNC] ✅ Webhooks enabled - future emails will trigger webhooks`);
  }
} catch (updateError) {
  console.error(`[SYNC] ❌ Error updating account sync status:`, updateError.message);
  // Continue - don't fail the whole sync
}
```

---

## 5. Time Comparison and Timezone Handling

### `sendEmailToWebhook()` in `fetchNewMail.js`

**Location:** Lines 147-155

```javascript
// Check 2: Email must be received after webhook was enabled
if (account.webhook_enabled_at) {
  const webhookEnabledAt = new Date(account.webhook_enabled_at).getTime();
  const emailReceivedAt = new Date(emailData.date || emailData.received_at || new Date()).getTime();
  
  if (emailReceivedAt < webhookEnabledAt) {
    console.log(`[WEBHOOK] ⏭️  Skipping webhook for UID ${emailData.uid} - Email older than webhook enable time (email: ${new Date(emailReceivedAt).toISOString()}, enabled: ${account.webhook_enabled_at})`);
    return { success: false, reason: 'email_older_than_webhook_enable' };
  }
}
```

### `callEmailWebhook()` in `emailWebhook.js`

**Location:** Lines 38-47

```javascript
// Check 2: Email must be received after webhook was enabled
if (account.webhook_enabled_at) {
  const webhookEnabledAt = new Date(account.webhook_enabled_at).getTime();
  const emailReceivedAt = new Date(emailData.received_at || emailData.date || new Date()).getTime();
  
  if (emailReceivedAt < webhookEnabledAt) {
    console.log(`[EMAIL_WEBHOOK] ⏭️  Skipping webhook for UID ${emailData.uid} - Email older than webhook enable time (email: ${new Date(emailReceivedAt).toISOString()}, enabled: ${account.webhook_enabled_at})`);
    return { success: false, reason: 'email_older_than_webhook_enable' };
  }
}
```

**Analysis:**
- ✅ Uses `.getTime()` which converts to UTC milliseconds (timezone-agnostic)
- ✅ Both timestamps are compared as UTC milliseconds
- ✅ `webhook_enabled_at` from database is ISO string (UTC)
- ✅ `emailData.date` or `emailData.received_at` should be ISO string (UTC)

**Potential Issue:** ⚠️ **Fallback to `new Date()` if both `date` and `received_at` are missing** - this would use current time, which could incorrectly allow old emails through.

**Recommendation:** Should handle missing date more carefully:
```javascript
const emailReceivedAt = emailData.date || emailData.received_at;
if (!emailReceivedAt) {
  console.warn(`[WEBHOOK] ⚠️ Email UID ${emailData.uid} has no date, skipping webhook`);
  return { success: false, reason: 'missing_email_date' };
}
const emailReceivedAtTime = new Date(emailReceivedAt).getTime();
```

---

## 6. Null Check for `webhook_enabled_at`

### Current Code Path

**Location:** Both `sendEmailToWebhook()` and `callEmailWebhook()`

```javascript
// Check 2: Email must be received after webhook was enabled
if (account.webhook_enabled_at) {
  // ... time comparison
}
```

**Analysis:**
- ✅ If `webhook_enabled_at` is `NULL`, the `if` statement is skipped
- ✅ Webhook will be sent (assuming `initial_sync_completed` is TRUE)

**Scenario:** What if `initial_sync_completed = TRUE` but `webhook_enabled_at = NULL`?

**Current Behavior:** Webhook will be sent for ALL emails (no time filtering)

**Issue Found:** ⚠️ **This could happen if:**
1. Migration sets `initial_sync_completed = TRUE` but `webhook_enabled_at = NULL` for some accounts
2. Database update fails partially (sets one field but not the other)
3. Manual database edit

**Recommendation:** Add explicit check:
```javascript
// Check 2: Email must be received after webhook was enabled
if (!account.webhook_enabled_at) {
  // If sync is complete but webhook_enabled_at is missing, use a safe default
  console.warn(`[WEBHOOK] ⚠️ Account ${accountId} has initial_sync_completed=TRUE but webhook_enabled_at is NULL. Using account creation time as fallback.`);
  // Could set webhook_enabled_at to account.created_at or skip webhook
  return { success: false, reason: 'webhook_enabled_at_missing' };
}

const webhookEnabledAt = new Date(account.webhook_enabled_at).getTime();
// ... rest of comparison
```

Or more lenient:
```javascript
if (account.webhook_enabled_at) {
  // ... time comparison
} else if (account.initial_sync_completed) {
  // Sync is complete but webhook_enabled_at is NULL - allow webhook
  // This handles edge cases where migration didn't set the timestamp
  console.warn(`[WEBHOOK] ⚠️ Account ${accountId} has initial_sync_completed=TRUE but webhook_enabled_at is NULL. Allowing webhook.`);
}
```

---

## Summary of Issues Found

### Critical Issues ⚠️

1. **Error Handling:** If Supabase query fails, webhooks are sent anyway (should return early)
2. **Race Conditions:** No atomic check-and-set for `initial_sync_completed` update
3. **Sync Service Update:** Not wrapped in try-catch, could throw and stop processing
4. **Null `webhook_enabled_at`:** If `initial_sync_completed = TRUE` but `webhook_enabled_at = NULL`, all emails trigger webhooks

### Medium Issues ⚠️

5. **Missing Email Date:** Falls back to `new Date()` which could incorrectly allow old emails

### Working Correctly ✅

1. **IDLE Service:** Uses `callEmailWebhook()` with filtering
2. **Time Comparison:** Uses UTC milliseconds (timezone-safe)
3. **Error Logging:** Comprehensive logging throughout

---

## Recommended Fixes

See individual recommendations above. Priority:
1. Fix error handling in webhook functions (return early on DB errors)
2. Add conditional update for race condition prevention
3. Wrap sync service update in try-catch
4. Handle NULL `webhook_enabled_at` case explicitly

