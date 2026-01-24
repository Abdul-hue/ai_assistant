-- Migration: Create Groups and Group Participants Tables
-- Description: Adds support for WhatsApp groups synchronization and management
-- Date: 2024

-- Create groups table
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  whatsapp_group_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  invite_code VARCHAR(100),
  participant_count INTEGER DEFAULT 0,
  is_announcement BOOLEAN DEFAULT false,
  is_restricted BOOLEAN DEFAULT false,
  is_important BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE,
  subject_changed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at_db TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_groups_agent_id ON groups(agent_id);
CREATE INDEX IF NOT EXISTS idx_groups_whatsapp_id ON groups(whatsapp_group_id);
CREATE INDEX IF NOT EXISTS idx_groups_important ON groups(agent_id, is_important) WHERE is_important = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_agent_whatsapp ON groups(agent_id, whatsapp_group_id);

-- Enable RLS
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their agent groups"
  ON groups FOR SELECT
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can update their agent groups"
  ON groups FOR UPDATE
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert their agent groups"
  ON groups FOR INSERT
  WITH CHECK (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

-- Create group_participants table
CREATE TABLE IF NOT EXISTS group_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  whatsapp_jid VARCHAR(255) NOT NULL,
  is_admin BOOLEAN DEFAULT false,
  is_super_admin BOOLEAN DEFAULT false,
  joined_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for group_participants
CREATE INDEX IF NOT EXISTS idx_group_participants_group_id ON group_participants(group_id);
CREATE INDEX IF NOT EXISTS idx_group_participants_jid ON group_participants(whatsapp_jid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_participants_unique ON group_participants(group_id, whatsapp_jid);

-- Add is_important column to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_important BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_contacts_important ON contacts(agent_id, is_important) WHERE is_important = true;

-- Update message_log table to support groups
ALTER TABLE message_log 
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_group_message BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_message_log_group_id ON message_log(group_id) WHERE is_group_message = true;
