# Phase 1 Quick Reference Card

## 🚀 Deployment (3 Commands)

```bash
# 1. Run migration
psql -U your_user -d your_database -f backend/migrations/011_add_disconnected_at.sql

# 2. Pull code
git pull origin main

# 3. Restart service
pm2 restart all
```

## ✅ Quick Test (2 Minutes)

1. **Disconnect agent** → Watch logs for: `✅ All critical cleanup steps succeeded`
2. **Check database:**
   ```sql
   SELECT status, session_data, disconnected_at 
   FROM whatsapp_sessions 
   WHERE agent_id = 'your-agent-id';
   -- Expected: status='disconnected', session_data=NULL, disconnected_at=timestamp
   ```
3. **Reconnect immediately** → Should generate fresh QR (no cooldown)

## 🔍 Key Log Messages

**Success:**
- `✅ All critical cleanup steps succeeded`
- `✅ Credentials validated: Fresh and valid`
- `🎯 QR CODE RECEIVED!`

**Errors (watch for):**
- `❌ Bad MAC Error` → Credentials not cleared
- `❌ 401` after disconnect → Logout may have failed
- `🚫 Auto-retry blocked` after disconnect → Cooldown not cleared (Phase 2 will fix)

## 🔄 Rollback (< 2 min)

```bash
git revert HEAD && pm2 restart all
```

## 📊 Database Verification

```sql
-- Check disconnect state
SELECT agent_id, status, session_data, disconnected_at 
FROM whatsapp_sessions 
WHERE agent_id = 'your-agent-id';

-- Should show: status='disconnected', session_data=NULL, disconnected_at=timestamp
```

## 📁 Files Changed

- `backend/src/services/baileysService.js` (main changes)
- `backend/migrations/011_add_disconnected_at.sql` (new)

## 📚 Full Documentation

- **Deployment:** `PHASE1_DEPLOYMENT_CHECKLIST.md`
- **Testing:** `PHASE1_TESTING_GUIDE.md`
- **Summary:** `PHASE1_SUMMARY.md`

