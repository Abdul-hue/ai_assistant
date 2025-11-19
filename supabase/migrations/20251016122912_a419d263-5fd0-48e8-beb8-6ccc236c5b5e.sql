-- Update agents table with new fields for Baileys integration
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS session_data JSONB,
ADD COLUMN IF NOT EXISTS company_data JSONB,
ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{"calendar": true, "chatHistory": true, "taskManagement": true, "fileSharing": false}'::jsonb,
ADD COLUMN IF NOT EXISTS initial_prompt TEXT,
ADD COLUMN IF NOT EXISTS response_language TEXT DEFAULT 'en',
ADD COLUMN IF NOT EXISTS agent_type TEXT DEFAULT 'custom';

-- Create calendar_events table
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  reminder_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on calendar_events
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- Calendar policies
CREATE POLICY "Users can view own calendar events"
  ON public.calendar_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own calendar events"
  ON public.calendar_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own calendar events"
  ON public.calendar_events FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own calendar events"
  ON public.calendar_events FOR DELETE
  USING (auth.uid() = user_id);

-- Create agent_data table for storing additional agent information
CREATE TABLE IF NOT EXISTS public.agent_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE NOT NULL,
  data_type TEXT NOT NULL,
  data_content JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on agent_data
ALTER TABLE public.agent_data ENABLE ROW LEVEL SECURITY;

-- Agent data policies
CREATE POLICY "Users can view own agent data"
  ON public.agent_data FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE agents.id = agent_data.agent_id
      AND agents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create own agent data"
  ON public.agent_data FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE agents.id = agent_data.agent_id
      AND agents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own agent data"
  ON public.agent_data FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE agents.id = agent_data.agent_id
      AND agents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own agent data"
  ON public.agent_data FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE agents.id = agent_data.agent_id
      AND agents.user_id = auth.uid()
    )
  );

-- Add trigger for calendar_events updated_at
CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add trigger for agent_data updated_at
CREATE TRIGGER update_agent_data_updated_at
  BEFORE UPDATE ON public.agent_data
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();