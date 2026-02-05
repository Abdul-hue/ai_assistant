# Cookie Authentication Fixes - Production 401 Errors

## ✅ All Fixes Implemented

### Problem Summary
Login succeeded (200 OK) but all subsequent API requests returned 401 "No token" errors. Cookies were being set but NOT sent back with requests because:
1. Backend was running in development mode in production
2. Cookie `sameSite: 'strict'` was too restrictive
3. CORS was allowing all origins (insecure for production)

---

## Fixes Applied

### FIX 1: Environment Check Logging ✅
**File**: `backend/app.js`

Added environment check at the very top of the file:
- Logs `NODE_ENV` on startup
- Warns if `NODE_ENV` is not set
- Sets default to 'development' if missing
- Logs whether running in production or development mode

**What to do on server**:
```bash
# SSH into production server
ssh -p 9856 root@69.87.218.122

# Navigate to backend directory
cd /path/to/backend

# Add NODE_ENV to .env file
echo "NODE_ENV=production" >> .env

# Restart backend service
pm2 restart all
# OR
systemctl restart your-backend-service
```

### FIX 2: Cookie Configuration ✅
**File**: `backend/src/routes/auth.js`

**Changed**:
- `sameSite: 'strict'` → `sameSite: 'lax'` (works better for same-domain setup)
- Environment-aware `secure` flag (only true in production)
- Added debug logging for cookie configuration

**Before**:
```javascript
sameSite: 'strict',  // Too restrictive
secure: process.env.NODE_ENV === 'production',
```

**After**:
```javascript
sameSite: 'lax',  // Better for same-domain
secure: isProduction,  // Environment-aware
```

### FIX 3: CORS Configuration ✅
**File**: `backend/app.js`

**Changed from**: Allowing all origins (`origin: true`)
**Changed to**: Environment-aware origin whitelist

**Production**: Only allows:
- `https://pa.duhanashrah.ai`
- `https://www.pa.duhanashrah.ai`
- Other production domains from config

**Development**: Allows localhost variations:
- `http://localhost:5173`
- `http://localhost:3000`
- etc.

### FIX 4: Health Check Endpoint ✅
**File**: `backend/app.js`

Updated to show:
- `environment`: "production" or "development"
- `isProduction`: boolean flag
- `cors.allowedOrigins`: Array of allowed origins (not just count)
- Better environment visibility

### FIX 5: Debug Logging ✅
**File**: `backend/src/routes/auth.js`

Added temporary debug logging:
- Cookie configuration on set
- Set-Cookie headers in response
- Debug info in response (development only)

---

## Deployment Steps

### Step 1: Set NODE_ENV on Production Server

```bash
# SSH into server
ssh -p 9856 root@69.87.218.122

# Navigate to backend directory (adjust path as needed)
cd /path/to/your/backend

# Check current .env file
cat .env

# Add NODE_ENV if not present
echo "NODE_ENV=production" >> .env

# Verify it was added
cat .env | grep NODE_ENV
```

### Step 2: Deploy Code Changes

```bash
# On your local machine, commit and push changes
git add .
git commit -m "fix: Update cookie and CORS configuration for production"
git push origin main

# On production server, pull changes
cd /path/to/backend
git pull origin main

# Install dependencies if needed
npm install

# Restart backend
pm2 restart all
# OR
systemctl restart your-backend-service
# OR if running directly:
pkill -f "node app.js"
NODE_ENV=production node app.js &
```

### Step 3: Verify Environment

```bash
# Check health endpoint
curl https://pa.duhanashrah.ai/api/health

# Should now show:
# "environment": "production" ✅
# "isProduction": true ✅
# NOT "development" ❌
```

---

## Testing Checklist

### After Deployment:

1. **Check Health Endpoint**:
```bash
curl https://pa.duhanashrah.ai/api/health
```
✅ Should show: `"environment": "production"`
✅ Should show: `"isProduction": true`
✅ Should show: `"cors.allowedOrigins": ["https://pa.duhanashrah.ai", ...]`

2. **Test Login in Browser**:
   - Clear all cookies (DevTools → Application → Cookies → Clear all)
   - Open DevTools → Network tab
   - Login at https://pa.duhanashrah.ai
   - Check login response headers for `Set-Cookie`
   - Should see: `Set-Cookie: sb_access_token=...; Path=/; HttpOnly; Secure; SameSite=Lax`

3. **Test Cookie Persistence**:
   - After login, go to DevTools → Application → Cookies
   - Should see `sb_access_token` cookie with:
     - ✅ Secure: Yes (in production)
     - ✅ HttpOnly: Yes
     - ✅ SameSite: Lax
     - ✅ Domain: pa.duhanashrah.ai (no dot prefix)

4. **Test Subsequent Requests**:
   - After login, navigate to dashboard
   - Check Network tab for `/api/agents` request
   - Under "Request Headers", should see: `Cookie: sb_access_token=...`
   - Should get 200 OK (not 401)

5. **Test Page Refresh**:
   - After login, refresh the page
   - Should stay logged in (not redirect to login)

---

## Expected Results

After all fixes:

✅ Health check shows `"environment": "production"`
✅ CORS only allows `https://pa.duhanashrah.ai` (not all origins)
✅ Cookies have correct security settings:
   - `secure: true` in production
   - `sameSite: 'lax'` (not 'strict')
   - No domain attribute (same-domain setup)
✅ Login succeeds and creates cookies
✅ Cookies are sent with all subsequent requests
✅ No more 401 "No token" errors
✅ Auth persists across page navigation and refresh
✅ Local development still works (secure: false, localhost allowed)

---

## Key Changes Summary

| Component | Before | After |
|-----------|--------|-------|
| **Cookie sameSite** | `'strict'` | `'lax'` |
| **Cookie secure** | Always based on NODE_ENV | Environment-aware (isProduction) |
| **CORS origin** | `true` (all origins) | Environment-aware whitelist |
| **Health check** | Shows origin count | Shows actual origins array |
| **Environment** | Not logged | Logged on startup |

---

## Troubleshooting

### If cookies still don't work:

1. **Verify NODE_ENV is set**:
```bash
# On server
echo $NODE_ENV
# Should output: production
```

2. **Check backend logs**:
```bash
# Look for startup message:
# "🚀 Running in PRODUCTION mode"
# NOT "🚀 Running in DEVELOPMENT mode"
```

3. **Verify cookie settings in browser**:
   - DevTools → Application → Cookies
   - Check `sb_access_token` cookie
   - Verify `Secure` is checked (production only)
   - Verify `SameSite` is `Lax`

4. **Check CORS headers**:
   - Network tab → Response Headers
   - Should see: `Access-Control-Allow-Origin: https://pa.duhanashrah.ai`
   - Should see: `Access-Control-Allow-Credentials: true`

5. **Check request headers**:
   - Network tab → Request Headers
   - Should see: `Cookie: sb_access_token=...`
   - Should see: `Origin: https://pa.duhanashrah.ai`

---

## Files Modified

1. `backend/app.js`:
   - Added environment check logging
   - Fixed CORS configuration (environment-aware)
   - Updated health check endpoint

2. `backend/src/routes/auth.js`:
   - Changed `sameSite: 'strict'` → `sameSite: 'lax'`
   - Added debug logging
   - Updated clearCookie to match cookie settings

---

## Next Steps

1. Deploy code changes to production
2. Set `NODE_ENV=production` on server
3. Restart backend service
4. Verify health endpoint shows production
5. Test login flow
6. Verify cookies are sent with requests
7. Remove debug logging after confirming everything works

---

## Notes

- Debug logging is included temporarily - remove after confirming everything works
- `sameSite: 'lax'` works better than 'strict' for same-domain setups
- CORS now properly restricts origins in production
- All cookie settings must match between `res.cookie()` and `res.clearCookie()`
