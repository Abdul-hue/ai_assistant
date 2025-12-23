const axios = require('axios');
const { supabaseAdmin } = require('../config/supabase');

/**
 * Call webhook/API when new email is received
 * Only sends if initial sync is completed and email is newer than webhook_enabled_at
 * @param {Object} emailData - The email data object
 * @param {string} accountId - The email account ID
 * @param {string} userId - The user ID who owns the account
 * @returns {Promise<Object>} Result object with success status
 */
async function callEmailWebhook(emailData, accountId, userId) {
  // Default webhook URL for email notifications
  const DEFAULT_EMAIL_WEBHOOK_URL = 'https://auto.nsolbpo.com/webhook/pa-email';
  
  const webhookUrl = process.env.EXTERNAL_WEBHOOK_URL || 
                     process.env.EMAIL_WEBHOOK_URL || 
                     DEFAULT_EMAIL_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log('[EMAIL_WEBHOOK] No webhook URL configured, skipping');
    return { success: false, reason: 'no_webhook_url' };
  }

  // CRITICAL: Check if initial sync is completed and webhook is enabled
  try {
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('initial_sync_completed, webhook_enabled_at')
      .eq('id', accountId)
      .single();

    if (accountError) {
      console.error(`[EMAIL_WEBHOOK] ❌ Error fetching account sync status:`, accountError.message);
      // Don't send webhook if we can't verify sync status (fail-safe)
      return { success: false, reason: 'database_error', error: accountError.message };
    }

    if (!account) {
      console.error(`[EMAIL_WEBHOOK] ❌ Account ${accountId} not found`);
      return { success: false, reason: 'account_not_found' };
    }

    // Check 1: Initial sync must be completed
    if (!account.initial_sync_completed) {
      console.log(`[EMAIL_WEBHOOK] ⏭️  Skipping webhook for UID ${emailData.uid} - Initial sync not completed`);
      return { success: false, reason: 'initial_sync_not_completed' };
    }

    // Check 2: Email must be received after webhook was enabled
    // If webhook_enabled_at is NULL but initial_sync_completed is TRUE, set it now and allow webhook
    if (!account.webhook_enabled_at) {
      console.warn(`[EMAIL_WEBHOOK] ⚠️  Account ${accountId} has initial_sync_completed=TRUE but webhook_enabled_at is NULL. Setting it now.`);
      // Set webhook_enabled_at to now to enable webhooks going forward
      const now = new Date().toISOString();
      await supabaseAdmin
        .from('email_accounts')
        .update({ webhook_enabled_at: now })
        .eq('id', accountId);
      // Allow webhook for this email (it's a new email, so it should trigger webhook)
      account.webhook_enabled_at = now;
    }

    // Validate email date exists
    const emailReceivedAtStr = emailData.received_at || emailData.date;
    if (!emailReceivedAtStr) {
      console.warn(`[EMAIL_WEBHOOK] ⚠️  Email UID ${emailData.uid} has no date, using current time`);
      // Use current time if email date is missing (shouldn't happen, but handle gracefully)
      emailData.received_at = new Date().toISOString();
    }

    const webhookEnabledAt = new Date(account.webhook_enabled_at).getTime();
    const emailReceivedAt = new Date(emailReceivedAtStr || emailData.received_at).getTime();
    
    // Validate dates are valid
    if (isNaN(webhookEnabledAt) || isNaN(emailReceivedAt)) {
      console.error(`[EMAIL_WEBHOOK] ❌ Invalid date format - webhook_enabled_at: ${account.webhook_enabled_at}, email date: ${emailReceivedAtStr}`);
      // Still try to send webhook if dates are invalid (better to send than miss)
      console.warn(`[EMAIL_WEBHOOK] ⚠️  Proceeding with webhook despite invalid dates`);
    } else if (emailReceivedAt < webhookEnabledAt) {
      // Only skip if email is significantly older (more than 1 hour before webhook was enabled)
      const timeDiff = webhookEnabledAt - emailReceivedAt;
      const oneHour = 60 * 60 * 1000;
      if (timeDiff > oneHour) {
        console.log(`[EMAIL_WEBHOOK] ⏭️  Skipping webhook for UID ${emailData.uid} - Email older than webhook enable time (email: ${new Date(emailReceivedAt).toISOString()}, enabled: ${account.webhook_enabled_at})`);
        return { success: false, reason: 'email_older_than_webhook_enable' };
      } else {
        // Email is close to webhook enable time, allow it (might be from initial sync)
        console.log(`[EMAIL_WEBHOOK] ⚠️  Email is slightly older than webhook_enabled_at but within 1 hour, allowing webhook`);
      }
    }
  } catch (checkError) {
    console.error(`[EMAIL_WEBHOOK] ❌ Error checking sync status:`, checkError.message);
    // Don't send webhook if check fails (fail-safe)
    return { success: false, reason: 'check_error', error: checkError.message };
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

