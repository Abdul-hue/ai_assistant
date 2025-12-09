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
    let from = mail.headers.get('from') || '';
    let to = mail.headers.get('to') || '';
    let subject = mail.headers.get('subject') || '[No Subject]';
    let date = mail.headers.get('date') || new Date().toISOString();

    // Parse sender name and email
    const fromMatch = from.match(/"?([^"<]*)"?\s*<([^>]+)>/);
    const senderName = fromMatch ? fromMatch[1].trim() : from.split('@')[0];
    const senderEmail = fromMatch ? fromMatch[2] : from;

    // Parse recipient
    const toMatch = to.match(/"?([^"<]*)"?\s*<([^>]+)>/);
    const recipientEmail = toMatch ? toMatch[2] : to.split(',')[0];

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
          ...emailData,
          is_read: isRead,
          is_starred: isStarred,
          is_deleted: false,
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

// ============================================
// SYNC SINGLE FOLDER (UID-Based)
// ============================================

/**
 * Sync single folder with UID-based incremental approach
 */
async function syncFolder(connection, accountId, folderName) {
  const startTime = Date.now();
  let emailsFetched = 0;
  let emailsSaved = 0;
  let emailsUpdated = 0;
  let errorsCount = 0;
  try {
    console.log(`[SYNC] Starting sync for folder: ${folderName}`);

    // Get sync state
    const syncState = await getSyncState(accountId, folderName);
    const lastSyncUid = syncState.last_uid_synced || 0;

    // Open the folder
    const box = await connection.openBox(folderName, false);
    console.log(`[SYNC] Opened folder ${folderName}, total messages: ${box.messages.total}`);

    // Build search range for only new messages
    let searchCriteria;
    if (lastSyncUid > 0) {
      // Incremental sync: fetch only new UIDs
      searchCriteria = ['UID', `${lastSyncUid + 1}:*`];
    } else {
      // First sync: fetch all
      searchCriteria = ['ALL'];
    }

    // Search for messages with fetch options - imap-simple combines search + fetch
    const fetchOptions = {
      bodies: '',
      struct: true,
      markSeen: false
    };

    const messages = await connection.search(searchCriteria, fetchOptions);

    if (messages.length === 0) {
      console.log(`[SYNC] No new messages in ${folderName}`);
      await updateSyncState(accountId, folderName, lastSyncUid, box.messages.total);
      return { emailsFetched: 0, emailsSaved: 0, emailsUpdated: 0, errorsCount: 0 };
    }

    console.log(`[SYNC] Found ${messages.length} new messages in ${folderName}`);

    // Process each message
    for (const msg of messages) {
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
            // Get account info for user_id
            const { data: account } = await supabaseAdmin
              .from('email_accounts')
              .select('user_id')
              .eq('id', accountId)
              .single();
            
            if (account?.user_id) {
              await callEmailWebhook(emailData, accountId, account.user_id);
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
        console.error(`Error processing message UID ${numericUid}:`, error.message);
        errorsCount++;
      }
    }

    // Update sync state with highest UID
    const highestUid = Math.max(...messages.map(msg => parseInt(msg.attributes.uid)));
    await updateSyncState(accountId, folderName, highestUid, box.messages.total);

    const duration = Date.now() - startTime;
    console.log(`[SYNC] Completed ${folderName}: Fetched: ${emailsFetched}, Saved: ${emailsSaved}, Updated: ${emailsUpdated}, Errors: ${errorsCount}, Duration: ${duration}ms`);
    return { emailsFetched, emailsSaved, emailsUpdated, errorsCount, duration };
  } catch (error) {
    console.error(`Error syncing folder ${folderName}:`, error);
    throw error;
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
    // Get all folders
    const boxes = await connection.getBoxes();
    const folders = flattenFolderStructure(boxes);
    console.log(`[SYNC] Account ${account.id} has ${folders.length} folders`);

    // Sync each folder
    for (const folder of folders) {
      // Skip system folders that can't be selected
      if (folder.attributes?.includes('\\Noselect')) {
        console.log(`[SYNC] Skipping non-selectable folder: ${folder.name}`);
        continue;
      }
      try {
        const folderResult = await syncFolder(connection, account.id, folder.name);

        results.foldersProcessed++;
        results.totalEmailsFetched += folderResult.emailsFetched;
        results.totalEmailsSaved += folderResult.emailsSaved;
        results.totalEmailsUpdated += folderResult.emailsUpdated;
        results.totalErrors += folderResult.errorsCount;
        results.folderResults[folder.name] = folderResult;

        // Log this folder's sync
        await logSyncActivity(account.id, folder.name, {
          syncType: 'incremental',
          emailsFetched: folderResult.emailsFetched,
          emailsSaved: folderResult.emailsSaved,
          emailsUpdated: folderResult.emailsUpdated,
          errorsCount: folderResult.errorsCount,
          durationMs: folderResult.duration,
        });
      } catch (folderError) {
        console.error(`Error syncing folder ${folder.name}:`, folderError.message);
        results.totalErrors++;
        await logSyncActivity(account.id, folder.name, {
          syncType: 'incremental',
          errorsCount: 1,
          errorDetails: folderError.message,
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Error syncing account folders:', error);
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

    // Get all active IMAP/SMTP accounts
    const { data: accounts, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('is_active', true)
      .or('provider_type.eq.imap_smtp,provider_type.is.null')
      .not('imap_host', 'is', null)
      .not('imap_username', 'is', null);

    if (error) throw error;

    if (!accounts || accounts.length === 0) {
      console.log('[SYNC] No active IMAP/SMTP accounts found');
      return;
    }

    console.log(`[SYNC] Found ${accounts.length} active accounts`);

    for (const account of accounts) {
      const accountSyncStart = Date.now();
      try {
        // Update account sync status
        await supabaseAdmin
          .from('email_accounts')
          .update({ sync_status: 'syncing' })
          .eq('id', account.id);

        // Connect to IMAP
        const connection = await connectToImap(account);

        // Sync all folders
        const syncResults = await syncAccountFolders(connection, account);

        // Update account after successful sync
        await supabaseAdmin
          .from('email_accounts')
          .update({
            sync_status: 'idle',
            last_successful_sync_at: new Date().toISOString(),
            sync_error_details: null,
          })
          .eq('id', account.id);

        // Close connection
        connection.end();

        const accountDuration = Date.now() - accountSyncStart;
        console.log(`[SYNC] Account ${account.email} sync completed in ${accountDuration}ms:`, syncResults);
      } catch (accountError) {
        console.error(`[SYNC] Error syncing account ${account.email}:`, accountError.message);
        // Update account error status
        await supabaseAdmin
          .from('email_accounts')
          .update({
            sync_status: 'error',
            sync_error_details: accountError.message.substring(0, 500),
          })
          .eq('id', account.id);
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
  // Legacy exports
  syncEmailsForAccount,
  saveEmailToSupabase,
};
