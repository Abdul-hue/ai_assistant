const { 
  default: makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState, 
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino'); // For Baileys internal logging only
const promClient = require('prom-client');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const crypto = require('crypto');
const pLimit = require('p-limit');
const LRU = require('lru-cache');
const redisCache = require('./redisCache');
const instanceManager = require('./instanceManager');
const sessionCache = require('./sessionCache');
const EventEmitter = require('events');
const { initializeMetrics, OperationTracker } = require('../middleware/performanceTracking');
const PerformanceReporter = require('./performanceReporting');
const { ErrorTracker, ERROR_CATEGORIES, ERROR_SEVERITY, errorRateCounter, errorPatternGauge } = require('./errorTracking');
const { AlertingService, ALERT_TYPES } = require('./alerting');
const { supabaseAdmin } = require('../config/supabase');
const axios = require('axios');
const lockfile = require('proper-lockfile');
const https = require('https');
const {
  syncContactsForAgent,
  setupContactUpdateListeners,
} = require('./contactSyncService');

const STORAGE_BUCKET = 'agent-files';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const DEFAULT_AUDIO_BUCKET = 'agent-audio-messages';
const FALLBACK_AUDIO_BUCKET = process.env.AUDIO_FALLBACK_BUCKET || 'agent-files';
let audioBucketName = process.env.AUDIO_BUCKET || DEFAULT_AUDIO_BUCKET;
const DEFAULT_AUDIO_SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days
let audioBucketChecked = false;
const QR_EXPIRY_MS = 3 * 60 * 1000; // 3 minutes - WhatsApp QR code validity
const QR_EXPIRATION_MS = 180 * 1000; // 180 seconds (3 minutes) - QR expiration for cleanup
const MAX_QR_PENDING_MS = 5 * 60 * 1000; // 5 minutes - Max time in qr_pending before reset

// SECURITY: Generate unique instance ID for multi-instance prevention
const os = require('os');
const INSTANCE_ID = `${os.hostname()}-${process.pid}-${Date.now()}`;
const INSTANCE_HOSTNAME = os.hostname();
const INSTANCE_PID = process.pid;

// Log instance information on startup
console.log('\n[BAILEYS] ========== INSTANCE INFORMATION ==========');
console.log(`[BAILEYS] Instance ID: ${INSTANCE_ID}`);
console.log(`[BAILEYS] Hostname: ${INSTANCE_HOSTNAME}`);
console.log(`[BAILEYS] Process ID: ${INSTANCE_PID}`);
console.log(`[BAILEYS] Started at: ${new Date().toISOString()}`);
console.log('[BAILEYS] ===============================================\n');

// Store active sessions in memory
const activeSessions = new Map();
const qrGenerationTracker = new Map();
const connectionLocks = new Map(); // agentId -> boolean
const lastConnectionAttempt = new Map(); // agentId -> timestamp ms
const last401Failure = new Map(); // agentId -> timestamp ms (prevents auto-retry after 401)
// ============================================
// CACHE MANAGEMENT
// Added: 2025-01-15 - Phase 2 Memory Optimization
// ============================================

// Cache statistics tracking (defined first for use in dispose callbacks)
const cacheStats = {
  validation: { hits: 0, misses: 0, evictions: 0 },
  lidToPhone: { hits: 0, misses: 0, evictions: 0 },
  session: { hits: 0, misses: 0, evictions: 0 }
};

// Helper to record eviction metrics (defined as function for hoisting)
function recordEvictionMetric(cacheType) {
  // Check if metrics are available (may not be initialized yet)
  if (typeof recordMetric === 'function' && cacheMetrics?.evictions) {
    recordMetric(() => {
      cacheMetrics.evictions.labels(cacheType).inc();
    });
  }
}

// LRU cache configuration
const CACHE_CONFIG = {
  validation: {
    max: 1000,          // Max 1000 entries
    ttl: 5 * 60 * 1000, // 5 minutes (v7 uses ttl)
    updateAgeOnGet: true,
    // dispose callback for tracking evictions (v7 API)
    dispose: (key, value) => {
      cacheStats.validation.evictions++;
      recordEvictionMetric('validation');
    }
  },
  lidToPhone: {
    max: 5000,          // Max 5000 phone number mappings
    ttl: 15 * 60 * 1000, // 15 minutes (v7 uses ttl)
    updateAgeOnGet: true,
    // dispose callback for tracking evictions (v7 API)
    dispose: (key, value) => {
      cacheStats.lidToPhone.evictions++;
      recordEvictionMetric('lidToPhone');
    }
  },
  session: {
    max: 500,           // Max 500 session credentials
    ttl: 5 * 60 * 1000, // 5 minutes (v7 uses ttl)
    updateAgeOnGet: true,
    // dispose callback for tracking evictions (v7 API)
    dispose: (key, value) => {
      cacheStats.session.evictions++;
      recordEvictionMetric('session');
    }
  }
};

// Create LRU caches with size limits
const validationCache = new LRU(CACHE_CONFIG.validation);
const lidToPhoneCache = new LRU(CACHE_CONFIG.lidToPhone);
const SESSION_CACHE = new LRU(CACHE_CONFIG.session); // For credential caching

// Legacy TTL constant (kept for backward compatibility if needed)
const VALIDATION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
// Rate limiter per agent
const validationRateLimiters = new Map(); // agentId -> {count, resetAt}
const VALIDATION_RATE_LIMIT = 15; // Max 15 validations per minute per agent
const VALIDATION_RATE_WINDOW = 60 * 1000; // 1 minute
const COOLDOWN_MS = 5000; // 5 seconds between connection attempts
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes after 401 errors before allowing retry
const MESSAGE_FORWARD_TIMEOUT_MS = 10000;
const DEFAULT_MESSAGE_WEBHOOK_TEST = 'https://auto.nsolbpo.com/webhook-test/a18ff948-9380-4abe-a8d8-0912dae2d8ab';
const DEFAULT_MESSAGE_WEBHOOK_PROD = 'https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab';

// ============================================
// CREDENTIALS ENCRYPTION
// Added: 2025-01-15 - Phase 1 Security
// ============================================

const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-gcm',
  keyLength: 32,
  ivLength: 16,
  key: process.env.CREDENTIALS_ENCRYPTION_KEY
};

// Validate encryption key exists
if (!ENCRYPTION_CONFIG.key) {
  console.error('[SECURITY] ❌ CREDENTIALS_ENCRYPTION_KEY not set in environment!');
  console.error('[SECURITY] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  throw new Error('Missing CREDENTIALS_ENCRYPTION_KEY environment variable');
}

// Validate key length
if (ENCRYPTION_CONFIG.key.length !== 64) { // 32 bytes = 64 hex characters
  throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
}

// ============================================
// PARALLEL PROCESSING CONFIGURATION
// Added: 2025-01-15 - Phase 2 Performance
// ============================================

const CONCURRENCY_CONFIG = {
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT_CONNECTIONS) || 10,
  connectionDelay: 500, // ms stagger between connection starts
  batchSize: 100        // for database operations
};

// ============================================
// PROMETHEUS METRICS CONFIGURATION
// Added: 2025-01-15 - Phase 3 Metrics Collection
// ============================================

const METRICS_CONFIG = {
  enabled: process.env.PROMETHEUS_METRICS_ENABLED !== 'false', // Default: true
  prefix: 'pa_agent_',
  defaultLabels: { instance: INSTANCE_HOSTNAME },
  collectInterval: 5000 // 5 seconds
};

// Initialize Prometheus registry and default metrics
let metricsRegistry = null;

try {
  if (METRICS_CONFIG.enabled) {
    metricsRegistry = new promClient.Registry();
    
    // Configure default metrics collection
    promClient.collectDefaultMetrics({
      register: metricsRegistry,
      prefix: METRICS_CONFIG.prefix,
      labels: METRICS_CONFIG.defaultLabels,
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5]
    });
    
    // Initialize performance tracking metrics with this registry
    initializeMetrics(metricsRegistry);
    
    // Register error tracking metrics
    if (errorRateCounter && errorPatternGauge) {
      metricsRegistry.registerMetric(errorRateCounter);
      metricsRegistry.registerMetric(errorPatternGauge);
    }
  }
} catch (error) {
  // Graceful degradation: continue without metrics if initialization fails
  console.warn('[METRICS] Prometheus metrics initialization failed:', error.message);
  metricsRegistry = null;
}

// ============================================
// CUSTOM PROMETHEUS METRICS
// Added: 2025-01-15 - Phase 3 Metrics Collection
// ============================================

// Connection Metrics
const connectionMetrics = metricsRegistry ? {
  total: new promClient.Counter({
    name: `${METRICS_CONFIG.prefix}connections_total`,
    help: 'Total connection attempts',
    labelNames: ['agent_id', 'user_id', 'result'],
    registers: [metricsRegistry]
  }),
  active: new promClient.Gauge({
    name: `${METRICS_CONFIG.prefix}connections_active`,
    help: 'Currently active connections',
    registers: [metricsRegistry]
  }),
  duration: new promClient.Histogram({
    name: `${METRICS_CONFIG.prefix}connection_duration_seconds`,
    help: 'Connection establishment duration',
    labelNames: ['agent_id'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [metricsRegistry]
  }),
  failures: new promClient.Counter({
    name: `${METRICS_CONFIG.prefix}connection_failures_total`,
    help: 'Failed connection attempts',
    labelNames: ['agent_id', 'reason', 'retryable'],
    registers: [metricsRegistry]
  })
} : null;

// Message Metrics
const messageMetrics = metricsRegistry ? {
  received: new promClient.Counter({
    name: `${METRICS_CONFIG.prefix}messages_received_total`,
    help: 'Total messages received',
    labelNames: ['agent_id', 'message_type'],
    registers: [metricsRegistry]
  }),
  sent: new promClient.Counter({
    name: `${METRICS_CONFIG.prefix}messages_sent_total`,
    help: 'Total messages sent',
    labelNames: ['agent_id', 'message_type'],
    registers: [metricsRegistry]
  }),
  processingDuration: new promClient.Histogram({
    name: `${METRICS_CONFIG.prefix}message_processing_duration_seconds`,
    help: 'Message processing duration',
    labelNames: ['agent_id', 'operation'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metricsRegistry]
  }),
  batchSize: new promClient.Histogram({
    name: `${METRICS_CONFIG.prefix}message_batch_size`,
    help: 'Message batch sizes',
    buckets: [1, 5, 10, 25, 50, 100, 250],
    registers: [metricsRegistry]
  })
} : null;

// Cache Metrics
const cacheMetrics = metricsRegistry ? {
  hits: new promClient.Counter({
    name: `${METRICS_CONFIG.prefix}cache_hits_total`,
    help: 'Cache hits',
    labelNames: ['cache_type'],
    registers: [metricsRegistry]
  }),
  misses: new promClient.Counter({
    name: `${METRICS_CONFIG.prefix}cache_misses_total`,
    help: 'Cache misses',
    labelNames: ['cache_type'],
    registers: [metricsRegistry]
  }),
  size: new promClient.Gauge({
    name: `${METRICS_CONFIG.prefix}cache_size`,
    help: 'Current cache size',
    labelNames: ['cache_type'],
    registers: [metricsRegistry]
  }),
  evictions: new promClient.Counter({
    name: `${METRICS_CONFIG.prefix}cache_evictions_total`,
    help: 'Cache evictions',
    labelNames: ['cache_type'],
    registers: [metricsRegistry]
  })
} : null;

// Database Metrics
const databaseMetrics = metricsRegistry ? {
  queryDuration: new promClient.Histogram({
    name: `${METRICS_CONFIG.prefix}db_query_duration_seconds`,
    help: 'Database query duration',
    labelNames: ['operation', 'table'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
    registers: [metricsRegistry]
  }),
  queryTotal: new promClient.Counter({
    name: `${METRICS_CONFIG.prefix}db_queries_total`,
    help: 'Total database queries',
    labelNames: ['operation', 'table', 'result'],
    registers: [metricsRegistry]
  })
} : null;

// Error Metrics
const errorMetrics = metricsRegistry ? {
  total: new promClient.Counter({
    name: `${METRICS_CONFIG.prefix}errors_total`,
    help: 'Total errors',
    labelNames: ['type', 'severity', 'component'],
    registers: [metricsRegistry]
  })
} : null;

// Helper function to safely record metrics
function recordMetric(metricFn, ...args) {
  if (!METRICS_CONFIG.enabled || !metricsRegistry) return;
  try {
    metricFn(...args);
  } catch (error) {
    loggers.perf.error({ error: error.message }, 'Failed to record metric');
  }
}

// Create concurrency limiter for connections
const connectionLimit = pLimit(CONCURRENCY_CONFIG.maxConcurrent);

// ============================================
// STRUCTURED LOGGING
// Updated: 2025-01-15 - Phase 3: Use shared logger
// ============================================

const logger = require('./logger');

// Create child loggers for different components
const loggers = {
  connection: logger.child({ component: 'connection', service: 'baileys' }),
  reconnect: logger.child({ component: 'reconnect', service: 'baileys' }),
  qr: logger.child({ component: 'qr', service: 'baileys' }),
  security: logger.child({ component: 'security', service: 'baileys' }),
  health: logger.child({ component: 'health', service: 'baileys' }),
  database: logger.child({ component: 'database', service: 'baileys' }),
  perf: logger.child({ component: 'performance', service: 'baileys' }),
  messages: logger.child({ component: 'messages', service: 'baileys' }),
  cache: logger.child({ component: 'cache', service: 'baileys' })
};

// Helper to get short agent ID
const shortId = (agentId) => agentId ? agentId.substring(0, 8) : 'unknown';

// Initialize performance reporter
const performanceReporter = new PerformanceReporter(loggers.perf);

// Initialize error tracker
const errorTracker = new ErrorTracker(loggers.perf);

// Initialize alerting service
const alertingService = new AlertingService(loggers.perf);

/**
 * Track function execution time
 * @param {Function} fn - Async function to track
 * @param {string} operation - Operation name
 * @param {Object} context - Additional context
 * @returns {Promise} Function result
 */
async function trackPerformance(fn, operation, context = {}) {
  const startTime = Date.now();
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    
    loggers.perf.info({
      operation,
      durationMs: duration,
      ...context
    }, `${operation} completed`);
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    loggers.perf.error({
      operation,
      durationMs: duration,
      error: error.message,
      stack: error.stack,
      ...context
    }, `${operation} failed`);
    
    throw error;
  }
}

// Log configuration on startup
logger.info({
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv: process.env.NODE_ENV || 'development',
  components: Object.keys(loggers)
}, 'Logging configured');

loggers.perf.info({ maxConcurrent: CONCURRENCY_CONFIG.maxConcurrent }, 'Parallel processing enabled');

// Log cache statistics periodically
setInterval(() => {
  const stats = {
    validation: {
      size: validationCache.size,
      hits: cacheStats.validation.hits,
      misses: cacheStats.validation.misses,
      hitRate: cacheStats.validation.hits + cacheStats.validation.misses > 0
        ? parseFloat((cacheStats.validation.hits / (cacheStats.validation.hits + cacheStats.validation.misses) * 100).toFixed(1))
        : 0
    },
    lidToPhone: {
      size: lidToPhoneCache.size,
      hits: cacheStats.lidToPhone.hits,
      misses: cacheStats.lidToPhone.misses,
      hitRate: cacheStats.lidToPhone.hits + cacheStats.lidToPhone.misses > 0
        ? parseFloat((cacheStats.lidToPhone.hits / (cacheStats.lidToPhone.hits + cacheStats.lidToPhone.misses) * 100).toFixed(1))
        : 0
    },
    session: {
      size: SESSION_CACHE.size,
      hits: cacheStats.session.hits,
      misses: cacheStats.session.misses,
      hitRate: cacheStats.session.hits + cacheStats.session.misses > 0
        ? parseFloat((cacheStats.session.hits / (cacheStats.session.hits + cacheStats.session.misses) * 100).toFixed(1))
        : 0
    }
  };
  
  logger.info({ caches: stats }, 'Cache statistics');
}, 5 * 60 * 1000); // Every 5 minutes

// ============================================
// RECONNECTION SYSTEM
// Added: 2025-01-15 - Phase 1 Optimization
// ============================================

// Track reconnection attempts and state
const RECONNECTION_ATTEMPTS = new Map();  // agentId -> number of attempts
const RECONNECTION_DELAYS = new Map();    // agentId -> current delay in ms
const RECONNECTION_TIMERS = new Map();    // agentId -> setTimeout ID
const QR_EXPIRATION_TIMERS = new Map();   // agentId -> setTimeout ID for QR cleanup

// Configuration from environment
const RECONNECTION_CONFIG = {
  maxAttempts: parseInt(process.env.RECONNECTION_MAX_ATTEMPTS) || 10,
  baseDelay: parseInt(process.env.RECONNECTION_BASE_DELAY_MS) || 2000,
  maxDelay: 60000, // 60 seconds maximum
  nonRetryableCodes: [440, 401, 403, 428] // Stream conflict, auth errors
};

const agentEventEmitter = new EventEmitter();
agentEventEmitter.setMaxListeners(100); // Reasonable limit per agent

// Track event listeners per agent for cleanup
const agentListeners = new Map(); // agentId -> Set<eventName>

/**
 * Track event listener registration
 * Phase 3C.3 - Memory leak prevention
 */
function trackListener(agentId, eventName) {
  if (!agentListeners.has(agentId)) {
    agentListeners.set(agentId, new Set());
  }
  agentListeners.get(agentId).add(eventName);
  
  loggers.perf.debug({ 
    agentId: shortId(agentId), 
    eventName,
    totalListeners: agentListeners.get(agentId).size
  }, 'Event listener tracked');
}

/**
 * Remove all tracked listeners for an agent
 * Phase 3C.3 - Memory leak prevention
 */
function removeTrackedListeners(agentId) {
  const listeners = agentListeners.get(agentId);
  
  if (!listeners || listeners.size === 0) {
    return;
  }
  
  loggers.perf.info({ 
    agentId: shortId(agentId), 
    listenerCount: listeners.size 
  }, 'Removing event listeners');
  
  // Remove all listeners for this agent
  for (const eventName of listeners) {
    const fullEventName = `${agentId}:${eventName}`;
    agentEventEmitter.removeAllListeners(fullEventName);
    
    loggers.perf.debug({ 
      agentId: shortId(agentId), 
      eventName 
    }, 'Event listener removed');
  }
  
  // Clear tracking
  agentListeners.delete(agentId);
  
  loggers.perf.info({ 
    agentId: shortId(agentId) 
  }, 'All event listeners removed');
}

/**
 * Get event listener statistics
 * Phase 3C.3 - Memory leak prevention
 */
function getEventListenerStats() {
  const stats = {};
  let totalListeners = 0;
  
  for (const [agentId, listeners] of agentListeners.entries()) {
    stats[shortId(agentId)] = listeners.size;
    totalListeners += listeners.size;
  }
  
  return {
    totalAgents: agentListeners.size,
    totalListeners,
    averagePerAgent: agentListeners.size > 0 
      ? (totalListeners / agentListeners.size).toFixed(2)
      : 0,
    agentBreakdown: stats
  };
}

/**
 * Message batch queue system
 * Phase 3C.4 - Message processing optimization
 * Queues messages for batch insertion to reduce database load
 */
const MESSAGE_BATCH_SIZE = 100;
const MESSAGE_BATCH_TIMEOUT = 1000; // 1 second
const messageBatchQueue = new Map(); // agentId -> messages[]
const batchFlushTimers = new Map();  // agentId -> timer

/**
 * Queue a message for batch insertion
 */
function queueMessageForBatch(agentId, message) {
  try {
    // Initialize queue for agent if needed
    if (!messageBatchQueue.has(agentId)) {
      messageBatchQueue.set(agentId, []);
    }
    
    const queue = messageBatchQueue.get(agentId);
    queue.push(message);
    
    loggers.messages.debug({
      agentId: shortId(agentId),
      queueSize: queue.length,
      batchSize: MESSAGE_BATCH_SIZE
    }, 'Message queued for batch');
    
    // Clear existing timer
    if (batchFlushTimers.has(agentId)) {
      clearTimeout(batchFlushTimers.get(agentId));
    }
    
    // Flush immediately if batch size reached
    if (queue.length >= MESSAGE_BATCH_SIZE) {
      loggers.messages.info({
        agentId: shortId(agentId),
        queueSize: queue.length
      }, 'Batch size reached, flushing immediately');
      
      flushMessageBatch(agentId);
      return;
    }
    
    // Otherwise, schedule flush after timeout
    const timer = setTimeout(() => {
      loggers.messages.debug({
        agentId: shortId(agentId),
        queueSize: queue.length
      }, 'Batch timeout reached, flushing');
      
      flushMessageBatch(agentId);
    }, MESSAGE_BATCH_TIMEOUT);
    
    batchFlushTimers.set(agentId, timer);
    
  } catch (error) {
    loggers.messages.error({
      agentId: shortId(agentId),
      error: error.message
    }, 'Error queuing message');
    
    // Try to insert immediately as fallback
    insertMessageImmediately(message);
  }
}

/**
 * Flush message batch for an agent
 */
async function flushMessageBatch(agentId) {
  const messageTracker = new OperationTracker('message_batch_process', loggers.messages, 2000);
  try {
    const queue = messageBatchQueue.get(agentId);
    
    if (!queue || queue.length === 0) {
      messageTracker.end({ messageCount: 0 });
      return;
    }
    
    // Clear timer
    if (batchFlushTimers.has(agentId)) {
      clearTimeout(batchFlushTimers.get(agentId));
      batchFlushTimers.delete(agentId);
    }
    
    // Get and clear queue
    const messages = [...queue];
    messageBatchQueue.set(agentId, []);
    
    loggers.messages.info({
      agentId: shortId(agentId),
      messageCount: messages.length
    }, 'Flushing message batch');
    
    const startTime = Date.now();
    
    // Use existing batchInsert function
    const result = await batchInsert('message_log', messages, MESSAGE_BATCH_SIZE);
    
    const duration = Date.now() - startTime;
    
    loggers.messages.info({
      agentId: shortId(agentId),
      inserted: result.inserted,
      failed: result.failed,
      duration,
      throughput: `${(messages.length / (duration / 1000)).toFixed(2)} msg/s`
    }, 'Message batch flushed');
    
  } catch (error) {
    loggers.messages.error({
      agentId: shortId(agentId),
      error: error.message
    }, 'Error flushing message batch');
    
    // Track error
    errorTracker.trackError(error, {
      agentId: shortId(agentId),
      operation: 'message_processing'
    });
    
    messageTracker.end({ messageCount: 0, error: error.message });
    
    // Try individual inserts as fallback
    const queue = messageBatchQueue.get(agentId);
    if (queue && queue.length > 0) {
      for (const message of queue) {
        await insertMessageImmediately(message);
      }
      messageBatchQueue.set(agentId, []);
    }
  }
}

/**
 * Flush all pending message batches
 */
async function flushAllMessageBatches() {
  loggers.messages.info({
    agentCount: messageBatchQueue.size
  }, 'Flushing all message batches');
  
  const flushPromises = [];
  
  for (const agentId of messageBatchQueue.keys()) {
    flushPromises.push(flushMessageBatch(agentId));
  }
  
  await Promise.allSettled(flushPromises);
  
  loggers.messages.info('All message batches flushed');
}

/**
 * Insert message immediately (fallback)
 */
async function insertMessageImmediately(message) {
  try {
    const { error } = await supabaseAdmin
      .from('message_log')
      .insert(message);
    
    if (error) throw error;
    
    loggers.messages.debug({
      messageId: message.id
    }, 'Message inserted immediately');
    
  } catch (error) {
    loggers.messages.error({
      messageId: message.id,
      error: error.message
    }, 'Failed to insert message');
  }
}

function emitAgentEvent(agentId, type, payload = {}) {
  agentEventEmitter.emit(`agent:${agentId}`, {
    type,
    payload,
    agentId,
    timestamp: new Date().toISOString()
  });
}

/**
 * Get user ID by agent ID (with caching)
 * @param {string} agentId - Agent UUID
 * @returns {Promise<string|null>} User ID or null
 */
async function getUserIdByAgentId(agentId) {
  try {
    // Check cache first
    const cachedUserId = await sessionCache.getCachedUserId(agentId);
    if (cachedUserId) {
      loggers.database.debug({ 
        agentId: shortId(agentId),
        source: 'cache'
      }, 'User ID from cache');
      return cachedUserId;
    }
    
    // Fetch from database
    const { data, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('user_id')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (error) throw error;
    if (!data) return null;
    
    // Cache for future use
    await sessionCache.setCachedUserId(agentId, data.user_id)
      .catch(cacheError => loggers.cache.warn({ error: cacheError.message }, 'Failed to cache user ID'));
    
    loggers.database.debug({ 
      agentId: shortId(agentId),
      source: 'database',
      cached: true
    }, 'User ID from database and cached');
    
    return data.user_id;
    
  } catch (error) {
    loggers.database.error({ 
      agentId: shortId(agentId),
      error: error.message
    }, 'Error fetching user ID');
    return null;
  }
}

function subscribeToAgentEvents(agentId, listener) {
  const key = `agent:${agentId}`;
  agentEventEmitter.on(key, listener);
  trackListener(agentId, 'agent');
  return () => agentEventEmitter.off(key, listener);
}

/**
 * Encrypt credentials using AES-256-GCM
 * @param {Object} creds - Credentials object to encrypt
 * @returns {Object} Encrypted data with iv and authTag
 */
function encryptCredentials(creds) {
  try {
    const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength);
    const cipher = crypto.createCipheriv(
      ENCRYPTION_CONFIG.algorithm,
      Buffer.from(ENCRYPTION_CONFIG.key, 'hex'),
      iv
    );
    
    let encrypted = cipher.update(JSON.stringify(creds), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      version: 1 // For future key rotation
    };
  } catch (error) {
    loggers.security.error({
      error: error.message,
      stack: error.stack
    }, 'Error encrypting credentials');
    throw new Error('Credential encryption failed');
  }
}

/**
 * Decrypt credentials using AES-256-GCM
 * @param {Object} encryptedData - Encrypted data with iv and authTag
 * @returns {Object} Decrypted credentials object
 */
function decryptCredentials(encryptedData) {
  try {
    // Check if data is already decrypted (backward compatibility)
    if (!encryptedData.encrypted || !encryptedData.iv || !encryptedData.authTag) {
      loggers.security.warn({}, 'Credentials not encrypted, returning as-is (legacy data)');
      return encryptedData;
    }
    
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_CONFIG.algorithm,
      Buffer.from(ENCRYPTION_CONFIG.key, 'hex'),
      Buffer.from(encryptedData.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    loggers.security.error({
      error: error.message,
      stack: error.stack
    }, 'Error decrypting credentials');
    throw new Error('Credential decryption failed');
  }
}

function getInboundMessageWebhook() {
  const explicit = process.env.WHATSAPP_MESSAGE_WEBHOOK;
  if (explicit) {
    return explicit;
  }

  const prodSpecific = process.env.WHATSAPP_MESSAGE_WEBHOOK_PROD;
  const testSpecific = process.env.WHATSAPP_MESSAGE_WEBHOOK_TEST;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    return prodSpecific || testSpecific || DEFAULT_MESSAGE_WEBHOOK_PROD;
  }

  return testSpecific || prodSpecific || DEFAULT_MESSAGE_WEBHOOK_TEST;
}

/**
 * Check if an incoming WhatsApp message is a duplicate of a recent dashboard message
 * This prevents webhook spam when dashboard messages echo back via WhatsApp
 * @param {Object} params - Message parameters
 * @param {string} params.content - Message text content
 * @param {string} params.fromNumber - Sender phone number (sanitized)
 * @param {string} params.timestamp - Message timestamp (ISO string)
 * @param {number} params.timeWindow - Time window in ms (default 5000ms = 5s)
 * @param {string} params.agentId - Agent ID for filtering
 * @returns {Promise<boolean>} - True if duplicate found
 */
async function checkIfRecentDashboardMessage({ content, fromNumber, timestamp, timeWindow = 5000, agentId }) {
  if (!content || !fromNumber || !timestamp || !agentId) {
    return false; // Missing required params, allow webhook (fail open)
  }

  try {
    const timestampDate = new Date(timestamp);
    const windowStart = new Date(timestampDate.getTime() - timeWindow);
    const windowEnd = new Date(timestampDate.getTime() + timeWindow);
    
    // Query database for matching dashboard message within time window
    // The index on (source, sender_phone, received_at) will be used first,
    // then we filter by message_text in the WHERE clause
    const { data: recentMessage, error } = await supabaseAdmin
      .from('message_log')
      .select('id, message_text, received_at, source')
      .eq('agent_id', agentId)
      .eq('source', 'dashboard')
      .eq('sender_phone', fromNumber)
      .gte('received_at', windowStart.toISOString())
      .lte('received_at', windowEnd.toISOString())
      .eq('message_text', content.trim()) // Filter by content after index lookup
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      console.error('[BAILEYS][DUPLICATE-CHECK] Error checking for duplicate message:', error.message);
      return false; // On error, allow webhook to be sent (fail open)
    }
    
    if (recentMessage) {
      console.log(`[BAILEYS][DUPLICATE-CHECK] ✅ Duplicate detected: WhatsApp echo of dashboard message ${recentMessage.id}`);
      console.log(`[BAILEYS][DUPLICATE-CHECK] Dashboard message: ${recentMessage.received_at}, WhatsApp echo: ${timestamp}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('[BAILEYS][DUPLICATE-CHECK] Exception in checkIfRecentDashboardMessage:', error.message);
    return false; // On exception, allow webhook to be sent (fail open)
  }
}

/**
 * Batch insert records into database
 * @param {string} table - Table name
 * @param {Array} records - Array of records to insert
 * @param {number} batchSize - Batch size (default from config)
 * @returns {Promise<Object>} Result with success count
 */
async function batchInsert(table, records, batchSize = CONCURRENCY_CONFIG.batchSize) {
  const tracker = new OperationTracker('batch_insert', loggers.database, 1000);
  if (!records || records.length === 0) {
    tracker.end({ table, records: 0, batches: 0, inserted: 0, failed: 0 });
    return { success: true, inserted: 0 };
  }

  loggers.database.info({
    table,
    totalRecords: records.length,
    batchSize
  }, 'Starting batch insert');
  
  // Record batch size metric (for message batches)
  if (table === 'message_log' && messageMetrics?.batchSize) {
    recordMetric(() => {
      messageMetrics.batchSize.observe(records.length);
    });
  }
  
  const startTime = Date.now();
  let totalInserted = 0;
  const errors = [];
  
  // Track query duration
  const queryTimer = databaseMetrics?.queryDuration
    ? databaseMetrics.queryDuration.startTimer({ operation: 'insert', table })
    : null;

  try {
    // Process in batches
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(records.length / batchSize);
      
      try {
        const { data, error } = await supabaseAdmin
          .from(table)
          .insert(batch);
        
        if (error) {
          loggers.database.error({
            table,
            batch: batchNum,
            totalBatches,
            error: error.message
          }, 'Batch insert failed');
          errors.push({ batch: batchNum, error: error.message, records: batch.length });
          
          // Record failed query
          recordMetric(() => {
            if (databaseMetrics?.queryTotal) {
              databaseMetrics.queryTotal.labels('insert', table, 'error').inc();
            }
          });
        } else {
          totalInserted += batch.length;
          
          // Record successful query
          recordMetric(() => {
            if (databaseMetrics?.queryTotal) {
              databaseMetrics.queryTotal.labels('insert', table, 'success').inc();
            }
          });
          
          loggers.database.debug({
            table,
            batch: batchNum,
            totalBatches,
            inserted: batch.length
          }, 'Batch inserted');
        }
      } catch (batchError) {
        loggers.database.error({
          table,
          batch: batchNum,
          totalBatches,
          error: batchError.message,
          stack: batchError.stack
        }, 'Batch insert exception');
        errors.push({ batch: batchNum, error: batchError.message, records: batch.length });
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const successRate = ((totalInserted / records.length) * 100).toFixed(1);
    
    // Stop query timer
    if (queryTimer) {
      queryTimer();
    }
    
    loggers.database.info({
      table,
      inserted: totalInserted,
      total: records.length,
      successRate: parseFloat(successRate),
      durationSeconds: parseFloat(duration),
      ratePerSecond: parseFloat((totalInserted / parseFloat(duration)).toFixed(0)),
      errors: errors.length
    }, 'Batch insert complete');

    const result = {
      success: errors.length === 0,
      inserted: totalInserted,
      failed: records.length - totalInserted,
      duration: parseFloat(duration),
      errors
    };
    
    tracker.end({ 
      table,
      records: records.length, 
      batches: Math.ceil(records.length / batchSize),
      inserted: totalInserted,
      failed: records.length - totalInserted
    });
    
    return result;
    
  } catch (error) {
    tracker.end({ 
      table,
      records: records.length,
      inserted: totalInserted,
      failed: records.length - totalInserted,
      error: error.message
    });
    // Stop query timer on error
    if (queryTimer) {
      queryTimer();
    }
    
    loggers.database.error({
      table,
      error: error.message,
      stack: error.stack,
      inserted: totalInserted
    }, 'Fatal error in batch insert');
    return {
      success: false,
      inserted: totalInserted,
      error: error.message
    };
  }
}

/**
 * Batch update records in database
 * @param {string} table - Table name  
 * @param {Array} updates - Array of {filter, data} objects
 * @param {number} batchSize - Batch size
 * @returns {Promise<Object>} Result with success count
 */
async function batchUpdate(table, updates, batchSize = CONCURRENCY_CONFIG.batchSize) {
  const tracker = new OperationTracker('batch_update', loggers.database, 2000);
  if (!updates || updates.length === 0) {
    tracker.end({ table, records: 0, updated: 0, failed: 0 });
    return { success: true, updated: 0 };
  }

  loggers.database.info({
    table,
    totalUpdates: updates.length
  }, 'Starting batch update');
  
  const startTime = Date.now();
  let totalUpdated = 0;
  const errors = [];

  try {
    // Process updates in parallel with concurrency limit
    const updateLimit = pLimit(10); // Limit concurrent updates
    
    const results = await Promise.allSettled(
      updates.map((update, index) =>
        updateLimit(async () => {
          try {
            const { data, error } = await supabaseAdmin
              .from(table)
              .update(update.data)
              .match(update.filter);
            
            if (error) {
              errors.push({ index, error: error.message });
              return { success: false };
            }
            
            return { success: true };
          } catch (error) {
            errors.push({ index, error: error.message });
            return { success: false };
          }
        })
      )
    );

    totalUpdated = results.filter(r => 
      r.status === 'fulfilled' && r.value.success
    ).length;

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const successRate = ((totalUpdated / updates.length) * 100).toFixed(1);
    
    loggers.database.info({
      table,
      updated: totalUpdated,
      total: updates.length,
      successRate: parseFloat(successRate),
      durationSeconds: parseFloat(duration),
      errors: errors.length
    }, 'Batch update complete');

    const result = {
      success: errors.length === 0,
      updated: totalUpdated,
      failed: updates.length - totalUpdated,
      duration: parseFloat(duration),
      errors
    };
    
    tracker.end({ 
      table,
      records: updates.length,
      updated: totalUpdated,
      failed: updates.length - totalUpdated
    });
    
    return result;
    
  } catch (error) {
    tracker.end({ 
      table,
      records: updates.length,
      updated: totalUpdated,
      failed: updates.length - totalUpdated,
      error: error.message
    });
    loggers.database.error({
      table,
      error: error.message,
      stack: error.stack,
      updated: totalUpdated
    }, 'Fatal error in batch update');
    const errorResult = {
      success: false,
      updated: totalUpdated,
      error: error.message
    };
    tracker.end({ 
      table,
      records: updates.length,
      updated: totalUpdated,
      failed: updates.length - totalUpdated,
      error: error.message
    });
    return errorResult;
  }
}

async function forwardMessageToWebhook(agentId, messagePayload) {
  const webhookService = require('./webhookService');
  const webhookUrl = getInboundMessageWebhook();

  if (!webhookUrl) {
    console.warn('[BAILEYS][WEBHOOK] ⚠️ No inbound webhook configured. Skipping message forward.');
    return;
  }

  try {
    // CRITICAL: Fetch user_id from agents table before sending webhook
    let userId = null;
    try {
      const { data: agentData, error: agentError } = await supabaseAdmin
        .from('agents')
        .select('user_id')
        .eq('id', agentId)
        .single();

      if (agentError) {
        console.error(`[BAILEYS][WEBHOOK] ❌ Failed to fetch agent user_id:`, agentError.message);
        // Continue without user_id rather than failing completely
      } else if (agentData && agentData.user_id) {
        userId = agentData.user_id;
        console.log(`[BAILEYS][WEBHOOK] ✅ Fetched user_id for agent ${agentId}: ${userId}`);
      } else {
        console.warn(`[BAILEYS][WEBHOOK] ⚠️ Agent ${agentId} has no user_id set in database`);
      }
    } catch (fetchError) {
      console.error(`[BAILEYS][WEBHOOK] ❌ Error fetching user_id:`, fetchError.message);
      // Continue without user_id rather than failing completely
    }

    // Construct standardized webhook payload
    // Ensure source is always included (defaults to 'whatsapp' if not set)
    const webhookPayload = {
      source: messagePayload.source || 'whatsapp', // Default to 'whatsapp' for backward compatibility
      messageId: messagePayload.messageId || messagePayload.id,
      from: messagePayload.from,
      to: messagePayload.to,
      body: messagePayload.content || messagePayload.body || messagePayload.message_text || '',
      timestamp: messagePayload.timestamp || messagePayload.received_at || new Date().toISOString(),
      isFromMe: messagePayload.isFromMe !== undefined ? messagePayload.isFromMe : (messagePayload.fromMe || false),
      agentId: agentId,
      ...(userId && { user_id: userId }), // Include user_id only if it exists
      metadata: {
        ...(messagePayload.metadata || {}),
        messageType: messagePayload.messageType || messagePayload.type || 'text',
        conversationId: messagePayload.conversationId || messagePayload.remoteJid || null,
        senderName: messagePayload.senderName || null,
        mediaUrl: messagePayload.mediaUrl || null,
        mimetype: messagePayload.mimetype || null,
      }
    };

    // Use centralized webhook service with retry logic
    await webhookService.sendWebhook(webhookUrl, webhookPayload);

    const label = messagePayload.messageType || messagePayload.type || 'message';
    console.log(
      `[BAILEYS][WEBHOOK] ✅ Forwarded ${label} ${webhookPayload.messageId} from ${webhookPayload.from} (source: ${webhookPayload.source})${userId ? ` (user_id: ${userId})` : ''}`
    );
  } catch (error) {
    // Webhook service handles retries and logging, so we just log here
    console.error(
      `[BAILEYS][WEBHOOK] ❌ Error in forwardMessageToWebhook:`,
      error.message
    );
    // Don't throw - webhook failures shouldn't block message processing
  }
}

function sanitizeNumberFromJid(jid) {
  if (!jid || typeof jid !== 'string') {
    return null;
  }

  const atSplit = jid.split('@')[0] || '';
  const base = atSplit.split(':')[0];
  const digits = base.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function unwrapMessageContent(message) {
  if (!message) {
    return {};
  }

  if (message.ephemeralMessage?.message) {
    return unwrapMessageContent(message.ephemeralMessage.message);
  }

  if (message.viewOnceMessage?.message) {
    return unwrapMessageContent(message.viewOnceMessage.message);
  }

  return message;
}

function getExtensionFromMime(mimetype) {
  if (!mimetype || typeof mimetype !== 'string') {
    return 'ogg';
  }

  const mapping = {
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'audio/3gpp': '3gp',
    'audio/3gpp2': '3g2',
  };

  return mapping[mimetype.toLowerCase()] || mimetype.split('/').pop() || 'ogg';
}

async function ensureAudioBucket() {
  if (audioBucketChecked) {
    return;
  }

  try {
    let bucketExists = false;

    if (typeof supabaseAdmin.storage.getBucket === 'function') {
      const { data, error } = await supabaseAdmin.storage.getBucket(audioBucketName);
      bucketExists = Boolean(data) && !error;
    }

    if (!bucketExists) {
      const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
      if (listError) {
        console.error('[BAILEYS][STORAGE] ❌ Failed to list buckets:', listError);
        throw listError;
      }
      bucketExists = (buckets || []).some((bucket) => bucket.name === audioBucketName);
    }

    if (!bucketExists) {
      console.log('[BAILEYS][STORAGE] 🎵 Creating audio bucket:', audioBucketName);
      const { error: createError } = await supabaseAdmin.storage.createBucket(audioBucketName, {
        public: false,
      });

      if (createError && !createError.message?.toLowerCase().includes('already exists')) {
        console.error('[BAILEYS][STORAGE] ❌ Failed to create audio bucket:', createError);
        if (audioBucketName !== FALLBACK_AUDIO_BUCKET) {
          console.warn(
            '[BAILEYS][STORAGE] ⚠️ Falling back to existing bucket:',
            FALLBACK_AUDIO_BUCKET
          );
          audioBucketName = FALLBACK_AUDIO_BUCKET;
          audioBucketChecked = false;
          return ensureAudioBucket();
        }
        throw createError;
      }
    }

    audioBucketChecked = true;
  } catch (error) {
    console.error('[BAILEYS][STORAGE] ❌ Unable to ensure audio bucket:', error);
    if (audioBucketName !== FALLBACK_AUDIO_BUCKET) {
      console.warn('[BAILEYS][STORAGE] ⚠️ Switching to fallback bucket:', FALLBACK_AUDIO_BUCKET);
      audioBucketName = FALLBACK_AUDIO_BUCKET;
      audioBucketChecked = false;
      await ensureAudioBucket();
    } else {
      throw error;
    }
  }
}

async function saveAudioFile(buffer, agentId, messageId, mimetype = 'audio/ogg') {
  await ensureAudioBucket();

  const extension = getExtensionFromMime(mimetype);
  const normalizedAgentId = agentId.replace(/[^a-zA-Z0-9-_]/g, '');
  const baseFileName = `${Date.now()}-${messageId}`.replace(/[^a-zA-Z0-9-_]/g, '');
  let storagePath = `${normalizedAgentId}/${baseFileName}.${extension}`;

  const uploadOptions = {
    cacheControl: '3600',
    upsert: false,
    contentType: mimetype,
  };

  // Retry configuration for network errors
  const MAX_RETRIES = 3;
  const INITIAL_RETRY_DELAY = 1000; // 1 second
  const MAX_RETRY_DELAY = 10000; // 10 seconds

  // Helper function to check if error is retryable (network errors)
  const isRetryableError = (error) => {
    if (!error) return false;
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || error.originalError?.code || '';
    const errorCause = error.originalError?.cause?.code || '';
    
    // Check for network-related errors
    return errorMessage.includes('fetch failed') ||
           errorMessage.includes('econnreset') ||
           errorMessage.includes('network') ||
           errorMessage.includes('timeout') ||
           errorCode === 'ECONNRESET' ||
           errorCode === 'ETIMEDOUT' ||
           errorCode === 'ENOTFOUND' ||
           errorCause === 'ECONNRESET' ||
           errorCause === 'ETIMEDOUT';
  };

  // Retry logic with exponential backoff
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { error } = await supabaseAdmin.storage.from(audioBucketName).upload(storagePath, buffer, uploadOptions);
      
      if (!error) {
        // Success!
        break;
      }

      // Handle file exists error (not retryable, but needs different path)
      if (error.message?.includes('exists')) {
        const uniqueSuffix = randomUUID().slice(0, 8);
        storagePath = `${normalizedAgentId}/${baseFileName}-${uniqueSuffix}.${extension}`;
        const { error: retryError } = await supabaseAdmin.storage
          .from(audioBucketName)
          .upload(storagePath, buffer, uploadOptions);
        if (!retryError) {
          // Success with new path
          break;
        }
        lastError = retryError;
        // If retry with new path fails due to network, continue retry loop
        if (isRetryableError(retryError) && attempt < MAX_RETRIES) {
          lastError = retryError;
          continue;
        }
        throw retryError;
      }

      // Check if error is retryable
      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        lastError = error;
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
        console.warn(`[BAILEYS][STORAGE] ⚠️ Network error on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${delay}ms:`, error.message || error.code);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Non-retryable error or max retries reached
      lastError = error;
      break;
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
        console.warn(`[BAILEYS][STORAGE] ⚠️ Network error on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${delay}ms:`, error.message || error.code);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Non-retryable error or max retries reached
      break;
    }
  }

  // If we still have an error after all retries
  if (lastError) {
    console.error('[BAILEYS][STORAGE] ❌ Failed to upload audio after retries:', {
      message: lastError.message,
      code: lastError.code || lastError.originalError?.code,
      cause: lastError.originalError?.cause?.code,
      attempts: MAX_RETRIES + 1
    });
    throw lastError;
  }

  // Generate signed URL with retry logic for network errors
  let mediaUrl = null;
  const URL_MAX_RETRIES = 2;
  const URL_RETRY_DELAY = 500;

  for (let attempt = 0; attempt <= URL_MAX_RETRIES; attempt++) {
    try {
      const ttl = Number(process.env.AUDIO_SIGNED_URL_TTL || DEFAULT_AUDIO_SIGNED_URL_TTL);
      const { data, error } = await supabaseAdmin.storage
        .from(audioBucketName)
        .createSignedUrl(storagePath, ttl);

      if (!error && data?.signedUrl) {
        mediaUrl = data.signedUrl;
        break;
      }

      // If error is network-related and we have retries left, retry
      const isUrlNetworkError = error && (
        error.message?.toLowerCase().includes('fetch failed') ||
        error.message?.toLowerCase().includes('econnreset') ||
        error.message?.toLowerCase().includes('network') ||
        error.message?.toLowerCase().includes('timeout') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT'
      );
      
      if (isUrlNetworkError && attempt < URL_MAX_RETRIES) {
        console.warn(`[BAILEYS][STORAGE] ⚠️ Network error creating signed URL (attempt ${attempt + 1}/${URL_MAX_RETRIES + 1}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, URL_RETRY_DELAY * (attempt + 1)));
        continue;
      }

      // Non-retryable error or max retries - try public URL fallback
      if (error) {
        console.warn('[BAILEYS][STORAGE] ⚠️ Failed to create signed URL, attempting public URL fallback:', error.message);
        try {
          const { data: publicData } = await supabaseAdmin.storage.from(audioBucketName).getPublicUrl(storagePath);
          mediaUrl = publicData?.publicUrl || null;
        } catch (publicUrlError) {
          console.warn('[BAILEYS][STORAGE] ⚠️ Failed to get public URL as fallback:', publicUrlError.message);
        }
      }
      break;
    } catch (error) {
      // If error is network-related and we have retries left, retry
      const isUrlNetworkError = error && (
        error.message?.toLowerCase().includes('fetch failed') ||
        error.message?.toLowerCase().includes('econnreset') ||
        error.message?.toLowerCase().includes('network') ||
        error.message?.toLowerCase().includes('timeout') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT'
      );
      
      if (isUrlNetworkError && attempt < URL_MAX_RETRIES) {
        console.warn(`[BAILEYS][STORAGE] ⚠️ Network error generating URL (attempt ${attempt + 1}/${URL_MAX_RETRIES + 1}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, URL_RETRY_DELAY * (attempt + 1)));
        continue;
      }
      console.warn('[BAILEYS][STORAGE] ⚠️ Error generating audio URL:', error.message);
      break;
    }
  }

  console.log('[BAILEYS][STORAGE] 🎵 Audio stored', {
    storagePath,
    mimetype,
    bytes: buffer?.length || 0,
    hasUrl: !!mediaUrl,
  });

  return {
    url: mediaUrl,
    path: storagePath,
  };
}

// Sync credentials from files to database
// Called after every creds.update event to ensure database has latest credentials
async function syncCredsToDatabase(agentId) {
  const tracker = new OperationTracker('sync_credentials', loggers.database, 500);
  console.log(`[BAILEYS] 💾 Syncing credentials to database for ${agentId.substring(0, 40)}`);
  
  const authPath = path.join(__dirname, '../../auth_sessions', agentId);
  const credsPath = path.join(authPath, 'creds.json');
  
  // CRITICAL: Use file locking to prevent concurrent reads during writes
  let release = null;
  
  try {
    // Ensure directory exists
    if (!fs.existsSync(authPath)) {
      try {
        fs.mkdirSync(authPath, { recursive: true });
        console.log(`[BAILEYS] 📁 Created auth directory for sync: ${authPath}`);
      } catch (mkdirError) {
        console.error(`[BAILEYS] ❌ Error creating auth directory for sync:`, mkdirError);
        tracker.end({ agentId: shortId(agentId), success: false, reason: 'mkdir_failed' });
        return;
      }
    }
    
    if (!fs.existsSync(credsPath)) {
      console.log(`[BAILEYS] ℹ️ No credentials file to sync`);
      tracker.end({ agentId: shortId(agentId), success: false, reason: 'no_creds_file' });
      return;
    }
    
    // Acquire lock before reading (prevents reading during write)
    try {
      release = await lockfile.lock(credsPath, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000
        },
        stale: 10000 // Consider lock stale after 10 seconds
      });
    } catch (lockError) {
      console.error('[BAILEYS] ❌ Could not acquire file lock (file might be corrupted):', lockError.message);
      // Don't sync if we can't get lock - file might be mid-write
      tracker.end({ agentId: shortId(agentId), success: false, reason: 'lock_failed' });
      return;
    }
    
    // Read with lock held
    const rawCreds = fs.readFileSync(credsPath, 'utf-8');
    
    if (!rawCreds || rawCreds.trim().length === 0) {
      console.warn('[BAILEYS] ⚠️ Credentials file is empty - skipping sync');
      tracker.end({ agentId: shortId(agentId), success: false, reason: 'empty_file' });
      return;
    }
    
    let credsData;
    try {
      credsData = JSON.parse(rawCreds);
    } catch (parseError) {
      console.error('[BAILEYS] ❌ Failed to parse creds.json, skipping sync:', parseError.message);
      tracker.end({ agentId: shortId(agentId), success: false, reason: 'parse_failed' });
      return;
    }
    
    // REMOVED: Strict validation - Baileys has already validated these credentials
    // Trust Baileys' internal format (Buffer objects, not base64 strings)
    
    // Encrypt credentials before storing
    const encryptedCreds = encryptCredentials(credsData);
    
    // Save to database
    const { error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .upsert({
        agent_id: agentId,
        session_data: { creds: encryptedCreds, encrypted: true }, // Mark as encrypted
        updated_at: new Date().toISOString()
      }, { onConflict: 'agent_id' });
      
    if (error) throw error;
    
    loggers.security.info({ agentId: shortId(agentId) }, 'Credentials encrypted');
    loggers.database.info({ agentId: shortId(agentId) }, 'Credentials synced to database');
    
    // Update session cache after successful database sync
    await sessionCache.setCachedCredentials(agentId, credsData)
      .catch(error => loggers.cache.warn({ error: error.message }, 'Failed to update session cache'));
    
    loggers.database.debug({ 
      agentId: shortId(agentId),
      syncedToDb: true,
      cached: true
    }, 'Credentials synced to database and cache');
    
    tracker.end({ agentId: shortId(agentId), encrypted: true });
    
    // Cache credentials in Redis for faster access
    if (redisCache.isReady()) {
      await redisCache.cacheSession(agentId, encryptedCreds)
        .catch(error => loggers.cache.warn({ error: error.message }, 'Failed to cache in Redis'));
    }
    
  } catch (error) {
    console.error(`[BAILEYS] ❌ Error syncing to database:`, error);
    
    // Track error
    errorTracker.trackError(error, {
      agentId: shortId(agentId),
      operation: 'sync_credentials'
    });
    
    // Invalidate cache on sync failure
    await sessionCache.invalidateSession(agentId)
      .catch(cacheError => loggers.cache.warn({ error: cacheError.message }, 'Failed to invalidate cache'));
    
    loggers.database.error({ 
      agentId: shortId(agentId),
      error: error.message,
      cacheInvalidated: true
    }, 'Failed to sync credentials, cache invalidated');
  } finally {
    // Always release lock
    if (release) {
      try {
        await release();
      } catch (releaseError) {
        console.error('[BAILEYS] ⚠️ Error releasing file lock:', releaseError.message);
      }
    }
  }
}

// CRITICAL: Helper to safely get key length from various formats
function getKeyLength(key) {
  if (Buffer.isBuffer(key)) {
    return key.length;
  }
  if (typeof key === 'string') {
    // Try to decode as base64 first, then as raw string
    try {
      return Buffer.from(key, 'base64').length;
    } catch {
      return Buffer.from(key).length;
    }
  }
  if (key instanceof Uint8Array || Array.isArray(key)) {
    return Buffer.from(key).length;
  }
  if (typeof key === 'object' && key !== null) {
    // Handle objects that might be serialized Buffers/Uint8Arrays
    try {
      if (key.type === 'Buffer' && Array.isArray(key.data)) {
        // JSON-serialized Buffer: { type: 'Buffer', data: [1,2,3,...] }
        return key.data.length;
      }
      // Try to convert object to array
      const arr = Object.values(key);
      if (arr.length > 0 && typeof arr[0] === 'number') {
        return Buffer.from(arr).length;
      }
      // Last resort: try Buffer.from directly
      return Buffer.from(key).length;
    } catch (e) {
      throw new Error(`Cannot convert key to Buffer: ${e.message}`);
    }
  }
  throw new Error(`Unsupported key type: ${typeof key}`);
}

// CRITICAL: Validate credential integrity to prevent Bad MAC errors
// Returns { valid: boolean, reason: string }
function validateCredentialIntegrity(creds) {
  if (!creds || typeof creds !== 'object') {
    return { valid: false, reason: 'Credentials not an object' };
  }
  
  // Check required keys
  if (!creds.noiseKey || !creds.signedIdentityKey || !creds.signedPreKey) {
    return { 
      valid: false, 
      reason: `Missing required keys: ${!creds.noiseKey ? 'noiseKey ' : ''}${!creds.signedIdentityKey ? 'signedIdentityKey ' : ''}${!creds.signedPreKey ? 'signedPreKey' : ''}`
    };
  }
  
  // Check key structures
  if (!creds.noiseKey.private || !creds.noiseKey.public) {
    return { valid: false, reason: 'Noise key missing private/public components' };
  }
  
  // Check key lengths (prevent truncated keys)
  // CRITICAL: Handle different key formats (Buffer, Uint8Array, string, object)
  let noisePrivateLen, noisePublicLen;
  try {
    noisePrivateLen = getKeyLength(creds.noiseKey.private);
    noisePublicLen = getKeyLength(creds.noiseKey.public);
  } catch (e) {
    return { valid: false, reason: `Error checking noise key lengths: ${e.message}` };
  }
  
  if (noisePrivateLen !== 32) {
    return { 
      valid: false, 
      reason: `Noise private key invalid length: ${noisePrivateLen} (expected 32)` 
    };
  }
  
  if (noisePublicLen !== 32) {
    return { 
      valid: false, 
      reason: `Noise public key invalid length: ${noisePublicLen} (expected 32)` 
    };
  }
  
  return { valid: true };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MULTI-LAYER CONNECTION MONITORING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Storage for monitoring intervals
const connectionMonitors = new Map();
const healthCheckIntervals = new Map();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER 1: WebSocket State Monitor - DISABLED
// 
// ⚠️ CRITICAL: This monitor has been DISABLED because it causes FALSE POSITIVES.
// 
// Problem: In Baileys, `sock.ws?.readyState` returns `undefined` because:
// - Baileys wraps the WebSocket in a nested structure
// - The path `sock.ws.readyState` doesn't exist as expected
// - This causes the monitor to think the connection is dead (undefined !== 1)
// - Result: Unnecessary reconnection every 30 seconds even when connection is WORKING
//
// Solution: Use these alternatives instead (which work correctly):
// 1. Health ping monitor (60s) - Actively tests connection with query, detects real issues
// 2. Connection events (immediate) - Baileys fires 'close' event on actual disconnection
// 3. Database heartbeat (60s) - For multi-instance coordination
//
// The health ping monitor at 60s intervals is sufficient for detecting real disconnections
// while avoiding false positives from WebSocket state checks.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startConnectionStateMonitor(sock, agentId) {
  // DISABLED: Do not start any interval - just log that we're using better alternatives
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... ℹ️ WebSocket state monitor DISABLED (causes false positives)`);
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... ✅ Using: Health pings (60s) + Connection events + DB heartbeat`);
  
  // Clean up any existing monitor if it was somehow started
  if (connectionMonitors.has(agentId)) {
    clearInterval(connectionMonitors.get(agentId));
    connectionMonitors.delete(agentId);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER 2: Health Check with Ping (every 60 seconds)
// Actively tests connection by sending a query
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startHealthPingMonitor(sock, agentId) {
  // Clear existing health check if any
  if (healthCheckIntervals.has(agentId)) {
    clearInterval(healthCheckIntervals.get(agentId));
  }
  
  const healthInterval = setInterval(async () => {
    try {
      const session = activeSessions.get(agentId);
      if (!session || !session.isConnected) {
        console.log(`[HEALTH] ${agentId.substring(0, 8)}... Session not connected, stopping health check`);
        clearInterval(healthInterval);
        healthCheckIntervals.delete(agentId);
      return;
    }
    
      const startTime = Date.now();
      
      // Send a lightweight query to test connection
      // This uses Baileys internal mechanism to verify connection is alive
      await sock.query({
        tag: 'iq',
        attrs: {
          to: '@s.whatsapp.net',
          type: 'get',
          xmlns: 'w:p'
        },
        content: [{ tag: 'ping', attrs: {} }]
      });
      
      const latency = Date.now() - startTime;
      console.log(`[HEALTH] ${agentId.substring(0, 8)}... ✅ Health check PASSED (${latency}ms)`);
      
      // Update connection quality in database (silently)
      try {
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            last_heartbeat: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
      } catch (dbError) {
        // Ignore DB errors for health check
      }
      
        } catch (error) {
      console.error(`[HEALTH] ${agentId.substring(0, 8)}... ❌ Health check FAILED:`, error.message);
      
      const session = activeSessions.get(agentId);
      if (session) {
        // Only trigger reconnection if session thinks it's connected
        if (session.isConnected) {
          clearInterval(healthInterval);
          healthCheckIntervals.delete(agentId);
          
          session.isConnected = false;
          
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          await handleSmartReconnection(agentId, 'health_check_failed', 1);
        }
      }
    }
  }, 60000); // 60 seconds
  
  healthCheckIntervals.set(agentId, healthInterval);
  console.log(`[HEALTH] ${agentId.substring(0, 8)}... ✅ Health ping monitor started (60s interval)`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER 3: Database Heartbeat (every 60 seconds) - PASSIVE
// Updates last_heartbeat in database for multi-instance coordination
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startHeartbeat(agentId, session) {
  // Simple heartbeat - just update database every 60 seconds
  // This is PASSIVE monitoring only - no connection interference
  const heartbeat = setInterval(async () => {
    const currentSession = activeSessions.get(agentId);
    
    // Stop if session removed or not connected
    if (!currentSession || !currentSession.isConnected) {
      clearInterval(heartbeat);
      return;
    }
    
    // Just update heartbeat in database - no reconnection logic
    try {
      await supabaseAdmin
        .from('whatsapp_sessions')
        .update({
          last_heartbeat: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('agent_id', agentId);
    } catch (error) {
      // Silently ignore heartbeat errors - not critical
    }
  }, 60000); // Every 60 seconds
  
  if (session) {
    session.heartbeatInterval = heartbeat;
  }
  
  return heartbeat;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper: Remove agent from active sessions and unassign from instance manager
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function removeAgentFromActiveSessions(agentId) {
  // Remove all event listeners for this agent
  removeTrackedListeners(agentId);
  
  // Flush any pending message batches
  await flushMessageBatch(agentId);
  
  loggers.messages.debug({
    agentId: shortId(agentId)
  }, 'Message batch flushed on cleanup');
  
  // Invalidate all caches for this agent
  await sessionCache.invalidateSession(agentId)
    .catch(error => loggers.cache.warn({ error: error.message }, 'Failed to invalidate session cache'));
  
  loggers.connection.debug({ 
    agentId: shortId(agentId),
    cacheCleared: true
  }, 'Session cache invalidated on cleanup');
  
  // Clean up agent-specific cache entries
  try {
    // Clean validation cache entries for this agent
    const validationKeys = Array.from(validationCache.keys());
    for (const key of validationKeys) {
      if (key.includes(agentId)) {
        validationCache.delete(key);
        loggers.perf.debug({ 
          agentId: shortId(agentId), 
          cacheKey: key 
        }, 'Removed validation cache entry');
      }
    }
    
    // Clean LID cache entries for this agent
    const lidKeys = Array.from(lidToPhoneCache.keys());
    for (const key of lidKeys) {
      if (key.includes(agentId)) {
        lidToPhoneCache.delete(key);
        loggers.perf.debug({ 
          agentId: shortId(agentId), 
          cacheKey: key 
        }, 'Removed LID cache entry');
      }
    }
    
    // Clean session cache entry
    SESSION_CACHE.delete(agentId);
    
    loggers.perf.debug({ 
      agentId: shortId(agentId) 
    }, 'Agent-specific cache entries cleaned');
    
  } catch (error) {
    loggers.perf.error({ 
      agentId: shortId(agentId), 
      error: error.message 
    }, 'Error cleaning agent cache entries');
  }
  
  activeSessions.delete(agentId);
  
  // Unassign from instance manager
  if (instanceManager.isActive) {
    try {
      await instanceManager.unassignAgent(agentId);
    } catch (error) {
      loggers.connection.warn({ error: error.message, agentId: shortId(agentId) }, 'Failed to unassign agent from instance');
    }
  }
}

/**
 * Batch update session statuses
 * Phase 3C.2 optimization
 * @param {Array} updates - Array of {agentId, status, error?} objects
 * @returns {Promise<Object>} {success: number, failed: number}
 */
async function batchUpdateSessionStatus(updates) {
  if (!updates || updates.length === 0) return { success: 0, failed: 0 };
  
  try {
    const limit = pLimit(10); // Max 10 concurrent updates
    
    const results = await Promise.allSettled(
      updates.map(update =>
        limit(async () => {
          const { error } = await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              status: update.status,
              last_error: update.error || null,
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', update.agentId);
          
          if (error) throw error;
          return { success: true, agentId: update.agentId };
        })
      )
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - successful;
    
    loggers.database.info({
      successful,
      failed,
      total: updates.length
    }, 'Batch status update complete');
    
    return { success: successful, failed };
    
  } catch (error) {
    loggers.database.error({ error: error.message }, 'Batch update failed');
    return { success: 0, failed: updates.length };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cleanup all monitoring for an agent
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function cleanupMonitoring(agentId) {
  console.log(`[CLEANUP] ${agentId.substring(0, 8)}... Cleaning up all monitoring...`);
  
  // Clear connection state monitor
  const monitor = connectionMonitors.get(agentId);
  if (monitor) {
    clearInterval(monitor);
    connectionMonitors.delete(agentId);
    console.log(`[CLEANUP] ${agentId.substring(0, 8)}... WebSocket monitor cleared`);
  }
  
  // Clear health check
  const health = healthCheckIntervals.get(agentId);
  if (health) {
    clearInterval(health);
    healthCheckIntervals.delete(agentId);
    console.log(`[CLEANUP] ${agentId.substring(0, 8)}... Health check cleared`);
  }
  
  // Clear heartbeat from session
  const session = activeSessions.get(agentId);
  if (session?.heartbeatInterval) {
    clearInterval(session.heartbeatInterval);
    session.heartbeatInterval = null;
    console.log(`[CLEANUP] ${agentId.substring(0, 8)}... Heartbeat cleared`);
  }
  
  // Close socket if exists
  if (session?.socket) {
    try {
      session.socket.ev?.removeAllListeners();
      session.socket.ws?.close();
    } catch (err) {
      console.error(`[CLEANUP] ${agentId.substring(0, 8)}... Error closing socket:`, err.message);
    }
  }
  
  console.log(`[CLEANUP] ${agentId.substring(0, 8)}... ✅ Cleanup complete`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Start all monitoring for an agent (called after connection.open)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startAllMonitoring(sock, agentId, session) {
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... 🔍 Starting monitoring layers...`);
  
  // Layer 1: Event-based monitoring (via connection.update listener - already active)
  // Baileys fires 'connection': 'close' immediately when socket disconnects
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... ✅ Event-based monitoring active (connection.update listener)`);
  
  // Layer 2: Health ping monitor (60s) - Actively tests connection quality
  // This is the PRIMARY disconnection detection mechanism
  startHealthPingMonitor(sock, agentId);
  
  // Layer 3: Database heartbeat (60s) - For multi-instance coordination
  startHeartbeat(agentId, session);
  
  // NOTE: WebSocket state monitor is DISABLED - it caused false reconnections
  // See startConnectionStateMonitor() comments for full explanation
  // startConnectionStateMonitor(sock, agentId);  // ← DISABLED
  
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... ✅ Monitoring active: Health pings (60s) + DB heartbeat (60s) + Connection events`);
}

// CRITICAL: Backup credentials to prevent data loss
async function backupCredentials(agentId) {
  try {
    const authPath = path.join(__dirname, '../../auth_sessions', agentId);
    const credsPath = path.join(authPath, 'creds.json');
    
    if (!fs.existsSync(credsPath)) {
      return;
    }
    
    // Create backup with timestamp
    const timestamp = Date.now();
    const backupPath = path.join(authPath, `creds.json.backup.${timestamp}`);
    
    fs.copyFileSync(credsPath, backupPath);
    console.log(`[BAILEYS] 💾 Credentials backed up to ${backupPath}`);
    
    // Keep only last 3 backups
    const backupFiles = fs.readdirSync(authPath)
      .filter(f => f.startsWith('creds.json.backup.'))
      .sort()
      .reverse();
    
    if (backupFiles.length > 3) {
      for (const oldBackup of backupFiles.slice(3)) {
        fs.unlinkSync(path.join(authPath, oldBackup));
        console.log(`[BAILEYS] 🗑️ Deleted old backup: ${oldBackup}`);
      }
    }
    
  } catch (error) {
    console.error(`[BAILEYS] ⚠️ Backup failed:`, error.message);
  }
}

// FIX 3: Smart status check to determine if credentials should be deleted
// Returns true if credentials should be deleted, false if they should be kept
async function shouldDeleteCredentials(agentId) {
  try {
    // Get current database status
    const { data: agent, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, updated_at')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (error) {
      console.warn(`[BAILEYS] ⚠️ Error checking status for credential deletion:`, error.message);
      // On error, be conservative and keep credentials
      return false;
    }
    
    if (!agent) {
      // No agent record - safe to delete (fresh start)
      return true;
    }
    
    // If status is 'disconnected' AND last update was > 5 minutes ago
    // Then it's a real disconnect, delete credentials
    if (agent.status === 'disconnected') {
      const lastUpdate = new Date(agent.updated_at);
      const now = new Date();
      const minutesSinceUpdate = (now - lastUpdate) / 1000 / 60;
      
      if (minutesSinceUpdate > 5) {
        loggers.connection.info({
          agentId: shortId(agentId),
          minutesSinceUpdate: minutesSinceUpdate.toFixed(1)
        }, 'Old disconnect detected, clearing credentials');
        return true;
      }
      
      loggers.connection.info({
        agentId: shortId(agentId),
        minutesSinceUpdate: minutesSinceUpdate.toFixed(1)
      }, 'Recent disconnect, keeping credentials for reconnect');
      return false;
    }
    
    // For 'connected', 'authenticated', or other statuses, keep credentials
    loggers.connection.debug({
      agentId: shortId(agentId),
      status: agent.status
    }, 'Keeping credentials - status is not disconnected');
    return false;
  } catch (error) {
    console.error(`[BAILEYS] ❌ Error in shouldDeleteCredentials:`, error.message);
    // On error, be conservative and keep credentials
    return false;
  }
}

// Validate credential freshness before using existing credentials
// Returns { valid: boolean, reason: string }
async function validateCredentialFreshness(agentId, creds) {
  console.log(`[BAILEYS] 🔍 Validating credential freshness for ${agentId.substring(0, 40)}...`);
  
  try {
    // Simplified query without timeout complexity
    const { data: sessionData, error: statusError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, is_active, disconnected_at, updated_at')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (statusError) {
      console.warn(`[BAILEYS] ⚠️ Error checking session status:`, statusError);
      // On error, allow credentials (fail open for connection attempts)
      return {
        valid: true,
        reason: 'Cannot verify status - allowing connection attempt'
      };
    }
    
    if (sessionData) {
      // Check if disconnected recently
      if (sessionData.status === 'disconnected') {
        const disconnectTime = sessionData.disconnected_at 
          ? new Date(sessionData.disconnected_at).getTime()
          : new Date(sessionData.updated_at).getTime();
        
        const minutesSinceDisconnect = (Date.now() - disconnectTime) / 1000 / 60;
        
        // Only reject if disconnected > 30 minutes ago (more lenient)
        if (minutesSinceDisconnect > 30) {
          console.log(`[BAILEYS] ❌ Credentials rejected: Disconnected ${minutesSinceDisconnect.toFixed(1)} minutes ago`);
          return {
            valid: false,
            reason: `Session was disconnected ${minutesSinceDisconnect.toFixed(0)} minutes ago`
          };
        } else {
          console.log(`[BAILEYS] ✅ Recent disconnect (${minutesSinceDisconnect.toFixed(1)} min) - allowing credentials`);
        }
      }
      
      if (sessionData.status === 'conflict') {
        console.log(`[BAILEYS] ❌ Credentials rejected: Session has conflict status`);
        return {
          valid: false,
          reason: 'Session has conflict status - credentials are invalidated'
        };
      }
    }
    
    // Basic credential structure check
    if (!creds || typeof creds !== 'object') {
      console.log(`[BAILEYS] ❌ Credentials rejected: Invalid structure`);
      return {
        valid: false,
        reason: 'Invalid credential structure'
      };
    }
    
    // Must have device ID to be valid
    if (!creds.me || !creds.me.id) {
      console.log(`[BAILEYS] ❌ Credentials rejected: Missing device ID`);
      return {
        valid: false,
        reason: 'Credentials missing device ID - not paired'
      };
    }
    
    // All checks passed
    console.log(`[BAILEYS] ✅ Credentials validated: Fresh and valid`);
    console.log(`[BAILEYS] Device ID: ${creds.me.id.split(':')[0]}, Status: ${sessionData?.status || 'unknown'}`);
    return {
      valid: true,
      reason: 'Credentials are fresh and valid'
    };
    
  } catch (error) {
    console.error(`[BAILEYS] ❌ Error validating credentials:`, error);
    // On error, allow credentials (fail open)
    return {
      valid: true,
      reason: `Validation error - allowing connection attempt: ${error.message}`
    };
  }
}

// Restore credentials from database to files
// Called when local files don't exist but database might have saved credentials
async function restoreCredsFromDatabase(agentId) {
  const tracker = new OperationTracker('restore_credentials', loggers.database, 500);
  const startTime = Date.now();
  loggers.database.info({ agentId: shortId(agentId) }, 'Attempting to restore credentials from database');
  
  try {
    // Step 1: Check session cache first (fastest, reduces DB queries by 70%)
    try {
      const cached = await sessionCache.getCachedCredentials(agentId);
      if (cached) {
        loggers.database.info({ 
          agentId: shortId(agentId),
          source: 'session-cache',
          latency: Date.now() - startTime
        }, 'Credentials restored from session cache');
        
        // Also cache in LRU for faster subsequent access
        SESSION_CACHE.set(agentId, cached);
        cacheStats.session.hits++;
        recordMetric(() => {
          if (cacheMetrics?.hits) {
            cacheMetrics.hits.labels('session').inc();
          }
        });
        
        tracker.end({ agentId: shortId(agentId), cached: true, source: 'session-cache' });
        return cached;
      }
      
      loggers.database.debug({ agentId: shortId(agentId) }, 'Cache miss: credentials');
    } catch (cacheError) {
      loggers.cache.warn({ error: cacheError.message }, 'Session cache error, falling back to Redis');
    }
    
    // Step 2: Try Redis cache (distributed)
    if (redisCache.isReady()) {
      try {
        const redisCached = await redisCache.getSession(agentId);
        if (redisCached) {
          cacheStats.session.hits++;
          loggers.cache.debug({ agentId: shortId(agentId), source: 'redis' }, 'Session cache hit');
          
          // Also cache in LRU for faster subsequent access
          SESSION_CACHE.set(agentId, redisCached);
          
          tracker.end({ agentId: shortId(agentId), cached: true, source: 'redis' });
          return redisCached;
        }
      } catch (error) {
        loggers.cache.warn({ error: error.message }, 'Redis cache error, falling back to LRU');
      }
    }
    
    // Fall back to LRU cache (local)
    const cached = SESSION_CACHE.get(agentId);
    if (cached) {
      cacheStats.session.hits++;
      recordMetric(() => {
        if (cacheMetrics?.hits) {
          cacheMetrics.hits.labels('session').inc();
        }
      });
      loggers.cache.debug({ agentId: shortId(agentId), source: 'lru' }, 'Session cache hit');
      tracker.end({ agentId: shortId(agentId), cached: true, source: 'lru' });
      return cached;
    } else {
      cacheStats.session.misses++;
      recordMetric(() => {
        if (cacheMetrics?.misses) {
          cacheMetrics.misses.labels('session').inc();
        }
      });
    }
    
    // CRITICAL: Check session status first - don't restore if corrupted/conflict
    const { data: sessionStatus, error: statusError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, is_active')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (statusError) {
      loggers.database.error({
        agentId: shortId(agentId),
        error: statusError.message
      }, 'Error checking session status');
      // Continue to try restore, but log warning
    } else if (sessionStatus) {
      // Don't restore if session is in conflict or disconnected state
      if (sessionStatus.status === 'conflict' || sessionStatus.status === 'disconnected') {
        loggers.database.warn({
          agentId: shortId(agentId),
          status: sessionStatus.status
        }, 'Session in conflict/disconnected state - skipping credential restore');
        tracker.end({ agentId: shortId(agentId), success: false, reason: 'conflict_state' });
        return false;
      }
    }
    
    const { data, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('session_data')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (error) throw error;
    
    if (!data || !data.session_data?.creds) {
      loggers.database.info({ agentId: shortId(agentId) }, 'No credentials in database to restore');
      tracker.end({ agentId: shortId(agentId), success: false, reason: 'no_credentials' });
      return false;
    }
    
    // Get credentials and decrypt if encrypted
    let creds = data.session_data.creds;
    
    // Decrypt if encrypted
    if (data.session_data.encrypted) {
      try {
        creds = decryptCredentials(creds);
        loggers.security.info({ agentId: shortId(agentId) }, 'Credentials decrypted');
      } catch (error) {
        loggers.security.error({
          agentId: shortId(agentId),
          error: error.message,
          stack: error.stack
        }, 'Failed to decrypt credentials');
        tracker.end({ agentId: shortId(agentId), success: false, reason: 'decrypt_failed' });
        return false;
      }
    }
    
    // Validate credentials structure before restoring
    if (!creds || typeof creds !== 'object') {
      loggers.database.warn({ agentId: shortId(agentId) }, 'Invalid credentials structure in database - skipping restore');
      tracker.end({ agentId: shortId(agentId), success: false, reason: 'invalid_structure' });
      return false;
    }
    
    // CRITICAL: Validate credential freshness before restoring
    const validation = await validateCredentialFreshness(agentId, creds);
    if (!validation.valid) {
      loggers.database.warn({
        agentId: shortId(agentId),
        reason: validation.reason
      }, 'Credentials in database are stale - will generate fresh QR instead');
      tracker.end({ agentId: shortId(agentId), success: false, reason: 'stale_credentials' });
      return false;
    }
    
    const authPath = path.join(__dirname, '../../auth_sessions', agentId);
    const credsPath = path.join(authPath, 'creds.json');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(authPath)) {
      fs.mkdirSync(authPath, { recursive: true });
    }
    
    // Write credentials to file
    fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
    
    // Cache in session cache (primary), LRU (local), and Redis (distributed)
    await sessionCache.setCachedCredentials(agentId, creds);
    SESSION_CACHE.set(agentId, creds);

    // Also cache in Redis for other instances
    if (redisCache.isReady()) {
      await redisCache.cacheSession(agentId, creds)
        .catch(error => loggers.cache.warn({ error: error.message }, 'Failed to cache session in Redis'));
    }

    const queryTime = Date.now() - startTime;
    loggers.database.info({ 
      agentId: shortId(agentId),
      source: 'database',
      queryTime,
      cached: true
    }, 'Credentials restored from database and cached');
    loggers.cache.debug({ agentId: shortId(agentId) }, 'Session cached in session cache, LRU and Redis');
    
    loggers.database.info({
      agentId: shortId(agentId),
      hasMe: !!creds.me,
      registered: creds.registered
    }, 'Credentials restored from database');
    
    tracker.end({ agentId: shortId(agentId), cached: false, source: 'database' });
    return creds;
  } catch (error) {
    loggers.database.error({
      agentId: shortId(agentId),
      error: error.message,
      stack: error.stack
    }, 'Error restoring from database');
    
    // Track error
    errorTracker.trackError(error, {
      agentId: shortId(agentId),
      operation: 'restore_credentials'
    });
    
    tracker.end({ agentId: shortId(agentId), success: false });
    return false;
  }
}

// Network connectivity check
async function checkNetworkRequirements() {
  console.log(`[BAILEYS] 🌐 Checking network connectivity...`);
  
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get('https://web.whatsapp.com', { timeout: 5000 }, (res) => {
      console.log(`[BAILEYS] ✅ WhatsApp Web reachable (status: ${res.statusCode})`);
      resolve(true);
    });
    
    req.on('error', (error) => {
      console.error(`[BAILEYS] ❌ Cannot reach WhatsApp servers:`, error.message);
      console.error(`[BAILEYS] Please check: 1) Internet connection 2) Firewall 3) Proxy`);
      resolve(false);
    });
    
    req.on('timeout', () => {
      console.error(`[BAILEYS] ❌ Connection timeout to WhatsApp servers`);
      req.destroy();
      resolve(false);
    });
  });
}

// Helper function to check if a PID exists on the system
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    // Signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = No such process
    return false;
  }
}

// CRITICAL: Ensure agent has unique session - prevent credential sharing
async function ensureAgentIsolation(agentId) {
  console.log(`[BAILEYS] 🔒 Ensuring agent isolation for: ${agentId.substring(0, 40)}`);
  
  try {
    // Step 1: Check if agent already has active session IN THIS INSTANCE
    const existingSession = activeSessions.get(agentId);
    if (existingSession) {
      // CRITICAL FIX: Don't do full logout - just clean up the socket
      // Full logout deletes credentials which breaks reconnection!
      console.log(`[BAILEYS] ⚠️ Agent already has session in this instance - cleaning up socket only`);
      
      // Stop intervals
      if (existingSession.heartbeatInterval) {
        clearInterval(existingSession.heartbeatInterval);
        existingSession.heartbeatInterval = null;
      }
      
      // Close socket without logout (preserves credentials)
      if (existingSession.socket) {
        try {
          existingSession.socket.ev?.removeAllListeners();
          existingSession.socket.end?.();
        } catch (e) {
          // Ignore socket cleanup errors
        }
        existingSession.socket = null;
      }
      
      // Clear from memory but DON'T clear database credentials
      await removeAgentFromActiveSessions(agentId);
      qrGenerationTracker.delete(agentId);
      
      console.log(`[BAILEYS] ✅ Socket cleaned up - credentials preserved`);
    }
    
    // Step 2: Check database for OTHER instances using this agent
    const { data: dbSession, error: dbError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, phone_number, is_active, instance_id, instance_hostname, instance_pid, last_heartbeat')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (dbError) {
      console.error(`[BAILEYS] ⚠️ Database error checking isolation:`, dbError);
      // Continue anyway - don't block initialization
      return;
    }
    
    if (dbSession && dbSession.is_active && dbSession.instance_id) {
      // Another instance is using this agent
      if (dbSession.instance_id !== INSTANCE_ID) {
        const timeSinceHeartbeat = dbSession.last_heartbeat 
          ? Date.now() - new Date(dbSession.last_heartbeat).getTime()
          : null;
        
        // Check if PID actually exists (for same hostname only)
        const pidExists = dbSession.instance_hostname === INSTANCE_HOSTNAME && dbSession.instance_pid
          ? isPidAlive(dbSession.instance_pid)
          : null;
        
        // If PID doesn't exist (dead process), take over immediately
        if (pidExists === false) {
          // PID doesn't exist - process is dead, we can take over
          console.log(`[BAILEYS] ⚠️ Found dead instance (PID ${dbSession.instance_pid} doesn't exist)`);
          console.log(`[BAILEYS] ⚠️ Taking over session from dead instance`);
          console.log(`[BAILEYS] Previous Instance: ${dbSession.instance_hostname} (${dbSession.instance_id})`);
          console.log(`[BAILEYS] New Instance: ${INSTANCE_HOSTNAME} (${INSTANCE_ID})`);
        } else if (timeSinceHeartbeat && timeSinceHeartbeat < 2 * 60 * 1000) {
          // PID exists or unknown, and heartbeat is recent (< 2 min) - real conflict
          console.error(`[BAILEYS] ❌ MULTI-INSTANCE CONFLICT DETECTED!`);
          console.error(`[BAILEYS] ❌ Agent ${agentId.substring(0, 40)} is ALREADY ACTIVE on another instance:`);
          console.error(`[BAILEYS] ❌ Other Instance ID: ${dbSession.instance_id}`);
          console.error(`[BAILEYS] ❌ Other Hostname: ${dbSession.instance_hostname}`);
          console.error(`[BAILEYS] ❌ Other PID: ${dbSession.instance_pid} ${pidExists === true ? '(ALIVE)' : pidExists === false ? '(DEAD)' : '(UNKNOWN - different hostname)'}`);
          console.error(`[BAILEYS] ❌ Last Heartbeat: ${timeSinceHeartbeat / 1000}s ago`);
          console.error(`[BAILEYS] ❌ Phone: ${dbSession.phone_number}`);
          console.error(`[BAILEYS] `);
          console.error(`[BAILEYS] 🚨 CRITICAL: This will cause 401/440 errors and session conflicts!`);
          console.error(`[BAILEYS] 🚨 ACTION REQUIRED: Stop the other instance or use a different agent.`);
          console.error(`[BAILEYS] `);
          console.error(`[BAILEYS] Current Instance: ${INSTANCE_HOSTNAME} (${INSTANCE_ID})`);
          console.error(`[BAILEYS] Other Instance: ${dbSession.instance_hostname} (${dbSession.instance_id})`);
          
          // Mark as conflict in database
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              status: 'conflict',
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          throw new Error(`Multi-instance conflict: Agent ${agentId.substring(0, 20)} is already active on ${dbSession.instance_hostname}`);
        } else {
          // Stale heartbeat (>5 min) - assume other instance died, we can take over
          console.log(`[BAILEYS] ⚠️ Found stale session from another instance (heartbeat ${timeSinceHeartbeat ? Math.round(timeSinceHeartbeat/1000) : 'unknown'}s ago)`);
          console.log(`[BAILEYS] ⚠️ Assuming other instance crashed - taking over session`);
          console.log(`[BAILEYS] Previous Instance: ${dbSession.instance_hostname} (${dbSession.instance_id})`);
          console.log(`[BAILEYS] New Instance: ${INSTANCE_HOSTNAME} (${INSTANCE_ID})`);
        }
      } else {
        // Same instance - this is fine
        console.log(`[BAILEYS] ✅ Session belongs to this instance - proceeding`);
      }
    }
    
    // Step 3: Check if phone number is used by another agent
    if (dbSession && dbSession.phone_number && dbSession.is_active) {
      const phoneNumber = dbSession.phone_number;
      
      const { data: conflictingSessions } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('agent_id, phone_number, instance_id, instance_hostname')
        .eq('phone_number', phoneNumber)
        .eq('is_active', true)
        .neq('agent_id', agentId);
      
      if (conflictingSessions && conflictingSessions.length > 0) {
        console.error(`[BAILEYS] ❌ PHONE NUMBER CONFLICT: ${phoneNumber} is linked to multiple agents:`);
        conflictingSessions.forEach((session, i) => {
          console.error(`[BAILEYS] ❌   ${i+1}. Agent: ${session.agent_id.substring(0, 20)} on ${session.instance_hostname}`);
        });
        console.error(`[BAILEYS] ❌ This violates WhatsApp's one-device-per-number policy!`);
      }
    }
    
    // Step 4: Check in-memory sessions for phone number conflicts
    if (dbSession && dbSession.phone_number) {
      const phoneNumber = dbSession.phone_number;
      
      for (const [otherId, session] of activeSessions.entries()) {
        if (otherId !== agentId && session.phoneNumber === phoneNumber && session.isConnected) {
          console.error(`[BAILEYS] ❌ MEMORY CONFLICT: Phone ${phoneNumber} is in use by agent ${otherId.substring(0, 20)}`);
          throw new Error(`Phone number ${phoneNumber} is currently in use by another agent.`);
        }
      }
    }
    
    console.log(`[BAILEYS] ✅ Agent isolation verified - safe to proceed`);
    
  } catch (error) {
    console.error(`[BAILEYS] ❌ Agent isolation check failed:`, error.message);
    throw error;
  }
}

// CRITICAL: Network diagnostic function for pairing failures
async function diagnoseNetworkIssue(agentId) {
  console.log(`[BAILEYS] 🔍 Running network diagnostics for pairing failure...`);
  
  // Test 1: Basic connectivity
  try {
    const https = require('https');
    await new Promise((resolve, reject) => {
      const req = https.get('https://web.whatsapp.com', { timeout: 5000 }, (res) => {
        console.log(`[BAILEYS] ✅ WhatsApp Web reachable (status: ${res.statusCode})`);
        resolve();
      });
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Timeout')));
    });
  } catch (error) {
    console.error(`[BAILEYS] ❌ WhatsApp Web unreachable:`, error.message);
    console.error(`[BAILEYS] 💡 Check: 1) Internet connection 2) Firewall 3) Proxy settings`);
  }
  
  // Test 2: DNS resolution
  try {
    const dns = require('dns').promises;
    const addresses = await dns.resolve4('web.whatsapp.com');
    console.log(`[BAILEYS] ✅ DNS resolution successful: ${addresses[0]}`);
  } catch (error) {
    console.error(`[BAILEYS] ❌ DNS resolution failed:`, error.message);
  }
  
  // Test 3: WebSocket connectivity (optional - requires 'ws' module)
  try {
    const WebSocket = require('ws');
    const ws = new WebSocket('wss://web.whatsapp.com/ws/chat', {
      handshakeTimeout: 10000
    });
    
    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        console.log(`[BAILEYS] ✅ WebSocket connection successful`);
        ws.close();
        resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket timeout')), 10000);
    });
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log(`[BAILEYS] ℹ️ WebSocket test skipped (ws module not available)`);
    } else {
      console.error(`[BAILEYS] ❌ WebSocket connection failed:`, error.message);
      console.error(`[BAILEYS] 💡 This may indicate: firewall blocking WSS, proxy issues, or network instability`);
    }
  }
}

// Initialize WhatsApp connection
/**
 * Clear expired QR codes from session
 * @param {string} agentId - Agent ID
 */
function clearExpiredQR(agentId) {
  const session = activeSessions.get(agentId);
  if (!session) return;
  
  if (session.qrCode && session.qrGeneratedAt) {
    const qrAge = Date.now() - session.qrGeneratedAt;
    if (qrAge > QR_EXPIRATION_MS) {
      console.log(`[BAILEYS] 🧹 Clearing expired QR for agent ${agentId.substring(0, 8)}... (${Math.round(qrAge/1000)}s old)`);
      session.qrCode = null;
      session.qrGeneratedAt = null;
      activeSessions.set(agentId, session);
    }
  }
}

/**
 * Cleanup stale QR states (qr_pending for >5 minutes)
 * @param {string} agentId - Agent ID
 */
async function cleanupStaleQRState(agentId) {
  try {
    const { data: dbState } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, updated_at, qr_code')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (dbState?.status === 'qr_pending') {
      const stateAge = Date.now() - new Date(dbState.updated_at).getTime();
      
      if (stateAge > MAX_QR_PENDING_MS) {
        console.log(`[BAILEYS] 🧹 Cleaning up stale QR state (>5 min old, ${Math.round(stateAge/1000)}s)`);
        
        // Reset in-memory state
        const session = activeSessions.get(agentId);
        if (session) {
          session.qrCode = null;
          session.qrGeneratedAt = null;
          session.connectionState = 'disconnected';
        }
        qrGenerationTracker.delete(agentId);
        
        // Update database
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({ 
            status: 'disconnected',
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
      }
    }
  } catch (error) {
    console.error(`[BAILEYS] Error in cleanupStaleQRState:`, error.message);
    // Don't throw - cleanup failures shouldn't block initialization
  }
}

async function initializeWhatsApp(agentId, userId = null) {
  // Check if agent should be handled by this instance (before main try block)
  if (instanceManager.isActive) {
    try {
      const assignedInstance = await instanceManager.getAgentInstance(agentId);
      
      if (assignedInstance && assignedInstance !== instanceManager.instanceId) {
        // Check if the assigned instance is still alive
        const activeInstances = await instanceManager.getActiveInstances();
        const isAssignedInstanceAlive = activeInstances.some(inst => inst.instanceId === assignedInstance);
        
        if (isAssignedInstanceAlive) {
          loggers.connection.info({
            agentId: shortId(agentId),
            assignedTo: assignedInstance,
            thisInstance: instanceManager.instanceId
          }, 'Agent assigned to different active instance, skipping');
          return { 
            success: false, 
            reason: 'agent_assigned_to_different_instance',
            assignedInstance 
          };
        } else {
          // Assigned instance is dead, clear assignment and allow takeover
          loggers.connection.warn({
            agentId: shortId(agentId),
            assignedTo: assignedInstance,
            thisInstance: instanceManager.instanceId
          }, 'Assigned instance is dead, taking over agent');
          
          // Clear the stale assignment
          await instanceManager.unassignAgent(agentId);
          
          // Also clear from database if instance tracking exists
          try {
            const { error: dbError } = await supabaseAdmin
              .from('whatsapp_sessions')
              .update({ 
                instance_id: null,
                status: 'disconnected'
              })
              .eq('agent_id', agentId);
              
            if (dbError) {
              loggers.connection.warn({ error: dbError.message }, 'Failed to clear stale instance assignment from database');
            }
          } catch (dbErr) {
            loggers.connection.warn({ error: dbErr.message }, 'Error clearing stale instance assignment');
          }
        }
      }
      
      // Check if this instance can accept more agents
      if (!instanceManager.canAcceptMoreAgents()) {
        loggers.connection.warn({
          agentId: shortId(agentId),
          currentAgents: instanceManager.assignedAgentCount,
          maxAgents: 200
        }, 'Instance at capacity');
        
        // Find and suggest least loaded instance
        const leastLoaded = await instanceManager.getLeastLoadedInstance();
        return {
          success: false,
          reason: 'instance_at_capacity',
          suggestedInstance: leastLoaded.instanceId
        };
      }
      
      // Assign agent to this instance
      await instanceManager.assignAgent(agentId);
    } catch (error) {
      loggers.connection.warn({ error: error.message }, 'Instance manager check failed, continuing anyway');
    }
  }
  
  loggers.connection.info({ agentId: shortId(agentId) }, 'Starting WhatsApp initialization');
  
  try {
    
  console.log(`\n[BAILEYS] ==================== INITIALIZATION START ====================`);
  console.log(`[BAILEYS] Initializing WhatsApp for agent: ${agentId.substring(0, 40)}`);
  console.log(`[BAILEYS] Node: ${process.version}, Platform: ${process.platform}`);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CRITICAL: Prevent race condition - only ONE initialization at a time per agent
  // This prevents startup, reconnectAllAgents, and connectionMonitor from competing
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const lockValue = connectionLocks.get(agentId);
  if (lockValue) {
    // Check if it's a timestamp (new format) or boolean (old format from safeInitializeWhatsApp)
    const lockAge = typeof lockValue === 'number' ? Date.now() - lockValue : 0;
    
    // If lock is older than 90 seconds, consider it stale and clear it
    if (typeof lockValue === 'number' && lockAge > 90000) {
      console.log(`[BAILEYS] ⚠️ Clearing stale initialization lock (${Math.round(lockAge/1000)}s old)`);
      connectionLocks.delete(agentId);
    } else {
      console.log(`[BAILEYS] ⏸️ Initialization already in progress, checking session state...`);
      
      // Return current session state if exists and is valid
      const existingSession = activeSessions.get(agentId);
      if (existingSession?.isConnected) {
        console.log(`[BAILEYS] ✅ Session already connected, returning existing state`);
        return {
          success: true,
          status: 'connected',
          qrCode: null,
          phoneNumber: existingSession.phoneNumber,
          isActive: true
        };
      }
      
      if (existingSession?.qrCode) {
        console.log(`[BAILEYS] ✅ QR already pending, returning existing state`);
        return {
          success: true,
          status: 'qr_pending',
          qrCode: existingSession.qrCode,
          phoneNumber: null,
          isActive: false
        };
      }
      
      console.log(`[BAILEYS] ⏸️ No valid session state, waiting for current init to complete...`);
      return {
        success: false,
        error: 'Initialization already in progress',
        status: 'initializing'
      };
    }
  }
  
  // Set initialization lock with timestamp
  connectionLocks.set(agentId, Date.now());
  console.log(`[BAILEYS] 🔒 Initialization lock acquired`);
  
  emitAgentEvent(agentId, 'status', { status: 'initializing' });
  
  // CRITICAL: Check network connectivity first
  const networkOk = await checkNetworkRequirements();
  if (!networkOk) {
    console.error(`[BAILEYS] ❌ Network check failed - aborting`);
    throw new Error('Cannot reach WhatsApp servers. Check network/firewall settings.');
  }
  
  // CRITICAL: Ensure agent isolation - prevent credential sharing
  try {
    await ensureAgentIsolation(agentId);
  } catch (error) {
    console.error(`[BAILEYS] ❌ Agent isolation failed:`, error.message);
    return {
      success: false,
      error: error.message,
      status: 'error'
    };
  }
  
    // CRITICAL FIX: Cleanup stale QR states before checking
    await cleanupStaleQRState(agentId);
    
    // Prevent multiple initializations
    if (activeSessions.has(agentId)) {
      const existingSession = activeSessions.get(agentId);
      
      // CRITICAL FIX: Check if there's BOTH a recent QR generation AND an active QR code
      const qrGenTime = qrGenerationTracker.get(agentId);
      let hasActiveQR = existingSession?.qrCode !== null;
      const QR_COOLDOWN_MS = 120000; // 2 minutes
      const isWithinCooldown = qrGenTime && (Date.now() - qrGenTime) < QR_COOLDOWN_MS;
      
      // Clear expired QR codes before checking
      clearExpiredQR(agentId);
      hasActiveQR = existingSession?.qrCode !== null; // Re-check after clearing
      
      if (isWithinCooldown && hasActiveQR) {
        console.log(`[BAILEYS] ⏸️ QR already generated recently and still active`);
        console.log(`[BAILEYS] 📊 QR State:`, {
          hasQRInMemory: !!existingSession.qrCode,
          qrGeneratedAt: existingSession.qrGeneratedAt ? new Date(existingSession.qrGeneratedAt).toISOString() : null,
          cooldownRemaining: Math.round((QR_COOLDOWN_MS - (Date.now() - qrGenTime)) / 1000) + 's',
          socketState: existingSession.socket?.ws?.readyState
        });
        return {
          success: true,
          status: 'qr_pending',
          qrCode: existingSession.qrCode,
          phoneNumber: existingSession.phoneNumber,
          isActive: existingSession.isConnected
        };
      }
      
      // If cooldown active but QR expired/missing, force new generation
      if (isWithinCooldown && !hasActiveQR) {
        console.log(`[BAILEYS] ⚠️ Cooldown active but QR expired/missing - forcing new generation`);
        qrGenerationTracker.delete(agentId); // Clear cooldown to allow generation
      }
      
      if (existingSession.socket && existingSession.isConnected) {
        console.log(`[BAILEYS] ✅ Existing connection found`);
        return {
          success: true,
          status: 'authenticated',
          phoneNumber: existingSession.phoneNumber,
          isActive: true
        };
      }
      
      console.log(`[BAILEYS] 🧹 Cleaning up stale session`);
      if (existingSession.socket) {
        existingSession.socket.ev.removeAllListeners();
        existingSession.socket.end();
      }
      await removeAgentFromActiveSessions(agentId);
      qrGenerationTracker.delete(agentId);
    }

    // CRITICAL FIX: Check database status and force QR if needed
    // If database says qr_pending but we have no QR in memory, force generation
    console.log(`[BAILEYS] 🔍 Checking database status FIRST (before local files)...`);
    const { data: dbSessionStatus, error: dbStatusError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, is_active, disconnected_at, session_data, qr_code, updated_at')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    const currentState = activeSessions.get(agentId);
    if (dbSessionStatus?.status === 'qr_pending' && (!currentState || !currentState.qrCode)) {
      console.log(`[BAILEYS] 🔄 QR pending but missing - forcing new generation`);
      // Reset cooldown to allow immediate generation
      qrGenerationTracker.delete(agentId);
      // Clear any stale session
      if (currentState) {
        await removeAgentFromActiveSessions(agentId);
      }
    }
    
    if (dbStatusError) {
      console.warn(`[BAILEYS] ⚠️ Error checking database status:`, dbStatusError);
    }
    
    // FIX 5: Use smart status check before deleting credentials
    // Only delete if it's an old disconnect, not a recent pairing
    if (dbSessionStatus && dbSessionStatus.status === 'disconnected') {
      const shouldDelete = await shouldDeleteCredentials(agentId);
      
      if (shouldDelete) {
        console.log(`[BAILEYS] ⚠️ Database status is 'disconnected' (old) - forcing fresh start`);
        console.log(`[BAILEYS] This indicates a manual disconnect - all credentials must be cleared`);
        
        // Delete local auth directory completely (with error handling)
        const authPath = path.join(__dirname, '../../auth_sessions', agentId);
        if (fs.existsSync(authPath)) {
          console.log(`[BAILEYS] 🗑️ Deleting local auth directory (disconnected session)...`);
          try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log(`[BAILEYS] ✅ Local credentials deleted successfully`);
          } catch (deleteError) {
            console.error(`[BAILEYS] ❌ Failed to delete local auth directory:`, deleteError.message);
            console.error(`[BAILEYS] Error details:`, deleteError);
            // Continue anyway - database cleanup is more important
            // User may need to manually delete directory if permissions issue
          }
        } else {
          console.log(`[BAILEYS] ℹ️ No local auth directory to delete`);
        }
        
        // Clear database session data completely
        try {
          const { error: dbClearError } = await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              session_data: null,
              qr_code: null,
              qr_generated_at: null,
              is_active: false,
              status: 'disconnected',
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          if (dbClearError) {
            console.error(`[BAILEYS] ❌ Failed to clear database session data:`, dbClearError);
            throw new Error(`Database cleanup failed: ${dbClearError.message}`);
          }
          console.log(`[BAILEYS] ✅ Database cleared successfully`);
        } catch (dbError) {
          console.error(`[BAILEYS] ❌ Database cleanup error:`, dbError);
          // Don't throw - allow initialization to continue with fresh QR
        }
        
        console.log(`[BAILEYS] ✅ Fresh start complete - will generate fresh QR`);
        // Continue to fresh QR generation below
      } else {
        console.log(`[BAILEYS] ℹ️ Status is 'disconnected' but recent - keeping credentials for reconnect`);
        // Don't delete credentials - they were just saved after pairing
        // Continue to try authenticated connection
      }
    }
    
    // Mark session as initializing in database before proceeding
    try {
      await supabaseAdmin
        .from('whatsapp_sessions')
        .upsert({
          agent_id: agentId,
          status: 'initializing',
          is_active: false,
          phone_number: null,
          qr_code: null,
          qr_generated_at: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'agent_id' });
    } catch (dbPrepError) {
      console.warn(`[BAILEYS] ⚠️ Failed to mark session initializing:`, dbPrepError.message);
    }

    // Load auth state using Baileys' built-in function
    console.log(`[BAILEYS] 📂 Loading authentication state...`);
    const authPath = path.join(__dirname, '../../auth_sessions', agentId);

    // CRITICAL FIX B: Only check local files if status is NOT 'disconnected'
    // If we just cleared everything above, skip local file check
    const credsFile = path.join(authPath, 'creds.json');
    const hasValidCreds = fs.existsSync(credsFile) && 
                         dbSessionStatus && 
                         dbSessionStatus.status !== 'disconnected';
    
    let useFileAuth = false;
    
    if (hasValidCreds) {
      try {
        const credsContent = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
        
        // Simple check: Do we have a paired device?
        const isPaired = credsContent.me && credsContent.me.id;
        
        if (isPaired) {
          console.log(`[BAILEYS] ✅ Found credentials with paired device - loading...`);
          console.log(`[BAILEYS] Device ID: ${credsContent.me.id.split(':')[0]}`);
          useFileAuth = true;
        } else {
          console.log(`[BAILEYS] ℹ️  Credentials exist but no paired device - will generate QR`);
        }
      } catch (error) {
        console.log(`[BAILEYS] ⚠️ Error reading credentials:`, error.message);
        // Delete corrupted credentials
        if (fs.existsSync(authPath)) {
          console.log(`[BAILEYS] 🗑️ Deleting corrupted credentials...`);
          fs.rmSync(authPath, { recursive: true, force: true });
        }
      }
    } else {
      if (!fs.existsSync(credsFile)) {
        console.log(`[BAILEYS] 🆕 No credentials file found locally`);
      } else if (dbSessionStatus?.status === 'disconnected') {
        // FIX 1: Check if this is a RECENT disconnect after pairing (error 515)
        const recentDisconnect = dbSessionStatus.updated_at 
          ? (Date.now() - new Date(dbSessionStatus.updated_at).getTime()) < 60000 // Within last 60 seconds
          : false;
        
        if (recentDisconnect) {
          console.log(`[BAILEYS] ✅ Recent disconnect after pairing - KEEPING credentials for reconnection`);
          // Use credentials from file
          try {
            const credsContent = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
            const isPaired = credsContent.me && credsContent.me.id;
            if (isPaired) {
              console.log(`[BAILEYS] ✅ Found paired credentials - will use them`);
              useFileAuth = true;
            }
          } catch (error) {
            console.log(`[BAILEYS] ⚠️ Error reading credentials:`, error.message);
          }
        } else {
          console.log(`[BAILEYS] ⚠️ Local credentials exist but status is 'disconnected' (old) - ignoring local file`);
        }
      }
      
      // FIX 1 & 4: Check database status for reconnecting after pairing or pairing complete
      if (!useFileAuth && dbSessionStatus) {
        const isReconnectingAfterPairing = dbSessionStatus.status === 'reconnecting_after_pairing';
        const isPairingComplete = dbSessionStatus.status === 'pairing_complete';
        const isRecentPairing = dbSessionStatus.last_paired_at && 
          (Date.now() - new Date(dbSessionStatus.last_paired_at).getTime()) < 300000; // Within 5 minutes
        
        if (isReconnectingAfterPairing || isPairingComplete || isRecentPairing) {
          // This is a recent pairing - try to restore credentials
          console.log(`[BAILEYS] 🔍 Recent pairing detected - checking Supabase for credentials...`);
          const restored = await restoreCredsFromDatabase(agentId);
          
          if (restored) {
            console.log(`[BAILEYS] ✅ Credentials restored from Supabase - will use them`);
            useFileAuth = true;
          } else {
            console.log(`[BAILEYS] ⚠️ No credentials in database - will generate QR`);
          }
        } else if (dbSessionStatus.status !== 'disconnected' && dbSessionStatus.status !== 'conflict') {
          // Normal status - try to restore from database
          console.log(`[BAILEYS] 🔍 Checking Supabase for backed-up credentials...`);
          const restored = await restoreCredsFromDatabase(agentId);
          
          if (restored) {
            console.log(`[BAILEYS] ✅ Credentials restored from Supabase - will use them`);
            useFileAuth = true;
          } else {
            console.log(`[BAILEYS] 🆕 No credentials in Supabase either - will generate QR`);
          }
        } else {
          console.log(`[BAILEYS] ⚠️ Status is '${dbSessionStatus.status}' (old disconnect) - skipping database restore, will generate fresh QR`);
        }
      }
    }

    let state, saveCredsToFile;
    
    if (useFileAuth) {
      // Load existing credentials from files
      console.log(`[BAILEYS] 📂 Loading credentials from files...`);
      
      // REMOVED: Strict integrity check - trust Baileys' format
      // Baileys validates its own credential format when loading
      
      const authState = await useMultiFileAuthState(authPath);
      state = authState.state;
      saveCredsToFile = authState.saveCreds;
      
      console.log(`[BAILEYS] 🔍 Loaded auth state:`, {
        hasCreds: !!state.creds,
        registered: state.creds?.registered,
        hasMe: !!state.creds?.me,
        hasDeviceId: !!state.creds?.me?.id,
        hasNoiseKey: !!state.creds?.noiseKey,
        hasSignedIdentityKey: !!state.creds?.signedIdentityKey
      });
    }
    
    if (!useFileAuth) {
      // Create COMPLETELY FRESH state for QR generation  
      console.log(`[BAILEYS] 🆕 Creating fresh auth state for QR generation...`);
      
      // FIX 5: Only delete if credentials are truly invalid (old disconnect)
      const minutesSinceUpdate = dbSessionStatus?.updated_at 
        ? (Date.now() - new Date(dbSessionStatus.updated_at).getTime()) / 60000
        : 999;
      
      if (fs.existsSync(authPath)) {
        if (minutesSinceUpdate > 10) {
          // Old credentials (>10 min), safe to delete
          console.log(`[BAILEYS] 🗑️ Deleting OLD auth directory (>10 min since update: ${minutesSinceUpdate.toFixed(1)} min)`);
          fs.rmSync(authPath, { recursive: true, force: true });
        } else {
          // Recent activity, keep credentials
          console.log(`[BAILEYS] ✅ Recent credentials exist (<10 min: ${minutesSinceUpdate.toFixed(1)} min) - keeping for reconnection`);
          // Don't delete - credentials might be valid
        }
      }
      
      // Create directory if it doesn't exist or was deleted
      if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
        console.log(`[BAILEYS] 📁 Created fresh auth directory`);
      }
      
      // Load completely fresh state (no existing files)
      const authState = await useMultiFileAuthState(authPath);
      state = authState.state;
      saveCredsToFile = authState.saveCreds;
      
      console.log(`[BAILEYS] 🔍 Fresh state initialized:`, {
        hasCreds: !!state.creds,
        registered: state.creds?.registered,
        hasMe: !!state.creds?.me,
        willGenerateQR: !state.creds || !state.creds.me
      });
    }

    // CRITICAL: Wrap saveCreds with atomic writes and credential validation
    const saveCreds = async () => {
      try {
        // CRITICAL: Validate credential integrity BEFORE saving
        const currentCreds = state.creds;
        
        // Check 1: Ensure required keys exist
        if (!currentCreds.noiseKey || !currentCreds.signedIdentityKey || !currentCreds.signedPreKey) {
          console.error(`[BAILEYS] ❌ CRITICAL: Incomplete credentials detected, skipping save`);
          console.error(`[BAILEYS] Missing keys:`, {
            hasNoiseKey: !!currentCreds.noiseKey,
            hasSignedIdentityKey: !!currentCreds.signedIdentityKey,
            hasSignedPreKey: !!currentCreds.signedPreKey
          });
          return; // Don't save corrupted credentials
        }
        
        // Check 2: Validate key buffer lengths (prevent truncated keys)
        if (currentCreds.noiseKey?.private) {
          try {
            const keyLen = getKeyLength(currentCreds.noiseKey.private);
            if (keyLen !== 32) {
              console.error(`[BAILEYS] ❌ CRITICAL: Noise key has invalid length (${keyLen}), expected 32`);
              return; // Don't save corrupted credentials
            }
          } catch (e) {
            console.error(`[BAILEYS] ❌ CRITICAL: Cannot validate noise key length: ${e.message}`);
            return; // Don't save corrupted credentials
          }
        }
        
        // REMOVED: Strict validation - trust Baileys' internal credential format
        // Baileys validates credentials when they're created/updated
        
        // CRITICAL: Ensure directory exists before saving (with error handling)
        try {
          if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
            console.log(`[BAILEYS] 📁 Created auth directory: ${authPath}`);
          }
        } catch (mkdirError) {
          console.error(`[BAILEYS] ❌ Error creating auth directory:`, mkdirError);
          throw new Error(`Failed to create auth directory: ${mkdirError.message}`);
        }
        
        // Verify directory exists before attempting to save
        if (!fs.existsSync(authPath)) {
          throw new Error(`Auth directory does not exist after creation attempt: ${authPath}`);
        }
        
        // FIX 2: Windows-safe atomic write pattern to prevent file corruption and permission errors
        const credsPath = path.join(authPath, 'creds.json');
        const credsData = JSON.stringify(currentCreds, null, 2);
        
        // Windows-safe atomic write with fallback logic
        try {
          // Try direct write first (works if file isn't locked)
          fs.writeFileSync(credsPath, credsData, { encoding: 'utf-8', flag: 'w' });
          console.log(`[BAILEYS] ✅ Credentials saved directly to ${credsPath}`);
        } catch (directError) {
          // Fallback: write to temp file then rename (atomic)
          const tempPath = path.join(authPath, `creds.json.tmp.${Date.now()}`);
          
          try {
            // Step 1: Write to temporary file first
            fs.writeFileSync(tempPath, credsData, { encoding: 'utf-8', flag: 'w' });
            
            // Step 2: Verify temp file is readable and valid JSON
            const verifyData = fs.readFileSync(tempPath, 'utf-8');
            JSON.parse(verifyData); // Will throw if invalid JSON
            
            // Step 3: Delete original if exists (Windows-safe)
            try {
              if (fs.existsSync(credsPath)) {
                fs.unlinkSync(credsPath);
              }
            } catch (unlinkError) {
              // If unlink fails, continue anyway - rename might still work
              console.log(`[BAILEYS] ⚠️ Could not delete old creds file: ${unlinkError.message}`);
            }
            
            // Step 4: Atomic rename (replaces old file safely)
            try {
              fs.renameSync(tempPath, credsPath);
              console.log(`[BAILEYS] ✅ Credentials saved atomically to ${credsPath}`);
            } catch (renameError) {
              // Last resort: just overwrite directly
              console.log(`[BAILEYS] ⚠️ Atomic rename failed (${renameError.message}), using direct overwrite`);
              fs.writeFileSync(credsPath, credsData, { encoding: 'utf-8', flag: 'w' });
              
              // Clean up temp file
              try {
                fs.unlinkSync(tempPath);
              } catch (e) {
                // Ignore cleanup errors
              }
            }
            
          } catch (atomicError) {
            // Last resort: just overwrite
            console.error(`[BAILEYS] ⚠️ Atomic save failed (${atomicError.message}), using direct overwrite`);
            
            try {
              fs.writeFileSync(credsPath, credsData, { encoding: 'utf-8', flag: 'w' });
              console.log(`[BAILEYS] ✅ Credentials saved via direct overwrite`);
            } catch (overwriteError) {
              console.error(`[BAILEYS] ❌ All save methods failed: ${overwriteError.message}`);
              throw overwriteError;
            }
            
            // Clean up temp file if it exists
            if (fs.existsSync(tempPath)) {
              try {
                fs.unlinkSync(tempPath);
              } catch (e) {
                // Ignore cleanup errors
              }
            }
          }
        }
        
        // Also save keys using original function
        await saveCredsToFile(); // This saves other key files
        
        // Sync to database with file locking
        await syncCredsToDatabase(agentId);
        
      } catch (error) {
        console.error(`[BAILEYS] ❌ CRITICAL ERROR saving credentials:`, error.message);
        console.error(`[BAILEYS] Error details:`, error);
        
        // If save fails, mark credentials as potentially corrupted
        const currentSession = activeSessions.get(agentId);
        if (currentSession) {
          currentSession.credentialError = error.message;
          currentSession.credentialErrorAt = Date.now();
        }
        
        // Don't throw - allow connection to continue, but log the error
      }
    };

    const credStatus = state.creds ? `🔑 Loaded credentials (registered: ${state.creds.registered})` : '🆕 No credentials - will generate QR';
    console.log(`[BAILEYS] ${credStatus}`);
    
    // CRITICAL FIX: Determine connection strategy based on ACTUAL paired device indicators
    // The `registered` flag is NOT reliable after restart - it stays false even for valid sessions
    // Instead, check for: me.id (device ID) + signal keys (noiseKey, signedIdentityKey)
    const hasDeviceId = !!state.creds?.me?.id;
    const hasSignalKeys = !!(state.creds?.noiseKey && state.creds?.signedIdentityKey);
    const hasPairedDevice = hasDeviceId && hasSignalKeys;
    
    // FIX 4: Check database status for reconnecting after pairing
    const { data: sessionStatus } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, last_paired_at')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    const justPairedRecently = sessionStatus?.last_paired_at 
      ? (Date.now() - new Date(sessionStatus.last_paired_at).getTime()) < 300000 // 5 minutes
      : false;
    
    const isReconnectingAfterPairing = 
      sessionStatus?.status === 'reconnecting_after_pairing' ||
      sessionStatus?.status === 'pairing_complete';
    
    // FIX 4: Use credentials if we have device ID OR if we just paired recently
    const willUseCredentials = (hasPairedDevice && hasSignalKeys && hasDeviceId) || 
                              (isReconnectingAfterPairing && justPairedRecently && hasSignalKeys);
    
    const shouldGenerateQR = !willUseCredentials;
    
    console.log('[BAILEYS] 🔍 Connection Strategy:', {
      hasDeviceId,
      hasSignalKeys,
      hasPairedDevice,
      isReconnectingAfterPairing,
      justPairedRecently,
      willUseCredentials,
      willGenerateQR: shouldGenerateQR,
      deviceId: hasDeviceId ? state.creds.me.id.split(':')[0] : null
    });
    
    // If we have paired device or are reconnecting after pairing, clear QR trackers - expect direct connection
    if (willUseCredentials) {
      console.log('[BAILEYS] ✅ Using existing credentials - expecting direct connection (no QR)');
      qrGenerationTracker.delete(agentId);
    }
    
    // CRITICAL: Fetch latest Baileys version for compatibility
    console.log(`[BAILEYS] 🔍 Fetching latest Baileys version...`);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[BAILEYS] Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);
    
    // CRITICAL: Create socket with proper config
    console.log(`[BAILEYS] 🔌 Creating WebSocket connection...`);
    
    // CRITICAL: Enhanced logger to intercept raw protocol messages and extract sender_pn for @lid messages
    // Use trace level to catch ALL logs, and intercept at PARENT logger level (not just child)
    const customLogger = pino({ level: 'trace' });
    
    // Intercept at PARENT logger level (trace, debug, info) to catch protocol messages BEFORE processing
    const originalTrace = customLogger.trace.bind(customLogger);
    const originalDebug = customLogger.debug.bind(customLogger);
    const originalInfo = customLogger.info.bind(customLogger);
    
    customLogger.trace = function(obj, msg) {
      interceptSenderPn(obj);
      return originalTrace(obj, msg);
    };
    
    customLogger.debug = function(obj, msg) {
      interceptSenderPn(obj);
      return originalDebug(obj, msg);
    };
    
    customLogger.info = function(obj, msg) {
      interceptSenderPn(obj);
      return originalInfo(obj, msg);
    };
    
    // Helper function to extract and cache sender_pn AND peer_recipient_pn from protocol messages
    function interceptSenderPn(obj) {
      if (obj && typeof obj === 'object') {
        // Check for recv.attrs (message receive) - this is where sender_pn and peer_recipient_pn appear in protocol logs
        if (obj.recv && obj.recv.attrs) {
          const attrs = obj.recv.attrs;
          
          // INCOMING MESSAGE: Extract sender_pn from @lid messages
          if (attrs.from && attrs.from.endsWith('@lid') && attrs.sender_pn) {
            const lidJid = attrs.from;
            const senderPn = attrs.sender_pn;
            // Extract just the phone number (remove @s.whatsapp.net if present)
            const phoneNumber = senderPn.includes('@') 
              ? senderPn.split('@')[0] 
              : senderPn;
            const senderJid = `${phoneNumber}@s.whatsapp.net`;
            lidToPhoneCache.set(lidJid, senderJid);
            console.log(`[BAILEYS] 🔍 LOGGER INTERCEPT: Cached sender_pn ${lidJid} -> ${phoneNumber}`);
          }
          
          // OUTGOING MESSAGE: Extract peer_recipient_pn from @lid messages
          if (attrs.recipient && attrs.recipient.endsWith('@lid') && attrs.peer_recipient_pn) {
            const recipientLidJid = attrs.recipient;
            const peerRecipientPn = attrs.peer_recipient_pn;
            const phoneNumber = peerRecipientPn.includes('@')
              ? peerRecipientPn.split('@')[0]
              : peerRecipientPn;
            const recipientJid = `${phoneNumber}@s.whatsapp.net`;
            lidToPhoneCache.set(recipientLidJid, recipientJid);
            console.log(`[BAILEYS] 🔍 LOGGER INTERCEPT: Cached peer_recipient_pn ${recipientLidJid} -> ${phoneNumber}`);
          }
        }
      }
    }
    
    // Also intercept child loggers (for completeness)
    const originalChild = customLogger.child.bind(customLogger);
    customLogger.child = function(bindings) {
      const child = originalChild(bindings);
      // Intercept all log methods to catch protocol messages
      ['info', 'debug', 'trace'].forEach(method => {
        const originalMethod = child[method];
        if (originalMethod && typeof originalMethod === 'function') {
          child[method] = function(obj, msg) {
            interceptSenderPn(obj);
            return originalMethod.call(this, obj, msg);
          };
        }
      });
      return child;
    };
    
    const sock = makeWASocket({
      // CRITICAL: Use proper auth structure with cacheable signal key store
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      version, // Use fetched version
      printQRInTerminal: true, // CRITICAL: Enable for debugging!
      logger: customLogger, // Use custom logger to intercept sender_pn
      browser: Browsers.ubuntu('Chrome'),
      
      // CRITICAL: Proper keepalive configuration
      keepAliveIntervalMs: 30000, // Changed from 10s to 30s (less aggressive)
      defaultQueryTimeoutMs: 60000, // Reduced from 180s to 60s
      connectTimeoutMs: 60000, // Reduced from 180s to 60s
      qrTimeout: 60000, // Standard QR timeout
      
      retryRequestDelayMs: 2000, // Increased from 1s to 2s
      maxMsgRetryCount: 5, // Reduced from 10 to 5
      
      // IMPORTANT: Remove emitOwnEvents and fireInitQueries
      // Let Baileys handle these internally
      
      // CRITICAL: getMessage handler - return undefined to prevent errors
      getMessage: async (key) => {
        return undefined;
      },
      
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: true // Changed to true - helps maintain connection
    });

    console.log(`[BAILEYS] ✅ Socket created with EXTENDED timeouts for pairing (3min)`);
    console.log(`[BAILEYS] ℹ️  This allows more time for QR scan -> credential exchange`);
    console.log(`[BAILEYS] 🔍 Socket info:`, {
      socketExists: !!sock,
      hasEventEmitter: !!sock.ev,
      hasWebSocket: !!sock.ws,
      timestamp: new Date().toISOString()
    });
    
    // CRITICAL: Try to intercept raw WebSocket messages BEFORE Baileys processes them
    // This is APPROACH 2 - intercept raw socket messages if accessible
    if (sock.ws && typeof sock.ws.on === 'function') {
      try {
        // Intercept raw WebSocket messages to extract sender_pn
        sock.ws.on('message', (data) => {
          // REMOVED: lastActivity tracking - we can't reliably track it
          
          try {
            // Baileys uses binary protocol, but we can try to parse JSON if it's text
            if (typeof data === 'string') {
              const parsed = JSON.parse(data);
              if (parsed.attrs?.from?.endsWith('@lid') && parsed.attrs?.sender_pn) {
                const lidJid = parsed.attrs.from;
                const senderPn = parsed.attrs.sender_pn;
                const phoneNumber = senderPn.includes('@') ? senderPn.split('@')[0] : senderPn;
                const senderJid = `${phoneNumber}@s.whatsapp.net`;
                lidToPhoneCache.set(lidJid, senderJid);
                console.log(`[BAILEYS] 🔍 RAW SOCKET: Cached sender_pn ${lidJid} -> ${phoneNumber}`);
              }
            }
          } catch (e) {
            // Ignore parse errors - Baileys uses binary protocol, not JSON
          }
        });
        console.log(`[BAILEYS] ✅ Raw WebSocket message interceptor attached`);
        
        // REMOVED: WebSocket debugging listeners - not needed and adds noise
      } catch (wsError) {
        console.log(`[BAILEYS] ⚠️ Could not attach raw WebSocket interceptor: ${wsError.message}`);
      }
    } else {
      console.log(`[BAILEYS] ℹ️ Raw WebSocket not accessible (this is normal - Baileys may not expose it)`);
    }

    // CRITICAL: Register creds.update handler with validation
    sock.ev.on('creds.update', async () => {
      console.log(`[BAILEYS] 🔐 ============ CREDS.UPDATE FIRED ============`);
      try {
        // CRITICAL: Validate credential integrity BEFORE saving
        const currentCreds = state.creds;
        
        // Check 1: Ensure required keys exist
        if (!currentCreds.noiseKey || !currentCreds.signedIdentityKey || !currentCreds.signedPreKey) {
          console.error(`[BAILEYS] ❌ CRITICAL: Incomplete credentials detected, skipping save`);
          console.error(`[BAILEYS] Missing keys:`, {
            hasNoiseKey: !!currentCreds.noiseKey,
            hasSignedIdentityKey: !!currentCreds.signedIdentityKey,
            hasSignedPreKey: !!currentCreds.signedPreKey
          });
          return; // Don't save corrupted credentials
        }
        
        // Check 2: Validate key buffer lengths (prevent truncated keys)
        if (currentCreds.noiseKey?.private) {
          try {
            const keyLen = getKeyLength(currentCreds.noiseKey.private);
            if (keyLen !== 32) {
              console.error(`[BAILEYS] ❌ CRITICAL: Noise key has invalid length (${keyLen}), expected 32`);
              return; // Don't save corrupted credentials
            }
          } catch (e) {
            console.error(`[BAILEYS] ❌ CRITICAL: Cannot validate noise key length: ${e.message}`);
            return; // Don't save corrupted credentials
          }
        }
        
        // Check 3: Ensure keys haven't been corrupted mid-flight
        const keysChecksum = Buffer.from(JSON.stringify({
          noiseKey: currentCreds.noiseKey?.public?.toString('base64'),
          identityKey: currentCreds.signedIdentityKey?.public?.toString('base64')
        })).toString('base64');
        
        // Store checksum for future validation
        currentCreds._keysChecksum = keysChecksum;
        
        console.log(`[BAILEYS] ✅ Credential validation passed, saving...`);
        
        // saveCreds handles both file save and database sync with atomic writes
        await saveCreds();
        
        console.log(`[BAILEYS] ✅ Credentials saved successfully`);
        
        // FIX 2: Detect "Just Paired" State - Track when pairing completes
        // Detect if this is a fresh pairing (me field just got populated)
        const session = activeSessions.get(agentId);
        const wasPairedBefore = session?.wasPaired || false;
        const isJustPaired = currentCreds.me && currentCreds.me.id && !wasPairedBefore;
        
        if (isJustPaired) {
          const phoneNumber = currentCreds.me.id?.split(':')[0] || null;
          const deviceId = currentCreds.me.id;
          
          // Mark session as paired
          if (session) {
            session.wasPaired = true;
            session.lastPairingTime = Date.now();
          }
          
          console.log(`[BAILEYS] 🎉 PAIRING COMPLETED - Device ID: ${deviceId}`);
          console.log(`[BAILEYS] ℹ️ Expect 515 disconnect + reconnect using these credentials`);
          
          try {
            // Update database to indicate pairing just completed
            await supabaseAdmin
              .from('whatsapp_sessions')
              .update({
                status: 'pairing_complete',
                phone_number: phoneNumber,
                last_paired_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('agent_id', agentId);
            
            // Also update agents table if it exists
            try {
              await supabaseAdmin
                .from('agents')
                .update({
                  status: 'pairing_complete',
                  phone_number: phoneNumber,
                  last_paired_at: new Date().toISOString()
                })
                .eq('id', agentId);
            } catch (agentsError) {
              // agents table might not exist or have different schema - ignore
              console.log(`[BAILEYS] ℹ️ Could not update agents table:`, agentsError.message);
            }
            
            loggers.connection.info({
              agentId: shortId(agentId),
              phone: phoneNumber,
              deviceId: deviceId.split(':')[0]
            }, 'Pairing completed - expecting 515 reconnect');
            
          } catch (statusError) {
            console.error(`[BAILEYS] ❌ Failed to update pairing status:`, statusError.message);
            // Don't throw - credentials are saved, status update is secondary
          }
        } else if (currentCreds.me && currentCreds.me.id && currentCreds.registered !== false) {
          // Already paired - normal credential update
          const phoneNumber = currentCreds.me.id?.split(':')[0] || null;
          
          try {
            await supabaseAdmin
              .from('whatsapp_sessions')
              .update({
                status: 'connected',
                phone_number: phoneNumber,
                is_active: true,
                last_connected: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('agent_id', agentId);
            
            loggers.connection.info({
              agentId: shortId(agentId),
              phone: phoneNumber
            }, 'Status updated to connected');
          } catch (statusError) {
            console.error(`[BAILEYS] ❌ Failed to update status:`, statusError.message);
          }
        }
        
        console.log(`[BAILEYS] 🔐 ============ CREDS.UPDATE COMPLETE ============\n`);
      } catch (error) {
        console.error(`[BAILEYS] ❌ CRITICAL ERROR saving credentials:`, error.message);
        console.error(`[BAILEYS] Error details:`, error);
        
        // If save fails, mark credentials as potentially corrupted
        if (session) {
          session.credentialError = error.message;
          session.credentialErrorAt = Date.now();
        }
        
        // Don't throw - allow connection to continue, but log the error
      }
    });

    // Store session with health monitoring
    const sessionData = {
      socket: sock,
      state: state,
      saveCreds: saveCreds,
      phoneNumber: null,
      isConnected: false,
      qrCode: null,
      qrGeneratedAt: null,
      socketCreatedAt: Date.now(),
      connectionState: 'initializing',
      qrAttempts: 0,
      connectedAt: null,
      failureReason: null,
      failureAt: null,
      // FIX 2: Track pairing state
      wasPaired: false,
      lastPairingTime: null
    };
    
    activeSessions.set(agentId, sessionData);

    console.log(`[BAILEYS] ✅ Session stored in memory with health monitoring`);
    
    // CRITICAL: Start heartbeat mechanism for instance tracking
    const heartbeatInterval = setInterval(async () => {
      const session = activeSessions.get(agentId);
      if (!session) {
        clearInterval(heartbeatInterval);
        return;
      }
      
      if (session.isConnected) {
        try {
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              last_heartbeat: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
        } catch (error) {
          console.error(`[BAILEYS] Heartbeat failed for ${agentId}:`, error.message);
        }
      }
    }, 60000); // Every minute
    
    // Store heartbeat interval for cleanup
    sessionData.heartbeatInterval = heartbeatInterval;
    
    // CRITICAL: Periodic credential backup (every hour for connected sessions)
    const backupInterval = setInterval(async () => {
      const session = activeSessions.get(agentId);
      if (session && session.isConnected) {
        await backupCredentials(agentId);
      } else {
        clearInterval(backupInterval);
      }
    }, 60 * 60 * 1000); // Every hour
    
    sessionData.backupInterval = backupInterval;
    
    // CRITICAL: Add socket health check to detect premature disconnects
    // REMOVED: Health check interval - causes false disconnects
    // Baileys handles keepalive internally, we don't need to monitor it

    // FIX 1: Create connectionTracker for this connection attempt
    const connectionTracker = new OperationTracker('connection_establish', loggers.connection, 30000);
    
    // Connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;
      
      if (connection === 'close' && lastDisconnect) {
        const session = activeSessions.get(agentId);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const hasQR = !!session?.qrCode;
        const wasPairing = hasQR && !session?.isConnected;
        const errorMessage = lastDisconnect?.error?.message || '';
        
        // Only log significant close events (not normal QR timeout)
        if (statusCode && statusCode !== 515) { // 515 = QR timeout, expected
          console.log(`[BAILEYS] ❌ Connection closed: ${statusCode} - ${errorMessage || 'unknown'}`);
        }
        
        if (wasPairing && statusCode && statusCode !== 515) {
          // Connection closed during pairing (not QR timeout)
          console.log(`[BAILEYS] ⚠️ Connection closed during pairing - network issue or server rejection`);
        }
        
        // Record connection failure metric (skip QR timeout 515)
        if (statusCode && statusCode !== 515) {
          const reason = errorMessage || `status_${statusCode}`;
          const isRetryable = !RECONNECTION_CONFIG.nonRetryableCodes.includes(statusCode);
          recordMetric(() => {
            if (connectionMetrics?.failures) {
              connectionMetrics.failures.labels(
                shortId(agentId),
                reason.substring(0, 50), // Limit reason length
                isRetryable ? 'true' : 'false'
              ).inc();
            }
          });
          
          // Track error if there's an error object
          if (lastDisconnect?.error) {
            errorTracker.trackError(lastDisconnect.error, {
              agentId: shortId(agentId),
              operation: 'connection_close',
              statusCode: statusCode
            });
          }
        }
      }

      // Handle QR code - ONLY process if we don't have valid paired credentials
      if (qr) {
        const qrTracker = new OperationTracker('qr_generation', loggers.qr, 5000);
        const session = activeSessions.get(agentId);
        const qrAttempt = session ? session.qrAttempts + 1 : 1;

        // CRITICAL: Skip QR if already connected
        if (session?.isConnected) {
          console.log(`[BAILEYS] ⚠️ QR ignored - already connected`);
          return;
        }
        
        // CRITICAL: Skip QR if we have paired device credentials
        // QR should only be generated when there are NO valid credentials
        if (state.creds?.me?.id && state.creds?.registered !== false) {
          console.log(`[BAILEYS] ⚠️ QR ignored - have valid paired credentials, expecting direct connection`);
            return;
        }
        
        if (session) {
          session.connectionState = 'qr_pending';
        }
        
        loggers.qr.info({ agentId: shortId(agentId) }, 'QR code generated');
        
        // Store QR in session
        if (session) {
          session.qrCode = qr;
          session.qrGeneratedAt = Date.now();
          session.qrAttempts = qrAttempt;
        }
        
        qrGenerationTracker.set(agentId, Date.now());
        
        // Update database with QR code
        try {
          await supabaseAdmin
            .from('whatsapp_sessions')
            .upsert({
              agent_id: agentId,
              qr_code: qr,
              is_active: false,
              status: 'qr_pending',
              qr_generated_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'agent_id'
            });
        } catch (error) {
          console.error(`[BAILEYS] ❌ Error saving QR:`, error);
        }
        
        // Cache QR code in Redis for cross-instance access
        if (redisCache.isReady()) {
          await redisCache.cacheQRCode(agentId, qr)
            .catch(error => loggers.cache.warn({ error: error.message }, 'Failed to cache QR in Redis'));
        }
        
        // Emit QR code event
          emitAgentEvent(agentId, 'qr', { qr, attempt: qrAttempt });
          
          qrTracker.end({ agentId: shortId(agentId) });
          
          // ━━━ SOCKET.IO EMISSION FOR REAL-TIME QR ━━━
          try {
            const app = require('../../app');
            const io = app.get('io');
            if (io) {
              io.to(`whatsapp:${agentId}`).emit('whatsapp:qr', {
                agentId,
            qr,
            attempt: qrAttempt,
                timestamp: new Date().toISOString()
              });
              console.log(`[BAILEYS] 📡 QR emitted via Socket.IO to whatsapp:${agentId.substring(0, 8)}...`);
            }
          } catch (socketError) {
            // Socket.IO not critical - frontend can still poll
        }
        
        // ============================================
        // NEW: QR Code Expiration Logic
        // ============================================
        
        // Clear any existing QR expiration timer
        const existingQrTimer = QR_EXPIRATION_TIMERS.get(agentId);
        if (existingQrTimer) {
          clearTimeout(existingQrTimer);
        }
        
        // Set 180-second expiration timer (3 minutes - WhatsApp QR typically valid for 2-3 min)
        const qrTimerId = setTimeout(async () => {
          try {
            const currentSession = activeSessions.get(agentId);
            
            // Only clear if still not connected and QR hasn't changed
            if (currentSession && !currentSession.isConnected && currentSession.qrCode === qr) {
              loggers.qr.info({ agentId: shortId(agentId) }, 'QR code expired, clearing for regeneration');
              
              // Clear QR from session
              currentSession.qrCode = null;
              currentSession.qrGeneratedAt = null;
              
              // Clear QR from database
              await supabaseAdmin
                .from('whatsapp_sessions')
                .update({ 
                  qr_code: null,
                  qr_generated_at: null,
                  updated_at: new Date().toISOString()
                })
                .eq('agent_id', agentId);
              
              // Emit expiration event
              emitAgentEvent(agentId, 'qr-expired', { agentId });
              
              loggers.qr.info({ agentId: shortId(agentId) }, 'QR cleared, new QR will be generated on next connection attempt');
          }
        } catch (error) {
            loggers.qr.error({
              agentId: shortId(agentId),
              error: error.message,
              stack: error.stack
            }, 'Error clearing expired QR');
          } finally {
            // Clean up timer reference
            QR_EXPIRATION_TIMERS.delete(agentId);
          }
        }, 180000); // 180 seconds = 3 minutes (WhatsApp QR typically valid for 2-3 min)
        
        QR_EXPIRATION_TIMERS.set(agentId, qrTimerId);
        
        loggers.qr.debug({ agentId: shortId(agentId), expiresIn: 180 }, 'QR will expire in 180 seconds');
        
        // Enhanced QR logging
        console.log(`[BAILEYS] ========== QR CODE DETAILS ==========`);
        console.log(`[BAILEYS] Agent: ${agentId.substring(0, 8)}...`);
        console.log(`[BAILEYS] QR Generated: ${new Date().toISOString()}`);
        console.log(`[BAILEYS] QR Length: ${qr.length} characters`);
        console.log(`[BAILEYS] Socket State: ${session?.socket?.ws?.readyState ?? 'unknown'}`);
        console.log(`[BAILEYS] =====================================`);
      }

      // Enhanced logging for connection state changes
      if (connection) {
        console.log(`\n[BAILEYS] ========== CONNECTION STATE CHANGE ==========`);
        console.log(`[BAILEYS] Agent: ${agentId.substring(0, 8)}...`);
        console.log(`[BAILEYS] New State: ${connection}`);
        console.log(`[BAILEYS] Timestamp: ${new Date().toISOString()}`);
        
        if (lastDisconnect) {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMsg = lastDisconnect?.error?.message || 'none';
          console.log(`[BAILEYS] Status Code: ${statusCode || 'none'}`);
          console.log(`[BAILEYS] Error: ${errorMsg}`);
        }
        
        console.log(`[BAILEYS] =======================================\n`);
      }

      // Connection connecting state
      if (connection === 'connecting') {
        console.log(`[BAILEYS] 🔄 Connecting to WhatsApp...`);
      }

      // Connection success
      if (connection === 'open') {
        connectionTracker.end({ agentId: shortId(agentId), success: true });
        console.log(`\n[BAILEYS] ========== 🎉 CONNECTION SUCCESS 🎉 ==========`);
        
        qrGenerationTracker.delete(agentId);
        console.log(`[BAILEYS] 🛑 QR generation disabled for ${agentId.substring(0, 40)} (connection open)`);
        
        // CRITICAL: Clear 401 failure timestamp on successful connection
        last401Failure.delete(agentId);
        loggers.connection.info({ agentId: shortId(agentId) }, '401 failure cooldown cleared - connection successful');
        
        const phoneNumber = sock.user?.id || 'Unknown';
        const cleanPhone = phoneNumber.split(':')[0].replace('@s.whatsapp.net', '');
        
        loggers.connection.debug({
          agentId: shortId(agentId),
          userId: sock.user?.id
        }, 'User connected');
        loggers.connection.info({
          agentId: shortId(agentId),
          phone: cleanPhone
        }, 'Phone number identified');
        
        try {
          // CRITICAL: Use upsert to ensure row exists, and set status field
          const { data: updateResult, error: updateError } = await supabaseAdmin
              .from('whatsapp_sessions')
              .upsert({
                agent_id: agentId,
                phone_number: cleanPhone,
                status: 'connected',
                is_active: true,
                qr_code: null,
                qr_generated_at: null,
                last_connected: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                // Instance tracking
                instance_id: INSTANCE_ID,
                instance_hostname: INSTANCE_HOSTNAME,
                instance_pid: INSTANCE_PID,
                instance_started_at: new Date().toISOString(),
                last_heartbeat: new Date().toISOString()
              }, {
                onConflict: 'agent_id'
              })
              .select();
          
          if (updateError) {
            console.error(`[BAILEYS] ❌ DB update error:`, updateError);
          } else {
            loggers.database.info({ agentId: shortId(agentId) }, 'Database updated with upsert');
            loggers.connection.info({
              agentId: shortId(agentId),
              phone: cleanPhone,
              status: 'connected',
              isActive: true
            }, 'Connection status updated');
          }
          
          const session = activeSessions.get(agentId);
          if (session) {
            session.isConnected = true;
            session.phoneNumber = cleanPhone;
            session.qrCode = null;
            session.qrGeneratedAt = null;
            session.connectionState = 'open';
            session.connectedAt = Date.now();
            session.socketReadyState = session.socket?.ws?.readyState ?? null;
            session.failureReason = null;
            session.failureAt = null;
          }
          
          emitAgentEvent(agentId, 'connected', {
            phoneNumber: cleanPhone
          });
          
          // ━━━ SOCKET.IO EMISSION FOR CONNECTION SUCCESS ━━━
          try {
            const app = require('../../app');
            const io = app.get('io');
            if (io) {
              io.to(`whatsapp:${agentId}`).emit('whatsapp:connected', {
                agentId,
                status: 'connected',
                phoneNumber: cleanPhone,
                message: 'WhatsApp connected successfully!',
                timestamp: new Date().toISOString()
              });
              console.log(`[BAILEYS] 📡 Connection success emitted via Socket.IO`);
            }
          } catch (socketError) {
            console.error(`[BAILEYS] Socket.IO emit error:`, socketError.message);
          }
          
          loggers.connection.info({
            agentId: shortId(agentId),
            phone: cleanPhone
          }, 'WhatsApp fully connected');
          
          // Warm cache with connection data
          await sessionCache.setCachedUserId(agentId, userId || null)
            .catch(error => loggers.cache.warn({ error: error.message }, 'Failed to cache user ID'));
          
          if (cleanPhone) {
            await sessionCache.setCachedPhoneNumber(agentId, cleanPhone)
              .catch(error => loggers.cache.warn({ error: error.message }, 'Failed to cache phone number'));
          }
          
          await sessionCache.setCachedMetadata(agentId, {
            connectedAt: Date.now(),
            phoneNumber: cleanPhone,
            status: 'connected'
          }).catch(error => loggers.cache.warn({ error: error.message }, 'Failed to cache metadata'));
          
          loggers.connection.debug({ 
            agentId: shortId(agentId),
            cached: true
          }, 'Session data cached on connection');
          
          // CRITICAL: Release initialization lock now that connection is established
          connectionLocks.delete(agentId);
          loggers.connection.debug({ agentId: shortId(agentId) }, 'Initialization lock released');
          
          // ━━━ CLEAR RECONNECTION STATE ON SUCCESSFUL CONNECTION ━━━
          clearReconnectionState(agentId);
          
          // ━━━ CLEAR QR EXPIRATION TIMER ON SUCCESSFUL CONNECTION ━━━
          const qrTimerId = QR_EXPIRATION_TIMERS.get(agentId);
          if (qrTimerId) {
            clearTimeout(qrTimerId);
            QR_EXPIRATION_TIMERS.delete(agentId);
            loggers.qr.debug({ agentId: shortId(agentId) }, 'Cleared QR expiration timer - connection successful');
          }
          
          // ━━━ CONTACT SYNCHRONIZATION ━━━
          // Sync WhatsApp contacts when connection is established
          try {
            console.log(`[BAILEYS] 📇 Starting contact synchronization...`);
            
            // Setup real-time contact update listeners
            setupContactUpdateListeners(agentId, sock);
            
            // Trigger initial contact sync (non-blocking)
            // Note: Baileys loads contacts incrementally, so initial sync may be limited
            // Real-time listeners will handle most contacts as they're loaded
            syncContactsForAgent(agentId, sock)
              .then((result) => {
                if (result.total > 0) {
                  console.log(`[BAILEYS] ✅ Initial contact sync: ${result.success}/${result.total} contacts synced`);
                } else {
                  console.log(`[BAILEYS] ℹ️ Contacts will be synced via real-time events as they load`);
                }
              })
              .catch((syncError) => {
                console.error(`[BAILEYS] ⚠️ Contact sync error (non-critical):`, syncError.message);
                // Don't fail connection if sync fails
              });
          } catch (syncError) {
            console.error(`[BAILEYS] ⚠️ Contact sync setup error (non-critical):`, syncError.message);
            // Don't fail connection if sync setup fails
          }
          
          // ━━━ START MONITORING ━━━
          // Disconnection detection via:
          // 1. Connection events (immediate) - Baileys fires 'close' on disconnect
          // 2. Health ping monitor (60s) - Actively tests connection
          // 3. Database heartbeat (60s) - Multi-instance coordination
          // NOTE: WebSocket state monitor DISABLED (caused false reconnections)
          if (session) {
            startAllMonitoring(sock, agentId, session);
          }
          
        } catch (error) {
          console.error(`[BAILEYS] ❌ Error:`, error);
        }
      }

      // Connection close
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.output?.payload?.message || lastDisconnect?.error?.message || 'Unknown';
        const session = activeSessions.get(agentId);

        console.log(`[BAILEYS] 🔌 Connection closed for ${agentId.substring(0, 8)}`);
        console.log(`[BAILEYS] Status code: ${statusCode}, Reason: ${reason}`);
        
        // Update session state
        if (session) {
          session.isConnected = false;
          session.connectionState = 'close';
        }
        
        // Clear health check interval
        if (healthCheckIntervals.has(agentId)) {
          clearInterval(healthCheckIntervals.get(agentId));
          healthCheckIntervals.delete(agentId);
        }
        
        // Update database status
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({ 
            status: 'disconnected',
            is_active: false,
            disconnected_at: new Date().toISOString(),
            last_error: `Connection closed: ${statusCode} - ${reason}`,
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
        
        // ============================================
        // NEW: Automatic Reconnection Logic
        // ============================================
        
        // Determine if we should attempt reconnection
        if (statusCode !== DisconnectReason.loggedOut && shouldReconnect) {
          console.log(`[BAILEYS] 🔄 Triggering automatic reconnection for ${agentId.substring(0, 8)}`);
          
          // Trigger reconnection with exponential backoff
          attemptReconnection(agentId, statusCode, reason);
        } else {
          console.log(`[BAILEYS] ⏹️  Not reconnecting agent ${agentId.substring(0, 8)} - logged out or permanent failure`);
          
          // Clear any pending reconnection attempts
          clearReconnectionState(agentId);
          
          // Remove from active sessions
          await removeAgentFromActiveSessions(agentId);
        }
        
        // Emit disconnected event
        emitAgentEvent(agentId, 'disconnected', {
          reason,
          statusCode
        });
        
        // ━━━ CLEANUP ALL MONITORING ON DISCONNECT ━━━
        cleanupMonitoring(agentId);
        
        // ━━━ SOCKET.IO EMISSION FOR DISCONNECTION ━━━
        try {
          const app = require('../../app');
          const io = app.get('io');
          if (io) {
            io.to(`whatsapp:${agentId}`).emit('whatsapp:disconnected', {
              agentId,
              statusCode,
              reason,
              timestamp: new Date().toISOString()
            });
            console.log(`[BAILEYS] 📡 Disconnection emitted via Socket.IO`);
          }
        } catch (socketError) {
          // Socket.IO not critical
        }
        
        // CRITICAL: Handle 405 error specifically (Connection Failure before QR)
        if (statusCode === 405) {
          console.log(`[BAILEYS] ⚠️ Error 405 - Connection Failure (likely before QR generation)`);
          console.log(`[BAILEYS] This usually means:`);
          console.log(`  1. Network/firewall blocking WhatsApp servers`);
          console.log(`  2. Invalid auth state preventing QR generation`);
          console.log(`  3. WhatsApp Web servers temporarily unavailable`);
          
          // Delete auth directory and retry
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            console.log(`[BAILEYS] 🗑️ Deleting auth directory to force fresh QR...`);
            fs.rmSync(authDir, { recursive: true, force: true });
          }
          
          // Clear from active sessions but don't delete from DB (let user retry)
          await removeAgentFromActiveSessions(agentId);
          qrGenerationTracker.delete(agentId);
          connectionLocks.delete(agentId); // Release lock
          
          console.log(`[BAILEYS] ✅ Cleared for retry. User should click "Connect" again.`);
          return; // Don't continue processing
        }
        
        // CRITICAL: Handle error 440 - Stream Conflict (Session Replaced)
        if (statusCode === 440) {
          console.log(`[BAILEYS] ⚠️ Error 440 - Stream Conflict (session replaced)`);
          console.log(`[BAILEYS] This means the WhatsApp session was opened elsewhere`);
          console.log(`[BAILEYS] Common causes: Multiple devices, QR scanned again, or credential sharing`);
          
          // Mark session as conflict and clean up
          if (session) {
            session.isConnected = false;
            session.connectionState = 'conflict';
            session.failureReason = 'Session replaced - WhatsApp opened on another device';
            session.failureAt = Date.now();
          }
          
          // Stop health check and heartbeat to prevent warning spam
          // REMOVED: healthCheckInterval - no longer used
          if (session?.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
            session.heartbeatInterval = null;
            console.log(`[BAILEYS] ✅ Heartbeat stopped`);
          }
          
          // Clean up socket
          if (session?.socket) {
            try {
              session.socket.ev.removeAllListeners();
              session.socket.end();
            } catch (e) {
              console.log(`[BAILEYS] Socket cleanup: ${e.message}`);
            }
          }
          
          // Remove from active sessions
          await removeAgentFromActiveSessions(agentId);
          qrGenerationTracker.delete(agentId);
          connectionLocks.delete(agentId);
          
          // Clear auth directory - credentials are invalidated
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log(`[BAILEYS] 🗑️ Cleared auth directory (credentials invalidated)`);
          }
          
          // Update database
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              session_data: null,
              qr_code: null,
              qr_generated_at: null,
              is_active: false,
              status: 'conflict',
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          console.log(`[BAILEYS] ✅ Session cleared. User must reconnect manually.`);
          console.log(`[BAILEYS] 💡 TIP: Ensure no other devices/instances are using this agent.`);
          
          // Record failure to prevent auto-retry
          last401Failure.set(agentId, Date.now());
          
          return; // Don't continue processing
        }
        
        // CRITICAL: Handle error 428 - Connection Lost (AUTO-RECONNECT)
        if (statusCode === 428) {
          console.log(`[BAILEYS] 🔄 428 - Connection Lost (network issue)`);
          
          // Release lock before reconnect attempt
          connectionLocks.delete(agentId);
          
          // Use smart reconnection with exponential backoff
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          
          // Async reconnection - don't await to avoid blocking
          handleSmartReconnection(agentId, 'disconnect_428', 1)
            .then(result => {
              if (result) {
                console.log(`[BAILEYS] ✅ Smart reconnection successful after 428`);
              }
            })
            .catch(error => {
              console.error(`[BAILEYS] ❌ Smart reconnection failed:`, error.message);
            });
          
          return;
        }
        
        // FIX 4: Error 515 - Restart Required (EXPECTED after QR pairing!)
        // FIX 3: Error 515 - Restart Required (EXPECTED after QR pairing!)
        if (statusCode === 515) {
          console.log(`[BAILEYS] 🔄 Error 515 - Restart required (EXPECTED after QR pairing)`);
          
          // Check if pairing just happened (within last 2 minutes)
          const session = activeSessions.get(agentId);
          const lastPairingTime = session?.lastPairingTime;
          const justPaired = lastPairingTime && (Date.now() - lastPairingTime) < 120000; // Within 2 minutes
          
          // Also check database for pairing status
          const { data: agent } = await supabaseAdmin
            .from('whatsapp_sessions')
            .select('status, last_paired_at, updated_at')
            .eq('agent_id', agentId)
            .maybeSingle();
          
          const dbJustPaired = agent?.last_paired_at && 
            (Date.now() - new Date(agent.last_paired_at).getTime()) < 120000; // Within 2 minutes
          
          const isPairingComplete = agent?.status === 'pairing_complete' || agent?.status === 'reconnecting_after_pairing';
          
          if (justPaired || dbJustPaired || isPairingComplete) {
            console.log(`[BAILEYS] ✅ 515 after fresh pairing - KEEPING credentials for reconnection`);
            console.log(`[BAILEYS] ℹ️ Will reconnect using saved credentials (no new QR)`);
            
            // Don't mark as disconnected! Keep status as 'reconnecting_after_pairing'
            await supabaseAdmin
              .from('whatsapp_sessions')
              .update({
                status: 'reconnecting_after_pairing',
                updated_at: new Date().toISOString()
              })
              .eq('agent_id', agentId);
          } else {
            // Normal 515 error, not after pairing
            console.log(`[BAILEYS] ⚠️ 515 without recent pairing - marking disconnected`);
            
            const lastUpdate = agent?.updated_at ? new Date(agent.updated_at).getTime() : 0;
            const minutesSinceUpdate = (Date.now() - lastUpdate) / 1000 / 60;
            
            if (minutesSinceUpdate > 5) {
              // Old disconnect - update status
              await supabaseAdmin
                .from('whatsapp_sessions')
                .update({
                  status: 'disconnected',
                  is_active: false,
                  disconnected_at: new Date().toISOString()
                })
                .eq('agent_id', agentId);
              console.log(`[BAILEYS] ℹ️ Updated status to disconnected (old disconnect)`);
            } else {
              console.log(`[BAILEYS] ℹ️ Recent disconnect, keeping status for reconnect`);
            }
          }
          
          // Remove from memory to force clean restart
          await removeAgentFromActiveSessions(agentId);
          qrGenerationTracker.delete(agentId);
          connectionLocks.delete(agentId); // Release lock before reconnect
          
          // Use smart reconnection (515 is expected, so start with attempt 1)
          // Don't clear credentials - they were just saved after pairing
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          
          // Wait 3 seconds then reconnect (give WhatsApp time to register credentials)
          setTimeout(async () => {
            console.log(`[BAILEYS] 🔄 Reconnecting after 515...`);
            try {
              await handleSmartReconnection(agentId, 'disconnect_515_restart', 1);
            } catch (error) {
              console.error(`[BAILEYS] ❌ Reconnection failed after 515:`, error.message);
            }
          }, 3000);
          
          return;
        }
        
        qrGenerationTracker.delete(agentId);
        
        // CRITICAL: Handle Bad MAC errors (session corruption) - enhanced detection
        const errorMessage = reason || payload?.error || data?.reason || '';
        const errorString = JSON.stringify(lastDisconnect?.error || {}).toLowerCase();
        
        // Detect Bad MAC in multiple ways
        const isBadMacError = 
          errorMessage.includes('Bad MAC') || 
          errorMessage.includes('bad-mac') ||
          errorMessage.includes('Bad MAC Error') || 
          errorMessage.includes('session error') ||
          errorMessage.includes('decryption-error') ||
          errorMessage.includes('hmac') ||
          errorString.includes('bad mac') ||
          errorString.includes('bad-mac') ||
          (statusCode === 401 && (
            errorMessage.includes('MAC') || 
            errorMessage.includes('decrypt')
          ));
        
        if (isBadMacError) {
          console.log(`[BAILEYS] ❌ Bad MAC Error detected - Session key corruption/desync`);
          console.log(`[BAILEYS] Error details:`, {
            statusCode,
            reason,
            payload,
            errorString: errorString.substring(0, 200)
          });
          console.log(`[BAILEYS] This indicates:`);
          console.log(`  1. Credentials were corrupted during save/load`);
          console.log(`  2. Session keys are out of sync with WhatsApp servers`);
          console.log(`  3. File system or database corruption occurred`);
          console.log(`  4. Concurrent credential writes from multiple instances`);
          
          // Stop all intervals immediately
          // REMOVED: healthCheckInterval - no longer used
          if (session?.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
            session.heartbeatInterval = null;
          }
          // Close socket
          if (session?.socket) {
            try {
              session.socket.ev.removeAllListeners();
              session.socket.end();
            } catch (err) {
              console.log('[BAILEYS] Socket cleanup:', err.message);
            }
          }
          
          // Mark as corrupted
          const failureReason = 'Bad MAC - Session key corruption detected';
          if (session) {
            session.failureReason = failureReason;
            session.failureAt = Date.now();
            session.isConnected = false;
            session.connectionState = 'conflict';
          }
          
          // Remove from memory
          await removeAgentFromActiveSessions(agentId);
          connectionLocks.delete(agentId);
          last401Failure.set(agentId, Date.now());
          
          // CRITICAL: Delete corrupted credentials completely
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            console.log(`[BAILEYS] 🗑️ Deleting corrupted credentials...`);
            try {
              // Delete all files in auth directory
              const files = fs.readdirSync(authDir);
              for (const file of files) {
                const filePath = path.join(authDir, file);
                fs.unlinkSync(filePath);
                console.log(`[BAILEYS] 🗑️ Deleted: ${file}`);
              }
              fs.rmdirSync(authDir);
              console.log(`[BAILEYS] ✅ Corrupted auth directory deleted`);
            } catch (deleteError) {
              console.error(`[BAILEYS] ❌ Error deleting corrupted files:`, deleteError.message);
              // Force delete entire directory
              try {
                fs.rmSync(authDir, { recursive: true, force: true });
              } catch (forceError) {
                console.error(`[BAILEYS] ❌ Force delete failed:`, forceError.message);
              }
            }
          }
          
          // Clear database credentials
          try {
            await supabaseAdmin
              .from('whatsapp_sessions')
              .update({
                session_data: null,
                qr_code: null,
                qr_generated_at: null,
                is_active: false,
                status: 'conflict',
                phone_number: null,
                updated_at: new Date().toISOString()
              })
              .eq('agent_id', agentId);
            
            console.log(`[BAILEYS] ✅ Database credentials cleared`);
          } catch (dbError) {
            console.error(`[BAILEYS] ❌ Database clear error:`, dbError.message);
          }
          
          console.log(`[BAILEYS] ✅ Bad MAC cleanup complete`);
          console.log(`[BAILEYS] 🔄 User must reconnect manually to get fresh QR code`);
          console.log(`[BAILEYS] 💡 TIP: Ensure no other instances are running for this agent`);
          
          return; // Don't continue processing
        }
        
        if (statusCode === 401) {
          console.log(`[BAILEYS] ❌ 401 - Clearing session due to conflict or device removal`);
          
          if (session?.socket) {
            try {
              session.socket.ev.removeAllListeners();
              session.socket.end?.();
            } catch (err) {
              console.log('[BAILEYS] Socket cleanup after 401 failed:', err.message);
            }
          }

          // CRITICAL: Mark session as conflict FIRST to stop health check
          // The health check will see conflict state and stop itself
          const failureReason = payload?.error || reason || 'conflict';
          if (session) {
            session.failureReason = failureReason;
            session.failureAt = Date.now();
            session.isConnected = false;
            session.connectionState = 'conflict'; // This triggers health check to stop
            session.qrCode = null;
            session.qrGeneratedAt = null;
            session.socket = null;
            session.state = null;
            session.saveCreds = null;
          }

          // Stop health check and heartbeat intervals
          if (session?.healthCheckInterval) {
            clearInterval(session.healthCheckInterval);
            session.healthCheckInterval = null;
            console.log(`[BAILEYS] ✅ Health check interval stopped`);
          }
          if (session?.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
            session.heartbeatInterval = null;
            console.log(`[BAILEYS] ✅ Heartbeat interval stopped`);
          }

          // Remove from active sessions IMMEDIATELY to stop health check
          // Health check checks if session exists, so deleting it stops the loop
          await removeAgentFromActiveSessions(agentId);
          console.log(`[BAILEYS] ✅ Session removed from active sessions`);

          connectionLocks.delete(agentId);
          lastConnectionAttempt.set(agentId, Date.now());
          
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
          }
          
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              session_data: null,
              qr_code: null,
              qr_generated_at: null,
              is_active: false,
              status: 'conflict',
              phone_number: null,
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          console.log(`[BAILEYS] ✅ Session cleared after 401. Failure reason: ${failureReason}`);

          // CRITICAL: Record 401 failure timestamp to prevent automatic retries
          last401Failure.set(agentId, Date.now());
          console.log(`[BAILEYS] 🚫 Auto-retry disabled for ${Math.ceil(FAILURE_COOLDOWN_MS / 60000)} minutes after 401 error`);
          console.log(`[BAILEYS] ⚠️  Manual reconnection required - user must click "Connect" to get new QR code`);

          return;
        }

        // CRITICAL: Handle error 404 - Session Not Found (FATAL)
        if (statusCode === 404) {
          console.log(`[BAILEYS] ❌ 404 - Session not found - clearing credentials`);
          console.log(`[BAILEYS] This means the session was deleted from WhatsApp servers`);
          
          if (session?.socket) {
            try {
              session.socket.ev.removeAllListeners();
              session.socket.end?.();
            } catch (err) {
              console.log('[BAILEYS] Socket cleanup after 404 failed:', err.message);
            }
          }

          // Mark session as conflict
          const failureReason = 'Session not found - likely deleted from WhatsApp servers';
          if (session) {
            session.failureReason = failureReason;
            session.failureAt = Date.now();
            session.isConnected = false;
            session.connectionState = 'conflict';
            session.qrCode = null;
            session.qrGeneratedAt = null;
            session.socket = null;
            session.state = null;
            session.saveCreds = null;
          }

          // Stop health check and heartbeat intervals
          if (session?.healthCheckInterval) {
            clearInterval(session.healthCheckInterval);
            session.healthCheckInterval = null;
            console.log(`[BAILEYS] ✅ Health check interval stopped`);
          }
          if (session?.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
            session.heartbeatInterval = null;
            console.log(`[BAILEYS] ✅ Heartbeat interval stopped`);
          }

          // Remove from active sessions
          await removeAgentFromActiveSessions(agentId);
          console.log(`[BAILEYS] ✅ Session removed from active sessions`);

          connectionLocks.delete(agentId);
          lastConnectionAttempt.set(agentId, Date.now());
          
          // Delete auth directory - credentials are invalid
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log(`[BAILEYS] 🗑️ Cleared auth directory (session not found)`);
          }
          
          // Update database - mark as conflict and clear session data
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              session_data: null,
              qr_code: null,
              qr_generated_at: null,
              is_active: false,
              status: 'conflict',
              phone_number: null,
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          console.log(`[BAILEYS] ✅ Session cleared after 404. Failure reason: ${failureReason}`);
          console.log(`[BAILEYS] 🚫 Auto-retry disabled - manual reconnection required`);

          // Record failure to prevent auto-retry
          last401Failure.set(agentId, Date.now());
          return;
        }

        // CRITICAL: Handle errors 408/500/503 - Recoverable (Smart Reconnection)
        if ([408, 500, 503].includes(statusCode)) {
          const errorName = statusCode === 408 ? 'Timeout' : 
                           statusCode === 500 ? 'Server Error' : 'Service Unavailable';
          console.log(`[BAILEYS] 🟡 ${statusCode} - ${errorName} - RECOVERABLE (smart reconnection)`);
          console.log(`[BAILEYS] Auth state: PRESERVED - credentials still valid`);
          
          // Use smart reconnection with exponential backoff
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          
          handleSmartReconnection(agentId, `disconnect_${statusCode}`, 1)
            .then(result => {
              if (result) {
                console.log(`[BAILEYS] ✅ Smart reconnection successful after ${statusCode}`);
              }
            })
            .catch(error => {
              console.error(`[BAILEYS] ❌ Smart reconnection failed after ${statusCode}:`, error.message);
            });
          
          return;
        }

        // CRITICAL: Handle error 410 - Restart Required (Protocol Update)
        if (statusCode === 410) {
          console.log(`[BAILEYS] 🔄 410 - Restart required (protocol update)`);
          console.log(`[BAILEYS] Auth state: PRESERVED - credentials still valid`);
          
          // Clear QR tracker to allow restart
          qrGenerationTracker.delete(agentId);
          
          // Use smart reconnection
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          
          setTimeout(async () => {
            console.log(`[BAILEYS] 🔄 Smart reconnection after protocol update...`);
            try {
              await handleSmartReconnection(agentId, 'disconnect_410_protocol_update', 1);
            } catch (error) {
              console.error(`[BAILEYS] ❌ Restart failed after 410:`, error.message);
            }
          }, 2000);
          
          return;
        }
        
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            is_active: false,
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
      }
      
    });

    // Handle messages
    // Message handler - logs incoming and outgoing messages with actual text
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      console.log(`\n[BAILEYS] ========== MESSAGES RECEIVED (${type}) ==========`);
      console.log(`[BAILEYS] 📊 Received ${messages?.length || 0} message(s) of type: ${type}`);
      
      // CRITICAL: Don't skip 'notify' type messages entirely - some real messages come as 'notify'
      // Instead, we'll filter them in shouldProcessMessage based on content
      // Only skip if there are no messages to process
      if (!messages || messages.length === 0) {
        console.log('[BAILEYS] 🚫 No messages in batch, skipping');
        return;
      }

      // CRITICAL: Fetch user_id from agents table for message_log insertion
      let userIdForMessage = userId;
      if (!userIdForMessage) {
        try {
          const { data: agentData } = await supabaseAdmin
            .from('agents')
            .select('user_id')
            .eq('id', agentId)
            .single();
          if (agentData) {
            userIdForMessage = agentData.user_id;
            console.log(`[BAILEYS] ✅ Fetched user_id for message logging: ${userIdForMessage}`);
          }
        } catch (error) {
          console.error(`[BAILEYS] ❌ Failed to fetch user_id for agent:`, error.message);
        }
      }

      const session = activeSessions.get(agentId);
      const agentNumber =
        sanitizeNumberFromJid(session?.phoneNumber) ||
        sanitizeNumberFromJid(sock?.user?.id) ||
        null;

      // CRITICAL: Skip messages during initial connection phase
      // If the session is not fully connected yet, these are likely connection/sync messages
      if (!session?.isConnected && !agentNumber) {
        console.log('[BAILEYS] 🚫 Skipping messages during connection initialization phase');
        return;
      }

      // Messages will be queued individually via queueMessageForBatch()
      // No need to collect in array - queue handles batching automatically

      const shouldProcessMessage = (message) => {
        const remoteJid = message?.key?.remoteJid || '';

        if (!remoteJid) {
          console.log('[BAILEYS] 🚫 Skipping message with missing remoteJid');
          return false;
        }

        if (remoteJid.endsWith('@g.us')) {
          console.log('[BAILEYS] 🚫 Skipping group message from:', remoteJid);
          return false;
        }

        if (remoteJid.endsWith('@broadcast')) {
          console.log('[BAILEYS] 🚫 Skipping broadcast message from:', remoteJid);
          return false;
        }

        if (remoteJid.includes('status') || remoteJid.endsWith('@status')) {
          console.log('[BAILEYS] 🚫 Skipping status update from:', remoteJid);
          return false;
        }

        if (message?.message?.newsletterAdminInviteMessage || remoteJid.includes('@newsletter')) {
          console.log('[BAILEYS] 🚫 Skipping newsletter message from:', remoteJid);
          return false;
        }

        if (!remoteJid.endsWith('@s.whatsapp.net') && !remoteJid.endsWith('@lid')) {
          console.log('[BAILEYS] 🚫 Skipping unsupported JID type:', remoteJid);
          return false;
        }

        // CRITICAL: Skip system/connection messages that have no actual content
        // These are typically protocol messages during WhatsApp initialization
        if (!message?.message) {
          console.log('[BAILEYS] 🚫 Skipping message with no message content (system message)');
          return false;
        }

        // Skip protocol messages (like protocolMessage, senderKeyDistributionMessage, etc.)
        const protocolMessageTypes = [
          'protocolMessage',
          'senderKeyDistributionMessage',
          'deviceSentMessage',
          'messageContextInfo',
          'reactionMessage',
          'pollCreationMessage',
          'pollUpdateMessage',
        ];
        
        const messageKeys = Object.keys(message.message || {});
        const hasOnlyProtocolMessages = messageKeys.every(key => 
          protocolMessageTypes.includes(key) || 
          key === 'messageContextInfo' ||
          key === 'messageStubType'
        );

        if (hasOnlyProtocolMessages && messageKeys.length > 0) {
          console.log('[BAILEYS] 🚫 Skipping protocol/system message:', messageKeys.join(', '));
          return false;
        }

        return true;
      };

      for (const msg of messages) {
        if (!shouldProcessMessage(msg)) {
          continue;
        }

        const fromMe = Boolean(msg?.key?.fromMe);
        const remoteJid = msg?.key?.remoteJid || 'unknown';
        const messageId = msg?.key?.id || 'unknown';
        const direction = fromMe ? '📤 Outgoing' : '📨 Incoming';
        const participant = fromMe ? 'to' : 'from';
        
        // Record message received metric
        if (!fromMe) {
          // Determine message type for metrics
          let messageType = 'unknown';
          if (msg.message?.conversation) messageType = 'text';
          else if (msg.message?.imageMessage) messageType = 'image';
          else if (msg.message?.videoMessage) messageType = 'video';
          else if (msg.message?.audioMessage) messageType = 'audio';
          else if (msg.message?.documentMessage) messageType = 'document';
          else if (msg.message?.stickerMessage) messageType = 'sticker';
          else if (msg.message?.locationMessage) messageType = 'location';
          else if (msg.message?.contactMessage) messageType = 'contact';
          else if (msg.message?.extendedTextMessage) messageType = 'text';
          
          recordMetric(() => {
            if (messageMetrics?.received) {
              messageMetrics.received.labels(shortId(agentId), messageType).inc();
            }
          });
        }

        const participantJid =
          msg?.key?.participant ||
          msg?.participant ||
          msg?.message?.extendedTextMessage?.contextInfo?.participant ||
          msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo?.participant ||
          msg?.message?.ephemeralMessage?.message?.conversation?.contextInfo?.participant ||
          null;

        const contactCandidateJid = fromMe ? participantJid || remoteJid : remoteJid;

        const contactNumber = sanitizeNumberFromJid(contactCandidateJid);
        const fromNumber = fromMe ? agentNumber : contactNumber;
        const toNumber = fromMe ? contactNumber : agentNumber;

        // ✅ CRITICAL: Message routing logic for dashboard vs WhatsApp
        // 
        // Self-conversations (contact === agent) can be EITHER dashboard OR whatsapp:
        // - Dashboard: User initiated conversation via Dashboard UI
        // - WhatsApp: User initiated conversation via WhatsApp app directly
        //
        // To determine which: Check the most recent OUTGOING message in this self-conversation
        // - If last outgoing message was source='dashboard' → this is a dashboard conversation
        // - Otherwise → this is a WhatsApp app conversation
        //
        // Non-self conversations (contact !== agent) are always 'whatsapp'
        //
        const isSelfConversation = contactNumber && agentNumber && contactNumber === agentNumber;
        
        // For self-conversations, determine if this is dashboard or whatsapp context
        let isDashboardConversation = false;
        if (isSelfConversation) {
          try {
            // Check the most recent outgoing message to determine conversation context
            const { data: recentOutgoing } = await supabaseAdmin
              .from('message_log')
              .select('source')
              .eq('agent_id', agentId)
              .eq('is_from_me', true)
              .or(`sender_phone.eq.${agentNumber},contact_id.eq.${agentNumber}`)
              .order('received_at', { ascending: false })
              .limit(1);
            
            // If recent outgoing was from dashboard, this is a dashboard conversation
            isDashboardConversation = recentOutgoing?.[0]?.source === 'dashboard';
          } catch (err) {
            console.log(`[BAILEYS] ⚠️ Could not check conversation context: ${err.message}`);
            // Default to whatsapp if we can't determine
            isDashboardConversation = false;
          }
        }
        
        const isDashboardMessage = isSelfConversation && isDashboardConversation;
        const isIncomingWhatsApp = !fromMe && !isDashboardMessage;
        const isOutgoingToOther = fromMe && !isSelfConversation;

        // Log what type of message we're processing
        if (isDashboardMessage) {
          const direction = fromMe ? 'outgoing (user→bot)' : 'incoming (bot→user)';
          console.log(`[BAILEYS] 📊 Processing DASHBOARD message (${direction}): self-conversation on ${agentNumber}`);
        } else if (isSelfConversation && !isDashboardConversation) {
          const direction = fromMe ? 'outgoing' : 'incoming (bot→user)';
          console.log(`[BAILEYS] 📱 Processing WHATSAPP self-chat (${direction}): ${agentNumber} (not from dashboard)`);
        } else if (isIncomingWhatsApp) {
          console.log(`[BAILEYS] 📱 Processing INCOMING WhatsApp message from: ${contactNumber} to agent: ${agentNumber}`);
        } else if (isOutgoingToOther) {
          console.log(`[BAILEYS] 📤 Processing OUTGOING WhatsApp message to contact: ${contactNumber}`);
        }

        // ✅ TASK 4: Handle button response messages
        let messageText = null;
        let buttonResponse = null;
        
        if (msg.message) {
          // Check for button response first
          if (msg.message.buttonsResponseMessage) {
            const buttonMsg = msg.message.buttonsResponseMessage;
            buttonResponse = {
              selectedButtonId: buttonMsg.selectedButtonId || buttonMsg.selectedId,
              selectedButtonText: buttonMsg.selectedButtonText || buttonMsg.selectedDisplayText || null,
              contextInfo: buttonMsg.contextInfo || null
            };
            messageText = buttonResponse.selectedButtonText || `[Button: ${buttonResponse.selectedButtonId}]`;
            console.log(`[BAILEYS] 🔘 Button response received:`, {
              buttonId: buttonResponse.selectedButtonId,
              buttonText: buttonResponse.selectedButtonText,
              from: sanitizedFromNumber
            });
            
            // ✅ EMAIL UID BUTTON HANDLING: Check if this is an EMAIL UID button click
            if (buttonResponse.selectedButtonId && buttonResponse.selectedButtonId.startsWith('create_draft_')) {
              console.log(`[BUTTON-CLICK] EMAIL UID button clicked: ${buttonResponse.selectedButtonId}`);
              
              // Forward to button-response webhook handler
              try {
                const baseUrl = process.env.API_BASE_URL || 
                               process.env.WEBHOOK_BASE_URL || 
                               'http://localhost:3000'; // Fallback for local dev
                
                const buttonResponseWebhookUrl = `${baseUrl}/api/webhooks/button-response`;
                
                console.log(`[BUTTON-CLICK] Forwarding EMAIL UID button click to button-response webhook`, {
                  buttonId: buttonResponse.selectedButtonId,
                  from: sanitizedFromNumber,
                  agentId: agentId.substring(0, 8) + '...',
                  webhookUrl: buttonResponseWebhookUrl
                });
                
                // Call button-response webhook asynchronously (don't block message processing)
                axios.post(buttonResponseWebhookUrl, {
                  agentId: agentId,
                  from: sanitizedFromNumber,
                  buttonId: buttonResponse.selectedButtonId,
                  buttonText: buttonResponse.selectedButtonText,
                  timestamp: timestampIso
                }, {
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': `button-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    'X-Internal-Request': 'true'
                  },
                  timeout: 10000 // 10 second timeout
                }).then(response => {
                  console.log(`[BUTTON-CLICK] ✅ Button response webhook called successfully`, {
                    buttonId: buttonResponse.selectedButtonId,
                    status: response.status
                  });
                }).catch(error => {
                  console.error(`[BUTTON-CLICK] ❌ Failed to call button-response webhook:`, {
                    buttonId: buttonResponse.selectedButtonId,
                    error: error.message,
                    status: error.response?.status
                  });
                  // Don't throw - continue with normal message processing
                });
              } catch (buttonError) {
                console.error(`[BUTTON-CLICK] ❌ Error forwarding button click:`, buttonError.message);
                // Don't throw - continue with normal message processing
              }
            }
          } else if (msg.message.conversation) {
            messageText = msg.message.conversation;
          } else if (msg.message.extendedTextMessage?.text) {
            messageText = msg.message.extendedTextMessage.text;
          } else if (msg.message.imageMessage?.caption) {
            messageText = `[Image] ${msg.message.imageMessage.caption}`;
          } else if (msg.message.videoMessage?.caption) {
            messageText = `[Video] ${msg.message.videoMessage.caption}`;
          } else if (msg.message.documentMessage?.caption) {
            messageText = `[Document] ${msg.message.documentMessage.caption}`;
          } else if (msg.message.audioMessage) {
            messageText = '[Audio/Voice Message]';
          } else if (msg.message.stickerMessage) {
            messageText = '[Sticker]';
          } else if (msg.message.imageMessage) {
            messageText = '[Image]';
          } else if (msg.message.videoMessage) {
            messageText = '[Video]';
          } else if (msg.message.documentMessage) {
            messageText = '[Document]';
          } else if (msg.message.contactMessage) {
            messageText = `[Contact: ${msg.message.contactMessage.displayName || 'Unknown'}]`;
          } else if (msg.message.locationMessage) {
            messageText = '[Location]';
          } else {
            messageText = `[Unknown message type: ${Object.keys(msg.message).join(', ')}]`;
          }
        } else {
          messageText = '[No message content]';
        }

        // CRITICAL: Skip messages with no actual content - these are system/connection messages
        // that shouldn't be logged as user messages
        if (!messageText || messageText === '[No message content]' || messageText.trim().length === 0) {
          console.log(`[BAILEYS] 🚫 Skipping message with no content: ${messageId}`);
          continue;
        }

        // CRITICAL: Skip system/connection messages that have placeholder content
        // These are typically protocol messages or connection status messages
        const systemMessagePatterns = [
          '[Unknown message type:',
          '[No message content]',
          'protocolMessage',
          'senderKeyDistributionMessage',
          'deviceSentMessage',
          'messageContextInfo',
          'reactionMessage',
          'pollCreationMessage',
          'pollUpdateMessage',
        ];

        const isSystemMessage = systemMessagePatterns.some(pattern => 
          messageText.includes(pattern) || 
          messageText.toLowerCase().includes('system') ||
          messageText.toLowerCase().includes('protocol')
        );

        if (isSystemMessage) {
          console.log(`[BAILEYS] 🚫 Skipping system/protocol message: ${messageText.substring(0, 50)}`);
          continue;
        }

        // CRITICAL: Skip messages from WhatsApp system (status@broadcast, etc.)
        // These are typically status updates, system notifications, etc.
        // NOTE: @lid messages are VALID user messages from linked devices/business accounts - don't skip them
        if (remoteJid.includes('status') || 
            remoteJid.includes('broadcast') || 
            remoteJid.includes('@g.us') ||
            remoteJid.includes('newsletter')) {
          console.log(`[BAILEYS] 🚫 Skipping system/status message from: ${remoteJid}`);
          continue;
        }
        
        // For @lid messages, extract actual sender from sender_pn attribute (incoming) or peer_recipient_pn (outgoing)
        // @lid messages are from linked devices/business accounts and are valid user messages
        let actualSenderJid = remoteJid;
        let actualRecipientJid = remoteJid; // NEW: Track actual recipient for outgoing messages
        if (remoteJid.endsWith('@lid')) {
          // CRITICAL: Check cache FIRST (fastest method - populated by custom logger intercepting protocol)
          let senderPn = null;
          const cached = lidToPhoneCache.get(remoteJid);
          if (cached !== undefined) {
            cacheStats.lidToPhone.hits++;
            recordMetric(() => {
              if (cacheMetrics?.hits) {
                cacheMetrics.hits.labels('lidToPhone').inc();
              }
            });
            senderPn = cached;
            loggers.database.debug({ remoteJid }, 'Found sender_pn in cache');
          } else {
            cacheStats.lidToPhone.misses++;
            recordMetric(() => {
              if (cacheMetrics?.misses) {
                cacheMetrics.misses.labels('lidToPhone').inc();
              }
            });
          }
          
          // Method 1: Check msg.key.attrs (if not in cache)
          if (!senderPn && msg?.key?.attrs && typeof msg.key.attrs === 'object') {
            senderPn = msg.key.attrs.sender_pn || null;
            if (senderPn) {
              console.log(`[BAILEYS] ✅ Found sender_pn in msg.key.attrs: ${senderPn}`);
            }
          }
          
          // Method 2: Check msg.attrs (alternative location)
          if (!senderPn && msg?.attrs && typeof msg.attrs === 'object') {
            senderPn = msg.attrs.sender_pn || null;
            if (senderPn) {
              console.log(`[BAILEYS] ✅ Found sender_pn in msg.attrs: ${senderPn}`);
            }
          }
          
          // Method 3: Check if it's directly on msg.key
          if (!senderPn && msg?.key && typeof msg.key === 'object') {
            senderPn = msg.key.sender_pn || null;
            if (senderPn) {
              console.log(`[BAILEYS] ✅ Found sender_pn on msg.key: ${senderPn}`);
            }
          }
          
          // Method 5: Try to get from socket's contact store using pushName
          if (!senderPn && msg?.pushName && sock?.store?.contacts) {
            try {
              // Search contacts by pushName to find matching phone number
              const contacts = await sock.store.contacts.all();
              const matchingContact = contacts.find(c => c.name === msg.pushName);
              if (matchingContact && matchingContact.id) {
                const contactJid = matchingContact.id;
                if (contactJid.endsWith('@s.whatsapp.net')) {
                  senderPn = contactJid;
                  // Cache it for future use
                  lidToPhoneCache.set(remoteJid, contactJid);
                  console.log(`[BAILEYS] ✅ Found sender via contact store (pushName: ${msg.pushName}): ${senderPn}`);
                }
              }
            } catch (contactError) {
              // Ignore contact store errors
            }
          }
          
          // Method 6: Try to get from socket's message store (Baileys might store it there)
          if (!senderPn && sock?.store?.messages) {
            try {
              const storedMessages = await sock.store.messages.get(remoteJid);
              if (storedMessages && storedMessages[messageId]) {
                const storedMsg = storedMessages[messageId];
                // Check various locations in stored message
                const storedSenderPn = storedMsg?.key?.attrs?.sender_pn ||
                                     storedMsg?.attrs?.sender_pn ||
                                     storedMsg?.sender_pn ||
                                     null;
                if (storedSenderPn) {
                  senderPn = storedSenderPn;
                  lidToPhoneCache.set(remoteJid, storedSenderPn);
                  console.log(`[BAILEYS] ✅ Found sender_pn in message store: ${senderPn}`);
                }
              }
            } catch (storeError) {
              // Ignore store errors
            }
          }
          
          if (senderPn) {
            // Convert sender_pn to proper JID format if needed
            actualSenderJid = senderPn.includes('@') ? senderPn : `${senderPn}@s.whatsapp.net`;
            console.log(`[BAILEYS] ℹ️ @lid message detected, using sender_pn: ${actualSenderJid} (original remoteJid: ${remoteJid})`);
          }
          
          // OUTGOING MESSAGE: Extract peer_recipient_pn for recipient identification
          if (fromMe) {
            let peerRecipientPn = null;
            
            // Method 1: Check msg.key.attrs (most reliable)
            if (msg?.key?.attrs && typeof msg.key.attrs === 'object') {
              peerRecipientPn = msg.key.attrs.peer_recipient_pn || null;
              if (peerRecipientPn) {
                console.log(`[BAILEYS] ✅ Found peer_recipient_pn in msg.key.attrs: ${peerRecipientPn}`);
              }
            }
            
            // Method 2: Check msg.attrs
            if (!peerRecipientPn && msg?.attrs && typeof msg.attrs === 'object') {
              peerRecipientPn = msg.attrs.peer_recipient_pn || null;
              if (peerRecipientPn) {
                console.log(`[BAILEYS] ✅ Found peer_recipient_pn in msg.attrs: ${peerRecipientPn}`);
              }
            }
            
            // Method 3: Check if it's directly on msg.key
            if (!peerRecipientPn && msg?.key && typeof msg.key === 'object') {
              peerRecipientPn = msg.key.peer_recipient_pn || null;
              if (peerRecipientPn) {
                console.log(`[BAILEYS] ✅ Found peer_recipient_pn on msg.key: ${peerRecipientPn}`);
              }
            }
            
            // Method 4: Check cache (populated by logger interceptor)
            if (!peerRecipientPn) {
              const cached = lidToPhoneCache.get(remoteJid);
              if (cached !== undefined) {
                cacheStats.lidToPhone.hits++;
                actualRecipientJid = cached;
                loggers.database.debug({ remoteJid }, 'Found peer_recipient_pn in cache');
              } else {
                cacheStats.lidToPhone.misses++;
              }
            }
            if (peerRecipientPn) {
              // Convert peer_recipient_pn to proper JID format
              actualRecipientJid = peerRecipientPn.includes('@') ? peerRecipientPn : `${peerRecipientPn}@s.whatsapp.net`;
              // Cache it for future use
              lidToPhoneCache.set(remoteJid, actualRecipientJid);
              console.log(`[BAILEYS] 💾 Cached peer_recipient_pn mapping: ${remoteJid} -> ${actualRecipientJid}`);
            }
          }
          
          if (!senderPn && !fromMe) {
            // CRITICAL: Log COMPLETE message structure for @lid messages to find sender_pn
            // This is APPROACH 1 - comprehensive debug logging to find where sender_pn is stored
            console.log(`[BAILEYS] ⚠️ @lid message detected but sender_pn not found. COMPLETE message structure:`, JSON.stringify({
              // Check ALL possible locations for sender_pn
              key: msg?.key ? {
                id: msg.key.id,
                remoteJid: msg.key.remoteJid,
                fromMe: msg.key.fromMe,
                attrs: msg.key.attrs,
                participant: msg.key.participant,
                // Check if sender_pn is directly on key
                sender_pn: msg.key.sender_pn,
                // Check all key properties
                allKeys: Object.keys(msg.key),
              } : null,
              // Check top-level attrs
              attrs: msg?.attrs,
              // Check message.attrs
              messageAttrs: msg?.message?.attrs,
              // Check extendedTextMessage contextInfo
              extendedTextContext: msg?.message?.extendedTextMessage?.contextInfo,
              // Check all message properties
              messageKeys: msg?.message ? Object.keys(msg.message) : [],
              // Other properties
              pushName: msg?.pushName,
              notify: msg?.notify,
              verifiedBisName: msg?.verifiedBisName,
              // Check if sender_pn is at top level
              sender_pn: msg?.sender_pn,
              // Show ALL top-level keys
              allTopLevelKeys: msg ? Object.keys(msg) : [],
            }, null, 2));
            
            // Also try to find sender_pn by deep searching the entire message object
            const deepSearchForSenderPn = (obj, path = 'root', depth = 0) => {
              if (depth > 5) return null; // Limit depth
              if (!obj || typeof obj !== 'object') return null;
              
              if ('sender_pn' in obj) {
                console.log(`[BAILEYS] 🔍 Found sender_pn at path: ${path}.sender_pn = ${obj.sender_pn}`);
                return obj.sender_pn;
              }
              
              for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                  const result = deepSearchForSenderPn(obj[key], `${path}.${key}`, depth + 1);
                  if (result) return result;
                }
              }
              return null;
            };
            
            const foundSenderPn = deepSearchForSenderPn(msg);
            if (foundSenderPn) {
              const phoneNumber = foundSenderPn.includes('@') ? foundSenderPn.split('@')[0] : foundSenderPn;
              const senderJid = `${phoneNumber}@s.whatsapp.net`;
              actualSenderJid = senderJid;
              lidToPhoneCache.set(remoteJid, senderJid);
              console.log(`[BAILEYS] ✅ Found sender_pn via deep search: ${remoteJid} -> ${phoneNumber}`);
            }
            
            // Last resort: Try to extract from the raw message if it's available
            // Sometimes Baileys stores raw protocol data in a different format
            if (msg && typeof msg === 'object') {
              // Deep search for sender_pn in the entire message object
              const deepSearch = (obj, depth = 0) => {
                if (depth > 3) return null; // Limit depth to avoid infinite recursion
                if (!obj || typeof obj !== 'object') return null;
                
                if ('sender_pn' in obj) {
                  return obj.sender_pn;
                }
                
                for (const key in obj) {
                  if (obj.hasOwnProperty(key)) {
                    const result = deepSearch(obj[key], depth + 1);
                    if (result) return result;
                  }
                }
                return null;
              };
              
              const foundSenderPn = deepSearch(msg);
              if (foundSenderPn) {
                actualSenderJid = foundSenderPn.includes('@') ? foundSenderPn : `${foundSenderPn}@s.whatsapp.net`;
                // Cache it for future use
                lidToPhoneCache.set(remoteJid, actualSenderJid);
                console.log(`[BAILEYS] ✅ Found sender_pn via deep search: ${actualSenderJid}`);
              }
            }
          }
          
          // If we found sender_pn, cache it for future messages from this @lid
          if (actualSenderJid !== remoteJid && actualSenderJid) {
            lidToPhoneCache.set(remoteJid, actualSenderJid);
            console.log(`[BAILEYS] 💾 Cached @lid mapping: ${remoteJid} -> ${actualSenderJid}`);
          }
        }

        console.log(`[BAILEYS] ✅ Processing individual message ${participant} ${remoteJid}${actualSenderJid !== remoteJid ? ` (actual sender: ${actualSenderJid})` : ''}`);
        console.log(`[BAILEYS] Message: ${messageText}`);
        console.log(`[BAILEYS] Message ID: ${messageId}`);
        if (msg.messageTimestamp) {
          console.log(`[BAILEYS] Timestamp: ${new Date(Number(msg.messageTimestamp) * 1000).toISOString()}`);
        }
        console.log(`[BAILEYS] ----------------------------------------`);

        const effectiveMessage = unwrapMessageContent(msg.message);
        const textContent =
          effectiveMessage?.conversation ||
          effectiveMessage?.extendedTextMessage?.text ||
          effectiveMessage?.imageMessage?.caption ||
          effectiveMessage?.videoMessage?.caption ||
          effectiveMessage?.buttonsResponseMessage?.selectedDisplayText ||
          effectiveMessage?.listResponseMessage?.title ||
          effectiveMessage?.templateButtonReplyMessage?.selectedDisplayText ||
          null;

          const timestampRaw =
            (msg.messageTimestamp &&
              (typeof msg.messageTimestamp === 'object' && typeof msg.messageTimestamp.toNumber === 'function'
                ? msg.messageTimestamp.toNumber()
                : Number(msg.messageTimestamp))) ||
            Math.floor(Date.now() / 1000);

        const timestampIso = new Date(timestampRaw * 1000).toISOString();

        // ✅ TASK 4: Set messageType based on button response or default to TEXT
        let messageType = buttonResponse ? 'BUTTON_RESPONSE' : 'TEXT';
        // Use messageText (already extracted and validated) as primary source, fallback to textContent
        // messageText is more comprehensive and handles more message types
        let content = messageText && messageText !== '[No message content]' && !messageText.startsWith('[Unknown message type:') 
          ? messageText 
          : (textContent || null);
        let mediaUrl = null;
        let mediaMimetype = null;
        let mediaSize = null;
        
        // Update contact extraction for @lid messages - use actualRecipientJid for outgoing, actualSenderJid for incoming
        let finalContactCandidateJid = contactCandidateJid;
        let finalFromNumber = fromNumber;
        let finalToNumber = toNumber;
        if (actualSenderJid !== remoteJid || (fromMe && actualRecipientJid !== remoteJid)) {
          if (fromMe) {
            // OUTGOING: Use actualRecipientJid (from peer_recipient_pn)
            finalContactCandidateJid = participantJid || actualRecipientJid;
          } else {
            // INCOMING: Use actualSenderJid (from sender_pn)
            finalContactCandidateJid = actualSenderJid;
          }
          
          const updatedContactNumber = sanitizeNumberFromJid(finalContactCandidateJid);
          finalFromNumber = fromMe ? agentNumber : updatedContactNumber;
          finalToNumber = fromMe ? updatedContactNumber : agentNumber;
          
          if (fromMe) {
            console.log(`[BAILEYS] 🔄 Updated contact info for OUTGOING @lid: fromNumber=${finalFromNumber}, toNumber=${finalToNumber}, actualRecipientJid=${actualRecipientJid}`);
          } else {
            console.log(`[BAILEYS] 🔄 Updated contact info for INCOMING @lid: fromNumber=${finalFromNumber}, toNumber=${finalToNumber}, actualSenderJid=${actualSenderJid}`);
          }
        }
        
        const messageMetadata = {
          platform: 'whatsapp',
          phoneNumber: agentNumber,
            direction: fromMe ? 'outgoing' : 'incoming',
          remoteJid: actualSenderJid, // Use actual sender JID for @lid messages
          messageId,
        };

        const wrappedAudioMessage = unwrapMessageContent(msg.message)?.audioMessage;

        if (wrappedAudioMessage) {
          messageType = 'AUDIO';
          const audioMessage = wrappedAudioMessage;
          mediaMimetype = audioMessage?.mimetype || 'audio/ogg';

          if (typeof audioMessage?.seconds === 'number') {
            messageMetadata.durationSeconds = audioMessage.seconds;
          }

          if (audioMessage?.ptt) {
            messageMetadata.isPtt = true;
          }

          try {
            console.log('[BAILEYS] 🎵 Downloading audio message:', { messageId, mediaMimetype });
            const messageForDownload = {
              ...msg,
              message: {
                audioMessage,
              },
            };

            const audioBuffer = await downloadMediaMessage(messageForDownload, 'buffer', {}, {
              logger: pino({ level: 'error' }),
              reuploadRequest: sock.updateMediaMessage,
            });

            if (audioBuffer) {
              mediaSize = audioBuffer.length;
              messageMetadata.mediaSize = mediaSize;
              try {
                const { url, path: storagePath } = await saveAudioFile(audioBuffer, agentId, messageId, mediaMimetype);
                mediaUrl = url;
                messageMetadata.storagePath = storagePath;
                console.log('[BAILEYS] 🎵 Audio message processed', { messageId, mediaUrl });
              } catch (uploadError) {
                // Log error but don't break message processing - webhook will still be sent without mediaUrl
                console.error('[BAILEYS] ❌ Failed to upload audio file (message will continue without mediaUrl):', {
                  messageId,
                  error: uploadError.message,
                  code: uploadError.code || uploadError.originalError?.code,
                });
                // Set mediaUrl to null so webhook knows there's no media available
                mediaUrl = null;
                messageMetadata.storagePath = null;
              }
            } else {
              console.warn('[BAILEYS] ⚠️ Audio buffer empty after download', { messageId });
            }
          } catch (error) {
            console.error('[BAILEYS] ❌ Failed to process audio message', { messageId, error: error.message });
            // Continue processing - don't break the entire message flow
            mediaUrl = null;
            messageMetadata.storagePath = null;
          }

          content = null;
        }

        // For @lid messages, always use actualSenderJid to get the correct phone number
        // CRITICAL: For @lid messages, use finalFromNumber/finalToNumber that were already calculated correctly
        // These values account for message direction (fromMe) and use agentNumber for outgoing, contact for incoming
        let sanitizedFromNumber;
        let sanitizedToNumber;

        if (remoteJid.endsWith('@lid')) {
          // For @lid messages, use the finalFromNumber/finalToNumber that were calculated earlier
          // These already account for message direction (fromMe flag)
          sanitizedFromNumber = finalFromNumber || sanitizeNumberFromJid(agentNumber) || agentNumber;
          sanitizedToNumber = finalToNumber || sanitizeNumberFromJid(actualSenderJid) || actualSenderJid;
          
          if (fromMe) {
            console.log(`[BAILEYS] ✅ @lid OUTGOING: from=${sanitizedFromNumber} (bot), to=${sanitizedToNumber} (contact)`);
          } else {
            console.log(`[BAILEYS] ✅ @lid INCOMING: from=${sanitizedFromNumber} (contact), to=${sanitizedToNumber} (bot)`);
          }
        } else {
          // Regular message (not @lid) - use standard extraction
          sanitizedFromNumber = typeof finalFromNumber === 'string' && finalFromNumber.length > 0
            ? finalFromNumber
            : sanitizeNumberFromJid(actualSenderJid) || actualSenderJid;
          
          sanitizedToNumber = typeof finalToNumber === 'string' && finalToNumber.length > 0
            ? finalToNumber
            : sanitizeNumberFromJid(fromMe ? actualSenderJid : agentNumber) || (fromMe ? actualSenderJid : agentNumber);
        }

        const cleanedMetadata = Object.fromEntries(
          Object.entries(messageMetadata).filter(([, value]) => value !== undefined && value !== null)
        );

        // ✅ CRITICAL: Check for duplicate messages before inserting
        // This prevents duplicate messages when:
        // 1. User sends message via chat interface (saved in messages route with generated message_id)
        // 2. WhatsApp echoes back the message (received via messages.upsert with WhatsApp message_id)
        const timeWindow = 10000; // 10 seconds window for duplicate detection
        const duplicateCheckStart = new Date(new Date(timestampIso).getTime() - timeWindow).toISOString();
        const duplicateCheckEnd = new Date(new Date(timestampIso).getTime() + timeWindow).toISOString();
        
        // Check for duplicate by message_id first (most reliable)
        const { data: existingByMessageId } = await supabaseAdmin
          .from('message_log')
          .select('id')
          .eq('message_id', messageId)
          .eq('agent_id', agentId)
          .maybeSingle();
        
        if (existingByMessageId) {
          console.log(`[BAILEYS][DB] ⚠️ Duplicate message detected by message_id: ${messageId}, skipping insert`);
          continue; // Skip to next message
        }
        
        // Also check for duplicate by content, timestamp, sender, and conversation (fallback)
        // This catches cases where message_id differs (e.g., generated ID vs WhatsApp ID) but it's the same message
        // For outgoing messages (fromMe=true), check if same content was sent to same recipient recently
        // For incoming messages (fromMe=false), check if same content was received from same sender recently
        const { data: existingByContent } = await supabaseAdmin
          .from('message_log')
          .select('id, message_id, received_at')
          .eq('agent_id', agentId)
          .eq('message_text', content)
          .eq('conversation_id', remoteJid)
          .eq('sender_phone', sanitizedFromNumber)
          .gte('received_at', duplicateCheckStart)
          .lte('received_at', duplicateCheckEnd)
          .order('received_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (existingByContent) {
          const timeDiff = Math.abs(new Date(timestampIso).getTime() - new Date(existingByContent.received_at).getTime());
          console.log(`[BAILEYS][DB] ⚠️ Duplicate message detected by content/timestamp: ${messageId} (existing: ${existingByContent.message_id}, time diff: ${timeDiff}ms), skipping insert`);
          continue; // Skip to next message
        }

        // ✅ CRITICAL FIX: Check if there's a recent dashboard message for button messages
        // WhatsApp echoes back button messages as plain text (without button patterns)
        // This prevents the WhatsApp echo from overwriting the dashboard message with buttons
        // Check for dashboard messages even if fromMe is false (WhatsApp might not set it correctly)
        if (content) {
          // Check if there's a recent dashboard message with source='dashboard' and sender_type='agent'
          // The dashboard message might have button patterns (*1 Option 1*) that WhatsApp echo doesn't have
          // Use a wider time window (30 seconds) to catch messages that arrive slightly before/after
          const widerTimeWindow = 30000; // 30 seconds
          const widerStart = new Date(new Date(timestampIso).getTime() - widerTimeWindow).toISOString();
          const widerEnd = new Date(new Date(timestampIso).getTime() + widerTimeWindow).toISOString();
          
          const { data: recentDashboardMessage } = await supabaseAdmin
            .from('message_log')
            .select('id, message_id, message_text, message, received_at, source, sender_type')
            .eq('agent_id', agentId)
            .eq('source', 'dashboard')
            .eq('sender_type', 'agent')
            .eq('conversation_id', remoteJid)
            .eq('sender_phone', sanitizedFromNumber)
            .gte('received_at', widerStart)
            .lte('received_at', widerEnd)
            .order('received_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (recentDashboardMessage) {
            // Check if the dashboard message text contains this content (button messages have extra text)
            const dashboardText = (recentDashboardMessage.message_text || recentDashboardMessage.message || '').trim();
            const echoContent = content.trim();
            
            // Match if:
            // 1. Dashboard message contains the echo content (button messages have extra text)
            // 2. Echo content contains the first part of dashboard message (for button messages)
            // 3. They're similar enough (for button messages, echo is just the text part)
            const dashboardContainsEcho = dashboardText.includes(echoContent);
            const echoContainsDashboardStart = echoContent.includes(dashboardText.substring(0, Math.min(50, dashboardText.length)));
            const isSimilar = dashboardText.substring(0, 50) === echoContent.substring(0, 50);
            
            if (dashboardContainsEcho || echoContainsDashboardStart || isSimilar) {
              const timeDiff = Math.abs(new Date(timestampIso).getTime() - new Date(recentDashboardMessage.received_at).getTime());
              console.log(`[BAILEYS][DB] ⚠️ WhatsApp echo detected for dashboard message: ${messageId}`, {
                dashboardId: recentDashboardMessage.message_id,
                timeDiff: `${timeDiff}ms`,
                dashboardText: dashboardText.substring(0, 100),
                echoContent: echoContent.substring(0, 100),
                reason: 'Skipping insert to preserve dashboard message with buttons'
              });
              continue; // Skip storing WhatsApp echo - keep the dashboard message with buttons
            }
          }
        }

        // Determine source based on message routing logic (defined earlier in loop)
        // - isDashboardMessage: agent sends to self via dashboard → source = 'dashboard'
        // - isIncomingWhatsApp: contact sends to agent → source = 'whatsapp'
        const messageSource = isDashboardMessage ? 'dashboard' : 'whatsapp';

        const dbPayload = {
          message_id: messageId,
          agent_id: agentId, // CRITICAL: Include agent_id
          user_id: userIdForMessage, // CRITICAL: Include user_id for filtering
          conversation_id: remoteJid,
          sender_phone: sanitizedFromNumber,
          message_text: content,
          message_type: messageType,
          media_url: mediaUrl,
          media_mimetype: mediaMimetype,
          media_size: mediaSize,
          metadata: cleanedMetadata,
          received_at: timestampIso,
          created_at: timestampIso,
          source: messageSource, // Set based on isDashboardMessage or isIncomingWhatsApp
        };

        // Queue message for batch insertion
        queueMessageForBatch(agentId, dbPayload);

        // Extract sender name from message (pushName, verifiedBisName, or notify)
        const senderName = msg.pushName || 
                           msg.verifiedBisName || 
                           msg.notify || 
                           null;

        // CRITICAL: For @lid messages, check cache ONE MORE TIME right before webhook
        // The logger intercepts protocol messages and populates cache, but it might happen
        // slightly after message processing starts. Add a small delay to let logger intercept first.
        let webhookFromNumber = sanitizedFromNumber;
        if (remoteJid.endsWith('@lid')) {
          // Give logger a moment to intercept the protocol message and populate cache
          await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
          
          // Check cache now (logger should have populated it by now)
            const cachedSenderJid = lidToPhoneCache.get(remoteJid);
          if (cachedSenderJid !== undefined) {
            cacheStats.lidToPhone.hits++;
            const cachedPhoneNumber = sanitizeNumberFromJid(cachedSenderJid);
            if (cachedPhoneNumber) {
              webhookFromNumber = cachedPhoneNumber;
            }
          } else {
            cacheStats.lidToPhone.misses++;
          }
          
          if (webhookFromNumber && cachedPhoneNumber) {
            loggers.database.debug({ remoteJid, phone: webhookFromNumber }, 'Using cached sender_pn for webhook');
          } else {
            loggers.database.debug({ remoteJid }, 'Cache not populated yet, using fallback');
          }
        }

        const webhookPayload = {
          id: messageId,
          messageId,
          from: webhookFromNumber || sanitizedFromNumber || actualSenderJid,
          to: sanitizedToNumber,
          senderName: senderName,
          conversationId: actualSenderJid, // Use actual sender JID for @lid messages
          messageType,
          type: messageType.toLowerCase(),
          content: content || null,
          mediaUrl,
          mimetype: mediaMimetype || null,
          timestamp: timestampIso,
          fromMe: fromMe, // Include fromMe flag for webhook
          // ✅ TASK 4: Include button response data if available
          buttonResponse: buttonResponse || null,
          metadata: {
            ...cleanedMetadata,
            senderName: senderName,
          },
        };

        if (typeof webhookPayload.from === 'string' && webhookPayload.from.includes('@')) {
          webhookPayload.from = sanitizeNumberFromJid(webhookPayload.from) || webhookPayload.from;
        }

        if (typeof webhookPayload.to === 'string' && webhookPayload.to.includes('@')) {
          webhookPayload.to = sanitizeNumberFromJid(webhookPayload.to) || webhookPayload.to;
        }

        // Forward message if:
        // 1. TEXT message with content (even if it's a placeholder like [Image], [Video], etc.)
        // 2. BUTTON_RESPONSE message (user clicked a button)
        // 3. AUDIO message with mediaUrl
        // Note: We forward TEXT messages even with placeholder content so webhook can handle all message types
        const shouldForward =
          (messageType === 'TEXT' && content && content.trim().length > 0) ||
          (messageType === 'BUTTON_RESPONSE' && buttonResponse) ||
          (messageType === 'AUDIO' && Boolean(mediaUrl));

        if (shouldForward) {
          // CRITICAL: Check if this is a duplicate (echo of dashboard message)
          // Only check for incoming messages (not fromMe) to avoid blocking legitimate outgoing messages
          let isDuplicate = false;
          if (!fromMe && content) {
            isDuplicate = await checkIfRecentDashboardMessage({
              content: content.trim(),
              fromNumber: sanitizedFromNumber,
              timestamp: timestampIso,
              timeWindow: 5000, // 5 second window
              agentId: agentId
            });
          }

          if (isDuplicate) {
            console.log(`[BAILEYS][WEBHOOK] ⏭️ Skipping webhook for duplicate dashboard message echo:`, {
              messageId,
              from: sanitizedFromNumber,
              contentPreview: content ? content.substring(0, 50) : null,
            });
          } else {
            // Add source to webhook payload based on message type
            // - Dashboard messages (agent to self): source = 'dashboard'
            // - Incoming/Outgoing WhatsApp messages: source = 'whatsapp'
            webhookPayload.source = isDashboardMessage ? 'dashboard' : 'whatsapp';
            
            const messageSource = isDashboardMessage ? 'DASHBOARD' : 'WHATSAPP';
            console.log(`[BAILEYS][WEBHOOK] 📤 Forwarding ${messageType} message to webhook (${messageSource}):`, {
              messageId,
              from: sanitizedFromNumber,
              to: sanitizedToNumber,
              senderName: senderName,
              source: webhookPayload.source,
              isDashboardMessage,
              isIncomingWhatsApp,
              isOutgoingToOther,
              hasContent: Boolean(content),
              contentLength: content?.length || 0,
              hasMediaUrl: Boolean(mediaUrl),
              contentPreview: content ? content.substring(0, 50) : null,
              remoteJid: actualSenderJid,
            });
            await forwardMessageToWebhook(agentId, webhookPayload);
          }
        } else {
          console.log(`[BAILEYS] ⚠️ Skipping webhook forwarding:`, {
            messageId,
            messageType,
            hasContent: Boolean(content),
            contentLength: content ? content.length : 0,
            hasMediaUrl: Boolean(mediaUrl),
            reason: messageType === 'TEXT' 
              ? (content ? 'content is empty' : 'no content extracted')
              : (mediaUrl ? 'unknown' : 'no mediaUrl')
          });
        }
      }

      // Messages are now queued for batch insertion via queueMessageForBatch()
      // They will be flushed automatically when batch size (100) is reached or timeout (1s) occurs

      console.log(`[BAILEYS] ========== END MESSAGES ==========`); 
    });

    console.log(`[BAILEYS] ==================== INIT COMPLETE ====================\n`);
    
    // Note: Lock is NOT released here - connection setup is complete but QR scan is pending
    // Lock will be released when connection succeeds or fails via connection.update handler
    
    // Return success response with proper state
    return {
      success: true,
      status: 'qr_pending',
      phoneNumber: null,
      isActive: false // Critical: Not connected yet, waiting for QR scan
    };

  } catch (error) {
    console.error(`[BAILEYS] ❌ Error initializing:`, error);
    
    // Track error
    errorTracker.trackError(error, {
      agentId: shortId(agentId),
      operation: 'connection_init'
    });
    
    return {
      success: false,
      error: error.message,
      status: 'error',
      isActive: false
    };
  } finally {
    // FIX 2: Always release lock in finally block to prevent race conditions
    // This ensures the lock is released even if an error occurs or function returns early
    if (connectionLocks.has(agentId)) {
      connectionLocks.delete(agentId);
      console.log(`[BAILEYS] 🔓 Initialization lock released (finally)`);
    }
  }
}

async function safeInitializeWhatsApp(agentId, userId = null) {
  const connectionTracker = new OperationTracker('connection_establish', loggers.connection, 30000);
  const now = Date.now();

  // Check if initialization is already in progress (with stale lock detection)
  const lockValue = connectionLocks.get(agentId);
  if (lockValue) {
    const lockAge = typeof lockValue === 'number' ? now - lockValue : 0;
    
    // If lock is less than 90 seconds old, it's still active
    if (typeof lockValue === 'number' && lockAge < 90000) {
      console.log(`[BAILEYS] ⏳ Connection already in progress (${Math.round(lockAge/1000)}s ago)`);
    return {
      success: false,
      status: 'connecting',
      error: 'Connection already in progress'
    };
    }
    // Otherwise, lock is stale and will be cleared by initializeWhatsApp
  }

  // PHASE 2 FIX: Check database status FIRST to differentiate manual disconnect from error
  // This allows bypassing cooldown for manual disconnects while keeping it for errors
  console.log(`[BAILEYS] 🔍 Checking database status to determine cooldown eligibility...`);
  const { data: dbSession, error: dbError } = await supabaseAdmin
    .from('whatsapp_sessions')
    .select('status, is_active, disconnected_at')
    .eq('agent_id', agentId)
    .maybeSingle();

  if (dbError) {
    console.warn(`[BAILEYS] ⚠️ Error checking database status:`, dbError);
    // Continue with cooldown check - be conservative on error
  }

  // PHASE 2: If status is 'disconnected' (manual disconnect), bypass cooldown
  if (dbSession?.status === 'disconnected') {
    console.log(`[BAILEYS] ✅ Status is 'disconnected' (manual disconnect) - bypassing 401 cooldown`);
    console.log(`[BAILEYS] ✅ User initiated clean disconnect - allowing immediate reconnection`);
    
    // Clear any existing 401 cooldown (defensive - should already be cleared on disconnect)
    const hadCooldown = last401Failure.has(agentId);
    if (hadCooldown) {
      last401Failure.delete(agentId);
      console.log(`[BAILEYS] ✅ Cleared existing 401 cooldown (defensive cleanup)`);
    }
    
    // Allow connection to proceed - no cooldown for manual disconnects
    // Continue to connection attempt below
  } else if (dbSession?.status === 'conflict') {
    // PHASE 2: If status is 'conflict' (error disconnect), apply cooldown
    console.log(`[BAILEYS] 🚫 Session has conflict status (error disconnect) - checking cooldown...`);
    
    // Check if there was a recent 401 failure (prevent auto-retry after errors)
    const last401 = last401Failure.get(agentId);
    if (last401 && (now - last401) < FAILURE_COOLDOWN_MS) {
      const waitMs = FAILURE_COOLDOWN_MS - (now - last401);
      const waitMinutes = Math.ceil(waitMs / 60000);
      console.log(`[BAILEYS] 🚫 401 error occurred recently (${waitMinutes} min ago) - cooldown active`);
      console.log(`[BAILEYS] 🚫 Auto-retry blocked for error scenarios. Manual reconnection required.`);
      
      return {
        success: false,
        status: 'conflict',
        error: `Session conflict detected. Please wait ${waitMinutes} minute(s) or disconnect and reconnect manually.`,
        retryAfter: waitMs,
        requiresManualAction: true
      };
    }
    
    // Cooldown expired or no cooldown - but still conflict status
    console.log(`[BAILEYS] ⚠️ Session has conflict status but cooldown expired - allowing reconnection attempt`);
    console.log(`[BAILEYS] ⚠️ User will need to disconnect first to clear conflict state`);
    // Continue to connection attempt - initializeWhatsApp will handle conflict state
  } else {
    // PHASE 2: For other statuses (connecting, qr_pending, connected, etc.), check 401 cooldown
    // This handles edge cases where last401Failure exists but status isn't set yet
    const last401 = last401Failure.get(agentId);
    if (last401 && (now - last401) < FAILURE_COOLDOWN_MS) {
      const waitMs = FAILURE_COOLDOWN_MS - (now - last401);
      const waitMinutes = Math.ceil(waitMs / 60000);
      console.log(`[BAILEYS] 🚫 401 error occurred recently for agent ${agentId.substring(0, 40)}`);
      console.log(`[BAILEYS] 🚫 Status: ${dbSession?.status || 'unknown'}, Cooldown: ${waitMinutes} min remaining`);
      console.log(`[BAILEYS] 🚫 Auto-retry blocked. Manual reconnection required.`);
      
      // If status is not 'disconnected', apply cooldown
      return {
        success: false,
        status: 'cooldown',
        error: `Recent 401 error. Please wait ${waitMinutes} minute(s) or disconnect and reconnect manually.`,
        retryAfter: waitMs,
        requiresManualAction: true
      };
    }
  }

  // PHASE 2: Bypass general connection cooldown for manual disconnects
  // Only apply general cooldown if status is NOT 'disconnected'
  const lastAttempt = lastConnectionAttempt.get(agentId) || 0;
  if (dbSession?.status !== 'disconnected' && (now - lastAttempt) < COOLDOWN_MS) {
    const waitMs = COOLDOWN_MS - (now - lastAttempt);
    console.log(`[BAILEYS] 🕒 General cooldown active for agent ${agentId.substring(0, 40)}. Retry in ${Math.ceil(waitMs / 1000)}s`);
    return {
      success: false,
      status: 'cooldown',
      retryAfter: waitMs
    };
  } else if (dbSession?.status === 'disconnected' && (now - lastAttempt) < COOLDOWN_MS) {
    // Manual disconnect - bypass general cooldown
    console.log(`[BAILEYS] ✅ Manual disconnect detected - bypassing general connection cooldown`);
  }

  // Note: Lock is now managed inside initializeWhatsApp to prevent race conditions
  lastConnectionAttempt.set(agentId, now);

  // Record connection attempt metric
  recordMetric(() => {
    if (connectionMetrics?.total) {
      connectionMetrics.total.labels(shortId(agentId), userId || 'unknown', 'attempt').inc();
    }
  });

  // Track connection duration
  const connectionTimer = connectionMetrics?.duration 
    ? connectionMetrics.duration.startTimer({ agent_id: shortId(agentId) })
    : null;

  try {
    // Call initializeWhatsApp directly - it handles its own locking
    const result = await initializeWhatsApp(agentId, userId);
    
    // Record success
    if (result.success) {
      recordMetric(() => {
        if (connectionMetrics?.total) {
          connectionMetrics.total.labels(shortId(agentId), userId || 'unknown', 'success').inc();
        }
      });
    } else {
      recordMetric(() => {
        if (connectionMetrics?.total) {
          connectionMetrics.total.labels(shortId(agentId), userId || 'unknown', 'failure').inc();
        }
      });
    }
    
    // Stop timer
    if (connectionTimer) {
      connectionTimer();
    }
    
    return result;
  } catch (error) {
    connectionTracker.end({ agentId: shortId(agentId), success: false, error: error.message });
    
    // Track error
    errorTracker.trackError(error, {
      agentId: shortId(agentId),
      userId,
      operation: 'connection_init'
    });
    
    // Record failure
    recordMetric(() => {
      if (connectionMetrics?.total) {
        connectionMetrics.total.labels(shortId(agentId), userId || 'unknown', 'error').inc();
      }
    });
    
    // Stop timer
    if (connectionTimer) {
      connectionTimer();
    }
    
    throw error;
  }
}

/**
 * Clear all reconnection state for an agent
 * @param {string} agentId - Agent UUID
 */
function clearReconnectionState(agentId) {
  // Clear attempt counters
  RECONNECTION_ATTEMPTS.delete(agentId);
  RECONNECTION_DELAYS.delete(agentId);
  
  // Clear and cancel any pending timers
  const timerId = RECONNECTION_TIMERS.get(agentId);
  if (timerId) {
    clearTimeout(timerId);
    RECONNECTION_TIMERS.delete(agentId);
  }
  
  const qrTimerId = QR_EXPIRATION_TIMERS.get(agentId);
  if (qrTimerId) {
    clearTimeout(qrTimerId);
    QR_EXPIRATION_TIMERS.delete(agentId);
  }
  
  loggers.reconnect.debug({ agentId: shortId(agentId) }, 'Cleared reconnection state');
}

/**
 * Attempt automatic reconnection with exponential backoff
 * @param {string} agentId - Agent UUID
 * @param {number} statusCode - WhatsApp disconnect status code
 * @param {string} reason - Disconnect reason
 */
async function attemptReconnection(agentId, statusCode, reason) {
  try {
    // Skip reconnection for non-retryable errors
    if (RECONNECTION_CONFIG.nonRetryableCodes.includes(statusCode)) {
      loggers.reconnect.info({
        agentId: shortId(agentId),
        statusCode,
        reason
      }, 'Skipping non-retryable error');
      
      await supabaseAdmin
        .from('whatsapp_sessions')
        .update({ 
          status: 'error', 
          last_error: `Non-retryable error: ${statusCode} - ${reason}`,
          updated_at: new Date().toISOString()
        })
        .eq('agent_id', agentId);
      
      clearReconnectionState(agentId);
      return;
    }

    // Get current attempt count
    const attempts = RECONNECTION_ATTEMPTS.get(agentId) || 0;
    
    // Check if max attempts reached
    if (attempts >= RECONNECTION_CONFIG.maxAttempts) {
      loggers.reconnect.error({
        agentId: shortId(agentId),
        maxAttempts: RECONNECTION_CONFIG.maxAttempts,
        attempts
      }, 'Max reconnection attempts reached');
      
      await supabaseAdmin
        .from('whatsapp_sessions')
        .update({ 
          status: 'error', 
          last_error: `Max reconnection attempts exceeded (${RECONNECTION_CONFIG.maxAttempts})`,
          updated_at: new Date().toISOString()
        })
        .eq('agent_id', agentId);
      
      clearReconnectionState(agentId);
      return;
    }

    // Calculate delay with exponential backoff + jitter
    const exponentialDelay = Math.min(
      RECONNECTION_CONFIG.baseDelay * Math.pow(2, attempts),
      RECONNECTION_CONFIG.maxDelay
    );
    const jitter = Math.random() * 1000; // 0-1000ms random jitter
    const finalDelay = exponentialDelay + jitter;
    
    // Update attempt count and delay
    RECONNECTION_ATTEMPTS.set(agentId, attempts + 1);
    RECONNECTION_DELAYS.set(agentId, finalDelay);

    loggers.reconnect.info({
      agentId: shortId(agentId),
      attempt: attempts + 1,
      maxAttempts: RECONNECTION_CONFIG.maxAttempts,
      delayMs: Math.round(finalDelay)
    }, 'Scheduling reconnection');

    // Clear any existing timer
    const existingTimer = RECONNECTION_TIMERS.get(agentId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule reconnection
    const timerId = setTimeout(async () => {
      try {
        // Check if already reconnected
        const session = activeSessions.get(agentId);
        if (session && session.isConnected) {
          loggers.reconnect.info({ agentId: shortId(agentId) }, 'Already reconnected, skipping');
          clearReconnectionState(agentId);
          return;
        }

        loggers.reconnect.info({ agentId: shortId(agentId) }, 'Attempting reconnection');
        
        // Get user_id for this agent
        const { data: sessionData } = await supabaseAdmin
          .from('whatsapp_sessions')
          .select('user_id')
          .eq('agent_id', agentId)
          .single();

        if (!sessionData) {
          loggers.reconnect.error({ agentId: shortId(agentId) }, 'No session data found');
          clearReconnectionState(agentId);
          return;
        }

        // Attempt to reconnect
        await safeInitializeWhatsApp(agentId, sessionData.user_id);
        
        // Success - reset counters
        clearReconnectionState(agentId);
        loggers.reconnect.info({ agentId: shortId(agentId) }, 'Reconnection successful');
        
      } catch (error) {
        loggers.reconnect.error({
          agentId: shortId(agentId),
          error: error.message,
          stack: error.stack
        }, 'Reconnection failed');
        
        // Will retry automatically via exponential backoff
        // unless max attempts reached
      }
    }, finalDelay);
    
    RECONNECTION_TIMERS.set(agentId, timerId);
    
  } catch (error) {
    loggers.reconnect.error({
      agentId: shortId(agentId),
      error: error.message,
      stack: error.stack
    }, 'Error in attemptReconnection');
  }
}

// Disconnect
async function disconnectWhatsApp(agentId) {
  console.log(`\n[BAILEYS] ==================== DISCONNECT START ====================`);
  console.log(`[BAILEYS] Disconnecting: ${agentId.substring(0, 40)}`);
  
  const cleanupSteps = {
    logoutAttempted: false,
    logoutSucceeded: false,
    intervalsCleared: false,
    socketClosed: false,
    instanceTrackingCleared: false,
    memoryCleared: false,
    localFilesDeleted: false,
    databaseCleared: false
  };
  
  const errors = [];
  const disconnectedAt = new Date().toISOString();
  
  try {
    const session = activeSessions.get(agentId);
    
    // STEP 1: Attempt explicit logout from WhatsApp servers
    if (session?.socket) {
      console.log(`[BAILEYS] 🔐 Step 1: Attempting explicit logout from WhatsApp servers...`);
      cleanupSteps.logoutAttempted = true;
      
      try {
        // Check if socket is still connected before attempting logout
        if (session.isConnected && session.socket && typeof session.socket.logout === 'function') {
          await Promise.race([
            session.socket.logout(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Logout timeout')), 5000))
          ]);
          cleanupSteps.logoutSucceeded = true;
          console.log(`[BAILEYS] ✅ Logout successful - device unregistered from WhatsApp servers`);
        } else {
          console.log(`[BAILEYS] ℹ️ Socket not connected or logout not available - skipping logout`);
          cleanupSteps.logoutSucceeded = true; // Not an error if already disconnected
        }
      } catch (logoutError) {
        // Logout might fail if already disconnected - this is acceptable
        if (logoutError.message === 'Logout timeout' || logoutError.message.includes('not connected')) {
          console.log(`[BAILEYS] ℹ️ Logout skipped: ${logoutError.message}`);
          cleanupSteps.logoutSucceeded = true; // Not an error
        } else {
          console.warn(`[BAILEYS] ⚠️ Logout failed (non-critical):`, logoutError.message);
          errors.push({ step: 'logout', error: logoutError.message });
          // Continue cleanup even if logout fails
        }
      }
      
      // STEP 2: Stop health check, heartbeat, connection monitor, and backup intervals
      console.log(`[BAILEYS] 🛑 Step 2: Stopping all intervals...`);
      try {
        // REMOVED: healthCheckInterval - no longer used
        if (session.heartbeatInterval) {
          clearInterval(session.heartbeatInterval);
          session.heartbeatInterval = null;
        }
        if (session.backupInterval) {
          clearInterval(session.backupInterval);
          session.backupInterval = null;
        }
        
        // Clear reconnection state on manual disconnect
        clearReconnectionState(agentId);
        
        cleanupSteps.intervalsCleared = true;
        console.log(`[BAILEYS] ✅ All intervals cleared`);
      } catch (intervalError) {
        console.warn(`[BAILEYS] ⚠️ Error clearing intervals:`, intervalError.message);
        errors.push({ step: 'intervals', error: intervalError.message });
      }
      
      // STEP 3: Close socket and remove event listeners
      console.log(`[BAILEYS] 🔌 Step 3: Closing socket and removing event listeners...`);
      try {
        session.socket.ev.removeAllListeners();
        session.socket.end();
        cleanupSteps.socketClosed = true;
        console.log(`[BAILEYS] ✅ Socket closed`);
      } catch (socketError) {
        console.warn(`[BAILEYS] ⚠️ Error closing socket:`, socketError.message);
        errors.push({ step: 'socket', error: socketError.message });
      }
    } else {
      console.log(`[BAILEYS] ℹ️ No active session found - skipping socket cleanup`);
      cleanupSteps.socketClosed = true; // Not an error if no session
    }
    
    // STEP 4: Clear instance tracking in database (with retry)
    console.log(`[BAILEYS] 🗄️ Step 4: Clearing instance tracking in database...`);
    const maxRetries = 3;
    let instanceTrackingSuccess = false;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { error: instanceError } = await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            instance_id: null,
            instance_hostname: null,
            instance_pid: null,
            last_heartbeat: null,
            updated_at: disconnectedAt
          })
          .eq('agent_id', agentId);
        
        if (instanceError) {
          throw instanceError;
        }
        
        instanceTrackingSuccess = true;
        cleanupSteps.instanceTrackingCleared = true;
        console.log(`[BAILEYS] ✅ Instance tracking cleared (attempt ${attempt})`);
        break;
      } catch (instanceError) {
        if (attempt === maxRetries) {
          console.error(`[BAILEYS] ❌ Failed to clear instance tracking after ${maxRetries} attempts:`, instanceError.message);
          errors.push({ step: 'instance_tracking', error: instanceError.message });
        } else {
          console.warn(`[BAILEYS] ⚠️ Instance tracking clear failed (attempt ${attempt}/${maxRetries}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // Exponential backoff
        }
      }
    }
    
    // STEP 5: Clear from memory
    console.log(`[BAILEYS] 🧠 Step 5: Clearing from memory...`);
    try {
      await removeAgentFromActiveSessions(agentId);
      qrGenerationTracker.delete(agentId);
      connectionLocks.delete(agentId);
      lastConnectionAttempt.delete(agentId);
      cleanupSteps.memoryCleared = true;
      console.log(`[BAILEYS] ✅ Memory cleared`);
    } catch (memoryError) {
      console.warn(`[BAILEYS] ⚠️ Error clearing memory:`, memoryError.message);
      errors.push({ step: 'memory', error: memoryError.message });
    }
    
    // Clear 401 failure cooldown on manual disconnect (user wants to reconnect)
    last401Failure.delete(agentId);
    console.log(`[BAILEYS] ✅ 401 failure cooldown cleared (manual disconnect)`);
    
    // STEP 6: Delete local auth directory (with error handling)
    console.log(`[BAILEYS] 🗑️ Step 6: Deleting local auth directory...`);
    const authDir = path.join(__dirname, '../../auth_sessions', agentId);
    if (fs.existsSync(authDir)) {
      try {
        fs.rmSync(authDir, { recursive: true, force: true });
        cleanupSteps.localFilesDeleted = true;
        console.log(`[BAILEYS] ✅ Local credentials deleted`);
      } catch (deleteError) {
        console.error(`[BAILEYS] ❌ Failed to delete local auth directory:`, deleteError.message);
        console.error(`[BAILEYS] Error details:`, deleteError);
        errors.push({ step: 'local_files', error: deleteError.message });
        // Continue - database cleanup is more important
      }
    } else {
      console.log(`[BAILEYS] ℹ️ No local auth directory to delete`);
      cleanupSteps.localFilesDeleted = true; // Not an error if doesn't exist
    }
    
    // STEP 7: Clear database session data completely (with retry and NULL verification)
    console.log(`[BAILEYS] 🗄️ Step 7: Clearing database session data...`);
    let dbClearSuccess = false;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // CRITICAL: Use explicit NULL (not empty string or object)
        // Include disconnected_at - if column doesn't exist, database will ignore it
        // (PostgreSQL/Supabase allows extra fields in updates)
        const updateData = {
          session_data: null, // Explicitly set to NULL
          qr_code: null,
          qr_generated_at: null,
          is_active: false,
          phone_number: null,
          status: 'disconnected', // Set status to disconnected
          disconnected_at: disconnectedAt, // Track when disconnect occurred (column may not exist yet)
          updated_at: disconnectedAt
        };
        
        const { error: dbError, data: dbData } = await supabaseAdmin
          .from('whatsapp_sessions')
          .update(updateData)
          .eq('agent_id', agentId)
          .select('session_data'); // Verify update succeeded
        
        if (dbError) {
          // Check if error is due to missing disconnected_at column
          if (dbError.message && dbError.message.includes('disconnected_at')) {
            console.log(`[BAILEYS] ℹ️ disconnected_at column not found, retrying without it...`);
            // Retry without disconnected_at column
            const { error: retryError, data: retryData } = await supabaseAdmin
              .from('whatsapp_sessions')
              .update({
                session_data: null,
                qr_code: null,
                qr_generated_at: null,
                is_active: false,
                phone_number: null,
                status: 'disconnected',
                updated_at: disconnectedAt
              })
              .eq('agent_id', agentId)
              .select('session_data');
            
            if (retryError) {
              throw retryError;
            }
            
            // Use retry data for verification
            if (retryData && retryData.length > 0) {
              const updatedSession = retryData[0];
              if (updatedSession.session_data !== null && updatedSession.session_data !== undefined) {
                console.warn(`[BAILEYS] ⚠️ session_data is not NULL after update:`, typeof updatedSession.session_data);
                // Try one more explicit NULL update
                await supabaseAdmin
                  .from('whatsapp_sessions')
                  .update({ session_data: null })
                  .eq('agent_id', agentId)
                  .is('session_data', null); // Use is() to ensure NULL
              }
            }
          } else {
            throw dbError;
          }
        } else {
          // Verify session_data is actually NULL (not empty object/string)
          if (dbData && dbData.length > 0) {
            const updatedSession = dbData[0];
            if (updatedSession.session_data !== null && updatedSession.session_data !== undefined) {
              console.warn(`[BAILEYS] ⚠️ session_data is not NULL after update:`, typeof updatedSession.session_data);
              // Try one more explicit NULL update
              await supabaseAdmin
                .from('whatsapp_sessions')
                .update({ session_data: null })
                .eq('agent_id', agentId)
                .is('session_data', null); // Use is() to ensure NULL
            }
          }
        }
        
        dbClearSuccess = true;
        cleanupSteps.databaseCleared = true;
        console.log(`[BAILEYS] ✅ Database cleared (attempt ${attempt})`);
        console.log(`[BAILEYS] ✅ Status set to 'disconnected', disconnected_at: ${disconnectedAt}`);
        break;
      } catch (dbError) {
        if (attempt === maxRetries) {
          console.error(`[BAILEYS] ❌ Failed to clear database after ${maxRetries} attempts:`, dbError.message);
          errors.push({ step: 'database', error: dbError.message });
        } else {
          console.warn(`[BAILEYS] ⚠️ Database clear failed (attempt ${attempt}/${maxRetries}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // Exponential backoff
        }
      }
    }
    
    // STEP 8: Verify cleanup succeeded
    console.log(`[BAILEYS] ✅ Step 8: Verifying cleanup...`);
    const allCriticalStepsSucceeded = 
      cleanupSteps.socketClosed &&
      cleanupSteps.memoryCleared &&
      cleanupSteps.databaseCleared;
    
    if (allCriticalStepsSucceeded) {
      console.log(`[BAILEYS] ✅ All critical cleanup steps succeeded`);
    } else {
      console.warn(`[BAILEYS] ⚠️ Some cleanup steps failed:`, cleanupSteps);
    }
    
    if (errors.length > 0) {
      console.warn(`[BAILEYS] ⚠️ Cleanup completed with ${errors.length} non-critical error(s):`);
      errors.forEach(err => {
        console.warn(`[BAILEYS]   - ${err.step}: ${err.error}`);
      });
    }
    
    console.log(`[BAILEYS] ==================== DISCONNECT COMPLETE ====================\n`);
    emitAgentEvent(agentId, 'disconnected', { reason: 'manual', disconnectedAt, cleanupSteps, errors });
    
    // Return cleanup status for verification
    return {
      success: allCriticalStepsSucceeded,
      cleanupSteps,
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    console.error(`[BAILEYS] ❌ Critical error during disconnect:`, error);
    emitAgentEvent(agentId, 'disconnected', { reason: 'error', error: error.message });
    throw error; // Re-throw critical errors
  }
}

// Get QR code for an agent
function getQRCode(agentId) {
  const session = activeSessions.get(agentId);
  return session?.qrCode || null;
}

// Get status
function getSessionStatus(agentId) {
  const session = activeSessions.get(agentId);
  
  if (!session) {
    return {
      exists: false,
      isConnected: false,
      phoneNumber: null,
      qrCode: null
    };
  }
  
  return {
    exists: true,
    isConnected: session.isConnected,
    phoneNumber: session.phoneNumber,
    qrCode: session.qrCode
  };
}

async function getWhatsAppStatus(agentId) {
  const nowIso = new Date().toISOString();
  const response = {
    success: true,
    connected: false,
    status: 'disconnected',
    is_active: false,
    qr_code: null,
    phone_number: null,
    updated_at: nowIso,
    source: 'none',
    message: null,
    socket_state: null,
    last_activity: null,
    failure_reason: null,
    failure_at: null
  };

  try {
    const session = activeSessions.get(agentId);

    if (session) {
      response.source = 'memory';
      response.socket_state = session.socket?.ws?.readyState ?? null;
      // REMOVED: last_activity tracking - we can't reliably track it
      response.phone_number =
        session.phoneNumber ||
        session.socket?.user?.id?.split(':')[0]?.replace('@s.whatsapp.net', '') ||
        null;

      if (session.failureReason) {
        response.failure_reason = session.failureReason;
        response.failure_at = session.failureAt
          ? new Date(session.failureAt).toISOString()
          : nowIso;
        response.status = 'conflict';
        if (!response.message) {
          response.message = session.failureReason;
        }
      }

      if (session.isConnected || response.socket_state === 1) {
        response.connected = true;
        response.is_active = true;
        response.status = 'connected';
        response.qr_code = null;
      } else if (session.qrCode) {
        // CRITICAL: Check if QR is expired before returning it
        if (session.qrGeneratedAt) {
          const qrAge = Date.now() - session.qrGeneratedAt;
          if (qrAge > QR_EXPIRATION_MS) {
            console.log(`[BAILEYS] ⚠️ QR in memory is expired (${Math.round(qrAge/1000)}s old), clearing`);
            session.qrCode = null;
            session.qrGeneratedAt = null;
            response.status = 'disconnected';
            response.qr_code = null;
          } else {
            response.status = 'qr_pending';
            response.qr_code = session.qrCode;
          }
        } else {
          response.status = 'qr_pending';
          response.qr_code = session.qrCode;
        }
      } else if (session.connectionState) {
        response.status = session.connectionState;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, is_active, qr_code, phone_number, updated_at')
      .eq('agent_id', agentId)
      .maybeSingle();

    if (error) {
      console.error(`[BAILEYS] ⚠️ Supabase status fetch error for ${agentId.substring(0, 40)}:`, error.message);
    }

    if (data) {
      response.source =
        response.source === 'memory' ? 'memory+database' : 'database';
      response.updated_at = data.updated_at || response.updated_at;
      if (!response.phone_number && data.phone_number) {
        response.phone_number = data.phone_number;
      }

      // CRITICAL: Only trust database status if there's no active session in memory
      // If memory session exists, it's the source of truth (more recent)
      if (!response.connected && !session) {
        // No active session in memory - check database
        if (data.is_active && data.status === 'connected' && data.phone_number) {
          // Database says connected, but verify it's not stale
          // If status is conflict, don't trust is_active
          if (data.status !== 'conflict') {
            response.connected = true;
            response.is_active = true;
            response.status = 'connected';
            response.qr_code = null;
          } else {
            // Status is conflict - mark as disconnected
            response.connected = false;
            response.is_active = false;
            response.status = 'conflict';
          }
        } else if (data.qr_code) {
          // CRITICAL: Check if database QR is expired
          const { data: qrData } = await supabaseAdmin
            .from('whatsapp_sessions')
            .select('qr_generated_at')
            .eq('agent_id', agentId)
            .maybeSingle();
          
          if (qrData?.qr_generated_at) {
            const qrAge = Date.now() - new Date(qrData.qr_generated_at).getTime();
            if (qrAge > QR_EXPIRATION_MS) {
              console.log(`[BAILEYS] ⚠️ QR in database is expired (${Math.round(qrAge/1000)}s old), clearing`);
              await supabaseAdmin
                .from('whatsapp_sessions')
                .update({ qr_code: null, status: 'disconnected' })
                .eq('agent_id', agentId);
              response.status = 'disconnected';
              response.qr_code = null;
            } else {
              response.qr_code = data.qr_code;
              response.status = 'qr_pending';
            }
          } else {
            response.qr_code = data.qr_code;
            response.status = 'qr_pending';
          }
        } else if (data.status) {
          response.status = data.status;
          // If status is conflict, ensure is_active is false
          if (data.status === 'conflict') {
            response.is_active = false;
            response.connected = false;
          }
        }
      }

      if (data.status === 'conflict' && !response.message) {
        response.message = 'WhatsApp reported a session conflict. Please remove other linked devices and reconnect.';
        if (!response.failure_reason) {
          response.failure_reason = 'conflict';
        }
      }
    }

    if (response.source === 'none') {
      response.message = 'No active WhatsApp session';
      response.source = 'fallback';
    }
    
    // CRITICAL: Add detailed QR state logging
    if (response.status === 'qr_pending') {
      const session = activeSessions.get(agentId);
      const qrGenTime = qrGenerationTracker.get(agentId);
      console.log(`[BAILEYS] 📊 QR State Check:`, {
        agentId: agentId.substring(0, 8) + '...',
        hasQRInMemory: !!session?.qrCode,
        hasQRInDatabase: !!data?.qr_code,
        qrCodeInResponse: !!response.qr_code,
        qrGeneratedAt: session?.qrGeneratedAt ? new Date(session.qrGeneratedAt).toISOString() : null,
        cooldownRemaining: qrGenTime ? Math.max(0, Math.round((120000 - (Date.now() - qrGenTime)) / 1000)) + 's' : 'none',
        dbStatus: data?.status,
        socketState: session?.socket?.ws?.readyState
      });
    }

    return response;
  } catch (error) {
    console.error(`[BAILEYS] ❌ Error in getWhatsAppStatus for ${agentId.substring(0, 40)}:`, error);
    return {
      success: false,
      connected: false,
      status: 'error',
      is_active: false,
      qr_code: null,
      phone_number: null,
      updated_at: nowIso,
      source: 'error',
      message: error.message,
      socket_state: null,
      last_activity: null
    };
  }
}

// Send message
/**
 * Send plain text message via WhatsApp
 * @param {string} agentId - Agent ID
 * @param {string} to - Recipient phone number
 * @param {string} message - Plain text message string
 * @returns {Promise<void>}
 */
async function sendMessage(agentId, to, message) {
  const session = activeSessions.get(agentId);
  
  if (!session || !session.isConnected) {
    throw new Error('WhatsApp not connected');
  }
  
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  
  // Plain text message
  const textMessage = typeof message === 'string' ? message : String(message);
  await session.socket.sendMessage(jid, { text: textMessage });
  console.log(`[BAILEYS] ✅ Text message sent to ${to}`);
}

/**
 * Check rate limit for WhatsApp number validation
 * @param {string} agentId - Agent UUID
 * @throws {Error} If rate limit exceeded
 */
function checkValidationRateLimit(agentId) {
  const limiter = validationRateLimiters.get(agentId) || { count: 0, resetAt: Date.now() + VALIDATION_RATE_WINDOW };
  
  if (Date.now() > limiter.resetAt) {
    limiter.count = 0;
    limiter.resetAt = Date.now() + VALIDATION_RATE_WINDOW;
  }
  
  if (limiter.count >= VALIDATION_RATE_LIMIT) {
    throw new Error('Rate limit exceeded. Please try again in a moment.');
  }
  
  limiter.count++;
  validationRateLimiters.set(agentId, limiter);
}

/**
 * Check if a phone number is registered on WhatsApp
 * @param {string} agentId - Agent UUID
 * @param {string} phoneNumber - Phone number to check (sanitized, digits only)
 * @param {boolean} useCache - Whether to use cache (default: true)
 * @returns {Promise<{isOnWhatsApp: boolean, jid?: string, error?: string}>}
 */
async function isNumberOnWhatsApp(agentId, phoneNumber, useCache = true) {
  const logPrefix = `[BAILEYS][VALIDATION][${agentId.substring(0, 8)}]`;
  
  // Get session
  const session = activeSessions.get(agentId);
  
  if (!session || !session.isConnected || !session.socket) {
    throw new Error('WhatsApp not connected');
  }
  
  // Check cache first
  const cacheKey = `${agentId}:${phoneNumber}`;
  if (useCache) {
    const cached = validationCache.get(cacheKey);
    if (cached !== undefined) {
      cacheStats.validation.hits++;
      recordMetric(() => {
        if (cacheMetrics?.hits) {
          cacheMetrics.hits.labels('validation').inc();
        }
      });
      // LRU handles TTL automatically, but we check expiresAt for legacy compatibility
      if (cached.expiresAt && Date.now() < cached.expiresAt) {
        loggers.database.debug({ agentId: shortId(agentId), phone: phoneNumber.substring(0, 8) }, 'Validation cache hit');
      return cached.result;
    }
    // Cache expired, remove it
    validationCache.delete(cacheKey);
    } else {
      cacheStats.validation.misses++;
      recordMetric(() => {
        if (cacheMetrics?.misses) {
          cacheMetrics.misses.labels('validation').inc();
        }
      });
    }
  }
  
  // Format phone number as JID
  const jid = phoneNumber.includes('@') 
    ? phoneNumber 
    : `${phoneNumber}@s.whatsapp.net`;
  
  try {
    // Check rate limit
    checkValidationRateLimit(agentId);
    
    console.log(`${logPrefix} Checking if ${phoneNumber.substring(0, 8)}... is on WhatsApp`);
    
    // Use Baileys onWhatsApp method
    const result = await session.socket.onWhatsApp(jid);
    
    console.log(`${logPrefix} Validation result:`, {
      phone: phoneNumber.substring(0, 8) + '...',
      exists: result && result.length > 0 && result[0].exists !== false
    });
    
    const validationResult = {
      isOnWhatsApp: result && result.length > 0 && result[0].exists !== false,
      jid: result && result.length > 0 ? result[0].jid : jid
    };
    
    // Cache result (LRU handles TTL automatically, but we keep expiresAt for legacy compatibility)
    if (useCache) {
      validationCache.set(cacheKey, {
        result: validationResult,
        expiresAt: Date.now() + VALIDATION_CACHE_TTL
      });
      loggers.database.debug({ agentId: shortId(agentId), phone: phoneNumber.substring(0, 8) }, 'Validation result cached');
    }
    
    return validationResult;
  } catch (error) {
    console.error(`${logPrefix} Error checking WhatsApp status for ${phoneNumber.substring(0, 8)}...:`, error.message);
    
    // If it's a rate limit error, throw it
    if (error.message.includes('Rate limit')) {
      throw error;
    }
    
    // For other errors, return false but don't block the message
    return {
      isOnWhatsApp: false,
      jid: jid,
      error: error.message
    };
  }
}

// Cleanup expired QR codes
setInterval(async () => {
  try {
    const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();
    
    const { data: expiredSessions } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id')
      .lt('qr_generated_at', twoMinutesAgo)
      .eq('is_active', false)
      .not('qr_code', 'is', null);
    
    if (expiredSessions && expiredSessions.length > 0) {
      console.log(`[CLEANUP] Clearing ${expiredSessions.length} expired QR codes`);
      
      for (const session of expiredSessions) {
        qrGenerationTracker.delete(session.agent_id);
        
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            qr_code: null,
            qr_generated_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', session.agent_id);
      }
      
      console.log(`[CLEANUP] ✅ Complete`);
    }
  } catch (error) {
    console.error('[CLEANUP] Error:', error);
  }
}, 300000);

async function bufferFromFile(file) {
  if (!file) {
    throw new Error('File payload missing');
  }

  if (typeof file.arrayBuffer === 'function') {
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (file.buffer) {
    return Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
  }

  throw new Error('Unsupported file payload - expected File or Buffer');
}

function sanitiseFileName(filename) {
  return filename.replace(/[^a-z0-9\.\-_]/gi, '_');
}

async function uploadAgentFile(agentId, file) {
  if (!agentId) throw new Error('Agent ID is required');
  if (!file?.name) throw new Error('File name is required');

  if (!ALLOWED_FILE_TYPES.has(file.type)) {
    throw new Error('File type not supported. Use PDF, DOC, or DOCX');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File exceeds 10MB limit');
  }

  const buffer = await bufferFromFile(file);
  const timestamp = Date.now();
  const safeName = sanitiseFileName(file.name);
  const storagePath = `${agentId}/${timestamp}_${safeName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error('[FILES] Upload failed:', uploadError);
    throw new Error('Upload failed. Try again');
  }

  const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error('[FILES] Failed to create signed URL:', signedUrlError);
    throw new Error('Upload succeeded but fetching URL failed');
  }

  const metadata = {
    id: randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type,
    url: signedUrlData.signedUrl,
    uploadedAt: new Date().toISOString(),
    storagePath: `${STORAGE_BUCKET}/${storagePath}`
  };

  return {
    url: signedUrlData.signedUrl,
    metadata
  };
}

async function updateAgentFiles(agentId, files) {
  if (!agentId) throw new Error('Agent ID is required');

  const sanitizedFiles = Array.isArray(files) ? files : [];

  const { data, error } = await supabaseAdmin
    .from('agents')
    .update({ uploaded_files: sanitizedFiles })
    .eq('id', agentId)
    .select('uploaded_files')
    .single();

  if (error) {
    console.error('[FILES] Failed to update file list:', error);
    throw new Error('Failed to update files');
  }

  return data.uploaded_files || [];
}

async function deleteAgentFile(agentId, fileId) {
  if (!agentId || !fileId) throw new Error('Agent ID and file ID are required');

  const { data: agentData, error: agentError } = await supabaseAdmin
    .from('agents')
    .select('uploaded_files')
    .eq('id', agentId)
    .maybeSingle();

  if (agentError) {
    console.error('[FILES] Failed to load uploaded files:', agentError);
    throw new Error('Failed to delete file. Try again');
  }

  const files = agentData?.uploaded_files || [];
  const fileToDelete = files.find((item) => item.id === fileId);

  if (!fileToDelete) {
    throw new Error('File not found');
  }

  const storagePath = fileToDelete.storagePath?.replace(`${STORAGE_BUCKET}/`, '');

  if (storagePath) {
    const { error: removeError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove([storagePath]);

    if (removeError) {
      console.error('[FILES] Failed to remove storage object:', removeError);
      throw new Error('Delete failed. Try again');
    }
  }

  const updatedFiles = files.filter((item) => item.id !== fileId);

  await updateAgentFiles(agentId, updatedFiles);

  return updatedFiles;
}

async function updateIntegrationEndpoints(agentId, endpoints) {
  if (!agentId) throw new Error('Agent ID is required');

  const list = Array.isArray(endpoints) ? endpoints : [];

  if (list.length > 10) {
    throw new Error('Maximum 10 endpoints allowed');
  }

  const seen = new Set();
  const sanitized = list.map((endpoint) => {
    if (!endpoint?.name || !endpoint?.url) {
      throw new Error('Endpoint name and URL are required');
    }

    const key = endpoint.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new Error('Endpoint name already exists');
    }
    seen.add(key);

    return {
      id: endpoint.id || randomUUID(),
      name: endpoint.name,
      url: endpoint.url
    };
  });

  const { data, error } = await supabaseAdmin
    .from('agents')
    .update({ integration_endpoints: sanitized })
    .eq('id', agentId)
    .select('integration_endpoints')
    .single();

  if (error) {
    console.error('[ENDPOINTS] Failed to update endpoints:', error);
    throw new Error('Failed to update integration endpoints');
  }

  return data.integration_endpoints || [];
}

// Initialize existing sessions on startup (optional - for session recovery)
// Initialize existing WhatsApp sessions on server startup
// This function is called when the backend starts to restore active connections
/**
 * Initialize existing sessions in batches
 * Phase 3C.2 optimization with pagination
 */
async function initializeExistingSessions() {
  try {
    loggers.connection.info('Initializing existing sessions');
    
    // Get total count first (uses idx_whatsapp_sessions_status_active_heartbeat)
    const { count, error: countError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('*', { count: 'exact', head: true })
      .in('status', ['connected', 'qr_pending', 'connecting'])
      .eq('is_active', true);
    
    if (countError) {
      loggers.connection.error({ error: countError.message }, 'Failed to count sessions');
      return;
    }
    
    loggers.connection.info({ totalSessions: count }, 'Total active sessions found');
    
    // Process in batches for large deployments
    const BATCH_SIZE = 100;
    const batches = Math.ceil((count || 0) / BATCH_SIZE);
    
    if (batches > 1) {
      loggers.connection.info({ batches, batchSize: BATCH_SIZE }, 'Processing in batches');
    }
    
    for (let i = 0; i < batches; i++) {
      const offset = i * BATCH_SIZE;
      
      loggers.connection.info({
        batch: i + 1,
        totalBatches: batches,
        offset
      }, 'Processing batch');
      
      // Reconnect batch
      const stats = await reconnectAllAgents();
      
      if (stats.total === 0) {
        loggers.connection.info('No more agents to reconnect');
        break;
      }
      
      // Delay between batches to prevent overload
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    loggers.connection.info('Existing sessions initialized');
    
  } catch (error) {
    loggers.connection.error({ error: error.message }, 'Failed to initialize existing sessions');
  }
}

/**
 * Reconnect all agents that were active before server restart
 * Called on server startup to restore connections
 */
/**
 * Reconnect all active agents in parallel
 * Uses p-limit for concurrency control
 */
/**
 * Reconnect all active agents in parallel with optimized query
 * Phase 3C.2 optimization
 */
async function reconnectAllAgents() {
  const startTime = Date.now();
  
  try {
    loggers.reconnect.info('Starting parallel agent reconnection');
    
    // Optimized query: uses idx_whatsapp_sessions_status_active_heartbeat
    // Select only required fields to reduce data transfer
    const { data: sessions, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, user_id, phone_number, status')
      .in('status', ['connected', 'qr_pending', 'connecting'])
      .eq('is_active', true)
      .order('last_heartbeat', { ascending: false })
      .limit(1000); // Safety limit for large deployments
    
    if (error) {
      loggers.reconnect.error({ error: error.message }, 'Failed to fetch sessions');
      throw error;
    }
    
    if (!sessions || sessions.length === 0) {
      loggers.reconnect.info('No agents to reconnect');
      return { success: 0, failed: 0, total: 0 };
    }
    
    loggers.reconnect.info({ count: sessions.length }, 'Found agents to reconnect');
    
    // Process in parallel with concurrency limit
    const limit = pLimit(CONCURRENCY_CONFIG.maxConcurrent);
    const connectionDelay = CONCURRENCY_CONFIG.connectionDelay;
    
    let successCount = 0;
    let failureCount = 0;
    const failedAgents = [];
    
    const results = await Promise.allSettled(
      sessions.map((session, index) =>
        limit(async () => {
          // Stagger connection starts to prevent thundering herd
          if (index > 0 && connectionDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, connectionDelay));
          }
          
          loggers.reconnect.info({
            agentId: shortId(session.agent_id),
            progress: `${index + 1}/${sessions.length}`
          }, 'Starting reconnection');
          
          try {
            const connStart = Date.now();
        await initializeWhatsApp(session.agent_id, session.user_id);
            const connTime = Date.now() - connStart;
            
            loggers.reconnect.info({
              agentId: shortId(session.agent_id),
              connectionTime: connTime
            }, 'Reconnection successful');
            
            return { success: true, agentId: session.agent_id, time: connTime };
            
      } catch (error) {
            loggers.reconnect.error({
              agentId: shortId(session.agent_id),
              error: error.message
            }, 'Reconnection failed');
        
            // Update database with error (don't await to prevent blocking)
            supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            status: 'error',
            last_error: error.message,
                updated_at: new Date().toISOString()
              })
              .eq('agent_id', session.agent_id)
              .then(() => {})
              .catch(err => loggers.database.error({ error: err.message }, 'Failed to update error status'));
            
            return { success: false, agentId: session.agent_id, error: error.message };
          }
        })
      )
    );

    // Calculate statistics
    const totalDuration = Date.now() - startTime;
    const connectionTimes = [];
    
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          successCount++;
          if (result.value.time) {
            connectionTimes.push(result.value.time);
          }
        } else {
          failureCount++;
          failedAgents.push({
            agentId: shortId(result.value.agentId),
            error: result.value.error
          });
        }
      } else {
        failureCount++;
      }
    });
    
    const avgConnectionTime = connectionTimes.length > 0
      ? Math.round(connectionTimes.reduce((a, b) => a + b, 0) / connectionTimes.length)
      : 0;
    
    const throughput = sessions.length / (totalDuration / 1000);
    const successRate = (successCount / sessions.length * 100).toFixed(1);
    
    // Log summary
    loggers.reconnect.info({
      successful: successCount,
      failed: failureCount,
      total: sessions.length,
      successRate: `${successRate}%`,
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      throughput: `${throughput.toFixed(2)} agents/s`,
      avgConnectionTime: `${avgConnectionTime}ms`
    }, 'Reconnection summary');
    
    if (failedAgents.length > 0 && failedAgents.length <= 10) {
      loggers.reconnect.warn({ failedAgents }, 'Failed agents');
    } else if (failedAgents.length > 10) {
      loggers.reconnect.warn({
        failedCount: failedAgents.length,
        sample: failedAgents.slice(0, 5)
      }, 'Many agents failed (showing first 5)');
    }
    
    return {
      success: successCount,
      failed: failureCount,
      total: sessions.length,
      duration: totalDuration,
      throughput,
      avgConnectionTime
    };
        
      } catch (error) {
    loggers.reconnect.error({
      error: error.message,
      stack: error.stack
    }, 'Fatal error in reconnectAllAgents');
    return { success: false, error: error.message };
  }
}

/**
 * Clear all caches
 * Useful for testing or manual cleanup
 */
function clearAllCaches() {
  const before = {
    validation: validationCache.size,
    lidToPhone: lidToPhoneCache.size,
    session: SESSION_CACHE.size
  };
  
  validationCache.clear();
  lidToPhoneCache.clear();
  SESSION_CACHE.clear();
  
  // Reset statistics
  cacheStats.validation = { hits: 0, misses: 0, evictions: 0 };
  cacheStats.lidToPhone = { hits: 0, misses: 0, evictions: 0 };
  cacheStats.session = { hits: 0, misses: 0, evictions: 0 };
  
  logger.info({ clearedEntries: before }, 'All caches cleared');
}

/**
 * Periodic cache maintenance
 * Runs every 5 minutes to:
 * - Log cache statistics
 * - Clear stale entries
 * - Monitor cache health
 * Phase 3C.3
 */
function startCacheMaintenance() {
  setInterval(() => {
    try {
      // Calculate hit rates
      const validationHitRate = cacheStats.validation.hits + cacheStats.validation.misses > 0
        ? (cacheStats.validation.hits / (cacheStats.validation.hits + cacheStats.validation.misses) * 100).toFixed(2)
        : 0;
      
      const lidHitRate = cacheStats.lidToPhone.hits + cacheStats.lidToPhone.misses > 0
        ? (cacheStats.lidToPhone.hits / (cacheStats.lidToPhone.hits + cacheStats.lidToPhone.misses) * 100).toFixed(2)
        : 0;
      
      const sessionHitRate = cacheStats.session.hits + cacheStats.session.misses > 0
        ? (cacheStats.session.hits / (cacheStats.session.hits + cacheStats.session.misses) * 100).toFixed(2)
        : 0;
      
      // Update cache size metrics
      recordMetric(() => {
        if (cacheMetrics?.size) {
          cacheMetrics.size.labels('validation').set(validationCache.size);
          cacheMetrics.size.labels('lidToPhone').set(lidToPhoneCache.size);
          cacheMetrics.size.labels('session').set(SESSION_CACHE.size);
        }
      });
      
      // Log cache statistics
      loggers.perf.info({
        validation: {
          size: validationCache.size,
          max: CACHE_CONFIG.validation.max,
          hits: cacheStats.validation.hits,
          misses: cacheStats.validation.misses,
          evictions: cacheStats.validation.evictions,
          hitRate: `${validationHitRate}%`,
          utilization: `${(validationCache.size / CACHE_CONFIG.validation.max * 100).toFixed(1)}%`
        },
        lidToPhone: {
          size: lidToPhoneCache.size,
          max: CACHE_CONFIG.lidToPhone.max,
          hits: cacheStats.lidToPhone.hits,
          misses: cacheStats.lidToPhone.misses,
          evictions: cacheStats.lidToPhone.evictions,
          hitRate: `${lidHitRate}%`,
          utilization: `${(lidToPhoneCache.size / CACHE_CONFIG.lidToPhone.max * 100).toFixed(1)}%`
        },
        session: {
          size: SESSION_CACHE.size,
          max: CACHE_CONFIG.session.max,
          hits: cacheStats.session.hits,
          misses: cacheStats.session.misses,
          evictions: cacheStats.session.evictions,
          hitRate: `${sessionHitRate}%`,
          utilization: `${(SESSION_CACHE.size / CACHE_CONFIG.session.max * 100).toFixed(1)}%`
        }
      }, 'Cache statistics');
      
      // Warn if cache hit rate is low
      if (parseFloat(validationHitRate) < 50 && cacheStats.validation.hits > 100) {
        loggers.perf.warn({ hitRate: validationHitRate }, 'Low validation cache hit rate');
      }
      
      if (parseFloat(sessionHitRate) < 60 && cacheStats.session.hits > 100) {
        loggers.perf.warn({ hitRate: sessionHitRate }, 'Low session cache hit rate');
      }
    
  } catch (error) {
      loggers.perf.error({ error: error.message }, 'Cache maintenance error');
    }
  }, 5 * 60 * 1000); // Every 5 minutes
  
  loggers.perf.info('Cache maintenance started (5 minute intervals)');
}

/**
 * Monitor event listener counts
 * Runs every 5 minutes
 * Phase 3C.3
 */
function startListenerMonitoring() {
  setInterval(() => {
    try {
      const stats = getEventListenerStats();
      
      loggers.perf.info({
        totalAgents: stats.totalAgents,
        totalListeners: stats.totalListeners,
        averagePerAgent: stats.averagePerAgent
      }, 'Event listener statistics');
      
      // Warn if listener count is high
      if (stats.totalListeners > 500) {
        loggers.perf.warn({
          totalListeners: stats.totalListeners,
          threshold: 500
        }, 'High event listener count detected');
      }
      
      // Warn if any agent has excessive listeners
      for (const [agentId, count] of Object.entries(stats.agentBreakdown)) {
        if (count > 20) {
          loggers.perf.warn({
            agentId,
            listenerCount: count,
            threshold: 20
          }, 'Agent has excessive event listeners');
        }
      }
      
    } catch (error) {
      loggers.perf.error({ error: error.message }, 'Listener monitoring error');
    }
  }, 5 * 60 * 1000); // Every 5 minutes
  
  loggers.perf.info('Event listener monitoring started (5 minute intervals)');
}

/**
 * Monitor message batch queues
 * Runs every 30 seconds
 * Phase 3C.4
 */
function startMessageBatchMonitoring() {
  setInterval(() => {
    try {
      const totalPending = Array.from(messageBatchQueue.values())
        .reduce((sum, queue) => sum + queue.length, 0);
      
      if (totalPending > 0) {
        const agentsWithPending = messageBatchQueue.size;
        const maxQueueSize = Math.max(
          ...Array.from(messageBatchQueue.values()).map(q => q.length),
          0
        );
        
        loggers.messages.info({
          totalPending,
          agentsWithPending,
          maxQueueSize
        }, 'Message batch queue status');
        
        // Warn if queue is growing too large
        if (maxQueueSize > MESSAGE_BATCH_SIZE * 2) {
          loggers.messages.warn({
            maxQueueSize,
            threshold: MESSAGE_BATCH_SIZE * 2
          }, 'Large message queue detected - may indicate slow database');
        }
      }
      
    } catch (error) {
      loggers.messages.error({
        error: error.message
      }, 'Message batch monitoring error');
    }
  }, 30000); // Every 30 seconds
  
  loggers.messages.info({
    batchSize: MESSAGE_BATCH_SIZE,
    timeout: MESSAGE_BATCH_TIMEOUT
  }, 'Message batch monitoring started (30 second intervals)');
}

/**
 * Warm up session cache on startup
 * Loads recently active sessions into memory
 */
async function warmSessionCache() {
  try {
    logger.info({}, 'Warming session cache...');
    
    const { data: sessions, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, session_data')
      .eq('is_active', true)
      .not('session_data', 'is', null)
      .order('last_connected', { ascending: false })
      .limit(CACHE_CONFIG.session.max);
    
    if (error) {
      loggers.database.error({ error: error.message }, 'Failed to fetch sessions for cache warming');
      return;
    }
    
    if (sessions && sessions.length > 0) {
      let warmed = 0;
      sessions.forEach(session => {
        if (session.session_data?.creds) {
          try {
            const creds = session.session_data.encrypted
              ? decryptCredentials(session.session_data.creds)
              : session.session_data.creds;
            
            SESSION_CACHE.set(session.agent_id, creds);
            warmed++;
          } catch (error) {
            loggers.security.error({
              agentId: shortId(session.agent_id),
              error: error.message
            }, 'Failed to decrypt credentials during cache warming');
          }
        }
      });
      
      logger.info({ warmed, total: sessions.length }, 'Session cache warmed');
    } else {
      logger.info({}, 'No active sessions to warm cache');
    }
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Failed to warm session cache');
  }
}

// ============================================
// ORPHANED AGENT MONITORING
// ============================================

/**
 * Periodically check for and recover orphaned agents
 */
function startOrphanedAgentMonitor() {
  // Check every 2 minutes
  setInterval(async () => {
    try {
      if (!instanceManager.isActive) {
        return; // Skip if instance manager not active
      }
      
      const orphanedAgents = await instanceManager.detectOrphanedAgents(supabaseAdmin);
      
      if (orphanedAgents.length > 0) {
        logger.info({ 
          count: orphanedAgents.length 
        }, 'Recovering orphaned agents');
        
        // Reconnect orphaned agents if this instance has capacity
        for (const agentId of orphanedAgents) {
          if (instanceManager.canAcceptMoreAgents()) {
            try {
              // Get user_id for agent
              const { data } = await supabaseAdmin
                .from('whatsapp_sessions')
                .select('user_id')
                .eq('agent_id', agentId)
                .single();
              
              if (data) {
                logger.info({ agentId: shortId(agentId) }, 'Recovering orphaned agent');
                await safeInitializeWhatsApp(agentId, data.user_id);
              }
      } catch (error) {
              logger.error({ 
                error: error.message, 
                agentId: shortId(agentId) 
              }, 'Failed to recover orphaned agent');
            }
          } else {
            logger.warn('Instance at capacity, cannot recover more orphaned agents');
            break;
          }
        }
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Error in orphaned agent monitor');
    }
  }, 2 * 60 * 1000); // Every 2 minutes
  
  logger.info('Orphaned agent monitor started');
}

// ============================================
// SERVICE INITIALIZATION
// ============================================

/**
 * Initialize all services
 */
// ============================================
// PERFORMANCE REPORTING HELPERS
// Added: 2025-01-16 - Performance Reporting
// ============================================

// Helper functions for performance data collection
function getAverageConnectionTime() {
  // Get average from Prometheus histogram if available
  // Note: This is a simplified calculation - in production, you'd query the histogram
  // For now, return 0 as placeholder - actual implementation would query metricsRegistry
  if (connectionMetrics?.duration) {
    // In a real implementation, you'd query the histogram buckets
    // For now, we'll track this separately or use OperationTracker data
    return 0; // Placeholder
  }
  return 0;
}

function getAverageMessageProcessingTime() {
  // Get average from Prometheus histogram if available
  if (messageMetrics?.processingDuration) {
    // In a real implementation, you'd query the histogram buckets
    return 0; // Placeholder
  }
  return 0;
}

function calculateCacheHitRate() {
  const total = cacheStats.session.hits + cacheStats.session.misses +
                cacheStats.validation.hits + cacheStats.validation.misses +
                cacheStats.lidToPhone.hits + cacheStats.lidToPhone.misses;
  const hits = cacheStats.session.hits + cacheStats.validation.hits + cacheStats.lidToPhone.hits;
  return total > 0 ? (hits / total) * 100 : 0;
}

function getRecentErrorCount() {
  // Get error count from Prometheus counter if available
  // Note: This would require querying the metricsRegistry
  // For now, return 0 as placeholder
  if (errorMetrics?.total) {
    // In a real implementation, you'd query the counter value
    return 0; // Placeholder
  }
  return 0;
}

/**
 * Start performance snapshot collection and reporting
 */
function startPerformanceReporting() {
  // Take performance snapshots every 5 minutes
  setInterval(() => {
    const snapshot = {
      connectionTime: getAverageConnectionTime(),
      messageProcessingTime: getAverageMessageProcessingTime(),
      cacheHitRate: calculateCacheHitRate(),
      errorCount: getRecentErrorCount(),
      activeConnections: activeSessions.size,
      timestamp: Date.now()
    };
    
    performanceReporter.recordSnapshot(snapshot);
  }, 300000); // 5 minutes

  // Schedule daily report at midnight
  const scheduleDaily = () => {
    const now = new Date();
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const msToMidnight = night.getTime() - now.getTime();
    
    setTimeout(() => {
      performanceReporter.generateDailyReport();
      setInterval(() => {
        performanceReporter.generateDailyReport();
      }, 24 * 60 * 60 * 1000); // Every 24 hours
    }, msToMidnight);
  };

  scheduleDaily();
  loggers.perf.info('Daily performance reporting scheduled');

  // Schedule weekly report every Sunday at midnight
  const scheduleWeekly = () => {
    const now = new Date();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7 - now.getDay()));
    nextSunday.setHours(0, 0, 0, 0);
    const msToSunday = nextSunday.getTime() - now.getTime();
    
    setTimeout(() => {
      performanceReporter.generateWeeklyReport();
      setInterval(() => {
        performanceReporter.generateWeeklyReport();
      }, 7 * 24 * 60 * 60 * 1000); // Every 7 days
    }, msToSunday);
  };

  scheduleWeekly();
  loggers.perf.info('Weekly performance reporting scheduled');
}

async function initializeServices() {
  try {
    logger.info('Initializing services...');
    
    // Initialize Prometheus metrics
    if (METRICS_CONFIG.enabled) {
      try {
        if (metricsRegistry) {
          loggers.perf.info({
            enabled: METRICS_CONFIG.enabled,
            prefix: METRICS_CONFIG.prefix,
            instance: INSTANCE_HOSTNAME,
            collectInterval: METRICS_CONFIG.collectInterval
          }, 'Prometheus metrics initialized');
        } else {
          loggers.perf.warn('Prometheus metrics disabled or initialization failed');
        }
      } catch (error) {
        loggers.perf.warn({ error: error.message }, 'Prometheus metrics initialization error');
      }
    } else {
      loggers.perf.warn('Prometheus metrics disabled via PROMETHEUS_METRICS_ENABLED=false');
    }
    
    // Initialize Redis
    try {
      await redisCache.initialize();
      logger.info('✅ Redis initialized');
    } catch (error) {
      logger.warn({ error: error.message }, '⚠️  Redis initialization failed - continuing without distributed cache');
      // Continue without Redis - will fall back to LRU
    }
    
    // Initialize instance manager
    try {
      await instanceManager.initialize();
      logger.info('✅ Instance manager initialized');
      
      // Log instance info
      const stats = instanceManager.getStats();
      logger.info({
        instanceId: stats.instanceId,
        hostname: stats.hostname,
        maxAgents: stats.maxAgents
      }, 'Instance registered');
      
      // Start cache maintenance
      startCacheMaintenance();
      
  } catch (error) {
      logger.warn({ error: error.message }, '⚠️  Instance manager initialization failed - running in single-instance mode');
    }
    
    // Start event listener monitoring (runs regardless of instance manager status)
    startListenerMonitoring();
    
    // Start message batch monitoring
    startMessageBatchMonitoring();
    
    // Warm caches
    await warmSessionCache();
    
    // Initialize existing sessions
    await initializeExistingSessions();
    
    // Start orphaned agent monitoring
    startOrphanedAgentMonitor();
    
    // Initialize performance reporter
    try {
      await performanceReporter.initialize();
      loggers.perf.info('Performance reporter initialized');
    } catch (error) {
      loggers.perf.warn({ error: error.message }, 'Performance reporter initialization failed');
    }
    
    // Start performance snapshot collection and reporting
    startPerformanceReporting();
    
    // Start error pattern cleanup
    errorTracker.startPatternCleanup();
    loggers.perf.info('Error pattern cleanup started');
    
    // Start alerting service monitoring
    alertingService.startMonitoring(module.exports, 60000);
    loggers.perf.info('Alerting service started');
    
    // Configure alert event listener for external integrations
    alertingService.on('alert', (alert) => {
      // Log alert for external notification systems
      loggers.perf.info({ alert }, 'Alert triggered - ready for external notification');
      
      // TODO: Add external integrations here (Slack, email, etc.)
      // Example:
      // if (alert.severity === 'critical') {
      //   sendSlackAlert(alert);
      //   sendEmailAlert(alert);
      // }
    });
    
    logger.info('✅ All services initialized');
    
  } catch (error) {
    logger.error({ error: error.message }, '❌ Service initialization failed');
    throw error;
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  logger.info({ signal }, 'Received shutdown signal');
  
  try {
    // Stop accepting new connections
    logger.info('Stopping new connections...');
    
    // Close all active sessions
    logger.info({ count: activeSessions.size }, 'Closing active sessions...');
    for (const [agentId, session] of activeSessions.entries()) {
      try {
        if (session.socket) {
          await session.socket.logout();
        }
      } catch (error) {
        loggers.connection.warn({ agentId: shortId(agentId) }, 'Error during session logout');
      }
    }
    
    // Clean up all event listeners
    loggers.connection.info('Cleaning up event listeners');
    const listenerStats = getEventListenerStats();
    loggers.connection.info({ 
      totalListeners: listenerStats.totalListeners 
    }, 'Removing all event listeners');
    
    for (const agentId of agentListeners.keys()) {
      removeTrackedListeners(agentId);
    }
    
    // Shutdown Redis
    await redisCache.shutdown();
    
    // Shutdown instance manager
    if (instanceManager.isActive) {
      await instanceManager.shutdown();
    }
    
    logger.info('✅ Graceful shutdown complete');
    process.exit(0);
    
  } catch (error) {
    logger.error({ error: error.message }, 'Error during shutdown');
    process.exit(1);
  }
}

// ============================================
// INSTANCE HEALTH ENDPOINT
// ============================================

/**
 * Get instance health status
 * Used by load balancers and monitoring
 */
async function getInstanceHealth() {
  // Get stats if instance manager is active, otherwise use fallback values
  const stats = instanceManager.isActive ? instanceManager.getStats() : null;
  const memory = process.memoryUsage();
  
  // Update active connections gauge
  recordMetric(() => {
    if (connectionMetrics?.active) {
      connectionMetrics.active.set(activeSessions.size);
    }
  });
  
  // Get cache statistics
  let cacheStats = null;
  try {
    cacheStats = await getCacheStats();
  } catch (error) {
    logger.warn({ error: error.message }, 'Failed to get cache stats');
  }
  
  // Calculate active agents - use multiple sources and take the maximum
  // 1. Instance manager assigned agents (if instance manager is active)
  // 2. Active sessions in memory (actual connected sockets - only count isConnected=true)
  // 3. Database connected sessions (source of truth)
  let activeAgentsFromInstance = stats ? stats.assignedAgents : 0;
  
  // Count only truly connected sessions in memory (where isConnected === true)
  let activeAgentsFromMemory = 0;
  for (const [agentId, session] of activeSessions.entries()) {
    if (session && session.isConnected === true) {
      activeAgentsFromMemory++;
    }
  }
  
  let activeAgentsFromDatabase = 0;
  
  // Always check database for connected sessions (source of truth)
  // Use actual data fetch instead of count query for more reliability
  try {
    // Fetch actual sessions and count manually - more reliable than count query
    const { data: sessionsData, error: dbError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, status, is_active, last_heartbeat')
      .eq('is_active', true);
    
    if (dbError) {
      console.error('[HEALTH] ❌ Database query error:', dbError);
      logger.warn({ error: dbError.message }, 'Failed to get active agents from database');
      activeAgentsFromDatabase = 0;
    } else if (sessionsData && Array.isArray(sessionsData)) {
      // Count sessions with status = 'connected' (case-insensitive check)
      const connectedSessions = sessionsData.filter(s => {
        const status = s.status?.toLowerCase() || '';
        const isActive = s.is_active === true || s.is_active === 'true' || s.is_active === 1;
        return isActive && (status === 'connected' || status === 'pairing_complete' || status === 'reconnecting_after_pairing');
      });
      
      activeAgentsFromDatabase = connectedSessions.length;
      
      // Debug logging
      if (activeAgentsFromDatabase > 0) {
        console.log(`[HEALTH] ✅ Found ${activeAgentsFromDatabase} active connected session(s) in database`);
        console.log('[HEALTH] Connected sessions:', connectedSessions.map(s => ({
          agent_id: s.agent_id?.substring(0, 8) + '...',
          status: s.status,
          is_active: s.is_active,
          last_heartbeat: s.last_heartbeat
        })));
        logger.debug({ 
          count: activeAgentsFromDatabase, 
          source: 'database',
          sessions: connectedSessions.length
        }, 'Found active connected sessions in database');
      } else if (sessionsData.length > 0) {
        // Log all sessions if none are connected (for debugging)
        console.log('[HEALTH] ℹ️ Found sessions but none are connected:', sessionsData.map(s => ({
          agent_id: s.agent_id?.substring(0, 8) + '...',
          status: s.status,
          is_active: s.is_active
        })));
      }
    } else {
      console.log('[HEALTH] ⚠️ Database query returned no data');
      activeAgentsFromDatabase = 0;
    }
  } catch (error) {
    console.error('[HEALTH] ❌ Exception getting active agents:', error);
    logger.warn({ error: error.message, stack: error.stack }, 'Exception getting active agents from database');
    activeAgentsFromDatabase = 0;
  }
  
  // Use the maximum of all three sources to get the most accurate count
  // This ensures we show connected agents even if tracking is slightly out of sync
  const activeAgentsCount = Math.max(
    activeAgentsFromInstance,
    activeAgentsFromMemory,
    activeAgentsFromDatabase
  );
  
  // Always log the counts for debugging (not just on discrepancy)
  logger.debug({
    instanceManager: activeAgentsFromInstance,
    activeSessions: activeAgentsFromMemory,
    database: activeAgentsFromDatabase,
    final: activeAgentsCount,
    activeSessionsSize: activeSessions.size
  }, 'Active agent count calculation');
  
  // Log warning if there's a significant discrepancy
  if (activeAgentsFromDatabase > 0 && activeAgentsCount === 0) {
    logger.warn({
      instanceManager: activeAgentsFromInstance,
      activeSessions: activeAgentsFromMemory,
      database: activeAgentsFromDatabase,
      final: activeAgentsCount
    }, '⚠️ Database shows connected sessions but count is 0 - check Math.max logic');
  }
  
  return {
    status: instanceManager.isActive && stats ? 'healthy' : 'healthy', // Always healthy if process is running
    instance: stats ? {
      id: stats.instanceId,
      hostname: stats.hostname,
      uptime: stats.uptime,
      pid: stats.pid
    } : {
      id: process.env.INSTANCE_ID || `${require('os').hostname()}-${process.pid}`,
      hostname: require('os').hostname(),
      uptime: process.uptime(),
      pid: process.pid
    },
    agents: {
      assigned: activeAgentsCount,
      max: stats ? stats.maxAgents : 200, // Default max if no stats
      utilization: stats ? stats.utilization : `${((activeAgentsCount / 200) * 100).toFixed(1)}%`
    },
    // Add activeAgents for backward compatibility with frontend
    activeAgents: activeAgentsCount,
    resources: {
      memory: {
        rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB'
      },
      cpu: process.cpuUsage()
    },
    redis: {
      connected: redisCache.isReady()
    },
    cache: cacheStats,
    eventListeners: getEventListenerStats(),
    messageQueue: {
      agentsWithPending: messageBatchQueue.size,
      totalPending: Array.from(messageBatchQueue.values())
        .reduce((sum, queue) => sum + queue.length, 0),
      pendingByAgent: Object.fromEntries(
        Array.from(messageBatchQueue.entries())
          .filter(([_, queue]) => queue.length > 0)
          .map(([agentId, queue]) => [shortId(agentId), queue.length])
      )
    },
    localCaches: {
      validation: {
        size: validationCache.size,
        max: CACHE_CONFIG.validation.max,
        utilization: `${(validationCache.size / CACHE_CONFIG.validation.max * 100).toFixed(1)}%`
      },
      lidToPhone: {
        size: lidToPhoneCache.size,
        max: CACHE_CONFIG.lidToPhone.max,
        utilization: `${(lidToPhoneCache.size / CACHE_CONFIG.lidToPhone.max * 100).toFixed(1)}%`
      },
      session: {
        size: SESSION_CACHE.size,
        max: CACHE_CONFIG.session.max,
        utilization: `${(SESSION_CACHE.size / CACHE_CONFIG.session.max * 100).toFixed(1)}%`
      }
    },
    errorStats: {
      last1Hour: errorTracker.getErrorStats(3600000),
      last5Minutes: errorTracker.getErrorStats(300000),
      currentRate: `${errorTracker.getErrorRate(300000)}/min`
    },
    alertStats: alertingService.getAlertStats(3600000),
    timestamp: new Date().toISOString()
  };
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Call on module load
initializeServices().catch(error => {
  logger.fatal({ error: error.message }, 'Failed to initialize services');
  process.exit(1);
});

/**
 * Get cache statistics
 * @returns {Promise<Object|null>} Cache statistics or null
 */
async function getCacheStats() {
  try {
    const stats = await sessionCache.getSessionStats();
    const memory = await sessionCache.getMemoryUsage();
    
    return {
      ...stats,
      memory,
    };
  } catch (error) {
    logger.error({ error: error.message }, 'Error getting cache stats');
    return null;
  }
}

module.exports = {
  initializeWhatsApp,
  safeInitializeWhatsApp,
  disconnectWhatsApp,
  getQRCode,
  getSessionStatus,
  getWhatsAppStatus,
  sendMessage,
  isNumberOnWhatsApp,
  uploadAgentFile,
  updateAgentFiles,
  deleteAgentFile,
  updateIntegrationEndpoints,
  activeSessions,
  connectionLocks, // Expose for connection monitor to check
  initializeExistingSessions,
  subscribeToAgentEvents,
  reconnectAllAgents,
  // Multi-layer monitoring exports
  cleanupMonitoring,
  startAllMonitoring,
  connectionMonitors,
  healthCheckIntervals,
  clearAllCaches,
  warmSessionCache,
  getInstanceHealth,
  getCacheStats,
  getUserIdByAgentId,
  batchUpdateSessionStatus,
  // Prometheus metrics registry (for /metrics endpoint)
  metricsRegistry,
  // Prometheus custom metrics (for advanced monitoring)
  connectionMetrics,
  messageMetrics,
  cacheMetrics,
  databaseMetrics,
  errorMetrics,
  // Performance tracking
  OperationTracker,
  // Performance reporting
  performanceReporter,
  // Error tracking
  errorTracker,
  // Alerting
  alertingService
};
