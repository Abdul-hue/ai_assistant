/**
 * Enhanced IMAP Email Sync Service
 * UID-based incremental syncing with all-folder support
 * Periodically checks for new emails from all IMAP/SMTP accounts
 * and saves them to Supabase database
 */

const { supabaseAdmin } = require('../config/supabase');
const { decryptPassword } = require('../utils/encryption');
const { connectToImap: connectToImapUtil } = require('../utils/connectToImap');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const { callEmailWebhook } = require('../utils/emailWebhook');
const { retryWithBackoff, isThrottlingError, sleep } = require('../utils/imapRetry');
const connectionPool = require('../utils/imapConnectionPool');

// Batch processing configuration
const BATCH_SIZE = 50; // Process 50 emails at a time
const BATCH_DELAY = 1000; // 1 second delay between batches

// Connection health check configuration
const CONNECTION_HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ============================================
// SYNC STATE MANAGEMENT
// ============================================

/**
 * Get or create sync state for folder
 */
async function getSyncState(accountId, folderName) {
  const { data, error } = await supabaseAdmin
    .from('email_sync_state')
    .select('*')
    .eq('account_id', accountId)
    .eq('folder_name', folderName)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows

  if (!data) {
    // Create new sync state for first sync
    const { data: newState, error: createError } = await supabaseAdmin
      .from('email_sync_state')
      .insert({
        account_id: accountId,
        folder_name: folderName,
        last_uid_synced: 0,
        total_server_count: 0,
      })
      .select()
      .single();

    if (createError) throw createError;
    return newState;
  }

  return data;
}

/**
 * Update sync state after successful sync
 */
async function updateSyncState(accountId, folderName, lastUid, totalCount) {
  const { error } = await supabaseAdmin
    .from('email_sync_state')
    .upsert({
      account_id: accountId,
      folder_name: folderName,
      last_uid_synced: lastUid,
      total_server_count: totalCount,
      last_sync_at: new Date().toISOString(),
      sync_errors_count: 0,
      last_error_message: null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'account_id,folder_name'
    });
  if (error) throw error;
}

/**
 * Log sync activity
 */
async function logSyncActivity(accountId, folderName, syncData) {
  const { error } = await supabaseAdmin
    .from('email_sync_logs')
    .insert({
      account_id: accountId,
      folder_name: folderName,
      sync_type: syncData.syncType || 'incremental',
      emails_fetched: syncData.emailsFetched || 0,
      emails_saved: syncData.emailsSaved || 0,
      emails_updated: syncData.emailsUpdated || 0,
      errors_count: syncData.errorsCount || 0,
      duration_ms: syncData.durationMs || 0,
      error_details: syncData.errorDetails || null,
    });
  if (error) console.error('Error logging sync:', error);
}

// ============================================
// IMAP CONNECTION
// ============================================

/**
 * Check if IMAP connection is healthy and authenticated
 * @param {Object} connection - IMAP connection object
 * @returns {Promise<boolean>} - True if connection is healthy
 */
async function isConnectionHealthy(connection) {
  if (!connection || !connection.imap) {
    return false;
  }
  
  try {
    // Check if connection is in authenticated state
    const state = connection.imap.state;
    if (state !== 'authenticated') {
      console.log(`[HEALTH-CHECK] Connection not authenticated (state: ${state})`);
      return false;
    }
    
    // Try a lightweight operation to verify connection
    // Using getBoxes() is a lightweight way to verify authentication
    await connection.getBoxes();
    return true;
  } catch (error) {
    // Check for authentication errors
    if (error.message?.includes('Not authenticated') || 
        error.message?.includes('not authenticated') ||
        error.message?.includes('authentication') ||
        error.code === 'EAUTH') {
      console.error('[HEALTH-CHECK] Connection authentication failed:', error.message);
      return false;
    }
    
    console.error('[HEALTH-CHECK] Connection health check failed:', error.message);
    return false;
  }
}

/**
 * Ensure connection is healthy, reconnect if needed
 * @param {string} accountId - Account ID
 * @param {Object} account - Account object from database
 * @returns {Promise<Object>} - Healthy IMAP connection
 */
async function ensureHealthyConnection(accountId, account) {
  let connection = null;
  
  // Try to get existing connection from pool
  try {
    connection = await connectionPool.getConnection(
      accountId,
      async () => {
        return await connectToImap(account);
      }
    );
  } catch (error) {
    console.error(`[RECONNECT] Error getting connection from pool:`, error.message);
    // Will create new connection below
  }
  
  // Check if connection exists and is healthy
  const isHealthy = connection ? await isConnectionHealthy(connection) : false;
  
  if (!isHealthy) {
    console.log(`[RECONNECT] Connection unhealthy for ${account.email}, reconnecting...`);
    
    // Close existing connection if any
    if (connection) {
      try {
        connectionPool.closeAccountConnections(accountId);
      } catch (e) {
        console.error('[RECONNECT] Error closing old connection:', e.message);
      }
    }
    
    // Establish new connection
    connection = await connectionPool.getConnection(
      accountId,
      async () => {
        return await connectToImap(account);
      }
    );
    
    if (!connection) {
      throw new Error('Failed to establish IMAP connection');
    }
    
    // Verify new connection is healthy
    const newConnectionHealthy = await isConnectionHealthy(connection);
    if (!newConnectionHealthy) {
      throw new Error('New IMAP connection is not authenticated');
    }
    
    console.log(`[RECONNECT] ✅ Successfully reconnected for ${account.email}`);
  }
  
  return connection;
}

/**
 * Connect to IMAP server
 * Uses the centralized connectToImap utility
 */
async function connectToImap(account) {
  return await connectToImapUtil(account);
}

// ============================================
// EMAIL PARSING
// ============================================

/**
 * Parse email from IMAP format
 */
async function parseEmailFromImap(mail, uid, folder) {
  try {
    // mailparser returns from/to as objects with text and value properties
    const fromObj = mail.from || mail.headers.get('from') || {};
    const toObj = mail.to || mail.headers.get('to') || {};
    const subject = mail.subject || mail.headers.get('subject') || '[No Subject]';
    const date = mail.date || mail.headers.get('date') || new Date().toISOString();

    // Get from text (string representation) or use value array
    // Ensure fromText is always a string
    let fromText = '';
    let fromValue = [];
    
    if (typeof fromObj === 'string') {
      fromText = fromObj;
    } else if (fromObj && typeof fromObj === 'object') {
      fromText = fromObj.text || '';
      fromValue = fromObj.value || [];
    } else {
      fromText = String(fromObj || '');
    }

    // Parse sender name and email - ensure fromText is string before calling match
    const fromMatch = fromText && typeof fromText === 'string' ? fromText.match(/"?([^"<]*)"?\s*<([^>]+)>/) : null;
    const senderName = fromMatch ? fromMatch[1].trim() : 
                      (fromValue?.[0]?.name || (fromText ? String(fromText).split('@')[0] : '') || 'Unknown');
    const senderEmail = fromMatch ? fromMatch[2] : 
                        (fromValue?.[0]?.address || fromText || '');

    // Get to text (string representation) or use value array
    // Ensure toText is always a string
    let toText = '';
    let toValue = [];
    
    if (typeof toObj === 'string') {
      toText = toObj;
    } else if (toObj && typeof toObj === 'object') {
      toText = toObj.text || '';
      toValue = toObj.value || [];
    } else {
      toText = String(toObj || '');
    }

    // Parse recipient - ensure toText is string before calling match
    const toMatch = toText && typeof toText === 'string' ? toText.match(/"?([^"<]*)"?\s*<([^>]+)>/) : null;
    const recipientEmail = toMatch ? toMatch[2] : 
                          (toValue?.[0]?.address || (toText ? String(toText).split(',')[0] : '') || '');

    // Handle plain text and HTML bodies
    let bodyText = '';
    let bodyHtml = '';
    if (mail.text) bodyText = mail.text;
    if (mail.html) bodyHtml = mail.html;

    // Get attachments info
    const attachments = (mail.attachments || []).map(att => ({
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      cid: att.cid,
    }));

    return {
      uid: uid,
      sender_name: senderName,
      sender_email: senderEmail,
      recipient_email: recipientEmail,
      subject: subject.substring(0, 255), // Limit subject length
      body_text: bodyText,
      body_html: bodyHtml,
      received_at: new Date(date).toISOString(),
      is_read: false, // Will update from flags
      is_starred: false,
      attachments_meta: JSON.stringify(attachments),
      attachments_count: attachments.length,
      folder_name: folder,
    };
  } catch (error) {
    console.error('Error parsing email:', error);
    return null;
  }
}

// ============================================
// SAVE OR UPDATE EMAIL
// ============================================

/**
 * Save or update email in Supabase
 */
async function saveOrUpdateEmail(accountId, emailData, mailFlags) {
  try {
    const providerId = `${accountId}_${emailData.uid}_${emailData.folder_name}`;
    const isRead = mailFlags?.includes('\\Seen') || false;
    const isStarred = mailFlags?.includes('\\Flagged') || false;

    // ✅ USE UPSERT with correct constraint (prevents duplicates from competing syncs)
    const { data: savedEmail, error: upsertError } = await supabaseAdmin
      .from('emails')
      .upsert({
        email_account_id: accountId,
        provider_message_id: providerId,
        uid: emailData.uid,
        sender_email: emailData.sender_email || emailData.from || '',
        sender_name: emailData.sender_name || emailData.fromName || '',
        recipient_email: emailData.recipient_email || emailData.to || '',
        subject: emailData.subject || '[No Subject]',
        body_text: emailData.body_text || emailData.body || '',
        body_html: emailData.body_html || emailData.bodyHtml || '',
        received_at: emailData.received_at || emailData.date || new Date().toISOString(),
        folder_name: emailData.folder_name || 'INBOX',
        is_read: isRead,
        is_starred: isStarred,
        is_deleted: false,
        attachments_count: emailData.attachments_count || emailData.attachments?.length || 0,
        attachments_meta: emailData.attachments_meta || emailData.attachments || [],
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'email_account_id,provider_message_id', // ✅ Correct constraint
        ignoreDuplicates: false // Update if exists
      })
      .select()
      .single();

    // ✅ Only throw on real errors (not duplicate key errors)
    if (upsertError) {
      // Suppress duplicate key errors (code 23505) - they're expected when multiple syncs run
      if (upsertError.code === '23505' || upsertError.message?.includes('duplicate key')) {
        // Email already exists, try to get it and return updated
        const { data: existing } = await supabaseAdmin
          .from('emails')
          .select('id')
          .eq('email_account_id', accountId)
          .eq('provider_message_id', providerId)
          .single();
        
        if (existing) {
          // Update flags
          await supabaseAdmin
            .from('emails')
            .update({
              is_read: isRead,
              is_starred: isStarred,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
          
          return { action: 'updated', id: existing.id };
        }
        // If we can't find it, treat as inserted (race condition resolved)
        return { action: 'inserted', id: null };
      }
      // Real error - throw it
      throw upsertError;
    }

    // Check if this was an insert or update by checking if email was just created
    // (We can't easily tell from upsert, so we'll assume it was an update if we got here)
    // Actually, let's check if the email existed before by looking at created_at vs updated_at
    const wasInserted = savedEmail?.created_at === savedEmail?.updated_at || 
                        (savedEmail?.created_at && new Date(savedEmail.created_at).getTime() > Date.now() - 1000);
    
    return { 
      action: wasInserted ? 'inserted' : 'updated', 
      id: savedEmail?.id 
    };
  } catch (error) {
    // ✅ Suppress duplicate key errors in logs
    if (error.code === '23505' || error.message?.includes('duplicate key')) {
      // Silently handle duplicates - they're expected
      return { action: 'updated', id: null };
    }
    console.error('Error saving email:', error);
    throw error;
  }
}

// ============================================
// SYNC SINGLE FOLDER (UID-Based)
// ============================================

/**
 * Sync single folder with UID-based incremental approach
 */
async function syncFolder(connection, accountId, folderName, account) {
  const startTime = Date.now();
  let emailsFetched = 0;
  let emailsSaved = 0;
  let emailsUpdated = 0;
  let errorsCount = 0;
  try {
    console.log(`[SYNC] Starting sync for folder: ${folderName}`);

    // CRITICAL: Ensure connection is healthy before operations
    connection = await ensureHealthyConnection(accountId, account);

    // Get sync state
    const syncState = await getSyncState(accountId, folderName);
    const lastSyncUid = syncState.last_uid_synced || 0;

    // Open the folder with retry and connection health check
    const box = await retryWithBackoff(
      async () => {
        // Re-verify connection health before each retry
        const isHealthy = await isConnectionHealthy(connection);
        if (!isHealthy) {
          console.log('[SYNC] Connection lost during retry, reconnecting...');
          connection = await ensureHealthyConnection(accountId, account);
        }
        
        try {
          return await connection.openBox(folderName, false);
        } catch (error) {
          // Handle authentication errors by reconnecting
          if (error.message?.includes('Not authenticated') || 
              error.message?.includes('not authenticated') ||
              error.message?.includes('authentication') ||
              error.code === 'EAUTH') {
            console.log(`[SYNC] Authentication error detected, reconnecting...`);
            connection = await ensureHealthyConnection(accountId, account);
            // Retry opening folder after reconnection
            return await connection.openBox(folderName, false);
          }
          
          // Handle folder not found errors gracefully
          if (error.textCode === 'NONEXISTENT' || error.message?.includes('Unknown Mailbox')) {
            console.warn(`[SYNC] Folder ${folderName} does not exist, skipping`);
            throw new Error(`Folder ${folderName} does not exist`);
          }
          throw error;
        }
      },
      {
        maxRetries: 3,
        baseDelay: 2000,
        maxDelay: 30000,
        operationName: `Opening folder ${folderName}`
      }
    );
    
    console.log(`[SYNC] Opened folder ${folderName}, total messages: ${box.messages.total}`);

    // imap-simple doesn't support UID range searches, so we fetch all and filter client-side
    // This is less efficient but works reliably
    const fetchOptions = {
      bodies: '',
      struct: true,
      markSeen: false
    };

    // Search for all messages with retry for throttling
    const allMessages = await retryWithBackoff(
      async () => {
        // Re-verify connection health before search
        const isHealthy = await isConnectionHealthy(connection);
        if (!isHealthy) {
          console.log('[SYNC] Connection lost during search, reconnecting...');
          connection = await ensureHealthyConnection(accountId, account);
        }
        
        try {
          return await connection.search(['ALL'], fetchOptions);
        } catch (error) {
          // Handle authentication errors by reconnecting
          if (error.message?.includes('Not authenticated') || 
              error.message?.includes('not authenticated') ||
              error.message?.includes('authentication') ||
              error.code === 'EAUTH') {
            console.log(`[SYNC] Authentication error during search, reconnecting...`);
            connection = await ensureHealthyConnection(accountId, account);
            // Retry search after reconnection
            return await connection.search(['ALL'], fetchOptions);
          }
          throw error;
        }
      },
      {
        maxRetries: 5,
        baseDelay: 3000,
        maxDelay: 60000,
        operationName: `Searching messages in ${folderName}`
      }
    );

    // Filter to only new messages (UID > lastSyncUid)
    const messages = lastSyncUid > 0
      ? allMessages.filter(msg => {
          const uid = parseInt(msg.attributes.uid);
          return uid > lastSyncUid;
        })
      : allMessages;

    if (messages.length === 0) {
      console.log(`[SYNC] No new messages in ${folderName}`);
      await updateSyncState(accountId, folderName, lastSyncUid, box.messages.total);
      return { emailsFetched: 0, emailsSaved: 0, emailsUpdated: 0, errorsCount: 0 };
    }

    console.log(`[SYNC] Found ${messages.length} new messages in ${folderName}`);

    // Process messages in batches to avoid overwhelming Gmail
    const batches = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      batches.push(messages.slice(i, i + BATCH_SIZE));
    }

    console.log(`[SYNC] Processing ${messages.length} messages in ${batches.length} batches of ${BATCH_SIZE}`);

    // Process each batch with delay between batches
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      // Add delay between batches (except first batch)
      if (batchIndex > 0) {
        console.log(`[SYNC] Waiting ${BATCH_DELAY}ms before processing batch ${batchIndex + 1}/${batches.length}...`);
        await sleep(BATCH_DELAY);
      }

      console.log(`[SYNC] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} messages)`);

      // Process messages in current batch
      for (const msg of batch) {
      try {
        emailsFetched++;

        const all = msg.parts.find(part => part.which === '');
        const uid = msg.attributes.uid;
        const flags = msg.attributes.flags || [];
        const numericUid = parseInt(uid);
        
        const idHeader = 'Imap-Id: ' + uid + '\r\n';
        const mail = await simpleParser(idHeader + all.body);

        // Parse and format email
        const emailData = await parseEmailFromImap(mail, numericUid, folderName);

        if (!emailData) {
          errorsCount++;
          continue;
        }

        // Save or update in database
        const result = await saveOrUpdateEmail(accountId, emailData, flags);

        if (result.action === 'inserted') {
          emailsSaved++;
          
          // Call webhook/API for new emails
          try {
            // Get account info for user_id and webhook status
            const { data: account } = await supabaseAdmin
              .from('email_accounts')
              .select('user_id, initial_sync_completed, webhook_enabled_at')
              .eq('id', accountId)
              .single();
            
            if (account?.user_id) {
              // Ensure webhook_enabled_at is set if initial_sync_completed is true
              if (account.initial_sync_completed && !account.webhook_enabled_at) {
                console.log(`[SYNC] Setting webhook_enabled_at for account ${accountId}`);
                await supabaseAdmin
                  .from('email_accounts')
                  .update({ webhook_enabled_at: new Date().toISOString() })
                  .eq('id', accountId);
              }
              
              const webhookResult = await callEmailWebhook(emailData, accountId, account.user_id);
              if (webhookResult.success) {
                console.log(`[SYNC] ✅ Webhook sent for email UID ${numericUid} (${emailData.subject?.substring(0, 50) || 'No Subject'})`);
              } else {
                console.log(`[SYNC] ⚠️ Webhook skipped for email UID ${numericUid}: ${webhookResult.reason || 'unknown'}`);
              }
            } else {
              console.warn(`[SYNC] No user_id found for account ${accountId}, skipping webhook`);
            }
          } catch (webhookError) {
            console.error(`[SYNC] Error calling webhook for email UID ${numericUid}:`, webhookError.message);
            // Don't fail the whole process if webhook fails
          }
        } else if (result.action === 'updated') {
          emailsUpdated++;
        }

        // Track highest UID processed
        if (numericUid > lastSyncUid) {
          syncState.last_uid_synced = numericUid;
        }
      } catch (error) {
          // Handle throttling in batch processing
          if (isThrottlingError(error)) {
            console.warn(`[SYNC] Throttling detected in batch ${batchIndex + 1}, waiting before continuing...`);
            await sleep(5000); // Wait 5 seconds on throttling
            errorsCount++;
            continue;
          }
          
          console.error(`[SYNC] Error processing message UID ${numericUid}:`, error.message);
        errorsCount++;
        }
      }
    }

    // ✅ FIX: Update sync state with highest UID (even if no new messages, update timestamp)
    // This ensures sync state is always current and background sync knows when last sync happened
    const allUids = messages.length > 0 
      ? messages.map(msg => parseInt(msg.attributes.uid))
      : [];
    const highestUid = allUids.length > 0 
      ? Math.max(...allUids)
      : lastSyncUid; // Keep existing UID if no new messages
    
    await updateSyncState(accountId, folderName, highestUid, box.messages.total);
    
    if (messages.length === 0) {
      console.log(`[SYNC] No new messages in ${folderName}, sync state updated (last_uid_synced: ${highestUid})`);
    }

    const duration = Date.now() - startTime;
    console.log(`[SYNC] Completed ${folderName}: Fetched: ${emailsFetched}, Saved: ${emailsSaved}, Updated: ${emailsUpdated}, Errors: ${errorsCount}, Duration: ${duration}ms`);
    return { emailsFetched, emailsSaved, emailsUpdated, errorsCount, duration };
  } catch (error) {
    // Handle throttling errors gracefully - don't crash the process
    if (isThrottlingError(error)) {
      console.error(`[SYNC] Throttling error syncing folder ${folderName}:`, error.message);
      // Return partial results instead of throwing
      return { 
        emailsFetched, 
        emailsSaved, 
        emailsUpdated, 
        errorsCount: errorsCount + 1,
        throttled: true 
      };
    }
    
    // Handle folder not found errors gracefully
    if (error.message?.includes('does not exist') || 
        error.textCode === 'NONEXISTENT') {
      console.warn(`[SYNC] Folder ${folderName} not found, skipping`);
      return { emailsFetched: 0, emailsSaved: 0, emailsUpdated: 0, errorsCount: 0 };
    }
    
    // Handle authentication errors
    if (error.message?.includes('Not authenticated') || 
        error.message?.includes('not authenticated') ||
        error.message?.includes('authentication') ||
        error.code === 'EAUTH') {
      console.error(`[SYNC] Authentication error syncing folder ${folderName}:`, error.message);
      // Clear connection for this account
      connectionPool.closeAccountConnections(accountId);
      
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
      } catch (updateError) {
        console.error(`[SYNC] Error updating account ${accountId}:`, updateError.message);
      }
    }
    
    console.error(`[SYNC] Error syncing folder ${folderName}:`, error);
    // Don't throw - return error state instead to prevent process crash
    return { 
      emailsFetched, 
      emailsSaved, 
      emailsUpdated, 
      errorsCount: errorsCount + 1,
      error: error.message 
    };
  }
}

// ============================================
// FLATTEN FOLDER STRUCTURE
// ============================================

/**
 * Flatten nested folder structure
 */
function flattenFolderStructure(boxes, parentPath = '') {
  const folders = [];
  for (const [name, box] of Object.entries(boxes)) {
    const fullName = parentPath ? `${parentPath}${box.delimiter}${name}` : name;
    folders.push({
      name: fullName,
      delimiter: box.delimiter,
      attributes: box.attributes,
    });
    if (box.children) {
      folders.push(...flattenFolderStructure(box.children, fullName));
    }
  }
  return folders;
}

// ============================================
// SYNC ALL FOLDERS FOR ACCOUNT
// ============================================

/**
 * Sync all folders for a single account
 */
async function syncAccountFolders(connection, account) {
  const results = {
    foldersProcessed: 0,
    totalEmailsFetched: 0,
    totalEmailsSaved: 0,
    totalEmailsUpdated: 0,
    totalErrors: 0,
    folderResults: {},
  };
  try {
    // ✅ UPDATED: Get all folders that have been initially synced
    // Only sync folders that were synced during comprehensive sync
    const { data: syncedFolders, error: foldersError } = await supabaseAdmin
      .from('email_sync_state')
      .select('folder_name, initial_sync_completed')
      .eq('account_id', account.id)
      .eq('initial_sync_completed', true);

    let folderNames = [];
    
    if (foldersError) {
      console.error(`[SYNC] Error fetching synced folders:`, foldersError.message);
      // Don't throw - try to sync INBOX anyway
      console.log(`[SYNC] Attempting to sync INBOX folder as fallback`);
      folderNames = ['INBOX'];
    } else if (!syncedFolders || syncedFolders.length === 0) {
      console.log(`[SYNC] No initially synced folders found for account ${account.id}, attempting to sync INBOX`);
      // Try to sync INBOX if no folders are synced yet
      folderNames = ['INBOX'];
    } else {
      folderNames = syncedFolders.map(f => f.folder_name);
      console.log(`[SYNC] Account ${account.id} has ${folderNames.length} initially synced folders:`, folderNames);
    }

    // Sync each folder
    for (const folderName of folderNames) {
      try {
        // CRITICAL: Verify connection before each folder sync
        connection = await ensureHealthyConnection(account.id, account);
        const folderResult = await syncFolder(connection, account.id, folderName, account);

        results.foldersProcessed++;
        results.totalEmailsFetched += folderResult.emailsFetched;
        results.totalEmailsSaved += folderResult.emailsSaved;
        results.totalEmailsUpdated += folderResult.emailsUpdated;
        results.totalErrors += folderResult.errorsCount;
        results.folderResults[folderName] = folderResult;

        // Log this folder's sync
        await logSyncActivity(account.id, folderName, {
          syncType: 'incremental',
          emailsFetched: folderResult.emailsFetched,
          emailsSaved: folderResult.emailsSaved,
          emailsUpdated: folderResult.emailsUpdated,
          errorsCount: folderResult.errorsCount,
          durationMs: folderResult.duration,
        });
      } catch (folderError) {
        console.error(`Error syncing folder ${folderName}:`, folderError.message);
        
        // If authentication error, clear connection and mark for reconnection
        if (folderError.message?.includes('Not authenticated') || 
            folderError.message?.includes('not authenticated') ||
            folderError.message?.includes('authentication') ||
            folderError.code === 'EAUTH') {
          console.log(`[SYNC] Authentication error for folder ${folderName}, clearing connection`);
          connectionPool.closeAccountConnections(account.id);
          
          // Mark account as needing reconnection
          await supabaseAdmin
            .from('email_accounts')
            .update({
              needs_reconnection: true,
              last_error: `Authentication failed: ${folderError.message}`,
              last_connection_attempt: new Date().toISOString()
            })
            .eq('id', account.id);
        }
        
        results.totalErrors++;
        await logSyncActivity(account.id, folderName, {
          syncType: 'incremental',
          errorsCount: 1,
          errorDetails: folderError.message,
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Error syncing account folders:', error);
    
    // If authentication error, force reconnection on next sync
    if (error.message?.includes('Not authenticated') || 
        error.message?.includes('not authenticated') ||
        error.message?.includes('authentication') ||
        error.code === 'EAUTH') {
      console.log('[SYNC] Authentication error detected, clearing connection');
      connectionPool.closeAccountConnections(account.id);
    }
    
    throw error;
  }
}

// ============================================
// GLOBAL SYNC FOR ALL ACCOUNTS
// ============================================

/**
 * Main sync function for all accounts
 */
async function syncAllImapAccounts() {
  const syncStartTime = Date.now();

  try {
    console.log('[SYNC] Starting global sync of all IMAP accounts');

    // ✅ CRITICAL: Get all active IMAP/SMTP accounts
    // Try to sync accounts even if initial_sync_completed is false (with warning)
    // This helps accounts that haven't completed initial sync yet
    const { data: accounts, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('is_active', true)
      // REMOVED: .eq('initial_sync_completed', true) - Allow accounts without initial sync
      .or('provider_type.eq.imap_smtp,provider_type.is.null')
      .not('imap_host', 'is', null)
      .not('imap_username', 'is', null);

    if (error) {
      console.error('[SYNC] ❌ Error fetching accounts:', error.message);
      throw error;
    }

    if (!accounts || accounts.length === 0) {
      console.log('[SYNC] No active IMAP/SMTP accounts found');
      return;
    }

    console.log(`[SYNC] Found ${accounts.length} active accounts`);

    // ✅ Validate each account before processing
    const validAccounts = accounts.filter(account => {
      if (!account.id) {
        console.warn(`[SYNC] ⚠️  Skipping account with missing ID: ${account.email || 'unknown'}`);
        return false;
      }
      if (!account.imap_host || !account.imap_username) {
        console.warn(`[SYNC] ⚠️  Skipping account ${account.email || account.id} - missing IMAP settings`);
        return false;
      }
      // ✅ FIX: Don't skip accounts that need reconnection - try to sync anyway
      // If sync succeeds, we'll clear the flag. If it fails, we'll keep it.
      // This prevents accounts from being permanently stuck in "needs_reconnection" state
      if (account.needs_reconnection) {
        console.log(`[SYNC] ⚠️  Account ${account.email || account.id} marked as needs_reconnection, but attempting sync anyway`);
      }
      // ✅ WARN if initial_sync_completed is false, but still try to sync
      if (!account.initial_sync_completed) {
        console.warn(`[SYNC] ⚠️  Account ${account.email || account.id} has initial_sync_completed=false, but attempting sync anyway`);
      }
      // ✅ WARN if webhook_enabled_at is missing, but still try to sync
      if (!account.webhook_enabled_at && account.initial_sync_completed) {
        console.warn(`[SYNC] ⚠️  Account ${account.email || account.id} has initial_sync_completed=true but webhook_enabled_at is NULL`);
      }
      return true;
    });

    if (validAccounts.length === 0) {
      console.log('[SYNC] No valid accounts to sync');
      return;
    }

    console.log(`[SYNC] Processing ${validAccounts.length} valid accounts (${accounts.length - validAccounts.length} skipped)`);

    for (const account of validAccounts) {
      const accountSyncStart = Date.now();
      
      // ✅ CRITICAL: Re-validate account exists before processing (prevent race conditions)
      const { data: revalidatedAccount, error: revalidateError } = await supabaseAdmin
        .from('email_accounts')
        .select('*')
        .eq('id', account.id)
        .eq('is_active', true)
        .single();

      if (revalidateError || !revalidatedAccount) {
        console.warn(`[SYNC] ⚠️  Account ${account.id} (${account.email || 'unknown'}) was deleted or deactivated during sync. Skipping.`);
        continue;
      }

      // Use revalidated account data
      const activeAccount = revalidatedAccount;
      
      // Check if this is the first sync for this account
      const isInitialSync = !activeAccount.initial_sync_completed;
      if (isInitialSync) {
        console.log(`[SYNC] 🔄 Starting initial sync for account ${activeAccount.id} (${activeAccount.email})`);
      }
      
      try {
        // Update account sync status
        await supabaseAdmin
          .from('email_accounts')
          .update({ sync_status: 'syncing' })
          .eq('id', activeAccount.id);

        // ✅ FIX: Don't skip - attempt sync even if needs_reconnection is true
        // If sync succeeds, we'll clear the flag below
        if (activeAccount.needs_reconnection) {
          console.log(`[SYNC] ⚠️  Account ${activeAccount.email} marked as needs_reconnection, attempting sync to clear flag`);
        }
        
        // ✅ FIX: Ensure webhook_enabled_at is set if initial_sync_completed is true
        if (activeAccount.initial_sync_completed && !activeAccount.webhook_enabled_at) {
          console.log(`[SYNC] ⚠️  Account ${activeAccount.email} has initial_sync_completed=true but webhook_enabled_at is NULL. Setting it now.`);
          await supabaseAdmin
            .from('email_accounts')
            .update({ webhook_enabled_at: new Date().toISOString() })
            .eq('id', activeAccount.id);
          activeAccount.webhook_enabled_at = new Date().toISOString();
        }
        
        // ✅ FIX: Ensure webhook_enabled_at is set if initial_sync_completed is true
        if (activeAccount.initial_sync_completed && !activeAccount.webhook_enabled_at) {
          console.log(`[SYNC] ⚠️  Account ${activeAccount.email} has initial_sync_completed=true but webhook_enabled_at is NULL. Setting it now.`);
          await supabaseAdmin
            .from('email_accounts')
            .update({ webhook_enabled_at: new Date().toISOString() })
            .eq('id', activeAccount.id);
          activeAccount.webhook_enabled_at = new Date().toISOString();
        }

        // ✅ FIX: Check if IDLE is active for this account - if so, skip sync to avoid conflicts
        // IDLE handles real-time sync, so we don't need to run sync jobs simultaneously
        try {
          const appModule = require('../../app');
          const idleManager = appModule.idleManager || appModule.default?.idleManager;
          
          if (idleManager && idleManager.activeConnections && idleManager.activeConnections.has(activeAccount.id)) {
            console.log(`[SYNC] ⏭️  Skipping sync for ${activeAccount.email} - IDLE monitoring is active (prevents connection conflicts)`);
            continue; // Skip this account - IDLE will handle sync
          }
        } catch (idleCheckError) {
          // If we can't check IDLE status, proceed with sync anyway
          console.warn(`[SYNC] ⚠️  Could not check IDLE status:`, idleCheckError.message);
        }

        // Connect to IMAP using connection pool (limits concurrent connections)
        let connection;
        try {
          connection = await connectionPool.getConnection(
            activeAccount.id,
            async () => {
              console.log(`[SYNC] Creating new IMAP connection for account ${activeAccount.email}`);
              return await connectToImap(activeAccount);
            }
          );
        } catch (connectError) {
          // ✅ Handle "Connection ended unexpectedly" - likely rate limiting
          if (connectError.message?.includes('Connection ended unexpectedly') || 
              connectError.message?.includes('ended unexpectedly')) {
            console.error(`[SYNC] ❌ Connection ended unexpectedly for ${activeAccount.email}. Likely rate limiting.`);
            // ✅ FIX: Don't mark as needs_reconnection for rate limiting - just skip this sync cycle
            console.log(`[SYNC] ⏭️  Skipping sync for ${activeAccount.email} this cycle due to rate limiting`);
            continue; // Skip this account
          }
          throw connectError; // Re-throw other errors
        }

        // Sync all folders
        const syncResults = await syncAccountFolders(connection, activeAccount);

        // Update account after successful sync
        const updateData = {
          sync_status: 'idle',
          last_successful_sync_at: new Date().toISOString(),
          sync_error_details: null,
          needs_reconnection: false, // ✅ FIX: Clear needs_reconnection flag on successful sync
          last_error: null, // Clear any previous errors
        };

        // CRITICAL: Mark initial sync as completed after first successful sync
        // Use conditional update to prevent race conditions (only update if still FALSE)
        if (isInitialSync) {
          updateData.initial_sync_completed = true;
          updateData.webhook_enabled_at = new Date().toISOString();
        }

        try {
          let updateQuery = supabaseAdmin
            .from('email_accounts')
            .update(updateData)
            .eq('id', activeAccount.id);

          // For initial sync, use conditional update to prevent race conditions
          if (isInitialSync) {
            updateQuery = updateQuery.eq('initial_sync_completed', false); // Only update if still FALSE (atomic check-and-set)
          }

          const { error: updateError } = await updateQuery;

          if (updateError) {
            console.error(`[SYNC] ❌ Error updating account sync status for account ${activeAccount.id}:`, updateError.message);
          } else {
            if (isInitialSync) {
              console.log(`[SYNC] ✅ Initial sync completed for account ${activeAccount.id} (${activeAccount.email})`);
              console.log(`[SYNC] ✅ Webhooks enabled - future emails will trigger webhooks`);
            }
          }
        } catch (updateError) {
          console.error(`[SYNC] ❌ Error updating account sync status:`, updateError.message);
          // Continue - don't fail the whole sync
        }

        // Release connection back to pool (don't close, allow reuse)
        connectionPool.releaseConnection(activeAccount.id, connection, false);

        const accountDuration = Date.now() - accountSyncStart;
        console.log(`[SYNC] Account ${activeAccount.email} sync completed in ${accountDuration}ms:`, syncResults);
      } catch (accountError) {
        console.error(`[SYNC] Error syncing account ${activeAccount.email || activeAccount.id}:`, accountError.message);
        
        // ✅ Handle "Connection ended unexpectedly" - check if it's a real auth failure
        if (accountError.message?.includes('Connection ended unexpectedly') || 
            accountError.message?.includes('ended unexpectedly')) {
          
          // ✅ FIX: Only mark as needs_reconnection if it's a real auth failure
          // Transient connection drops (rate limiting, network issues) shouldn't mark as needs_reconnection
          const isRealAuthError = accountError.message?.includes('Invalid credentials') ||
                                 accountError.message?.includes('AUTHENTICATIONFAILED') ||
                                 accountError.message?.includes('[AUTHENTICATIONFAILED]') ||
                                 accountError.code === 'EAUTH';
          
          if (isRealAuthError) {
            // Real auth failure - mark for reconnection
            console.error(`[SYNC] ❌ Authentication failed for ${activeAccount.email}. Marking as needs_reconnection.`);
            await supabaseAdmin
              .from('email_accounts')
              .update({
                needs_reconnection: true,
                sync_status: 'error',
                sync_error_details: 'Authentication failed. Please reconnect your account.',
                last_error: `Authentication failed: ${accountError.message}`,
                last_connection_attempt: new Date().toISOString(),
              })
              .eq('id', activeAccount.id);
          } else {
            // Transient error (rate limiting, network) - don't mark as needs_reconnection
            console.warn(`[SYNC] ⚠️  Connection ended unexpectedly for ${activeAccount.email}. Likely rate limiting or network issue. Will retry next cycle.`);
            await supabaseAdmin
              .from('email_accounts')
              .update({
                sync_status: 'throttled',
                sync_error_details: 'Connection ended unexpectedly - likely rate limiting. Will retry automatically.',
                last_sync_attempt_at: new Date().toISOString(),
              })
              .eq('id', activeAccount.id);
          }
          continue; // Skip to next account
        }
        
        // Handle throttling errors gracefully
        if (isThrottlingError(accountError)) {
          console.warn(`[SYNC] Account ${activeAccount.email || activeAccount.id} throttled, will retry on next sync cycle`);
          // Don't mark as error for throttling - it's temporary
          await supabaseAdmin
            .from('email_accounts')
            .update({
              sync_status: 'throttled',
              sync_error_details: 'Gmail rate limit exceeded. Will retry automatically.',
              last_sync_attempt_at: new Date().toISOString(),
            })
            .eq('id', activeAccount.id);
        } else {
          // Update account error status for non-throttling errors
        await supabaseAdmin
          .from('email_accounts')
          .update({
            sync_status: 'error',
            sync_error_details: accountError.message.substring(0, 500),
              last_sync_attempt_at: new Date().toISOString(),
          })
          .eq('id', activeAccount.id);
        }
        
        // Ensure connection is released even on error
        try {
          const connection = await connectionPool.connections.get(activeAccount.id);
          if (connection && connection.length > 0) {
            connectionPool.releaseConnection(activeAccount.id, connection[0], true);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }

    const totalDuration = Date.now() - syncStartTime;
    console.log(`[SYNC] Global sync completed in ${totalDuration}ms`);
  } catch (error) {
    console.error('[SYNC] Global sync error:', error);
  }
}

// ============================================
// LEGACY SUPPORT (Backward compatibility)
// ============================================

/**
 * Legacy function for backward compatibility
 * @deprecated Use syncAllImapAccounts instead
 */
async function syncEmailsForAccount(account) {
  try {
    const connection = await connectToImap(account);
    const result = await syncAccountFolders(connection, account);
    connection.end();
    return {
      success: true,
      savedCount: result.totalEmailsSaved,
      errorCount: result.totalErrors,
      totalMessages: result.totalEmailsFetched
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Legacy save function for backward compatibility
 */
async function saveEmailToSupabase(emailData, emailAccountId, provider) {
  try {
    // Convert legacy format to new format
    const parsedEmail = {
      uid: emailData.uid || parseInt(emailData.provider_message_id?.split('-').pop()) || 0,
      sender_email: emailData.sender_email || emailData.fromEmail || '',
      sender_name: emailData.sender_name || emailData.from || '',
      recipient_email: emailData.recipient_email || emailData.to || '',
      subject: emailData.subject || '(No subject)',
      body_text: emailData.body_text || emailData.body || '',
      body_html: emailData.body_html || '',
      received_at: emailData.received_at || emailData.date || new Date().toISOString(),
      folder_name: emailData.folder_name || 'INBOX',
      attachments_count: emailData.attachments_count || 0,
      attachments_meta: emailData.attachments_meta || '[]',
    };

    const result = await saveOrUpdateEmail(emailAccountId, parsedEmail, []);
    return result.action === 'inserted';
  } catch (error) {
    console.error('Error in saveEmailToSupabase:', error);
    return false;
  }
}

// ============================================
// PERIODIC CONNECTION CLEANUP
// ============================================

/**
 * Periodically cleanup stale connections
 */
function startConnectionCleanup() {
  setInterval(async () => {
    console.log('[CLEANUP] Running connection health check...');
    
    try {
      // Get all active accounts
      const { data: accounts } = await supabaseAdmin
        .from('email_accounts')
        .select('id, email')
        .eq('is_active', true);
      
      if (!accounts || accounts.length === 0) {
        return;
      }
      
      // Check each account's connections in the pool
      for (const account of accounts) {
        try {
          const stats = connectionPool.getStats();
          const accountStats = stats[account.id];
          
          if (accountStats && accountStats.activeConnections > 0) {
            // Get connections from pool and check health
            // Note: This is a simplified check - actual health check happens during sync
            console.log(`[CLEANUP] Account ${account.email} has ${accountStats.activeConnections} active connections`);
          }
        } catch (error) {
          console.error(`[CLEANUP] Error checking account ${account.id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('[CLEANUP] Error during connection cleanup:', error.message);
    }
  }, CONNECTION_HEALTH_CHECK_INTERVAL);
  
  console.log(`[CLEANUP] Connection cleanup task started (runs every ${CONNECTION_HEALTH_CHECK_INTERVAL / 1000 / 60} minutes)`);
}

// Start cleanup task on module load
startConnectionCleanup();

module.exports = {
  syncAllImapAccounts,
  syncAccountFolders,
  syncFolder,
  getSyncState,
  updateSyncState,
  logSyncActivity,
  connectToImap,
  flattenFolderStructure,
  parseEmailFromImap,
  saveOrUpdateEmail,
  isConnectionHealthy,
  ensureHealthyConnection,
  // Legacy exports
  syncEmailsForAccount,
  saveEmailToSupabase,
};
