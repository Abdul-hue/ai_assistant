/**
 * Health Check Routes
 * Provides health status for load balancers and monitoring
 * Phase 3B: Multi-Instance Coordination
 */

const express = require('express');
const router = express.Router();
const baileysService = require('../services/baileysService');
const redisCache = require('../services/redisCache');
const instanceManager = require('../services/instanceManager');

/**
 * GET /health
 * Basic health check (for simple load balancers)
 */
router.get('/health', (req, res) => {
  try {
    // Check if services are available (may not be initialized yet)
    const instanceHealthy = instanceManager && instanceManager.isActive !== undefined ? instanceManager.isActive : true;
    const redisHealthy = redisCache && typeof redisCache.isReady === 'function' ? redisCache.isReady() : true;
    const isHealthy = instanceHealthy && redisHealthy;
    
    if (isHealthy) {
      res.status(200).json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    } else {
      res.status(503).json({ 
        status: 'unhealthy',
        instanceManager: instanceHealthy,
        redis: redisHealthy
      });
    }
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

/**
 * GET /health/detailed
 * Detailed health check with metrics
 */
router.get('/health/detailed', async (req, res) => {
  try {
    // CRITICAL FIX: await getInstanceHealth() since it's async
    const health = await baileysService.getInstanceHealth();
    
    // Add additional checks (with safety checks)
    let redisStats = { connected: false };
    let activeInstances = [];
    
    try {
      if (redisCache && typeof redisCache.getStats === 'function') {
        redisStats = await redisCache.getStats();
      }
    } catch (error) {
      // Redis not available
    }
    
    try {
      if (instanceManager && typeof instanceManager.getActiveInstances === 'function') {
        activeInstances = await instanceManager.getActiveInstances();
      }
    } catch (error) {
      // Instance manager not available
    }
    
    const response = {
      ...health,
      cluster: {
        totalInstances: activeInstances.length,
        instances: activeInstances.map(i => ({
          id: i.instanceId,
          hostname: i.hostname,
          assignedAgents: i.assignedAgents || 0,
          uptime: i.uptime,
          lastHeartbeat: i.lastHeartbeat
        }))
      },
      redis: {
        connected: redisStats.connected,
        totalKeys: redisStats.totalKeys || 0,
        usedMemory: redisStats.usedMemory || 'N/A'
      }
    };
    
    // Add cache-control headers to prevent 304 responses for monitoring data
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    res.status(200).json(response);
    
  } catch (error) {
    console.error('[HEALTH] Error getting detailed health:', error);
    res.status(500).json({ 
      status: 'error', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /health/ready
 * Readiness probe (for Kubernetes)
 */
router.get('/health/ready', (req, res) => {
  try {
    // Safety checks for services
    const instanceActive = instanceManager && instanceManager.isActive !== undefined ? instanceManager.isActive : false;
    const redisReady = redisCache && typeof redisCache.isReady === 'function' ? redisCache.isReady() : false;
    const canAccept = instanceManager && typeof instanceManager.canAcceptMoreAgents === 'function' 
      ? instanceManager.canAcceptMoreAgents() 
      : true;
    
    const isReady = instanceActive && redisReady && canAccept;
    
    if (isReady) {
      res.status(200).json({ 
        status: 'ready',
        canAcceptAgents: true
      });
    } else {
      res.status(503).json({ 
        status: 'not_ready',
        canAcceptAgents: false,
        reason: !instanceActive ? 'instance_inactive' :
                !redisReady ? 'redis_not_ready' :
                !canAccept ? 'instance_at_capacity' :
                'unknown'
      });
    }
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

/**
 * GET /health/live
 * Liveness probe (for Kubernetes)
 */
router.get('/health/live', (req, res) => {
  try {
    // Simple check - is process alive and responsive
    const isAlive = process.uptime() > 0;
    
    if (isAlive) {
      res.status(200).json({ status: 'alive' });
    } else {
      res.status(503).json({ status: 'dead' });
    }
  } catch (error) {
    res.status(503).json({ status: 'error' });
  }
});

module.exports = router;
