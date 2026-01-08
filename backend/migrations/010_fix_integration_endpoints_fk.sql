-- Fix integration_endpoints foreign key constraint
-- This ensures Supabase PostgREST can detect the relationship

-- Drop existing constraint if it exists (without a name, it might not be detected)
DO $$ 
BEGIN
    -- Check if the table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'integration_endpoints') THEN
        -- Drop any existing unnamed foreign key constraints
        ALTER TABLE integration_endpoints 
        DROP CONSTRAINT IF EXISTS integration_endpoints_agent_id_fkey;
        
        -- Add a properly named foreign key constraint
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'fk_integration_endpoints_agent_id'
            AND table_name = 'integration_endpoints'
        ) THEN
            ALTER TABLE integration_endpoints 
            ADD CONSTRAINT fk_integration_endpoints_agent_id 
            FOREIGN KEY (agent_id) 
            REFERENCES agents(id) 
            ON DELETE CASCADE;
        END IF;
    END IF;
END $$;

-- Refresh Supabase schema cache (if using Supabase locally)
-- Note: This command only works in Supabase local development
-- For production, the schema cache refreshes automatically after migrations
-- NOTIFY pgrst, 'reload schema';

