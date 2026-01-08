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
  needs_reconnection?: boolean;
  last_error?: string | null;
  last_connection_attempt?: string | null;
}

export interface ImapSmtpEmail {
  id: string;
  uid: number;
  from: string;
  fromEmail: string;
  fromName?: string;
  to: string;
  toEmail?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  date: string;
  timestamp?: number;
  isRead: boolean;
  isStarred?: boolean;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
  folder?: string;
  accountId?: string;
}

export interface ImapSmtpFolder {
  name: string;
  delimiter: string;
  attributes: string[];
  children: number;
}

export interface ProviderSettings {
  provider?: string;
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

export interface ProviderGuidance {
  title: string;
  steps: string[];
  links: {
    settings: string;
    appPassword: string;
    help: string;
  };
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
 * Get provider-specific setup guidance
 */
export const getProviderGuidance = (provider: string): ProviderGuidance | null => {
  if (provider === 'outlook') {
    return {
      title: 'Outlook/Microsoft 365 Setup',
      steps: [
        'Use your full email address as username',
        'If 2FA is enabled, create an App Password',
        'Enable IMAP in Outlook settings',
        'For Microsoft 365: Check with IT if needed',
      ],
      links: {
        settings: 'https://outlook.live.com/mail/0/options/mail/accounts',
        appPassword: 'https://account.microsoft.com/security',
        help: 'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353',
      },
    };
  } else if (provider === 'gmail') {
    return {
      title: 'Gmail Setup',
      steps: [
        'Enable 2-Step Verification',
        'Create App Password for Mail',
        'Enable IMAP in Gmail settings',
        'Use the 16-character App Password',
      ],
      links: {
        settings: 'https://mail.google.com/mail/u/0/#settings/fwdandpop',
        appPassword: 'https://myaccount.google.com/apppasswords',
        help: 'https://support.google.com/mail/answer/7126229',
      },
    };
  }
  
  return null;
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
 * ⚡ OPTIMIZED: Uses fast database-first endpoint
 */
export const fetchImapSmtpEmails = async (
  accountId: string,
  folder: string = 'INBOX',
  limit: number = 20
): Promise<ImapSmtpEmail[]> => {
  try {
    console.log(`📧 [API] Fetching emails for account ${accountId}, folder ${folder}, limit ${limit}`);
    
    const params = new URLSearchParams({
      folder,
      limit: limit.toString(),
    });

    // ✅ CHANGED: Use /emails-quick endpoint for fast database-first loading
    const response = await fetch(`${API_URL}/api/imap-smtp/emails-quick/${accountId}?${params}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: any = {};
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      
      console.error(`❌ [API] HTTP ${response.status}:`, errorData);
      const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`;
      const error: any = new Error(errorMessage);
      error.response = response;
      error.isAuthError = errorData.isAuthError || response.status === 401;
      throw error;
    }

    const data = await response.json();
    console.log(`✅ [API] Received ${data.emails?.length || 0} emails from ${data.source || 'unknown'} source`);
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch emails');
    }

    // Validate response structure
    if (!Array.isArray(data.emails)) {
      console.error('❌ [API] Response emails is not an array:', typeof data.emails);
      console.error('[API] Full response:', data);
      throw new Error('Invalid response format: emails is not an array');
    }

    // Validate each email has required fields
    const validEmails = data.emails.filter((email: any) => {
      const isValid = email.id && email.uid !== undefined && email.subject !== undefined;
      if (!isValid) {
        console.warn('⚠️ [API] Invalid email object:', email);
      }
      return isValid;
    });

    console.log(`✅ [API] Validated ${validEmails.length}/${data.emails.length} emails`);
    
    if (data.emails.length > 0 && validEmails.length === 0) {
      console.error('❌ [API] All emails failed validation');
      throw new Error('All emails failed validation');
    }

    return validEmails;
  } catch (error: any) {
    console.error('❌ [API] Error fetching emails:', error);
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

/**
 * Debug endpoint to check database state
 */
export const debugAccountState = async (
  accountId: string
): Promise<{
  success: boolean;
  account?: any;
  database?: any;
  syncState?: any[];
  diagnosis?: string;
  error?: string;
}> => {
  try {
    const response = await fetch(`${API_URL}/api/imap-smtp/debug/${accountId}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch debug info');
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to fetch debug info',
    };
  }
};

