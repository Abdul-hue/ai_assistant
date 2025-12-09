-- Migration: Add email_type column to emails table
-- This migration adds a column to track email type (inbox, draft, sent, trash, spam, archived)

-- Add email_type column to emails table
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS email_type VARCHAR(20) DEFAULT 'inbox';

-- Add index for faster queries by email type
CREATE INDEX IF NOT EXISTS idx_emails_email_type ON emails(email_type);

-- Add index for combined queries (email_account_id + email_type)
CREATE INDEX IF NOT EXISTS idx_emails_account_type ON emails(email_account_id, email_type);

-- Update existing emails to set email_type based on common patterns
-- Note: This is a best-effort update. New emails will have correct type from Gmail labels
UPDATE emails 
SET email_type = 'inbox' 
WHERE email_type IS NULL OR email_type = '';

-- Add comment to column
COMMENT ON COLUMN emails.email_type IS 'Email type: inbox, draft, sent, trash, spam, or archived';

