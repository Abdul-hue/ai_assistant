-- ============================================
-- Performance Optimization Indexes
-- Added: 2025-01-15 - Phase 2
-- Purpose: Optimize common queries in baileys service
-- ============================================

-- Index 1: Optimize reconnectAllAgents query
-- Query: SELECT * FROM whatsapp_sessions WHERE status IN (...) AND is_active = true
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_status_active 
ON whatsapp_sessions(status, is_active) 
WHERE is_active = true;

-- Index 2: Optimize agent lookup by status
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_agent_status 
ON whatsapp_sessions(agent_id, status);

-- Index 3: Optimize recent connections lookup
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_last_connected 
ON whatsapp_sessions(last_connected DESC) 
WHERE is_active = true;

-- Index 4: Optimize instance-based queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_instance 
ON whatsapp_sessions(instance_id, instance_hostname);

-- Index 5: Optimize phone number lookup
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_phone 
ON whatsapp_sessions(phone_number) 
WHERE phone_number IS NOT NULL;

-- Index 6: Optimize message log queries (if table exists)
CREATE INDEX IF NOT EXISTS idx_message_log_agent_timestamp 
ON message_log(agent_id, created_at DESC);

-- Index 7: Optimize contact queries (if table exists)
CREATE INDEX IF NOT EXISTS idx_contacts_agent 
ON contacts(agent_id);

-- Add comments for documentation
COMMENT ON INDEX idx_whatsapp_sessions_status_active IS 
'Optimizes reconnectAllAgents() query - searches for active sessions by status';

COMMENT ON INDEX idx_whatsapp_sessions_agent_status IS 
'Optimizes individual agent status lookups';

COMMENT ON INDEX idx_whatsapp_sessions_last_connected IS 
'Optimizes queries that sort by last connection time';

-- Analyze tables to update statistics
ANALYZE whatsapp_sessions;
ANALYZE message_log;
ANALYZE contacts;

-- Print confirmation
DO $$
BEGIN
  RAISE NOTICE 'Performance indexes created successfully';
  RAISE NOTICE 'Total indexes on whatsapp_sessions: %', (
    SELECT count(*) FROM pg_indexes 
    WHERE tablename = 'whatsapp_sessions'
  );
END $$;
