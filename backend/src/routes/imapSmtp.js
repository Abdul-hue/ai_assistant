const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { encryptPassword } = require('../utils/encryption');
const {
  getProviderSettings,
  testImapConnection,
  testSmtpConnection,
  fetchEmails,
  sendEmail,
  getFolders,
  deleteEmail,
  moveEmail
} = require('../services/imapSmtpService');

const router = express.Router();

/**
 * POST /api/imap-smtp/connect
 * Connect and save IMAP/SMTP account
 * OPTIMIZED: Skips connection testing for existing accounts
 */
router.post('/connect', authMiddleware, async (req, res) => {
  try {
    const {
      email,
      provider = 'custom',
      imapHost,
      imapPort,
      smtpHost,
      smtpPort,
      imapUsername,
      imapPassword,
      smtpUsername,
      smtpPassword,
      useSsl = true,
      useTls = true,
      autoDetect = true
    } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const userId = req.user.id;

    // ✅ FIX: Check if account already exists (active OR inactive)
    // If inactive account exists, delete it first to avoid unique constraint violation
    const { data: existingAccount } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('email', email)
      .eq('provider', provider || 'custom')
      .maybeSingle(); // Use maybeSingle to handle both active and inactive accounts

    if (existingAccount) {
      if (existingAccount.is_active) {
        console.log(`[CONNECT] Account ${email} already exists and is active, skipping connection tests`);
      
      // Return existing account immediately without testing connections
      return res.json({
        success: true,
        message: 'Account already connected',
        account: {
          id: existingAccount.id,
          email: existingAccount.email,
          provider: existingAccount.provider
        },
        skipSync: true // Tell frontend to use emails-quick endpoint
      });
      } else {
        // ✅ FIX: Account exists but is inactive - delete it to allow reconnection
        console.log(`[CONNECT] Found inactive account ${email}, deleting to allow reconnection...`);
        
        // Stop IDLE monitoring if running
        try {
          const appModule = require('../../app');
          const idleManager = appModule.idleManager || appModule.default?.idleManager;
          if (idleManager) {
            await idleManager.stopIdleMonitoring(existingAccount.id);
            console.log(`[CONNECT] Stopped IDLE monitoring for ${existingAccount.id}`);
          }
        } catch (idleError) {
          console.warn(`[CONNECT] Error stopping IDLE monitoring:`, idleError.message);
        }
        
        // Delete the inactive account (cascade will delete related emails and sync state)
        const { error: deleteError } = await supabaseAdmin
          .from('email_accounts')
          .delete()
          .eq('id', existingAccount.id);
        
        if (deleteError) {
          console.error(`[CONNECT] Error deleting inactive account:`, deleteError);
          return res.status(500).json({
            error: 'Failed to remove previous account',
            details: deleteError.message
          });
        }
        
        console.log(`[CONNECT] ✅ Deleted inactive account ${existingAccount.id}, proceeding with new connection`);
      }
    }

    // Auto-detect provider settings if requested
    let detectedSettings = null;
    if (autoDetect) {
      detectedSettings = getProviderSettings(email);
    }

    // Use detected settings or provided settings
    const finalImapHost = imapHost || detectedSettings?.imap?.host;
    const finalImapPort = imapPort || detectedSettings?.imap?.port || 993;
    const finalSmtpHost = smtpHost || detectedSettings?.smtp?.host;
    const finalSmtpPort = smtpPort || detectedSettings?.smtp?.port || 587;
    const finalUseSsl = useSsl !== undefined ? useSsl : (detectedSettings?.imap?.ssl !== false);
    const finalUseTls = useTls !== undefined ? useTls : (detectedSettings?.smtp?.tls !== false);

    if (!finalImapHost || !finalSmtpHost) {
      return res.status(400).json({
        error: 'IMAP and SMTP hosts are required',
        suggestion: detectedSettings ? `Detected settings for ${email.split('@')[1]}: ${JSON.stringify(detectedSettings, null, 2)}` : null
      });
    }

    // Use email as username if not provided
    const finalImapUsername = imapUsername || email;
    const finalSmtpUsername = smtpUsername || email;

    if (!imapPassword || !smtpPassword) {
      return res.status(400).json({ error: 'IMAP and SMTP passwords are required' });
    }

    console.log(`[CONNECT] New account ${email}, testing connections in parallel...`);

    // ✅ OPTIMIZATION: Run IMAP and SMTP tests in PARALLEL (not sequential)
    const [imapTestResult, smtpTestResult] = await Promise.allSettled([
      testImapConnection({
        username: finalImapUsername,
        password: imapPassword,
        host: finalImapHost,
        port: finalImapPort,
        useTls: finalUseSsl
      }),
      testSmtpConnection({
        username: finalSmtpUsername,
        password: smtpPassword,
        host: finalSmtpHost,
        port: finalSmtpPort,
        useSsl: finalUseTls && finalSmtpPort === 465,
        useTls: finalUseTls
      })
    ]);

    // Check IMAP test result
    const imapTest = imapTestResult.status === 'fulfilled' 
      ? imapTestResult.value 
      : { success: false, error: imapTestResult.reason?.message || 'IMAP test failed' };

    if (!imapTest.success) {
      return res.status(400).json({
        error: 'IMAP connection failed',
        details: imapTest.error,
        suggestion: detectedSettings?.note || 'Please check your IMAP settings'
      });
    }

    // Check SMTP test result
    const smtpTest = smtpTestResult.status === 'fulfilled'
      ? smtpTestResult.value
      : { success: false, error: smtpTestResult.reason?.message || 'SMTP test failed' };

    if (!smtpTest.success) {
      return res.status(400).json({
        error: 'SMTP connection failed',
        details: smtpTest.error,
        suggestion: detectedSettings?.note || 'Please check your SMTP settings'
      });
    }

    // Encrypt passwords
    const encryptedImapPassword = encryptPassword(imapPassword);
    const encryptedSmtpPassword = encryptPassword(smtpPassword);

    // Insert new account (we already checked it doesn't exist above)
    let emailAccount;
    let dbError;

    // Insert new account (we already checked it doesn't exist above)
    const { data, error } = await supabaseAdmin
      .from('email_accounts')
      .insert({
        user_id: userId,
        provider: provider || 'custom',
        email: email,
        imap_host: finalImapHost,
        imap_port: finalImapPort,
        smtp_host: finalSmtpHost,
        smtp_port: finalSmtpPort,
        imap_username: finalImapUsername,
        imap_password: encryptedImapPassword,
        smtp_username: finalSmtpUsername,
        smtp_password: encryptedSmtpPassword,
        use_ssl: finalUseSsl,
        use_tls: finalUseTls,
        auth_method: 'password',
        is_active: true
      })
      .select()
      .single();
    
    emailAccount = data;
    dbError = error;

    if (dbError) {
      console.error('Database error saving IMAP/SMTP account:', dbError);
      return res.status(500).json({
        error: 'Failed to save account',
        details: dbError.message
      });
    }

    // ✅ Start IDLE monitoring for newly connected account
    setTimeout(async () => {
      try {
        // Import idleManager from main server file (lazy load to avoid circular dependency)
        const appModule = require('../../app');
        const idleManager = appModule.idleManager || appModule.default?.idleManager;
        
        if (idleManager && emailAccount) {
          // Fetch full account data for IDLE
          const { data: fullAccount } = await supabaseAdmin
            .from('email_accounts')
            .select('*')
            .eq('id', emailAccount.id)
            .single();
          
          if (fullAccount && !fullAccount.needs_reconnection) {
            await idleManager.startIdleMonitoring(fullAccount);
            console.log(`✅ IDLE auto-started for newly connected account: ${emailAccount.email}`);
          }
        }
      } catch (idleError) {
        console.error(`❌ Failed to auto-start IDLE for ${emailAccount.email}:`, idleError.message);
        // Don't fail the connection if IDLE start fails
      }
    }, 2000); // 2 second delay to ensure connection is stable

    res.json({
      success: true,
      message: 'Email account connected successfully',
      account: {
        id: emailAccount.id,
        email: emailAccount.email,
        provider: emailAccount.provider,
        imapTest: imapTest,
        smtpTest: smtpTest
      }
    });

    // ✅ NEW: Trigger comprehensive sync in background
    setTimeout(async () => {
      try {
        console.log(`[CONNECT] ⚡ Starting comprehensive sync for ${emailAccount.email}`);
        const { comprehensiveFolderSync } = require('../services/comprehensiveEmailSync');
        const io = req.app.get('io');
        
        await comprehensiveFolderSync(emailAccount.id, req.user.id, io);
        
        console.log(`[CONNECT] ✅ Comprehensive sync completed for ${emailAccount.email}`);
      } catch (error) {
        console.error(`[CONNECT] ❌ Comprehensive sync failed:`, error.message);
      }
    }, 3000); // 3 second delay for IDLE to start first
  } catch (error) {
    console.error('Error connecting IMAP/SMTP account:', error);
    res.status(500).json({
      error: 'Failed to connect account',
      message: error.message
    });
  }
});

/**
 * GET /api/imap-smtp/accounts
 * Get all IMAP/SMTP accounts for user
 */
router.get('/accounts', authMiddleware, async (req, res) => {
  try {
    // ✅ Validate user is authenticated
    if (!req.user || !req.user.id) {
      console.error('[ACCOUNTS] User not authenticated');
      return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    // ✅ Try to select all columns, but handle case where new columns don't exist yet
    let accounts, error;
    
    try {
      // First try with all columns (if migration was run)
      const result = await supabaseAdmin
        .from('email_accounts')
        .select('id, email, provider, imap_host, smtp_host, auth_method, is_active, created_at, needs_reconnection, last_error, last_connection_attempt')
        .eq('user_id', req.user.id)
        .eq('auth_method', 'password')
        .order('created_at', { ascending: false });
      
      accounts = result.data;
      error = result.error;
    } catch (selectError) {
      // If that fails, try without the new columns (fallback for pre-migration state)
      console.warn('[ACCOUNTS] New columns not found, using fallback query:', selectError.message);
      const result = await supabaseAdmin
        .from('email_accounts')
        .select('id, email, provider, imap_host, smtp_host, auth_method, is_active, created_at')
        .eq('user_id', req.user.id)
        .eq('auth_method', 'password')
        .order('created_at', { ascending: false });
      
      accounts = result.data;
      error = result.error;
      
      // Add default values for missing columns
      if (accounts) {
        accounts = accounts.map(acc => ({
          ...acc,
          needs_reconnection: false,
          last_error: null,
          last_connection_attempt: null
        }));
      }
    }

    if (error) {
      console.error('[ACCOUNTS] Database error:', error);
      return res.status(500).json({ error: 'Failed to fetch accounts', details: error.message });
    }

    res.json({
      success: true,
      accounts: accounts || []
    });
  } catch (error) {
    console.error('[ACCOUNTS] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to fetch accounts', message: error.message });
  }
});

/**
 * GET /api/imap-smtp/emails-quick/:accountId
 * ⚡ LOAD FROM DATABASE ONLY - NO SYNC TRIGGERS
 * ✅ UPDATED: Removed initial sync trigger - comprehensive sync handles everything
 */
router.get('/emails-quick/:accountId', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  try {
    const { accountId } = req.params;
    const { folder = 'INBOX', limit = 50 } = req.query;

    // Verify account
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id, needs_reconnection, comprehensive_sync_completed, comprehensive_sync_status')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ 
        success: false,
        error: 'Email account not found' 
      });
    }

    // Load from database ONLY (NO SYNC)
    const { data: emails, error: dbError } = await supabaseAdmin
      .from('emails')
      .select(`
        id, uid, sender_email, sender_name, recipient_email, 
        subject, body_text, body_html, received_at, 
        is_read, is_starred, folder_name, attachments_count, attachments_meta
      `)
      .eq('email_account_id', accountId)
      .eq('folder_name', folder)
      .order('received_at', { ascending: false, nullsFirst: false })
      .limit(parseInt(limit) || 50);

    if (dbError) throw dbError;

    // Format emails
    const formattedEmails = (emails || []).map(email => ({
      id: email.id,
      uid: email.uid,
      from: email.sender_email || 'Unknown',
      fromEmail: email.sender_email || '',
      fromName: email.sender_name || '',
      to: email.recipient_email || '',
      toEmail: email.recipient_email || '',
      subject: email.subject || '(No subject)',
      body: email.body_text || '',
      bodyHtml: email.body_html || '',
      date: email.received_at || new Date().toISOString(),
      timestamp: new Date(email.received_at || new Date()).getTime(),
      isRead: email.is_read || false,
      isStarred: email.is_starred || false,
      attachments: email.attachments_meta || [],
      folder: email.folder_name || folder,
      accountId: accountId
    }));

    const dbLoadTime = Date.now() - startTime;
    console.log(`[QUICK FETCH] ✅ Loaded ${formattedEmails.length} emails from DB in ${dbLoadTime}ms`);

    res.json({
      success: true,
      emails: formattedEmails,
      count: formattedEmails.length,
      source: 'database',
      loadTime: dbLoadTime,
      comprehensiveSyncCompleted: account.comprehensive_sync_completed || false,
      comprehensiveSyncStatus: account.comprehensive_sync_status || 'pending'
    });

    // ❌ REMOVED: No initial sync trigger
    // ❌ REMOVED: No background sync trigger
    // Comprehensive sync handles initial load
    // Background sync (scheduled) handles updates

  } catch (error) {
    console.error('[QUICK FETCH] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/imap-smtp/comprehensive-sync-status/:accountId
 * Get comprehensive sync status and progress
 */
router.get('/comprehensive-sync-status/:accountId', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;

    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select(`
        comprehensive_sync_completed,
        comprehensive_sync_status,
        comprehensive_sync_progress,
        comprehensive_sync_started_at,
        comprehensive_sync_completed_at
      `)
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (error || !account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json({
      success: true,
      syncCompleted: account.comprehensive_sync_completed || false,
      syncStatus: account.comprehensive_sync_status || 'pending',
      syncProgress: account.comprehensive_sync_progress || {},
      syncStartedAt: account.comprehensive_sync_started_at,
      syncCompletedAt: account.comprehensive_sync_completed_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/imap-smtp/emails/:accountId
 * Fetch emails from IMAP account
 * ⚠️ DEPRECATED: Use /emails-quick for better performance
 * This endpoint should only be used for manual refresh, not on every folder click
 * 
 * Query params:
 * - folder: Folder name (default: INBOX)
 * - limit: Number of emails to fetch (default: 20)
 * - headersOnly: Fetch headers only (default: false for full emails)
 * - forceRefresh: If true, fetch most recent emails regardless of sync state (default: false)
 */
router.get('/emails/:accountId', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { folder = 'INBOX', limit = 20, forceRefresh = 'false' } = req.query;

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }
    
    // ✅ OPTIMIZATION: Use headers-only mode by default for faster loading
    // But allow full fetch for initial sync (when headersOnly=false)
    const headersOnly = req.query.headersOnly !== undefined 
      ? req.query.headersOnly !== 'false' && req.query.headersOnly !== '0'
      : true; // Default to true (headers only) unless explicitly false
    
    // ✅ NEW: If forceRefresh=true, fetch most recent emails regardless of sync state
    const shouldForceRefresh = forceRefresh === 'true' || forceRefresh === '1';
    
    console.log(`[FETCH] Fetching emails with headersOnly=${headersOnly}, limit=${limit}, forceRefresh=${shouldForceRefresh}`);
    
    const result = await fetchEmails(accountId, folder, {
      limit: parseInt(limit) || 10,
      headersOnly: headersOnly,
      forceRefresh: shouldForceRefresh // Pass force refresh flag
    });

    if (!result.success) {
      // Check if it's an authentication error
      const isAuthError = result.error?.includes('credentials') || 
                         result.error?.includes('authentication') ||
                         result.error?.includes('AUTHENTICATIONFAILED') ||
                         result.error?.includes('Invalid credentials');
      
      const statusCode = isAuthError ? 401 : 500;
      return res.status(statusCode).json({ 
        error: result.error, 
        emails: [],
        isAuthError: isAuthError
      });
    }

    res.json({
      success: true,
      emails: result.emails,
      count: result.count || result.savedCount || 0,
      savedCount: result.savedCount || 0,
      mode: result.mode || 'incremental'
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).json({ error: 'Failed to fetch emails', message: error.message });
  }
});

/**
 * POST /api/imap-smtp/send
 * Send email via SMTP
 */
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { accountId, to, subject, body, html, attachments } = req.body;

    if (!accountId || !to || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields: accountId, to, subject, body' });
    }

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const result = await sendEmail(accountId, { to, subject, body, html, attachments });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Broadcast via WebSocket if available
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_sent', {
        accountId,
        to,
        subject,
        messageId: result.messageId
      });
    }

    res.json({
      success: true,
      messageId: result.messageId,
      response: result.response
    });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email', message: error.message });
  }
});

/**
 * GET /api/imap-smtp/folders/:accountId
 * Get folders from IMAP account
 */
router.get('/folders/:accountId', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;
    console.log('folders====================',);

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }
    console.log('accountwellcome');
    const result = await getFolders(accountId);
    console.log('accountwellcome');

    if (!result.success) {
      // Check if it's an authentication error
      const isAuthError = result.error?.includes('credentials') || 
                         result.error?.includes('authentication') ||
                         result.error?.includes('AUTHENTICATIONFAILED') ||
                         result.error?.includes('Invalid credentials');
      
      const statusCode = isAuthError ? 401 : 500;
      return res.status(statusCode).json({ 
        error: result.error, 
        folders: [],
        isAuthError: isAuthError
      });
    }

    res.json({
      success: true,
      folders: result.folders
    });
  } catch (error) {
    console.error('Error getting folders:', error);
    res.status(500).json({ error: 'Failed to get folders', message: error.message });
  }
});

/**
 * DELETE /api/imap-smtp/emails/:accountId/:uid
 * Delete email via IMAP
 */
router.delete('/emails/:accountId/:uid', authMiddleware, async (req, res) => {
  try {
    const { accountId, uid } = req.params;
    const { folder = 'INBOX' } = req.query;

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const result = await deleteEmail(accountId, parseInt(uid), folder);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Broadcast via WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_deleted', { accountId, uid });
    }

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Error deleting email:', error);
    res.status(500).json({ error: 'Failed to delete email', message: error.message });
  }
});

/**
 * POST /api/imap-smtp/emails/:accountId/:uid/move
 * Move email to different folder
 */
router.post('/emails/:accountId/:uid/move', authMiddleware, async (req, res) => {
  try {
    const { accountId, uid } = req.params;
    const { fromFolder = 'INBOX', toFolder } = req.body;

    if (!toFolder) {
      return res.status(400).json({ error: 'toFolder is required' });
    }

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const result = await moveEmail(accountId, parseInt(uid), fromFolder, toFolder);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Broadcast via WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_moved', { accountId, uid, fromFolder, toFolder });
    }

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Error moving email:', error);
    res.status(500).json({ error: 'Failed to move email', message: error.message });
  }
});

/**
 * GET /api/imap-smtp/detect/:email
 * Auto-detect provider settings for email
 */
router.get('/detect/:email', authMiddleware, (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const settings = getProviderSettings(email);

    if (!settings) {
      return res.json({
        success: false,
        message: 'No auto-detection available for this email provider',
        suggestion: 'Please provide IMAP/SMTP settings manually'
      });
    }

    res.json({
      success: true,
      settings: settings,
      email: email
    });
  } catch (error) {
    console.error('Error detecting provider:', error);
    res.status(500).json({ error: 'Failed to detect provider', message: error.message });
  }
});

/**
 * DELETE /api/imap-smtp/accounts/:accountId
 * Disconnect email account - DELETES the account from database
 * ✅ FIX: Now actually deletes the account instead of just deactivating it
 * This prevents duplicate key constraint errors when reconnecting
 */
router.delete('/accounts/:accountId', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id, email')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    // ✅ FIX: Stop IDLE monitoring before deleting
    try {
      const appModule = require('../../app');
      const idleManager = appModule.idleManager || appModule.default?.idleManager;
      if (idleManager) {
        await idleManager.stopIdleMonitoring(accountId);
        console.log(`[DISCONNECT] Stopped IDLE monitoring for account ${account.email}`);
      }
    } catch (idleError) {
      console.warn(`[DISCONNECT] Error stopping IDLE monitoring:`, idleError.message);
      // Continue with deletion even if IDLE stop fails
    }

    // ✅ FIX: DELETE the account instead of just deactivating it
    // This prevents duplicate key constraint errors when user tries to reconnect
    // Cascade delete will automatically remove:
    // - Related emails (via email_account_id foreign key)
    // - Email sync state (via account_id foreign key)
    // - Other related data
    const { error: deleteError } = await supabaseAdmin
      .from('email_accounts')
      .delete()
      .eq('id', accountId);

    if (deleteError) {
      console.error(`[DISCONNECT] Error deleting account ${accountId}:`, deleteError);
      return res.status(500).json({ 
        error: 'Failed to disconnect account', 
        details: deleteError.message 
      });
    }

    console.log(`[DISCONNECT] ✅ Account ${account.email} (${accountId}) deleted successfully`);

    res.json({
      success: true,
      message: 'Email account disconnected and removed successfully'
    });
  } catch (error) {
    console.error('Error disconnecting account:', error);
    res.status(500).json({ error: 'Failed to disconnect account', message: error.message });
  }
});

/**
 * GET /api/imap-smtp/sync-status/:accountId
 * Get sync status for all folders of an account
 */
router.get('/sync-status/:accountId', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const { data, error } = await supabaseAdmin
      .from('email_sync_state')
      .select('*')
      .eq('account_id', accountId)
      .order('folder_name');

    if (error) throw error;

    res.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/imap-smtp/sync-logs/:accountId
 * Get sync logs for debugging
 */
router.get('/sync-logs/:accountId', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { limit = 50 } = req.query;

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const { data, error } = await supabaseAdmin
      .from('email_sync_logs')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    res.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/imap-smtp/debug/:accountId
 * Debug endpoint to check database state
 */
router.get('/debug/:accountId', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;

    // Check account exists
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.json({
        success: false,
        error: 'Account not found',
        accountId
      });
    }

    // Check emails in database
    const { data: emails, error: emailError, count } = await supabaseAdmin
      .from('emails')
      .select('*', { count: 'exact', head: false })
      .eq('email_account_id', accountId)
      .limit(5);

    // Get total count
    const { count: totalCount } = await supabaseAdmin
      .from('emails')
      .select('*', { count: 'exact', head: true })
      .eq('email_account_id', accountId);

    // Check sync state
    const { data: syncState } = await supabaseAdmin
      .from('email_sync_state')
      .select('*')
      .eq('account_id', accountId);

    res.json({
      success: true,
      account: {
        id: account.id,
        email: account.email,
        provider: account.provider,
        is_active: account.is_active,
        initial_sync_completed: account.initial_sync_completed,
        needs_reconnection: account.needs_reconnection || false,
        last_error: account.last_error || null,
        last_connection_attempt: account.last_connection_attempt || null
      },
      database: {
        totalEmails: totalCount || 0,
        sampleEmails: emails || [],
        emailsTableError: emailError?.message || null
      },
      syncState: syncState || [],
      diagnosis: totalCount === 0 
        ? '⚠️ No emails in database. Run initial sync or trigger background sync.'
        : `✅ Database has ${totalCount} emails`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

