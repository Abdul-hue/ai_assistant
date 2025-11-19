require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

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
// RATE LIMITING (SECURITY: Prevent brute force and DDoS attacks)
// ============================================================================

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    console.warn(`⚠️ Rate limit exceeded for IP: ${req.ip} on ${req.path}`);
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please slow down and try again later',
      retryAfter: Math.ceil(15 * 60) // seconds
    });
  }
});

// Strict rate limiter for authentication endpoints (SECURITY: Prevent brute force attacks)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  skipSuccessfulRequests: true, // Don't count successful requests
  message: 'Too many authentication attempts, please try again after 15 minutes',
  handler: (req, res) => {
    console.error(`🚨 SECURITY: Auth brute force attempt from IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Account temporarily locked. Please try again after 15 minutes',
      retryAfter: Math.ceil(15 * 60)
    });
  }
});

// Session creation rate limiter (SECURITY: Prevent abuse while allowing OAuth callbacks)
// 🔧 FIX: More lenient in development to handle React Strict Mode and OAuth quirks
const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 10 : 100, // 100 in dev, 10 in prod
  message: {
    error: 'Too many session requests',
    message: 'Please wait before trying again',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  // 🔧 FIX: Skip rate limiting if valid cookie already exists
  skip: async (req) => {
    const token = req.cookies?.sb_access_token;
    if (!token) {
      return false;
    }

    // Verify token is actually valid (not just present)
    try {
      const { supabaseAdmin } = require('./src/config/supabase');
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      
      if (!error && user) {
        console.log('⏭️  Skipping rate limit (valid session already exists for:', user.email + ')');
        return true; // Skip rate limit
      }
    } catch (err) {
      console.error('Error validating token for rate limit skip:', err.message);
    }
    
    return false;
  },
  handler: (req, res) => {
    console.error(`🚨 SECURITY: Session rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many session requests',
      message: 'Please wait a moment before trying again',
      retryAfter: Math.ceil(15 * 60)
    });
  }
});

// WhatsApp initialization rate limiter (SECURITY: Prevent abuse of WhatsApp sessions)
const whatsappInitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit to 10 WhatsApp initialization attempts per 5 minutes
  message: 'Too many WhatsApp connection attempts, please try again later',
  handler: (req, res) => {
    console.warn(`⚠️ WhatsApp init rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many connection attempts',
      message: 'Please wait before trying to connect again',
      retryAfter: Math.ceil(5 * 60)
    });
  }
});

console.log('✅ Rate limiting configured');

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

// Apply general rate limiting to all API routes
app.use('/api/', apiLimiter);

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
// API ROUTES (with specific rate limiters)
// ============================================================================

// Auth routes with rate limiting (SECURITY: Prevent brute force)
app.use('/api/auth/session', sessionLimiter); // More lenient for OAuth callbacks
app.use('/api/auth', authRoutes);

// Other routes
app.use('/api/migrate', migrateRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Agent routes with WhatsApp-specific rate limiting
app.use('/api/agents/:agentId/init-whatsapp', whatsappInitLimiter);
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
const server = app.listen(PORT, '0.0.0.0', async () => {
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

module.exports = app;
exports = app;
