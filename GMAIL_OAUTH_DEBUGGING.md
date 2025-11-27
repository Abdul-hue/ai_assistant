# Gmail OAuth Debugging Guide

## 🔍 Current Implementation

Your Gmail integration uses a **backend API approach**:
- ✅ Frontend calls backend API endpoints (not Gmail API directly)
- ✅ Backend handles all Gmail API calls with stored tokens
- ✅ Tokens are stored in `email_accounts` table in Supabase
- ✅ No tokens are stored in localStorage or frontend

## 🐛 Common Issues & Solutions

### Issue 1: "Gmail not connected" or "Email account not found"

**Symptoms:**
- Error message: "Gmail not connected" or "Email account not found"
- No emails showing up
- Status check returns `connected: false`

**Causes:**
1. OAuth callback didn't complete successfully
2. Tokens weren't saved to database
3. User account doesn't exist in `email_accounts` table

**Solution:**
1. **Check if account exists in database:**
   ```sql
   SELECT * FROM email_accounts 
   WHERE user_id = 'your-user-id' 
   AND provider = 'gmail' 
   AND is_active = true;
   ```

2. **Reconnect Gmail:**
   - Go to `/gmail/inbox`
   - Click "Connect Gmail Account"
   - Complete the OAuth flow
   - Check backend logs for: `✅ Gmail tokens saved successfully to email_accounts`

3. **Check backend logs** when connecting:
   ```
   🔐 Gmail OAuth Configuration:
   ✅ User email: your-email@gmail.com
   💾 Saving tokens to email_accounts table...
   ✅ Gmail tokens saved successfully to email_accounts
   ```

### Issue 2: "Gmail authentication failed" or "Invalid token"

**Symptoms:**
- Error: "Gmail authentication failed"
- Error: "invalid_grant" or "invalid_token"
- Emails were working but stopped

**Causes:**
1. Access token expired and refresh failed
2. Refresh token is invalid
3. User revoked access in Google Account settings

**Solution:**
1. **Disconnect and reconnect:**
   - Go to `/gmail/settings`
   - Click "Disconnect"
   - Then reconnect your Gmail account

2. **Check token expiration:**
   - Backend automatically refreshes tokens when they expire
   - Check backend logs for: `🔄 Refreshing access token...`

3. **Verify Google Account permissions:**
   - Go to [Google Account Security](https://myaccount.google.com/security)
   - Check "Third-party apps with account access"
   - Make sure your app is listed and has Gmail access

### Issue 3: "No emails found" but connection is successful

**Symptoms:**
- Status shows `connected: true`
- But no emails appear
- No error messages

**Causes:**
1. Gmail API call is failing silently
2. Query is too restrictive
3. No emails match the query

**Solution:**
1. **Check backend logs** when fetching emails:
   ```
   📧 Fetching Gmail messages for user: ...
   ✅ Access token retrieved successfully
   📬 Calling Gmail API to list messages...
   ✅ Gmail API response: X messages found
   ```

2. **Try different queries:**
   - Default: `in:inbox`
   - Try: `is:unread`
   - Try: `from:someone@example.com`

3. **Check Gmail API response:**
   - Look for errors in backend console
   - Check if `response.data.messages` is empty vs null

### Issue 4: OAuth callback fails

**Symptoms:**
- Redirected to `/gmail/inbox?error=...`
- OAuth flow doesn't complete
- Backend logs show callback errors

**Causes:**
1. Redirect URI mismatch
2. State parameter mismatch
3. Authorization code exchange failed

**Solution:**
1. **Verify redirect URI in Google Console:**
   - Must be exactly: `http://localhost:3001/api/gmail/callback`
   - No trailing slash
   - Check both Authorized redirect URIs and Authorized JavaScript origins

2. **Check backend logs during callback:**
   ```
   🔵 Gmail OAuth callback received
   ✅ State validated, User ID: ...
   🔄 Exchanging authorization code for tokens...
   ✅ Tokens received from Google
   💾 Saving tokens to email_accounts table...
   ✅ Gmail tokens saved successfully
   ```

3. **Verify environment variables:**
   ```env
   GOOGLE_CLIENT_ID=699573195201-...
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback
   ```

## 🔧 Debugging Steps

### Step 1: Check Backend Logs

When you try to fetch emails, you should see:
```
📧 Fetching Gmail messages for user: abc-123
🔑 Getting access token for user: abc-123, provider: gmail
✅ Found email account: user@gmail.com, token expires at: 2024-...
✅ Access token retrieved successfully
📬 Calling Gmail API to list messages...
✅ Gmail API response: 20 messages found
✅ Saved 20 emails to database
```

### Step 2: Check Database

Verify tokens are saved:
```sql
SELECT 
  id, 
  user_id, 
  email, 
  provider,
  is_active,
  token_expires_at,
  created_at
FROM email_accounts 
WHERE provider = 'gmail' 
AND is_active = true;
```

### Step 3: Test OAuth Flow

1. **Clear any existing connection:**
   - Go to `/gmail/settings`
   - Click "Disconnect"

2. **Reconnect:**
   - Go to `/gmail/inbox`
   - Click "Connect Gmail Account"
   - Watch backend logs for the full flow

3. **Verify success:**
   - Should redirect to `/gmail/inbox?connected=true`
   - Status should show `connected: true`

### Step 4: Test API Directly

You can test the backend API directly:

```bash
# Check status (requires authentication cookie)
curl -X GET http://localhost:3001/api/gmail/status \
  -H "Cookie: sb_access_token=your-token" \
  --cookie-jar cookies.txt

# Fetch messages (requires authentication cookie)
curl -X GET "http://localhost:3001/api/gmail/messages?maxResults=5" \
  -H "Cookie: sb_access_token=your-token" \
  --cookie cookies.txt
```

## 📋 Verification Checklist

- [ ] Backend server is running on port 3001
- [ ] Frontend is running on port 5173
- [ ] Environment variables are set in `backend/.env`
- [ ] Google OAuth credentials are correct
- [ ] Redirect URI matches Google Console exactly
- [ ] User is logged in (has Supabase session)
- [ ] Gmail account exists in `email_accounts` table
- [ ] `is_active = true` in database
- [ ] `access_token` is not null in database
- [ ] Token expiration is in the future
- [ ] Backend logs show successful token retrieval
- [ ] Gmail API calls are succeeding

## 🆘 Still Having Issues?

1. **Check browser console** for frontend errors
2. **Check backend logs** for detailed error messages
3. **Verify database** - tokens should be in `email_accounts` table
4. **Test OAuth flow** - disconnect and reconnect
5. **Check Google Console** - verify redirect URI and scopes

## 🔐 Security Notes

- Tokens are stored securely in Supabase database
- No tokens are exposed to frontend
- All Gmail API calls go through backend
- Tokens are automatically refreshed when expired
- HttpOnly cookies are used for authentication

