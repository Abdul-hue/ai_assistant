-- =====================================================
-- Add Authentication Error Tracking
-- Tracks authentication failures and marks accounts needing reconnection
-- =====================================================

-- Add columns to track authentication errors
ALTER TABLE email_accounts
ADD COLUMN IF NOT EXISTS last_error TEXT,
ADD COLUMN IF NOT EXISTS needs_reconnection BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_connection_attempt TIMESTAMP;

-- Index for quick lookup of accounts needing reconnection
CREATE INDEX IF NOT EXISTS idx_email_accounts_needs_reconnection 
ON email_accounts(needs_reconnection) 
WHERE needs_reconnection = TRUE;

-- Index for checking accounts with recent errors
CREATE INDEX IF NOT EXISTS idx_email_accounts_last_connection_attempt 
ON email_accounts(last_connection_attempt DESC) 
WHERE needs_reconnection = TRUE;

-- Add comment explaining the columns
COMMENT ON COLUMN email_accounts.last_error IS 'Last error message from connection attempt';
COMMENT ON COLUMN email_accounts.needs_reconnection IS 'TRUE if account needs reconnection due to authentication failure';
COMMENT ON COLUMN email_accounts.last_connection_attempt IS 'Timestamp of last connection attempt';

-- =====================================================
-- Analyze table to update statistics
-- =====================================================
ANALYZE email_accounts;

