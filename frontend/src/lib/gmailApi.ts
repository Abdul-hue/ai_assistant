// Gmail API Helper Functions (Backend API Integration)
import { API_URL } from "@/config";
// Webhook calls removed - only backend sends new emails to webhook

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  bodyHtml: string;
  attachments: Array<{
    filename: string;
    mimeType: string;
    attachmentId: string;
    size: number;
  }>;
  hasResume: boolean;
}

export interface EmailData {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  snippet: string;
  attachments: Array<{
    filename: string;
    mimeType: string;
    attachmentId: string;
    size: number;
  }>;
  hasResume: boolean;
}

export interface GmailMessagesResponse {
  success: boolean;
  messages: EmailData[];
  nextPageToken?: string;
}

// Webhook sending removed - handled by backend for new emails only

/**
 * Search Gmail messages with webhook support
 */
export const searchGmailMessages = async (
  query: string = "",
  maxResults: number = 20,
  pageToken?: string,
  userId?: string
): Promise<GmailMessagesResponse> => {
  try {
    const params = new URLSearchParams({
      maxResults: maxResults.toString(),
    });

    if (query) {
      params.append("query", query);
    }

    if (pageToken) {
      params.append("pageToken", pageToken);
    }

    const response = await fetch(
      `${API_URL}/api/gmail/messages?${params.toString()}`,
      {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      const errorMessage = error.message || `Gmail API error: ${response.statusText}`;
      
      // Check for metadata scope error
      if (errorMessage.includes("Metadata scope") || errorMessage.includes("does not support 'q' parameter")) {
        throw new Error("Gmail scope error: Your Gmail connection needs to be updated. Please disconnect and reconnect your Gmail account in Settings to get the correct permissions.");
      }
      
      throw new Error(errorMessage);
    }

    const data: GmailMessagesResponse = await response.json();
    
    // Webhook sending removed - handled by backend for new emails only
    
    return data;
  } catch (error: any) {
    console.error("Gmail messages search error:", error);
    throw error;
  }
};

/**
 * Get full Gmail message details with webhook support
 */
export const getGmailMessage = async (
  messageId: string,
  userId?: string
): Promise<GmailMessage> => {
  try {
    const response = await fetch(
      `${API_URL}/api/gmail/messages/${messageId}`,
      {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to fetch message: ${response.statusText}`);
    }

    const data = await response.json();
    const message = data.message;
    
    // Webhook sending removed - handled by backend for new emails only
    
    return message;
  } catch (error: any) {
    console.error("Gmail message fetch error:", error);
    throw error;
  }
};

/**
 * Get email from Supabase by messageId (Gmail provider message ID)
 * This retrieves emails that were saved to the database via webhook
 */
export const getGmailMessageByMessageId = async (
  messageId: string
): Promise<GmailMessage> => {
  try {
    const response = await fetch(
      `${API_URL}/api/gmail/messages/by-message-id/${messageId}`,
      {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to fetch message by messageId: ${response.statusText}`);
    }

    const data = await response.json();
    return data.message;
  } catch (error: any) {
    console.error("Gmail message fetch by messageId error:", error);
    throw error;
  }
};

/**
 * Download attachment from Gmail
 */
export const downloadGmailAttachment = async (
  messageId: string,
  attachmentId: string
): Promise<Blob> => {
  try {
    const response = await fetch(
      `${API_URL}/api/gmail/messages/${messageId}/attachments/${attachmentId}`,
      {
        method: "GET",
        credentials: "include",
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to download attachment: ${error}`);
    }

    return await response.blob();
  } catch (error: any) {
    console.error("Gmail attachment download error:", error);
    throw error;
  }
};

/**
 * Send email via Gmail
 */
export const sendGmailEmail = async (
  to: string,
  subject: string,
  body: string,
  htmlBody?: string
): Promise<{ success: boolean; messageId: string; message: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/gmail/send`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        subject,
        body,
        htmlBody: htmlBody || body,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to send email: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Gmail send error:", error);
    throw error;
  }
};

/**
 * Reply to an email
 */
export const replyToGmailEmail = async (
  messageId: string,
  body: string,
  htmlBody?: string
): Promise<{ success: boolean; messageId: string; message: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/emails/${messageId}/reply`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        replyBody: body,
        isHtml: !!htmlBody,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to send reply: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Gmail reply error:", error);
    throw error;
  }
};

/**
 * Forward an email
 */
export const forwardGmailEmail = async (
  messageId: string,
  to: string,
  body: string,
  htmlBody?: string
): Promise<{ success: boolean; messageId: string; message: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/gmail/messages/${messageId}/forward`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        body,
        htmlBody: htmlBody || body,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to forward email: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Gmail forward error:", error);
    throw error;
  }
};

/**
 * Delete an email
 */
export const deleteGmailEmail = async (messageId: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/emails/${messageId}/delete`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to delete email: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Gmail delete error:", error);
    throw error;
  }
};

/**
 * Archive an email
 */
export const archiveGmailEmail = async (messageId: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/emails/${messageId}/archive`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to archive email: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Gmail archive error:", error);
    throw error;
  }
};

/**
 * Star or unstar an email
 */
export const starGmailEmail = async (
  messageId: string,
  starred: boolean
): Promise<{ success: boolean; starred: boolean }> => {
  try {
    const response = await fetch(`${API_URL}/api/emails/${messageId}/star`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ star: starred }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to update star status: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Gmail star error:", error);
    throw error;
  }
};

/**
 * Mark email as read or unread
 */
export const markGmailEmailAsRead = async (
  messageId: string,
  read: boolean
): Promise<{ success: boolean; isRead: boolean }> => {
  try {
    const response = await fetch(`${API_URL}/api/emails/${messageId}/read`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isRead: read }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to update read status: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Gmail read status error:", error);
    throw error;
  }
};

/**
 * Get the most likely CV/Resume attachment from an email
 */
export const getResumeAttachment = (email: EmailData) => {
  if (email.attachments.length === 0) return null;

  // Priority 1: Files with "resume" or "cv" in name
  const resumeFile = email.attachments.find((att) => {
    const filename = att.filename.toLowerCase();
    return (
      filename.includes("resume") ||
      filename.includes("cv") ||
      filename.includes("curriculum")
    );
  });

  if (resumeFile) return resumeFile;

  // Priority 2: First PDF or Word document
  const docFile = email.attachments.find(
    (att) =>
      att.mimeType.includes("pdf") ||
      att.mimeType.includes("document") ||
      att.mimeType.includes("msword")
  );

  return docFile || email.attachments[0];
};

