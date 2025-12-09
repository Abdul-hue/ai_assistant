const axios = require('axios');

/**
 * Call webhook/API when new email is received
 * @param {Object} emailData - The email data object
 * @param {string} accountId - The email account ID
 * @param {string} userId - The user ID who owns the account
 * @returns {Promise<Object>} Result object with success status
 */
async function callEmailWebhook(emailData, accountId, userId) {
  const webhookUrl = process.env.EXTERNAL_WEBHOOK_URL || process.env.EMAIL_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log('[EMAIL_WEBHOOK] No webhook URL configured, skipping');
    return { success: false, reason: 'no_webhook_url' };
  }

  try {
    // Parse attachments_meta if it's a string
    let attachmentsMeta = [];
    if (emailData.attachments_meta) {
      try {
        attachmentsMeta = typeof emailData.attachments_meta === 'string' 
          ? JSON.parse(emailData.attachments_meta) 
          : emailData.attachments_meta;
      } catch (e) {
        attachmentsMeta = [];
      }
    }

    const payload = {
      event: 'new_email',
      timestamp: new Date().toISOString(),
      account_id: accountId,
      user_id: userId,
      email: {
        id: emailData.id || null,
        uid: emailData.uid,
        subject: emailData.subject || '[No Subject]',
        sender_name: emailData.sender_name || '',
        sender_email: emailData.sender_email || '',
        recipient_email: emailData.recipient_email || '',
        body_text: emailData.body_text || '',
        body_html: emailData.body_html || '',
        received_at: emailData.received_at || new Date().toISOString(),
        folder_name: emailData.folder_name || 'INBOX',
        is_read: emailData.is_read || false,
        is_starred: emailData.is_starred || false,
        attachments_count: emailData.attachments_count || 0,
        attachments_meta: attachmentsMeta,
      }
    };

    const response = await axios.post(webhookUrl, payload, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json',
      }
    });

    console.log(`[EMAIL_WEBHOOK] ✅ Successfully called webhook for email UID ${emailData.uid} (${emailData.subject?.substring(0, 50) || 'No Subject'})`);
    return { success: true, status: response.status };
  } catch (error) {
    const errorMessage = error.response?.data || error.message;
    const statusCode = error.response?.status || 'N/A';
    console.error(`[EMAIL_WEBHOOK] ❌ Failed to call webhook for email UID ${emailData.uid}:`, errorMessage, `(Status: ${statusCode})`);
    return { 
      success: false, 
      error: errorMessage,
      status: statusCode 
    };
  }
}

module.exports = { callEmailWebhook };

