/**
 * Socket Manager for Baileys WhatsApp connections
 * 
 * This module provides socket access for media processing by integrating
 * with the existing Baileys session management in baileysService.
 */

const pino = require('pino');
const logger = pino({ level: 'info' });

/**
 * Get socket for an agent from baileysService's active sessions
 * 
 * IMPORTANT: This function accesses baileysService's internal activeSessions Map.
 * To make this work properly, you should add this export to baileysService.js:
 * 
 * ```javascript
 * // At the end of baileysService.js, add:
 * function getSessionForAgent(agentId) {
 *   return activeSessions.get(agentId);
 * }
 * 
 * module.exports = {
 *   // ... existing exports ...
 *   getSessionForAgent
 * };
 * ```
 * 
 * @param {string} agentId - Agent ID
 * @returns {Object|null} Baileys socket instance or null if not found
 */
function getSocket(agentId) {
  if (!agentId) {
    return null;
  }
  
  try {
    // Access baileysService to get the session
    // We use a try-catch to handle cases where the module isn't loaded yet
    const baileysService = require('../services/baileysService');
    
    // Try to get session using exported function (if available)
    if (typeof baileysService.getSessionForAgent === 'function') {
      const session = baileysService.getSessionForAgent(agentId);
      if (session?.socket) {
        // ✅ FIX: If socket doesn't have store but session does, attach it
        if (!session.socket.store && session.store) {
          session.socket.store = session.store;
          // #region debug log
          fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socketManager.js:47',message:'Attached store from session to socket',data:{agentId:agentId.substring(0,8),hasSessionStore:!!session.store},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
          // #endregion
        }
        
        // #region debug log
        fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socketManager.js:52',message:'Socket retrieved',data:{agentId:agentId.substring(0,8),hasSocket:!!session.socket,hasSocketStore:!!session.socket?.store,hasSessionStore:!!session.store,hasMessages:!!session.socket?.store?.messages,socketKeys:Object.keys(session.socket||{}).slice(0,10)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        return session.socket;
      }
    }
    
    // Fallback: Try to access activeSessions directly
    // This requires baileysService to export it or we need to modify it
    // For now, we'll return null and log a helpful message
    logger.warn({ 
      agentId: agentId.substring(0, 8) + '...' 
    }, 'Socket not found. Add getSessionForAgent() export to baileysService.js');
    
    return null;
  } catch (error) {
    logger.error({ 
      agentId: agentId?.substring(0, 8) + '...',
      error: error.message 
    }, 'Failed to get socket from baileysService');
    return null;
  }
}

/**
 * Register a socket for an agent
 * This is a no-op since sockets are managed by baileysService
 * Kept for API compatibility
 */
function registerSocket(agentId, socket) {
  logger.debug({ agentId: agentId?.substring(0, 8) + '...' }, 
    'Socket registration handled by baileysService');
  // Sockets are registered in baileysService, this is just for compatibility
}

/**
 * Remove socket for an agent
 * This is a no-op since sockets are managed by baileysService
 * Kept for API compatibility
 */
function removeSocket(agentId) {
  logger.debug({ agentId: agentId?.substring(0, 8) + '...' }, 
    'Socket removal handled by baileysService');
  // Sockets are removed in baileysService, this is just for compatibility
}

/**
 * Get all registered agent IDs
 * @returns {Array<string>} List of agent IDs
 */
function getRegisteredAgents() {
  try {
    const baileysService = require('../services/baileysService');
    if (typeof baileysService.getActiveAgentIds === 'function') {
      return baileysService.getActiveAgentIds();
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get registered agents');
  }
  return [];
}

/**
 * Check if socket exists for agent
 * @param {string} agentId - Agent ID
 * @returns {boolean}
 */
function hasSocket(agentId) {
  return getSocket(agentId) !== null;
}

/**
 * Clear all sockets (useful for testing or shutdown)
 * This is a no-op since sockets are managed by baileysService
 */
function clearAllSockets() {
  logger.debug('Socket clearing handled by baileysService');
  // Sockets are managed in baileysService
}

module.exports = {
  registerSocket,
  getSocket,
  removeSocket,
  getRegisteredAgents,
  hasSocket,
  clearAllSockets
};
