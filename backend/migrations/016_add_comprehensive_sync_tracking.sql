-- Track account-level comprehensive sync (not per-folder)
ALTER TABLE email_accounts
ADD COLUMN IF NOT EXISTS comprehensive_sync_completed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS comprehensive_sync_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS comprehensive_sync_completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS comprehensive_sync_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS comprehensive_sync_progress JSONB DEFAULT '{}';

-- Status: 'pending', 'in_progress', 'completed', 'failed'
-- Progress JSON example:
-- {
--   "INBOX": {"status": "completed", "count": 20, "completed_at": "2024-01-15T10:30:00Z"},
--   "[Gmail]/Sent Mail": {"status": "completed", "count": 18},
--   "[Gmail]/Spam": {"status": "in_progress"}
-- }

COMMENT ON COLUMN email_accounts.comprehensive_sync_completed IS 'Whether all folders synced at least once';
COMMENT ON COLUMN email_accounts.comprehensive_sync_status IS 'pending | in_progress | completed | failed';
COMMENT ON COLUMN email_accounts.comprehensive_sync_progress IS 'Per-folder sync progress tracking';

CREATE INDEX IF NOT EXISTS idx_email_accounts_comprehensive_sync 
ON email_accounts(comprehensive_sync_completed, comprehensive_sync_status);

