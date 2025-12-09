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

    console.log('finalImapUsername', finalImapUsername);
    console.log('finalImapHost', finalImapHost);
    console.log('finalImapPort', finalImapPort);
    console.log('finalUseSsl', finalUseSsl);
    console.log('finalUseTls', finalUseTls);
    console.log('imapPassword', imapPassword);
    console.log('smtpPassword', smtpPassword);
    console.log('finalSmtpUsername', finalSmtpUsername);
    console.log('finalSmtpHost', finalSmtpHost);
    console.log('finalSmtpPort', finalSmtpPort);
    console.log('finalUseTls', finalUseTls);
    // Test IMAP connection
    const imapTest = await testImapConnection({
      username: finalImapUsername,
      password: imapPassword,
      host: finalImapHost,
      port: finalImapPort,
      useTls: finalUseSsl
    });
    console.log('imapTest', imapTest);

    if (!imapTest.success) {
      return res.status(400).json({
        error: 'IMAP connection failed',
        details: imapTest.error,
        suggestion: detectedSettings?.note || 'Please check your IMAP settings'
      });
    }

    // Test SMTP connection
    const smtpTest = await testSmtpConnection({
      username: finalSmtpUsername,
      password: smtpPassword,
      host: finalSmtpHost,
      port: finalSmtpPort,
      useSsl: finalUseTls && finalSmtpPort === 465,
      useTls: finalUseTls
    });

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

    // Check if account already exists
    const { data: existingAccount } = await supabaseAdmin
      .from('email_accounts')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('email', email)
      .eq('provider', provider || 'custom')
      .single();

    let emailAccount;
    let dbError;

    if (existingAccount) {
      // Update existing account
      const { data, error } = await supabaseAdmin
        .from('email_accounts')
        .update({
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
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingAccount.id)
        .select()
        .single();
      
      emailAccount = data;
      dbError = error;
    } else {
      // Insert new account
      const { data, error } = await supabaseAdmin
        .from('email_accounts')
        .insert({
          user_id: req.user.id,
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
    }

    if (dbError) {
      console.error('Database error saving IMAP/SMTP account:', dbError);
      return res.status(500).json({
        error: 'Failed to save account',
        details: dbError.message
      });
    }

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
    const { data: accounts, error } = await supabaseAdmin
      .from('email_accounts')
      .select('id, email, provider, imap_host, smtp_host, auth_method, is_active, created_at')
      .eq('user_id', req.user.id)
      .eq('auth_method', 'password')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch accounts', details: error.message });
    }

    res.json({
      success: true,
      accounts: accounts || []
    });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts', message: error.message });
  }
});

/**
 * GET /api/imap-smtp/emails/:accountId
 * Fetch emails from IMAP account
 */
router.get('/emails/:accountId', authMiddleware, async (req, res) => {
  // console.log('/api/imap-smtp/emails/:accountId====================',);
  try {
    const { accountId } = req.params;
    const { folder = 'INBOX', limit = 50 } = req.query;


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
    const result = await fetchEmails(accountId, folder, parseInt(limit));

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
      count: result.count
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
 * Disconnect email account
 */
router.delete('/accounts/:accountId', authMiddleware, async (req, res) => {
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

    // Deactivate account
    const { error: updateError } = await supabaseAdmin
      .from('email_accounts')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', accountId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to disconnect account', details: updateError.message });
    }

    res.json({
      success: true,
      message: 'Email account disconnected successfully'
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

module.exports = router;

