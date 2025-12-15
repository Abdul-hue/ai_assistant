/**
 * Message and Chat Type Definitions
 * 
 * Types for the agent chat interface
 */

export interface Message {
  id: string; // UUID (new) or message_id (legacy)
  agent_id: string;
  contact_id: string | null;
  user_id: string;
  message: string; // New column, falls back to message_text
  sender_type: 'agent' | 'user' | 'contact';
  is_from_me: boolean;
  timestamp: string; // New column, falls back to received_at or created_at
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  message_type?: 'text' | 'image' | 'document';
  whatsapp_message_id?: string | null; // Alias for message_id
  read_at?: string | null;
  // Legacy fields (for backward compatibility)
  message_text?: string;
  received_at?: string;
  created_at?: string;
  message_id?: string;
  sender_phone?: string;
}

export interface AgentChatInfo {
  id: string;
  agent_name: string;
  whatsapp_phone_number: string | null;
  is_active: boolean;
  lastMessage?: Message;
  unreadCount: number;
  avatar_url?: string | null;
  persona?: string | null;
}

export interface SendMessagePayload {
  message: string;
  contact_id?: string | null;
}

export interface MessagesResponse {
  success: boolean;
  messages: Message[];
}

export interface SendMessageResponse {
  success: boolean;
  message: Message;
}

export interface ChatListResponse {
  success: boolean;
  agents: AgentChatInfo[];
}

