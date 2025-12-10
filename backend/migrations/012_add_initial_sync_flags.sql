-- ============================================================================
-- MIGRATION: Add Initial Sync Flags for Email Webhook Control
-- Created: 2025-01-09
-- Description: Add flags to track initial sync status and prevent webhook spam
--              from old emails when accounts are first connected
-- ============================================================================

-- Add initial_sync_completed column to email_accounts table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'email_accounts' AND column_name = 'initial_sync_completed'
  ) THEN
    ALTER TABLE email_accounts 
    ADD COLUMN initial_sync_completed BOOLEAN DEFAULT FALSE;
    
    RAISE NOTICE 'Column initial_sync_completed added successfully to email_accounts table';
  ELSE
    RAISE NOTICE 'Column initial_sync_completed already exists in email_accounts table';
  END IF;
END $$;

-- Add webhook_enabled_at column to email_accounts table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'email_accounts' AND column_name = 'webhook_enabled_at'
  ) THEN
    ALTER TABLE email_accounts 
    ADD COLUMN webhook_enabled_at TIMESTAMP;
    
    RAISE NOTICE 'Column webhook_enabled_at added successfully to email_accounts table';
  ELSE
    RAISE NOTICE 'Column webhook_enabled_at already exists in email_accounts table';
  END IF;
END $$;

-- Set existing accounts as already synced to avoid breaking current behavior
-- This ensures backward compatibility - existing accounts will continue receiving webhooks
UPDATE email_accounts 
SET initial_sync_completed = TRUE, 
    webhook_enabled_at = COALESCE(created_at, NOW())
WHERE initial_sync_completed IS NULL OR initial_sync_completed = FALSE;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_email_accounts_initial_sync 
ON email_accounts(initial_sync_completed, webhook_enabled_at) 
WHERE initial_sync_completed = FALSE;

-- Add comments for documentation
COMMENT ON COLUMN email_accounts.initial_sync_completed IS 
'Whether the initial email sync has completed. FALSE means webhooks are disabled until first sync completes.';

COMMENT ON COLUMN email_accounts.webhook_enabled_at IS 
'Timestamp when webhooks were enabled (after initial sync). Only emails received after this time will trigger webhooks.';

