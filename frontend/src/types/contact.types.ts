export interface Contact {
  id: string;
  agent_id: string;
  name: string;
  phone_number: string;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ContactUploadResponse {
  message: string;
  uploaded: number;
  total: number;
  contacts: Contact[];
}

