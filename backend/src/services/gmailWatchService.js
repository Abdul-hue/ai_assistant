const { google } = require('googleapis');
// axios removed - no longer sending to webhook
// const axios = require('axios');
const { supabaseAdmin } = require('../config/supabase');

// Webhook URL removed - emails are only saved to Supabase, not sent to external webhook
// const WEBHOOK_URL = process.env.EXTERNAL_WEBHOOK_URL || 'https://auto.nsolbpo.com/webhook/pa-email';

/**
 * Start watching Gmail for new emails
 * Call this once when user connects
 */
const startGmailWatch = async (auth, userId, io) => {
  try {
    console.log(`📧 Starting Gmail watch for user: ${userId}`);
    
    const gmail = google.gmail({ version: 'v1', auth });
    
    // Check if we have a topic name configured
    const topicName = process.env.GMAIL_TOPIC || `projects/${process.env.GOOGLE_PROJECT_ID}/topics/gmail-notifications`;
    
    if (!process.env.GOOGLE_PROJECT_ID) {
      console.warn('⚠️  GOOGLE_PROJECT_ID not set. Gmail watch will use polling instead of Pub/Sub.');
      // Fallback to polling mode
      return { watchMode: 'polling' };
    }

    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: topicName,
        labelIds: ['INBOX'],
      },
    });

    console.log('✅ Gmail watch started:', {
      historyId: response.data.historyId,
      expiration: response.data.expiration,
    });

    return {
      watchMode: 'pubsub',
      historyId: response.data.historyId,
      expiration: response.data.expiration,
    };
  } catch (error) {
    console.error('❌ Failed to start Gmail watch:', error.message);
    // Don't throw - fallback to polling
    console.log('📡 Falling back to polling mode');
    return { watchMode: 'polling' };
  }
};

/**
 * Handle Pub/Sub notification from Gmail
 * This is called when new email arrives via real-time push notification
 * 
 * Flow:
 * 1. Gmail sends Pub/Sub notification with historyId
 * 2. We fetch history changes to get new message IDs
 * 3. For each new message, fetch full email from Gmail API
 * 4. Save email immediately to Supabase (single source of truth)
 * 5. Optionally broadcast via WebSocket (frontend can listen if connected)
 * 
 * NOTE: Frontend does NOT use Supabase realtime subscriptions.
 * Frontend only fetches emails on page load/refresh.
 */
const handleGmailNotification = async (userId, historyId, auth, io) => {
  try {
    console.log(`📬 Processing real-time Gmail notification for user: ${userId}, historyId: ${historyId}`);
    
    // Get email account ID for database operations
    const { data: emailAccount } = await supabaseAdmin
      .from('email_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .eq('is_active', true)
      .single();
    
    if (!emailAccount) {
      console.warn(`⚠️  No email account found for user: ${userId}`);
      return null;
    }
    
    const gmail = google.gmail({ version: 'v1', auth });

    // Get the history changes since last historyId
    // This tells us which messages were added
    const historyResponse = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
    });

    const history = historyResponse.data.history || [];
    console.log(`📧 Found ${history.length} history entries with new messages`);

    let savedCount = 0;
    let errorCount = 0;

    // Process each history entry
    for (const entry of history) {
      if (entry.messagesAdded) {
        for (const msg of entry.messagesAdded) {
          const messageId = msg.message?.id;
          if (messageId) {
            try {
              // Fetch full message details from Gmail API
              console.log(`   📥 Fetching email ${messageId} from Gmail API...`);
              const emailData = await getFullEmailMessage(auth, messageId, userId);
              
              if (emailData) {
                console.log(`   ✅ Fetched: ${emailData.subject}`);

                // 1. SAVE TO SUPABASE IMMEDIATELY (single source of truth)
                // This is the critical step - save instantly so frontend sees it on refresh
                await saveEmailToSupabase(emailData, userId, emailAccount.id);
                console.log(`   💾 Saved to Supabase with messageId: ${emailData.id}`);
                savedCount++;

                // 2. OPTIONAL: Broadcast to frontend via WebSocket (if connected)
                // Frontend can listen for this, but it's not required
                // Frontend will see the email on next page load/refresh from Supabase
                if (io) {
                  io.to(userId).emit('new_email', emailData);
                  console.log(`   📡 Broadcasted to frontend via WebSocket (if connected)`);
                }
              }
            } catch (error) {
              console.error(`   ❌ Error processing message ${messageId}:`, error.message);
              errorCount++;
            }
          }
        }
      }
    }

    console.log(`✅ Notification processing complete: ${savedCount} saved, ${errorCount} errors`);
    return {
      historyId: historyResponse.data.historyId,
      savedCount,
      errorCount,
    };
  } catch (error) {
    console.error('❌ Error handling Gmail notification:', error.message);
    throw error;
  }
};

/**
 * Get full message details from Gmail
 */
const getFullEmailMessage = async (auth, messageId, userId) => {
  try {
    const gmail = google.gmail({ version: 'v1', auth });

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const message = response.data;
    const headers = message.payload?.headers || [];

    const getHeader = (name) => {
      return headers.find((h) => h.name === name)?.value || '';
    };

    const from = getHeader('From');
    const to = getHeader('To');
    const subject = getHeader('Subject') || '(No subject)';
    const date = getHeader('Date');
    const snippet = message.snippet || '';

    // Extract body
    let body = '';
    let bodyHtml = '';
    const extractBody = (parts) => {
      if (!parts) return;
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        if (part.mimeType === 'text/html' && part.body?.data) {
          bodyHtml = Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        if (part.parts) {
          extractBody(part.parts);
        }
      }
    };
    extractBody(message.payload?.parts || []);

    // Extract avatar initials from email
    const emailMatch = from.match(/([a-zA-Z]+)@/);
    const avatar = emailMatch ? emailMatch[1].substring(0, 2).toUpperCase() : 'EM';

    // Check for attachments
    const attachments = extractAttachments(message.payload?.parts || []);

    // Format time
    const emailDate = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - emailDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    let time = '';
    if (diffMins < 1) {
      time = 'now';
    } else if (diffMins < 60) {
      time = `${diffMins}m ago`;
    } else if (diffHours < 24) {
      time = `${diffHours}h ago`;
    } else if (diffDays < 7) {
      time = `${diffDays}d ago`;
    } else {
      time = emailDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    }

    // Extract from email
    const fromEmailMatch = from.match(/<([^>]+)>/);
    const fromEmail = fromEmailMatch ? fromEmailMatch[1] : from;
    const fromName = from.replace(/<[^>]+>/, '').trim() || fromEmail;

    const emailData = {
      id: messageId,
      messageId,
      threadId: message.threadId,
      from: fromName,
      fromEmail,
      to,
      subject,
      snippet,
      body: body || bodyHtml || snippet,
      bodyHtml: bodyHtml || '',
      date: date || new Date(parseInt(message.internalDate)).toISOString(),
      time,
      avatar,
      hasAttachment: attachments.length > 0,
      attachments: attachments.map(att => ({
        filename: att.filename,
        size: att.size,
        mimeType: att.mimeType,
        attachmentId: att.attachmentId,
      })),
      hasResume: attachments.some(att => {
        const filename = att.filename.toLowerCase();
        return (filename.includes('resume') || filename.includes('cv') || filename.includes('curriculum')) &&
          (att.mimeType.includes('pdf') || att.mimeType.includes('document') || att.mimeType.includes('msword'));
      }),
    };

    return emailData;
  } catch (error) {
    console.error('❌ Error getting full message:', error.message);
    return null;
  }
};

/**
 * Check if email already exists in Supabase
 * Returns true if email exists in database
 */
const isEmailInSupabase = async (messageId, userId) => {
  try {
    // Check in emails table if this message already exists
    const { data, error } = await supabaseAdmin
      .from('emails')
      .select('id, provider_message_id')
      .eq('provider_message_id', messageId)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking email in Supabase:', error);
      return false;
    }

    // If email exists in database, it means it was already saved
    return !!data;
  } catch (error) {
    console.error('Error checking email in Supabase:', error);
    return false;
  }
};

/**
 * Save email to Supabase with messageId
 * This function saves emails to the database so they can be retrieved by messageId later
 * Used for both webhook emails and initial/historical emails
 */
const saveEmailToSupabase = async (emailData, userId, emailAccountId) => {
  try {
    // Extract recipient email
    const toMatch = emailData.to ? emailData.to.match(/<([^>]+)>/) : null;
    const recipientEmail = toMatch ? toMatch[1] : (emailData.to || null);

    // Save email to database with messageId (provider_message_id)
    const { data, error } = await supabaseAdmin
      .from('emails')
      .upsert({
        email_account_id: emailAccountId,
        provider_message_id: emailData.id, // Gmail messageId - save this to retrieve email later
        thread_id: emailData.threadId || null,
        sender_email: emailData.fromEmail || emailData.from,
        sender_name: emailData.from,
        recipient_email: recipientEmail,
        recipient_name: null,
        subject: emailData.subject || null,
        body_text: emailData.body || null,
        body_html: emailData.bodyHtml || null,
        is_read: false,
        is_starred: false,
        received_at: emailData.date ? new Date(emailData.date) : new Date(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'email_account_id,provider_message_id',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error('❌ Error saving email to Supabase:', error);
      throw error;
    }

    console.log(`✅ Email saved to Supabase with messageId: ${emailData.id}`);
    console.log(`   Retrieve using: GET /api/gmail/messages/by-message-id/${emailData.id}`);
    return data;
  } catch (error) {
    console.error('❌ Error saving email to Supabase:', error);
    throw error;
  }
};

/**
 * Mark email as sent to webhook in database
 * Saves email to Supabase with messageId for later retrieval
 * @deprecated Use saveEmailToSupabase instead - this function is kept for backward compatibility
 */
const markEmailAsSentToWebhook = async (emailData, userId, emailAccountId) => {
  return saveEmailToSupabase(emailData, userId, emailAccountId);
};

/**
 * @deprecated Webhook sending removed - emails are only saved to Supabase
 * This function is kept for backward compatibility but does nothing
 */
const sendToWebhook = async (emailData, userId, emailAccountId) => {
  // Webhook sending removed - only save to Supabase
  console.log(`📝 Webhook sending disabled - email ${emailData.id} saved to Supabase only`);
  return null;
};

/**
 * Extract attachments from message parts
 */
function extractAttachments(parts) {
  const attachments = [];

  const traverse = (parts) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          size: parseInt(part.body.size || '0'),
          mimeType: part.mimeType || 'application/octet-stream',
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) {
        traverse(part.parts);
      }
    }
  };

  traverse(parts);
  return attachments;
}

/**
 * Get emails from Supabase database (cached)
 * Don't call Gmail API every time!
 */
const getEmailsFromDatabase = async (userId, maxResults = 20) => {
  try {
    // Get email account ID for this user
    const { data: emailAccount, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .eq('is_active', true)
      .single();

    if (accountError || !emailAccount) {
      console.warn(`⚠️  No email account found for user: ${userId}`);
      return [];
    }

    // Get emails from database
    const { data, error } = await supabaseAdmin
      .from('emails')
      .select('*')
      .eq('email_account_id', emailAccount.id)
      .order('received_at', { ascending: false })
      .limit(maxResults);

    if (error) {
      console.error('❌ Database error loading emails:', error);
      return [];
    }

    if (data && data.length > 0) {
      console.log(`📦 Loaded ${data.length} emails from Supabase cache`);
      
      // Format emails for frontend (match Gmail API format)
      const formattedEmails = data.map(email => ({
        id: email.provider_message_id,
        messageId: email.provider_message_id,
        threadId: email.thread_id,
        from: email.sender_name || email.sender_email,
        fromEmail: email.sender_email,
        to: email.recipient_email,
        subject: email.subject || '(No subject)',
        snippet: email.body_text?.substring(0, 100) || '',
        body: email.body_text || '',
        bodyHtml: email.body_html || '',
        date: email.received_at,
        isRead: email.is_read,
        isStarred: email.is_starred,
        attachments: [],
        hasResume: false,
      }));

      return formattedEmails;
    }

    return [];
  } catch (error) {
    console.error('❌ Error loading emails from database:', error);
    return [];
  }
};

/**
 * Get initial emails - ALWAYS from Gmail API (no cache)
 * Direct fetch from Gmail API every time
 */
const getInitialEmails = async (auth, userId, maxResults = 20) => {
  try {
    console.log('📧 Fetching emails directly from Gmail API (no cache)...');
    
    // Get email account ID for this user (needed for saving to Supabase for notifications)
    const { data: emailAccount, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .eq('is_active', true)
      .single();

    if (accountError || !emailAccount) {
      console.warn(`⚠️  No email account found for user: ${userId}`);
      return [];
    }

    const gmail = google.gmail({ version: 'v1', auth });

    // ALWAYS fetch from Gmail API directly
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox',
      maxResults,
    });

    const messages = response.data.messages || [];
    console.log(`📧 Found ${messages.length} messages in Gmail API`);

    // Get full details for each message
    const emails = await Promise.all(
      messages.map((msg) => getFullEmailMessage(auth, msg.id, userId))
    );

    // Filter out null values
    const validEmails = emails.filter((e) => e !== null);

    // Still save to Supabase for real-time push notifications (optional)
    // But we don't read from it - always fetch fresh from Gmail
    console.log(`💾 Saving ${validEmails.length} emails to Supabase for notifications...`);
    for (const emailData of validEmails) {
      try {
        await saveEmailToSupabase(emailData, userId, emailAccount.id);
      } catch (saveError) {
        console.error(`   ⚠️  Failed to save email ${emailData.id}:`, saveError.message);
        // Continue even if save fails - we still return the emails
      }
    }

    console.log(`✅ Retrieved ${validEmails.length} emails directly from Gmail API`);
    return validEmails;
  } catch (error) {
    console.error('❌ Error getting emails from Gmail API:', error.message);
    throw error; // Throw error so caller can handle it
  }
};

/**
 * Get only NEW emails since last check
 * For real-time updates and refresh button
 */
const getNewEmails = async (userId, lastCheck = null, maxResults = 10) => {
  try {
    // Get email account ID for this user
    const { data: emailAccount, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .eq('is_active', true)
      .single();

    if (accountError || !emailAccount) {
      return [];
    }

    let query = supabaseAdmin
      .from('emails')
      .select('*')
      .eq('email_account_id', emailAccount.id)
      .order('received_at', { ascending: false })
      .limit(maxResults);

    // If lastCheck is provided, only get emails after that time
    if (lastCheck) {
      query = query.gt('received_at', lastCheck.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error getting new emails:', error);
      return [];
    }

    if (data && data.length > 0) {
      console.log(`🆕 Found ${data.length} new emails since ${lastCheck || 'beginning'}`);
      
      // Format emails for frontend
      const formattedEmails = data.map(email => ({
        id: email.provider_message_id,
        messageId: email.provider_message_id,
        threadId: email.thread_id,
        from: email.sender_name || email.sender_email,
        fromEmail: email.sender_email,
        to: email.recipient_email,
        subject: email.subject || '(No subject)',
        snippet: email.body_text?.substring(0, 100) || '',
        body: email.body_text || '',
        bodyHtml: email.body_html || '',
        date: email.received_at,
        isRead: email.is_read,
        isStarred: email.is_starred,
        attachments: [],
        hasResume: false,
      }));

      return formattedEmails;
    }

    return [];
  } catch (error) {
    console.error('❌ Error in getNewEmails:', error);
    return [];
  }
};

/**
 * Setup Pub/Sub webhook endpoint handler
 * This is called when Gmail sends a notification
 */
const handlePubSubWebhook = async (message, auth, io) => {
  try {
    // Decode Pub/Sub message
    if (!message || !message.message) {
      console.warn('⚠️  Invalid Pub/Sub message format');
      return false;
    }

    const messageData = JSON.parse(
      Buffer.from(message.message.data, 'base64').toString('utf-8')
    );

    const { emailAddress, historyId } = messageData;
    console.log(`📧 Gmail notification for ${emailAddress}, historyId: ${historyId}`);

    // Process the notification
    await handleGmailNotification(emailAddress, historyId, auth, io);

    return true;
  } catch (error) {
    console.error('❌ Error handling Pub/Sub webhook:', error.message);
    return false;
  }
};

/**
 * Check for new emails for all active Gmail accounts
 * This function is called by a scheduled job every 15 minutes
 * It fetches new emails from Gmail API and saves them to Supabase
 */
const checkForNewEmailsForAllAccounts = async () => {
  try {
    console.log('\n🔄 Scheduled job: Checking for new emails for all accounts...');
    
    // Get all active Gmail accounts
    const { data: emailAccounts, error: accountsError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id, access_token, refresh_token, token_expires_at, email')
      .eq('provider', 'gmail')
      .eq('is_active', true);

    if (accountsError) {
      console.error('❌ Error fetching email accounts:', accountsError);
      return;
    }

    if (!emailAccounts || emailAccounts.length === 0) {
      console.log('   ℹ️  No active Gmail accounts found');
      return;
    }

    console.log(`   📧 Found ${emailAccounts.length} active Gmail account(s)`);

    // Process each account
    for (const account of emailAccounts) {
      try {
        await checkForNewEmailsForAccount(account);
      } catch (accountError) {
        console.error(`   ❌ Error processing account ${account.email}:`, accountError.message);
        // Continue with next account even if one fails
      }
    }

    console.log('✅ Scheduled email check completed');
  } catch (error) {
    console.error('❌ Error in scheduled email check:', error.message);
  }
};

/**
 * Check for new emails for a specific account
 * Fetches from Gmail API and saves only new emails to Supabase
 */
const checkForNewEmailsForAccount = async (account) => {
  try {
    const { id: emailAccountId, user_id: userId, access_token, refresh_token, token_expires_at, email } = account;

    console.log(`   🔍 Checking emails for: ${email}`);

    // Create OAuth client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // Set credentials
    const expiryDate = token_expires_at ? new Date(token_expires_at).getTime() : null;
    oauth2Client.setCredentials({
      access_token,
      refresh_token,
      expiry_date: expiryDate,
    });

    // Refresh token if needed (less than 5 minutes left)
    if (expiryDate && (expiryDate - Date.now() < 5 * 60 * 1000)) {
      if (!refresh_token) {
        console.warn(`   ⚠️  No refresh token for ${email}, skipping`);
        return;
      }

      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Update token in database
        await supabaseAdmin
          .from('email_accounts')
          .update({
            access_token: credentials.access_token,
            refresh_token: credentials.refresh_token || refresh_token,
            token_expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', emailAccountId);

        oauth2Client.setCredentials(credentials);
        console.log(`   ✅ Token refreshed for ${email}`);
      } catch (refreshError) {
        console.error(`   ❌ Failed to refresh token for ${email}:`, refreshError.message);
        return;
      }
    }

    // Fetch recent emails from Gmail API (last 50 to catch new ones)
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox',
      maxResults: 50, // Check last 50 emails
    });

    const messages = response.data.messages || [];
    
    if (messages.length === 0) {
      console.log(`   ✅ No new emails for ${email}`);
      return;
    }

    console.log(`   📬 Found ${messages.length} recent emails, checking for new ones...`);

    // Check each message and save only new ones
    let newEmailsCount = 0;
    for (const msg of messages) {
      try {
        // Check if email already exists in Supabase
        const exists = await isEmailInSupabase(msg.id, userId);
        
        if (!exists) {
          // Get full email details
          const emailData = await getFullEmailMessage(oauth2Client, msg.id, userId);
          
          if (emailData) {
            // Save to Supabase
            await saveEmailToSupabase(emailData, userId, emailAccountId);
            newEmailsCount++;
            console.log(`   ✉️  Saved new email: ${emailData.subject || '(No subject)'}`);
          }
        }
      } catch (msgError) {
        console.error(`   ⚠️  Error processing message ${msg.id}:`, msgError.message);
        // Continue with next message
      }
    }

    if (newEmailsCount > 0) {
      console.log(`   ✅ Saved ${newEmailsCount} new email(s) for ${email}`);
    } else {
      console.log(`   ✅ No new emails for ${email} (all already in database)`);
    }
  } catch (error) {
    console.error(`   ❌ Error checking emails for account:`, error.message);
    throw error;
  }
};

module.exports = {
  startGmailWatch,
  handleGmailNotification,
  getFullEmailMessage,
  sendToWebhook, // Deprecated - kept for backward compatibility but does nothing
  getInitialEmails, // Always fetches directly from Gmail API (no cache)
  // getEmailsFromDatabase, // Deprecated - no longer used
  // getNewEmails, // Deprecated - refresh now fetches from Gmail API
  handlePubSubWebhook,
  saveEmailToSupabase, // Export for use in other modules
  markEmailAsSentToWebhook, // Keep for backward compatibility
  isEmailInSupabase, // Export for checking if email exists
  checkForNewEmailsForAllAccounts, // Scheduled job to check for new emails
};

