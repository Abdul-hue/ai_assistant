-- =====================================================
-- Enhanced IMAP/SMTP Sync System - Database Migration
-- =====================================================
-- This migration adds UID-based syncing, folder management,
-- and real-time monitoring support

-- =====================================================
-- 1. CREATE SYNC STATE TABLE (Track syncing progress per folder)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  folder_name TEXT NOT NULL,
  last_uid_synced INTEGER DEFAULT 0,
  total_server_count INTEGER DEFAULT 0,
  highest_modseq BIGINT DEFAULT 0, -- For CONDSTORE support (optional)
  last_sync_at TIMESTAMP WITH TIME ZONE,
  sync_errors_count INTEGER DEFAULT 0,
  last_error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(account_id, folder_name)
);

-- Indexes for email_sync_state
CREATE INDEX IF NOT EXISTS idx_sync_state_account_folder ON email_sync_state(account_id, folder_name);
CREATE INDEX IF NOT EXISTS idx_sync_state_last_sync ON email_sync_state(last_sync_at DESC);

-- =====================================================
-- 2. CREATE SYNC LOGS TABLE (For debugging)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
  folder_name TEXT,
  sync_type TEXT DEFAULT 'incremental', -- 'incremental' or 'full'
  emails_fetched INTEGER DEFAULT 0,
  emails_saved INTEGER DEFAULT 0,
  emails_updated INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  duration_ms INTEGER,
  error_details TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for email_sync_logs
CREATE INDEX IF NOT EXISTS idx_sync_logs_account_date ON email_sync_logs(account_id, created_at DESC);

-- =====================================================
-- 3. UPDATE EMAIL_ACCOUNTS TABLE (Track sync status)
-- =====================================================
ALTER TABLE email_accounts 
ADD COLUMN IF NOT EXISTS last_successful_sync_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'idle', -- 'idle', 'syncing', 'error'
ADD COLUMN IF NOT EXISTS sync_error_details TEXT,
ADD COLUMN IF NOT EXISTS provider_type VARCHAR(50) DEFAULT 'imap_smtp'; -- 'gmail', 'imap_smtp'

-- =====================================================
-- 4. UPDATE EMAILS TABLE (Add critical columns)
-- =====================================================
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS uid INTEGER,
ADD COLUMN IF NOT EXISTS folder_name TEXT DEFAULT 'INBOX',
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS attachments_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS attachments_meta JSONB;

-- Update existing emails to have folder_name = 'INBOX' if null
UPDATE emails SET folder_name = 'INBOX' WHERE folder_name IS NULL;

-- =====================================================
-- 5. CREATE CRITICAL INDEXES (For performance)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_emails_account_folder_received 
  ON emails(email_account_id, folder_name, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_account_uid_folder 
  ON emails(email_account_id, uid, folder_name);

CREATE INDEX IF NOT EXISTS idx_emails_account_is_read_received 
  ON emails(email_account_id, is_read, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_account_is_starred 
  ON emails(email_account_id, is_starred, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_account_is_deleted 
  ON emails(email_account_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_emails_folder_search 
  ON emails(email_account_id, folder_name) 
  WHERE is_deleted = false;

-- =====================================================
-- 6. UPDATE TIMESTAMP FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION update_emails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS emails_update_timestamp ON emails;
CREATE TRIGGER emails_update_timestamp
  BEFORE UPDATE ON emails
  FOR EACH ROW
  EXECUTE FUNCTION update_emails_updated_at();

-- =====================================================
-- 7. ROW LEVEL SECURITY (Update policies)
-- =====================================================
-- Ensure RLS is enabled
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read their own emails" ON emails;
DROP POLICY IF EXISTS "Users can update their own emails" ON emails;

-- Create updated policies
CREATE POLICY "Users can read their own emails"
  ON emails FOR SELECT
  USING (
    email_account_id IN (
      SELECT id FROM email_accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own emails"
  ON emails FOR UPDATE
  USING (
    email_account_id IN (
      SELECT id FROM email_accounts WHERE user_id = auth.uid()
    )
  );

-- RLS for email_sync_state
ALTER TABLE email_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own sync state"
  ON email_sync_state FOR SELECT
  USING (
    account_id IN (
      SELECT id FROM email_accounts WHERE user_id = auth.uid()
    )
  );

-- RLS for email_sync_logs
ALTER TABLE email_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own sync logs"
  ON email_sync_logs FOR SELECT
  USING (
    account_id IN (
      SELECT id FROM email_accounts WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- Migration Complete
-- =====================================================

