-- Add per-folder initial sync tracking
ALTER TABLE email_sync_state 
ADD COLUMN IF NOT EXISTS initial_sync_completed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS initial_sync_date TIMESTAMP;

-- Add account-level tracking
ALTER TABLE email_accounts
ADD COLUMN IF NOT EXISTS folders_synced JSONB DEFAULT '{}';

COMMENT ON COLUMN email_sync_state.initial_sync_completed IS 'Whether initial 20 emails have been fetched for this folder';
COMMENT ON COLUMN email_sync_state.initial_sync_date IS 'Timestamp when initial sync was completed for this folder';
COMMENT ON COLUMN email_accounts.folders_synced IS 'JSON object tracking which folders have been initially synced';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_email_sync_state_initial_sync 
ON email_sync_state(account_id, folder_name, initial_sync_completed);

