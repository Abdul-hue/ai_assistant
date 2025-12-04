# Phase 1 Deployment Checklist

## Pre-Deployment (5 minutes)

- [ ] **Backup database**
  ```bash
  pg_dump -U your_user your_database > backup_before_phase1_$(date +%Y%m%d_%H%M%S).sql
  ```

- [ ] **Backup code**
  ```bash
  git tag backup-before-phase1-$(date +%Y%m%d)
  git push origin backup-before-phase1-$(date +%Y%m%d)
  ```

- [ ] **Verify code changes are present**
  ```bash
  grep -c "disconnected_at" backend/src/services/baileysService.js
  grep -c "validateCredentialFreshness" backend/src/services/baileysService.js
  # Should return: 2 or more
  ```

- [ ] **Check current active sessions**
  ```sql
  SELECT COUNT(*) FROM whatsapp_sessions WHERE is_active = true;
  -- Note: You may want to disconnect all agents first (optional)
  ```

---

## Deployment Steps (10 minutes)

### Step 1: Run Database Migration
```bash
# Option A: Via psql
psql -U your_user -d your_database -f backend/migrations/011_add_disconnected_at.sql

# Option B: Via Supabase Dashboard
# 1. Go to SQL Editor
# 2. Copy/paste contents of backend/migrations/011_add_disconnected_at.sql
# 3. Execute
```

**Verify:**
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'whatsapp_sessions' 
AND column_name = 'disconnected_at';
-- Should return: disconnected_at
```

### Step 2: Deploy Code
```bash
# Pull latest code
git pull origin main

# Verify files
ls -la backend/src/services/baileysService.js
ls -la backend/migrations/011_add_disconnected_at.sql
```

### Step 3: Restart Service
```bash
# PM2
pm2 restart all
# OR
pm2 restart your-app-name

# Systemd
systemctl restart your-service-name

# Manual Node.js
# Stop current process, then:
node backend/server.js
```

### Step 4: Verify Service Started
```bash
# Check logs
pm2 logs
# OR
tail -f /var/log/your-service.log

# Look for:
# [BAILEYS] ========== INSTANCE INFORMATION ==========
# [BAILEYS] Instance ID: ...
```

---

## Post-Deployment Verification (5 minutes)

- [ ] **Check service is running**
  ```bash
  pm2 status
  # OR
  systemctl status your-service-name
  ```

- [ ] **Test health endpoint** (if available)
  ```bash
  curl http://localhost:PORT/health
  ```

- [ ] **Monitor logs for errors**
  ```bash
  tail -f /path/to/logs | grep -i "error\|critical\|failed"
  ```

- [ ] **Verify database connection**
  ```sql
  SELECT NOW();
  -- Should return current timestamp
  ```

---

## Immediate Testing (15 minutes)

Follow **Test 1** from `PHASE1_TESTING_GUIDE.md`:

1. [ ] Disconnect one test agent
2. [ ] Verify all 8 cleanup steps in logs
3. [ ] Check database state
4. [ ] Reconnect immediately
5. [ ] Verify fresh QR generates

**If Test 1 passes:** ✅ Phase 1 is working!

**If Test 1 fails:** ⚠️ See Troubleshooting in `PHASE1_TESTING_GUIDE.md`

---

## Rollback (If Needed)

### Quick Rollback (< 2 minutes)
```bash
# 1. Revert code
git revert HEAD
# OR
git reset --hard backup-before-phase1-YYYYMMDD

# 2. Restart service
pm2 restart all

# 3. (Optional) Remove column
psql -U your_user -d your_database -c "
ALTER TABLE whatsapp_sessions DROP COLUMN IF EXISTS disconnected_at;
"
```

**Note:** Code will work without the column (graceful degradation), so rollback is optional.

---

## Monitoring (First 24 Hours)

Watch for:

- ✅ **Disconnect success rate:** Should be 100%
- ✅ **Reconnection success rate:** Should be 100%
- ✅ **Bad MAC errors:** Should be 0
- ✅ **401 errors after disconnect:** Should be 0
- ✅ **Cooldown after manual disconnect:** Should be 0

**Log monitoring:**
```bash
# Watch for success patterns
tail -f /path/to/logs | grep -E "DISCONNECT COMPLETE|All critical cleanup steps succeeded"

# Watch for errors
tail -f /path/to/logs | grep -E "❌|Failed|Error"
```

---

## Success Criteria

Phase 1 is successful if:

- ✅ Database migration completes without errors
- ✅ Service restarts without errors
- ✅ Test 1 (Disconnect → Reconnect) passes
- ✅ No Bad MAC errors in first 24 hours
- ✅ No 401 errors after manual disconnects
- ✅ Fresh QR codes generate immediately after disconnect

---

## Next Steps

Once Phase 1 is verified working:

1. ✅ Complete full testing checklist (all 5 tests)
2. ✅ Monitor production for 24-48 hours
3. ✅ Proceed to Phase 2 (Cooldown Bypass)
4. ✅ Document any edge cases found

---

## Emergency Contacts

If critical issues occur:

1. **Immediate:** Rollback using steps above
2. **Check logs:** `tail -f /path/to/logs`
3. **Check database:** Verify `whatsapp_sessions` table state
4. **Check file system:** Verify auth directories are cleaned

---

## Notes

- **Low Risk:** Code includes graceful degradation (works without `disconnected_at` column)
- **Backward Compatible:** Existing sessions continue to work
- **Non-Breaking:** No API changes, only internal improvements
- **Safe to Deploy:** Can rollback without data loss

