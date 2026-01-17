/**
 * Instance Manager Service
 * Manages multiple server instances, load balancing, and failover
 * Phase 3B: Multi-Instance Coordination
 */

const os = require('os');
const redisCache = require('./redisCache');
const logger = require('./logger').child({ component: 'instance-manager' });

// Instance configuration
const INSTANCE_CONFIG = {
  id: process.env.INSTANCE_ID || `${os.hostname()}-${process.pid}-${Date.now()}`,
  hostname: os.hostname(),
  pid: process.pid,
  startedAt: new Date().toISOString(),
  heartbeatInterval: parseInt(process.env.INSTANCE_HEARTBEAT_INTERVAL) || 15000, // 15 seconds
  heartbeatTimeout: parseInt(process.env.INSTANCE_HEARTBEAT_TIMEOUT) || 45000,   // 45 seconds
  maxAgentsPerInstance: parseInt(process.env.MAX_AGENTS_PER_INSTANCE) || 200
};

// State tracking
let heartbeatTimer = null;
let isActive = false;
let assignedAgents = new Set();

/**
 * Initialize instance manager
 */
async function initialize() {
  try {
    logger.info({ 
      instanceId: INSTANCE_CONFIG.id,
      hostname: INSTANCE_CONFIG.hostname,
      pid: INSTANCE_CONFIG.pid,
      maxAgents: INSTANCE_CONFIG.maxAgentsPerInstance
    }, 'Initializing instance manager...');

    // Register this instance
    await registerInstance();
    
    // Start heartbeat
    startHeartbeat();
    
    isActive = true;
    logger.info('✅ Instance manager initialized');
    
    return true;
  } catch (error) {
    logger.error({ error: error.message }, '❌ Failed to initialize instance manager');
    throw error;
  }
}

/**
 * Register this instance in Redis
 */
async function registerInstance() {
  try {
    const metadata = {
      instanceId: INSTANCE_CONFIG.id,
      hostname: INSTANCE_CONFIG.hostname,
      pid: INSTANCE_CONFIG.pid,
      startedAt: INSTANCE_CONFIG.startedAt,
      maxAgents: INSTANCE_CONFIG.maxAgentsPerInstance,
      assignedAgents: assignedAgents.size,
      agentIds: Array.from(assignedAgents),
      cpuUsage: process.cpuUsage(),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      lastHeartbeat: new Date().toISOString()
    };

    await redisCache.registerInstance(INSTANCE_CONFIG.id, metadata);
    
    logger.debug({ instanceId: INSTANCE_CONFIG.id }, 'Instance registered');
    return true;
    
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to register instance');
    return false;
  }
}

/**
 * Start heartbeat to keep instance alive
 */
function startHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  heartbeatTimer = setInterval(async () => {
    try {
      await registerInstance();
      logger.debug('Heartbeat sent');
    } catch (error) {
      logger.error({ error: error.message }, 'Heartbeat failed');
    }
  }, INSTANCE_CONFIG.heartbeatInterval);

  logger.info({ intervalMs: INSTANCE_CONFIG.heartbeatInterval }, 'Heartbeat started');
}

/**
 * Stop heartbeat
 */
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logger.info('Heartbeat stopped');
  }
}

/**
 * Get all active instances (excluding dead ones)
 */
async function getActiveInstances() {
  try {
    const allInstances = await redisCache.getActiveInstances();
    const now = Date.now();
    
    // Filter out dead instances (no heartbeat within timeout)
    const activeInstances = allInstances.filter(instance => {
      const lastHeartbeat = new Date(instance.lastHeartbeat).getTime();
      const timeSinceHeartbeat = now - lastHeartbeat;
      return timeSinceHeartbeat < INSTANCE_CONFIG.heartbeatTimeout;
    });

    logger.debug({ 
      total: allInstances.length, 
      active: activeInstances.length 
    }, 'Active instances retrieved');

    return activeInstances;
    
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get active instances');
    return [];
  }
}

/**
 * Get the least loaded instance for agent assignment
 * @returns {Object} Instance with least agents
 */
async function getLeastLoadedInstance() {
  try {
    const instances = await getActiveInstances();
    
    if (instances.length === 0) {
      // No other instances, use this one
      return {
        instanceId: INSTANCE_CONFIG.id,
        assignedAgents: assignedAgents.size,
        isLocal: true
      };
    }

    // Sort by agent count (ascending)
    const sortedInstances = instances.sort((a, b) => 
      (a.assignedAgents || 0) - (b.assignedAgents || 0)
    );

    // Get least loaded instance
    const leastLoaded = sortedInstances[0];
    
    logger.debug({
      selectedInstance: leastLoaded.instanceId,
      assignedAgents: leastLoaded.assignedAgents
    }, 'Least loaded instance selected');

    return {
      instanceId: leastLoaded.instanceId,
      assignedAgents: leastLoaded.assignedAgents,
      isLocal: leastLoaded.instanceId === INSTANCE_CONFIG.id
    };
    
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get least loaded instance');
    
    // Fallback to this instance
    return {
      instanceId: INSTANCE_CONFIG.id,
      assignedAgents: assignedAgents.size,
      isLocal: true
    };
  }
}

/**
 * Assign agent to this instance
 * @param {string} agentId - Agent UUID
 */
async function assignAgent(agentId) {
  try {
    assignedAgents.add(agentId);
    
    // Update instance registration with new agent count
    await registerInstance();
    
    // Mark agent as assigned to this instance in Redis
    if (redisCache.isReady()) {
      await redisCache.getClient().setex(
        `agent-instance:${agentId}`,
        3600, // 1 hour TTL
        INSTANCE_CONFIG.id
      );
    }
    
    logger.info({ 
      agentId: agentId.substring(0, 8),
      totalAgents: assignedAgents.size
    }, 'Agent assigned to instance');
    
    return true;
    
  } catch (error) {
    logger.error({ error: error.message, agentId }, 'Failed to assign agent');
    return false;
  }
}

/**
 * Unassign agent from this instance
 * @param {string} agentId - Agent UUID
 */
async function unassignAgent(agentId) {
  try {
    assignedAgents.delete(agentId);
    
    // Update instance registration
    await registerInstance();
    
    // Remove agent assignment from Redis
    if (redisCache.isReady()) {
      await redisCache.getClient().del(`agent-instance:${agentId}`);
    }
    
    logger.info({ 
      agentId: agentId.substring(0, 8),
      totalAgents: assignedAgents.size
    }, 'Agent unassigned from instance');
    
    return true;
    
  } catch (error) {
    logger.error({ error: error.message, agentId }, 'Failed to unassign agent');
    return false;
  }
}

/**
 * Check if agent is assigned to this instance
 * @param {string} agentId - Agent UUID
 * @returns {boolean} True if assigned to this instance
 */
function isAgentAssignedToThisInstance(agentId) {
  return assignedAgents.has(agentId);
}

/**
 * Get instance that agent is assigned to
 * @param {string} agentId - Agent UUID
 * @returns {string|null} Instance ID or null
 */
async function getAgentInstance(agentId) {
  try {
    if (!redisCache.isReady()) {
      return null;
    }
    
    const instanceId = await redisCache.getClient().get(`agent-instance:${agentId}`);
    return instanceId;
  } catch (error) {
    logger.error({ error: error.message, agentId }, 'Failed to get agent instance');
    return null;
  }
}

/**
 * Check if this instance can accept more agents
 * @returns {boolean} True if can accept more agents
 */
function canAcceptMoreAgents() {
  const canAccept = assignedAgents.size < INSTANCE_CONFIG.maxAgentsPerInstance;
  
  if (!canAccept) {
    logger.warn({
      current: assignedAgents.size,
      max: INSTANCE_CONFIG.maxAgentsPerInstance
    }, 'Instance at capacity');
  }
  
  return canAccept;
}

/**
 * Detect and handle orphaned agents from dead instances
 */
async function detectOrphanedAgents(supabaseAdmin) {
  try {
    logger.info('Checking for orphaned agents...');
    
    // Get all active instances
    const activeInstances = await getActiveInstances();
    const activeInstanceIds = new Set(activeInstances.map(i => i.instanceId));
    
    // Get all agents from database
    const { data: agents, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, instance_id')
      .eq('is_active', true)
      .not('instance_id', 'is', null);

    if (error) throw error;
    
    // Find orphaned agents (assigned to dead instances)
    const orphanedAgents = agents.filter(agent => 
      agent.instance_id && !activeInstanceIds.has(agent.instance_id)
    );

    if (orphanedAgents.length > 0) {
      logger.warn({ 
        count: orphanedAgents.length 
      }, 'Found orphaned agents from dead instances');

      // Clear instance assignments for orphaned agents
      for (const agent of orphanedAgents) {
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({ 
            instance_id: null,
            status: 'disconnected'
          })
          .eq('agent_id', agent.agent_id);
        
        logger.info({ 
          agentId: agent.agent_id.substring(0, 8),
          oldInstance: agent.instance_id
        }, 'Orphaned agent freed for reassignment');
      }
      
      return orphanedAgents.map(a => a.agent_id);
    }
    
    logger.info('No orphaned agents found');
    return [];
    
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to detect orphaned agents');
    return [];
  }
}

/**
 * Get instance statistics
 */
function getStats() {
  return {
    instanceId: INSTANCE_CONFIG.id,
    hostname: INSTANCE_CONFIG.hostname,
    pid: INSTANCE_CONFIG.pid,
    startedAt: INSTANCE_CONFIG.startedAt,
    uptime: process.uptime(),
    isActive,
    assignedAgents: assignedAgents.size,
    maxAgents: INSTANCE_CONFIG.maxAgentsPerInstance,
    utilization: (assignedAgents.size / INSTANCE_CONFIG.maxAgentsPerInstance * 100).toFixed(1) + '%',
    cpuUsage: process.cpuUsage(),
    memoryUsage: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      external: Math.round(process.memoryUsage().external / 1024 / 1024) + 'MB'
    }
  };
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  try {
    logger.info('Shutting down instance manager...');
    
    stopHeartbeat();
    isActive = false;
    
    // Unassign all agents
    for (const agentId of assignedAgents) {
      await unassignAgent(agentId);
    }
    
    logger.info('✅ Instance manager shut down');
    
  } catch (error) {
    logger.error({ error: error.message }, 'Error during instance manager shutdown');
  }
}

// Export all functions
module.exports = {
  initialize,
  getActiveInstances,
  getLeastLoadedInstance,
  assignAgent,
  unassignAgent,
  isAgentAssignedToThisInstance,
  getAgentInstance,
  canAcceptMoreAgents,
  detectOrphanedAgents,
  getStats,
  shutdown,
  
  // Getters
  get instanceId() { return INSTANCE_CONFIG.id; },
  get isActive() { return isActive; },
  get assignedAgentCount() { return assignedAgents.size; }
};
