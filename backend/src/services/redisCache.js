/**
 * Redis Cache Service
 * Provides distributed caching for WhatsApp sessions and credentials
 * Phase 3: Scalability
 */

const Redis = require('ioredis');
const logger = require('./logger');

// Redis configuration
const REDIS_CONFIG = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES) || 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * parseInt(process.env.REDIS_RETRY_DELAY || 1000), 5000);
    return delay;
  },
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'baileys:',
  enableOfflineQueue: true,
  lazyConnect: false,
  // TLS support for rediss:// connections
  tls: process.env.REDIS_URL?.startsWith('rediss://') ? {
    rejectUnauthorized: false // For cloud Redis services
  } : undefined
};

// TTL configuration (in seconds)
const TTL_CONFIG = {
  session: parseInt(process.env.REDIS_SESSION_TTL) || 300,        // 5 minutes
  credential: parseInt(process.env.REDIS_CREDENTIAL_TTL) || 900,  // 15 minutes
  agentStatus: 60,                                                 // 1 minute
  qrCode: 120,                                                     // 2 minutes
  tempData: 300                                                    // 5 minutes
};

// Create child logger for Redis operations
const redisLogger = logger.child({ component: 'redis', service: 'redis-cache' });

// Create Redis client
let redisClient = null;
let isConnected = false;

/**
 * Initialize Redis connection
 */
async function initialize() {
  if (redisClient && isConnected) {
    redisLogger.warn('Redis already initialized and connected');
    return redisClient;
  }

  try {
    redisLogger.info({ url: REDIS_CONFIG.url.replace(/:[^:@]+@/, ':****@') }, 'Initializing Redis connection...');
    
    redisClient = new Redis(REDIS_CONFIG.url, REDIS_CONFIG);

    // Event handlers
    redisClient.on('connect', () => {
      redisLogger.info('Redis connecting...');
    });

    redisClient.on('ready', () => {
      isConnected = true;
      redisLogger.info('✅ Redis ready');
    });

    redisClient.on('error', (error) => {
      redisLogger.error({ error: error.message }, 'Redis error');
      isConnected = false;
    });

    redisClient.on('close', () => {
      isConnected = false;
      redisLogger.warn('Redis connection closed');
    });

    redisClient.on('reconnecting', (delay) => {
      redisLogger.info({ delayMs: delay }, 'Redis reconnecting...');
    });

    // Wait for connection (ioredis connects automatically)
    await redisClient.ping();
    
    redisLogger.info('✅ Redis initialized successfully');
    return redisClient;

  } catch (error) {
    redisLogger.error({ error: error.message }, '❌ Redis initialization failed');
    isConnected = false;
    throw error;
  }
}

/**
 * Get Redis client (lazy initialization)
 */
function getClient() {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initialize() first.');
  }
  return redisClient;
}

/**
 * Check if Redis is connected
 */
function isReady() {
  return isConnected && redisClient !== null && redisClient.status === 'ready';
}

// ============================================
// SESSION CACHE OPERATIONS
// ============================================

/**
 * Cache session credentials
 * @param {string} agentId - Agent UUID
 * @param {Object} credentials - Session credentials
 * @param {number} ttl - Time to live in seconds (optional)
 */
async function cacheSession(agentId, credentials, ttl = TTL_CONFIG.session) {
  try {
    if (!isReady()) {
      redisLogger.warn('Redis not ready, skipping cache');
      return false;
    }

    const key = `session:${agentId}`;
    await redisClient.setex(key, ttl, JSON.stringify(credentials));
    
    redisLogger.debug({ agentId: agentId.substring(0, 8), ttl }, 'Session cached');
    return true;

  } catch (error) {
    redisLogger.error({ error: error.message, agentId: agentId?.substring(0, 8) }, 'Failed to cache session');
    return false;
  }
}

/**
 * Get cached session credentials
 * @param {string} agentId - Agent UUID
 * @returns {Object|null} Credentials or null
 */
async function getSession(agentId) {
  try {
    if (!isReady()) {
      redisLogger.debug('Redis not ready, cache miss');
      return null;
    }

    const key = `session:${agentId}`;
    const data = await redisClient.get(key);
    
    if (data) {
      redisLogger.debug({ agentId: agentId.substring(0, 8) }, 'Session cache hit');
      return JSON.parse(data);
    }
    
    redisLogger.debug({ agentId: agentId.substring(0, 8) }, 'Session cache miss');
    return null;

  } catch (error) {
    redisLogger.error({ error: error.message, agentId: agentId?.substring(0, 8) }, 'Failed to get cached session');
    return null;
  }
}

/**
 * Delete cached session
 * @param {string} agentId - Agent UUID
 */
async function deleteSession(agentId) {
  try {
    if (!isReady()) return false;

    const key = `session:${agentId}`;
    await redisClient.del(key);
    
    redisLogger.debug({ agentId: agentId.substring(0, 8) }, 'Session cache deleted');
    return true;

  } catch (error) {
    redisLogger.error({ error: error.message, agentId: agentId?.substring(0, 8) }, 'Failed to delete cached session');
    return false;
  }
}

// ============================================
// AGENT STATUS OPERATIONS
// ============================================

/**
 * Set agent status
 * @param {string} agentId - Agent UUID
 * @param {Object} status - Status object
 */
async function setAgentStatus(agentId, status) {
  try {
    if (!isReady()) return false;

    const key = `status:${agentId}`;
    await redisClient.setex(key, TTL_CONFIG.agentStatus, JSON.stringify(status));
    
    return true;

  } catch (error) {
    redisLogger.error({ error: error.message, agentId: agentId?.substring(0, 8) }, 'Failed to set agent status');
    return false;
  }
}

/**
 * Get agent status
 * @param {string} agentId - Agent UUID
 * @returns {Object|null} Status or null
 */
async function getAgentStatus(agentId) {
  try {
    if (!isReady()) return null;

    const key = `status:${agentId}`;
    const data = await redisClient.get(key);
    
    return data ? JSON.parse(data) : null;

  } catch (error) {
    redisLogger.error({ error: error.message, agentId: agentId?.substring(0, 8) }, 'Failed to get agent status');
    return null;
  }
}

// ============================================
// QR CODE OPERATIONS
// ============================================

/**
 * Cache QR code
 * @param {string} agentId - Agent UUID
 * @param {string} qrCode - QR code data
 */
async function cacheQRCode(agentId, qrCode) {
  try {
    if (!isReady()) return false;

    const key = `qr:${agentId}`;
    await redisClient.setex(key, TTL_CONFIG.qrCode, qrCode);
    
    redisLogger.debug({ agentId: agentId.substring(0, 8) }, 'QR code cached');
    return true;

  } catch (error) {
    redisLogger.error({ error: error.message, agentId: agentId?.substring(0, 8) }, 'Failed to cache QR code');
    return false;
  }
}

/**
 * Get cached QR code
 * @param {string} agentId - Agent UUID
 * @returns {string|null} QR code or null
 */
async function getQRCode(agentId) {
  try {
    if (!isReady()) return null;

    const key = `qr:${agentId}`;
    return await redisClient.get(key);

  } catch (error) {
    redisLogger.error({ error: error.message, agentId: agentId?.substring(0, 8) }, 'Failed to get cached QR code');
    return null;
  }
}

// ============================================
// INSTANCE COORDINATION
// ============================================

/**
 * Register instance with heartbeat
 * @param {string} instanceId - Instance identifier
 * @param {Object} metadata - Instance metadata
 */
async function registerInstance(instanceId, metadata) {
  try {
    if (!isReady()) return false;

    const key = `instance:${instanceId}`;
    await redisClient.setex(key, 30, JSON.stringify({
      ...metadata,
      lastHeartbeat: Date.now()
    }));
    
    redisLogger.debug({ instanceId }, 'Instance registered');
    return true;

  } catch (error) {
    redisLogger.error({ error: error.message, instanceId }, 'Failed to register instance');
    return false;
  }
}

/**
 * Get all active instances
 * @returns {Array} Array of instance data
 */
async function getActiveInstances() {
  try {
    if (!isReady()) return [];

    // Note: keys() can block Redis in production - consider using SCAN for large datasets
    const keys = await redisClient.keys('instance:*');
    const instances = [];

    for (const key of keys) {
      const data = await redisClient.get(key);
      if (data) {
        instances.push(JSON.parse(data));
      }
    }

    return instances;

  } catch (error) {
    redisLogger.error({ error: error.message }, 'Failed to get active instances');
    return [];
  }
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get cache statistics
 * @returns {Object} Statistics object
 */
async function getStats() {
  try {
    if (!isReady()) {
      return { connected: false };
    }

    const info = await redisClient.info('stats');
    const keyspace = await redisClient.info('keyspace');
    const memory = await redisClient.info('memory');

    // Parse stats
    const totalConnections = info.match(/total_connections_received:(\d+)/)?.[1];
    const totalCommands = info.match(/total_commands_processed:(\d+)/)?.[1];
    const usedMemory = memory.match(/used_memory_human:([^\r\n]+)/)?.[1];
    const keys = keyspace.match(/keys=(\d+)/)?.[1] || 0;

    return {
      connected: true,
      totalConnections: parseInt(totalConnections) || 0,
      totalCommands: parseInt(totalCommands) || 0,
      usedMemory,
      totalKeys: parseInt(keys),
      config: TTL_CONFIG
    };

  } catch (error) {
    redisLogger.error({ error: error.message }, 'Failed to get Redis stats');
    return { connected: false, error: error.message };
  }
}

/**
 * Clear all cache (use with caution!)
 * Note: This uses KEYS which can block Redis - use with caution in production
 */
async function clearAll() {
  try {
    if (!isReady()) return false;

    // Get all keys with the prefix (ioredis handles prefix automatically)
    const keys = await redisClient.keys('*');
    if (keys.length > 0) {
      await redisClient.del(...keys);
      redisLogger.info({ cleared: keys.length }, 'Cache cleared');
    }
    
    return true;

  } catch (error) {
    redisLogger.error({ error: error.message }, 'Failed to clear cache');
    return false;
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  try {
    if (redisClient) {
      redisLogger.info('Shutting down Redis...');
      await redisClient.quit();
      redisClient = null;
      isConnected = false;
      redisLogger.info('✅ Redis shut down gracefully');
    }
  } catch (error) {
    redisLogger.error({ error: error.message }, 'Error during Redis shutdown');
  }
}

// Export all functions
module.exports = {
  initialize,
  getClient,
  isReady,
  shutdown,
  
  // Session operations
  cacheSession,
  getSession,
  deleteSession,
  
  // Agent status
  setAgentStatus,
  getAgentStatus,
  
  // QR code
  cacheQRCode,
  getQRCode,
  
  // Instance coordination
  registerInstance,
  getActiveInstances,
  
  // Utilities
  getStats,
  clearAll,
  
  // Configuration (for testing)
  TTL_CONFIG
};
