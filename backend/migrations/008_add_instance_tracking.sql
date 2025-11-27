-- ============================================================================
-- MIGRATION: Add Instance Tracking for Multi-Instance Prevention
-- Created: 2025-11-27
-- Description: Add instance tracking to prevent multiple servers from using same agent
-- ============================================================================

-- Add instance tracking columns to whatsapp_sessions table
ALTER TABLE whatsapp_sessions 
ADD COLUMN IF NOT EXISTS instance_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS instance_hostname VARCHAR(255),
ADD COLUMN IF NOT EXISTS instance_pid INTEGER,
ADD COLUMN IF NOT EXISTS instance_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP;

-- Add index for instance lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_instance_id 
ON whatsapp_sessions(instance_id) 
WHERE instance_id IS NOT NULL;

-- Add index for heartbeat monitoring
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_last_heartbeat 
ON whatsapp_sessions(last_heartbeat) 
WHERE is_active = true;

-- Add status column if it doesn't exist (for better status tracking)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'whatsapp_sessions' AND column_name = 'status'
  ) THEN
    ALTER TABLE whatsapp_sessions ADD COLUMN status VARCHAR(50) DEFAULT 'disconnected';
  END IF;
END $$;

-- Add qr_generated_at if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'whatsapp_sessions' AND column_name = 'qr_generated_at'
  ) THEN
    ALTER TABLE whatsapp_sessions ADD COLUMN qr_generated_at TIMESTAMP;
  END IF;
END $$;

-- Add session_data column if it doesn't exist (for credential storage)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'whatsapp_sessions' AND column_name = 'session_data'
  ) THEN
    ALTER TABLE whatsapp_sessions ADD COLUMN session_data JSONB;
  END IF;
END $$;

-- Add constraint to ensure status values are valid
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'whatsapp_sessions_status_check'
  ) THEN
    ALTER TABLE whatsapp_sessions 
    ADD CONSTRAINT whatsapp_sessions_status_check 
    CHECK (status IN ('disconnected', 'connecting', 'qr_pending', 'connected', 'conflict', 'error', 'initializing'));
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN whatsapp_sessions.instance_id IS 'Unique identifier for the server instance using this session';
COMMENT ON COLUMN whatsapp_sessions.instance_hostname IS 'Hostname of the server instance';
COMMENT ON COLUMN whatsapp_sessions.instance_pid IS 'Process ID of the server instance';
COMMENT ON COLUMN whatsapp_sessions.instance_started_at IS 'When the instance started using this session';
COMMENT ON COLUMN whatsapp_sessions.last_heartbeat IS 'Last heartbeat timestamp from the instance';

