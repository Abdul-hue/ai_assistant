/**
 * Fetch New Unread Mail Routes
 * Handles fetching new unread emails directly from IMAP server
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { decryptPassword } = require('../utils/encryption');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const axios = require('axios');
const { retryWithBackoff, isThrottlingError } = require('../utils/imapRetry');
const connectionPool = require('../utils/imapConnectionPool');

const router = express.Router();

// Webhook URL for new unseen emails
const WEBHOOK_URL = 'https://auto.nsolbpo.com/webhook/pa-email';

/**
 * Get last fetched unread UID for tracking new unseen emails
 * Returns the highest UID of unread emails already in the database
 */
async function 
getUnreadFetchState(accountId, folderName) {
  // Get the highest UID of unread emails we've already fetched from database
  // This ensures we only get truly new unread emails
  const { data: lastUnreadEmail, error } = await supabaseAdmin
    .from('emails')
    .select('uid')
    .eq('email_account_id', accountId)
    .eq('folder_name', folderName)
    .eq('is_read', false)
    .order('uid', { ascending: false })
    .limit(1)
    .single();

  // If no unread emails found in database, return 0 to fetch all unseen
  const lastUnreadUidFetched = (error && error.code === 'PGRST116') || !lastUnreadEmail
    ? 0
    : parseInt(lastUnreadEmail.uid) || 0;
  
  return { lastUnreadUidFetched };
}

/**
 * Update unread fetch state after successful fetch
 * Note: We don't need to explicitly update state since we track via database emails
 * This function is kept for potential future use
 */
async function updateUnreadFetchState(accountId, folderName, highestUid) {
  // The state is automatically tracked via the emails in the database
  // No explicit update needed, but we keep this for potential future enhancements
  return;
}

/**
 * Save or update email in database
 * Returns { action: 'inserted' | 'updated', id: emailId }
 */
async function saveOrUpdateEmail(accountId, emailData, mailFlags) {
  try {
    const providerId = `${accountId}_${emailData.uid}_${emailData.folder_name}`;

    // Check if email already exists
    const { data: existing } = await supabaseAdmin
      .from('emails')
      .select('id, is_read, is_starred')
      .eq('email_account_id', accountId)
      .eq('uid', emailData.uid)
      .eq('folder_name', emailData.folder_name)
      .single();

    const isRead = mailFlags?.includes('\\Seen') || false;
    const isStarred = mailFlags?.includes('\\Flagged') || false;

    if (existing) {
      // Update existing email
      const { error } = await supabaseAdmin
        .from('emails')
        .update({
          is_read: isRead,
          is_starred: isStarred,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (error) throw error;
      return { action: 'updated', id: existing.id };
    } else {
      // ✅ USE UPSERT with correct constraint (prevents duplicates from competing syncs)
      const { data: newEmail, error } = await supabaseAdmin
        .from('emails')
        .upsert({
          email_account_id: accountId,
          provider_message_id: providerId,
          uid: emailData.uid,
          sender_email: emailData.senderEmail || emailData.fromEmail || '',
          sender_name: emailData.senderName || emailData.fromName || '',
          recipient_email: emailData.recipientEmail || emailData.toEmail || '',
          subject: emailData.subject || '[No Subject]',
          body_text: emailData.body || emailData.bodyText || '',
          body_html: emailData.bodyHtml || '',
          received_at: emailData.date || new Date().toISOString(),
          folder_name: emailData.folder || 'INBOX',
          is_read: isRead,
          is_starred: isStarred,
          is_deleted: false,
          attachments_count: emailData.attachments?.length || 0,
          attachments_meta: emailData.attachments || [],
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'email_account_id,provider_message_id', // ✅ Correct constraint
          ignoreDuplicates: false // Update if exists
        })
        .select()
        .single();
      
      // ✅ Suppress duplicate key errors (code 23505)
      if (error) {
        if (error.code === '23505' || error.message?.includes('duplicate key')) {
          // Email already exists, return updated
          const { data: existing } = await supabaseAdmin
            .from('emails')
            .select('id')
            .eq('email_account_id', accountId)
            .eq('provider_message_id', providerId)
            .single();
          return { action: 'updated', id: existing?.id };
        }
        throw error;
      }
      return { action: 'inserted', id: newEmail.id };
    }
  } catch (error) {
    console.error('Error saving email:', error);
    throw error;
  }
}

/**
 * Send new unseen email to webhook
 * Only sends if initial sync is completed and email is newer than webhook_enabled_at
 */
async function sendEmailToWebhook(emailData, accountId, userId) {
  try {
    // CRITICAL: Check if initial sync is completed and webhook is enabled
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('initial_sync_completed, webhook_enabled_at')
      .eq('id', accountId)
      .single();

    if (accountError) {
      console.error(`[WEBHOOK] ❌ Error fetching account sync status:`, accountError.message);
      // Don't send webhook if we can't verify sync status (fail-safe)
      return { success: false, reason: 'database_error', error: accountError.message };
    }

    if (!account) {
      console.error(`[WEBHOOK] ❌ Account ${accountId} not found`);
      return { success: false, reason: 'account_not_found' };
    }

    // Check 1: Initial sync must be completed
    if (!account.initial_sync_completed) {
      console.log(`[WEBHOOK] ⏭️  Skipping webhook for UID ${emailData.uid} - Initial sync not completed`);
      return { success: false, reason: 'initial_sync_not_completed' };
    }

    // Check 2: Email must be received after webhook was enabled
    // If webhook_enabled_at is NULL but initial_sync_completed is TRUE, skip webhook (data inconsistency)
    if (!account.webhook_enabled_at) {
      console.warn(`[WEBHOOK] ⚠️  Account ${accountId} has initial_sync_completed=TRUE but webhook_enabled_at is NULL. Skipping webhook for safety.`);
      return { success: false, reason: 'webhook_enabled_at_missing' };
    }

    // Validate email date exists
    const emailReceivedAtStr = emailData.date || emailData.received_at;
    if (!emailReceivedAtStr) {
      console.warn(`[WEBHOOK] ⚠️  Email UID ${emailData.uid} has no date, skipping webhook`);
      return { success: false, reason: 'missing_email_date' };
    }

    const webhookEnabledAt = new Date(account.webhook_enabled_at).getTime();
    const emailReceivedAt = new Date(emailReceivedAtStr).getTime();
    
    // Validate dates are valid
    if (isNaN(webhookEnabledAt) || isNaN(emailReceivedAt)) {
      console.error(`[WEBHOOK] ❌ Invalid date format - webhook_enabled_at: ${account.webhook_enabled_at}, email date: ${emailReceivedAtStr}`);
      return { success: false, reason: 'invalid_date_format' };
    }
    
    if (emailReceivedAt < webhookEnabledAt) {
      console.log(`[WEBHOOK] ⏭️  Skipping webhook for UID ${emailData.uid} - Email older than webhook enable time (email: ${new Date(emailReceivedAt).toISOString()}, enabled: ${account.webhook_enabled_at})`);
      return { success: false, reason: 'email_older_than_webhook_enable' };
    }

    const payload = {
      event: 'new_unseen_email',
      timestamp: new Date().toISOString(),
      account_id: accountId,
      user_id: userId,
      email: {
        id: emailData.id || null,
        uid: emailData.uid,
        subject: emailData.subject || '[No Subject]',
        sender_name: emailData.fromName || emailData.from || '',
        sender_email: emailData.fromEmail || '',
        recipient_email: emailData.toEmail || emailData.to || '',
        body_text: emailData.body || '',
        body_html: emailData.bodyHtml || '',
        received_at: emailData.date || new Date().toISOString(),
        folder_name: emailData.folder || 'INBOX',
        is_read: emailData.isRead || false,
        is_starred: emailData.isStarred || false,
        attachments_count: emailData.attachments?.length || 0,
        attachments_meta: emailData.attachments || [],
      }
    };

    const response = await axios.post(WEBHOOK_URL, payload, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json',
      }
    });

    console.log(`[WEBHOOK] ✅ Successfully sent new unseen email UID ${emailData.uid} to webhook (${emailData.subject?.substring(0, 50) || 'No Subject'})`);
    return { success: true, status: response.status };
  } catch (error) {
    const errorMessage = error.response?.data || error.message;
    const statusCode = error.response?.status || 'N/A';
    console.error(`[WEBHOOK] ❌ Failed to send email UID ${emailData.uid} to webhook:`, errorMessage, `(Status: ${statusCode})`);
    return { 
      success: false, 
      error: errorMessage,
      status: statusCode 
    };
  }
}

/**
 * GET /api/fetch-new-mail/:accountId
 * Get new unread emails directly from IMAP server for a specific account
 * Only fetches unread emails that haven't been fetched before (new unseen emails)
 */
router.get('/:accountId', authMiddleware, async (req, res) => {
  let connection = null;
  try {
    const { accountId } = req.params;
    const { folder = 'INBOX', limit = 50 } = req.query;

    // ✅ CRITICAL: Validate account exists and belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .eq('is_active', true)
      .single();

    if (accountError || !account) {
      console.error(`[FETCH NEW MAIL] ❌ Account ${accountId} not found, inactive, or doesn't belong to user ${req.user.id}`);
      return res.status(404).json({ 
        success: false,
        error: `Email account ${accountId} not found or inactive. Please reconnect your account.`
      });
    }

    if (!account.imap_host || !account.imap_username) {
      return res.status(400).json({
        success: false,
        error: `IMAP settings not configured for account ${account.email || accountId}. Please check your account configuration.`
      });
    }

    // Check if this is the first sync for this account
    const isInitialSync = !account.initial_sync_completed;
    if (isInitialSync) {
      console.log(`[SYNC] 🔄 Starting initial sync for account ${accountId} (${account.email})`);
    }

    if (!account.imap_host || !account.imap_username) {
      return res.status(400).json({
        success: false,
        error: 'IMAP settings not configured for this account'
      });
    }

    // Get last fetched unread UID
    const { lastUnreadUidFetched } = await getUnreadFetchState(accountId, folder);

    // Decrypt password
    const password = decryptPassword(account.imap_password);

    // Connect to IMAP using connection pool with retry
    connection = await connectionPool.getConnection(
      account.id,
      async () => {
        return await retryWithBackoff(
          async () => {
            return await imaps.connect({
              imap: {
                user: account.imap_username,
                password: password,
                host: account.imap_host,
                port: account.imap_port || 993,
                tls: account.use_ssl !== false,
                tlsOptions: { rejectUnauthorized: false },
                authTimeout: 10000,
              }
            });
          },
          {
            maxRetries: 3,
            baseDelay: 2000,
            maxDelay: 30000,
            operationName: `Connecting to IMAP for ${account.email}`
          }
        );
      }
    );

    // Open mailbox with retry
    await retryWithBackoff(
      async () => {
        return await connection.openBox(folder);
      },
      {
        maxRetries: 3,
        baseDelay: 2000,
        maxDelay: 30000,
        operationName: `Opening folder ${folder}`
      }
    );

    // Search for all UNSEEN (unread) messages with retry
    const allUnseenMessages = await retryWithBackoff(
      async () => {
        return await connection.search(['UNSEEN'], { 
          bodies: '', 
          struct: true 
        });
      },
      {
        maxRetries: 5,
        baseDelay: 3000,
        maxDelay: 60000,
        operationName: `Searching UNSEEN messages in ${folder}`
      }
    );

    // Filter to only get new unseen emails (UID > last fetched)
    const newUnseenMessages = lastUnreadUidFetched > 0
      ? allUnseenMessages.filter(msg => {
          const uid = parseInt(msg.attributes.uid);
          return uid > lastUnreadUidFetched;
        })
      : allUnseenMessages;

    // Limit results
    const limitNum = parseInt(limit) || 50;
    const limitedMessages = newUnseenMessages.slice(0, limitNum);

    // Parse emails
    const emails = [];
    for (const message of limitedMessages) {
      try {
        const all = message.parts.find(part => part.which === '');
        const uid = message.attributes.uid;
        const flags = message.attributes.flags || [];
        const idHeader = 'Imap-Id: ' + uid + '\r\n';
        
        const parsed = await simpleParser(idHeader + all.body);

        // Get accurate date from email
        let emailDate = parsed.date;
        if (!emailDate || !(emailDate instanceof Date) || isNaN(emailDate.getTime())) {
          emailDate = new Date();
        }

        // Parse sender information
        const fromMatch = parsed.from?.text?.match(/"?([^"<]*)"?\s*<([^>]+)>/) || 
                         parsed.from?.value?.[0];
        const senderName = fromMatch?.[1]?.trim() || parsed.from?.value?.[0]?.name || 
                         parsed.from?.text?.split('@')[0] || 'Unknown';
        const senderEmail = fromMatch?.[2] || parsed.from?.value?.[0]?.address || 
                          parsed.from?.text || '';

        // Parse recipient
        const toMatch = parsed.to?.text?.match(/"?([^"<]*)"?\s*<([^>]+)>/) || 
                       parsed.to?.value?.[0];
        const recipientEmail = toMatch?.[2] || parsed.to?.value?.[0]?.address || 
                              parsed.to?.text || '';

        const emailData = {
          id: `imap-${accountId}-${uid}`,
          uid: parseInt(uid),
          from: parsed.from?.text || senderEmail,
          fromEmail: senderEmail,
          senderEmail: senderEmail,
          fromName: senderName,
          senderName: senderName,
          to: parsed.to?.text || recipientEmail,
          toEmail: recipientEmail,
          recipientEmail: recipientEmail,
          subject: parsed.subject || '(No subject)',
          body: parsed.text || '',
          bodyText: parsed.text || '',
          bodyHtml: parsed.html || '',
          date: emailDate.toISOString(),
          timestamp: emailDate.getTime(),
          isRead: flags.includes('\\Seen') || false,
          isStarred: flags.includes('\\Flagged') || false,
          attachments: parsed.attachments?.map(att => ({
            filename: att.filename,
            contentType: att.contentType,
            size: att.size,
            cid: att.cid
          })) || [],
          folder: folder,
          accountId: accountId
        };

        // Save email to database first
        try {
          const saveResult = await saveOrUpdateEmail(accountId, emailData, flags);
          
          // Only send webhook if this is a NEW email (not an update)
          if (saveResult.action === 'inserted') {
            emails.push(emailData);
            
            // Send to webhook for new unseen email
            try {
              await sendEmailToWebhook(emailData, accountId, account.user_id);
            } catch (webhookError) {
              console.error(`Error sending email UID ${uid} to webhook:`, webhookError.message);
              // Don't fail the whole process if webhook fails
            }
          } else {
            // Email already exists, don't include in response
            console.log(`Email UID ${uid} already exists in database, skipping`);
          }
        } catch (saveError) {
          console.error(`Error saving email UID ${uid} to database:`, saveError.message);
          // Still add to response even if save fails
          emails.push(emailData);
        }
      } catch (parseError) {
        console.error('Error parsing email:', parseError);
        // Continue with next email
      }
    }

    // Sort emails by date (newest first)
    emails.sort((a, b) => {
      const timeA = a.timestamp || new Date(a.date).getTime();
      const timeB = b.timestamp || new Date(b.date).getTime();
      return timeB - timeA; // Descending order (newest first)
    });

    // CRITICAL: Mark initial sync as completed after first successful fetch
    // Use conditional update to prevent race conditions (only update if still FALSE)
    if (isInitialSync) {
      try {
        const { error: updateError } = await supabaseAdmin
          .from('email_accounts')
          .update({
            initial_sync_completed: true,
            webhook_enabled_at: new Date().toISOString()
          })
          .eq('id', accountId)
          .eq('initial_sync_completed', false); // Only update if still FALSE (atomic check-and-set)

        if (updateError) {
          console.error(`[SYNC] ❌ Error marking initial sync complete for account ${accountId}:`, updateError.message);
        } else {
          console.log(`[SYNC] ✅ Initial sync completed for account ${accountId} (${account.email})`);
          console.log(`[SYNC] ✅ Webhooks enabled - future emails will trigger webhooks`);
        }
      } catch (updateError) {
        console.error(`[SYNC] ❌ Error updating sync status:`, updateError.message);
        // Don't throw - continue processing
      }
    }

    // Release connection back to pool
    if (connection) {
      connectionPool.releaseConnection(account.id, connection, false);
    }

    res.json({
      success: true,
      data: {
        emails: emails,
        count: emails.length,
        total: newUnseenMessages.length,
        limit: limitNum,
        folder: folder,
        lastFetchedUid: emails.length > 0 ? Math.max(...emails.map(e => parseInt(e.uid))) : lastUnreadUidFetched
      },
    });
  } catch (error) {
    // Release connection on error
    if (connection) {
      try {
        connectionPool.releaseConnection(account.id, connection, true);
      } catch (endError) {
        // Ignore errors when closing connection
      }
    }

    // Handle throttling errors gracefully
    if (isThrottlingError(error)) {
      console.error('Error fetching new unread emails (throttled):', error.message);
      return res.status(429).json({
        success: false,
        error: 'Gmail rate limit exceeded. Please try again in a few minutes.',
        throttled: true
      });
    }

    console.error('Error fetching new unread emails from IMAP:', error);
    
    // Check if it's an authentication error
    const isAuthError = error.message?.includes('credentials') || 
                       error.message?.includes('authentication') ||
                       error.message?.includes('AUTHENTICATIONFAILED') ||
                       error.message?.includes('Invalid credentials');
    
    const statusCode = isAuthError ? 401 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: error.message,
      isAuthError: isAuthError
    });
  }
});

/**
 * GET /api/fetch-new-mail
 * Get new unread emails from all accounts belonging to the user
 * Fetches from IMAP server for each account
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { folder = 'INBOX', limit = 50 } = req.query;

    // Get all active accounts for the user
    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('is_active', true)
      .not('imap_host', 'is', null)
      .not('imap_username', 'is', null);

    if (accountsError) {
      throw accountsError;
    }

    if (!accounts || accounts.length === 0) {
      return res.json({
        success: true,
        data: {
          emails: [],
          count: 0,
          total: 0,
          limit: parseInt(limit) || 50,
        },
      });
    }

    const limitNum = parseInt(limit) || 50;
    const allEmails = [];

    // Fetch unread emails from each account
    for (const account of accounts) {
      try {
        // Decrypt password
        const password = decryptPassword(account.imap_password);

        // Connect to IMAP using connection pool with retry
        const connection = await connectionPool.getConnection(
          account.id,
          async () => {
            return await retryWithBackoff(
              async () => {
                return await imaps.connect({
                  imap: {
                    user: account.imap_username,
                    password: password,
                    host: account.imap_host,
                    port: account.imap_port || 993,
                    tls: account.use_ssl !== false,
                    tlsOptions: { rejectUnauthorized: false },
                    authTimeout: 10000,
                  }
                });
              },
              {
                maxRetries: 3,
                baseDelay: 2000,
                maxDelay: 30000,
                operationName: `Connecting to IMAP for ${account.email}`
              }
            );
          }
        );

        try {
          // Get last fetched unread UID for this account/folder
          const { lastUnreadUidFetched } = await getUnreadFetchState(account.id, folder);

          // Open mailbox with retry
          await retryWithBackoff(
            async () => {
              return await connection.openBox(folder);
            },
            {
              maxRetries: 3,
              baseDelay: 2000,
              maxDelay: 30000,
              operationName: `Opening folder ${folder}`
            }
          );

          // Search for all UNSEEN (unread) messages with retry
          const allUnseenMessages = await retryWithBackoff(
            async () => {
              return await connection.search(['UNSEEN'], { 
                bodies: '', 
                struct: true 
              });
            },
            {
              maxRetries: 5,
              baseDelay: 3000,
              maxDelay: 60000,
              operationName: `Searching UNSEEN messages in ${folder}`
            }
          );

          // Filter to only get new unseen emails (UID > last fetched)
          const newUnseenMessages = lastUnreadUidFetched > 0
            ? allUnseenMessages.filter(msg => {
                const uid = parseInt(msg.attributes.uid);
                return uid > lastUnreadUidFetched;
              })
            : allUnseenMessages;

          // Parse emails (limit per account to avoid too many results)
          for (const message of newUnseenMessages.slice(0, limitNum)) {
            try {
              const all = message.parts.find(part => part.which === '');
              const uid = message.attributes.uid;
              const flags = message.attributes.flags || [];
              const idHeader = 'Imap-Id: ' + uid + '\r\n';
              
              const parsed = await simpleParser(idHeader + all.body);

              // Get accurate date from email
              let emailDate = parsed.date;
              if (!emailDate || !(emailDate instanceof Date) || isNaN(emailDate.getTime())) {
                emailDate = new Date();
              }

              // Parse sender information
              const fromMatch = parsed.from?.text?.match(/"?([^"<]*)"?\s*<([^>]+)>/) || 
                               parsed.from?.value?.[0];
              const senderName = fromMatch?.[1]?.trim() || parsed.from?.value?.[0]?.name || 
                               parsed.from?.text?.split('@')[0] || 'Unknown';
              const senderEmail = fromMatch?.[2] || parsed.from?.value?.[0]?.address || 
                                parsed.from?.text || '';

              // Parse recipient
              const toMatch = parsed.to?.text?.match(/"?([^"<]*)"?\s*<([^>]+)>/) || 
                             parsed.to?.value?.[0];
              const recipientEmail = toMatch?.[2] || parsed.to?.value?.[0]?.address || 
                                    parsed.to?.text || '';

              const emailData = {
                id: `imap-${account.id}-${uid}`,
                uid: parseInt(uid),
                from: parsed.from?.text || senderEmail,
                fromEmail: senderEmail,
                senderEmail: senderEmail,
                fromName: senderName,
                senderName: senderName,
                to: parsed.to?.text || recipientEmail,
                toEmail: recipientEmail,
                recipientEmail: recipientEmail,
                subject: parsed.subject || '(No subject)',
                body: parsed.text || '',
                bodyText: parsed.text || '',
                bodyHtml: parsed.html || '',
                date: emailDate.toISOString(),
                timestamp: emailDate.getTime(),
                isRead: flags.includes('\\Seen') || false,
                isStarred: flags.includes('\\Flagged') || false,
                attachments: parsed.attachments?.map(att => ({
                  filename: att.filename,
                  contentType: att.contentType,
                  size: att.size,
                  cid: att.cid
                })) || [],
                folder: folder,
                accountId: account.id,
                accountEmail: account.email
              };

              // Save email to database first
              try {
                const saveResult = await saveOrUpdateEmail(account.id, emailData, flags);
                
                // Only send webhook if this is a NEW email (not an update)
                if (saveResult.action === 'inserted') {
                  allEmails.push(emailData);
                  
                  // Send to webhook for new unseen email
                  try {
                    await sendEmailToWebhook(emailData, account.id, account.user_id);
                  } catch (webhookError) {
                    console.error(`Error sending email UID ${uid} to webhook:`, webhookError.message);
                    // Don't fail the whole process if webhook fails
                  }
                } else {
                  // Email already exists, don't include in response
                  console.log(`Email UID ${uid} already exists in database, skipping`);
                }
              } catch (saveError) {
                console.error(`Error saving email UID ${uid} to database:`, saveError.message);
                // Still add to response even if save fails
                allEmails.push(emailData);
              }
            } catch (parseError) {
              console.error(`Error parsing email from account ${account.email}:`, parseError);
              // Continue with next email
            }
          }
        } finally {
          // Release connection back to pool
          connectionPool.releaseConnection(account.id, connection, false);
        }
      } catch (accountError) {
        console.error(`Error fetching emails from account ${account.email}:`, accountError.message);
        // Continue with next account
      }
    }

    // Sort all emails by date (newest first)
    allEmails.sort((a, b) => {
      const timeA = a.timestamp || new Date(a.date).getTime();
      const timeB = b.timestamp || new Date(b.date).getTime();
      return timeB - timeA; // Descending order (newest first)
    });

    // Limit total results
    const limitedEmails = allEmails.slice(0, limitNum);

    res.json({
      success: true,
      data: {
        emails: limitedEmails,
        count: limitedEmails.length,
        total: allEmails.length,
        limit: limitNum,
        folder: folder
      },
    });
  } catch (error) {
    console.error('Error fetching new unread emails from IMAP:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Service function to fetch new unread emails for all active accounts
 * Can be called programmatically (e.g., from scheduled jobs)
 */
async function fetchNewUnreadEmailsForAllAccounts() {
  try {
    // Get all active IMAP accounts
    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('is_active', true)
      .not('imap_host', 'is', null)
      .not('imap_username', 'is', null);

    if (accountsError) {
      console.error('[FETCH_NEW_MAIL] Error fetching accounts:', accountsError);
      return { success: false, error: accountsError.message };
    }

    if (!accounts || accounts.length === 0) {
      return { success: true, accountsProcessed: 0, emailsFound: 0 };
    }

    const folder = 'INBOX';
    let totalEmailsFound = 0;
    let accountsProcessed = 0;

    // Fetch unread emails from each account
    for (const account of accounts) {
      // ✅ CRITICAL: Skip accounts that need reconnection (prevents endless retry loops)
      if (account.needs_reconnection) {
        console.log(`[FETCH_NEW_MAIL] ⏭️  Skipping account ${account.email || account.id} - needs reconnection`);
        continue; // Skip this account
      }
      
      let connection = null;
      try {
        // Get last fetched unread UID for this account/folder
        const { lastUnreadUidFetched } = await getUnreadFetchState(account.id, folder);

        // Decrypt password
        const password = decryptPassword(account.imap_password);

        // Connect to IMAP using connection pool with retry
        connection = await connectionPool.getConnection(
          account.id,
          async () => {
            return await retryWithBackoff(
              async () => {
                return await imaps.connect({
                  imap: {
                    user: account.imap_username,
                    password: password,
                    host: account.imap_host,
                    port: account.imap_port || 993,
                    tls: account.use_ssl !== false,
                    tlsOptions: { rejectUnauthorized: false },
                    authTimeout: 10000,
                  }
                });
              },
              {
                maxRetries: 3,
                baseDelay: 2000,
                maxDelay: 30000,
                operationName: `Connecting to IMAP for ${account.email}`
              }
            );
          }
        );

        // Open mailbox with retry
        await retryWithBackoff(
          async () => {
            return await connection.openBox(folder);
          },
          {
            maxRetries: 3,
            baseDelay: 2000,
            maxDelay: 30000,
            operationName: `Opening folder ${folder}`
          }
        );

        // Search for all UNSEEN (unread) messages with retry
        const allUnseenMessages = await retryWithBackoff(
          async () => {
            return await connection.search(['UNSEEN'], { 
              bodies: '', 
              struct: true 
            });
          },
          {
            maxRetries: 5,
            baseDelay: 3000,
            maxDelay: 60000,
            operationName: `Searching UNSEEN messages in ${folder}`
          }
        );

        // Filter to only get new unseen emails (UID > last fetched)
        const newUnseenMessages = lastUnreadUidFetched > 0
          ? allUnseenMessages.filter(msg => {
              const uid = parseInt(msg.attributes.uid);
              return uid > lastUnreadUidFetched;
            })
          : allUnseenMessages;

        // CRITICAL: Check if this is the first sync for this account
        const isInitialSync = !account.initial_sync_completed;
        if (isInitialSync) {
          console.log(`[SYNC] 🔄 Starting initial sync for account ${account.id} (${account.email})`);
        }

        if (newUnseenMessages.length > 0) {
          // Parse and send emails to webhook
          for (const message of newUnseenMessages) {
            try {
              const all = message.parts.find(part => part.which === '');
              const uid = message.attributes.uid;
              const flags = message.attributes.flags || [];
              const idHeader = 'Imap-Id: ' + uid + '\r\n';
              
              const parsed = await simpleParser(idHeader + all.body);

              // Get accurate date from email
              let emailDate = parsed.date;
              if (!emailDate || !(emailDate instanceof Date) || isNaN(emailDate.getTime())) {
                emailDate = new Date();
              }

              // Parse sender information
              const fromMatch = parsed.from?.text?.match(/"?([^"<]*)"?\s*<([^>]+)>/) || 
                               parsed.from?.value?.[0];
              const senderName = fromMatch?.[1]?.trim() || parsed.from?.value?.[0]?.name || 
                               parsed.from?.text?.split('@')[0] || 'Unknown';
              const senderEmail = fromMatch?.[2] || parsed.from?.value?.[0]?.address || 
                                parsed.from?.text || '';

              // Parse recipient
              const toMatch = parsed.to?.text?.match(/"?([^"<]*)"?\s*<([^>]+)>/) || 
                             parsed.to?.value?.[0];
              const recipientEmail = toMatch?.[2] || parsed.to?.value?.[0]?.address || 
                                    parsed.to?.text || '';

              const emailData = {
                id: `imap-${account.id}-${uid}`,
                uid: parseInt(uid),
                from: parsed.from?.text || senderEmail,
                fromEmail: senderEmail,
                senderEmail: senderEmail,
                fromName: senderName,
                senderName: senderName,
                to: parsed.to?.text || recipientEmail,
                toEmail: recipientEmail,
                recipientEmail: recipientEmail,
                subject: parsed.subject || '(No subject)',
                body: parsed.text || '',
                bodyText: parsed.text || '',
                bodyHtml: parsed.html || '',
                date: emailDate.toISOString(),
                timestamp: emailDate.getTime(),
                isRead: flags.includes('\\Seen') || false,
                isStarred: flags.includes('\\Flagged') || false,
                attachments: parsed.attachments?.map(att => ({
                  filename: att.filename,
                  contentType: att.contentType,
                  size: att.size,
                  cid: att.cid
                })) || [],
                folder: folder,
                accountId: account.id,
                accountEmail: account.email
              };

              // Save email to database first
              try {
                const saveResult = await saveOrUpdateEmail(account.id, emailData, flags);
                
                // Only send webhook if this is a NEW email (not an update)
                if (saveResult.action === 'inserted') {
                  // Send to webhook for new unseen email
                  try {
                    await sendEmailToWebhook(emailData, account.id, account.user_id);
                    totalEmailsFound++;
                    console.log(`[FETCH_NEW_MAIL] ✅ New email saved and webhook sent: UID ${uid} from ${senderEmail}`);
                  } catch (webhookError) {
                    console.error(`[FETCH_NEW_MAIL] Error sending email UID ${uid} to webhook:`, webhookError.message);
                    // Still count as found even if webhook fails
                    totalEmailsFound++;
                  }
                } else {
                  // Email already exists, skip webhook
                  console.log(`[FETCH_NEW_MAIL] Email UID ${uid} already exists, skipping webhook`);
                }
              } catch (saveError) {
                console.error(`[FETCH_NEW_MAIL] Error saving email UID ${uid} to database:`, saveError.message);
                // Continue with next email
              }
            } catch (parseError) {
              console.error(`[FETCH_NEW_MAIL] Error parsing email from account ${account.email}:`, parseError.message);
              // Continue with next email
            }
          }
        }

        // CRITICAL: Mark initial sync as completed after first successful fetch
        // Use conditional update to prevent race conditions (only update if still FALSE)
        if (isInitialSync) {
          try {
            const { error: updateError } = await supabaseAdmin
              .from('email_accounts')
              .update({
                initial_sync_completed: true,
                webhook_enabled_at: new Date().toISOString()
              })
              .eq('id', account.id)
              .eq('initial_sync_completed', false); // Only update if still FALSE (atomic check-and-set)

            if (updateError) {
              console.error(`[SYNC] ❌ Error marking initial sync complete for account ${account.id}:`, updateError.message);
            } else {
              console.log(`[SYNC] ✅ Initial sync completed for account ${account.id} (${account.email})`);
              console.log(`[SYNC] ✅ Webhooks enabled - future emails will trigger webhooks`);
            }
          } catch (updateError) {
            console.error(`[SYNC] ❌ Error updating sync status:`, updateError.message);
            // Don't throw - continue processing
          }
        }

        accountsProcessed++;
      } catch (accountError) {
        // ✅ Detect and mark authentication errors
        const isAuthError = accountError.message?.includes('Not authenticated') || 
                           accountError.message?.includes('AUTHENTICATIONFAILED') ||
                           accountError.message?.includes('Invalid credentials') ||
                           accountError.message?.includes('authentication') ||
                           accountError.message?.includes('credentials') ||
                           accountError.message?.includes('LOGIN');

        if (isAuthError) {
          console.error(`[FETCH_NEW_MAIL] ❌ Authentication failed for account ${account.id} (${account.email}):`, accountError.message);
          
          // Mark account as needing reconnection
          try {
            await supabaseAdmin
              .from('email_accounts')
              .update({ 
                needs_reconnection: true,
                last_error: `Authentication failed: ${accountError.message}`,
                last_connection_attempt: new Date().toISOString()
              })
              .eq('id', account.id);
            
            console.log(`[FETCH_NEW_MAIL] ✅ Marked account ${account.id} as needing reconnection`);
          } catch (updateErr) {
            console.error('[FETCH_NEW_MAIL] Failed to update account status:', updateErr);
          }
        } else if (isThrottlingError(accountError)) {
          // Handle throttling errors gracefully
          console.error(`[FETCH_NEW_MAIL] Error fetching emails from account ${account.email} (throttled):`, accountError.message);
        } else {
          console.error(`[FETCH_NEW_MAIL] Error fetching emails from account ${account.email}:`, accountError.message);
        }
        // Continue with next account
      } finally {
        if (connection) {
          try {
            // Release connection back to pool
            connectionPool.releaseConnection(account.id, connection, false);
          } catch (endError) {
            // Ignore errors when closing connection
          }
        }
      }
    }

    return {
      success: true,
      accountsProcessed,
      emailsFound: totalEmailsFound,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[FETCH_NEW_MAIL] Error in fetchNewUnreadEmailsForAllAccounts:', error);
    return { success: false, error: error.message };
  }
}

module.exports = router;
module.exports.fetchNewUnreadEmailsForAllAccounts = fetchNewUnreadEmailsForAllAccounts;

