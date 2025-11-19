-- ============================================================================
-- Migration: Create agent_document_contents table
-- Created: 2025-11-11
-- Purpose: Store extracted text content from uploaded agent documents
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_document_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  file_id UUID NOT NULL,
  file_name TEXT,
  storage_path TEXT,
  content TEXT NOT NULL,
  content_type VARCHAR(50) DEFAULT 'text/plain',
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure we can upsert on (agent_id, file_id)
ALTER TABLE public.agent_document_contents
  ADD CONSTRAINT agent_document_contents_agent_file_unique
  UNIQUE (agent_id, file_id);

-- Helpful indexes for lookups
CREATE INDEX IF NOT EXISTS idx_agent_document_contents_agent_id
  ON public.agent_document_contents(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_document_contents_file_id
  ON public.agent_document_contents(file_id);

-- Optional: index for full text search (commented out until needed)
-- CREATE INDEX IF NOT EXISTS idx_agent_document_contents_content_gin
--   ON public.agent_document_contents
--   USING gin (to_tsvector('english', content));

