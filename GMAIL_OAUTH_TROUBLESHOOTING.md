# Gmail OAuth Troubleshooting Guide

## ✅ Redirect URI Configuration

Based on your Google Console setup, you have correctly added:
```
http://localhost:3001/api/gmail/callback
```

## 🔍 Common Issues and Solutions

### Issue 1: redirect_uri_mismatch Error

**Error Message:**
```
redirect_uri_mismatch
The redirect URI in the request does not match the ones authorized for the OAuth client.
```

**Solution:**
1. **Verify Environment Variable:**
   Make sure your `backend/.env` file contains:
   ```env
   GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback
   ```
   ⚠️ **IMPORTANT:** No trailing slash, exact match required!

2. **Check Google Console:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Navigate to: **APIs & Services** → **Credentials**
   - Click on your OAuth 2.0 Client ID
   - Under **Authorized redirect URIs**, verify you have:
     ```
     http://localhost:3001/api/gmail/callback
     ```
   - Make sure there are NO extra spaces, trailing slashes, or differences

3. **Restart Backend Server:**
   After updating `.env`, restart your backend server:
   ```bash
   cd backend
   npm start
   ```

### Issue 2: Missing Environment Variables

**Check if variables are loaded:**
The backend will now log the configuration when initiating OAuth. Check your backend console for:
```
🔐 Gmail OAuth Configuration:
   Client ID: your-google-client-id-...
   Redirect URI: http://localhost:3001/api/gmail/callback
   Scopes: https://www.googleapis.com/auth/gmail...
```

If any are `undefined`, your `.env` file is not being loaded correctly.

### Issue 3: URL Encoding Issues

The redirect URI must match **exactly**:
- ✅ Correct: `http://localhost:3001/api/gmail/callback`
- ❌ Wrong: `http://localhost:3001/api/gmail/callback/` (trailing slash)
- ❌ Wrong: `http://localhost:3001/api/gmail/callback ` (trailing space)
- ❌ Wrong: `https://localhost:3001/api/gmail/callback` (https instead of http)

### Issue 4: Multiple Redirect URIs

If you have multiple redirect URIs in Google Console, make sure the one being used matches exactly. The backend will use the `GOOGLE_REDIRECT_URI` environment variable.

## 🧪 Testing Steps

1. **Verify Environment Variables:**
   ```bash
   cd backend
   # Check if .env file exists and has the correct values
   cat .env | grep GOOGLE
   ```

2. **Start Backend:**
   ```bash
   cd backend
   npm start
   ```

3. **Check Backend Logs:**
   When you click "Connect Gmail", you should see:
   ```
   🔐 Gmail OAuth Configuration:
      Client ID: 699573195201-...
      Redirect URI: http://localhost:3001/api/gmail/callback
   ```

4. **Test OAuth Flow:**
   - Navigate to `http://localhost:5173/gmail/inbox`
   - Click "Connect Gmail Account"
   - Check the browser console and backend logs for any errors

## 📋 Required Environment Variables

Make sure your `backend/.env` file has:

```env
# Gmail OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3001
```

## 🔧 Debug Mode

The backend now includes detailed logging. When you initiate OAuth, check:

1. **Backend Console:** Look for the OAuth configuration log
2. **Generated URL:** The authUrl will be logged - verify it contains the correct redirect_uri parameter
3. **Browser Network Tab:** Check the actual OAuth request being sent

## ✅ Verification Checklist

- [ ] `GOOGLE_REDIRECT_URI` is set in `backend/.env`
- [ ] Redirect URI in `.env` matches Google Console exactly (no trailing slash)
- [ ] Backend server has been restarted after updating `.env`
- [ ] Google Console has the redirect URI in "Authorized redirect URIs"
- [ ] Gmail API is enabled in Google Cloud Console
- [ ] Required scopes are enabled

## 🆘 Still Having Issues?

1. **Clear Browser Cache:** Sometimes cached OAuth responses cause issues
2. **Check Backend Logs:** Look for the detailed OAuth configuration output
3. **Verify URL in Browser:** When redirected to Google, check the URL parameters
4. **Test with curl:** You can test the OAuth endpoint directly:
   ```bash
   curl http://localhost:3001/api/gmail/auth
   ```

