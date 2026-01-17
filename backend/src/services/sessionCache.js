/**
 * Session Cache Service
 * Redis-based session caching to reduce database queries by 70%
 * Phase 3B: Performance Optimization
 */

const redisCache = require('./redisCache');
const logger = require('./logger');
const zlib = require('zlib');
const { promisify } = require('util');
const { OperationTracker } = require('../middleware/performanceTracking');

// Promisify compression functions
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Create child logger for session cache
const cacheLogger = logger.child({ component: 'session-cache' });

// Cache configuration
const TTL = {
  CREDENTIALS: parseInt(process.env.CACHE_TTL_CREDENTIALS) || 300,     // 5 minutes
  METADATA: parseInt(process.env.CACHE_TTL_METADATA) || 600,           // 10 minutes
  USER_ID: parseInt(process.env.CACHE_TTL_USER_ID) || 1800,            // 30 minutes
  PHONE: parseInt(process.env.CACHE_TTL_PHONE) || 1800,                // 30 minutes
};

const COMPRESSION_THRESHOLD = parseInt(process.env.CACHE_COMPRESSION_THRESHOLD) || 1024; // 1KB
const MAX_CACHE_ENTRY_SIZE = 5 * 1024 * 1024; // 5MB

// Metrics tracking (in-memory)
const metrics = {
  hits: 0,
  misses: 0,
  errors: 0,
  compressions: 0,
  decompressions: 0,
  totalSize: 0,
  compressedSize: 0,
};

// Cache key patterns
const KEY_PATTERNS = {
  CREDENTIALS: (agentId) => `session:creds:${agentId}`,
  METADATA: (agentId) => `session:metadata:${agentId}`,
  USER_ID: (agentId) => `session:user:${agentId}`,
  PHONE: (agentId) => `session:phone:${agentId}`,
};

/**
 * Compress data if it exceeds threshold
 * @param {*} data - Data to compress
 * @returns {Promise<Object>} Compressed data object or original data
 */
async function compressData(data) {
  try {
    const jsonString = JSON.stringify(data);
    const originalSize = Buffer.byteLength(jsonString, 'utf8');
    
    if (originalSize <= COMPRESSION_THRESHOLD) {
      return { compressed: false, data };
    }
    
    // Compress the data
    const compressed = await gzip(jsonString);
    const compressedBase64 = compressed.toString('base64');
    const compressedSize = Buffer.byteLength(compressedBase64, 'utf8');
    
    // Track compression metrics
    metrics.compressions++;
    metrics.totalSize += originalSize;
    metrics.compressedSize += compressedSize;
    
    const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    cacheLogger.debug({
      originalSize,
      compressedSize,
      ratio: `${compressionRatio}%`
    }, 'Data compressed');
    
    return {
      compressed: true,
      data: compressedBase64,
      originalSize,
      compressedSize
    };
    
  } catch (error) {
    cacheLogger.error({ error: error.message }, 'Compression failed, storing uncompressed');
    return { compressed: false, data };
  }
}

/**
 * Decompress data if it was compressed
 * @param {Object} cachedData - Cached data object
 * @returns {Promise<*>} Decompressed data
 */
async function decompressData(cachedData) {
  try {
    // If not compressed, return as-is
    if (!cachedData.compressed) {
      return cachedData.data;
    }
    
    // Decompress
    const compressedBuffer = Buffer.from(cachedData.data, 'base64');
    const decompressed = await gunzip(compressedBuffer);
    const jsonString = decompressed.toString('utf8');
    
    // Track decompression
    metrics.decompressions++;
    
    cacheLogger.debug({
      originalSize: cachedData.originalSize,
      compressedSize: cachedData.compressedSize
    }, 'Data decompressed');
    
    return JSON.parse(jsonString);
    
  } catch (error) {
    cacheLogger.error({ error: error.message }, 'Decompression failed');
    throw error;
  }
}

/**
 * Get Redis client safely
 * @returns {Object|null} Redis client or null
 */
function getRedisClient() {
  try {
    if (!redisCache.isReady()) {
      return null;
    }
    return redisCache.getClient();
  } catch (error) {
    cacheLogger.warn({ error: error.message }, 'Redis client not available');
    return null;
  }
}

/**
 * Session Cache Class
 */
class SessionCache {
  constructor() {
    cacheLogger.info({
      compressionThreshold: COMPRESSION_THRESHOLD,
      maxEntrySize: MAX_CACHE_ENTRY_SIZE,
      ttls: TTL
    }, 'Session cache service initialized');
  }
  
  /**
   * Get cached credentials
   * @param {string} agentId - Agent UUID
   * @returns {Promise<Object|null>} Cached credentials or null
   */
  async getCachedCredentials(agentId) {
    const tracker = new OperationTracker('cache_get_credentials', cacheLogger, 100);
    try {
      const client = getRedisClient();
      if (!client) {
        metrics.misses++;
        tracker.end({ agentId, hit: false, reason: 'redis_unavailable' });
        return null;
      }
      
      const key = KEY_PATTERNS.CREDENTIALS(agentId);
      const data = await client.get(key);
      
      if (!data) {
        metrics.misses++;
        cacheLogger.debug({ agentId: agentId.substring(0, 8), miss: true }, 'Cache miss: credentials');
        tracker.end({ agentId, hit: false });
        return null;
      }
      
      // Parse and decompress if needed
      const cachedData = JSON.parse(data);
      const credentials = await decompressData(cachedData);
      
      metrics.hits++;
      cacheLogger.debug({ agentId: agentId.substring(0, 8), hit: true }, 'Cache hit: credentials');
      tracker.end({ agentId, hit: true });
      return credentials;
      
    } catch (error) {
      metrics.errors++;
      metrics.misses++;
      cacheLogger.error({ agentId: agentId?.substring(0, 8), error: error.message }, 'Cache error: get credentials');
      tracker.end({ agentId, hit: false, error: error.message });
      return null;
    }
  }
  
  /**
   * Set cached credentials
   * @param {string} agentId - Agent UUID
   * @param {Object} creds - Credentials object
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<boolean>} Success status
   */
  async setCachedCredentials(agentId, creds, ttl = TTL.CREDENTIALS) {
    const tracker = new OperationTracker('cache_set_credentials', cacheLogger, 100);
    try {
      const client = getRedisClient();
      if (!client) {
        tracker.end({ agentId, success: false, reason: 'redis_unavailable' });
        return false;
      }
      
      // Check entry size
      const jsonString = JSON.stringify(creds);
      const entrySize = Buffer.byteLength(jsonString, 'utf8');
      
      if (entrySize > MAX_CACHE_ENTRY_SIZE) {
        cacheLogger.warn({
          agentId: agentId.substring(0, 8),
          size: entrySize,
          maxSize: MAX_CACHE_ENTRY_SIZE
        }, 'Entry too large, skipping cache');
        tracker.end({ agentId, success: false, reason: 'entry_too_large' });
        return false;
      }
      
      // Compress if needed
      const compressed = await compressData(creds);
      const valueToStore = JSON.stringify(compressed);
      
      const key = KEY_PATTERNS.CREDENTIALS(agentId);
      await client.setex(key, ttl, valueToStore);
      
      cacheLogger.debug({ agentId: agentId.substring(0, 8), cached: true, ttl }, 'Credentials cached');
      tracker.end({ agentId, compressed: !!compressed.compressed });
      return true;
      
    } catch (error) {
      metrics.errors++;
      cacheLogger.error({ agentId: agentId?.substring(0, 8), error: error.message }, 'Cache error: set credentials');
      tracker.end({ agentId, success: false, error: error.message });
      return false;
    }
  }
  
  /**
   * Get cached metadata
   * @param {string} agentId - Agent UUID
   * @returns {Promise<Object|null>} Cached metadata or null
   */
  async getCachedMetadata(agentId) {
    try {
      const client = getRedisClient();
      if (!client) {
        metrics.misses++;
        return null;
      }
      
      const key = KEY_PATTERNS.METADATA(agentId);
      const data = await client.get(key);
      
      if (!data) {
        metrics.misses++;
        cacheLogger.debug({ agentId: agentId.substring(0, 8), miss: true }, 'Cache miss: metadata');
        return null;
      }
      
      const cachedData = JSON.parse(data);
      const metadata = await decompressData(cachedData);
      
      metrics.hits++;
      cacheLogger.debug({ agentId: agentId.substring(0, 8), hit: true }, 'Cache hit: metadata');
      return metadata;
      
    } catch (error) {
      metrics.errors++;
      metrics.misses++;
      cacheLogger.error({ agentId: agentId?.substring(0, 8), error: error.message }, 'Cache error: get metadata');
      return null;
    }
  }
  
  /**
   * Set cached metadata
   * @param {string} agentId - Agent UUID
   * @param {Object} metadata - Metadata object
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<boolean>} Success status
   */
  async setCachedMetadata(agentId, metadata, ttl = TTL.METADATA) {
    try {
      const client = getRedisClient();
      if (!client) {
        return false;
      }
      
      const jsonString = JSON.stringify(metadata);
      const entrySize = Buffer.byteLength(jsonString, 'utf8');
      
      if (entrySize > MAX_CACHE_ENTRY_SIZE) {
        cacheLogger.warn({
          agentId: agentId.substring(0, 8),
          size: entrySize
        }, 'Metadata entry too large, skipping cache');
        return false;
      }
      
      const compressed = await compressData(metadata);
      const valueToStore = JSON.stringify(compressed);
      
      const key = KEY_PATTERNS.METADATA(agentId);
      await client.setex(key, ttl, valueToStore);
      
      cacheLogger.debug({ agentId: agentId.substring(0, 8), cached: true, ttl }, 'Metadata cached');
      return true;
      
    } catch (error) {
      metrics.errors++;
      cacheLogger.error({ agentId: agentId?.substring(0, 8), error: error.message }, 'Cache error: set metadata');
      return false;
    }
  }
  
  /**
   * Get cached user ID
   * @param {string} agentId - Agent UUID
   * @returns {Promise<string|null>} Cached user ID or null
   */
  async getCachedUserId(agentId) {
    try {
      const client = getRedisClient();
      if (!client) {
        metrics.misses++;
        return null;
      }
      
      const key = KEY_PATTERNS.USER_ID(agentId);
      const data = await client.get(key);
      
      if (!data) {
        metrics.misses++;
        cacheLogger.debug({ agentId: agentId.substring(0, 8), miss: true }, 'Cache miss: user ID');
        return null;
      }
      
      metrics.hits++;
      cacheLogger.debug({ agentId: agentId.substring(0, 8), hit: true }, 'Cache hit: user ID');
      return data; // User ID is a string, no need to parse
      
    } catch (error) {
      metrics.errors++;
      metrics.misses++;
      cacheLogger.error({ agentId: agentId?.substring(0, 8), error: error.message }, 'Cache error: get user ID');
      return null;
    }
  }
  
  /**
   * Set cached user ID
   * @param {string} agentId - Agent UUID
   * @param {string} userId - User ID
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<boolean>} Success status
   */
  async setCachedUserId(agentId, userId, ttl = TTL.USER_ID) {
    try {
      const client = getRedisClient();
      if (!client) {
        return false;
      }
      
      const key = KEY_PATTERNS.USER_ID(agentId);
      await client.setex(key, ttl, userId);
      
      cacheLogger.debug({ agentId: agentId.substring(0, 8), cached: true, ttl }, 'User ID cached');
      return true;
      
    } catch (error) {
      metrics.errors++;
      cacheLogger.error({ agentId: agentId?.substring(0, 8), error: error.message }, 'Cache error: set user ID');
      return false;
    }
  }
  
  /**
   * Get cached phone number
   * @param {string} agentId - Agent UUID
   * @returns {Promise<string|null>} Cached phone number or null
   */
  async getCachedPhoneNumber(agentId) {
    try {
      const client = getRedisClient();
      if (!client) {
        metrics.misses++;
        return null;
      }
      
      const key = KEY_PATTERNS.PHONE(agentId);
      const data = await client.get(key);
      
      if (!data) {
        metrics.misses++;
        cacheLogger.debug({ agentId: agentId.substring(0, 8), miss: true }, 'Cache miss: phone');
        return null;
      }
      
      metrics.hits++;
      cacheLogger.debug({ agentId: agentId.substring(0, 8), hit: true }, 'Cache hit: phone');
      return data; // Phone is a string, no need to parse
      
    } catch (error) {
      metrics.errors++;
      metrics.misses++;
      cacheLogger.error({ agentId: agentId?.substring(0, 8), error: error.message }, 'Cache error: get phone');
      return null;
    }
  }
  
  /**
   * Set cached phone number
   * @param {string} agentId - Agent UUID
   * @param {string} phoneNumber - Phone number
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<boolean>} Success status
   */
  async setCachedPhoneNumber(agentId, phoneNumber, ttl = TTL.PHONE) {
    try {
      const client = getRedisClient();
      if (!client) {
        return false;
      }
      
      const key = KEY_PATTERNS.PHONE(agentId);
      await client.setex(key, ttl, phoneNumber);
      
      cacheLogger.debug({ agentId: agentId.substring(0, 8), cached: true, ttl }, 'Phone number cached');
      return true;
      
    } catch (error) {
      metrics.errors++;
      cacheLogger.error({ agentId: agentId?.substring(0, 8), error: error.message }, 'Cache error: set phone');
      return false;
    }
  }
  
  /**
   * Invalidate all caches for a specific agent
   * @param {string} agentId - Agent UUID
   * @returns {Promise<boolean>} Success status
   */
  async invalidateSession(agentId) {
    try {
      const client = getRedisClient();
      if (!client) {
        return false;
      }
      
      const keys = [
        KEY_PATTERNS.CREDENTIALS(agentId),
        KEY_PATTERNS.METADATA(agentId),
        KEY_PATTERNS.USER_ID(agentId),
        KEY_PATTERNS.PHONE(agentId),
      ];
      
      await client.del(...keys);
      
      cacheLogger.debug({ agentId: agentId.substring(0, 8) }, 'Session invalidated');
      return true;
      
    } catch (error) {
      metrics.errors++;
      cacheLogger.error({ agentId: agentId?.substring(0, 8), error: error.message }, 'Cache error: invalidate session');
      return false;
    }
  }
  
  /**
   * Invalidate all session caches (use with caution!)
   * @returns {Promise<boolean>} Success status
   */
  async invalidateAllSessions() {
    try {
      const client = getRedisClient();
      if (!client) {
        return false;
      }
      
      // Get all session keys
      const pattern = 'session:*';
      const keys = await client.keys(pattern);
      
      if (keys.length > 0) {
        await client.del(...keys);
        cacheLogger.info({ cleared: keys.length }, 'All session caches invalidated');
      } else {
        cacheLogger.debug('No session caches to invalidate');
      }
      
      return true;
      
    } catch (error) {
      metrics.errors++;
      cacheLogger.error({ error: error.message }, 'Cache error: invalidate all sessions');
      return false;
    }
  }
  
  /**
   * Get session cache statistics
   * @returns {Promise<Object>} Statistics object
   */
  async getSessionStats() {
    try {
      const totalRequests = metrics.hits + metrics.misses;
      const hitRate = totalRequests > 0 ? (metrics.hits / totalRequests * 100).toFixed(2) : 0;
      
      const compressionRatio = metrics.totalSize > 0
        ? ((1 - metrics.compressedSize / metrics.totalSize) * 100).toFixed(1)
        : 0;
      
      return {
        metrics: {
          ...metrics,
          totalRequests,
          hitRate: `${hitRate}%`,
          compressionRatio: `${compressionRatio}%`,
        },
        timestamp: new Date().toISOString(),
        redis: {
          ready: redisCache.isReady(),
        },
      };
      
    } catch (error) {
      cacheLogger.error({ error: error.message }, 'Error getting session stats');
      return {
        metrics: { ...metrics },
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }
  
  /**
   * Get Redis memory usage
   * @returns {Promise<Object>} Memory usage information
   */
  async getMemoryUsage() {
    try {
      const client = getRedisClient();
      if (!client) {
        return { available: false };
      }
      
      const info = await client.info('memory');
      const usedMemory = info.match(/used_memory:(\d+)/)?.[1];
      const usedMemoryHuman = info.match(/used_memory_human:([^\r\n]+)/)?.[1];
      const maxMemory = info.match(/maxmemory:(\d+)/)?.[1];
      const maxMemoryHuman = info.match(/maxmemory_human:([^\r\n]+)/)?.[1];
      
      return {
        available: true,
        usedMemory: parseInt(usedMemory) || 0,
        usedMemoryHuman: usedMemoryHuman || 'N/A',
        maxMemory: parseInt(maxMemory) || 0,
        maxMemoryHuman: maxMemoryHuman || 'N/A',
        timestamp: new Date().toISOString(),
      };
      
    } catch (error) {
      cacheLogger.error({ error: error.message }, 'Error getting memory usage');
      return {
        available: false,
        error: error.message,
      };
    }
  }
}

// Export singleton instance
module.exports = new SessionCache();
