# Troubleshooting 401 Errors - Code is Already Correct

## ✅ Code Verification

All three files **ALREADY HAVE** `credentials: 'include'`:

1. ✅ `frontend/src/hooks/useAgents.ts` - Line 18
2. ✅ `frontend/src/hooks/useDashboardStats.ts` - Line 24  
3. ✅ `frontend/src/lib/api/profile.ts` - Line 25

## If You're Still Getting 401 Errors

### Step 1: Clear Browser Cache

**Hard Refresh**:
- **Windows/Linux**: `Ctrl + Shift + R` or `Ctrl + F5`
- **Mac**: `Cmd + Shift + R`

**Or Clear Cache Manually**:
1. Open DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

### Step 2: Restart Dev Server

```bash
# Stop the dev server (Ctrl+C)
# Then restart
cd frontend
npm run dev
```

### Step 3: Clear All Cookies

1. Open DevTools (F12)
2. Go to **Application** tab
3. Click **Cookies** in left sidebar
4. Select your domain
5. Right-click → **Clear All**
6. Refresh the page
7. **Login again**

### Step 4: Verify Cookies Are Being Set

After logging in:

1. Open DevTools → **Application** → **Cookies**
2. You should see:
   - `sb_access_token` ✅
   - `sb_refresh_token` ✅

If cookies are **NOT present**, the login endpoint isn't setting them correctly.

### Step 5: Check Network Tab

1. Open DevTools → **Network** tab
2. Make a request (e.g., navigate to dashboard)
3. Click on the `/api/agents` or `/api/dashboard/stats` request
4. Go to **Headers** tab
5. Under **Request Headers**, check for:
   - `Cookie: sb_access_token=...` ✅ Should be present

**If Cookie header is MISSING**:
- The browser isn't sending cookies
- Check CORS configuration
- Verify `credentials: 'include'` is in the code (it is!)

### Step 6: Verify Backend is Receiving Cookies

Check backend logs when making a request. You should see:
```
Cookies received: { sb_access_token: '...', sb_refresh_token: '...' }
```

If cookies are not in the request, the issue is on the frontend.

### Step 7: Check CORS Configuration

Verify backend CORS allows credentials:

**Backend should have**:
```javascript
cors({
  origin: 'http://localhost:5173', // or your frontend URL
  credentials: true, // ✅ CRITICAL
})
```

### Step 8: Verify API_URL Configuration

Check that `API_URL` is correct:

```typescript
// In frontend/src/config.js
console.log('API_URL:', API_URL);
// Should be: 'http://localhost:3001' (no trailing slash)
```

### Step 9: Check for Multiple Fetch Calls

Sometimes there might be duplicate fetch calls. Check if:
1. The hook is being called multiple times
2. There are multiple components using the same hook
3. React Query is caching old responses

### Step 10: Verify Environment

Make sure you're running in the correct environment:

```bash
# Check NODE_ENV
echo $NODE_ENV  # Should be empty or 'development' for local

# Check if backend is running
curl http://localhost:3001/api/health
```

## Common Issues

### Issue 1: Cookies Not Being Set on Login

**Symptom**: Login succeeds but no cookies in Application → Cookies

**Fix**: Check backend cookie configuration:
- `secure: false` for localhost (HTTP)
- `sameSite: 'lax'` for same-domain
- `httpOnly: true` for security

### Issue 2: Cookies Set But Not Sent

**Symptom**: Cookies exist but not in Request Headers

**Fix**: 
- Verify `credentials: 'include'` in fetch (already present)
- Check CORS allows credentials
- Verify same domain or proper CORS origin

### Issue 3: CORS Blocking Requests

**Symptom**: CORS errors in console

**Fix**: Update backend CORS to allow your frontend origin with credentials

### Issue 4: Old Code Running

**Symptom**: Code looks correct but still getting 401

**Fix**: 
- Hard refresh browser
- Restart dev server
- Clear browser cache completely
- Check if using a service worker (clear it)

## Verification Checklist

After following all steps:

- [ ] Browser cache cleared (hard refresh)
- [ ] Dev server restarted
- [ ] Cookies cleared and re-logged in
- [ ] Cookies visible in Application → Cookies
- [ ] Cookie header present in Network → Request Headers
- [ ] Backend CORS configured with `credentials: true`
- [ ] Backend receiving cookies (check logs)
- [ ] API_URL is correct (no trailing slash)
- [ ] No CORS errors in console

## Still Getting 401?

If you've verified all of the above and still getting 401:

1. **Check backend logs** - Is it receiving cookies?
2. **Check browser console** - Any CORS errors?
3. **Check Network tab** - Is Cookie header being sent?
4. **Verify cookie domain** - Should match your frontend domain
5. **Check cookie expiration** - Are cookies expired?

## Code Status

✅ **All code is correct** - All fetch calls have `credentials: 'include'`

The issue is likely:
- Browser cache
- Cookies not being set properly
- CORS configuration
- Environment mismatch
