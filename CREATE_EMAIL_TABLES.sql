-- =====================================================
-- Email Database Tables - Complete SQL Schema
-- =====================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- Table: email_accounts
-- Stores email account connections (Gmail OAuth + IMAP/SMTP)
-- =====================================================

CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  provider VARCHAR(50), -- 'gmail', 'outlook', 'yahoo', 'custom'
  
  -- OAuth columns (for Gmail OAuth)
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  
  -- IMAP/SMTP columns
  imap_host TEXT,
  imap_port INTEGER,
  smtp_host TEXT,
  smtp_port INTEGER,
  imap_username TEXT,
  imap_password TEXT, -- Encrypted
  smtp_username TEXT,
  smtp_password TEXT, -- Encrypted
  use_ssl BOOLEAN DEFAULT true,
  use_tls BOOLEAN DEFAULT true,
  auth_method VARCHAR(50) DEFAULT 'password', -- 'password', 'oauth2', 'app_password'
  
  -- Status columns
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Unique constraint: one account per user per email per provider
  UNIQUE(user_id, email, provider)
);

-- Indexes for email_accounts
CREATE INDEX IF NOT EXISTS idx_email_accounts_user_id ON email_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_email ON email_accounts(email);
CREATE INDEX IF NOT EXISTS idx_email_accounts_provider_auth ON email_accounts(provider, auth_method);
CREATE INDEX IF NOT EXISTS idx_email_accounts_is_active ON email_accounts(is_active);

-- =====================================================
-- Table: emails
-- Stores individual email messages
-- =====================================================

CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL, -- Gmail message ID or IMAP UID
  thread_id TEXT,
  
  -- Sender/Recipient
  sender_email TEXT,
  sender_name TEXT,
  recipient_email TEXT,
  
  -- Email content
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  
  -- Status flags
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  email_type VARCHAR(20) DEFAULT 'inbox', -- 'inbox', 'draft', 'sent', 'trash', 'spam', 'archived'
  
  -- Timestamps
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint: prevent duplicate emails per account
  UNIQUE(email_account_id, provider_message_id)
);

-- Indexes for emails
CREATE INDEX IF NOT EXISTS idx_emails_email_account_id ON emails(email_account_id);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_is_read ON emails(is_read);
CREATE INDEX IF NOT EXISTS idx_emails_email_type ON emails(email_type);
CREATE INDEX IF NOT EXISTS idx_emails_account_type ON emails(email_account_id, email_type);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);

-- =====================================================
-- Row Level Security (RLS) Policies
-- =====================================================

-- Enable RLS
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for clean re-run)
DROP POLICY IF EXISTS "Users can view own email accounts" ON email_accounts;
DROP POLICY IF EXISTS "Users can create own email accounts" ON email_accounts;
DROP POLICY IF EXISTS "Users can update own email accounts" ON email_accounts;
DROP POLICY IF EXISTS "Users can delete own email accounts" ON email_accounts;

DROP POLICY IF EXISTS "Users can view emails from own accounts" ON emails;
DROP POLICY IF EXISTS "Users can insert emails to own accounts" ON emails;
DROP POLICY IF EXISTS "Users can update emails from own accounts" ON emails;
DROP POLICY IF EXISTS "Users can delete emails from own accounts" ON emails;

-- Policies for email_accounts
CREATE POLICY "Users can view own email accounts"
  ON email_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own email accounts"
  ON email_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own email accounts"
  ON email_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own email accounts"
  ON email_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- Policies for emails
CREATE POLICY "Users can view emails from own accounts"
  ON emails FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM email_accounts
      WHERE email_accounts.id = emails.email_account_id
      AND email_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert emails to own accounts"
  ON emails FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM email_accounts
      WHERE email_accounts.id = emails.email_account_id
      AND email_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update emails from own accounts"
  ON emails FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM email_accounts
      WHERE email_accounts.id = emails.email_account_id
      AND email_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete emails from own accounts"
  ON emails FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM email_accounts
      WHERE email_accounts.id = emails.email_account_id
      AND email_accounts.user_id = auth.uid()
    )
  );

-- =====================================================
-- Triggers for updated_at timestamps
-- =====================================================

-- Function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for email_accounts
DROP TRIGGER IF EXISTS update_email_accounts_updated_at ON email_accounts;
CREATE TRIGGER update_email_accounts_updated_at
  BEFORE UPDATE ON email_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for emails
DROP TRIGGER IF EXISTS update_emails_updated_at ON emails;
CREATE TRIGGER update_emails_updated_at
  BEFORE UPDATE ON emails
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Comments for documentation
-- =====================================================

COMMENT ON TABLE email_accounts IS 'Stores email account connections (Gmail OAuth and IMAP/SMTP)';
COMMENT ON TABLE emails IS 'Stores individual email messages fetched from email accounts';

COMMENT ON COLUMN email_accounts.auth_method IS 'Authentication method: password, oauth2, or app_password';
COMMENT ON COLUMN email_accounts.imap_password IS 'Encrypted IMAP password or app password';
COMMENT ON COLUMN email_accounts.smtp_password IS 'Encrypted SMTP password or app password';

COMMENT ON COLUMN emails.email_type IS 'Email type: inbox, draft, sent, trash, spam, or archived';
COMMENT ON COLUMN emails.provider_message_id IS 'Provider-specific message ID (Gmail message ID or IMAP UID)';

-- =====================================================
-- End of Schema
-- =====================================================

