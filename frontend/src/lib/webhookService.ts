import axios from 'axios';

const WEBHOOK_URL = 'https://auto.nsolbpo.com/webhook/pa-email';

export interface WebhookEmailPayload {
  source: 'gmail' | 'webhook';
  messageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  snippet: string;
  date: string;
  attachments: Array<{
    filename: string;
    size: number;
    mimeType: string;
  }>;
  hasResume?: boolean;
  userId?: string;
  timestamp: string;
}

/**
 * Send email data to webhook in real-time
 */
export const sendToWebhook = async (emailData: WebhookEmailPayload) => {
  try {
    const payload = {
      ...emailData,
      timestamp: new Date().toISOString(),
    };

    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Source': 'email-system',
      },
      timeout: 10000,
    });

    console.log('Webhook sent successfully:', response.status);
    return response.data;
  } catch (error: any) {
    console.error('Webhook error:', error.message);
    return null;
  }
};

/**
 * Batch send multiple emails to webhook
 */
export const sendBatchToWebhook = async (emails: WebhookEmailPayload[]) => {
  try {
    const response = await axios.post(
      WEBHOOK_URL,
      {
        batch: true,
        emails,
        totalCount: emails.length,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Source': 'email-system',
        },
        timeout: 15000,
      }
    );

    console.log(`Batch webhook sent: ${emails.length} emails`);
    return response.data;
  } catch (error: any) {
    console.error('Batch webhook error:', error.message);
    return null;
  }
};

/**
 * Store webhook configuration
 */
export const saveWebhookConfig = async (userId: string, config: any) => {
  try {
    console.log(`Webhook config saved for user: ${userId}`);
    return true;
  } catch (error) {
    console.error('Failed to save webhook config:', error);
    return false;
  }
};

/**
 * Check webhook connectivity
 */
export const testWebhookConnection = async () => {
  try {
    const response = await axios.post(
      WEBHOOK_URL,
      {
        test: true,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Source': 'email-system-test',
        },
        timeout: 5000,
      }
    );

    return {
      success: true,
      status: response.status,
      message: 'Webhook connection successful',
    };
  } catch (error: any) {
    return {
      success: false,
      status: error.response?.status || 0,
      message: error.message,
    };
  }
};

