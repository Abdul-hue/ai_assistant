-- ============================================
-- FIX WEBHOOK ENABLED FOR EXISTING ACCOUNTS
-- ============================================
-- Run this to enable webhooks for accounts that completed initial sync
-- but don't have webhook_enabled_at set
-- ============================================

-- Enable webhook for accounts that completed initial sync
UPDATE email_accounts 
SET webhook_enabled_at = NOW()
WHERE initial_sync_completed = TRUE
  AND webhook_enabled_at IS NULL;

-- Verify fix
SELECT 
    id,
    email,
    initial_sync_completed,
    webhook_enabled_at,
    last_successful_sync_at
FROM email_accounts
WHERE initial_sync_completed = TRUE;

-- Expected: All accounts should have webhook_enabled_at set

