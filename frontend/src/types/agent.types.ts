/**
 * Agent and WhatsApp Session Type Definitions
 * 
 * These types match the backend API responses for agent details
 */

export interface WhatsAppSession {
  id: string;
  phone_number: string | null;
  is_active: boolean;
  last_connected: string | null;
  status: 'qr_pending' | 'connected' | 'disconnected' | 'initializing';
  created_at: string;
  updated_at: string;
  qr_code: string | null; // Base64 or data URL, only present when status is 'qr_pending'
}

export interface AgentStatistics {
  total_messages: number;
  last_message_at: string | null;
  last_message_text: string | null;
  unprocessed_messages: number;
}

export interface Agent {
  id: string;
  user_id: string;
  agent_name: string;
  description: string | null;
  initial_prompt: string | null;
  company_data: Record<string, any> | null;
  integration_endpoints: IntegrationEndpoint[] | null;
  uploaded_files: FileMetadata[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  whatsapp_session: WhatsAppSession | null;
}

export interface IntegrationEndpoint {
  id: string;
  name: string;
  url: string;
}

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string | null;
  uploadedAt?: string | null;
  storagePath?: string;
  file?: File; // Present when the file is pending upload during agent creation
}

export interface AgentDetailsResponse {
  agent: Agent;
  statistics: AgentStatistics;
}

// API Error Response
export interface ApiError {
  error: string;
  message?: string;
  details?: Array<{
    field: string;
    message: string;
    code: string;
  }>;
}

// Simple agent list item (for GET /api/agents)
export interface AgentListItem {
  id: string;
  user_id: string;
  agent_name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// WhatsApp connection mutation payloads
export interface ConnectWhatsAppPayload {
  agentId: string;
}

export interface DisconnectWhatsAppPayload {
  agentId: string;
}

export interface WhatsAppConnectionResponse {
  success: boolean;
  message?: string;
  qrCode?: string;
  phoneNumber?: string;
  status?: string;
}

export interface AgentDocumentMatch {
  id: string | null;
  score: number;
  agent_id: string;
  file_id: string | null;
  file_name: string | null;
  chunk_index: number | null;
  total_chunks: number | null;
  text: string;
  storage_path: string | null;
  uploaded_at: string | null;
  content_type: string | null;
}

export interface AgentDocumentQueryResponse {
  agent_id: string;
  query: string;
  matches: AgentDocumentMatch[];
}

