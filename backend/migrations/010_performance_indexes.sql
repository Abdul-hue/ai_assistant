-- =====================================================
-- Performance Optimization Indexes
-- Adds critical indexes for fast email loading
-- =====================================================

-- ✅ Speed up email queries by account/folder/date (MOST CRITICAL)
CREATE INDEX IF NOT EXISTS idx_emails_account_folder_date 
ON emails(email_account_id, folder_name, received_at DESC NULLS LAST);

-- ✅ Speed up sync state lookups
CREATE INDEX IF NOT EXISTS idx_sync_state_account_folder 
ON email_sync_state(account_id, folder_name);

-- ✅ Speed up unread counts and filtering
CREATE INDEX IF NOT EXISTS idx_emails_account_is_read_received 
ON emails(email_account_id, is_read, received_at DESC NULLS LAST);

-- ✅ Speed up starred emails
CREATE INDEX IF NOT EXISTS idx_emails_account_is_starred_received 
ON emails(email_account_id, is_starred, received_at DESC NULLS LAST);

-- ✅ Partial index for recent emails (most commonly accessed)
-- Only indexes emails from last 30 days for faster queries
CREATE INDEX IF NOT EXISTS idx_emails_recent 
ON emails(email_account_id, folder_name, received_at DESC) 
WHERE received_at > NOW() - INTERVAL '30 days';

-- ✅ Speed up account lookups by user and email
CREATE INDEX IF NOT EXISTS idx_accounts_user_email_active 
ON email_accounts(user_id, email, is_active) 
WHERE is_active = true;

-- ✅ Speed up UID lookups for incremental sync
CREATE INDEX IF NOT EXISTS idx_emails_account_uid_folder 
ON emails(email_account_id, uid, folder_name);

-- ✅ Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_emails_account_folder_uid 
ON emails(email_account_id, folder_name, uid DESC);

-- ✅ Speed up subject searches (if needed in future)
CREATE INDEX IF NOT EXISTS idx_emails_subject_trgm 
ON emails USING gin (subject gin_trgm_ops);

-- Note: gin_trgm_ops requires pg_trgm extension
-- Run this if you want full-text search: CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================
-- Analyze tables to update statistics
-- =====================================================
ANALYZE emails;
ANALYZE email_accounts;
ANALYZE email_sync_state;

