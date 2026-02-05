# Cookie Timing Fix - 401 Errors After Login

## Problem Identified

From console logs:
1. ✅ Login succeeds: "✅ Session cookies created for: wasay3898@gmail.com"
2. ❌ Immediately after: All requests return 401 "No token"
3. ❌ Profile fetch fails: "⚠️ Failed to load profile: No token"

**Root Cause**: Cookies are being SET in the response, but subsequent requests are made BEFORE the browser has processed the Set-Cookie headers.

## Fix Applied

### 1. Added Delay After Cookie Creation

**File**: `frontend/src/context/AuthContext.tsx`

Added a 200ms delay after setting cookies to allow the browser to process Set-Cookie headers:

```typescript
// After cookies are set
setUser(userData.user);

// CRITICAL: Wait for browser to process Set-Cookie headers
await new Promise(resolve => setTimeout(resolve, 200));

await loadProfile();
```

### 2. Added Debug Logging

Added logging to verify cookies are being received:

```typescript
const setCookieHeader = response.headers.get('Set-Cookie');
console.log('🍪 Set-Cookie header received:', setCookieHeader ? 'Yes' : 'No');
```

## Verification Steps

### Step 1: Check Network Tab

1. Open DevTools → **Network** tab
2. Login
3. Find the `/api/auth/session` request
4. Check **Response Headers**:
   - Should see: `Set-Cookie: sb_access_token=...`
   - Should see: `Set-Cookie: sb_refresh_token=...`

### Step 2: Check Cookies in Browser

1. After login, go to DevTools → **Application** → **Cookies**
2. Select `pa.duhanashrah.ai`
3. Should see:
   - `sb_access_token` ✅
   - `sb_refresh_token` ✅

### Step 3: Check Request Headers

1. After login, make a request (e.g., navigate to dashboard)
2. Find the `/api/agents` or `/api/dashboard/stats` request
3. Check **Request Headers**:
   - Should see: `Cookie: sb_access_token=...`

## If Cookies Still Don't Work

### Check Backend Cookie Configuration

Verify in backend logs that cookies are being set with correct settings:

```javascript
// Should see in backend logs:
🍪 Setting cookies with config: {
  httpOnly: true,
  secure: true,  // In production
  sameSite: 'lax',
  environment: 'production'
}
```

### Check Cookie Domain

Cookies should NOT have a domain attribute (defaults to current domain):

```javascript
// ✅ CORRECT - No domain attribute
res.cookie('sb_access_token', token, {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
  // NO domain attribute
});

// ❌ WRONG - Domain attribute causes issues
res.cookie('sb_access_token', token, {
  domain: '.duhanashrah.ai',  // Don't do this
  // ...
});
```

### Check CORS Configuration

Backend CORS must allow credentials:

```javascript
cors({
  origin: 'https://pa.duhanashrah.ai',
  credentials: true,  // ✅ CRITICAL
})
```

## Expected Behavior After Fix

1. Login succeeds
2. 200ms delay allows browser to process cookies
3. Profile loads successfully
4. Dashboard stats load successfully
5. Agents list loads successfully
6. All subsequent requests include cookies

## If 200ms Delay Isn't Enough

If cookies still aren't being sent after the delay:

1. **Increase delay** to 500ms (temporary workaround)
2. **Check cookie settings** - verify domain, path, secure, sameSite
3. **Check CORS** - ensure credentials are allowed
4. **Check browser console** - look for cookie warnings
5. **Check Network tab** - verify Set-Cookie headers are present

## Alternative Solution: Poll for Cookies

If delay doesn't work, we can poll for cookies:

```typescript
// Wait for cookies to be available
let attempts = 0;
while (attempts < 10) {
  const hasCookies = document.cookie.includes('sb_access_token');
  if (hasCookies) break;
  await new Promise(resolve => setTimeout(resolve, 100));
  attempts++;
}
```

But this shouldn't be necessary - the delay should be sufficient.

## Testing

After applying the fix:

1. Clear all cookies
2. Hard refresh (Ctrl+Shift+R)
3. Login
4. Check console for:
   - "🍪 Set-Cookie header received: Yes"
   - "✅ Session cookies created"
   - Profile should load without errors
5. Navigate to dashboard
6. Check Network tab - requests should have Cookie header
7. Should get 200 OK instead of 401
