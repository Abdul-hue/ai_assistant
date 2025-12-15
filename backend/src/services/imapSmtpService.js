const imaps = require('imap-simple');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const { supabaseAdmin } = require('../config/supabase');
const { decryptPassword } = require('../utils/encryption');
const { retryWithBackoff, isThrottlingError } = require('../utils/imapRetry');

// Note: decryptPassword is imported from ../utils/encryption.js (line 5)

// Note: encryptPassword is available from ../utils/encryption.js (used in routes)

/**
 * Auto-detect IMAP/SMTP settings for common providers
 */
function getProviderSettings(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  
  const providers = {
    'gmail.com': {
      imap: { host: 'imap.gmail.com', port: 993, ssl: true },
      smtp: { host: 'smtp.gmail.com', port: 587, tls: true },
      note: 'Gmail requires OAuth2 or App Password. Password login may not work.'
    },
    'outlook.com': {
      imap: { host: 'outlook.office365.com', port: 993, ssl: true },
      smtp: { host: 'smtp.office365.com', port: 587, tls: true },
      note: 'Outlook may require OAuth2 for Office365 accounts.'
    },
    'hotmail.com': {
      imap: { host: 'outlook.office365.com', port: 993, ssl: true },
      smtp: { host: 'smtp.office365.com', port: 587, tls: true },
      note: 'Hotmail uses Outlook servers.'
    },
    'live.com': {
      imap: { host: 'outlook.office365.com', port: 993, ssl: true },
      smtp: { host: 'smtp.office365.com', port: 587, tls: true },
      note: 'Live.com uses Outlook servers.'
    },
    'yahoo.com': {
      imap: { host: 'imap.mail.yahoo.com', port: 993, ssl: true },
      smtp: { host: 'smtp.mail.yahoo.com', port: 587, tls: true },
      note: 'Yahoo requires App Password if 2FA is enabled.'
    },
    'ymail.com': {
      imap: { host: 'imap.mail.yahoo.com', port: 993, ssl: true },
      smtp: { host: 'smtp.mail.yahoo.com', port: 587, tls: true },
      note: 'Yahoo requires App Password if 2FA is enabled.'
    },
    'icloud.com': {
      imap: { host: 'imap.mail.me.com', port: 993, ssl: true },
      smtp: { host: 'smtp.mail.me.com', port: 587, tls: true },
      note: 'iCloud requires App-Specific Password.'
    },
    'me.com': {
      imap: { host: 'imap.mail.me.com', port: 993, ssl: true },
      smtp: { host: 'smtp.mail.me.com', port: 587, tls: true },
      note: 'iCloud requires App-Specific Password.'
    }
  };
  
  return providers[domain] || null;
}

/**
 * Test IMAP connection
 */
async function testImapConnection(config) {
  const { validateImap } = require('../utils/connectToImap');
  let connection = null;
  try {
    // First validate the connection using the centralized validation
    await validateImap({
      email: config.username,
      password: config.password,
      host: config.host,
      port: config.port || 993,
      useSsl: config.useTls !== false
    });
    
    // Reconnect to get mailbox info for better feedback
    connection = await imaps.connect({
      imap: {
        user: config.username,
        password: config.password,
        host: config.host,
        port: config.port || 993,
        tls: config.useTls !== false,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
        connTimeout: 10000
      }
    });
    
    // Try to open INBOX - this verifies the connection works
    await connection.openBox('INBOX');
    
    // Try to get mailbox info if available
    let mailboxInfo = {
      name: 'INBOX',
      totalMessages: 0,
      unreadMessages: 0
    };
    
    try {
      // Check if connection.mailbox exists after openBox
      if (connection.mailbox) {
        mailboxInfo = {
          name: connection.mailbox.name || 'INBOX',
          totalMessages: connection.mailbox.messages?.total || 0,
          unreadMessages: connection.mailbox.messages?.new || 0
        };
      }
      
      // Also try to get folder list
      const boxes = await connection.getBoxes();
      mailboxInfo.totalFolders = Object.keys(boxes).length;
    } catch (mailboxError) {
      // If we can't read mailbox info, that's okay - connection still works
      console.log('Could not read mailbox info:', mailboxError.message);
    }
    
    const result = {
      success: true,
      message: 'IMAP connection successful',
      mailbox: mailboxInfo
    };
    
    connection.end();
    return result;
  } catch (error) {
    if (connection) {
      try {
        connection.end();
      } catch (endError) {
        // Ignore errors when closing connection
      }
    }
    
    // Provide more helpful error messages
    let errorMessage = error.message;
    if (error.message?.includes('ECONNREFUSED')) {
      errorMessage = 'Connection refused. Please check the IMAP host and port.';
    } else if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timeout')) {
      errorMessage = 'Connection timeout. Please check your network connection and IMAP settings.';
    } else if (error.message?.includes('authentication') || error.message?.includes('credentials') || error.message?.includes('LOGIN') || error.message?.includes('AUTHENTICATIONFAILED')) {
      errorMessage = 'Authentication failed. Please check your email and password.';
    } else if (error.message?.includes('Connection ended unexpectedly') || error.message?.includes('connection closed')) {
      errorMessage = 'Connection closed unexpectedly. This usually means invalid credentials or the server rejected the connection. Please verify your email and app password.';
    }
    
    console.error(`[TEST IMAP] ❌ Connection failed: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage,
      details: error.toString()
    };
  }
}

/**
 * Test SMTP connection
 */
async function testSmtpConnection(config) {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.useSsl === true && config.port === 465,
      auth: {
        user: config.username,
        pass: config.password
      },
      tls: {
        rejectUnauthorized: false // Allow self-signed certificates
      }
    });
    
    await transporter.verify();
    
    return {
      success: true,
      message: 'SMTP connection successful'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.toString()
    };
  }
}

/**
 * Fetch emails from IMAP
 * OPTIMIZED: Supports headersOnly mode and reduced default limit
 * @param {string} accountId - Account ID
 * @param {string} folder - Folder name (default: 'INBOX')
 * @param {number|object} limitOrOptions - Either limit number or options object
 * @param {object} options - Options object (if limitOrOptions is a number)
 */
async function fetchEmails(accountId, folder = 'INBOX', limitOrOptions = 10, options = {}) {
  // Handle both old API (limit) and new API (options object)
  let limit, headersOnly, forceRefresh;
  if (typeof limitOrOptions === 'object') {
    // New API: fetchEmails(accountId, folder, { limit: 10, headersOnly: true, forceRefresh: false })
    limit = limitOrOptions.limit || options.limit || 10;
    headersOnly = limitOrOptions.headersOnly !== undefined ? limitOrOptions.headersOnly : (options.headersOnly !== undefined ? options.headersOnly : true);
    forceRefresh = limitOrOptions.forceRefresh !== undefined ? limitOrOptions.forceRefresh : (options.forceRefresh !== undefined ? options.forceRefresh : false);
  } else {
    // Old API: fetchEmails(accountId, folder, 10)
    limit = limitOrOptions || 10; // ✅ REDUCED from 50 to 10
    headersOnly = options.headersOnly !== undefined ? options.headersOnly : true; // ✅ Default to headers only
    forceRefresh = options.forceRefresh !== undefined ? options.forceRefresh : false;
  }

  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
    if (!account.imap_host || !account.imap_username) {
      throw new Error('IMAP settings not configured for this account');
    }
    
    // Decrypt password
    const password = decryptPassword(account.imap_password);
    
    // Connect to IMAP with retry
    const connection = await retryWithBackoff(
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
    
    // Open mailbox with retry
    const box = await retryWithBackoff(
      async () => {
        try {
          return await connection.openBox(folder);
        } catch (error) {
          // Handle folder not found gracefully
          if (error.textCode === 'NONEXISTENT' || error.message?.includes('Unknown Mailbox')) {
            throw new Error(`Folder ${folder} does not exist`);
          }
          throw error;
        }
      },
      {
        maxRetries: 3,
        baseDelay: 2000,
        maxDelay: 30000,
        operationName: `Opening folder ${folder}`
      }
    );
    
    // ✅ CRITICAL: Determine sync mode (initial vs incremental vs force refresh)
    // Check per-folder sync state, not account-level (each folder syncs independently)
    const { data: folderSyncState } = await supabaseAdmin
      .from('email_sync_state')
      .select('initial_sync_completed')
      .eq('account_id', accountId)
      .eq('folder_name', folder)
      .maybeSingle();
    
    const isFolderInitialSync = !folderSyncState?.initial_sync_completed;
    const isAccountInitialSync = !account.initial_sync_completed;
    // Use folder-level check if available, otherwise fall back to account-level
    const isInitialSync = isFolderInitialSync || (folderSyncState === null && isAccountInitialSync);
    const totalMessages = box.messages?.total || 0;
    
    // ✅ If forceRefresh=true, treat as initial sync to fetch most recent emails
    const effectiveSyncMode = forceRefresh ? 'FORCE_REFRESH' : (isInitialSync ? 'INITIAL' : 'INCREMENTAL');
    
    console.log('[FETCH] ========================================');
    console.log('[FETCH] Account:', accountId);
    console.log('[FETCH] Folder:', folder);
    console.log('[FETCH] Mode:', effectiveSyncMode);
    console.log('[FETCH] Account initial sync completed:', account.initial_sync_completed);
    console.log('[FETCH] Folder initial sync completed:', folderSyncState?.initial_sync_completed || false);
    console.log('[FETCH] Force refresh:', forceRefresh);
    console.log('[FETCH] Total messages in mailbox:', totalMessages);
    console.log('[FETCH] ========================================');
    
    // ✅ OPTIMIZATION: Fetch strategy based on headersOnly mode
    // If headersOnly=true, only fetch headers/metadata (faster)
    // If headersOnly=false, fetch full email bodies (slower)
    const fetchOptions = headersOnly 
      ? {
          bodies: '', // Empty string means fetch headers only
          struct: false // Don't need structure for headers
        }
      : {
          bodies: '', // Full body
          struct: true // Need structure for attachments
        };
    
    let messages;
    
    // ✅ SMART INITIAL SYNC: Fetch only 20 most recent emails using sequence numbers
    if (isInitialSync) {
      console.log('[FETCH] 🎯 INITIAL SYNC - Fetching 20 most recent emails');
      
      if (totalMessages === 0) {
        console.log('[FETCH] 📭 Mailbox is empty, no emails to fetch');
        connection.end();
        return {
          success: true,
          emails: [],
          count: 0,
          mode: 'initial',
          savedCount: 0
        };
      }
      
      const fetchLimit = Math.min(20, totalMessages);
      console.log(`[FETCH] 📊 Will fetch ${fetchLimit} most recent emails from ${totalMessages} total`);
      
      // Calculate sequence range for last N emails
      // Example: If 5000 emails exist, fetch sequence 4981:5000 (last 20)
      const startSeq = Math.max(1, totalMessages - fetchLimit + 1);
      const endSeq = totalMessages;
      
      console.log(`[FETCH] 📬 Fetching sequence ${startSeq}:${endSeq} (last ${fetchLimit} emails)`);
      
      try {
        // Try to fetch using sequence number range
        // imap-simple search accepts sequence ranges like "1:20" or "4981:5000"
        messages = await retryWithBackoff(
          async () => {
            return await connection.search([`${startSeq}:${endSeq}`], fetchOptions);
          },
          {
            maxRetries: 5,
            baseDelay: 3000,
            maxDelay: 60000,
            operationName: `Fetching last ${fetchLimit} emails by sequence (${startSeq}:${endSeq})`
          }
        );
        
        console.log(`[FETCH] ✅ Retrieved ${messages.length} messages from IMAP using sequence range`);
        
        // Sort by UID descending to ensure newest first (sequence numbers may not guarantee order)
        messages.sort((a, b) => {
          const uidA = parseInt(a.attributes.uid) || 0;
          const uidB = parseInt(b.attributes.uid) || 0;
          return uidB - uidA; // Descending order (highest UID = newest)
        });
        
        console.log(`[FETCH] 🔄 Sorted ${messages.length} messages by UID (newest first)`);
        
      } catch (seqError) {
        // Fallback: If sequence range doesn't work, fetch all and filter
        console.warn('[FETCH] ⚠️  Sequence range search failed, falling back to UID-based fetch:', seqError.message);
        
        messages = await retryWithBackoff(
          async () => {
            return await connection.search(['ALL'], fetchOptions);
          },
          {
            maxRetries: 5,
            baseDelay: 3000,
            maxDelay: 60000,
            operationName: `Fetching all emails for initial sync (fallback)`
          }
        );
        
        // Sort by UID descending and take top 20
        messages.sort((a, b) => {
          const uidA = parseInt(a.attributes.uid) || 0;
          const uidB = parseInt(b.attributes.uid) || 0;
          return uidB - uidA;
        });
        
        messages = messages.slice(0, fetchLimit);
        console.log(`[FETCH] ✅ Selected ${messages.length} newest emails (fallback method)`);
      }
      
    } else {
      // ✅ INCREMENTAL SYNC: Fetch only new emails since last sync (unless forceRefresh)
      if (forceRefresh) {
        // ✅ FORCE REFRESH: Fetch most recent emails regardless of sync state
        console.log('[FETCH] 🔄 Force refresh - fetching most recent emails');
        
        // Fetch most recent emails by sequence number (most efficient)
        const totalCount = box.messages?.total || 0;
        if (totalCount > 0) {
          const startSeq = Math.max(1, totalCount - limit + 1);
          const endSeq = totalCount;
          
          console.log(`[FETCH] 📊 Fetching sequence ${startSeq}:${endSeq} (most recent ${limit} emails)`);
          
          messages = await retryWithBackoff(
            async () => {
              return await connection.search([`${startSeq}:${endSeq}`], fetchOptions);
            },
            {
              maxRetries: 5,
              baseDelay: 3000,
              maxDelay: 60000,
              operationName: `Fetching most recent emails from ${folder} (force refresh)`
            }
          );
          
          // Sort by UID descending (highest UID = newest)
          messages.sort((a, b) => {
            const uidA = parseInt(a.attributes.uid) || 0;
            const uidB = parseInt(b.attributes.uid) || 0;
            return uidB - uidA; // Descending
          });
          
          console.log(`[FETCH] ✅ Retrieved ${messages.length} most recent emails`);
        } else {
          messages = [];
          console.log('[FETCH] ⚠️  Mailbox is empty');
        }
      } else {
        // Normal incremental sync
        console.log('[FETCH] 📥 Incremental sync - fetching new emails since last sync');
        
        // Get last synced UID
        const { data: syncState } = await supabaseAdmin
          .from('email_sync_state')
          .select('last_uid_synced')
          .eq('account_id', accountId)
          .eq('folder_name', folder)
          .single();
        
        const lastUID = syncState?.last_uid_synced || 0;
        console.log(`[FETCH] 🔢 Last synced UID: ${lastUID}`);
        
        if (lastUID > 0) {
          // Fetch all messages, then filter client-side by UID
          // (imap-simple doesn't support UID range search directly)
          const allMessages = await retryWithBackoff(
            async () => {
              return await connection.search(['ALL'], fetchOptions);
            },
            {
              maxRetries: 5,
              baseDelay: 3000,
              maxDelay: 60000,
              operationName: `Fetching emails from ${folder} (incremental)`
            }
          );
          
          // Filter to only get new emails (UID > lastUID)
          messages = allMessages.filter(msg => {
            const uid = parseInt(msg.attributes.uid) || 0;
            return uid > lastUID;
          });
          
          console.log(`[FETCH] 📨 Found ${messages.length} new emails (out of ${allMessages.length} total)`);
        } else {
          // No previous sync state, fetch all (shouldn't happen, but handle gracefully)
          console.log('[FETCH] ⚠️  No previous sync state, fetching all messages');
          messages = await retryWithBackoff(
            async () => {
              return await connection.search(['ALL'], fetchOptions);
            },
            {
              maxRetries: 5,
              baseDelay: 3000,
              maxDelay: 60000,
              operationName: `Fetching emails from ${folder}`
            }
          );
        }
        
        // Limit incremental sync results
        messages = messages.slice(0, Math.min(limit, 100)); // Max 100 for performance
      }
    }
    
    const limitedMessages = messages;
    
    // Parse emails
    const emails = [];
    for (const message of limitedMessages) {
      try {
        const id = message.attributes.uid;
        const flags = message.attributes.flags || [];
        
        let parsed;
        if (headersOnly) {
          // ✅ Fast path: Extract from IMAP envelope/attributes directly (no parsing needed)
          const envelope = message.attributes.envelope;
          if (envelope) {
            parsed = {
              from: { value: envelope.from || [], text: envelope.from?.[0]?.address || '' },
              to: { value: envelope.to || [], text: envelope.to?.[0]?.address || '' },
              subject: envelope.subject || '',
              date: message.attributes.date || new Date()
            };
          } else {
            // Fallback: still need to parse if envelope not available
            const all = message.parts.find(part => part.which === '');
            const idHeader = 'Imap-Id: ' + id + '\r\n';
            parsed = await simpleParser(idHeader + all.body);
          }
        } else {
          // Full parsing for body content
          const all = message.parts.find(part => part.which === '');
          const idHeader = 'Imap-Id: ' + id + '\r\n';
          parsed = await simpleParser(idHeader + all.body);
        }
        
        // Get accurate date from email
        let emailDate = parsed.date || message.attributes.date;
        if (!emailDate || !(emailDate instanceof Date) || isNaN(emailDate.getTime())) {
          emailDate = new Date();
        }
        
        emails.push({
          id: `imap-${accountId}-${id}`,
          uid: id,
          from: parsed.from?.text || parsed.from?.value?.[0]?.address || 'Unknown',
          fromEmail: parsed.from?.value?.[0]?.address || parsed.from?.text || '',
          to: parsed.to?.text || parsed.to?.value?.[0]?.address || '',
          subject: parsed.subject || '(No subject)',
          body: headersOnly ? '' : (parsed.text || ''), // Only include body if not headersOnly
          bodyHtml: headersOnly ? '' : (parsed.html || ''), // Only include HTML if not headersOnly
          date: emailDate.toISOString(),
          timestamp: emailDate.getTime(),
          isRead: flags.includes('\\Seen') || false,
          attachments: headersOnly ? [] : (parsed.attachments?.map(att => ({
            filename: att.filename,
            contentType: att.contentType,
            size: att.size
          })) || []),
          folder: folder
        });
      } catch (parseError) {
        console.error('Error parsing email:', parseError);
        // Continue with next email
      }
    }
    
    // Sort emails by date (newest first) - using timestamp for accurate sorting
    emails.sort((a, b) => {
      const timeA = a.timestamp || new Date(a.date).getTime();
      const timeB = b.timestamp || new Date(b.date).getTime();
      return timeB - timeA; // Descending order (newest first)
    });
    
    // ✅ CRITICAL: Save emails to database (for initial sync)
    console.log(`[FETCH] Saving ${emails.length} emails to database...`);
    const savedEmails = [];
    
    // Import webhook function (only if not initial sync)
    let callEmailWebhook = null;
    if (!isInitialSync) {
      try {
        const webhookModule = require('../utils/emailWebhook');
        callEmailWebhook = webhookModule.callEmailWebhook;
      } catch (err) {
        console.warn('[FETCH] Could not load webhook module:', err.message);
      }
    }
    
    for (const email of emails) {
      try {
        const providerId = `${accountId}_${email.uid}_${folder}`;
        
        // ✅ Sanitize email content to prevent Unicode escape sequence errors
        const sanitizeText = (text) => {
          if (!text || typeof text !== 'string') return '';
          try {
            // Remove or replace problematic Unicode escape sequences
            // Replace null bytes and control characters
            return text
              .replace(/\0/g, '') // Remove null bytes
              .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters except \n, \r, \t
              .replace(/\\u0000/g, '') // Remove Unicode null escapes
              .trim();
          } catch (e) {
            console.warn(`[FETCH] Error sanitizing text:`, e.message);
            return ''; // Return empty string if sanitization fails
          }
        };
        
        // ✅ Sanitize attachments metadata to prevent JSONB errors
        const sanitizeAttachments = (attachments) => {
          if (!attachments || !Array.isArray(attachments)) return [];
          try {
            return attachments.map(att => ({
              filename: sanitizeText(att.filename || ''),
              contentType: sanitizeText(att.contentType || ''),
              size: typeof att.size === 'number' ? att.size : 0,
              cid: sanitizeText(att.cid || '')
            }));
          } catch (e) {
            console.warn(`[FETCH] Error sanitizing attachments:`, e.message);
            return [];
          }
        };
        
        // ✅ USE UPSERT with correct constraint (prevents duplicates from competing syncs)
        const { error: upsertError } = await supabaseAdmin
          .from('emails')
          .upsert({
            email_account_id: accountId,
            provider_message_id: providerId,
            uid: email.uid,
            sender_email: sanitizeText(email.fromEmail || email.from || ''),
            sender_name: sanitizeText(email.fromName || ''),
            recipient_email: sanitizeText(email.toEmail || email.to || ''),
            subject: sanitizeText(email.subject || '[No Subject]'),
            body_text: sanitizeText(email.body || ''),
            body_html: sanitizeText(email.bodyHtml || ''),
            received_at: email.date || new Date().toISOString(),
            folder_name: folder,
            is_read: email.isRead || false,
            is_starred: email.isStarred || false,
            is_deleted: false,
            attachments_count: email.attachments?.length || 0,
            attachments_meta: sanitizeAttachments(email.attachments || []),
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'email_account_id,provider_message_id', // ✅ Correct constraint
            ignoreDuplicates: false // Update if exists
          });
        
        // ✅ Only log real errors (not duplicate key errors)
        if (upsertError) {
          // Suppress duplicate key errors (code 23505) - they're expected when multiple syncs run
          if (upsertError.code !== '23505' && !upsertError.message?.includes('duplicate key')) {
            // Check for Unicode errors and provide better error message
            if (upsertError.message?.includes('Unicode') || upsertError.message?.includes('escape sequence')) {
              console.error(`[FETCH] ❌ Unicode error for UID ${email.uid}:`, upsertError.message);
              console.error(`[FETCH] ⚠️  Email subject: ${email.subject?.substring(0, 50)}`);
            } else {
              console.error(`[FETCH] ❌ Upsert error for UID ${email.uid}:`, upsertError.message);
            }
          }
          // Skip this email if there's a real error
          continue;
        }
        
        // Email saved successfully
        savedEmails.push(email);
        
        // ✅ Send webhook for new emails (only if not initial sync)
        if (!isInitialSync && callEmailWebhook && account.user_id) {
          try {
            const emailData = {
              uid: email.uid,
              subject: email.subject || '[No Subject]',
              sender_name: email.fromName || '',
              sender_email: email.fromEmail || email.from || '',
              recipient_email: email.toEmail || email.to || '',
              body_text: email.body || '',
              body_html: email.bodyHtml || '',
              received_at: email.date || new Date().toISOString(),
              folder_name: folder,
              is_read: email.isRead || false,
              is_starred: email.isStarred || false,
              attachments_count: email.attachments?.length || 0,
              attachments_meta: email.attachments || []
            };
            await callEmailWebhook(emailData, accountId, account.user_id);
          } catch (webhookError) {
            console.error(`[FETCH] Error calling webhook for email UID ${email.uid}:`, webhookError.message);
            // Don't fail the whole process if webhook fails
          }
        }
      } catch (err) {
        console.error(`[FETCH] Error saving email UID ${email.uid}:`, err.message);
      }
    }
    
    console.log(`[FETCH] 💾 Saved ${savedEmails.length}/${emails.length} emails to database`);
    
    // Update sync state
    if (savedEmails.length > 0) {
      const maxUID = Math.max(...savedEmails.map(e => e.uid));
      await supabaseAdmin
        .from('email_sync_state')
        .upsert({
          account_id: accountId,
          folder_name: folder,
          last_uid_synced: maxUID,
          total_server_count: emails.length,
          last_sync_at: new Date().toISOString(),
          sync_errors_count: 0,
          last_error_message: null,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'account_id,folder_name'
        });
      
      console.log(`[FETCH] 🔢 Updated sync state: last_uid_synced = ${maxUID}`);
    }
    
    // ✅ CRITICAL: Mark initial sync as completed and enable webhook
    if (isInitialSync && savedEmails.length > 0) {
      try {
        console.log('[FETCH] ✅ Marking initial sync as completed and enabling webhook...');
        const { error: updateError } = await supabaseAdmin
          .from('email_accounts')
          .update({ 
            initial_sync_completed: true,
            webhook_enabled_at: new Date().toISOString(), // ✅ Enable webhook
            last_successful_sync_at: new Date().toISOString()
          })
          .eq('id', accountId)
          .eq('initial_sync_completed', false); // Only update if still FALSE (atomic check)
        
        if (updateError) {
          console.error('[FETCH] ⚠️  Failed to mark initial sync as completed:', updateError.message);
          // Don't throw - emails were saved successfully
        } else {
          console.log('[FETCH] ✅ Initial sync completed successfully - account marked as synced, webhook enabled');
        }
      } catch (markError) {
        console.error('[FETCH] ❌ Error marking initial sync:', markError.message);
        // Don't throw - emails were saved successfully
      }
    } else if (isInitialSync && savedEmails.length === 0) {
      console.log('[FETCH] ⚠️  Initial sync completed but no emails saved - not marking as completed');
    }
    
    connection.end();
    
    const result = {
      success: true,
      emails: savedEmails.length > 0 ? savedEmails : emails, // Return saved emails if any, otherwise original
      count: savedEmails.length > 0 ? savedEmails.length : emails.length,
      mode: forceRefresh ? 'force_refresh' : (isInitialSync ? 'initial' : (headersOnly ? 'headers' : 'incremental')), // Indicate sync mode
      savedCount: savedEmails.length, // Indicate how many were saved
      isInitialSync: isInitialSync
    };
    
    console.log(`[FETCH] ✅ Fetch complete: ${result.count} emails, mode: ${result.mode}`);
    
    return result;
  } catch (error) {
    // ✅ Detect and mark authentication errors
    const isAuthError = error.message?.includes('Not authenticated') || 
                       error.message?.includes('AUTHENTICATIONFAILED') ||
                       error.message?.includes('Invalid credentials') ||
                       error.message?.includes('authentication') ||
                       error.message?.includes('credentials') ||
                       error.message?.includes('LOGIN');

    if (isAuthError) {
      console.error(`[FETCH] ❌ Authentication failed for account ${accountId}:`, error.message);
      
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
        
        console.log(`[FETCH] ✅ Marked account ${accountId} as needing reconnection`);
      } catch (updateErr) {
        console.error('[FETCH] Failed to update account status:', updateErr);
      }
      
      return {
        success: false,
        error: error.message,
        emails: [],
        isAuthError: true
      };
    }
    
    // Handle throttling errors gracefully
    if (isThrottlingError(error)) {
      console.error('Error fetching emails (throttled):', error.message);
      return {
        success: false,
        error: 'Gmail rate limit exceeded. Please try again in a few minutes.',
        emails: [],
        throttled: true
      };
    }
    
    // Handle folder not found
    if (error.message?.includes('does not exist')) {
      console.warn(`Folder ${folder} does not exist for account ${accountId}`);
      return {
        success: false,
        error: `Folder ${folder} does not exist`,
        emails: []
      };
    }
    
    console.error('Error fetching emails:', error);
    return {
      success: false,
      error: error.message,
      emails: []
    };
  }
}

/**
 * Send email via SMTP
 */
async function sendEmail(accountId, { to, subject, body, html, attachments = [] }) {
  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
    if (!account.smtp_host || !account.smtp_username) {
      throw new Error('SMTP settings not configured for this account');
    }
    
    // Decrypt password
    const password = decryptPassword(account.smtp_password);
    
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port || 587,
      secure: account.use_ssl === true && account.smtp_port === 465,
      auth: {
        user: account.smtp_username,
        pass: password
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    // Send email
    const info = await transporter.sendMail({
      from: account.email || account.smtp_username,
      to: to,
      subject: subject,
      text: body,
      html: html || body,
      attachments: attachments
    });
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response
    };
  } catch (error) {
    console.error('Error sending email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get folders from IMAP
 */
async function getFolders(accountId) {
  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
    if (!account.imap_host || !account.imap_username) {
      throw new Error('IMAP settings not configured for this account');
    }
    
    // ✅ FIX: Allow folder fetching even if account needs reconnection
    // Folders are read-only operations and don't cause rate limiting issues
    // Only warn, don't block
    if (account.needs_reconnection) {
      console.warn(`[FOLDERS] Account ${account.email} needs reconnection, but attempting to fetch folders anyway`);
    }
    
    // Decrypt password
    const password = decryptPassword(account.imap_password);
    
    // Connect to IMAP with retry
    const connection = await retryWithBackoff(
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
        operationName: `Connecting to IMAP for folders (${account.email})`
      }
    );
    
    // Get all mailboxes with retry
    const boxes = await retryWithBackoff(
      async () => {
        return await connection.getBoxes();
      },
      {
        maxRetries: 5,
        baseDelay: 3000,
        maxDelay: 60000,
        operationName: `Getting folders for ${account.email}`
      }
    );
    
    // Flatten folder structure and filter out non-selectable folders
    const folders = [];
    
    function flattenBoxes(boxes, prefix = '') {
      for (const [name, box] of Object.entries(boxes)) {
        const fullName = prefix ? `${prefix}${box.delimiter}${name}` : name;
        const attributes = box.attributes || [];
        
        // ✅ FIX: Add folder if it's selectable (not marked with \Noselect)
        // This includes both leaf folders AND folders with children (like [Gmail]/Sent Mail)
        const isSelectable = !attributes.includes('\\Noselect');
        
        if (isSelectable) {
          folders.push({
            name: fullName,
            delimiter: box.delimiter,
            attributes: attributes,
            children: Object.keys(box.children || {}).length
          });
        }
        
        // Always recursively process children to find nested folders
        if (box.children && Object.keys(box.children).length > 0) {
          flattenBoxes(box.children, fullName);
        }
      }
    }
    
    flattenBoxes(boxes);
    
    // Sort folders: INBOX first, then alphabetically
    folders.sort((a, b) => {
      if (a.name.toUpperCase() === 'INBOX') return -1;
      if (b.name.toUpperCase() === 'INBOX') return 1;
      return a.name.localeCompare(b.name);
    });
    
    connection.end();
    
    return {
      success: true,
      folders: folders
    };
  } catch (error) {
    // Handle throttling errors gracefully
    if (isThrottlingError(error)) {
      console.error('Error getting folders (throttled):', error.message);
      return {
        success: false,
        error: 'Gmail rate limit exceeded. Please try again in a few minutes.',
        folders: [],
        throttled: true
      };
    }
    
    console.error('Error getting folders:', error);
    return {
      success: false,
      error: error.message,
      folders: []
    };
  }
}

/**
 * Delete email via IMAP
 */
async function deleteEmail(accountId, uid, folder = 'INBOX') {
  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
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
    
    // Open mailbox
    await connection.openBox(folder);
    
    // Delete message
    await connection.deleteMessage(uid);
    
    // Expunge to permanently delete
    await connection.expunge();
    
    connection.end();
    
    return {
      success: true,
      message: 'Email deleted successfully'
    };
  } catch (error) {
    console.error('Error deleting email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Move email to folder
 */
async function moveEmail(accountId, uid, fromFolder, toFolder) {
  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
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
    
    // Open source mailbox
    await connection.openBox(fromFolder);
    
    // Move message
    await connection.move(uid, toFolder);
    
    connection.end();
    
    return {
      success: true,
      message: 'Email moved successfully'
    };
  } catch (error) {
    console.error('Error moving email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Initial sync: Fetch only the first 20 emails when folder is accessed for the first time
 * This should ONLY run once per folder when user first connects or first accesses a folder
 */
async function initialFolderSync(accountId, folderName = 'INBOX') {
  console.log(`[INITIAL SYNC] Starting for ${accountId}/${folderName}`);
  
  try {
    // Check if initial sync already completed for this folder
    const { data: syncState } = await supabaseAdmin
      .from('email_sync_state')
      .select('initial_sync_completed, last_uid_synced')
      .eq('account_id', accountId)
      .eq('folder_name', folderName)
      .maybeSingle();

    if (syncState?.initial_sync_completed) {
      console.log(`[INITIAL SYNC] ✅ Already completed for ${folderName}, skipping`);
      return { success: true, skipped: true, message: 'Initial sync already completed' };
    }

    // Fetch account details
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();

    if (accountError || !account) {
      throw new Error('Email account not found');
    }

    if (account.needs_reconnection) {
      console.log(`[INITIAL SYNC] ⏭️  Account needs reconnection, skipping initial sync`);
      return { success: false, error: 'Account needs reconnection' };
    }

    // Decrypt password
    const password = decryptPassword(account.imap_password);

    // Connect to IMAP with retry
    const connection = await retryWithBackoff(
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
        operationName: `[INITIAL SYNC] Connecting to IMAP for ${account.email}`
      }
    );

    // Open folder
    const box = await retryWithBackoff(
      async () => {
        return await connection.openBox(folderName);
      },
      {
        maxRetries: 3,
        baseDelay: 2000,
        maxDelay: 30000,
        operationName: `[INITIAL SYNC] Opening folder ${folderName}`
      }
    );

    const totalMessages = box.messages?.total || 0;

    if (totalMessages === 0) {
      console.log(`[INITIAL SYNC] No messages in ${folderName}`);
      await markInitialSyncComplete(accountId, folderName, 0);
      connection.end();
      return { success: true, count: 0 };
    }

    // Fetch ONLY the most recent 20 emails
    const limit = 20;
    const startSeq = Math.max(1, totalMessages - limit + 1);
    const endSeq = totalMessages;

    console.log(`[INITIAL SYNC] Fetching emails ${startSeq}:${endSeq} from ${folderName} (${limit} emails)`);

    const fetchOptions = {
      bodies: '',
      struct: true,
      markSeen: false
    };

    const messages = await retryWithBackoff(
      async () => {
        return await connection.search([`${startSeq}:${endSeq}`], fetchOptions);
      },
      {
        maxRetries: 5,
        baseDelay: 3000,
        maxDelay: 60000,
        operationName: `[INITIAL SYNC] Searching messages in ${folderName}`
      }
    );

    if (!messages || messages.length === 0) {
      console.log(`[INITIAL SYNC] No messages found in ${folderName}`);
      await markInitialSyncComplete(accountId, folderName, 0);
      connection.end();
      return { success: true, count: 0 };
    }

    // Parse and save emails
    const emails = [];
    let highestUid = 0;

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

        const providerId = `${accountId}_${uid}_${folderName}`;
        const isRead = flags.includes('\\Seen') || false;
        const isStarred = flags.includes('\\Flagged') || false;

        // Check if email already exists
        const { data: existing } = await supabaseAdmin
          .from('emails')
          .select('id')
          .eq('email_account_id', accountId)
          .eq('uid', uid)
          .eq('folder_name', folderName)
          .single();

        if (existing) {
          continue; // Skip duplicate
        }

        // Save email
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
            folder_name: folderName,
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
            onConflict: 'email_account_id,provider_message_id',
            ignoreDuplicates: false
          });

        if (upsertError && upsertError.code !== '23505') {
          console.error(`[INITIAL SYNC] Error saving email UID ${uid}:`, upsertError.message);
        } else {
          emails.push({ uid, subject: parsed.subject || '[No Subject]' });
          highestUid = Math.max(highestUid, uid);
        }
      } catch (parseError) {
        console.error(`[INITIAL SYNC] Error parsing email:`, parseError.message);
      }
    }

    // Mark initial sync as complete
    await markInitialSyncComplete(accountId, folderName, highestUid);

    connection.end();

    console.log(`[INITIAL SYNC] ✅ Completed for ${folderName}: saved ${emails.length} emails`);
    return { success: true, count: emails.length, highestUid };

  } catch (error) {
    console.error(`[INITIAL SYNC] ❌ Error for ${accountId}/${folderName}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Mark initial sync as complete for a folder
 */
async function markInitialSyncComplete(accountId, folderName, lastUid) {
  const { error } = await supabaseAdmin
    .from('email_sync_state')
    .upsert({
      account_id: accountId,
      folder_name: folderName,
      last_uid_synced: lastUid,
      initial_sync_completed: true,
      initial_sync_date: new Date().toISOString(),
      last_sync_at: new Date().toISOString(),
      total_server_count: 0, // Will be updated by background sync
      sync_errors_count: 0,
      last_error_message: null,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'account_id,folder_name'
    });

  if (error) {
    console.error('[INITIAL SYNC] Error marking complete:', error);
    throw error;
  }
}

module.exports = {
  getProviderSettings,
  testImapConnection,
  testSmtpConnection,
  fetchEmails,
  sendEmail,
  getFolders,
  deleteEmail,
  moveEmail,
  initialFolderSync,
  markInitialSyncComplete
};

