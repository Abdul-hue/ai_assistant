const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { google } = require('googleapis');

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 
  (process.env.NODE_ENV === 'production' 
    ? `${process.env.BACKEND_URL || 'https://your-backend-url.com'}/api/gmail/callback`
    : 'http://localhost:3001/api/gmail/callback');

// Import extended scopes
const { EXTENDED_GMAIL_SCOPES } = require('../services/gmailExtendedFeatures');

const GMAIL_SCOPES = EXTENDED_GMAIL_SCOPES;

/**
 * GET /api/gmail/auth
 * Initiate Gmail OAuth flow
 */
router.get('/auth', authMiddleware, (req, res) => {
  try {
    // Validate required environment variables
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('GOOGLE_CLIENT_ID is not set in environment variables');
    }
    if (!GOOGLE_CLIENT_SECRET) {
      throw new Error('GOOGLE_CLIENT_SECRET is not set in environment variables');
    }
    if (!GOOGLE_REDIRECT_URI) {
      throw new Error('GOOGLE_REDIRECT_URI is not set in environment variables');
    }

    // Generate state with user ID embedded for callback identification
    const randomState = Math.random().toString(36).substring(7);
    const state = `${req.user.id}:${randomState}`;
    
    // Store state in session/cookie for verification
    res.cookie('gmail_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed to 'lax' for OAuth redirects to work better
      maxAge: 600000, // 10 minutes
    });

    console.log('🔐 Gmail OAuth Configuration:');
    console.log('   Client ID:', GOOGLE_CLIENT_ID);
    console.log('   Redirect URI:', GOOGLE_REDIRECT_URI);
    console.log('   Scopes:', GMAIL_SCOPES);
    console.log('   User ID:', req.user.id);
    console.log('   State:', state);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      state: state,
      prompt: 'consent', // Force consent to get refresh token
    });

    console.log('🔗 Generated OAuth URL:', authUrl);
    console.log('   Make sure this redirect_uri matches Google Console:', GOOGLE_REDIRECT_URI);

    res.json({
      success: true,
      authUrl: authUrl,
      redirectUri: GOOGLE_REDIRECT_URI, // Include for debugging
    });
  } catch (error) {
    console.error('❌ Gmail OAuth initiation error:', error);
    res.status(500).json({
      error: 'Failed to initiate OAuth',
      message: error.message,
    });
  }
});

/**
 * GET /api/gmail/callback
 * Handle OAuth callback and save tokens
 * NOTE: This route does NOT require authMiddleware because Google redirects here directly
 * We validate the user via the state parameter which contains the user ID
 */
router.get('/callback', async (req, res) => {
  try {
    console.log('🔵 Gmail OAuth callback received');
    console.log('   Query params:', req.query);
    console.log('   Cookies:', req.cookies ? Object.keys(req.cookies) : 'none');
    
    const { code, state, error } = req.query;
    const storedState = req.cookies?.gmail_oauth_state;

    // Handle OAuth errors from Google
    if (error) {
      console.error('❌ OAuth error from Google:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/gmail/inbox?error=${encodeURIComponent(error)}`);
    }

    // Validate state parameter
    if (!state) {
      console.error('❌ No state parameter in callback');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/gmail/inbox?error=${encodeURIComponent('Missing state parameter')}`);
    }

    // Verify state matches stored state (security check)
    if (!storedState || storedState !== state) {
      console.error('❌ State mismatch:', { stored: storedState, received: state });
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/gmail/inbox?error=${encodeURIComponent('Invalid state parameter - security check failed')}`);
    }

    // Extract user ID from state (format: userId:randomString)
    const [userId, randomPart] = state.split(':');
    if (!userId || !randomPart) {
      console.error('❌ Invalid state format:', state);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/gmail/inbox?error=${encodeURIComponent('Invalid state format')}`);
    }

    console.log('✅ State validated, User ID:', userId);

    if (!code) {
      console.error('❌ No authorization code received');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/gmail/inbox?error=${encodeURIComponent('No authorization code received')}`);
    }

    console.log('🔄 Exchanging authorization code for tokens...');

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.access_token) {
      throw new Error('No access token received from Google');
    }

    console.log('✅ Tokens received from Google');
    console.log('   Access token:', tokens.access_token ? 'Present' : 'Missing');
    console.log('   Refresh token:', tokens.refresh_token ? 'Present' : 'Missing');
    console.log('   Expires in:', tokens.expires_in, 'seconds');

    // Get user's email from Gmail API
    console.log('📧 Getting user email from Gmail API...');
    oauth2Client.setCredentials({ access_token: tokens.access_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get user's email address
    const profileResponse = await gmail.users.getProfile({ userId: 'me' });
    const userEmail = profileResponse.data.emailAddress;

    console.log('✅ User email:', userEmail);

    // Save tokens to email_accounts table
    const expiresAt = tokens.expires_in 
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    console.log('💾 Saving tokens to email_accounts table for user:', userId);

    // Use upsert to handle existing accounts
    const { data: emailAccount, error: dbError } = await supabaseAdmin
      .from('email_accounts')
      .upsert({
        user_id: userId,
        provider: 'gmail',
        email: userEmail,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        token_expires_at: expiresAt?.toISOString() || null,
        provider_account_id: userEmail, // Gmail uses email as account ID
        metadata: {
          connected_at: new Date().toISOString(),
        },
        is_active: true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,provider,email',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (dbError) {
      console.error('❌ Database error saving Gmail tokens:', dbError);
      throw new Error(`Failed to save tokens: ${dbError.message}`);
    }

    console.log('✅ Gmail tokens saved successfully to email_accounts');

    // Start Gmail watch for real-time updates
    try {
      const { startGmailWatch } = require('../services/gmailWatchService');
      const io = req.app.get('io'); // Get Socket.IO instance
      if (io) {
        await startGmailWatch(oauth2Client, userId, io);
        console.log('✅ Gmail watch started for real-time updates');
      }
    } catch (watchError) {
      console.warn('⚠️  Failed to start Gmail watch (will use polling):', watchError.message);
      // Don't fail the OAuth flow if watch fails
    }

    // Clear state cookie
    res.clearCookie('gmail_oauth_state', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    // Redirect to frontend Gmail page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    console.log('🔀 Redirecting to frontend:', `${frontendUrl}/gmail/inbox?connected=true`);
    res.redirect(`${frontendUrl}/gmail/inbox?connected=true`);
  } catch (error) {
    console.error('❌ Gmail OAuth callback error:', error);
    console.error('   Error stack:', error.stack);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/gmail/inbox?error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * GET /api/gmail/status
 * Check if Gmail is connected
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const { data: emailAccount, error } = await supabaseAdmin
      .from('email_accounts')
      .select('email, token_expires_at, created_at, is_active')
      .eq('user_id', req.user.id)
      .eq('provider', 'gmail')
      .eq('is_active', true)
      .single();

    if (error) {
      // No account found is not an error, just means not connected
      return res.json({
        success: true,
        connected: false,
        connectedAt: null,
        email: null,
      });
    }

    const isConnected = !!emailAccount;
    let isExpired = false;

    if (isConnected && emailAccount.token_expires_at) {
      const expiresAt = new Date(emailAccount.token_expires_at);
      isExpired = expiresAt < new Date();
    }

    res.json({
      success: true,
      connected: isConnected && !isExpired,
      connectedAt: emailAccount?.created_at || null,
      email: emailAccount?.email || null,
    });
  } catch (error) {
    console.error('Gmail status check error:', error);
    res.status(500).json({
      error: 'Failed to check Gmail status',
      message: error.message,
    });
  }
});

/**
 * POST /api/gmail/disconnect
 * Disconnect Gmail (remove tokens)
 */
router.post('/disconnect', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('email_accounts')
      .update({
        is_active: false,
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', req.user.id)
      .eq('provider', 'gmail');

    if (error) {
      throw new Error(`Failed to disconnect: ${error.message}`);
    }

    res.json({
      success: true,
      message: 'Gmail disconnected successfully',
    });
  } catch (error) {
    console.error('Gmail disconnect error:', error);
    res.status(500).json({
      error: 'Failed to disconnect Gmail',
      message: error.message,
    });
  }
});

/**
 * Helper function to get valid access token (refreshes if needed)
 * Now uses email_accounts table
 */
async function getValidAccessToken(userId, provider = 'gmail') {
  console.log(`🔑 Getting access token for user: ${userId}, provider: ${provider}`);
  
  const { data: emailAccount, error } = await supabaseAdmin
    .from('email_accounts')
    .select('id, access_token, refresh_token, token_expires_at, email')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error('❌ Database error fetching email account:', error);
    if (error.code === 'PGRST116') {
      throw new Error('Gmail account not found. Please connect your Gmail account first.');
    }
    throw new Error(`Database error: ${error.message}`);
  }

  if (!emailAccount) {
    console.error('❌ No email account found for user:', userId);
    throw new Error('Gmail account not found. Please connect your Gmail account first.');
  }

  if (!emailAccount.access_token) {
    console.error('❌ No access token found for email account:', emailAccount.id);
    throw new Error('Gmail access token missing. Please reconnect your Gmail account.');
  }

  console.log(`✅ Found email account: ${emailAccount.email}, token expires at: ${emailAccount.token_expires_at}`);

  // Check if token needs refresh
  if (emailAccount.token_expires_at) {
    const expiresAt = new Date(emailAccount.token_expires_at);
    const now = new Date();
    const fiveMinutes = 5 * 60 * 1000;

    if (expiresAt.getTime() - now.getTime() < fiveMinutes) {
      if (!emailAccount.refresh_token) {
        throw new Error('No refresh token available');
      }

      // Refresh the token
      const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI
      );

      oauth2Client.setCredentials({
        refresh_token: emailAccount.refresh_token,
      });

      console.log('🔄 Refreshing access token...');
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      if (!credentials.access_token) {
        throw new Error('Failed to refresh access token: No access token received');
      }

      console.log('✅ Access token refreshed successfully');
      
      // Save new token
      const newExpiresAt = credentials.expiry_date 
        ? new Date(credentials.expiry_date)
        : credentials.expires_in 
          ? new Date(Date.now() + credentials.expires_in * 1000)
          : null;

      const { error: updateError } = await supabaseAdmin
        .from('email_accounts')
        .update({
          access_token: credentials.access_token,
          token_expires_at: newExpiresAt?.toISOString() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', emailAccount.id);

      if (updateError) {
        console.error('❌ Error updating refreshed token:', updateError);
        throw new Error(`Failed to save refreshed token: ${updateError.message}`);
      }

      return credentials.access_token;
    }
  }

  return emailAccount.access_token;
}

/**
 * Helper function to get email account ID
 */
async function getEmailAccountId(userId, provider = 'gmail') {
  const { data: emailAccount, error } = await supabaseAdmin
    .from('email_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error('❌ Error fetching email account ID:', error);
    if (error.code === 'PGRST116') {
      throw new Error('Email account not found. Please connect your Gmail account first.');
    }
    throw new Error(`Database error: ${error.message}`);
  }

  if (!emailAccount) {
    throw new Error('Email account not found. Please connect your Gmail account first.');
  }

  return emailAccount.id;
}

/**
 * GET /api/gmail/messages
 * Get Gmail messages and save them to database
 */
router.get('/messages', authMiddleware, async (req, res) => {
  try {
    console.log('📧 Fetching Gmail messages for user:', req.user.id);
    const { query, maxResults = 20, pageToken } = req.query;
    
    let accessToken;
    let emailAccountId;
    
    try {
      accessToken = await getValidAccessToken(req.user.id);
      emailAccountId = await getEmailAccountId(req.user.id);
      console.log('✅ Access token retrieved successfully');
    } catch (tokenError) {
      console.error('❌ Token retrieval error:', tokenError.message);
      return res.status(401).json({
        error: 'Authentication failed',
        message: tokenError.message || 'Gmail not connected. Please connect your Gmail account first.',
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const params = {
      userId: 'me',
      maxResults: parseInt(maxResults),
    };

    if (query) {
      params.q = query;
    }

    if (pageToken) {
      params.pageToken = pageToken;
    }

    console.log('📬 Calling Gmail API to list messages...');
    const response = await gmail.users.messages.list(params);
    
    if (!response.data) {
      throw new Error('No data received from Gmail API');
    }
    
    console.log(`✅ Gmail API response: ${response.data.messages?.length || 0} messages found`);

    if (!response.data.messages || response.data.messages.length === 0) {
      return res.json({
        success: true,
        messages: [],
        nextPageToken: response.data.nextPageToken || null,
      });
    }

    // Fetch full message details
    const messagePromises = response.data.messages.slice(0, parseInt(maxResults)).map(msg =>
      gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      })
    );

    const messages = await Promise.all(messagePromises);
    const parsedMessages = messages.map(msg => parseGmailMessage(msg.data));

    // Save emails to database
    console.log('💾 Saving emails to database...');
    const emailsToSave = parsedMessages.map(msg => {
      // Extract recipient email
      const toMatch = msg.to ? msg.to.match(/<([^>]+)>/) : null;
      const recipientEmail = toMatch ? toMatch[1] : (msg.to || null);

      return {
        email_account_id: emailAccountId,
        provider_message_id: msg.id,
        thread_id: msg.threadId || null,
        sender_email: msg.fromEmail,
        sender_name: msg.from,
        recipient_email: recipientEmail,
        recipient_name: null, // Could extract from 'to' field if needed
        subject: msg.subject || null,
        body_text: msg.body || null,
        body_html: msg.bodyHtml || null,
        is_read: false,
        is_starred: false,
        received_at: new Date(msg.date),
        updated_at: new Date().toISOString(),
      };
    });

    // Upsert emails (avoid duplicates)
    const { error: saveError } = await supabaseAdmin
      .from('emails')
      .upsert(emailsToSave, {
        onConflict: 'email_account_id,provider_message_id',
        ignoreDuplicates: false,
      });

    if (saveError) {
      console.error('⚠️ Error saving emails to database:', saveError);
      // Don't fail the request, just log the error
    } else {
      console.log(`✅ Saved ${emailsToSave.length} emails to database`);
    }

    res.json({
      success: true,
      messages: parsedMessages,
      nextPageToken: response.data.nextPageToken || null,
    });
  } catch (error) {
    console.error('❌ Gmail messages error:', error);
    console.error('   Error details:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
    });
    
    // Provide more specific error messages
    let errorMessage = error.message || 'Failed to fetch messages';
    let statusCode = 500;
    
    // Check for metadata scope error
    if (error.message?.includes('Metadata scope') || error.message?.includes("does not support 'q' parameter")) {
      statusCode = 403;
      errorMessage = 'Gmail scope error: Your Gmail connection has outdated permissions. Please disconnect and reconnect your Gmail account in Settings to get the correct permissions.';
    } else if (error.message?.includes('not connected') || error.message?.includes('not found')) {
      statusCode = 401;
      errorMessage = 'Gmail not connected. Please connect your Gmail account first.';
    } else if (error.message?.includes('invalid_grant') || error.message?.includes('invalid_token')) {
      statusCode = 401;
      errorMessage = 'Gmail token expired. Please reconnect your Gmail account.';
    } else if (error.code === 401 || error.response?.status === 401) {
      statusCode = 401;
      errorMessage = 'Gmail authentication failed. Please reconnect your Gmail account.';
    } else if (error.code === 403 || error.response?.status === 403) {
      statusCode = 403;
      errorMessage = error.message || 'Gmail permission denied. Please reconnect your Gmail account with proper permissions.';
    }
    
    res.status(statusCode).json({
      error: 'Failed to fetch messages',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/gmail/messages/by-message-id/:messageId
 * Get email from Supabase by messageId (Gmail provider message ID)
 * This retrieves emails that were saved to the database via webhook
 */
router.get('/messages/by-message-id/:messageId', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    console.log(`📧 Fetching email by messageId: ${messageId} for user: ${userId}`);

    // First, get the email account ID for this user
    const { data: emailAccount, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .eq('is_active', true)
      .single();

    if (accountError || !emailAccount) {
      return res.status(404).json({
        error: 'Gmail account not found',
        message: 'Please connect your Gmail account first',
      });
    }

    // Get email from database by messageId
    const { data: email, error: emailError } = await supabaseAdmin
      .from('emails')
      .select('*')
      .eq('email_account_id', emailAccount.id)
      .eq('provider_message_id', messageId)
      .single();

    if (emailError || !email) {
      return res.status(404).json({
        error: 'Email not found',
        message: `No email found with messageId: ${messageId}`,
        messageId: messageId,
      });
    }

    // Format response to match Gmail API format
    const formattedEmail = {
      id: email.provider_message_id,
      messageId: email.provider_message_id,
      threadId: email.thread_id,
      from: email.sender_name || email.sender_email,
      fromEmail: email.sender_email,
      to: email.recipient_email,
      subject: email.subject,
      body: email.body_text,
      bodyHtml: email.body_html,
      snippet: email.body_text?.substring(0, 200) || '',
      date: email.received_at,
      isRead: email.is_read,
      isStarred: email.is_starred,
      receivedAt: email.received_at,
      createdAt: email.created_at,
      updatedAt: email.updated_at,
    };

    console.log(`✅ Email found by messageId: ${messageId}`);
    res.json({
      success: true,
      message: formattedEmail,
    });
  } catch (error) {
    console.error('Error fetching email by messageId:', error);
    res.status(500).json({
      error: 'Failed to fetch email',
      message: error.message,
    });
  }
});

/**
 * GET /api/gmail/messages/:id
 * Get a specific Gmail message
 */
router.get('/messages/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const accessToken = await getValidAccessToken(req.user.id);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: id,
      format: 'full',
    });

    res.json({
      success: true,
      message: parseGmailMessage(response.data),
    });
  } catch (error) {
    console.error('Gmail message error:', error);
    res.status(500).json({
      error: 'Failed to fetch message',
      message: error.message,
    });
  }
});

/**
 * GET /api/gmail/messages/:id/attachments/:attachmentId
 * Download attachment
 */
router.get('/messages/:id/attachments/:attachmentId', authMiddleware, async (req, res) => {
  try {
    const { id, attachmentId } = req.params;
    const accessToken = await getValidAccessToken(req.user.id);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: id,
      id: attachmentId,
    });

    // Decode base64url
    const data = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(data, 'base64');

    res.setHeader('Content-Type', response.data.mimeType || 'application/octet-stream');
    res.send(buffer);
  } catch (error) {
    console.error('Gmail attachment error:', error);
    res.status(500).json({
      error: 'Failed to download attachment',
      message: error.message,
    });
  }
});

/**
 * POST /api/gmail/send
 * Send email via Gmail
 */
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { to, subject, body, htmlBody, attachments } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'to, subject, and body are required',
      });
    }

    const accessToken = await getValidAccessToken(req.user.id);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Create email message
    const messageParts = [];
    
    // Headers
    messageParts.push(`To: ${to}`);
    messageParts.push(`Subject: ${subject}`);
    messageParts.push('Content-Type: text/html; charset=utf-8');
    messageParts.push('');

    // Body
    messageParts.push(htmlBody || body);

    const rawMessage = messageParts.join('\n');
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    res.json({
      success: true,
      messageId: response.data.id,
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('Gmail send error:', error);
    res.status(500).json({
      error: 'Failed to send email',
      message: error.message,
    });
  }
});

/**
 * POST /api/gmail/messages/:id/reply
 * Reply to an email
 */
router.post('/messages/:id/reply', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { body, htmlBody } = req.body;
    const accessToken = await getValidAccessToken(req.user.id);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get original message to get thread ID and reply headers
    const originalMessage = await gmail.users.messages.get({
      userId: 'me',
      id: id,
      format: 'full',
    });

    const headers = originalMessage.data.payload.headers || [];
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
    const messageId = headers.find(h => h.name.toLowerCase() === 'message-id')?.value || '';
    const references = headers.find(h => h.name.toLowerCase() === 'references')?.value || '';

    // Build reply headers
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const replyTo = from;
    const replyReferences = references ? `${references} ${messageId}` : messageId;

    const message = [
      `To: ${replyTo}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${replyReferences}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody || body,
    ].join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: originalMessage.data.threadId,
      },
    });

    res.json({
      success: true,
      messageId: response.data.id,
      message: 'Reply sent successfully',
    });
  } catch (error) {
    console.error('Gmail reply error:', error);
    res.status(500).json({
      error: 'Failed to send reply',
      message: error.message,
    });
  }
});

/**
 * POST /api/gmail/messages/:id/forward
 * Forward an email
 */
router.post('/messages/:id/forward', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { to, body, htmlBody } = req.body;
    const accessToken = await getValidAccessToken(req.user.id);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get original message
    const originalMessage = await gmail.users.messages.get({
      userId: 'me',
      id: id,
      format: 'full',
    });

    const headers = originalMessage.data.payload.headers || [];
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
    const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';

    const forwardSubject = subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;
    
    // Include original message in forward
    const forwardBody = htmlBody || body || '';
    const originalContent = `
      <br><br>
      <div style="border-left: 3px solid #ccc; padding-left: 10px; margin-left: 10px;">
        <p><strong>From:</strong> ${from}</p>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr>
        ${originalMessage.data.snippet || ''}
      </div>
    `;

    const message = [
      `To: ${to}`,
      `Subject: ${forwardSubject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      forwardBody + originalContent,
    ].join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    res.json({
      success: true,
      messageId: response.data.id,
      message: 'Email forwarded successfully',
    });
  } catch (error) {
    console.error('Gmail forward error:', error);
    res.status(500).json({
      error: 'Failed to forward email',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/gmail/messages/:id
 * Delete an email
 */
router.delete('/messages/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const accessToken = await getValidAccessToken(req.user.id);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.messages.delete({
      userId: 'me',
      id: id,
    });

    res.json({
      success: true,
      message: 'Email deleted successfully',
    });
  } catch (error) {
    console.error('Gmail delete error:', error);
    res.status(500).json({
      error: 'Failed to delete email',
      message: error.message,
    });
  }
});

/**
 * POST /api/gmail/messages/:id/archive
 * Archive an email
 */
router.post('/messages/:id/archive', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const accessToken = await getValidAccessToken(req.user.id);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.messages.modify({
      userId: 'me',
      id: id,
      requestBody: {
        removeLabelIds: ['INBOX'],
      },
    });

    res.json({
      success: true,
      message: 'Email archived successfully',
    });
  } catch (error) {
    console.error('Gmail archive error:', error);
    res.status(500).json({
      error: 'Failed to archive email',
      message: error.message,
    });
  }
});

/**
 * POST /api/gmail/messages/:id/star
 * Star or unstar an email
 */
router.post('/messages/:id/star', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { starred } = req.body; // true to star, false to unstar
    const accessToken = await getValidAccessToken(req.user.id);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    if (starred) {
      await gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          addLabelIds: ['STARRED'],
        },
      });
    } else {
      await gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          removeLabelIds: ['STARRED'],
        },
      });
    }

    res.json({
      success: true,
      message: starred ? 'Email starred successfully' : 'Email unstarred successfully',
    });
  } catch (error) {
    console.error('Gmail star error:', error);
    res.status(500).json({
      error: 'Failed to update star status',
      message: error.message,
    });
  }
});

/**
 * POST /api/gmail/messages/:id/read
 * Mark email as read or unread
 */
router.post('/messages/:id/read', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { read } = req.body; // true to mark as read, false to mark as unread
    const accessToken = await getValidAccessToken(req.user.id);

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    if (read) {
      await gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });
    } else {
      await gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          addLabelIds: ['UNREAD'],
        },
      });
    }

    res.json({
      success: true,
      message: read ? 'Email marked as read' : 'Email marked as unread',
    });
  } catch (error) {
    console.error('Gmail read status error:', error);
    res.status(500).json({
      error: 'Failed to update read status',
      message: error.message,
    });
  }
});

/**
 * Helper function to parse Gmail message
 * Exported for use in other modules
 */
function parseGmailMessage(message) {
  const headers = message.payload.headers || [];
  const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
  const to = headers.find(h => h.name.toLowerCase() === 'to')?.value || '';
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
  const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';

  // Extract email from "Name <email@domain.com>" format
  const emailMatch = from.match(/<([^>]+)>/);
  const fromEmail = emailMatch ? emailMatch[1] : from;
  const fromName = from.replace(/<[^>]+>/, '').trim();

  // Find attachments
  const attachments = [];
  const findAttachments = (parts) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
          size: part.body.size || 0,
        });
      }
      if (part.parts) {
        findAttachments(part.parts);
      }
    }
  };

  findAttachments(message.payload.parts);

  // Get body text
  let bodyText = '';
  let bodyHtml = '';
  const getBody = (parts) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        bodyText = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.mimeType === 'text/html' && part.body?.data) {
        bodyHtml = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.parts) {
        getBody(part.parts);
      }
    }
  };

  getBody(message.payload.parts);

  return {
    id: message.id,
    threadId: message.threadId,
    from: fromName || fromEmail,
    fromEmail,
    to,
    subject,
    date: date ? (() => {
      try {
        const parsed = new Date(date);
        return isNaN(parsed.getTime()) ? new Date(parseInt(message.internalDate)).toISOString() : parsed.toISOString();
      } catch {
        return new Date(parseInt(message.internalDate)).toISOString();
      }
    })() : new Date(parseInt(message.internalDate)).toISOString(),
    snippet: message.snippet || '',
    body: bodyText || bodyHtml || '',
    bodyHtml: bodyHtml || '',
    attachments,
    hasResume: attachments.some(att => {
      const filename = att.filename.toLowerCase();
      return (filename.includes('resume') || filename.includes('cv') || filename.includes('curriculum')) &&
        (att.mimeType.includes('pdf') || att.mimeType.includes('document') || att.mimeType.includes('msword'));
    }),
  };
}

/**
 * POST /api/gmail/webhook
 * Pub/Sub webhook - receives push notifications from Gmail via Google Pub/Sub
 * This is the real-time ingestion endpoint - emails arrive instantly here
 * 
 * Flow:
 * 1. Gmail receives new email
 * 2. Gmail sends notification to Pub/Sub topic
 * 3. Pub/Sub pushes to this webhook endpoint
 * 4. Backend fetches email from Gmail API
 * 5. Backend saves email immediately to Supabase
 * 6. Frontend will see it on next page load/refresh (no realtime subscription)
 */
router.post('/webhook', async (req, res) => {
  try {
    console.log('\n📬 Gmail Pub/Sub push notification received');
    const pubsubMessage = req.body;

    // Acknowledge immediately (required by Pub/Sub - must respond within 10 seconds)
    res.status(200).json({ success: true });

    // Process asynchronously (don't block the response)
    if (pubsubMessage && pubsubMessage.message && pubsubMessage.message.data) {
      try {
        // Decode Pub/Sub message
        const messageData = JSON.parse(
          Buffer.from(pubsubMessage.message.data, 'base64').toString('utf-8')
        );

        const { emailAddress, historyId } = messageData;
        console.log(`📧 Processing notification for ${emailAddress}, historyId: ${historyId}`);

        // Get user auth from database
        const { data: emailAccount, error } = await supabaseAdmin
          .from('email_accounts')
          .select('id, user_id, access_token, refresh_token, token_expires_at, email')
          .eq('email', emailAddress)
          .eq('provider', 'gmail')
          .eq('is_active', true)
          .single();

        if (error || !emailAccount) {
          console.warn(`⚠️  No active Gmail account found for: ${emailAddress}`);
          return;
        }

        // Get valid access token (refreshes if needed)
        const accessToken = await getValidAccessToken(emailAccount.user_id, 'gmail');

        // Create OAuth client
        const oauth2Client = new google.auth.OAuth2(
          GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET,
          GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({ access_token: accessToken });

        // Get Socket.IO instance (optional - for WebSocket notifications)
        const io = req.app.get('io');
        
        // Handle the notification - this will:
        // 1. Fetch new emails from Gmail API using historyId
        // 2. Save each email immediately to Supabase
        // 3. Optionally broadcast via WebSocket (if frontend is connected)
        const { handleGmailNotification } = require('../services/gmailWatchService');
        await handleGmailNotification(emailAccount.user_id, historyId, oauth2Client, io);
        
        console.log('✅ Pub/Sub notification processed successfully');
      } catch (processError) {
        console.error('❌ Error processing Pub/Sub message:', processError.message);
        console.error('   Stack:', processError.stack);
      }
    } else {
      console.warn('⚠️  Invalid Pub/Sub message format:', {
        hasMessage: !!pubsubMessage?.message,
        hasData: !!pubsubMessage?.message?.data,
      });
    }
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    // Still return 200 to Pub/Sub (don't retry on our errors)
    // Pub/Sub will retry if we return 5xx, but we don't want that for processing errors
    res.status(200).json({ error: error.message });
  }
});

// Export helper functions for use in other modules
module.exports = router;
module.exports.getValidAccessToken = getValidAccessToken;
module.exports.getEmailAccountId = getEmailAccountId;
module.exports.parseGmailMessage = parseGmailMessage;

