-- Add columns for enhanced contact synchronization
-- This migration adds support for contact type classification, sync tracking, and WhatsApp profile names

-- Add contact_type column to classify contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS contact_type VARCHAR(20) DEFAULT 'whatsapp';

-- Add notify_name for WhatsApp profile names (separate from saved phone book names)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS notify_name VARCHAR(255);

-- Add is_saved flag to track if contact is saved in phone book
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_saved BOOLEAN DEFAULT false;

-- Add synced_at timestamp to track when contact was last synced
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;

-- Add sync_source to track how contact was synced (event, store, manual, periodic)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS sync_source VARCHAR(50);

-- Add last_seen timestamp for contact activity tracking
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE;

-- Add jid column for storing full WhatsApp JID (including @lid contacts)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS jid TEXT;

-- Add unique constraint for agent_id + phone_number (if phone_number exists)
-- Note: This will allow multiple contacts with null phone_number (for @lid contacts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_agent_phone_unique 
  ON contacts(agent_id, phone_number) 
  WHERE phone_number IS NOT NULL;

-- Add index for jid lookups
CREATE INDEX IF NOT EXISTS idx_contacts_jid ON contacts(jid);

-- Make phone_number nullable to support @lid contacts (encrypted, no phone number)
ALTER TABLE contacts
  ALTER COLUMN phone_number DROP NOT NULL;

-- Drop the old unique constraint that requires phone_number
DROP INDEX IF EXISTS idx_contacts_agent_phone;

-- Create new unique constraint that handles both phone_number and jid
-- For contacts with phone_number: use agent_id + phone_number
-- For contacts without phone_number (@lid): use agent_id + jid
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_agent_phone_unique 
  ON contacts(agent_id, COALESCE(phone_number, ''), COALESCE(jid, ''));

-- Alternative: Use a computed unique key
-- We'll handle uniqueness in application logic for @lid contacts

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacts_contact_type ON contacts(contact_type);
CREATE INDEX IF NOT EXISTS idx_contacts_is_saved ON contacts(is_saved);
CREATE INDEX IF NOT EXISTS idx_contacts_synced_at ON contacts(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_sync_source ON contacts(sync_source);
CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(last_seen DESC);

-- Update existing contacts to have default values
UPDATE contacts
SET 
  contact_type = CASE 
    WHEN metadata->>'is_business' = 'true' THEN 'business'
    ELSE 'whatsapp'
  END,
  is_saved = COALESCE((metadata->>'is_saved')::boolean, false),
  sync_source = 'migration'
WHERE contact_type IS NULL OR sync_source IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN contacts.contact_type IS 'Type of contact: saved (phone book), whatsapp (profile only), group, business, broadcast';
COMMENT ON COLUMN contacts.notify_name IS 'WhatsApp profile name (notify/pushName), separate from saved phone book name';
COMMENT ON COLUMN contacts.is_saved IS 'Whether contact is saved in phone book (has name/verifiedName)';
COMMENT ON COLUMN contacts.synced_at IS 'Timestamp when contact was last synced from WhatsApp';
COMMENT ON COLUMN contacts.sync_source IS 'Source of sync: event (contacts.set), store (store polling), manual (API), periodic (scheduled)';
COMMENT ON COLUMN contacts.last_seen IS 'Last seen timestamp from WhatsApp';
