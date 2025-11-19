-- Agent configuration refactor migration
-- Drops deprecated columns, introduces integration endpoints & uploaded files metadata

BEGIN;

ALTER TABLE agents 
  DROP COLUMN IF EXISTS response_language,
  DROP COLUMN IF EXISTS chat_history_enabled,
  DROP COLUMN IF EXISTS personal_calendar_enabled,
  DROP COLUMN IF EXISTS task_management_enabled,
  DROP COLUMN IF EXISTS file_sharing_enabled,
  DROP COLUMN IF EXISTS webhook_url,
  DROP COLUMN IF EXISTS features;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS integration_endpoints JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS uploaded_files JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN agents.integration_endpoints IS 'Array of {id, name, url} objects';
COMMENT ON COLUMN agents.uploaded_files IS 'Array of file metadata objects';

CREATE INDEX IF NOT EXISTS idx_agents_uploaded_files ON agents USING GIN (uploaded_files);

COMMIT;

