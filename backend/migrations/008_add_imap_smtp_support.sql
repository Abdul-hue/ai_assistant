-- Migration: Add IMAP/SMTP support to email_accounts table
-- This allows users to connect email accounts via IMAP/SMTP (not just OAuth)

-- Add IMAP/SMTP configuration columns
ALTER TABLE email_accounts 
ADD COLUMN IF NOT EXISTS imap_host TEXT,
ADD COLUMN IF NOT EXISTS imap_port INTEGER,
ADD COLUMN IF NOT EXISTS smtp_host TEXT,
ADD COLUMN IF NOT EXISTS smtp_port INTEGER,
ADD COLUMN IF NOT EXISTS imap_username TEXT,
ADD COLUMN IF NOT EXISTS imap_password TEXT, -- Should be encrypted
ADD COLUMN IF NOT EXISTS smtp_username TEXT,
ADD COLUMN IF NOT EXISTS smtp_password TEXT, -- Should be encrypted
ADD COLUMN IF NOT EXISTS use_ssl BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS use_tls BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS auth_method VARCHAR(50) DEFAULT 'password'; -- 'password', 'oauth2', 'app_password'

-- Add index for faster lookups by provider and auth method
CREATE INDEX IF NOT EXISTS idx_email_accounts_provider_auth 
ON email_accounts(provider, auth_method);

-- Add comment to explain auth_method
COMMENT ON COLUMN email_accounts.auth_method IS 'Authentication method: password, oauth2, or app_password';

