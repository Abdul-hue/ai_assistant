import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '@/config';
import { useToast } from '@/hooks/use-toast';
import type { Contact, ContactUploadResponse } from '@/types/contact.types';

interface UploadContactsParams {
  agentId: string;
  file: File;
}

interface ContactsResponse {
  contacts: ContactUploadResponse['contacts'];
  count: number;
}

export const useUploadContacts = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<ContactUploadResponse, Error, UploadContactsParams>({
    mutationFn: async ({ agentId, file }) => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_URL}/api/agents/${agentId}/contacts/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to upload contacts');
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: 'Contacts uploaded',
        description: `Successfully uploaded ${data.uploaded} out of ${data.total} contacts.`,
      });

      queryClient.invalidateQueries({ queryKey: ['contacts', variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ['contactCount', variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: error.message,
      });
    },
  });
};

export const useContacts = (agentId: string | null) => {
  return useQuery<ContactsResponse, Error>({
    queryKey: ['contacts', agentId],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/agents/${agentId}/contacts`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to fetch contacts');
      }

      return response.json();
    },
    enabled: Boolean(agentId),
  });
};

export const useDeleteContact = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<unknown, Error, { agentId: string; contactId: string }>({
    mutationFn: async ({ agentId, contactId }) => {
      const response = await fetch(`${API_URL}/api/agents/${agentId}/contacts/${contactId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to delete contact');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      toast({
        title: 'Contact deleted',
        description: 'The contact was removed successfully.',
      });
      queryClient.invalidateQueries({ queryKey: ['contacts', variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ['contactCount', variables.agentId] });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: error.message,
      });
    },
  });
};

export const useDeleteAllContacts = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<unknown, Error, string>({
    mutationFn: async (agentId) => {
      const response = await fetch(`${API_URL}/api/agents/${agentId}/contacts`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to delete contacts');
      }

      return response.json();
    },
    onSuccess: (_, agentId) => {
      toast({
        title: 'Contacts deleted',
        description: 'All contacts were removed successfully.',
      });
      queryClient.invalidateQueries({ queryKey: ['contacts', agentId] });
      queryClient.invalidateQueries({ queryKey: ['contactCount', agentId] });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: error.message,
      });
    },
  });
};

export const useUpdateContact = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<unknown, Error, { agentId: string; contactId: string; data: Partial<Contact> }>({
    mutationFn: async ({ agentId, contactId, data }) => {
      console.debug('Updating contact', { agentId, contactId, payload: data });

      const response = await fetch(`${API_URL}/api/agents/${agentId}/contacts/${contactId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to update contact');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      toast({
        title: 'Contact updated',
        description: 'The contact details were saved successfully.',
      });
      queryClient.invalidateQueries({ queryKey: ['contacts', variables.agentId] });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: error.message,
      });
    },
  });
};

interface CreateContactInput {
  agentId: string;
  data: {
    name: string;
    phone_number: string;
    email?: string;
    company?: string;
    notes?: string;
  };
}

export const useCreateContact = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<unknown, Error, CreateContactInput>({
    mutationFn: async ({ agentId, data }) => {
      const response = await fetch(`${API_URL}/api/agents/${agentId}/contacts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to create contact');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      toast({
        title: 'Contact added',
        description: 'New contact was added successfully.',
      });
      queryClient.invalidateQueries({ queryKey: ['contacts', variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ['contactCount', variables.agentId] });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Add contact failed',
        description: error.message,
      });
    },
  });
};

export const useContactCount = (agentId: string) => {
  return useQuery<{ count: number }, Error>({
    queryKey: ['contactCount', agentId],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/agents/${agentId}/contacts/count`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to fetch contact count');
      }

      return response.json();
    },
    enabled: Boolean(agentId),
  });
};

