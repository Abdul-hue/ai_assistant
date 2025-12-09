-- Add unique constraint to email_accounts table
-- This allows upsert operations to work properly

-- Add unique constraint on (user_id, email, provider)
-- This ensures one account per user per email per provider
ALTER TABLE email_accounts
ADD CONSTRAINT unique_user_email_provider 
UNIQUE (user_id, email, provider);

-- If the constraint already exists, this will fail gracefully
-- You can ignore the error if it says the constraint already exists

