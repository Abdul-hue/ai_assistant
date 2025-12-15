/**
 * React Query mutation hook for sending messages to agents
 * 
 * Handles message sending with optimistic updates and error handling
 */

import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { Message, SendMessagePayload, SendMessageResponse } from '@/types/message.types';
import { useToast } from '@/hooks/use-toast';
import { API_URL } from '@/config';

interface SendMessageVariables {
  agentId: string;
  message: string;
  contact_id?: string | null;
}

export const useSendMessage = (
  options?: Omit<UseMutationOptions<SendMessageResponse, Error, SendMessageVariables>, 'mutationFn'>
) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<SendMessageResponse, Error, SendMessageVariables>({
    mutationFn: async ({ agentId, message, contact_id }: SendMessageVariables) => {
      const response = await fetch(
        `${API_URL}/api/agents/${agentId}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, contact_id }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Unknown error',
          message: `HTTP ${response.status}: ${response.statusText}`,
        }));
        
        throw new Error(errorData.message || errorData.error || 'Failed to send message');
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      // Invalidate messages query to refetch and show new message
      queryClient.invalidateQueries({ queryKey: ['agent-messages', variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ['agent-chat-list'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to send message',
        description: error.message || 'An error occurred while sending the message',
        variant: 'destructive',
      });
    },
    ...options,
  });
};

