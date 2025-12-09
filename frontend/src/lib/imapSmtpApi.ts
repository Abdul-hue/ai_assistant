// IMAP/SMTP API Helper Functions
import { API_URL } from "@/config";

export interface ImapSmtpAccount {
  id: string;
  email: string;
  provider: string;
  imap_host: string;
  smtp_host: string;
  auth_method: string;
  is_active: boolean;
  created_at: string;
}

export interface ImapSmtpEmail {
  id: string;
  uid: number;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
  bodyHtml: string;
  date: string;
  isRead: boolean;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
  folder: string;
}

export interface ImapSmtpFolder {
  name: string;
  delimiter: string;
  attributes: string[];
  children: number;
}

export interface ProviderSettings {
  imap: {
    host: string;
    port: number;
    ssl: boolean;
  };
  smtp: {
    host: string;
    port: number;
    tls: boolean;
  };
  note?: string;
}

/**
 * Auto-detect provider settings for an email
 */
export const detectProviderSettings = async (email: string): Promise<ProviderSettings | null> => {
  try {
    const response = await fetch(`${API_URL}/api/imap-smtp/detect/${encodeURIComponent(email)}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to detect provider settings');
    }

    const data = await response.json();
    return data.success ? data.settings : null;
  } catch (error) {
    console.error('Error detecting provider:', error);
    return null;
  }
};

/**
 * Connect an IMAP/SMTP account
 */
export const connectImapSmtpAccount = async (accountData: {
  email: string;
  provider?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  imapUsername?: string;
  imapPassword: string;
  smtpUsername?: string;
  smtpPassword: string;
  useSsl?: boolean;
  useTls?: boolean;
  autoDetect?: boolean;
}): Promise<{ success: boolean; account?: ImapSmtpAccount; error?: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/imap-smtp/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(accountData),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || data.details || 'Failed to connect account',
      };
    }

    return {
      success: true,
      account: data.account,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to connect account',
    };
  }
};

/**
 * Get all IMAP/SMTP accounts for the current user
 */
export const getImapSmtpAccounts = async (): Promise<ImapSmtpAccount[]> => {
  try {
    const response = await fetch(`${API_URL}/api/imap-smtp/accounts`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch accounts');
    }

    const data = await response.json();
    return data.accounts || [];
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return [];
  }
};

/**
 * Fetch emails from an IMAP account
 */
export const fetchImapSmtpEmails = async (
  accountId: string,
  folder: string = 'INBOX',
  limit: number = 50
): Promise<ImapSmtpEmail[]> => {
  try {
    const params = new URLSearchParams({
      folder,
      limit: limit.toString(),
    });

    const response = await fetch(`${API_URL}/api/imap-smtp/emails/${accountId}?${params}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || errorData.message || 'Failed to fetch emails';
      const error: any = new Error(errorMessage);
      error.response = response;
      error.isAuthError = errorData.isAuthError || response.status === 401;
      throw error;
    }

    const data = await response.json();
    return data.emails || [];
  } catch (error: any) {
    console.error('Error fetching emails:', error);
    throw error; // Re-throw to allow caller to handle
  }
};

/**
 * Send email via SMTP
 */
export const sendImapSmtpEmail = async (
  accountId: string,
  emailData: {
    to: string;
    subject: string;
    body: string;
    html?: string;
    attachments?: Array<{
      filename: string;
      content: string;
      contentType?: string;
    }>;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/imap-smtp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        accountId,
        ...emailData,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to send email',
      };
    }

    return {
      success: true,
      messageId: data.messageId,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to send email',
    };
  }
};

/**
 * Get folders from an IMAP account
 */
export const getImapSmtpFolders = async (accountId: string): Promise<ImapSmtpFolder[]> => {
  try {
    const response = await fetch(`${API_URL}/api/imap-smtp/folders/${accountId}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || errorData.message || 'Failed to fetch folders';
      const error: any = new Error(errorMessage);
      error.response = response;
      error.isAuthError = errorData.isAuthError || response.status === 401;
      throw error;
    }

    const data = await response.json();
    return data.folders || [];
  } catch (error: any) {
    console.error('Error fetching folders:', error);
    throw error; // Re-throw to allow caller to handle
  }
};

/**
 * Delete email via IMAP
 */
export const deleteImapSmtpEmail = async (
  accountId: string,
  uid: number,
  folder: string = 'INBOX'
): Promise<{ success: boolean; error?: string }> => {
  try {
    const params = new URLSearchParams({ folder });
    const response = await fetch(
      `${API_URL}/api/imap-smtp/emails/${accountId}/${uid}?${params}`,
      {
        method: 'DELETE',
        credentials: 'include',
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to delete email',
      };
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to delete email',
    };
  }
};

/**
 * Move email to different folder
 */
export const moveImapSmtpEmail = async (
  accountId: string,
  uid: number,
  fromFolder: string,
  toFolder: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/imap-smtp/emails/${accountId}/${uid}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        fromFolder,
        toFolder,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to move email',
      };
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to move email',
    };
  }
};

/**
 * Disconnect an IMAP/SMTP account
 */
export const disconnectImapSmtpAccount = async (
  accountId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/imap-smtp/accounts/${accountId}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to disconnect account',
      };
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to disconnect account',
    };
  }
};

