ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS user_id UUID;

UPDATE meetings
SET user_id = NULL
WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_meetings_user_id ON meetings(user_id);

