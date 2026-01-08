/**
 * React Query hooks for agent list management
 * 
 * Provides hooks for fetching and managing the user's agent list
 */

import { useQuery, useMutation, useQueryClient, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import type { AgentListItem, ApiError } from '@/types/agent.types';

import { API_URL } from '@/config';

/**
 * Fetch all agents for the authenticated user
 */
async function fetchAgents(): Promise<AgentListItem[]> {
  const response = await fetch(`${API_URL}/api/agents`, {
    credentials: 'include', // SECURITY: Send HttpOnly cookies
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: ApiError = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    throw new Error(errorData.message || errorData.error || 'Failed to fetch agents');
  }

  return response.json();
}

/**
 * Delete an agent
 */
async function deleteAgent(agentId: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_URL}/api/agents/${agentId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: ApiError = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    throw new Error(errorData.message || errorData.error || 'Failed to delete agent');
  }

  return response.json();
}

/**
 * useAgents Hook
 * 
 * Fetches and caches the list of user's agents
 * 
 * @param options - Optional React Query configuration
 * @returns React Query result with agents array
 * 
 * @example
 * ```tsx
 * const { data: agents, isLoading, error } = useAgents();
 * 
 * if (isLoading) return <div>Loading agents...</div>;
 * if (error) return <div>Error: {error.message}</div>;
 * 
 * return (
 *   <ul>
 *     {agents.map(agent => (
 *       <li key={agent.id}>{agent.agent_name}</li>
 *     ))}
 *   </ul>
 * );
 * ```
 */
export function useAgents(
  options?: Omit<UseQueryOptions<AgentListItem[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<AgentListItem[], Error>({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    staleTime: 60000, // Consider fresh for 1 minute
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    ...options,
  });
}

/**
 * useDeleteAgent Hook
 * 
 * Mutation hook for deleting an agent
 * Automatically updates the agents list cache on success
 * 
 * @param options - Optional mutation configuration
 * @returns Mutation object with mutate function
 * 
 * @example
 * ```tsx
 * const { mutate: deleteAgent, isPending } = useDeleteAgent();
 * 
 * const handleDelete = (agentId: string) => {
 *   if (confirm('Delete this agent?')) {
 *     deleteAgent(agentId);
 *   }
 * };
 * ```
 */
export function useDeleteAgent(
  options?: Omit<UseMutationOptions<{ success: boolean; message: string }, Error, string>, 'mutationFn'>
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<{ success: boolean; message: string }, Error, string>({
    mutationFn: deleteAgent,
    
    onMutate: async (agentId) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['agents'] });
      await queryClient.cancelQueries({ queryKey: ['agent-details', agentId] });
      
      // Snapshot previous state
      const previousAgents = queryClient.getQueryData(['agents']);
      
      // Optimistically remove from cache
      queryClient.setQueryData(['agents'], (old: AgentListItem[] | undefined) => {
        if (!old) return old;
        return old.filter(agent => agent.id !== agentId);
      });
      
      return { previousAgents };
    },
    
    onSuccess: (data, agentId) => {
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.removeQueries({ queryKey: ['agent-details', agentId] });
      
      toast({
        title: 'Agent Deleted',
        description: data.message || 'Agent has been deleted successfully',
      });
    },
    
    onError: (error, agentId, context) => {
      // Rollback on error
      if (context?.previousAgents) {
        queryClient.setQueryData(['agents'], context.previousAgents);
      }
      
      toast({
        title: 'Delete Failed',
        description: error.message || 'Failed to delete agent',
        variant: 'destructive',
      });
    },
    
    ...options,
  });
}

