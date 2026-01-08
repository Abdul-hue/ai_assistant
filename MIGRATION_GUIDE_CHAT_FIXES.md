# 🚀 Migration Guide - Chat Interface Database Fixes

## Quick Start

### Step 1: Run Database Migration

**Option A: Via Supabase Dashboard (Recommended)**
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open the file: `backend/migrations/011_fix_message_log_chat_schema.sql`
4. Copy the entire SQL content
5. Paste into SQL Editor
6. Click **Run** or press `Ctrl+Enter`

**Option B: Via Command Line**
```bash
# If you have psql installed and DATABASE_URL set:
psql $DATABASE_URL -f backend/migrations/011_fix_message_log_chat_schema.sql

# Or using Supabase CLI:
supabase db push
```

### Step 2: Verify Migration Success

Run this query in Supabase SQL Editor:
```sql
-- Check new columns exist
SELECT 
  column_name, 
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'message_log' 
AND column_name IN ('timestamp', 'status', 'sender_type', 'is_from_me', 'read_at', 'id', 'whatsapp_message_id', 'contact_id')
ORDER BY column_name;
```

Expected result: 8 rows (all new columns)

### Step 3: Check Data Migration

```sql
-- Verify data was migrated
SELECT 
  COUNT(*) as total_messages,
  COUNT(timestamp) as with_timestamp,
  COUNT(sender_type) as with_sender_type,
  COUNT(id) as with_uuid_id
FROM message_log;
```

All counts should match (or be very close if some rows have NULLs).

### Step 4: Check Indexes

```sql
-- Verify indexes were created
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'message_log' 
AND indexname LIKE 'idx_message_log%'
ORDER BY indexname;
```

Expected: 9 indexes

### Step 5: Restart Backend

```bash
# Stop and restart your backend server
npm run dev
# or
pm2 restart pa-agent-backend
```

### Step 6: Test Chat Interface

1. Navigate to Dashboard in your frontend
2. Scroll to "Agent Chat" section
3. Verify:
   - ✅ No console errors about missing columns
   - ✅ Messages load correctly
   - ✅ Professional styling (white/gray, not dark/colorful)
   - ✅ Can send messages
   - ✅ Agent responses appear

---

## Troubleshooting

### Error: "column timestamp does not exist"
**Solution:** Migration hasn't been run. Go to Step 1.

### Error: "duplicate key value violates unique constraint"
**Solution:** The `id` column might have conflicts. Check:
```sql
SELECT id, message_id, COUNT(*) 
FROM message_log 
GROUP BY id, message_id 
HAVING COUNT(*) > 1;
```

If duplicates exist, regenerate UUIDs:
```sql
UPDATE message_log 
SET id = gen_random_uuid() 
WHERE id IN (
  SELECT id FROM message_log 
  GROUP BY id 
  HAVING COUNT(*) > 1
);
```

### Messages not loading
**Check:**
1. Backend logs for errors
2. Network tab for API errors
3. Database connection is working
4. Migration completed successfully

### Styling looks wrong
**Check:**
1. Frontend build is up to date
2. Browser cache cleared
3. All component files were updated

---

## Rollback (If Needed)

If you need to rollback the migration:

```sql
-- Remove new columns (WARNING: This will lose data in new columns)
ALTER TABLE message_log
  DROP COLUMN IF EXISTS timestamp,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS sender_type,
  DROP COLUMN IF EXISTS is_from_me,
  DROP COLUMN IF EXISTS contact_id,
  DROP COLUMN IF EXISTS whatsapp_message_id,
  DROP COLUMN IF EXISTS read_at,
  DROP COLUMN IF EXISTS id;

-- Remove indexes
DROP INDEX IF EXISTS idx_message_log_timestamp;
DROP INDEX IF EXISTS idx_message_log_agent_timestamp;
DROP INDEX IF EXISTS idx_message_log_user_timestamp;
DROP INDEX IF EXISTS idx_message_log_sender_type;
DROP INDEX IF EXISTS idx_message_log_is_from_me;
DROP INDEX IF EXISTS idx_message_log_read_at;
DROP INDEX IF EXISTS idx_message_log_contact_id;
DROP INDEX IF EXISTS idx_message_log_status;
DROP INDEX IF EXISTS idx_message_log_chat_list;

-- Remove trigger
DROP TRIGGER IF EXISTS trigger_update_message_log_timestamp ON message_log;
DROP FUNCTION IF EXISTS update_message_log_timestamp();
```

**Note:** This will NOT affect existing data in legacy columns (`message_text`, `received_at`, `message_id`, etc.)

---

## Post-Migration Checklist

- [ ] Migration SQL executed successfully
- [ ] All new columns exist in database
- [ ] Data migration completed (timestamp populated)
- [ ] Indexes created successfully
- [ ] Trigger function created
- [ ] Backend restarted
- [ ] Chat interface loads without errors
- [ ] Messages display correctly
- [ ] Can send new messages
- [ ] Professional styling appears correctly
- [ ] No console errors

---

**Migration File:** `backend/migrations/011_fix_message_log_chat_schema.sql`
**Status:** Ready to execute

