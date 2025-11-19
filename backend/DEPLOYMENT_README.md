# 🚀 Backend Deployment Guide

## ✅ Implementation Complete

Your Express.js backend with Google OAuth one-step login is now **production-ready** and optimized for Railway deployment.

---

## 🎯 What's Been Fixed

### 1. **502 Error Resolution**
- ✅ Server now binds to `0.0.0.0` (required for Railway)
- ✅ Removed blocking operations from server startup
- ✅ Added proper error handling to prevent crashes
- ✅ WhatsApp initialization runs in background (non-blocking)
- ✅ Database connection errors don't crash the server

### 2. **Google OAuth Implementation**
- ✅ ID token verification using `google-auth-library`
- ✅ Automatic user creation in PostgreSQL
- ✅ Duplicate user prevention (unique constraints)
- ✅ JWT generation with 7-day expiry
- ✅ Secure JWT verification middleware

### 3. **Authentication Endpoints**
- ✅ `POST /api/auth/google/verify` - Login with Google
- ✅ `GET /api/auth/me` - Get current user (protected)
- ✅ `POST /api/auth/logout` - Logout (client-side JWT removal)
- ✅ `GET /api/auth/test` - Test endpoint for debugging

### 4. **Error Handling & Logging**
- ✅ Comprehensive error messages
- ✅ Detailed console logging for debugging
- ✅ Environment-specific error responses
- ✅ Uncaught exception handlers
- ✅ Graceful shutdown handling

### 5. **CORS Configuration**
- ✅ Configured for `https://connectbot-ai-frontend.vercel.app`
- ✅ Supports Vercel preview URLs
- ✅ Credentials enabled for cookies/auth headers
- ✅ Localhost support for development

### 6. **Database Schema**
- ✅ Users table with UUID primary key
- ✅ Google OAuth fields (google_id, oauth_provider)
- ✅ Avatar URL and user metadata
- ✅ Proper indexes for performance
- ✅ Unique constraints on email and google_id

---

## 📋 Files Modified/Created

### Core Server Files
- `app.js` - Main server file (completely rewritten for stability)
- `src/routes/auth.js` - Authentication routes (enhanced)
- `src/services/authService.js` - OAuth and JWT logic (robust)
- `src/middleware/auth.js` - JWT verification middleware (improved)

### Testing & Documentation
- `test-auth.js` - Integration test suite (new)
- `DEPLOYMENT_README.md` - This file
- `.env.example` - Environment variable template (updated)

---

## 🔧 Environment Variables

Required variables for Railway:

```bash
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
JWT_SECRET=bf9a4f0b591a71a04370baa3be0e5573
FRONTEND_URL=https://connectbot-ai-frontend.vercel.app
NODE_ENV=production
```

**Note**: Railway automatically sets `PORT`, so don't add it manually.

---

## 🧪 Testing

### Local Testing (if DATABASE_URL is available)

```bash
cd backend
npm install
node test-auth.js
```

**Expected Output:**
```
✅ All environment variables are set
✅ Users table has all required columns
✅ User created: test-user@example.com
✅ User found: test-user@example.com
✅ JWT token generated
✅ JWT verified successfully
✅ Invalid token correctly rejected
✅ Duplicate user correctly prevented

Success rate: 100%
All tests passed! ✨
```

### Test Server Startup

```bash
cd backend
npm start
```

**Expected Output:**
```
============================================================
🚀 Backend Server Started Successfully
============================================================
📍 Port: 3001
🌍 Environment: production
📊 Database: Configured
🔐 Google OAuth: Configured
🔑 JWT Secret: Configured
============================================================
```

---

## 🚂 Railway Deployment

### Step 1: Verify Environment Variables

In Railway Dashboard:
1. Go to your backend service
2. Click **"Variables"** tab
3. Ensure all 6 variables are set (see above)

### Step 2: Deploy

Railway auto-deploys when you push to `main` branch.

```bash
git add .
git commit -m "feat: Implement robust Google OAuth with Railway fixes"
git push origin main
```

### Step 3: Monitor Deployment

In Railway:
1. Click **"Deployments"** tab
2. Wait 2-5 minutes
3. Check logs for success message

**Expected Logs:**
```
============================================================
🚀 Backend Server Started Successfully
============================================================
📍 Port: 8080
🌍 Environment: production
📊 Database: Configured
🔐 Google OAuth: Configured
🔑 JWT Secret: Configured
============================================================
```

### Step 4: Test Endpoints

```bash
# Test root endpoint
curl https://your-railway-url.up.railway.app/

# Test health check
curl https://your-railway-url.up.railway.app/api/health

# Test auth routes
curl https://your-railway-url.up.railway.app/api/auth/test
```

**Expected Response:**
```json
{
  "status": "ok",
  "message": "Server is running",
  "timestamp": "2025-10-17T..."
}
```

---

## 🔐 Authentication Flow

### Frontend Implementation

```javascript
// 1. User clicks "Sign in with Google"
// 2. Google Sign-In widget returns ID token
// 3. Send ID token to backend

const response = await fetch('https://your-backend.railway.app/api/auth/google/verify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
  body: JSON.stringify({
    idToken: 'google-id-token-here'
  })
});

const data = await response.json();

if (data.success) {
  // Save JWT token
  localStorage.setItem('token', data.token);
  
  // User info available
  console.log('User:', data.user);
  // { id, email, name, avatar_url }
}
```

### Protected Requests

```javascript
// Add JWT token to requests
const response = await fetch('https://your-backend.railway.app/api/auth/me', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
});

const data = await response.json();
console.log('Current user:', data.user);
```

---

## 🐛 Troubleshooting

### Issue: 502 Bad Gateway

**Causes:**
- Server not starting
- Missing environment variables
- Database connection blocking startup

**Solution:**
```bash
# Check Railway logs
railway logs

# Look for:
✅ "Backend Server Started Successfully"
❌ "Missing environment variables"
❌ Database connection errors
```

### Issue: 404 on /api/auth endpoints

**Cause:** Routes not registered

**Solution:**
Check `app.js` has:
```javascript
app.use('/api/auth', authRoutes);
```

### Issue: CORS errors

**Cause:** Frontend origin not allowed

**Solution:**
Check `allowedOrigins` in `app.js` includes your frontend URL.

### Issue: "Invalid Google token"

**Causes:**
- Wrong `GOOGLE_CLIENT_ID`
- Expired token
- Token from different client

**Solution:**
1. Verify `GOOGLE_CLIENT_ID` matches Google Cloud Console
2. Ensure frontend uses same client ID
3. Check token is not expired (valid for 1 hour)

### Issue: "Database error"

**Causes:**
- Wrong `DATABASE_URL`
- Database not accessible
- Missing users table

**Solution:**
```bash
# Run migrations
cd backend
npm run migrate:prod

# Or manually in Neon console:
-- Run migrations/001_initial_schema.sql
```

---

## ✅ Deployment Checklist

Before deploying:

- [ ] All environment variables set in Railway
- [ ] Database migrations run (users table exists)
- [ ] `GOOGLE_CLIENT_ID` matches Google Cloud Console
- [ ] `FRONTEND_URL` is correct
- [ ] `JWT_SECRET` is a secure random string
- [ ] Railway domain generated
- [ ] Google Cloud Console has correct redirect URIs
- [ ] Frontend config points to Railway URL

After deploying:

- [ ] Server starts without errors (check logs)
- [ ] `/` returns JSON response
- [ ] `/api/health` returns OK status
- [ ] `/api/auth/test` shows all env vars configured
- [ ] Google login works from frontend
- [ ] `/api/auth/me` returns user data with valid JWT
- [ ] No 502 or 404 errors

---

## 🎉 Success Indicators

Your deployment is successful when:

✅ Railway logs show: **"Backend Server Started Successfully"**
✅ All environment variables show as **"Configured"**
✅ Health endpoint returns: **{"status":"ok"}**
✅ Auth test endpoint shows: **all env vars "configured"**
✅ Frontend can login with Google
✅ Protected routes work with JWT
✅ No server crashes or restarts

---

## 📞 Support

If issues persist:

1. **Check Railway Logs**
   - Railway Dashboard → Deployments → View Logs
   - Look for error messages in red

2. **Test Locally**
   - Run `node test-auth.js` to verify logic
   - Run `npm start` to test server startup

3. **Verify Environment**
   - All 6 variables must be set
   - No typos in variable names
   - DATABASE_URL has `?sslmode=require`

---

## 🚀 Next Steps

After successful deployment:

1. **Update Frontend**
   - Set `VITE_API_URL` to Railway URL
   - Update Google Sign-In component
   - Test login flow end-to-end

2. **Update Google Cloud Console**
   - Add Railway URL to Authorized JavaScript origins
   - Verify redirect URIs point to backend (not frontend)

3. **Test Production**
   - Login with real Google account
   - Check `/api/auth/me` endpoint
   - Verify JWT expiration (7 days)
   - Test logout flow

4. **Monitor**
   - Watch Railway logs for errors
   - Set up error alerting
   - Monitor database connections

---

**Your backend is now production-ready! 🎉**
