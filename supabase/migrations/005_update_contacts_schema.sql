ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE contacts
  ALTER COLUMN updated_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_contacts_updated_at ON contacts(updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_agent_phone ON contacts(agent_id, phone_number);

