/**
 * React Query hook for fetching agent chat list
 * 
 * Fetches all agents with their last message and unread count
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { AgentChatInfo, ChatListResponse } from '@/types/message.types';
import { API_URL } from '@/config';

export const useAgentChatList = (
  options?: Omit<UseQueryOptions<AgentChatInfo[], Error>, 'queryKey' | 'queryFn'>
) => {
  return useQuery<AgentChatInfo[], Error>({
    queryKey: ['agent-chat-list'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/agents/chat-list`, {
        credentials: 'include', // Send HttpOnly cookies for authentication
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Unknown error',
          message: `HTTP ${response.status}: ${response.statusText}`,
        }));
        
        throw new Error(errorData.message || errorData.error || 'Failed to fetch chat list');
      }

      const data: ChatListResponse = await response.json();
      return data.agents || [];
    },
    refetchInterval: 5000, // Refresh agent list every 5 seconds
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true,
    ...options,
  });
};

