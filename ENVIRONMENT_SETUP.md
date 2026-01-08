# Environment Variables Setup Guide

## 📋 Overview

This application requires environment variables to be set in both the **backend** and **frontend** directories.

## 🔧 Backend Environment Variables

Create a `.env` file in the `backend/` directory with the following variables:

```env
# Supabase
SUPABASE_URL=https://dieozzsqexhptpfwrhxk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Gmail OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Redirect URI for Gmail OAuth callback
# ⚠️ IMPORTANT: Add this EXACT URL to Google Console → OAuth 2.0 Client → Authorized redirect URIs
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback

# Frontend URL for redirects after OAuth
FRONTEND_URL=http://localhost:5173

# Backend URL (for production)
BACKEND_URL=http://localhost:3001
```

**Location:** `backend/.env`

## 🎨 Frontend Environment Variables

Create a `.env` file in the `frontend/` directory with the following variables:

```env
# Google OAuth Client ID for Gmail Integration
# This should match the GOOGLE_CLIENT_ID in backend/.env
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

# API URL (optional - defaults to http://localhost:3001 in development)
# VITE_API_URL=http://localhost:3001
```

**Location:** `frontend/.env`

**Important Notes:**
- Vite requires the `VITE_` prefix for environment variables to be exposed to the frontend
- Never expose secrets (like `GOOGLE_CLIENT_SECRET`) in frontend environment variables
- Only public values like Client IDs should be in frontend `.env`

## 🚀 Quick Setup

### Backend Setup

1. Navigate to backend directory:
   ```bash
   cd backend
   ```

2. Copy the example file:
   ```bash
   # On Windows PowerShell:
   Copy-Item env.example .env
   
   # On Linux/Mac:
   cp env.example .env
   ```

3. Edit `.env` and add your actual values (especially `SUPABASE_SERVICE_ROLE_KEY`)

### Frontend Setup

1. Navigate to frontend directory:
   ```bash
   cd frontend
   ```

2. Create `.env` file:
   ```bash
   # On Windows PowerShell:
   New-Item -ItemType File -Name .env
   
   # On Linux/Mac:
   touch .env
   ```

3. Add the following content to `frontend/.env`:
   ```env
   VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
   ```

## ✅ Verification

### Backend
After setting up backend `.env`, restart your backend server and check the logs. You should see:
```
🔐 Gmail OAuth Configuration:
   Client ID: your-google-client-id-...
   Redirect URI: http://localhost:3001/api/gmail/callback
```

### Frontend
After setting up frontend `.env`, restart your frontend dev server. The Google Client ID should be loaded from the environment variable.

## 🔒 Security Notes

1. **Never commit `.env` files** to version control
2. **Backend `.env`** contains secrets - keep it secure
3. **Frontend `.env`** only contains public values (Client IDs)
4. Use different credentials for development and production

## 📝 File Structure

```
pa-agent/
├── backend/
│   ├── .env                    # ← Create this (contains secrets)
│   └── env.example              # Template (safe to commit)
├── frontend/
│   ├── .env                    # ← Create this (public values only)
│   └── env.example.txt         # Template (safe to commit)
└── ENVIRONMENT_SETUP.md        # This file
```

## 🐛 Troubleshooting

**Backend can't find environment variables:**
- Make sure `.env` file is in the `backend/` directory
- Restart the backend server after creating/updating `.env`
- Check that variable names match exactly (case-sensitive)

**Frontend can't find environment variables:**
- Make sure `.env` file is in the `frontend/` directory
- Variables must start with `VITE_` prefix
- Restart the frontend dev server after creating/updating `.env`
- Check browser console for any errors

**OAuth redirect_uri_mismatch error:**
- Verify `GOOGLE_REDIRECT_URI` in backend `.env` matches Google Console exactly
- No trailing slashes, exact match required
- Restart backend after updating

