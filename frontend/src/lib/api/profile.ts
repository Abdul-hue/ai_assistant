import { API_URL } from '@/config';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  phone_number: string | null;
  country: string | null;
  avatar_url: string | null;
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

export async function fetchProfile(): Promise<Profile> {
  const response = await fetch(`${API_URL}/api/profile`, {
    credentials: 'include',
  });
  const data = await handleResponse<{ profile: Profile }>(response);
  return data.profile;
}

export async function updateProfile(payload: {
  full_name?: string;
  company_name?: string;
  phone_number?: string;
  country?: string;
}): Promise<Profile> {
  const response = await fetch(`${API_URL}/api/profile`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ profile: Profile }>(response);
  return data.profile;
}

export async function uploadAvatar(file: File): Promise<Profile> {
  const formData = new FormData();
  formData.append('avatar', file);

  const response = await fetch(`${API_URL}/api/profile/upload-avatar`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const data = await handleResponse<{ profile: Profile }>(response);
  return data.profile;
}

export async function deleteAvatar(): Promise<void> {
  const response = await fetch(`${API_URL}/api/profile/avatar`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await handleResponse(response);
}

