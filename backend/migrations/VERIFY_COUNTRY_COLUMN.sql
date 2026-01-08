-- ✅ RUN THIS IN SUPABASE SQL EDITOR TO FIX THE COUNTRY COLUMN ISSUE

-- Step 1: Check if the column exists
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles' 
  AND column_name = 'country';

-- If the above query returns no rows, the column doesn't exist
-- Run the following to add it:

-- Step 2: Add the country column if it doesn't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS country TEXT NULL;

-- Step 3: Verify the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
ORDER BY ordinal_position;

-- Step 4: Test updating a profile with country (replace YOUR_USER_ID with your actual user ID)
-- UPDATE public.profiles 
-- SET country = 'Pakistan', updated_at = NOW()
-- WHERE id = 'YOUR_USER_ID';

-- Step 5: Verify the update worked
-- SELECT id, email, full_name, country, updated_at 
-- FROM public.profiles 
-- WHERE id = 'YOUR_USER_ID';

