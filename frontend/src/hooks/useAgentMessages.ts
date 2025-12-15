/**
 * React Query hook for fetching agent messages
 * 
 * Fetches conversation history for a specific agent with real-time polling
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { Message, MessagesResponse } from '@/types/message.types';
import { API_URL } from '@/config';

interface UseAgentMessagesOptions {
  agentId: string | null;
  enabled?: boolean;
  limit?: number;
}

export const useAgentMessages = ({ 
  agentId, 
  enabled = true,
  limit = 100 
}: UseAgentMessagesOptions) => {
  return useQuery<Message[], Error>({
    queryKey: ['agent-messages', agentId],
    queryFn: async () => {
      if (!agentId) return [];
      
      const response = await fetch(
        `${API_URL}/api/agents/${agentId}/messages?limit=${limit}`,
        {
          credentials: 'include', // Send HttpOnly cookies for authentication
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Unknown error',
          message: `HTTP ${response.status}: ${response.statusText}`,
        }));
        
        throw new Error(errorData.message || errorData.error || 'Failed to fetch messages');
      }

      const data: MessagesResponse = await response.json();
      return data.messages || [];
    },
    enabled: enabled && !!agentId,
    refetchInterval: 3000, // Poll every 3 seconds for new messages
    staleTime: 0, // Always fetch fresh data for real-time feel
    refetchOnWindowFocus: true,
  });
};

