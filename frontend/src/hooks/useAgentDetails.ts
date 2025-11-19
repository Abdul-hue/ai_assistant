/**
 * React Query hook for fetching complete agent details
 * 
 * Fetches agent information, WhatsApp session status, and message statistics
 * from the /api/agents/:id/details endpoint
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import type { AgentDetailsResponse, ApiError } from '@/types/agent.types';

import { API_URL } from '@/config';

/**
 * Fetch agent details with WhatsApp session and statistics
 * 
 * @param agentId - UUID of the agent to fetch
 * @returns Promise with agent details response
 */
async function fetchAgentDetails(agentId: string): Promise<AgentDetailsResponse> {
  const response = await fetch(`${API_URL}/api/agents/${agentId}/details`, {
    credentials: 'include', // SECURITY: Send HttpOnly cookies for authentication
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: ApiError = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    throw new Error(errorData.message || errorData.error || 'Failed to fetch agent details');
  }

  return response.json();
}

/**
 * useAgentDetails Hook
 * 
 * Fetches and caches complete agent details including WhatsApp session and statistics
 * 
 * @param agentId - Agent UUID to fetch details for
 * @param options - Optional React Query configuration
 * @returns React Query result with agent details
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error, refetch } = useAgentDetails('agent-uuid');
 * 
 * if (isLoading) return <div>Loading...</div>;
 * if (error) return <div>Error: {error.message}</div>;
 * 
 * return (
 *   <div>
 *     <h1>{data.agent.agent_name}</h1>
 *     <p>Phone: {data.agent.whatsapp_session?.phone_number || 'Not connected'}</p>
 *     <p>Messages: {data.statistics.total_messages}</p>
 *   </div>
 * );
 * ```
 */
export function useAgentDetails(
  agentId: string | undefined,
  options?: Omit<UseQueryOptions<AgentDetailsResponse, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<AgentDetailsResponse, Error>({
    queryKey: ['agent-details', agentId],
    queryFn: () => {
      if (!agentId) {
        throw new Error('Agent ID is required');
      }
      return fetchAgentDetails(agentId);
    },
    enabled: !!agentId, // Only run query if agentId exists
    staleTime: 30000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes (formerly cacheTime)
    retry: (failureCount, error) => {
      // Don't retry on 404 (agent not found) or 401 (unauthorized)
      if (error.message.includes('404') || error.message.includes('401')) {
        return false;
      }
      // Retry up to 2 times for other errors
      return failureCount < 2;
    },
    ...options,
  });
}

/**
 * Helper function to get WhatsApp connection status from agent details
 */
export function getWhatsAppStatus(data: AgentDetailsResponse | undefined): {
  isConnected: boolean;
  phoneNumber: string | null;
  status: string;
  hasQRCode: boolean;
} {
  const session = data?.agent.whatsapp_session;
  
  return {
    isConnected: session?.is_active || false,
    phoneNumber: session?.phone_number || null,
    status: session?.status || 'disconnected',
    hasQRCode: !!session?.qr_code,
  };
}

/**
 * Helper function to check if agent needs WhatsApp setup
 */
export function needsWhatsAppSetup(data: AgentDetailsResponse | undefined): boolean {
  return !data?.agent.whatsapp_session || !data.agent.whatsapp_session.is_active;
}

