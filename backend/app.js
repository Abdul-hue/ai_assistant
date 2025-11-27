require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
// Rate limiting disabled - removed express-rate-limit import

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io available globally
app.set('io', io);

// Trust proxy (required when behind reverse proxy like Nginx)
// Only trust the first proxy (Nginx) for security
app.set('trust proxy', 1);

// Import routes
const authRoutes = require('./src/routes/auth');
const migrateRoutes = require('./src/routes/migrate');
const whatsappRoutes = require('./src/routes/whatsapp');
const agentRoutes = require('./src/routes/agents');
const webhookUploadRoute = require('./src/routes/webhookUpload');
const webhookSendMessageRoute = require('./src/routes/webhookSendMessage');
const extractPdfRoute = require('./src/routes/extractPdf');
const processAgentFileRoute = require('./src/routes/processAgentFile');
const agentDocumentsRoute = require('./src/routes/agentDocuments');
const contactsRoutes = require('./src/routes/contacts');
const profileRoutes = require('./src/routes/profile');
const dashboardRoutes = require('./src/routes/dashboard');
const gmailRoutes = require('./src/routes/gmail');
const emailActionsRoutes = require('./src/routes/emailActions');

// ============================================================================
// ENVIRONMENT VALIDATION
// ============================================================================

console.log('\n🔍 Checking environment variables...');

const requiredEnvVars = {
  'DATABASE_URL': process.env.DATABASE_URL,
  'SUPABASE_URL': process.env.SUPABASE_URL,
  'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
};

// Optional environment variables with defaults
const optionalEnvVars = {
  'WEBHOOK_ENV': process.env.WEBHOOK_ENV || 'production',
  'N8N_WEBHOOK_URL': process.env.N8N_WEBHOOK_URL || 'https://nsolbpo.app.n8n.cloud/webhook/whatsapp-webhook',
  'N8N_WEBHOOK_TIMEOUT': process.env.N8N_WEBHOOK_TIMEOUT || '30000',
  'WEBHOOK_RETRY_MAX_ATTEMPTS': process.env.WEBHOOK_RETRY_MAX_ATTEMPTS || '3',
  'WEBHOOK_RETRY_INITIAL_DELAY': process.env.WEBHOOK_RETRY_INITIAL_DELAY || '2000',
  'AGENT_DOCUMENT_WEBHOOK_URL': process.env.AGENT_DOCUMENT_WEBHOOK_URL || 'https://auto.nsolbpo.com/webhook/upload-documents',
  'AGENT_FILES_BUCKET': process.env.AGENT_FILES_BUCKET || 'agent-files',
  'EXTRACTOR_MAX_FILE_BYTES': process.env.EXTRACTOR_MAX_FILE_BYTES || '10000000'
};

const missingEnvVars = Object.entries(requiredEnvVars)
  .filter(([key, value]) => !value)
  .map(([key]) => key);

if (missingEnvVars.length > 0) {
  console.warn('⚠️  WARNING: Missing environment variables:', missingEnvVars.join(', '));
  console.warn('⚠️  Some features may not work properly without these variables.');
} else {
  console.log('✅ All required environment variables are set');
}

// Display optional environment variables
console.log('\n📋 Optional environment variables:');
Object.entries(optionalEnvVars).forEach(([key, value]) => {
  console.log(`   ${key}: ${value}`);
});

if (process.env.NODE_ENV !== 'production') {
  console.log('\n[env-check] Environment verification (development only)');

  if (process.env.AGENT_DOCUMENT_WEBHOOK_URL) {
    console.log(`[env-check] ✅ AGENT_DOCUMENT_WEBHOOK_URL=${process.env.AGENT_DOCUMENT_WEBHOOK_URL}`);
  } else {
    console.warn('[env-check] ⚠️ Missing AGENT_DOCUMENT_WEBHOOK_URL. Add it to your .env.');
  }

  if (process.env.AGENT_FILES_BUCKET) {
    console.log(`[env-check] ✅ AGENT_FILES_BUCKET=${process.env.AGENT_FILES_BUCKET}`);
  } else {
    console.warn('[env-check] ⚠️ Missing AGENT_FILES_BUCKET. Add it to your .env.');
  }

  if (process.env.SUPABASE_URL) {
    console.log('[env-check] ✅ Supabase URL present');
  } else {
    console.warn('[env-check] ⚠️ Missing SUPABASE_URL. Add it to your .env.');
  }

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[env-check] 🔒 Service role key loaded (hidden)');
  } else {
    console.warn('[env-check] ⚠️ Missing SUPABASE_SERVICE_ROLE_KEY. Keep it only in your local .env or deployment configuration.');
  }

  if (process.env.EXTRACTOR_MAX_FILE_BYTES) {
    console.log(`[env-check] ✅ EXTRACTOR_MAX_FILE_BYTES=${process.env.EXTRACTOR_MAX_FILE_BYTES}`);
  } else {
    console.warn('[env-check] ⚠️ Missing EXTRACTOR_MAX_FILE_BYTES. Add it to your .env.');
  }
}

// Display webhook configuration
console.log('\n🔗 Webhook Configuration:');
console.log(`   Environment: ${optionalEnvVars.WEBHOOK_ENV}`);
console.log(`   Webhook URL: ${optionalEnvVars.WEBHOOK_ENV === 'test' ? 'https://nsolbpo.app.n8n.cloud/webhook-test/whatsapp-webhook' : optionalEnvVars.N8N_WEBHOOK_URL}`);
console.log(`   Timeout: ${optionalEnvVars.N8N_WEBHOOK_TIMEOUT}ms`);
console.log(`   Max Retries: ${optionalEnvVars.WEBHOOK_RETRY_MAX_ATTEMPTS}`);
console.log(`   Initial Delay: ${optionalEnvVars.WEBHOOK_RETRY_INITIAL_DELAY}ms`);

// ============================================================================
// CORS CONFIGURATION (SECURITY: Strict origin whitelist)
// ============================================================================

// SECURITY: Parse allowed origins from environment variable or use defaults
// Format: ALLOWED_ORIGINS=https://app1.com,https://app2.com,http://localhost:3000
const allowedOriginsFromEnv = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [];

const defaultAllowedOrigins = [
  'http://localhost:5173',  // Vite dev server
  'http://localhost:8080',  // Alternative dev server
  'http://localhost:3000',  // React dev server
];

// Combine environment origins with defaults
const allowedOrigins = [
  ...allowedOriginsFromEnv,
  ...(process.env.NODE_ENV === 'development' ? defaultAllowedOrigins : [])
];

// Remove duplicates and empty strings
const uniqueAllowedOrigins = [...new Set(allowedOrigins)].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow same-origin requests (no origin header) - these are safe
    // Same-origin requests occur when browser loads page from same host
    if (!origin) {
      // In production, allow same-origin requests (browser loading frontend from same server)
      // This is safe because same-origin requests don't need CORS protection
      return callback(null, true);
    }
    
    // SECURITY: Exact match only - no wildcards or pattern matching
    if (uniqueAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    console.warn(`⚠️ SECURITY: CORS rejected unauthorized origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true, // ✅ CRITICAL: Required for HttpOnly cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Idempotency-Key'], // ✅ Allow idempotency header
  exposedHeaders: ['Content-Length', 'X-Request-Id', 'Set-Cookie'], // ✅ Allow Set-Cookie header
  maxAge: 86400, // 24 hours
};

// Apply CORS middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

console.log('✅ CORS configured for', uniqueAllowedOrigins.length, 'origins');
if (process.env.NODE_ENV !== 'production') {
  console.log('   Allowed origins:', uniqueAllowedOrigins.join(', '));
}

// ============================================================================
// RATE LIMITING - SELECTIVE (Security Enhancement)
// ============================================================================
// Rate limiting applied to sensitive endpoints to prevent abuse
// Status checks are NOT rate limited to allow frequent polling
let rateLimit = null;
try {
  rateLimit = require('express-rate-limit');
} catch (e) {
  console.warn('⚠️  express-rate-limit not installed. Rate limiting disabled.');
  console.warn('⚠️  Install with: npm install express-rate-limit');
}

// Rate limiter for WhatsApp initialization (prevent spam)
const whatsappInitLimiter = rateLimit ? rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 connection attempts per 15 minutes
  message: 'Too many WhatsApp connection attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting in development
    return process.env.NODE_ENV === 'development';
  }
}) : (req, res, next) => next();

// Rate limiter for message sending
const messageSendLimiter = rateLimit ? rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 messages per minute per user
  message: 'Message rate limit exceeded. Please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    // Rate limit per user ID (preferred) or fall back to default IP handling
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }
    // Return undefined to use express-rate-limit's default IP handling (IPv6-safe)
    return undefined;
  },
  skip: (req) => {
    // Skip rate limiting in development
    return process.env.NODE_ENV === 'development';
  }
}) : (req, res, next) => next();

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Cookie parsing (SECURITY: Required for HttpOnly cookie authentication)
app.use(cookieParser());

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from public directory (frontend build)
// This allows the backend to serve the React frontend
const path = require('path');
const publicPath = path.join(__dirname, 'public');
if (require('fs').existsSync(publicPath)) {
  app.use(express.static(publicPath));
  console.log('✅ Static files served from:', publicPath);
}

// Rate limiting disabled - no rate limiting applied to API routes

// Request logging (development only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
    next();
  });
}

// ============================================================================
// HEALTH CHECK ROUTES
// ============================================================================

// Root route - serve frontend if available, otherwise return status
app.get('/', (req, res) => {
  const frontendIndexPath = path.join(__dirname, 'public', 'index.html');
  if (require('fs').existsSync(frontendIndexPath)) {
    res.sendFile(frontendIndexPath);
  } else {
    res.json({
      message: 'Server is running',
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    cors: 'enabled',
    allowedOrigins: allowedOrigins.length,
    env: {
      databaseUrl: process.env.DATABASE_URL ? 'configured' : 'missing',
      supabaseUrl: process.env.SUPABASE_URL ? 'configured' : 'missing',
      supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'configured' : 'missing',
    }
  };

  res.json(healthCheck);
});

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  res.json({
    message: 'CORS is working!',
    origin: req.headers.origin || 'no origin',
    allowedOrigins: allowedOrigins,
    timestamp: new Date().toISOString(),
  });
});

// n8n health check
app.get('/api/health/n8n', async (req, res) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = process.env.N8N_WEBHOOK_URL || 'https://nsolbpo.app.n8n.cloud/webhook/whatsapp-webhook';
    const r = await fetch(url, { method: 'HEAD', signal: controller.signal }).catch(() => ({ ok: false, status: 0 }));
    clearTimeout(timer);
    res.json({ ok: !!r.ok, status: r.status, url });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// API ROUTES
// ============================================================================

// Auth routes (rate limiting disabled)
app.use('/api/auth', authRoutes);

// Gmail routes
app.use('/api/gmail', gmailRoutes);
app.use('/api/emails', emailActionsRoutes);

// Other routes
app.use('/api/migrate', migrateRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Agent routes (rate limiting disabled)
app.use('/api/agents', agentRoutes);
app.use('/api/agents', contactsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/process-agent-file', processAgentFileRoute);
app.use('/api/agent-documents', agentDocumentsRoute);

// Webhook for external document uploads (no /api prefix to match external contract)
app.use('/webhookupload-documents', webhookUploadRoute);

// Webhook for N8N to send WhatsApp messages (public endpoint)
app.use('/api/webhooks/send-message', webhookSendMessageRoute);

// Document extraction endpoint (used by frontend after file upload)
app.use('/extract-pdf', extractPdfRoute);

// ============================================================================
// ERROR HANDLERS
// ============================================================================

// Serve frontend SPA - catch all routes and return index.html
// This must be after all API routes but before 404 handler
const frontendIndexPath = path.join(__dirname, 'public', 'index.html');
if (require('fs').existsSync(frontendIndexPath)) {
  app.get('*', (req, res, next) => {
    // Skip API routes and health checks
    if (req.path.startsWith('/api/') || req.path === '/health' || req.path === '/api/health') {
      return next();
    }
    res.sendFile(frontendIndexPath);
  });
}

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  console.warn(`⚠️  404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Global error handler:', err.message);
  console.error('Stack:', err.stack);
  
  // Don't expose stack traces in production
  const errorResponse = {
    error: err.message || 'Internal server error',
    path: req.path,
    method: req.method,
  };

  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }

  res.status(err.status || 500).json(errorResponse);
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

// Handle uncaught exceptions (don't let them crash the server)
process.on('uncaughtException', (error) => {
  console.error('🔴 Uncaught Exception:', error.message);
  console.error(error.stack);
  // In production, you might want to gracefully shutdown here
  // For now, we'll let it continue running
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't crash the server
});

// Initialize existing WhatsApp sessions on startup
const { initializeExistingSessions } = require('./src/services/baileysService');

// Start the server
// Socket.IO connection handling
io.on('connection', (socket) => {
  // Extract User ID from query parameter or handshake
  const userId = socket.handshake.query.userId || socket.handshake.headers['user-id'];
  
  console.log(`\n👤 User connected: ${socket.id}`);
  console.log(`   User ID: ${userId || 'NOT PROVIDED'}`);
  
  if (!userId) {
    console.error('   ❌ No User ID provided');
    socket.emit('error', {
      message: 'User ID required',
      details: 'Please provide a User ID to connect',
    });
    socket.disconnect(true);
    return;
  }

  // User joins their room
  socket.on('join_user', (data) => {
    const requestUserId = data?.userId || userId;
    console.log(`👥 User ${requestUserId} joined room`);
    socket.join(requestUserId);
  });

  // Request initial emails
  socket.on('get_initial_emails', async (data) => {
    try {
      const requestUserId = data?.userId || userId;
      console.log(`\n📧 Request: get_initial_emails from ${requestUserId}`);
      
      if (!requestUserId) {
        socket.emit('error', { message: 'User ID required' });
        return;
      }

      // Get email account from database
      const { supabaseAdmin } = require('./src/config/supabase');
      const { data: emailAccount, error: dbError } = await supabaseAdmin
        .from('email_accounts')
        .select('access_token, refresh_token, token_expires_at, email')
        .eq('user_id', requestUserId)
        .eq('provider', 'gmail')
        .eq('is_active', true)
        .single();

      if (dbError || !emailAccount?.access_token) {
        console.log(`   ⚠️  Gmail not connected for user ${requestUserId}`);
        // Send empty array instead of error - allows frontend to show "not connected" state
        socket.emit('initial_emails', { emails: [] });
        return;
      }

      console.log(`   ✅ Access token retrieved successfully`);

      // Create OAuth client
      const { google } = require('googleapis');
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      // Set credentials
      const expiryDate = emailAccount.token_expires_at 
        ? new Date(emailAccount.token_expires_at).getTime() 
        : null;
      
      oauth2Client.setCredentials({
        access_token: emailAccount.access_token,
        refresh_token: emailAccount.refresh_token,
        expiry_date: expiryDate,
      });

      // Check if token needs refresh (less than 5 minutes left)
      if (expiryDate) {
        const now = Date.now();
        const timeLeft = expiryDate - now;

        if (timeLeft < 5 * 60 * 1000) { // Less than 5 minutes left
          console.log('   🔄 Token expiring soon, refreshing...');
          
          if (!emailAccount.refresh_token) {
            console.error('   ❌ No refresh token available');
            socket.emit('error', {
              message: 'Token expired and no refresh token available',
              details: 'Please re-authenticate with Gmail',
            });
            return;
          }

          try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            
            // Update in database
            const newExpiresAt = credentials.expiry_date 
              ? new Date(credentials.expiry_date).toISOString()
              : credentials.expires_in
                ? new Date(Date.now() + credentials.expires_in * 1000).toISOString()
                : null;
            
            await supabaseAdmin
              .from('email_accounts')
              .update({
                access_token: credentials.access_token,
                refresh_token: credentials.refresh_token || emailAccount.refresh_token,
                token_expires_at: newExpiresAt,
                updated_at: new Date().toISOString(),
              })
              .eq('user_id', requestUserId)
              .eq('provider', 'gmail');
            
            oauth2Client.setCredentials(credentials);
            console.log('   ✅ Token refreshed successfully');
          } catch (refreshError) {
            console.error('   ❌ Token refresh failed:', refreshError.message);
            socket.emit('error', {
              message: 'Failed to refresh Gmail token',
              details: 'Please re-authenticate',
            });
            return;
          }
        }
      }

      // ✅ ALWAYS FETCH FROM GMAIL API (no cache)
      const { getInitialEmails } = require('./src/services/gmailWatchService');
      
      console.log('   📧 Fetching directly from Gmail API (no cache)...');
      const emails = await getInitialEmails(oauth2Client, requestUserId, 20);
      const validEmails = emails.filter(e => e !== null);
      
      // Note: getInitialEmails still saves to Supabase for real-time notifications, but we don't read from it

      // Helper function to format email time
      const formatEmailTime = (dateString) => {
        try {
          const emailDate = new Date(dateString);
          const now = new Date();
          const diffMs = now - emailDate;
          const diffMins = Math.floor(diffMs / 60000);
          const diffHours = Math.floor(diffMins / 60);
          const diffDays = Math.floor(diffHours / 24);

          if (diffMins < 1) return 'now';
          if (diffMins < 60) return `${diffMins}m ago`;
          if (diffHours < 24) return `${diffHours}h ago`;
          if (diffDays < 7) return `${diffDays}d ago`;
          return emailDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch {
          return 'Unknown';
        }
      };

      // Helper function to get avatar initials
      const getAvatarInitials = (from) => {
        const emailMatch = from.match(/([A-Za-z]+)/);
        return emailMatch ? emailMatch[1].substring(0, 2).toUpperCase() : 'EM';
      };

      // Format emails for frontend
      const formattedEmails = validEmails.map(email => ({
        id: email.id || email.messageId,
        messageId: email.id || email.messageId,
        from: email.from,
        fromEmail: email.fromEmail || email.from,
        to: email.to,
        subject: email.subject || '(No subject)',
        preview: email.snippet || '',
        snippet: email.snippet || '',
        body: email.body || email.snippet || '',
        bodyHtml: email.bodyHtml || '',
        date: email.date,
        time: formatEmailTime(email.date),
        avatar: getAvatarInitials(email.from),
        hasAttachment: email.attachments && email.attachments.length > 0,
        attachments: email.attachments || [],
      }));

      console.log(`   ✅ Sending ${formattedEmails.length} emails to frontend (from Gmail API)`);
      socket.emit('initial_emails', { emails: formattedEmails });
    } catch (error) {
      console.error('❌ Error getting initial emails:', error);
      socket.emit('error', { 
        message: error.message || 'Failed to fetch emails',
        error: error.toString()
      });
    }
  });

  // Refresh emails - fetch from Gmail API directly (no cache)
  socket.on('refresh_emails', async (data) => {
    try {
      const requestUserId = data?.userId || userId;
      
      console.log(`\n🔄 Request: refresh_emails from ${requestUserId} (fetching from Gmail API)`);
      
      if (!requestUserId) {
        socket.emit('error', { message: 'User ID required' });
        return;
      }

      // Get user's Gmail auth from database
      const { supabaseAdmin } = require('./src/config/supabase');
      const { data: emailAccount, error: dbError } = await supabaseAdmin
        .from('email_accounts')
        .select('id, access_token, refresh_token, token_expires_at, email')
        .eq('user_id', requestUserId)
        .eq('provider', 'gmail')
        .eq('is_active', true)
        .single();

      if (dbError || !emailAccount?.access_token) {
        socket.emit('error', { message: 'Gmail not connected' });
        return;
      }

      // Create OAuth client
      const { google } = require('googleapis');
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      // Set credentials and refresh if needed
      const expiryDate = emailAccount.token_expires_at ? new Date(emailAccount.token_expires_at).getTime() : null;
      oauth2Client.setCredentials({
        access_token: emailAccount.access_token,
        refresh_token: emailAccount.refresh_token,
        expiry_date: expiryDate,
      });

      // Refresh token if needed
      if (expiryDate && (expiryDate - Date.now() < 5 * 60 * 1000)) {
        try {
          const { credentials } = await oauth2Client.refreshAccessToken();
          await supabaseAdmin
            .from('email_accounts')
            .update({
              access_token: credentials.access_token,
              refresh_token: credentials.refresh_token || emailAccount.refresh_token,
              token_expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', requestUserId)
            .eq('provider', 'gmail');
          oauth2Client.setCredentials(credentials);
        } catch (refreshError) {
          socket.emit('error', { message: 'Failed to refresh Gmail token' });
          return;
        }
      }

      // Fetch from Gmail API directly (no cache)
      const { getInitialEmails } = require('./src/services/gmailWatchService');
      const emails = await getInitialEmails(oauth2Client, requestUserId, 20);
      const validEmails = emails.filter(e => e !== null);

      // Format emails for frontend
      const formatEmailTime = (dateString) => {
        try {
          const emailDate = new Date(dateString);
          const now = new Date();
          const diffMs = now - emailDate;
          const diffMins = Math.floor(diffMs / 60000);
          const diffHours = Math.floor(diffMins / 60);
          const diffDays = Math.floor(diffHours / 24);

          if (diffMins < 1) return 'now';
          if (diffMins < 60) return `${diffMins}m ago`;
          if (diffHours < 24) return `${diffHours}h ago`;
          if (diffDays < 7) return `${diffDays}d ago`;
          return emailDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch {
          return 'Unknown';
        }
      };

      const getAvatarInitials = (from) => {
        const emailMatch = from.match(/([A-Za-z]+)/);
        return emailMatch ? emailMatch[1].substring(0, 2).toUpperCase() : 'EM';
      };

      const formattedEmails = validEmails.map(email => ({
        id: email.id || email.messageId,
        messageId: email.id || email.messageId,
        from: email.from,
        fromEmail: email.fromEmail || email.from,
        to: email.to,
        subject: email.subject || '(No subject)',
        preview: email.snippet || '',
        snippet: email.snippet || '',
        body: email.body || email.snippet || '',
        bodyHtml: email.bodyHtml || '',
        date: email.date,
        time: formatEmailTime(email.date),
        avatar: getAvatarInitials(email.from),
        hasAttachment: email.attachments && email.attachments.length > 0,
        attachments: email.attachments || [],
      }));

      // Emit refresh complete with all emails (frontend will update the list)
      socket.emit('refresh_complete', { 
        newEmailsCount: formattedEmails.length,
        emails: formattedEmails // Send all emails so frontend can update
      });
      
      console.log(`   ✅ Refreshed ${formattedEmails.length} emails from Gmail API`);
    } catch (error) {
      console.error('❌ Error refreshing emails:', error);
      socket.emit('error', { 
        message: error.message || 'Failed to refresh emails',
        error: error.toString()
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`\n👋 User disconnected: ${socket.id} (${userId || 'unknown'})`);
  });

  socket.on('error', (error) => {
    console.error(`❌ Socket error for ${userId}:`, error);
  });
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Backend Server Started Successfully');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Database: ${process.env.DATABASE_URL ? 'Configured' : 'Not configured'}`);
  console.log(`🔐 Supabase Auth: ${process.env.SUPABASE_URL ? 'Configured' : 'Not configured'}`);
  console.log(`🔑 Supabase Service Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`📱 WhatsApp (Baileys): ✅ Enabled`);
  console.log('='.repeat(60) + '\n');

  // Initialize existing WhatsApp sessions (non-blocking)
  setTimeout(async () => {
    try {
      await initializeExistingSessions();
    } catch (error) {
      console.error('Error initializing WhatsApp sessions:', error.message);
      console.log('⚠️  WhatsApp session initialization failed, but server is running');
    }
  }, 3000); // Wait 3 seconds for database to be ready

  // Start scheduled email check job (every 15 minutes)
  const { checkForNewEmailsForAllAccounts } = require('./src/services/gmailWatchService');
  
  // Run immediately after 10 seconds (give server time to fully start)
  setTimeout(async () => {
    console.log('📧 Starting initial email check...');
    try {
      await checkForNewEmailsForAllAccounts();
    } catch (error) {
      console.error('Error in initial email check:', error.message);
    }
  }, 10000);

  // Then run every 15 minutes (900,000 ms)
  const EMAIL_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
  setInterval(async () => {
    try {
      await checkForNewEmailsForAllAccounts();
    } catch (error) {
      console.error('Error in scheduled email check:', error.message);
    }
  }, EMAIL_CHECK_INTERVAL);

  console.log(`📧 Scheduled email check: Every 15 minutes`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Export both app and rate limiters
module.exports = app;
module.exports.rateLimiters = {
  whatsappInitLimiter,
  messageSendLimiter
};
