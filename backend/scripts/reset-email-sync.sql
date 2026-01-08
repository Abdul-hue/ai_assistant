-- ============================================
-- EMAIL SYNC RESET SCRIPT
-- ============================================
-- This script resets all email sync state to start fresh
-- Run this BEFORE implementing the new sync logic
-- ============================================

-- Delete ALL existing emails
DELETE FROM emails;

-- Reset sync state
DELETE FROM email_sync_state;

-- Reset initial sync flags
UPDATE email_accounts 
SET initial_sync_completed = false,
    last_successful_sync_at = NULL,
    webhook_enabled_at = NULL;

-- Verify cleanup
SELECT 
    (SELECT COUNT(*) FROM emails) as emails_count,
    (SELECT COUNT(*) FROM email_sync_state) as sync_state_count,
    (SELECT COUNT(*) FROM email_accounts WHERE initial_sync_completed = true) as accounts_with_sync_completed;

-- Expected result: All counts should be 0

