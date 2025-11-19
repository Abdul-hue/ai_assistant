-- Enable RLS on meetings table if not already enabled
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
-- Note: We keep the existing SELECT policy (public_read_scheduled_meetings) as it may be needed
DROP POLICY IF EXISTS "public_create_own_meetings" ON public.meetings;
DROP POLICY IF EXISTS "public_update_own_meetings" ON public.meetings;
DROP POLICY IF EXISTS "public_delete_own_meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can view own meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can create own meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can update own meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can delete own meetings" ON public.meetings;

-- Create RLS policies for meetings table
-- Following the naming convention of existing policy: public_read_scheduled_meetings

-- INSERT policy: Allow authenticated users to create their own meetings
CREATE POLICY "public_create_own_meetings"
  ON public.meetings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE policy: Allow authenticated users to update their own meetings
CREATE POLICY "public_update_own_meetings"
  ON public.meetings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE policy: Allow authenticated users to delete their own meetings
-- THIS IS THE CRITICAL POLICY THAT WAS MISSING
CREATE POLICY "public_delete_own_meetings"
  ON public.meetings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

