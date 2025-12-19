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

// Initialize Socket.IO with improved configuration
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'], // Support both for reliability
  pingTimeout: 60000,
  pingInterval: 25000
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
const webhookSendEmailRoute = require('./src/routes/webhookSendEmail');
const extractPdfRoute = require('./src/routes/extractPdf');
const processAgentFileRoute = require('./src/routes/processAgentFile');
const agentDocumentsRoute = require('./src/routes/agentDocuments');
const agentFileRoutes = require('./src/routes/agentFileRoutes');
const contactsRoutes = require('./src/routes/contacts');
const profileRoutes = require('./src/routes/profile');
const dashboardRoutes = require('./src/routes/dashboard');
const messagesRoutes = require('./src/routes/messages');
const imapSmtpRoutes = require('./src/routes/imapSmtp');
const folderManagementRoutes = require('./src/routes/folderManagement');
const fetchNewMailRoutes = require('./src/routes/fetchNewMail');
const { fetchNewUnreadEmailsForAllAccounts } = require('./src/routes/fetchNewMail');

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


// IMAP/SMTP routes
app.use('/api/imap-smtp', imapSmtpRoutes);
// Folder management routes
app.use('/api/folders', folderManagementRoutes);
// Fetch new unread mail routes
app.use('/api/fetch-new-mail', fetchNewMailRoutes);

// Import services for IDLE and WebSocket (before server starts)
const { ImapIdleManager } = require('./src/services/imapIdleService');
const { WebSocketManager } = require('./src/services/websocketManager');
const { supabaseAdmin } = require('./src/config/supabase');

// Initialize managers (will be set in server.listen)
let wsManager = null;
let idleManager = null;

// IDLE control endpoints (will use managers from closure)
app.post('/api/idle/start/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (error || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    if (!idleManager) {
      return res.status(503).json({ error: 'IDLE manager not initialized' });
    }

    await idleManager.startIdleMonitoring(account);
    res.json({
      success: true,
      message: `IDLE monitoring started for account ${account.email}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post('/api/idle/stop/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    if (!idleManager) {
      return res.status(503).json({ error: 'IDLE manager not initialized' });
    }
    await idleManager.stopIdleMonitoring(accountId);
    res.json({
      success: true,
      message: `IDLE monitoring stopped for account ${accountId}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Status endpoints
app.get('/api/status/idle', (req, res) => {
  res.json({
    success: true,
    data: idleManager ? idleManager.getStatus() : {},
  });
});

app.get('/api/status/websocket', (req, res) => {
  res.json({
    success: true,
    data: wsManager ? wsManager.getStatus() : {},
  });
});

// Other routes
app.use('/api/migrate', migrateRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Agent routes (rate limiting disabled)
// IMPORTANT: Register more specific routes BEFORE general routes
app.use('/api/agents', agentFileRoutes); // File routes must come before general agent routes
app.use('/api/agents', messagesRoutes); // Messages/chat routes
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

// Webhook for N8N to send emails (public endpoint)
app.use('/api/webhooks/send-email', webhookSendEmailRoute);

// Document extraction endpoint (used by frontend after file upload)
app.use('/extract-pdf', extractPdfRoute);

// ============================================================================
// DEBUG ENDPOINTS
// ============================================================================

// Debug endpoint: Check startup query results
app.get('/api/debug/startup-query', async (req, res) => {
  try {
    const { data: accounts, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('is_active', true);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const imapAccounts = accounts.filter(account => {
      return account.imap_host && account.imap_username && !account.needs_reconnection;
    });

    res.json({
      success: true,
      totalFound: accounts?.length || 0,
      imapAccounts: imapAccounts.length,
      accounts: accounts.map(a => ({
        id: a.id,
        email: a.email,
        is_active: a.is_active,
        provider_type: a.provider_type,
        imap_host: a.imap_host,
        imap_username: a.imap_username,
        needs_reconnection: a.needs_reconnection,
        initial_sync_completed: a.initial_sync_completed
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint: Check database state
app.get('/api/debug/database-check', async (req, res) => {
  try {
    const { data: accounts } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('is_active', true);

    const { data: emails } = await supabaseAdmin
      .from('emails')
      .select('id, email_account_id, subject, sender_email, received_at, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: syncStates } = await supabaseAdmin
      .from('email_sync_state')
      .select('*');

    res.json({
      success: true,
      accounts: {
        count: accounts?.length || 0,
        data: accounts || []
      },
      emails: {
        count: emails?.length || 0,
        latest: emails || []
      },
      syncStates: {
        count: syncStates?.length || 0,
        data: syncStates || []
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint: Force sync an account
app.post('/api/debug/force-sync/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { syncNewEmailsOnly } = require('./src/services/backgroundSyncService');
    
    console.log(`🔧 Manual sync triggered for account: ${accountId}`);
    const count = await syncNewEmailsOnly(accountId, 'INBOX');
    
    res.json({
      success: true,
      message: `Synced ${count} new emails`,
      count
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint: Clear needs_reconnection flag
app.post('/api/debug/clear-reconnection/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const { error } = await supabaseAdmin
      .from('email_accounts')
      .update({
        needs_reconnection: false,
        last_error: null,
        last_successful_sync_at: new Date().toISOString()
      })
      .eq('id', accountId);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({
      success: true,
      message: `Cleared needs_reconnection flag for account ${accountId}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint: Test IMAP connection
app.post('/api/debug/test-connection/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { testImapConnection } = require('./src/services/imapSmtpService');
    const { decryptPassword } = require('./src/utils/encryption');
    
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .single();
    
    if (accountError || !account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    const password = decryptPassword(account.imap_password);
    const result = await testImapConnection({
      username: account.imap_username,
      password: password,
      host: account.imap_host,
      port: account.imap_port || 993,
      useTls: account.use_ssl !== false
    });
    
    // If connection succeeds, clear needs_reconnection flag
    if (result.success) {
      await supabaseAdmin
        .from('email_accounts')
        .update({
          needs_reconnection: false,
          last_error: null,
          last_successful_sync_at: new Date().toISOString()
        })
        .eq('id', accountId);
    }
    
    res.json({
      success: result.success,
      message: result.success ? 'Connection test successful' : result.error,
      error: result.error,
      needs_reconnection_cleared: result.success
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

// Socket.IO authentication middleware
// Note: supabaseAdmin is already imported at line 351
io.use(async (socket, next) => {
  const userId = socket.handshake.query.userId;
  
  if (!userId) {
    console.error('[WebSocket] Connection rejected: No userId provided');
    return next(new Error('Authentication error: userId required'));
  }
  
  // ✅ FIX: Validate userId exists in database or auth_users
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
    
    if (error || !user) {
      // ✅ FIX: Check if this is an auth_users ID (Supabase auth)
      try {
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
        
        if (authError || !authUser) {
          console.error(`[WebSocket] ❌ Invalid userId: ${userId}`);
          return next(new Error('Authentication failed: Invalid userId'));
        }
        
        // Auth user exists but not in users table - this is okay
        console.log(`[WebSocket] ✅ Auth user ${userId} connected (not in users table yet)`);
      } catch (authCheckError) {
        console.error(`[WebSocket] ❌ Invalid userId: ${userId}`, authCheckError.message);
        return next(new Error('Authentication failed: Invalid userId'));
      }
    }
    
    socket.userId = userId;
    socket.join(userId); // Join room for this user
    console.log(`[WebSocket] ✅ User ${userId} authenticated and joined room`);
    next();
  } catch (error) {
    console.error('[WebSocket] Authentication error:', error);
    next(new Error('Authentication failed'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[WebSocket] User ${socket.userId} connected (socket: ${socket.id})`);
  
  // Send connection confirmation
  socket.emit('connected', { 
    userId: socket.userId, 
    timestamp: new Date().toISOString() 
  });
  
  // User joins their room (already done in middleware, but keep for compatibility)
  socket.on('join_user', (data) => {
    const requestUserId = data?.userId || socket.userId;
    console.log(`[WebSocket] User ${requestUserId} joined room`);
    socket.join(requestUserId);
  });
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WHATSAPP SOCKET.IO EVENT HANDLERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  // Subscribe to WhatsApp events for a specific agent
  socket.on('whatsapp:subscribe', async (agentId) => {
    try {
      if (!agentId) {
        socket.emit('whatsapp:error', { message: 'Agent ID required' });
        return;
      }
      
      // Verify user owns this agent
      const { data: agent, error } = await supabaseAdmin
        .from('agents')
        .select('id, agent_name, user_id')
        .eq('id', agentId)
        .maybeSingle();
      
      if (error || !agent) {
        socket.emit('whatsapp:error', { 
          message: 'Agent not found',
          agentId 
        });
        return;
      }
      
      // Security check: Only allow owner to subscribe
      if (agent.user_id !== socket.userId) {
        socket.emit('whatsapp:error', { 
          message: 'Unauthorized: You do not own this agent',
          agentId 
        });
        return;
      }
      
      // Join agent-specific room
      socket.join(`whatsapp:${agentId}`);
      console.log(`[WhatsApp WS] User ${socket.userId} subscribed to whatsapp:${agentId}`);
      
      // Send current connection status
      const { data: session } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('status, is_active, phone_number, last_heartbeat, qr_code')
        .eq('agent_id', agentId)
        .maybeSingle();
      
      socket.emit('whatsapp:status', {
        agentId,
        agentName: agent.agent_name,
        status: session?.status || 'disconnected',
        isActive: session?.is_active || false,
        phoneNumber: session?.phone_number || null,
        hasQRCode: !!session?.qr_code,
        lastHeartbeat: session?.last_heartbeat || null,
        timestamp: new Date().toISOString()
      });
      
      // If QR code exists and session not active, send QR code
      if (session?.qr_code && !session?.is_active) {
        socket.emit('whatsapp:qr', {
          agentId,
          qr: session.qr_code,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('[WhatsApp WS] Subscribe error:', error);
      socket.emit('whatsapp:error', { 
        message: 'Subscription failed',
        error: error.message 
      });
    }
  });
  
  // Unsubscribe from agent events
  socket.on('whatsapp:unsubscribe', (agentId) => {
    if (agentId) {
      socket.leave(`whatsapp:${agentId}`);
      console.log(`[WhatsApp WS] User ${socket.userId} unsubscribed from whatsapp:${agentId}`);
    }
  });
  
  // Request manual reconnection
  socket.on('whatsapp:reconnect', async (agentId) => {
    try {
      if (!agentId) {
        socket.emit('whatsapp:error', { message: 'Agent ID required' });
        return;
      }
      
      // Verify ownership
      const { data: agent, error } = await supabaseAdmin
        .from('agents')
        .select('id, user_id')
        .eq('id', agentId)
        .maybeSingle();
      
      if (error || !agent || agent.user_id !== socket.userId) {
        socket.emit('whatsapp:error', { message: 'Unauthorized' });
        return;
      }
      
      console.log(`[WhatsApp WS] Manual reconnection requested for agent ${agentId}`);
      
      const { handleSmartReconnection } = require('./src/utils/reconnectionManager');
      
      socket.emit('whatsapp:status', {
        agentId,
        status: 'reconnecting',
        message: 'Manual reconnection initiated...',
        timestamp: new Date().toISOString()
      });
      
      await handleSmartReconnection(agentId, 'manual_reconnect', 1);
      
    } catch (error) {
      console.error('[WhatsApp WS] Reconnect error:', error);
      socket.emit('whatsapp:error', { 
        message: 'Reconnection failed',
        error: error.message 
      });
    }
  });

  // Gmail socket handlers removed - using IMAP/SMTP only
  // Request initial emails handler removed
  /*
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
  */

  // Refresh emails handler removed - using IMAP/SMTP only
  /*
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
  */

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`[WebSocket] User ${socket.userId} disconnected (reason: ${reason})`);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`[WebSocket] Socket error for user ${socket.userId}:`, error);
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
  
  // Also call reconnectAllAgents as a backup (handles edge cases)
  // ⚠️ IMPORTANT: Wait long enough for initializeExistingSessions to complete
  // Each session init takes 3-10 seconds, so wait 20 seconds for multi-agent scenarios
  setTimeout(async () => {
    try {
      const { reconnectAllAgents } = require('./src/services/baileysService');
      console.log('[STARTUP] 🔄 Running reconnectAllAgents as backup...');
      await reconnectAllAgents();
      console.log('[STARTUP] ✅ Backup reconnection complete');
    } catch (error) {
      console.error('[STARTUP] ❌ Error in backup reconnection:', error);
    }
  }, 20000); // Wait 20 seconds after initializeExistingSessions starts
  
  // Start connection monitoring
  setTimeout(() => {
    try {
      const { startMonitoring } = require('./src/services/connectionMonitor');
      startMonitoring();
    } catch (error) {
      console.error('[STARTUP] ❌ Error starting connection monitor:', error);
    }
  }, 10000); // Start monitoring after 10 seconds

  // Import IMAP sync service
  const { syncAllImapAccounts } = require('./src/services/imapEmailSyncService');

  // Initialize WebSocket Manager
  wsManager = new WebSocketManager(io);
  console.log('📡 ✅ WebSocket Manager initialized');

  // Initialize IDLE Manager
  idleManager = new ImapIdleManager(wsManager);
  console.log('🔄 ✅ IDLE Manager initialized');
  
  // Start email sync cron job (runs every 5 minutes)
  const { startEmailSyncCron } = require('./src/jobs/emailSyncCron');
  startEmailSyncCron();
  
  // Update exports so other modules can access managers
  module.exports.idleManager = idleManager;
  module.exports.wsManager = wsManager;

  // Start IDLE monitoring for all active accounts
  setTimeout(async () => {
    try {
      console.log('[IDLE] 🔍 Fetching accounts for IDLE monitoring...');
      
      // ✅ SIMPLIFIED QUERY - fetch all active accounts
      const { data: accounts, error } = await supabaseAdmin
        .from('email_accounts')
        .select('*')
        .eq('is_active', true);

      if (error) {
        console.error('[IDLE] ❌ Error fetching accounts:', error.message);
        return;
      }

      console.log(`[IDLE] 📊 Found ${accounts?.length || 0} active accounts`);

      if (accounts && accounts.length > 0) {
        // Filter for IMAP accounts (more lenient than before)
        const imapAccounts = accounts.filter(account => {
          // Must have IMAP credentials
          if (!account.imap_host || !account.imap_username) {
            console.log(`[IDLE] ⏭️  Skipping ${account.email || account.id} - no IMAP credentials`);
            return false;
          }
          
          // ✅ FIX: Don't skip accounts with needs_reconnection
          // IDLE will attempt to start and clear the flag on success
          if (account.needs_reconnection) {
            console.log(`[IDLE] ⚠️  Account ${account.email || account.id} marked as needs_reconnection, but will attempt IDLE to clear flag`);
          }
          
          return true;
        });

        console.log(`[IDLE] ✅ Starting IDLE for ${imapAccounts.length} accounts`);
        
        for (const account of imapAccounts) {
          try {
            console.log(`[IDLE] 🔄 Starting IDLE for ${account.email}...`);
            await idleManager.startIdleMonitoring(account);
            console.log(`[IDLE] ✅ IDLE started for ${account.email}`);
          } catch (error) {
            console.error(`[IDLE] ❌ Failed to start IDLE for ${account.email}:`, error.message);
          }
        }
      } else {
        console.log('[IDLE] ⚠️  No active accounts found for IDLE monitoring');
      }
    } catch (error) {
      console.error('[IDLE] ❌ Error initializing IDLE monitoring:', error);
    }
  }, 5000);

  // ✅ FIX: Removed duplicate sync jobs to prevent Gmail rate limiting
  // Only keeping:
  // 1. CRON job (every 5 minutes) - backup sync
  // 2. IDLE monitoring (real-time) - primary sync method
  // 
  // REMOVED:
  // - Initial email check (setTimeout)
  // - Background sync (setInterval every 10 min)
  // - Incremental sync (setInterval every 10 min)
  // - Unread email check (setInterval every 15 min)
  
  console.log(`📧 ✅ Email sync configured:`);
  console.log(`   🔄 CRON job: Every 5 minutes (backup)`);
  console.log(`   🔄 IDLE monitoring: Real-time (primary)`);
  console.log(`   📝 New emails will be saved INSTANTLY to Supabase`);
  console.log(`   📡 New emails will be pushed to frontend via WebSocket`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📴 SIGTERM received, shutting down gracefully...');
  
  // Clear intervals
  if (process.emailCheckInterval) {
    clearInterval(process.emailCheckInterval);
  }
  if (process.newMailCheckInterval) {
    clearInterval(process.newMailCheckInterval);
  }
  
  // Stop all IDLE monitoring
  if (idleManager) {
    for (const [accountId] of idleManager.activeConnections) {
      await idleManager.stopIdleMonitoring(accountId);
    }
  }
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('📴 SIGINT received, shutting down gracefully...');
  
  // Clear intervals (removed duplicate sync intervals)
  // Only CRON and IDLE remain active
  
  // Stop all IDLE monitoring
  if (idleManager) {
    for (const [accountId] of idleManager.activeConnections) {
      await idleManager.stopIdleMonitoring(accountId);
    }
  }
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Export both app and rate limiters
module.exports = app;
module.exports.idleManager = idleManager;
module.exports.wsManager = wsManager;
module.exports.rateLimiters = {
  whatsappInitLimiter,
  messageSendLimiter
};
