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

    // ✅ FIX: Attempt sync even if needs_reconnection is set
    // This allows sync to clear the flag on success
    if (account.needs_reconnection) {
      console.log(`[BACKGROUND SYNC] ⚠️  Account ${accountId} (${account.email || 'unknown'}) marked as needs_reconnection, but attempting sync to clear flag`);
    }

    if (!account.imap_host || !account.imap_username) {
      throw new Error('IMAP settings not configured');
    }

    // Get last synced UID from database
    const { data: syncState } = await supabaseAdmin
      .from('email_sync_state')
      .select('last_uid_synced, last_sync_at')
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

    // ✅ FIX: Verify connection state before use
    if (!connection || !connection.imap) {
      console.error(`[BACKGROUND SYNC] ❌ Invalid connection object for ${accountId}`);
      throw new Error('Invalid IMAP connection');
    }

    const connectionState = connection.imap.state;
    console.log(`[BACKGROUND SYNC] Connection state: ${connectionState}`);
    
    if (connectionState !== 'authenticated') {
      console.warn(`[BACKGROUND SYNC] ⚠️  Connection not authenticated (state: ${connectionState}), closing and creating new connection`);
      try {
        connectionPool.closeAccountConnections(accountId);
      } catch (closeErr) {
        console.warn(`[BACKGROUND SYNC] Error closing connections:`, closeErr.message);
      }
      
      // Create fresh connection
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
              operationName: `[BACKGROUND SYNC] Reconnecting to IMAP for ${account.email}`
            }
          );
        }
      );
      
      if (!connection || connection.imap?.state !== 'authenticated') {
        throw new Error(`Failed to establish authenticated connection (state: ${connection?.imap?.state || 'unknown'})`);
      }
      console.log(`[BACKGROUND SYNC] ✅ New connection established and authenticated`);
    }

    // Open mailbox with retry
    console.log(`[BACKGROUND SYNC] Opening folder ${folder}...`);
    const box = await retryWithBackoff(
      async () => {
        if (!connection || connection.imap?.state !== 'authenticated') {
          throw new Error(`Connection lost before opening folder (state: ${connection?.imap?.state || 'unknown'})`);
        }
        return await connection.openBox(folder);
      },
      {
        maxRetries: 3,
        baseDelay: 2000,
        maxDelay: 30000,
        operationName: `[BACKGROUND SYNC] Opening folder ${folder}`
      }
    );

    const totalMessages = box.messages?.total || 0;
    console.log(`[BACKGROUND SYNC] ✅ Opened folder ${folder}, total messages: ${totalMessages}`);

    // ✅ OPTIMIZED: Use UID-based incremental sync
    // Strategy: Fetch only recent messages (last 500) instead of ALL to avoid timeouts
    // Then filter by UID > lastUID for true incremental sync
    
    console.log(`[BACKGROUND SYNC] Fetching messages from ${folder} (last synced UID: ${lastUID}, total: ${totalMessages})`);

    let allMessages = [];
    
    if (totalMessages === 0) {
      console.log(`[BACKGROUND SYNC] Mailbox is empty, no messages to sync`);
      allMessages = [];
    } else if (lastUID > 0) {
      // ✅ OPTIMIZED INCREMENTAL SYNC: Fetch only recent messages (last 100) to avoid timeouts
      // For IDLE-triggered syncs, we only need the newest messages since IDLE tells us when new emails arrive
      // This is much faster and prevents timeouts on large mailboxes
      const fetchLimit = 100; // ✅ REDUCED: Fetch last 100 messages (was 500) to prevent timeouts
      const startSeq = Math.max(1, totalMessages - fetchLimit + 1);
      const endSeq = totalMessages;
      
      console.log(`[BACKGROUND SYNC] 📊 Fetching sequence ${startSeq}:${endSeq} (last ${fetchLimit} messages) for UID filtering`);
      
      allMessages = await retryWithBackoff(
        async () => {
          // ✅ FIX: Verify connection state before search
          if (!connection || connection.imap?.state !== 'authenticated') {
            throw new Error(`Connection lost before search (state: ${connection?.imap?.state || 'unknown'})`);
          }
          
          console.log(`[BACKGROUND SYNC] Executing search on ${folder} (sequence ${startSeq}:${endSeq})...`);
          
          // Use sequence range search (more efficient than ALL)
          // ✅ INCREASED TIMEOUT: 60 seconds for large mailboxes
          const messages = await Promise.race([
            connection.search([`${startSeq}:${endSeq}`], {
              bodies: '',
              struct: true,
              markSeen: false
            }),
            // ✅ INCREASED TIMEOUT: 60 seconds instead of 30 to handle large mailboxes
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Search timeout after 60 seconds')), 60000)
            )
          ]);
          
          console.log(`[BACKGROUND SYNC] Search completed, found ${messages?.length || 0} messages`);
          return messages || [];
        },
        {
          maxRetries: 2, // ✅ REDUCED: 2 retries instead of 3 to fail faster
          baseDelay: 2000,
          maxDelay: 30000,
          operationName: `[BACKGROUND SYNC] Searching recent messages in ${folder}`
        }
      );
      
      // If we got fewer messages than expected, we might have missed some
      // In that case, if lastUID is high, we should check if we need to fetch more
      if (allMessages.length < fetchLimit && lastUID > 0) {
        const maxUidInResults = Math.max(...allMessages.map(m => parseInt(m.attributes.uid) || 0), 0);
        if (maxUidInResults <= lastUID && allMessages.length > 0) {
          console.log(`[BACKGROUND SYNC] ⚠️  All fetched messages have UID <= ${lastUID}, but we only fetched last ${fetchLimit}. Fetching more...`);
          // ✅ REDUCED: Fetch a smaller wider range (300 instead of 1000) to prevent timeouts
          const widerLimit = 300;
          const widerStartSeq = Math.max(1, totalMessages - widerLimit + 1);
          const widerEndSeq = totalMessages;
          console.log(`[BACKGROUND SYNC] 📊 Fetching wider range: sequence ${widerStartSeq}:${widerEndSeq}`);
          
          try {
            const widerMessages = await Promise.race([
              connection.search([`${widerStartSeq}:${widerEndSeq}`], {
                bodies: '',
                struct: true,
                markSeen: false
              }),
              // ✅ INCREASED TIMEOUT: 90 seconds for wider range
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Search timeout after 90 seconds')), 90000)
              )
            ]);
            allMessages = widerMessages || [];
            console.log(`[BACKGROUND SYNC] Wider search returned ${allMessages.length} messages`);
          } catch (widerError) {
            console.warn(`[BACKGROUND SYNC] Wider search failed: ${widerError.message}, using initial results`);
          }
        }
      }
    } else {
      // ✅ INITIAL SYNC: lastUID is 0, fetch only most recent messages (last 50)
      console.log(`[BACKGROUND SYNC] 🎯 Initial sync (lastUID=0), fetching last 50 messages`);
      const initialLimit = 50;
      const startSeq = Math.max(1, totalMessages - initialLimit + 1);
      const endSeq = totalMessages;
      
      allMessages = await retryWithBackoff(
        async () => {
          if (!connection || connection.imap?.state !== 'authenticated') {
            throw new Error(`Connection lost before search (state: ${connection?.imap?.state || 'unknown'})`);
          }
          
          console.log(`[BACKGROUND SYNC] Executing initial sync search (sequence ${startSeq}:${endSeq})...`);
          const messages = await Promise.race([
            connection.search([`${startSeq}:${endSeq}`], {
              bodies: '',
              struct: true,
              markSeen: false
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Search timeout after 30 seconds')), 30000)
            )
          ]);
          console.log(`[BACKGROUND SYNC] Initial search completed, found ${messages?.length || 0} messages`);
          return messages || [];
        },
        {
          maxRetries: 3,
          baseDelay: 3000,
          maxDelay: 60000,
          operationName: `[BACKGROUND SYNC] Initial sync search in ${folder}`
        }
      );
    }

    if (!allMessages || allMessages.length === 0) {
      console.log(`[BACKGROUND SYNC] No messages found in ${folder}`);
      // Still update sync state timestamp even if no messages
      await supabaseAdmin
        .from('email_sync_state')
        .upsert({
          account_id: accountId,
          folder_name: folder,
          last_uid_synced: lastUID,
          total_server_count: box.messages?.total || 0,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'account_id,folder_name'
        });
      return 0;
    }

    console.log(`[BACKGROUND SYNC] ✅ Search returned ${allMessages.length} total messages from ${folder}`);

    // ✅ CRITICAL: Filter client-side to only get new emails (UID > lastUID)
    // This is the core incremental sync logic
    let messages = [];
    
    if (lastUID > 0 && allMessages.length > 0) {
      // Filter by UID > lastUID
      messages = allMessages.filter(msg => {
        const uid = parseInt(msg.attributes.uid) || 0;
        if (uid === 0) {
          console.warn(`[BACKGROUND SYNC] ⚠️  Message missing UID, skipping`);
          return false;
        }
        return uid > lastUID;
      });
      
      console.log(`[BACKGROUND SYNC] 🔍 UID Filter: ${allMessages.length} total messages, ${messages.length} with UID > ${lastUID}`);
      
      // Log UID range for debugging
      if (allMessages.length > 0) {
        const allUids = allMessages.map(m => parseInt(m.attributes.uid) || 0).filter(uid => uid > 0).sort((a, b) => a - b);
        if (allUids.length > 0) {
          console.log(`[BACKGROUND SYNC] 📊 Fetched message UID range: ${allUids[0]} to ${allUids[allUids.length - 1]}`);
        }
      }
    } else if (lastUID === 0) {
      // Initial sync - take all fetched messages
      messages = allMessages;
      console.log(`[BACKGROUND SYNC] 🎯 Initial sync: using all ${messages.length} fetched messages`);
    } else {
      messages = [];
    }

    console.log(`[BACKGROUND SYNC] ✅ Found ${messages.length} new emails to sync (filtering by UID > ${lastUID})`);
    
    if (messages.length > 0) {
      const uids = messages.map(m => parseInt(m.attributes.uid)).filter(uid => uid > 0).sort((a, b) => a - b);
      if (uids.length > 0) {
        console.log(`[BACKGROUND SYNC] 📧 New email UID range: ${uids[0]} to ${uids[uids.length - 1]} (${uids.length} emails)`);
      }
    }
    if (syncState?.last_sync_at) {
      const lastSyncTime = new Date(syncState.last_sync_at);
      const hoursSinceSync = (Date.now() - lastSyncTime.getTime()) / (1000 * 60 * 60);
      if (hoursSinceSync > 1) {
        console.log(`[BACKGROUND SYNC] ⚠️  Last sync was ${hoursSinceSync.toFixed(1)} hours ago`);
      }
    }

    if (messages.length === 0) {
      console.log(`[BACKGROUND SYNC] No new emails found for ${accountId}/${folder} (last UID: ${lastUID}, total in mailbox: ${totalMessages})`);
      // Still update sync state timestamp even if no new messages
      await supabaseAdmin
        .from('email_sync_state')
        .upsert({
          account_id: accountId,
          folder_name: folder,
          last_uid_synced: lastUID,
          total_server_count: totalMessages,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'account_id,folder_name'
        });
      return 0;
    }

    console.log(`[BACKGROUND SYNC] 📬 Processing ${messages.length} new emails for ${accountId}/${folder}`);

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

    // ✅ CRITICAL: Update sync state with highest UID from ALL fetched messages (not just new ones)
    // This ensures we don't miss emails if they're in the fetched range but filtered out
    // We need to track the highest UID we've seen, even if we didn't sync it
    const allFetchedUids = allMessages.length > 0
      ? allMessages.map(m => parseInt(m.attributes.uid) || 0).filter(uid => uid > 0)
      : [];
    const maxFetchedUID = allFetchedUids.length > 0 ? Math.max(...allFetchedUids) : lastUID;
    
    // For new messages, get the max UID
    const newMessageUids = messages.length > 0
      ? messages.map(m => parseInt(m.attributes.uid) || 0).filter(uid => uid > 0)
      : [];
    const maxNewUID = newMessageUids.length > 0 ? Math.max(...newMessageUids) : lastUID;
    
    // Use the maximum of: lastUID, maxFetchedUID, maxNewUID
    // This ensures we always advance the UID pointer, even if we filtered out some messages
    const maxUID = Math.max(lastUID, maxFetchedUID, maxNewUID);
    
    console.log(`[BACKGROUND SYNC] 📊 UID tracking: lastUID=${lastUID}, maxFetched=${maxFetchedUID}, maxNew=${maxNewUID}, final=${maxUID}`);
    
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

    console.log(`[BACKGROUND SYNC] Updated sync state: last_uid_synced = ${maxUID} (${messages.length} new messages)`);

    // ✅ CRITICAL: Clear needs_reconnection flag on successful sync (even if 0 emails)
    // This ensures that if background sync works, the account is marked as healthy
    // This is important because folder fetching and other operations depend on this flag
    try {
      await supabaseAdmin
        .from('email_accounts')
        .update({
          needs_reconnection: false,
          last_error: null,
          last_successful_sync_at: new Date().toISOString(),
          sync_status: 'idle'
        })
        .eq('id', accountId);
      
      console.log(`[BACKGROUND SYNC] ✅ Cleared needs_reconnection flag for ${accountId} (sync successful, ${savedCount} emails saved)`);
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

