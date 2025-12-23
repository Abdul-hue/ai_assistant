-- ============================================================================
-- MIGRATION: Add Source Column to Message Log Table
-- Created: 2025-01-XX
-- Description: Add source column to track message origin (whatsapp or dashboard)
--              Enables unified webhook system with source-based filtering
-- ============================================================================

-- Add source column to message_log table
ALTER TABLE message_log 
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'whatsapp';

-- Add index for filtering by source
CREATE INDEX IF NOT EXISTS idx_message_log_source ON message_log(source);

-- Add composite index for duplicate detection queries
-- This index optimizes queries that check for recent dashboard messages
-- Note: message_text is excluded from index due to size limitations (can be very long)
-- The query will filter by message_text in the WHERE clause after using this index
-- The index on (source, sender_phone, received_at) will narrow down results significantly
-- before filtering by message_text, making the query efficient
CREATE INDEX IF NOT EXISTS idx_message_log_duplicate_check 
ON message_log(source, sender_phone, received_at);

-- Update existing records to have source='whatsapp' for backward compatibility
UPDATE message_log 
SET source = 'whatsapp' 
WHERE source IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN message_log.source IS 'Message origin: whatsapp (external WhatsApp messages) or dashboard (internal dashboard chat messages)';

-- Verify migration
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'message_log' AND column_name = 'source'
  ) THEN
    RAISE NOTICE 'Migration successful: source column added to message_log table';
  ELSE
    RAISE EXCEPTION 'Migration failed: source column not found';
  END IF;
END $$;
