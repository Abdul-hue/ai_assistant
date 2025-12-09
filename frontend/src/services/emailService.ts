/**
 * Enhanced Email Service
 * Provides filtering, folder management, and email operations
 */

import { supabase } from '@/integrations/supabase/client';
import { API_URL } from '@/config';

export interface EmailFilter {
  accountId: string;
  folder?: string;
  isRead?: boolean;
  isStarred?: boolean;
  limit?: number;
  offset?: number;
  searchQuery?: string;
}

export interface Email {
  id: string;
  uid: number;
  sender_email: string;
  sender_name: string;
  subject: string;
  body_text: string;
  body_html: string;
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  folder_name: string;
  attachments_count: number;
  email_account_id: string;
}

export interface Folder {
  name: string;
  displayName: string;
  type: string;
  totalEmails: number;
  unreadCount: number;
  canSelect: boolean;
  attributes: string[];
}

export interface FolderStats {
  emailCounts: Record<string, number>;
  unreadCounts: Record<string, number>;
}

/**
 * Get emails by filter from Supabase
 */
export async function getEmailsByFilter(filter: EmailFilter) {
  try {
    let query = supabase
      .from('emails')
      .select('*', { count: 'exact' })
      .eq('email_account_id', filter.accountId)
      .eq('is_deleted', false)
      .order('received_at', { ascending: false });

    // Apply folder filter
    if (filter.folder && filter.folder !== 'all_mail') {
      query = query.eq('folder_name', filter.folder);
    }

    // Apply read status filter
    if (filter.isRead !== undefined) {
      query = query.eq('is_read', filter.isRead);
    }

    // Apply star filter
    if (filter.isStarred !== undefined) {
      query = query.eq('is_starred', filter.isStarred);
    }

    // Apply search
    if (filter.searchQuery) {
      query = query.or(
        `subject.ilike.%${filter.searchQuery}%,body_text.ilike.%${filter.searchQuery}%,sender_email.ilike.%${filter.searchQuery}%`
      );
    }

    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    return {
      emails: (data || []) as Email[],
      total: count || 0,
    };
  } catch (error) {
    console.error('Error fetching emails:', error);
    throw error;
  }
}

/**
 * Get all folders for account
 */
export async function getFoldersForAccount(accountId: string): Promise<Folder[]> {
  try {
    const response = await fetch(
      `${API_URL}/api/folders/folders/${accountId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      }
    );

    const data = await response.json();

    if (!data.success) throw new Error(data.error);

    return data.data as Folder[];
  } catch (error) {
    console.error('Error fetching folders:', error);
    throw error;
  }
}

/**
 * Get folder statistics
 */
export async function getFolderStats(accountId: string): Promise<FolderStats> {
  try {
    const response = await fetch(
      `${API_URL}/api/folders/folder-stats/${accountId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      }
    );

    const data = await response.json();

    if (!data.success) throw new Error(data.error);

    return data.data as FolderStats;
  } catch (error) {
    console.error('Error fetching folder stats:', error);
    throw error;
  }
}

/**
 * Move email
 */
export async function moveEmail(
  accountId: string,
  uid: number,
  fromFolder: string,
  toFolder: string
) {
  try {
    const response = await fetch(`${API_URL}/api/folders/move-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        accountId,
        uid,
        fromFolder,
        toFolder,
      }),
    });

    const data = await response.json();

    if (!data.success) throw new Error(data.error);

    return data.data;
  } catch (error) {
    console.error('Error moving email:', error);
    throw error;
  }
}

/**
 * Delete email
 */
export async function deleteEmail(
  accountId: string,
  uid: number,
  folder: string
) {
  try {
    const response = await fetch(`${API_URL}/api/folders/delete-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        accountId,
        uid,
        folder,
      }),
    });

    const data = await response.json();

    if (!data.success) throw new Error(data.error);

    return data.data;
  } catch (error) {
    console.error('Error deleting email:', error);
    throw error;
  }
}

/**
 * Toggle star
 */
export async function toggleEmailStar(
  accountId: string,
  uid: number,
  folder: string,
  shouldStar: boolean
) {
  try {
    const response = await fetch(`${API_URL}/api/folders/toggle-star`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        accountId,
        uid,
        folder,
        shouldStar,
      }),
    });

    const data = await response.json();

    if (!data.success) throw new Error(data.error);

    return data.data;
  } catch (error) {
    console.error('Error toggling star:', error);
    throw error;
  }
}

/**
 * Toggle read
 */
export async function toggleEmailRead(
  accountId: string,
  uid: number,
  folder: string,
  shouldRead: boolean
) {
  try {
    const response = await fetch(`${API_URL}/api/folders/toggle-read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        accountId,
        uid,
        folder,
        shouldRead,
      }),
    });

    const data = await response.json();

    if (!data.success) throw new Error(data.error);

    return data.data;
  } catch (error) {
    console.error('Error toggling read:', error);
    throw error;
  }
}

