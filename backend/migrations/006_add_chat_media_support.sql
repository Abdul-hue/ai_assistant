ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_mimetype VARCHAR(100),
  ADD COLUMN IF NOT EXISTS media_size INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE chat_messages
  ALTER COLUMN message_type SET DEFAULT 'TEXT';

UPDATE chat_messages
SET message_type = UPPER(message_type)
WHERE message_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_message_type
  ON chat_messages (message_type);

