-- ============================================================================
-- MIGRATION: Add Performance Indexes
-- Created: 2025-11-04
-- Description: Add missing database indexes to improve query performance
-- ============================================================================

-- PERFORMANCE: Index for WhatsApp session lookups by agent_id
-- Used in: agents.js routes (whatsapp-status, init-whatsapp, disconnect-whatsapp)
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_agent_id 
ON whatsapp_sessions(agent_id);

-- PERFORMANCE: Composite index for active agents by user
-- Used in: agents.js GET /api/agents (list user's agents)
CREATE INDEX IF NOT EXISTS idx_agents_user_id_is_active 
ON agents(user_id, is_active) 
WHERE is_active = true;

-- PERFORMANCE: Index for chat message queries ordered by date
-- Used in: agents.js GET /api/agents/:id/chat-history
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at 
ON chat_messages(created_at DESC);

-- PERFORMANCE: Index for chat messages by conversation
-- Used in: Filtering messages by conversation_id
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id 
ON chat_messages(conversation_id);

-- PERFORMANCE: Composite index for chat history by agent
-- Used in: agents.js GET /api/agents/:id/chat-history
CREATE INDEX IF NOT EXISTS idx_chat_messages_agent_id_created_at 
ON chat_messages(agent_id, created_at DESC);

-- PERFORMANCE: Index for user profile lookups
-- Used in: auth middleware, user authentication
CREATE INDEX IF NOT EXISTS idx_profiles_email 
ON profiles(email);

-- PERFORMANCE: Index for active WhatsApp sessions
-- Used in: Monitoring and reconnection logic
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_is_active 
ON whatsapp_sessions(is_active) 
WHERE is_active = true;

-- ============================================================================
-- VERIFICATION QUERIES (for testing)
-- ============================================================================

-- Verify indexes were created successfully
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Check index sizes
SELECT
    indexrelname AS index_name,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexrelname LIKE 'idx_%'
ORDER BY pg_relation_size(indexrelid) DESC;

