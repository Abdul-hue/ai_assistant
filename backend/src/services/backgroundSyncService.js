/**
 * Background Email Sync Service
 * Incremental sync - only fetches emails with UID greater than last_uid_synced
 * Non-blocking, runs in background without affecting API response times
 */

const { supabaseAdmin } = require('../config/supabase');
const { decryptPassword } = require('../utils/encryption');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const connectionPool = require('../utils/imapConnectionPool');
const { retryWithBackoff, isThrottlingError } = require('../utils/imapRetry');
const { callEmailWebhook } = require('../utils/emailWebhook');

/**
 * Sync only new emails since last UID (incremental sync)
 * @param {string} accountId - Account ID
 * @param {string} folder - Folder name (default: 'INBOX')
 * @returns {Promise<number>} - Number of new emails synced
 */
async function syncNewEmailsOnly(accountId, folder = 'INBOX') {
  let connection = null;
  try {
    // ✅ CRITICAL: Validate account exists before any operations
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('*, user_id') // Ensure user_id is included for webhook calls
      .eq('id', accountId)
      .eq('is_active', true)
      .single();

    if (accountError || !account) {
      console.error(`[BACKGROUND SYNC] ❌ Account ${accountId} not found or inactive`);
      throw new Error(`Email account ${accountId} not found or inactive. Please reconnect your account.`);
    }

    // ✅ CRITICAL: Skip sync if account needs reconnection (prevents endless retry loops)
    if (account.needs_reconnection) {
      console.log(`[BACKGROUND SYNC] ⏭️  Skipping sync for ${accountId} (${account.email || 'unknown'}) - account needs reconnection`);
      return 0; // No emails synced
    }

    if (!account.imap_host || !account.imap_username) {
      throw new Error('IMAP settings not configured');
    }

    // Get last synced UID from database
    const { data: syncState } = await supabaseAdmin
      .from('email_sync_state')
      .select('last_uid_synced')
      .eq('account_id', accountId)
      .eq('folder_name', folder)
      .single();

    const lastUID = syncState?.last_uid_synced || 0;
    console.log(`[BACKGROUND SYNC] Last synced UID for ${accountId}/${folder}: ${lastUID}`);

    // Decrypt password
    const password = decryptPassword(account.imap_password);

    // ✅ CRITICAL: If account needs reconnection, close all existing connections and force new one
    if (account.needs_reconnection) {
      console.log(`[BACKGROUND SYNC] Account needs reconnection, closing existing connections for ${accountId}`);
      connectionPool.closeAccountConnections(accountId);
    }

    // Get connection from pool (will create new one if needed)
    connection = await connectionPool.getConnection(
      accountId,
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
            operationName: `[BACKGROUND SYNC] Connecting to IMAP for ${account.email}`
          }
        );
      }
    );

    // Open mailbox with retry
    const box = await retryWithBackoff(
      async () => {
        return await connection.openBox(folder);
      },
      {
        maxRetries: 3,
        baseDelay: 2000,
        maxDelay: 30000,
        operationName: `[BACKGROUND SYNC] Opening folder ${folder}`
      }
    );

    // ✅ FIXED: imap-simple doesn't support UID ranges in search directly
    // Strategy: Fetch ALL messages, then filter client-side by UID
    // This is the same approach used in fetchNewMail.js
    
    console.log(`[BACKGROUND SYNC] Fetching messages from ${folder} (last synced UID: ${lastUID})`);

    const allMessages = await retryWithBackoff(
      async () => {
        return await connection.search(['ALL'], {
          bodies: '',
          struct: true,
          markSeen: false
        });
      },
      {
        maxRetries: 5,
        baseDelay: 3000,
        maxDelay: 60000,
        operationName: `[BACKGROUND SYNC] Searching messages in ${folder}`
      }
    );

    if (!allMessages || allMessages.length === 0) {
      console.log(`[BACKGROUND SYNC] No messages found in ${folder}`);
      return 0;
    }

    // ✅ Filter client-side to only get new emails (UID > lastUID)
    const messages = lastUID > 0
      ? allMessages.filter(msg => {
          const uid = parseInt(msg.attributes.uid);
          return uid > lastUID;
        })
      : allMessages;

    console.log(`[BACKGROUND SYNC] Found ${messages.length} new emails (out of ${allMessages.length} total) in ${folder}`);

    if (messages.length === 0) {
      console.log(`[BACKGROUND SYNC] No new emails found for ${accountId}/${folder}`);
      return 0;
    }

    console.log(`[BACKGROUND SYNC] Found ${messages.length} new emails for ${accountId}/${folder}`);

    // Parse and save emails
    let savedCount = 0;
    for (const message of messages) {
      try {
        const all = message.parts.find(part => part.which === '');
        const uid = parseInt(message.attributes.uid);
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

        const providerId = `${accountId}_${uid}_${folder}`;
        const isRead = flags.includes('\\Seen') || false;
        const isStarred = flags.includes('\\Flagged') || false;

        // ✅ CRITICAL: Check if email already exists (prevent duplicates)
        const { data: existing, error: checkError } = await supabaseAdmin
          .from('emails')
          .select('id')
          .eq('email_account_id', accountId)
          .eq('uid', uid)
          .eq('folder_name', folder)
          .single();

        // If email exists, skip it (don't log as error - this is normal)
        if (existing) {
          continue; // Skip duplicate email
        }

        // If check failed for other reason, log but continue
        if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows found (expected)
          console.warn(`[BACKGROUND SYNC] Error checking for existing email UID ${uid}:`, checkError.message);
        }

        // ✅ USE UPSERT with correct constraint (prevents duplicates from competing syncs)
        const { error: upsertError } = await supabaseAdmin
          .from('emails')
          .upsert({
            email_account_id: accountId,
            provider_message_id: providerId,
            uid: uid,
            sender_email: senderEmail,
            sender_name: senderName,
            recipient_email: recipientEmail,
            subject: parsed.subject || '[No Subject]',
            body_text: parsed.text || '',
            body_html: parsed.html || '',
            received_at: emailDate.toISOString(),
            folder_name: folder,
            is_read: isRead,
            is_starred: isStarred,
            is_deleted: false,
            attachments_count: parsed.attachments?.length || 0,
            attachments_meta: parsed.attachments?.map(att => ({
              filename: att.filename,
              contentType: att.contentType,
              size: att.size,
              cid: att.cid
            })) || [],
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'email_account_id,provider_message_id', // ✅ Correct constraint
            ignoreDuplicates: false // Update if exists
          });

        // ✅ Only log real errors (not duplicate key errors)
        if (upsertError) {
          // Suppress duplicate key errors (code 23505) - they're expected when multiple syncs run
          if (upsertError.code !== '23505' && !upsertError.message?.includes('duplicate key')) {
            console.error(`[BACKGROUND SYNC] Error saving email UID ${uid}:`, upsertError.message);
          }
          // Don't increment savedCount on error
        } else {
          savedCount++;
          
          // ✅ Call webhook for new emails (only if email was actually inserted, not updated)
          // Check if this was a new insert by checking if email existed before
          if (!existing && account.user_id) {
            try {
              const emailData = {
                uid: uid,
                subject: parsed.subject || '[No Subject]',
                sender_name: senderName,
                sender_email: senderEmail,
                recipient_email: recipientEmail,
                body_text: parsed.text || '',
                body_html: parsed.html || '',
                received_at: emailDate.toISOString(),
                folder_name: folder,
                is_read: isRead,
                is_starred: isStarred,
                attachments_count: parsed.attachments?.length || 0,
                attachments_meta: parsed.attachments?.map(att => ({
                  filename: att.filename,
                  contentType: att.contentType,
                  size: att.size,
                  cid: att.cid
                })) || []
              };
              
              await callEmailWebhook(emailData, accountId, account.user_id);
            } catch (webhookError) {
              console.error(`[BACKGROUND SYNC] Error calling webhook for email UID ${uid}:`, webhookError.message);
              // Don't fail the whole process if webhook fails
            }
          }
        }
      } catch (parseError) {
        console.error(`[BACKGROUND SYNC] Error parsing email:`, parseError.message);
        // Continue with next email
      }
    }

    // Update sync state with highest UID
    if (messages.length > 0) {
      const maxUID = Math.max(...messages.map(m => parseInt(m.attributes.uid)));
      await supabaseAdmin
        .from('email_sync_state')
        .upsert({
          account_id: accountId,
          folder_name: folder,
          last_uid_synced: maxUID,
          total_server_count: box.messages?.total || 0,
          last_sync_at: new Date().toISOString(),
          sync_errors_count: 0,
          last_error_message: null,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'account_id,folder_name'
        });

      console.log(`[BACKGROUND SYNC] Updated sync state: last_uid_synced = ${maxUID}`);
    }

    // ✅ CRITICAL: Clear needs_reconnection flag on successful sync (even if 0 emails)
    // This ensures that if background sync works, the account is marked as healthy
    try {
      await supabaseAdmin
        .from('email_accounts')
        .update({
          needs_reconnection: false,
          last_error: null,
          last_successful_sync_at: new Date().toISOString()
        })
        .eq('id', accountId);
      
      console.log(`[BACKGROUND SYNC] ✅ Cleared needs_reconnection flag for ${accountId} (sync successful)`);
    } catch (updateErr) {
      console.warn('[BACKGROUND SYNC] Failed to clear needs_reconnection flag:', updateErr.message);
    }

    return savedCount;

  } catch (error) {
    // ✅ Detect and mark authentication errors
    const isAuthError = error.message?.includes('Not authenticated') || 
                       error.message?.includes('AUTHENTICATIONFAILED') ||
                       error.message?.includes('Invalid credentials') ||
                       error.message?.includes('authentication') ||
                       error.message?.includes('credentials') ||
                       error.message?.includes('LOGIN');

    if (isAuthError) {
      console.error(`[BACKGROUND SYNC] ❌ Authentication failed for account ${accountId}:`, error.message);
      
      // ✅ CRITICAL: Close all connections for this account when auth fails
      // They're likely stale/invalid
      try {
        connectionPool.closeAccountConnections(accountId);
        console.log(`[BACKGROUND SYNC] 🔄 Closed all connections for ${accountId} due to auth failure`);
      } catch (closeErr) {
        console.warn('[BACKGROUND SYNC] Error closing connections:', closeErr.message);
      }
      
      // Mark account as needing reconnection
      try {
        await supabaseAdmin
          .from('email_accounts')
          .update({ 
            needs_reconnection: true,
            last_error: `Authentication failed: ${error.message}`,
            last_connection_attempt: new Date().toISOString()
          })
          .eq('id', accountId);
        
        console.log(`[BACKGROUND SYNC] ✅ Marked account ${accountId} as needing reconnection`);
      } catch (updateErr) {
        console.error('[BACKGROUND SYNC] Failed to update account status:', updateErr);
      }
      
      return 0; // No emails synced
    }

    // Handle throttling errors gracefully
    if (isThrottlingError(error)) {
      console.error(`[BACKGROUND SYNC] Throttling error for ${accountId}/${folder}:`, error.message);
      return 0;
    }

    console.error(`[BACKGROUND SYNC] Error syncing ${accountId}/${folder}:`, error.message);
    return 0; // Don't throw - background sync failures are non-critical
  } finally {
    if (connection) {
      try {
        connectionPool.releaseConnection(accountId, connection, false);
      } catch (endError) {
        // Ignore errors when releasing connection
      }
    }
  }
}

/**
 * Sync multiple folders for an account
 */
async function syncAccountFolders(accountId, folders = ['INBOX', 'Sent', 'Drafts']) {
  const results = {};
  for (const folder of folders) {
    try {
      const count = await syncNewEmailsOnly(accountId, folder);
      results[folder] = count;
    } catch (error) {
      console.error(`[BACKGROUND SYNC] Error syncing folder ${folder}:`, error.message);
      results[folder] = 0;
    }
  }
  return results;
}

module.exports = {
  syncNewEmailsOnly,
  syncAccountFolders
};

