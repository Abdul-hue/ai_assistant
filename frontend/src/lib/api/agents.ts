import { API_URL } from '@/config';

export interface Agent {
  id: string;
  agent_name: string;
  description?: string | null;
  whatsapp_phone_number?: string | null;
  persona?: string | null;
  avatar_url?: string | null;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || payload.message || 'Request failed');
  }
  return response.json();
}

export async function uploadAgentAvatar(agentId: string, file: File): Promise<Agent> {
  const formData = new FormData();
  formData.append('avatar', file);

  const response = await fetch(`${API_URL}/api/agents/${agentId}/avatar`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const data = await handleResponse<{ agent: Agent }>(response);
  return data.agent;
}

export async function deleteAgentAvatar(agentId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/agents/${agentId}/avatar`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await handleResponse(response);
}

export async function updateAgent(agentId: string, payload: {
  agent_name?: string;
  persona?: string | null;
  avatar_url?: string | null;
}): Promise<Agent> {
  console.log('[API] Updating agent:', { agentId, payload });
  
  const response = await fetch(`${API_URL}/api/agents/${agentId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('[API] Update failed:', errorData);
    throw new Error(errorData.error || errorData.message || 'Failed to update agent');
  }

  const responseData = await handleResponse<any>(response);
  console.log('[API] Raw response:', responseData);
  
  // Handle different response formats:
  // Format 1: { agent: Agent }
  // Format 2: { data: Agent, success: true, message: string }
  // Format 3: Agent object directly (if responseData itself is the agent)
  let agent: Agent | undefined;
  
  if (responseData?.agent) {
    agent = responseData.agent;
  } else if (responseData?.data) {
    agent = responseData.data;
  } else if (responseData?.id && responseData?.agent_name) {
    // Response is the agent object directly
    agent = responseData as Agent;
  }
  
  if (!agent) {
    console.error('[API] Invalid response structure - agent/data is missing:', responseData);
    throw new Error('Invalid response from server: agent data missing');
  }
  
  if (!agent.id) {
    console.error('[API] Invalid agent data - id is missing:', agent);
    throw new Error('Invalid response from server: agent ID missing');
  }
  
  if (!agent.agent_name) {
    console.error('[API] Invalid agent data - agent_name is missing:', agent);
    throw new Error('Invalid response from server: agent name missing');
  }
  
  console.log('[API] Agent updated successfully:', agent);
  return agent;
}

