-- Add avatar_url column to agents table if it doesn't exist
-- Note: persona column already exists in the schema provided by user

-- Add avatar_url column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'agents' 
                   AND column_name = 'avatar_url') THEN
        ALTER TABLE public.agents ADD COLUMN avatar_url TEXT;
    END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_agents_avatar_url ON public.agents(avatar_url) WHERE avatar_url IS NOT NULL;

-- Note: The storage bucket 'agent_avator' will be created automatically by the backend
-- when the first avatar is uploaded, similar to how 'profile_pic' bucket works

