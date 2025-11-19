# Frontend Environment Variables Fix

## Issue
Frontend was showing error: `Uncaught Error: supabaseUrl is required.`

## Root Cause
The frontend React app needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at **build time** (when Vite compiles the app), but these were not available during the Docker build process.

## Solution Applied

### 1. Updated Dockerfile
- Added build arguments: `ARG VITE_SUPABASE_URL` and `ARG VITE_SUPABASE_PUBLISHABLE_KEY`
- Set them as environment variables: `ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL`
- These are now available during `npm run build`

### 2. Updated docker-compose.yml
- Added build args that read from `backend/.env`:
  ```yaml
  build:
    args:
      VITE_SUPABASE_URL: ${SUPABASE_URL}
      VITE_SUPABASE_PUBLISHABLE_KEY: ${SUPABASE_ANON_KEY}
  ```

### 3. Updated .dockerignore
- Allowed root `.env` file (though we're using build args now, not copying .env)

## How It Works

1. **docker-compose** reads `backend/.env` via `env_file` directive
2. **Build args** extract `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the loaded environment
3. **Dockerfile** receives them as build arguments
4. **Vite build** uses them to compile the frontend with correct Supabase configuration
5. **Frontend** now has Supabase URL and key baked into the build

## Verification

After rebuild, the frontend should:
- ✅ Load without "supabaseUrl is required" error
- ✅ Successfully initialize Supabase client
- ✅ Connect to Supabase for authentication

## Files Modified

1. **Dockerfile** - Added build args and ENV variables
2. **docker-compose.yml** - Added build args section
3. **.dockerignore** - Updated to allow .env (though using build args is preferred)

## Rebuild Command

```powershell
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

**Status:** ✅ Fixed - Frontend now has Supabase configuration at build time

