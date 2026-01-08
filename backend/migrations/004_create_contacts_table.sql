-- Create contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  email VARCHAR(255),
  company VARCHAR(255),
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacts_agent_id ON contacts(agent_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at DESC);

-- Add unique constraint to prevent duplicate phone numbers per agent
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_agent_phone ON contacts(agent_id, phone_number);

-- Add RLS policies (if using Supabase RLS)
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their agent contacts"
  ON contacts FOR SELECT
  USING (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert contacts for their agents"
  ON contacts FOR INSERT
  WITH CHECK (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update their agent contacts"
  ON contacts FOR UPDATE
  USING (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can delete their agent contacts"
  ON contacts FOR DELETE
  USING (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ));

