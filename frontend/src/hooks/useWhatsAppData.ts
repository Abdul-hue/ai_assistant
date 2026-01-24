/**
 * React Query hooks for WhatsApp contacts and groups
 * Fetches real WhatsApp data from Baileys connection
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// WhatsApp Contact interface
export interface WhatsAppContact {
  id: string;
  name: string;
  phone: string;
  is_important: boolean;
  updated_at: string;
}

// WhatsApp Group interface
export interface WhatsAppGroup {
  id: string;
  groupName: string;
  is_important: boolean;
  updated_at: string;
}

/**
 * Fetch WhatsApp contacts for an agent
 */
export function useWhatsAppContacts(agentId: string) {
  const { toast } = useToast();

  return useQuery<WhatsAppContact[], Error>({
    queryKey: ['whatsapp-contacts', agentId],
    queryFn: async () => {
      console.log('[useWhatsAppContacts] Fetching contacts for agent:', agentId);
      const response = await fetch(`${API_URL}/api/whatsapp/contacts/${agentId}`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('[useWhatsAppContacts] Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Unknown error',
          message: `HTTP ${response.status}: ${response.statusText}`,
        }));

        console.log('[useWhatsAppContacts] Error response:', errorData);

        if (response.status === 400) {
          // WhatsApp not connected - this is expected, don't show error
          console.log('[useWhatsAppContacts] WhatsApp not connected, returning empty array');
          return [];
        }

        throw new Error(errorData.message || errorData.error || 'Failed to fetch WhatsApp contacts');
      }

      const data = await response.json();
      console.log('[useWhatsAppContacts] Fetched contacts:', data.length);
      return data;
    },
    enabled: !!agentId,
    staleTime: 30000, // 30 seconds
    retry: 1,
    onSuccess: (data) => {
      console.log('[useWhatsAppContacts] Successfully loaded', data.length, 'contacts');
    },
    onError: (error) => {
      console.error('[useWhatsAppContacts] Error:', error);
      // Only show error if it's not a "not connected" error
      if (!error.message.includes('not connected') && !error.message.includes('WhatsApp not connected')) {
        toast({
          variant: 'destructive',
          title: 'Failed to load WhatsApp contacts',
          description: error.message,
        });
      }
    },
  });
}

/**
 * Fetch WhatsApp groups from database (synced groups)
 */
export function useWhatsAppGroups(agentId: string) {
  const { toast } = useToast();

  return useQuery<WhatsAppGroup[], Error>({
    queryKey: ['whatsapp-groups', agentId],
    queryFn: async () => {
      console.log('[useWhatsAppGroups] Fetching groups for agent:', agentId);
      const response = await fetch(`${API_URL}/api/whatsapp/groups/${agentId}`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('[useWhatsAppGroups] Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Unknown error',
          message: `HTTP ${response.status}: ${response.statusText}`,
        }));

        console.log('[useWhatsAppGroups] Error response:', errorData);

        if (response.status === 400) {
          // WhatsApp not connected - this is expected, don't show error
          console.log('[useWhatsAppGroups] WhatsApp not connected, returning empty array');
          return [];
        }

        throw new Error(errorData.message || errorData.error || 'Failed to fetch WhatsApp groups');
      }

      const data = await response.json();
      console.log('[useWhatsAppGroups] Fetched groups:', data.length);
      return data;
    },
    enabled: !!agentId,
    staleTime: 30000, // 30 seconds
    retry: 1,
    onSuccess: (data) => {
      console.log('[useWhatsAppGroups] Successfully loaded', data.length, 'groups');
    },
    onError: (error) => {
      console.error('[useWhatsAppGroups] Error:', error);
      // Only show error if it's not a "not connected" error
      if (!error.message.includes('not connected') && !error.message.includes('WhatsApp not connected')) {
        toast({
          variant: 'destructive',
          title: 'Failed to load WhatsApp groups',
          description: error.message,
        });
      }
    },
  });
}

/**
 * Toggle important status for a contact
 */
export function useToggleContactImportant(agentId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ contactId, is_important }: { contactId: string; is_important: boolean }) => {
      const response = await fetch(`${API_URL}/api/whatsapp/contacts/${contactId}/important`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_important }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Unknown error',
        }));
        throw new Error(errorData.error || 'Failed to update contact');
      }

      return response.json();
    },
    onMutate: async ({ contactId, is_important }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['whatsapp-contacts', agentId] });

      // Snapshot previous value
      const previousContacts = queryClient.getQueryData<WhatsAppContact[]>(['whatsapp-contacts', agentId]);

      // Optimistically update
      queryClient.setQueryData<WhatsAppContact[]>(['whatsapp-contacts', agentId], (old) => {
        if (!old) return old;
        return old.map((contact) =>
          contact.id === contactId ? { ...contact, is_important } : contact
        );
      });

      return { previousContacts };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousContacts) {
        queryClient.setQueryData(['whatsapp-contacts', agentId], context.previousContacts);
      }
      toast({
        variant: 'destructive',
        title: 'Failed to update contact',
        description: error.message,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-contacts', agentId] });
    },
  });
}

/**
 * Toggle important status for a group
 */
export function useToggleGroupImportant(agentId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ groupId, is_important }: { groupId: string; is_important: boolean }) => {
      const response = await fetch(`${API_URL}/api/whatsapp/groups/${groupId}/important`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_important }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Unknown error',
        }));
        throw new Error(errorData.error || 'Failed to update group');
      }

      return response.json();
    },
    onMutate: async ({ groupId, is_important }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['whatsapp-groups', agentId] });

      // Snapshot previous value
      const previousGroups = queryClient.getQueryData<WhatsAppGroup[]>(['whatsapp-groups', agentId]);

      // Optimistically update
      queryClient.setQueryData<WhatsAppGroup[]>(['whatsapp-groups', agentId], (old) => {
        if (!old) return old;
        return old.map((group) =>
          group.id === groupId ? { ...group, is_important } : group
        );
      });

      return { previousGroups };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousGroups) {
        queryClient.setQueryData(['whatsapp-groups', agentId], context.previousGroups);
      }
      toast({
        variant: 'destructive',
        title: 'Failed to update group',
        description: error.message,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-groups', agentId] });
    },
  });
}
