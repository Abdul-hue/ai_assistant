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
      // Insert new email
      const { data: newEmail, error } = await supabaseAdmin
        .from('emails')
        .insert({
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
        })
        .select()
        .single();
      if (error) throw error;
      return { action: 'inserted', id: newEmail.id };
    }
  } catch (error) {
    console.error('Error saving email:', error);
    throw error;
  }
}

/**
 * Send new unseen email to webhook
 */
async function sendEmailToWebhook(emailData, accountId, userId) {
  try {
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

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ 
        success: false,
        error: 'Email account not found' 
      });
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

    // Connect to IMAP
    connection = await imaps.connect({
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

    // Open mailbox
    await connection.openBox(folder);

    // Search for all UNSEEN (unread) messages
    const allUnseenMessages = await connection.search(['UNSEEN'], { 
      bodies: '', 
      struct: true 
    });

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

    // Close connection
    if (connection) {
      connection.end();
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
    // Close connection on error
    if (connection) {
      try {
        connection.end();
      } catch (endError) {
        // Ignore errors when closing connection
      }
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

        // Connect to IMAP
        const connection = await imaps.connect({
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

        try {
          // Get last fetched unread UID for this account/folder
          const { lastUnreadUidFetched } = await getUnreadFetchState(account.id, folder);

          // Open mailbox
          await connection.openBox(folder);

          // Search for all UNSEEN (unread) messages
          const allUnseenMessages = await connection.search(['UNSEEN'], { 
            bodies: '', 
            struct: true 
          });

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
          connection.end();
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
      let connection = null;
      try {
        // Get last fetched unread UID for this account/folder
        const { lastUnreadUidFetched } = await getUnreadFetchState(account.id, folder);

        // Decrypt password
        const password = decryptPassword(account.imap_password);

        // Connect to IMAP
        connection = await imaps.connect({
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

        // Open mailbox
        await connection.openBox(folder);

        // Search for all UNSEEN (unread) messages
        const allUnseenMessages = await connection.search(['UNSEEN'], { 
          bodies: '', 
          struct: true 
        });

        // Filter to only get new unseen emails (UID > last fetched)
        const newUnseenMessages = lastUnreadUidFetched > 0
          ? allUnseenMessages.filter(msg => {
              const uid = parseInt(msg.attributes.uid);
              return uid > lastUnreadUidFetched;
            })
          : allUnseenMessages;

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

        accountsProcessed++;
      } catch (accountError) {
        console.error(`[FETCH_NEW_MAIL] Error fetching emails from account ${account.email}:`, accountError.message);
        // Continue with next account
      } finally {
        if (connection) {
          try {
            connection.end();
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

