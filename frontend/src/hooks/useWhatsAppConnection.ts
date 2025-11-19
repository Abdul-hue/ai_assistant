/**
 * React Query hooks for managing WhatsApp connections
 * 
 * Provides mutation hooks for connecting and disconnecting WhatsApp sessions
 * with automatic cache invalidation and optimistic updates
 */

import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import type { WhatsAppConnectionResponse, ApiError } from '@/types/agent.types';

import { API_URL } from '@/config';

/**
 * Get Supabase session token for Authorization header
 */
async function getAuthToken(): Promise<string | null> {
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch (error) {
    console.error('Failed to get auth token:', error);
    return null;
  }
}

/**
 * Initialize WhatsApp connection for an agent
 */
async function initializeWhatsApp(agentId: string): Promise<WhatsAppConnectionResponse> {
  // Get auth token for Authorization header (some endpoints require it)
  const token = await getAuthToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  // Add Authorization header if token available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_URL}/api/agents/${agentId}/init-whatsapp`, {
    method: 'POST',
    credentials: 'include', // SECURITY: Send HttpOnly cookies
    headers,
    body: JSON.stringify({ agentId }),
  });

  if (!response.ok) {
    const errorData: ApiError = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    throw new Error(errorData.message || errorData.error || 'Failed to initialize WhatsApp');
  }

  return response.json();
}

/**
 * Disconnect WhatsApp session for an agent
 */
async function disconnectWhatsApp(agentId: string): Promise<WhatsAppConnectionResponse> {
  // Get auth token for Authorization header
  const token = await getAuthToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_URL}/api/agents/${agentId}/disconnect-whatsapp`, {
    method: 'GET', // Backend uses GET for disconnect
    credentials: 'include', // SECURITY: Send HttpOnly cookies
    headers,
  });

  if (!response.ok) {
    const errorData: ApiError = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    throw new Error(errorData.message || errorData.error || 'Failed to disconnect WhatsApp');
  }

  return response.json();
}

/**
 * useConnectWhatsApp Hook
 * 
 * Mutation hook for initializing WhatsApp connection
 * Automatically invalidates agent queries on success
 * 
 * @param options - Optional mutation configuration
 * @returns Mutation object with mutate function
 * 
 * @example
 * ```tsx
 * const { mutate: connect, isPending } = useConnectWhatsApp();
 * 
 * const handleConnect = () => {
 *   connect(agentId, {
 *     onSuccess: (data) => {
 *       console.log('WhatsApp initialized:', data);
 *       if (data.qrCode) {
 *         // Show QR code to user
 *       }
 *     }
 *   });
 * };
 * ```
 */
export function useConnectWhatsApp(
  options?: Omit<UseMutationOptions<WhatsAppConnectionResponse, Error, string>, 'mutationFn'>
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<WhatsAppConnectionResponse, Error, string>({
    mutationFn: initializeWhatsApp,
    
    onMutate: async (agentId) => {
      // Optimistic update: Set status to 'initializing'
      await queryClient.cancelQueries({ queryKey: ['agent-details', agentId] });
      
      const previousData = queryClient.getQueryData(['agent-details', agentId]);
      
      queryClient.setQueryData(['agent-details', agentId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          agent: {
            ...old.agent,
            whatsapp_session: {
              ...old.agent.whatsapp_session,
              status: 'initializing',
              is_active: false,
            },
          },
        };
      });
      
      return { previousData };
    },
    
    onSuccess: (data, agentId) => {
      // Invalidate and refetch agent queries
      queryClient.invalidateQueries({ queryKey: ['agent-details', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      
      toast({
        title: 'WhatsApp Initializing',
        description: data.qrCode 
          ? 'Scan the QR code with your phone to connect' 
          : 'Connection in progress...',
      });
    },
    
    onError: (error, agentId, context) => {
      // Rollback optimistic update on error
      if (context?.previousData) {
        queryClient.setQueryData(['agent-details', agentId], context.previousData);
      }
      
      toast({
        title: 'Connection Failed',
        description: error.message || 'Failed to initialize WhatsApp connection',
        variant: 'destructive',
      });
    },
    
    ...options,
  });
}

/**
 * useDisconnectWhatsApp Hook
 * 
 * Mutation hook for disconnecting WhatsApp session
 * Automatically invalidates agent queries on success
 * 
 * @param options - Optional mutation configuration
 * @returns Mutation object with mutate function
 * 
 * @example
 * ```tsx
 * const { mutate: disconnect, isPending } = useDisconnectWhatsApp();
 * 
 * const handleDisconnect = () => {
 *   if (confirm('Are you sure you want to disconnect WhatsApp?')) {
 *     disconnect(agentId, {
 *       onSuccess: () => {
 *         console.log('WhatsApp disconnected successfully');
 *       }
 *     });
 *   }
 * };
 * ```
 */
export function useDisconnectWhatsApp(
  options?: Omit<UseMutationOptions<WhatsAppConnectionResponse, Error, string>, 'mutationFn'>
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<WhatsAppConnectionResponse, Error, string>({
    mutationFn: disconnectWhatsApp,
    
    onMutate: async (agentId) => {
      // Optimistic update: Set to disconnected
      await queryClient.cancelQueries({ queryKey: ['agent-details', agentId] });
      
      const previousData = queryClient.getQueryData(['agent-details', agentId]);
      
      queryClient.setQueryData(['agent-details', agentId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          agent: {
            ...old.agent,
            is_active: false,
            whatsapp_session: old.agent.whatsapp_session ? {
              ...old.agent.whatsapp_session,
              is_active: false,
              status: 'disconnected',
              qr_code: null,
            } : null,
          },
        };
      });
      
      return { previousData };
    },
    
    onSuccess: (data, agentId) => {
      // Invalidate and refetch agent queries
      queryClient.invalidateQueries({ queryKey: ['agent-details', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      
      toast({
        title: 'WhatsApp Disconnected',
        description: 'WhatsApp session has been disconnected successfully',
      });
    },
    
    onError: (error, agentId, context) => {
      // Rollback optimistic update on error
      if (context?.previousData) {
        queryClient.setQueryData(['agent-details', agentId], context.previousData);
      }
      
      toast({
        title: 'Disconnect Failed',
        description: error.message || 'Failed to disconnect WhatsApp session',
        variant: 'destructive',
      });
    },
    
    ...options,
  });
}

/**
 * Helper function to check WhatsApp connection status
 */
export function isWhatsAppConnected(session: WhatsAppSession | null | undefined): boolean {
  return session?.is_active === true && session?.status === 'connected';
}

/**
 * Helper function to check if WhatsApp is waiting for QR scan
 */
export function isWaitingForQRScan(session: WhatsAppSession | null | undefined): boolean {
  return session?.status === 'qr_pending' && !session?.is_active;
}

/**
 * Helper function to get user-friendly status text
 */
export function getWhatsAppStatusText(session: WhatsAppSession | null | undefined): string {
  if (!session) return 'Not configured';
  if (session.is_active && session.status === 'connected') return 'Connected';
  if (session.status === 'qr_pending') return 'Waiting for QR scan';
  if (session.status === 'initializing') return 'Initializing...';
  return 'Disconnected';
}

