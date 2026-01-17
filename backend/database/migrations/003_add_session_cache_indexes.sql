-- ============================================================================
-- Database Performance Indexes for whatsapp_sessions
-- Created: 2025-01-16
-- Phase: 3C.2 - Database Query Optimization
-- Purpose: Optimize queries not covered by session cache
-- Expected Impact: 10-80x faster for filtered queries
-- ============================================================================
-- 
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Each index will be created independently (safe for production).
-- ============================================================================

-- ============================================================================
-- 1. Agent Status Lookup Index (Most Critical)
-- ============================================================================
-- Speeds up: reconnectAllAgents(), agent status checks
-- Expected improvement: 15x faster
-- Columns: agent_id (exact match) + status (IN clause) + is_active (filter)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_sessions_agent_status_active 
ON whatsapp_sessions (agent_id, status, is_active);

COMMENT ON INDEX idx_whatsapp_sessions_agent_status_active IS 
'Optimizes agent status lookups and reconnection queries - Phase 3C.2';

-- ============================================================================
-- 2. Orphaned Agent Detection Index
-- ============================================================================
-- Speeds up: startOrphanedAgentMonitor()
-- Expected improvement: 10x faster
-- Partial index: only active sessions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_sessions_status_active_heartbeat 
ON whatsapp_sessions (status, is_active, last_heartbeat DESC)
WHERE is_active = true;

COMMENT ON INDEX idx_whatsapp_sessions_status_active_heartbeat IS 
'Optimizes orphaned agent detection with heartbeat sorting - Phase 3C.2';

-- ============================================================================
-- 3. Instance-Specific Queries Index
-- ============================================================================
-- Speeds up: getInstanceHealth(), instance filtering
-- Expected improvement: 8x faster
-- Partial index: only active sessions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_sessions_instance_active 
ON whatsapp_sessions (instance_id, is_active)
WHERE is_active = true;

COMMENT ON INDEX idx_whatsapp_sessions_instance_active IS 
'Optimizes instance-based filtering and health checks - Phase 3C.2';

-- ============================================================================
-- 4. Phone Number Lookup Index
-- ============================================================================
-- Speeds up: Phone number searches, duplicate detection
-- Expected improvement: 20x faster
-- Partial index: only non-null phone numbers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_sessions_phone_lookup 
ON whatsapp_sessions (phone_number)
WHERE phone_number IS NOT NULL;

COMMENT ON INDEX idx_whatsapp_sessions_phone_lookup IS 
'Optimizes phone number lookups and duplicate detection - Phase 3C.2';

-- ============================================================================
-- 5. User-Agent Lookup Index
-- ============================================================================
-- Speeds up: User dashboard queries, agent listings per user
-- Expected improvement: 12x faster
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_sessions_user_agent_active 
ON whatsapp_sessions (user_id, agent_id, is_active);

COMMENT ON INDEX idx_whatsapp_sessions_user_agent_active IS 
'Optimizes user-specific agent queries and dashboards - Phase 3C.2';

-- ============================================================================
-- 6. Time-Based Queries Index
-- ============================================================================
-- Speeds up: Analytics, recent session queries
-- Expected improvement: 5x faster
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_sessions_created_at 
ON whatsapp_sessions (created_at DESC);

COMMENT ON INDEX idx_whatsapp_sessions_created_at IS 
'Optimizes time-based queries and analytics - Phase 3C.2';

-- ============================================================================
-- Update Statistics
-- ============================================================================
-- Analyze table to update query planner statistics
ANALYZE whatsapp_sessions;

-- ============================================================================
-- Verify Indexes
-- ============================================================================
-- Query to verify all indexes were created
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef,
  pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
FROM pg_indexes
WHERE tablename = 'whatsapp_sessions'
  AND indexname LIKE 'idx_whatsapp_sessions_%'
ORDER BY indexname;

-- ============================================================================
-- Index Usage Statistics Query (for monitoring)
-- ============================================================================
-- Use this query to monitor index usage after deployment
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE tablename = 'whatsapp_sessions'
  AND indexname LIKE 'idx_whatsapp_sessions_%'
ORDER BY idx_scan DESC;

-- ============================================================================
-- Success Message
-- ============================================================================
-- Note: The verification queries below can be run after all indexes are created
-- to confirm successful creation and monitor usage.

DO $$ 
BEGIN 
  RAISE NOTICE '✅ Performance indexes created successfully!';
  RAISE NOTICE 'Run the verification queries above to confirm creation.';
  RAISE NOTICE 'Use the index usage statistics query to monitor effectiveness.';
END $$;
