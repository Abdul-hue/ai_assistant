-- =====================================================
-- Fix message_log Table Schema for Chat Interface
-- =====================================================
-- This migration adds missing columns needed for the chat interface
-- and migrates existing data to new column structure
-- 
-- Current schema uses:
--   - message_id (varchar) as primary identifier
--   - sender_phone (varchar) for sender
--   - message_text (text) for content
--   - received_at (timestamptz) for timestamp
--
-- New columns needed:
--   - timestamp (timestamptz) - alias/synonym for received_at
--   - status (text) - message status
--   - sender_type (text) - 'user', 'agent', 'contact'
--   - is_from_me (boolean) - whether message is from user
--   - contact_id (varchar) - contact identifier
--   - whatsapp_message_id (text) - WhatsApp message ID (alias for message_id)
--   - read_at (timestamptz) - read receipt timestamp
--   - id (uuid) - new UUID primary key (for chat interface compatibility)

-- =====================================================
-- 1. ADD NEW COLUMNS
-- =====================================================

-- Add timestamp column (synonym for received_at, will be populated from received_at)
ALTER TABLE message_log
  ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITH TIME ZONE;

-- Add status column for message delivery status
ALTER TABLE message_log
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';

-- Add sender_type column ('user', 'agent', 'contact')
ALTER TABLE message_log
  ADD COLUMN IF NOT EXISTS sender_type TEXT;

-- Add is_from_me column (boolean)
ALTER TABLE message_log
  ADD COLUMN IF NOT EXISTS is_from_me BOOLEAN DEFAULT false;

-- Add contact_id column
ALTER TABLE message_log
  ADD COLUMN IF NOT EXISTS contact_id VARCHAR(255);

-- Add whatsapp_message_id column (alias for message_id)
ALTER TABLE message_log
  ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;

-- Add read_at column for read receipts
ALTER TABLE message_log
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;

-- Add uuid_id column (UUID) for chat interface compatibility
-- Note: If id already exists as integer, we'll use uuid_id instead
-- The backend will map uuid_id to 'id' in API responses
-- Check if id column exists and is integer type
DO $$
BEGIN
  -- Check if id column exists and is integer type
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'message_log' 
    AND column_name = 'id' 
    AND data_type = 'integer'
  ) THEN
    -- id exists as integer, create uuid_id instead
    ALTER TABLE message_log
      ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();
  ELSE
    -- id doesn't exist or is not integer, try to add it as UUID
    -- If it fails, we'll catch it and use uuid_id
    BEGIN
      ALTER TABLE message_log
        ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
    EXCEPTION WHEN OTHERS THEN
      -- If adding id fails, use uuid_id instead
      ALTER TABLE message_log
        ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();
    END;
  END IF;
END $$;

-- =====================================================
-- 2. MIGRATE EXISTING DATA
-- =====================================================

-- Populate timestamp from received_at (or created_at if received_at is null)
UPDATE message_log
SET timestamp = COALESCE(received_at, created_at)
WHERE timestamp IS NULL;

-- Populate whatsapp_message_id from message_id
UPDATE message_log
SET whatsapp_message_id = message_id
WHERE whatsapp_message_id IS NULL AND message_id IS NOT NULL;

-- Set default status for existing messages
UPDATE message_log
SET status = 'delivered'
WHERE status IS NULL;

-- Infer sender_type and is_from_me from existing data
-- If sender_phone matches agent's WhatsApp number, it's from contact (not from me)
-- Otherwise, we need to check if it's from the user or agent
-- For now, set default: if sender_phone exists and doesn't match agent, it's from contact
-- This is a heuristic - may need adjustment based on actual data patterns
UPDATE message_log ml
SET 
  sender_type = CASE
    WHEN ml.sender_phone IS NULL THEN 'agent'
    ELSE 'contact'
  END,
  is_from_me = CASE
    WHEN ml.sender_phone IS NULL THEN false
    ELSE false  -- Default: messages with sender_phone are from contacts (not from user)
  END
WHERE sender_type IS NULL;

-- Generate UUIDs for existing rows that don't have one
-- Use uuid_id if id is integer, otherwise use id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'message_log' 
    AND column_name = 'uuid_id'
  ) THEN
    -- uuid_id column exists, populate it
    UPDATE message_log
    SET uuid_id = gen_random_uuid()
    WHERE uuid_id IS NULL;
  ELSIF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'message_log' 
    AND column_name = 'id' 
    AND data_type = 'uuid'
  ) THEN
    -- id exists as UUID, populate it
    UPDATE message_log
    SET id = gen_random_uuid()
    WHERE id IS NULL;
  END IF;
END $$;

-- =====================================================
-- 3. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

-- Index on timestamp for message ordering
CREATE INDEX IF NOT EXISTS idx_message_log_timestamp 
  ON message_log(timestamp DESC);

-- Index on agent_id and timestamp for chat queries
CREATE INDEX IF NOT EXISTS idx_message_log_agent_timestamp 
  ON message_log(agent_id, timestamp DESC);

-- Index on user_id and timestamp
CREATE INDEX IF NOT EXISTS idx_message_log_user_timestamp 
  ON message_log(user_id, timestamp DESC);

-- Index on sender_type for filtering
CREATE INDEX IF NOT EXISTS idx_message_log_sender_type 
  ON message_log(sender_type);

-- Index on is_from_me for filtering
CREATE INDEX IF NOT EXISTS idx_message_log_is_from_me 
  ON message_log(is_from_me);

-- Index on read_at for unread count queries
CREATE INDEX IF NOT EXISTS idx_message_log_read_at 
  ON message_log(read_at) WHERE read_at IS NULL;

-- Index on contact_id
CREATE INDEX IF NOT EXISTS idx_message_log_contact_id 
  ON message_log(contact_id) WHERE contact_id IS NOT NULL;

-- Index on status
CREATE INDEX IF NOT EXISTS idx_message_log_status 
  ON message_log(status);

-- Composite index for chat list queries (agent_id, sender_type, read_at)
CREATE INDEX IF NOT EXISTS idx_message_log_chat_list 
  ON message_log(agent_id, sender_type, read_at, timestamp DESC);

-- =====================================================
-- 4. SET DEFAULT VALUES FOR NEW COLUMNS
-- =====================================================

-- Set default timestamp trigger (populate from received_at if not set)
-- This function handles both cases: uuid_id (when id is integer) or id (when id is UUID)
-- We'll create two versions of the trigger function based on which column exists
DO $$
DECLARE
  has_uuid_id_col BOOLEAN;
  id_is_uuid BOOLEAN;
BEGIN
  -- Check if uuid_id column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'message_log' 
    AND column_name = 'uuid_id'
  ) INTO has_uuid_id_col;
  
  -- Check if id is UUID type
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'message_log' 
    AND column_name = 'id' 
    AND data_type = 'uuid'
  ) INTO id_is_uuid;
  
  -- Create appropriate trigger function
  IF has_uuid_id_col THEN
    -- uuid_id exists (id is integer) - use uuid_id
    EXECUTE '
    CREATE OR REPLACE FUNCTION update_message_log_timestamp()
    RETURNS TRIGGER AS $func$
    BEGIN
      IF NEW.timestamp IS NULL THEN
        NEW.timestamp = COALESCE(NEW.received_at, NEW.created_at, NOW());
      END IF;
      IF NEW.whatsapp_message_id IS NULL AND NEW.message_id IS NOT NULL THEN
        NEW.whatsapp_message_id = NEW.message_id;
      END IF;
      IF NEW.uuid_id IS NULL THEN
        NEW.uuid_id = gen_random_uuid();
      END IF;
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;';
  ELSIF id_is_uuid THEN
    -- id is UUID - use id
    EXECUTE '
    CREATE OR REPLACE FUNCTION update_message_log_timestamp()
    RETURNS TRIGGER AS $func$
    BEGIN
      IF NEW.timestamp IS NULL THEN
        NEW.timestamp = COALESCE(NEW.received_at, NEW.created_at, NOW());
      END IF;
      IF NEW.whatsapp_message_id IS NULL AND NEW.message_id IS NOT NULL THEN
        NEW.whatsapp_message_id = NEW.message_id;
      END IF;
      IF NEW.id IS NULL THEN
        NEW.id = gen_random_uuid();
      END IF;
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;';
  ELSE
    -- Neither exists - just handle timestamp and whatsapp_message_id
    EXECUTE '
    CREATE OR REPLACE FUNCTION update_message_log_timestamp()
    RETURNS TRIGGER AS $func$
    BEGIN
      IF NEW.timestamp IS NULL THEN
        NEW.timestamp = COALESCE(NEW.received_at, NEW.created_at, NOW());
      END IF;
      IF NEW.whatsapp_message_id IS NULL AND NEW.message_id IS NOT NULL THEN
        NEW.whatsapp_message_id = NEW.message_id;
      END IF;
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;';
  END IF;
END $$;

-- Create trigger to auto-populate timestamp and whatsapp_message_id
DROP TRIGGER IF EXISTS trigger_update_message_log_timestamp ON message_log;
CREATE TRIGGER trigger_update_message_log_timestamp
  BEFORE INSERT OR UPDATE ON message_log
  FOR EACH ROW
  EXECUTE FUNCTION update_message_log_timestamp();

-- =====================================================
-- 5. COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN message_log.timestamp IS 'Message timestamp (synonym for received_at, used by chat interface)';
COMMENT ON COLUMN message_log.status IS 'Message status: sending, sent, delivered, read, failed';
COMMENT ON COLUMN message_log.sender_type IS 'Sender type: user, agent, or contact';
COMMENT ON COLUMN message_log.is_from_me IS 'Whether message is from the authenticated user';
COMMENT ON COLUMN message_log.contact_id IS 'Contact identifier (phone number or contact UUID)';
COMMENT ON COLUMN message_log.whatsapp_message_id IS 'WhatsApp message ID (alias for message_id)';
COMMENT ON COLUMN message_log.read_at IS 'Timestamp when message was read (NULL = unread)';
COMMENT ON COLUMN message_log.uuid_id IS 'UUID identifier for chat interface compatibility (used when id is integer)';
-- Only add comment for id if it's UUID type
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'message_log' AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    COMMENT ON COLUMN message_log.id IS 'UUID identifier for chat interface compatibility';
  END IF;
END $$;

