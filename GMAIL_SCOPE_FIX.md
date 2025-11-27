# Gmail Scope Fix - "Metadata scope does not support 'q' parameter"

## ✅ Fix Applied

The `gmail.metadata` scope has been **removed** from `EXTENDED_GMAIL_SCOPES` because:

- ❌ `gmail.metadata` is too restrictive - cannot search with 'q' parameter
- ❌ `gmail.metadata` cannot read full email bodies
- ✅ `gmail.readonly` already provides all metadata access PLUS search and full body reading

## 📋 Updated Scopes

The following scopes are now used (in `backend/src/services/gmailExtendedFeatures.js`):

```javascript
const EXTENDED_GMAIL_SCOPES = [
  // Read & Display (gmail.readonly includes metadata + search capabilities)
  'https://www.googleapis.com/auth/gmail.readonly',      // View emails, search with 'q', get full bodies
  'https://www.googleapis.com/auth/gmail.labels',        // Manage labels
  
  // Compose & Send
  'https://www.googleapis.com/auth/gmail.compose',       // Create drafts
  'https://www.googleapis.com/auth/gmail.send',          // Send emails
  
  // Modify
  'https://www.googleapis.com/auth/gmail.modify',        // Archive, delete, move, star
  
  // Settings
  'https://www.googleapis.com/auth/gmail.settings.basic', // Change settings
  
  // User Info
  'https://www.googleapis.com/auth/userinfo.email',      // Get email address
  'https://www.googleapis.com/auth/userinfo.profile',    // Get profile info
];
```

## 🔄 Required Actions

### For Users with Existing Tokens

If you already authenticated with Gmail using the old scopes, you **MUST re-authenticate**:

1. **Clear existing tokens from database:**
   ```sql
   -- In Supabase, delete or update email_accounts for the user
   DELETE FROM email_accounts WHERE provider = 'gmail';
   ```

2. **Or disconnect and reconnect:**
   - Go to Gmail Settings page
   - Click "Disconnect Gmail"
   - Click "Connect Gmail" again
   - Approve the NEW scopes on the consent screen

3. **Verify new scopes:**
   - Check that the consent screen shows all permissions
   - After connecting, emails should load without errors

### For New Users

No action needed - they will automatically get the correct scopes when they authenticate.

## 🧪 Testing

After re-authenticating, test:

1. **Email search should work:**
   ```javascript
   // This should work now (previously failed with metadata scope)
   gmail.users.messages.list({
     userId: 'me',
     q: 'in:inbox',  // ✅ Works with gmail.readonly
     maxResults: 20
   });
   ```

2. **Full email bodies should load:**
   ```javascript
   // This should work now
   gmail.users.messages.get({
     userId: 'me',
     id: messageId,
     format: 'full'  // ✅ Works with gmail.readonly
   });
   ```

## 📊 Scope Comparison

| Scope | Can Search ('q') | Can Read Bodies | Can Modify |
|-------|-----------------|-----------------|------------|
| `gmail.metadata` | ❌ | ❌ | ❌ |
| `gmail.readonly` | ✅ | ✅ | ❌ |
| `gmail.modify` | ✅ | ✅ | ✅ |

**Result:** `gmail.readonly` + `gmail.modify` = Full Gmail access ✅

## ✅ Verification Checklist

- [x] Removed `gmail.metadata` from scopes
- [x] Kept `gmail.readonly` (includes metadata + search)
- [x] All other scopes remain intact
- [ ] Users need to re-authenticate to get new scopes
- [ ] Test email search works
- [ ] Test full email bodies load
- [ ] Test email actions (archive, delete, star) work

## 🎯 Expected Behavior After Fix

- ✅ No more "Metadata scope does not support 'q' parameter" error
- ✅ Email search works correctly
- ✅ Full email bodies load
- ✅ All Gmail features work as expected

---

**Note:** This fix requires users to re-authenticate. The old tokens with `gmail.metadata` scope will not work with the new code that uses the 'q' parameter for searching.

