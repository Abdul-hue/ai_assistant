# Fix: Environment Variables Not Loading

## Issue
Container "awesome_mestorf" (or similar auto-generated names) is failing with missing Supabase environment variables.

## Root Cause
The container was likely started **manually** using `docker run` instead of `docker-compose up`, so it doesn't have access to the `env_file` configuration.

## Solution

### ✅ Use Docker Compose (Recommended)

**Always use docker-compose to start the container:**

```powershell
# Navigate to project root
cd "C:\Users\Sam Cliff\Desktop\connectbot-ai-main"

# Stop any manually started containers
docker stop awesome_mestorf 2>$null
docker rm awesome_mestorf 2>$null

# Use docker-compose (this loads env_file automatically)
docker-compose down
docker-compose up -d

# Verify it's working
docker-compose logs -f
```

### ❌ Don't Use `docker run` Directly

**This WON'T work** (doesn't load env_file):
```powershell
docker run connectbot-ai-main-connectbot-ai:latest
```

### ✅ Check Which Container to Use

**Correct container name:** `connectbot-ai` (from docker-compose.yml)

**Wrong container names:** `awesome_mestorf`, `vigorous_wozniak`, etc. (auto-generated)

## Verification

```powershell
# Check running containers
docker-compose ps

# Should show:
# NAME            STATUS
# connectbot-ai   Up (healthy)

# Check environment variables in container
docker-compose exec connectbot-ai env | Select-String "SUPABASE"

# Should show all three variables
```

## Quick Fix Commands

```powershell
# 1. Stop all containers
docker-compose down

# 2. Remove any manually started containers
docker ps -a --format "{{.Names}}" | Where-Object { $_ -notmatch "connectbot-ai" } | ForEach-Object { docker rm -f $_ }

# 3. Start with docker-compose
docker-compose up -d

# 4. Verify
docker-compose logs --tail=50 | Select-String "Supabase Configuration"
```

## Why This Happens

- **docker-compose** reads `env_file: - ./backend/.env` and loads variables automatically
- **docker run** doesn't read docker-compose.yml, so no env_file is loaded
- Auto-generated container names (like "awesome_mestorf") indicate manual `docker run` usage

## Always Use Docker Compose

```powershell
# ✅ Correct way
docker-compose up -d

# ❌ Wrong way
docker run connectbot-ai-main-connectbot-ai:latest
```

