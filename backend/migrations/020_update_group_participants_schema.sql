-- Add name and phone_number columns to group_participants table
ALTER TABLE public.group_participants 
  ADD COLUMN IF NOT EXISTS name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);

-- Create index for phone number lookups
CREATE INDEX IF NOT EXISTS idx_group_participants_phone 
  ON public.group_participants USING btree (phone_number);

-- Update existing records with phone numbers extracted from JID
UPDATE public.group_participants 
SET phone_number = SPLIT_PART(whatsapp_jid, '@', 1)
WHERE phone_number IS NULL;

-- Optional: Try to populate names from contacts table if they exist
UPDATE public.group_participants gp
SET name = c.name
FROM public.contacts c
WHERE gp.phone_number = c.phone_number
  AND gp.name IS NULL
  AND c.agent_id = (
    SELECT agent_id FROM public.groups WHERE id = gp.group_id LIMIT 1
  );
