-- Add country column to profiles table if it doesn't exist
-- This migration is idempotent and safe to run multiple times

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'profiles' 
        AND column_name = 'country'
    ) THEN
        ALTER TABLE public.profiles 
        ADD COLUMN country TEXT NULL;
        
        RAISE NOTICE 'Added country column to profiles table';
    ELSE
        RAISE NOTICE 'Country column already exists in profiles table';
    END IF;
END $$;

-- Add an index for faster country-based queries (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_profiles_country ON public.profiles(country);

COMMENT ON COLUMN public.profiles.country IS 'User country (full name, e.g., "United States", "Pakistan")';

