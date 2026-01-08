-- ============================================================================
-- MIGRATION: Add disconnected_at Column for Manual Disconnect Tracking
-- Created: 2025-01-XX
-- Description: Add disconnected_at timestamp to track when manual disconnects occur
--              This enables Phase 1 fixes to distinguish manual vs error disconnects
-- ============================================================================

-- Add disconnected_at column to whatsapp_sessions table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'whatsapp_sessions' AND column_name = 'disconnected_at'
  ) THEN
    ALTER TABLE whatsapp_sessions 
    ADD COLUMN disconnected_at TIMESTAMP;
    
    -- Add index for efficient queries on disconnected_at
    CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_disconnected_at 
    ON whatsapp_sessions(disconnected_at) 
    WHERE disconnected_at IS NOT NULL;
    
    -- Add comment for documentation
    COMMENT ON COLUMN whatsapp_sessions.disconnected_at IS 
    'Timestamp when session was manually disconnected. NULL if never disconnected or disconnected due to error.';
    
    RAISE NOTICE 'Column disconnected_at added successfully to whatsapp_sessions table';
  ELSE
    RAISE NOTICE 'Column disconnected_at already exists in whatsapp_sessions table';
  END IF;
END $$;

