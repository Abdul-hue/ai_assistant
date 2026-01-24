/**
 * React Query hooks for groups and contacts management
 * 
 * Provides hooks for fetching and managing groups and contacts for agents
 */

import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { API_URL } from '@/config.js';

export interface Group {
  id: string;
  agent_id: string;
  whatsapp_group_id: string;
  name: string;
  description: string | null;
  invite_code: string | null;
  participant_count: number;
  is_announcement: boolean;
  is_restricted: boolean;
  is_important: boolean;
  created_at: string | null;
  subject_changed_at: string | null;
  metadata: Record<string, any>;
  created_at_db: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  agent_id: string;
  name: string;
  phone_number: string;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  metadata?: Record<string, any>;
  is_important: boolean;
  created_at: string;
  updated_at: string;
}

async function fetchGroups(agentId: string): Promise<Group[]> {
  console.log('[useGroups] Fetching groups for agentId:', agentId);
  console.log('[useGroups] API URL:', `${API_URL}/api/groups/${agentId}`);
  
  const response = await fetch(`${API_URL}/api/groups/${agentId}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  console.log('[useGroups] Response status:', response.status, response.statusText);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    console.error('[useGroups] Error response:', errorData);
    throw new Error(errorData.message || errorData.error || 'Failed to fetch groups');
  }

  const data = await response.json();
  console.log('[useGroups] Groups fetched:', { count: data?.length || 0, groups: data });
  return data;
}

async function fetchContacts(agentId: string): Promise<Contact[]> {
  const response = await fetch(`${API_URL}/api/groups/contacts/${agentId}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    throw new Error(errorData.message || errorData.error || 'Failed to fetch contacts');
  }

  return response.json();
}

async function updateGroupImportance(groupId: string, isImportant: boolean): Promise<Group> {
  const response = await fetch(`${API_URL}/api/groups/${groupId}/important`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ is_important: isImportant }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    throw new Error(errorData.message || errorData.error || 'Failed to update group importance');
  }

  return response.json();
}

async function updateContactImportance(contactId: string, isImportant: boolean): Promise<Contact> {
  const response = await fetch(`${API_URL}/api/groups/contacts/${contactId}/important`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ is_important: isImportant }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: 'Unknown error',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    throw new Error(errorData.message || errorData.error || 'Failed to update contact importance');
  }

  return response.json();
}

export function useGroups(
  agentId: string | null,
  options?: Omit<UseQueryOptions<Group[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: ['groups', agentId],
    queryFn: () => fetchGroups(agentId!),
    enabled: !!agentId,
    ...options,
  });
}

export function useContacts(
  agentId: string | null,
  options?: Omit<UseQueryOptions<Contact[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: ['contacts', agentId],
    queryFn: () => fetchContacts(agentId!),
    enabled: !!agentId,
    ...options,
  });
}

export function useUpdateGroupImportance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ groupId, isImportant }: { groupId: string; isImportant: boolean }) =>
      updateGroupImportance(groupId, isImportant),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['groups', data.agent_id] });
    },
  });
}

export function useUpdateContactImportance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ contactId, isImportant }: { contactId: string; isImportant: boolean }) =>
      updateContactImportance(contactId, isImportant),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', data.agent_id] });
    },
  });
}
