/**
 * React Query hook for fetching dashboard statistics
 * 
 * Fetches total agents, active agents, and total messages from the /api/dashboard/stats endpoint
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { API_URL } from '@/config';

export interface DashboardStats {
  total_agents: number;
  active_agents: number;
  total_messages: number;
}

/**
 * Fetch dashboard statistics
 * 
 * @returns Promise with dashboard statistics
 */
async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await fetch(`${API_URL}/api/dashboard/stats`, {
    credentials: 'include', // SECURITY: Send HttpOnly cookies for authentication
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    throw new Error(errorData.message || errorData.error || 'Failed to fetch dashboard statistics');
  }

  return response.json();
}

/**
 * useDashboardStats Hook
 * 
 * Fetches and caches dashboard statistics
 * 
 * @param options - Optional React Query configuration
 * @returns React Query result with dashboard statistics
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error, refetch } = useDashboardStats();
 * 
 * if (isLoading) return <div>Loading...</div>;
 * if (error) return <div>Error: {error.message}</div>;
 * 
 * return (
 *   <div>
 *     <p>Total Agents: {data.total_agents}</p>
 *     <p>Active Agents: {data.active_agents}</p>
 *     <p>Total Messages: {data.total_messages}</p>
 *   </div>
 * );
 * ```
 */
export function useDashboardStats(
  options?: Omit<UseQueryOptions<DashboardStats, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<DashboardStats, Error>({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
    staleTime: 30000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: (failureCount, error) => {
      // Don't retry on 401 (unauthorized)
      if (error.message.includes('401')) {
        return false;
      }
      // Retry up to 2 times for other errors
      return failureCount < 2;
    },
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchInterval: 60000, // Auto-refresh every 60 seconds
    ...options,
  });
}

