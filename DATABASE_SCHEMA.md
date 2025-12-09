# Database Schema - Email Tables

## Table: `email_accounts`

Stores email account connections (both Gmail OAuth and IMAP/SMTP).

### Columns

| Column Name | Type | Nullable | Default | Description |
|------------|------|----------|---------|-------------|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NOT NULL | - | Foreign key to `auth.users(id)` or `profiles(id)` |
| `email` | TEXT | NOT NULL | - | Email address |
| `provider` | VARCHAR(50) | NULL | - | Email provider: `'gmail'`, `'outlook'`, `'yahoo'`, `'custom'` |
| `access_token` | TEXT | NULL | - | OAuth access token (for Gmail OAuth) |
| `refresh_token` | TEXT | NULL | - | OAuth refresh token (for Gmail OAuth) |
| `token_expires_at` | TIMESTAMP | NULL | - | OAuth token expiration time |
| `is_active` | BOOLEAN | NOT NULL | `true` | Whether the account is active |
| `created_at` | TIMESTAMP | NOT NULL | `NOW()` | Account creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL | `NOW()` | Last update timestamp |

### IMAP/SMTP Columns (Added in migration 008)

| Column Name | Type | Nullable | Default | Description |
|------------|------|----------|---------|-------------|
| `imap_host` | TEXT | NULL | - | IMAP server hostname (e.g., `imap.gmail.com`) |
| `imap_port` | INTEGER | NULL | - | IMAP server port (e.g., `993`) |
| `smtp_host` | TEXT | NULL | - | SMTP server hostname (e.g., `smtp.gmail.com`) |
| `smtp_port` | INTEGER | NULL | - | SMTP server port (e.g., `587`) |
| `imap_username` | TEXT | NULL | - | IMAP username (usually email address) |
| `imap_password` | TEXT | NULL | - | **Encrypted** IMAP password or app password |
| `smtp_username` | TEXT | NULL | - | SMTP username (usually email address) |
| `smtp_password` | TEXT | NULL | - | **Encrypted** SMTP password or app password |
| `use_ssl` | BOOLEAN | NULL | `true` | Use SSL for IMAP connection |
| `use_tls` | BOOLEAN | NULL | `true` | Use TLS for SMTP connection |
| `auth_method` | VARCHAR(50) | NULL | `'password'` | Authentication method: `'password'`, `'oauth2'`, `'app_password'` |

### Indexes

- `idx_email_accounts_provider_auth` on `(provider, auth_method)`
- Index on `user_id` (for user lookups)
- Index on `email` (for email lookups)

### Relationships

- `user_id` → `auth.users(id)` or `profiles(id)` (CASCADE DELETE)
- Referenced by `emails.email_account_id`

### Notes

- **Passwords are encrypted** using AES-256-CBC before storage
- For Gmail OAuth: `access_token`, `refresh_token`, `token_expires_at` are used
- For IMAP/SMTP: `imap_*` and `smtp_*` columns are used
- `auth_method` indicates how the account authenticates

---

## Table: `emails`

Stores individual email messages fetched from email accounts.

### Columns

| Column Name | Type | Nullable | Default | Description |
|------------|------|----------|---------|-------------|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | Primary key |
| `email_account_id` | UUID | NOT NULL | - | Foreign key to `email_accounts(id)` |
| `provider_message_id` | TEXT | NOT NULL | - | Provider-specific message ID (e.g., Gmail message ID) |
| `thread_id` | TEXT | NULL | - | Email thread/conversation ID |
| `sender_email` | TEXT | NULL | - | Sender's email address |
| `sender_name` | TEXT | NULL | - | Sender's display name |
| `recipient_email` | TEXT | NULL | - | Recipient's email address |
| `subject` | TEXT | NULL | - | Email subject line |
| `body_text` | TEXT | NULL | - | Plain text email body |
| `body_html` | TEXT | NULL | - | HTML email body |
| `is_read` | BOOLEAN | NOT NULL | `false` | Whether email has been read |
| `is_starred` | BOOLEAN | NOT NULL | `false` | Whether email is starred/favorited |
| `received_at` | TIMESTAMPTZ | NULL | - | When email was received |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | Last update timestamp |

### Additional Columns (Added in migration)

| Column Name | Type | Nullable | Default | Description |
|------------|------|----------|---------|-------------|
| `email_type` | VARCHAR(20) | NULL | `'inbox'` | Email type: `'inbox'`, `'draft'`, `'sent'`, `'trash'`, `'spam'`, `'archived'` |

### Constraints

- **UNIQUE** constraint on `(email_account_id, provider_message_id)` - prevents duplicate emails

### Indexes

- `idx_emails_email_type` on `email_type`
- `idx_emails_account_type` on `(email_account_id, email_type)`
- Index on `email_account_id` (for account lookups)
- Index on `received_at` (for sorting)
- Index on `is_read` (for filtering)

### Relationships

- `email_account_id` → `email_accounts(id)` (CASCADE DELETE)

### Notes

- Emails are fetched and stored by the backend
- For Gmail: emails come via Gmail API or Pub/Sub webhooks
- For IMAP/SMTP: emails are fetched via IMAP protocol
- `provider_message_id` ensures uniqueness per account
- `email_type` tracks which folder/label the email belongs to

---

## SQL Schema (Complete)

### Create `email_accounts` Table

```sql
CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  provider VARCHAR(50), -- 'gmail', 'outlook', 'yahoo', 'custom'
  access_token TEXT, -- OAuth access token
  refresh_token TEXT, -- OAuth refresh token
  token_expires_at TIMESTAMP, -- OAuth token expiration
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
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
  auth_method VARCHAR(50) DEFAULT 'password' -- 'password', 'oauth2', 'app_password'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_accounts_user_id ON email_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_email ON email_accounts(email);
CREATE INDEX IF NOT EXISTS idx_email_accounts_provider_auth ON email_accounts(provider, auth_method);
```

### Create `emails` Table

```sql
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  thread_id TEXT,
  sender_email TEXT,
  sender_name TEXT,
  recipient_email TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  received_at TIMESTAMPTZ,
  email_type VARCHAR(20) DEFAULT 'inbox', -- 'inbox', 'draft', 'sent', 'trash', 'spam', 'archived'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email_account_id, provider_message_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_emails_email_account_id ON emails(email_account_id);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at);
CREATE INDEX IF NOT EXISTS idx_emails_is_read ON emails(is_read);
CREATE INDEX IF NOT EXISTS idx_emails_email_type ON emails(email_type);
CREATE INDEX IF NOT EXISTS idx_emails_account_type ON emails(email_account_id, email_type);
```

---

## Row Level Security (RLS)

Both tables should have RLS enabled:

```sql
-- Enable RLS
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

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
```

---

## Data Flow

### Gmail OAuth Flow
1. User connects Gmail → OAuth tokens stored in `email_accounts`
2. Backend watches Gmail → New emails saved to `emails`
3. Frontend queries `emails` table by `email_account_id`

### IMAP/SMTP Flow
1. User connects IMAP/SMTP → Credentials encrypted and stored in `email_accounts`
2. Backend fetches emails via IMAP → Emails saved to `emails`
3. Frontend queries `emails` table by `email_account_id`

---

## Security Notes

1. **Passwords are encrypted** using AES-256-CBC before storage
2. **OAuth tokens** are stored as-is (they're already secure tokens)
3. **RLS policies** ensure users can only access their own data
4. **CASCADE DELETE** ensures emails are deleted when account is deleted

