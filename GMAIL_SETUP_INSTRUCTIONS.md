# Gmail Integration Setup Instructions

## ✅ Google OAuth Credentials

Your Google OAuth credentials need to be configured:
- **Client ID**: `your-google-client-id.apps.googleusercontent.com`
- **Client Secret**: `your-google-client-secret`

## 🔗 Redirect URI for Google Console

You need to add the following redirect URI in your Google Cloud Console:

### For Development (Local):
```
http://localhost:3001/api/gmail/callback
```

### For Production:
```
https://your-backend-domain.com/api/gmail/callback
```
*(Replace `your-backend-domain.com` with your actual backend domain)*

## 📋 Steps to Configure Google Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Navigate to **APIs & Services** → **Credentials**
4. Click on your OAuth 2.0 Client ID
5. Under **Authorized redirect URIs**, click **ADD URI**
6. Add the redirect URI(s) above:
   - For development: `http://localhost:3001/api/gmail/callback`
   - For production: `https://your-backend-domain.com/api/gmail/callback`
7. Click **SAVE**

## 🔐 Required Scopes

Make sure the following Gmail API scopes are enabled in your Google Cloud Console:
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.send`

## ⚙️ Environment Variables

Add these to your `.env` file in the `backend` directory:

```env
# Gmail OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Redirect URI (Development)
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback

# Frontend URL (for redirects after OAuth)
FRONTEND_URL=http://localhost:5173

# Backend URL (for production)
BACKEND_URL=http://localhost:3001
```

## 🚀 How to Use

1. **Start your backend server** (port 3001)
2. **Start your frontend** (port 5173)
3. Navigate to `/gmail/inbox` in your application
4. Click **"Connect Gmail Account"**
5. You'll be redirected to Google to authorize
6. After authorization, you'll be redirected back to the inbox

## 📍 Available Routes

- **Inbox**: `/gmail/inbox` - View and manage your inbox
- **Sent**: `/gmail/sent` - View sent emails
- **Compose**: `/gmail/compose` - Send new emails
- **Settings**: `/gmail/settings` - Manage Gmail connection

## 🔒 Security Notes

- Never commit your `.env` file to version control
- Keep your `GOOGLE_CLIENT_SECRET` secure
- Use different credentials for development and production
- The redirect URI must match exactly what's in Google Console

## ✅ Testing

After setup, test the integration:
1. Go to `/gmail/inbox`
2. Click "Connect Gmail Account"
3. Complete the OAuth flow
4. You should see your inbox emails

## 🐛 Troubleshooting

**Error: "redirect_uri_mismatch"**
- Make sure the redirect URI in Google Console matches exactly: `http://localhost:3001/api/gmail/callback`

**Error: "invalid_client"**
- Verify your Client ID and Client Secret are correct in `.env`

**Error: "access_denied"**
- Make sure you've enabled the Gmail API in Google Cloud Console
- Check that the required scopes are enabled

