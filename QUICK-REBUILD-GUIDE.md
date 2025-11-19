# Quick Rebuild Guide

## 🚀 One-Command Rebuild

```powershell
.\rebuild-docker.ps1
```

## ✅ Quick Verification

```powershell
.\verify-docker-env.ps1
```

## 📋 Manual Commands (If Scripts Don't Work)

```powershell
# Stop
docker-compose down

# Rebuild
docker-compose build --no-cache

# Start
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

## 🔍 Quick Health Check

```powershell
curl http://localhost:3001/api/health
```

**Expected:** `{"status":"ok",...}`

## ⚠️ If Issues Persist

1. Verify `backend/.env` exists and has all variables
2. Check logs: `docker-compose logs --tail=50`
3. Verify Docker Compose syntax: `docker-compose config`

---

**Full Documentation:** See `DOCKER-FIX-SUMMARY.md`

