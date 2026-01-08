-- ============================================================================
-- MIGRATION: Create agent_document_contents table
-- Created: 2025-11-11
-- Description: Store extracted content from uploaded agent documents
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_document_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  file_id UUID NOT NULL,
  file_name TEXT,
  storage_path TEXT,
  content TEXT NOT NULL,
  content_type VARCHAR(50) DEFAULT 'text/plain',
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE agent_document_contents
  ADD CONSTRAINT agent_document_contents_agent_file_unique
  UNIQUE (agent_id, file_id);

CREATE INDEX IF NOT EXISTS idx_agent_document_contents_agent_id
  ON agent_document_contents(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_document_contents_file_id
  ON agent_document_contents(file_id);

-- ============================================================================
-- VERIFICATION QUERIES (optional)
-- ============================================================================
-- SELECT * FROM agent_document_contents LIMIT 1;

