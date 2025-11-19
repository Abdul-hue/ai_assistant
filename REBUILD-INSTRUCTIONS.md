# Rebuild Instructions - CORS Fix Applied

## ✅ Code Fix Complete

The CORS configuration has been fixed in `backend/app.js`. The fix allows same-origin requests (browser loading frontend from the same server) without requiring an Origin header.

## 🔧 Rebuild Steps

### Step 1: Set Environment Variables
```powershell
$env:SUPABASE_URL = "https://dieozzsqexhptpfwrhxk.supabase.co"
$env:SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZW96enNxZXhocHRwZndyaHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5MjM5MTIsImV4cCI6MjA3NjQ5OTkxMn0.u_bJIYqBIlAJU9_GeAApI3Rnf6TPhtIuN68yyJbFLgU"
```

### Step 2: Rebuild Container
```powershell
docker-compose build --no-cache
```

### Step 3: Start Container
```powershell
docker-compose up -d
```

### Step 4: Verify
```powershell
# Check status
docker-compose ps

# Test frontend
# Open browser: http://localhost:3001/
# Should load without "Origin header required" error
```

## 🐛 If Docker Access Denied

If you get "Access is denied" errors:

1. **Run PowerShell as Administrator**
2. **Or restart Docker Desktop**
3. **Or check Docker Desktop is running**

## 📝 What Was Fixed

**File:** `backend/app.js` lines 132-155

**Change:** Removed production check that blocked same-origin requests without Origin header.

**Result:** Frontend at `http://localhost:3001/` will now load correctly.

---

**Status:** Code fix complete - Ready for rebuild

