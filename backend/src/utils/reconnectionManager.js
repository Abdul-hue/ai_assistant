/**
 * Smart Reconnection Manager for WhatsApp
 * 
 * Features:
 * - Exponential backoff (2s -> 4s -> 8s -> 16s -> 32s -> 60s max)
 * - Circuit breaker pattern
 * - Multi-instance protection
 * - Failure notifications
 */

const { supabaseAdmin } = require('../config/supabase');

// Reconnection configuration
const MAX_RECONNECTION_ATTEMPTS = 5;
const INITIAL_BACKOFF = 2000; // 2 seconds
const MAX_BACKOFF = 60000; // 60 seconds
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

// State tracking
const reconnectionAttempts = new Map();
const circuitBreaker = new Map();
const reconnectionInProgress = new Map();

/**
 * Smart Reconnection with Exponential Backoff
 */
async function handleSmartReconnection(agentId, reason, attempt = 1) {
  // Prevent concurrent reconnection attempts
  if (reconnectionInProgress.get(agentId)) {
    console.log(`[RECONNECT] ${agentId.substring(0, 8)}... Reconnection already in progress, skipping`);
    return null;
  }
  
  reconnectionInProgress.set(agentId, true);
  
  try {
    console.log(`[RECONNECT] ${agentId.substring(0, 8)}... Attempt ${attempt}/${MAX_RECONNECTION_ATTEMPTS} (reason: ${reason})`);
    
    // Check circuit breaker
    if (isCircuitOpen(agentId)) {
      console.log(`[RECONNECT] ${agentId.substring(0, 8)}... Circuit breaker OPEN, waiting ${CIRCUIT_BREAKER_TIMEOUT/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, CIRCUIT_BREAKER_TIMEOUT));
      resetCircuit(agentId);
    }
    
    // Check if another instance is handling this
    const activeInstance = await checkForActiveInstance(agentId);
    if (activeInstance) {
      console.log(`[RECONNECT] ${agentId.substring(0, 8)}... Another instance is active (${activeInstance.secondsAgo}s ago), aborting`);
      return null;
    }
    
    // Calculate exponential backoff
    const backoffDelay = Math.min(
      INITIAL_BACKOFF * Math.pow(2, attempt - 1),
      MAX_BACKOFF
    );
    
    // Update database status
    await supabaseAdmin
      .from('whatsapp_sessions')
      .update({
        status: 'reconnecting',
        updated_at: new Date().toISOString()
      })
      .eq('agent_id', agentId);
    
    // Wait before attempting (except first attempt)
    if (attempt > 1) {
      console.log(`[RECONNECT] ${agentId.substring(0, 8)}... Waiting ${backoffDelay}ms before attempt ${attempt}`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
    
    // Clean up existing connection
    const { cleanupMonitoring, activeSessions } = require('../services/baileysService');
    if (typeof cleanupMonitoring === 'function') {
      await cleanupMonitoring(agentId);
    }
    
    // Attempt reconnection
    console.log(`[RECONNECT] ${agentId.substring(0, 8)}... Attempting to reconnect...`);
    const { initializeWhatsApp } = require('../services/baileysService');
    
    const result = await initializeWhatsApp(agentId, null);
    
    if (result && result.success) {
      console.log(`[RECONNECT] ${agentId.substring(0, 8)}... ✅ Reconnection SUCCESSFUL!`);
      
      // Reset tracking
      reconnectionAttempts.delete(agentId);
      recordSuccess(agentId);
      
      // Update database
      await supabaseAdmin
        .from('whatsapp_sessions')
        .update({
          status: result.isActive ? 'connected' : 'qr_pending',
          is_active: result.isActive || false,
          updated_at: new Date().toISOString()
        })
        .eq('agent_id', agentId);
      
      // Emit Socket.IO event
      try {
        const app = require('../../app');
        const io = app.get('io');
        if (io) {
          io.to(`whatsapp:${agentId}`).emit('whatsapp:reconnected', {
            agentId,
            message: 'Connection restored successfully',
            attempts: attempt,
            timestamp: new Date().toISOString()
          });
        }
      } catch (socketError) {
        console.error(`[RECONNECT] Socket.IO emit error:`, socketError.message);
      }
      
      return result;
    } else {
      throw new Error(result?.error || 'Reconnection failed - no success response');
    }
    
  } catch (error) {
    console.error(`[RECONNECT] ${agentId.substring(0, 8)}... ❌ Attempt ${attempt} FAILED:`, error.message);
    
    recordFailure(agentId);
    
    // Retry if under max attempts
    if (attempt < MAX_RECONNECTION_ATTEMPTS) {
      reconnectionAttempts.set(agentId, attempt);
      reconnectionInProgress.set(agentId, false);
      return handleSmartReconnection(agentId, reason, attempt + 1);
    } else {
      // Max attempts reached
      console.error(`[RECONNECT] ${agentId.substring(0, 8)}... 🚫 Max reconnection attempts reached. Marking as failed.`);
      
      await supabaseAdmin
        .from('whatsapp_sessions')
        .update({
          status: 'disconnected',
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('agent_id', agentId);
      
      // Notify user
      await notifyReconnectionFailure(agentId, reason, attempt);
      
      reconnectionAttempts.delete(agentId);
      return null;
    }
  } finally {
    reconnectionInProgress.set(agentId, false);
  }
}

/**
 * Check for active instance (multi-instance protection)
 */
async function checkForActiveInstance(agentId) {
  try {
    const { data: session, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('last_heartbeat')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (error || !session || !session.last_heartbeat) return null;
    
    const lastHeartbeat = new Date(session.last_heartbeat);
    const secondsAgo = (Date.now() - lastHeartbeat.getTime()) / 1000;
    
    // If heartbeat is within 45 seconds, another instance might be active
    if (secondsAgo < 45) {
      return { secondsAgo: Math.round(secondsAgo) };
    }
    
    return null;
  } catch (error) {
    console.error(`[RECONNECT] Error checking active instance:`, error.message);
    return null;
  }
}

/**
 * Circuit Breaker Pattern - Record failure
 */
function recordFailure(agentId) {
  const failures = (circuitBreaker.get(agentId) || 0) + 1;
  circuitBreaker.set(agentId, failures);
  
  if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
    console.log(`[RECONNECT] ${agentId.substring(0, 8)}... ⚠️ Circuit breaker OPENED (${failures} failures)`);
  }
}

/**
 * Circuit Breaker Pattern - Record success
 */
function recordSuccess(agentId) {
  circuitBreaker.set(agentId, 0);
  console.log(`[RECONNECT] ${agentId.substring(0, 8)}... ✅ Circuit breaker RESET`);
}

/**
 * Circuit Breaker Pattern - Check if open
 */
function isCircuitOpen(agentId) {
  return (circuitBreaker.get(agentId) || 0) >= CIRCUIT_BREAKER_THRESHOLD;
}

/**
 * Circuit Breaker Pattern - Manual reset
 */
function resetCircuit(agentId) {
  circuitBreaker.set(agentId, 0);
  console.log(`[RECONNECT] ${agentId.substring(0, 8)}... 🔄 Circuit breaker manually reset`);
}

/**
 * Notify user of reconnection failure
 */
async function notifyReconnectionFailure(agentId, reason, attempts) {
  try {
    // Get agent details
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('agent_name, user_id')
      .eq('id', agentId)
      .maybeSingle();
    
    if (agentError || !agent) {
      console.error(`[RECONNECT] Could not find agent for notification:`, agentError?.message);
      return;
    }
    
    // Emit Socket.IO event (real-time toast)
    try {
      const app = require('../../app');
      const io = app.get('io');
      if (io) {
        io.to(`whatsapp:${agentId}`).emit('whatsapp:reconnection-failed', {
          agentId,
          agentName: agent.agent_name,
          reason,
          attempts,
          message: `WhatsApp connection failed after ${attempts} attempts`,
          action: 'reconnect_manual',
          timestamp: new Date().toISOString()
        });
        
        // Also emit to user room
        io.to(agent.user_id).emit('whatsapp:reconnection-failed', {
          agentId,
          agentName: agent.agent_name,
          reason,
          attempts,
          message: `WhatsApp connection for "${agent.agent_name}" failed after ${attempts} attempts`,
          action: 'reconnect_manual',
          timestamp: new Date().toISOString()
        });
      }
    } catch (socketError) {
      console.error(`[RECONNECT] Socket.IO notification error:`, socketError.message);
    }
    
    console.log(`[RECONNECT] ${agentId.substring(0, 8)}... 📧 Failure notification sent`);
    
  } catch (error) {
    console.error(`[RECONNECT] Failed to send notifications:`, error.message);
  }
}

/**
 * Get reconnection status for an agent
 */
function getReconnectionStatus(agentId) {
  return {
    inProgress: reconnectionInProgress.get(agentId) || false,
    attempts: reconnectionAttempts.get(agentId) || 0,
    circuitOpen: isCircuitOpen(agentId),
    circuitFailures: circuitBreaker.get(agentId) || 0
  };
}

/**
 * Cancel reconnection for an agent
 */
function cancelReconnection(agentId) {
  reconnectionInProgress.set(agentId, false);
  reconnectionAttempts.delete(agentId);
  console.log(`[RECONNECT] ${agentId.substring(0, 8)}... Reconnection cancelled`);
}

module.exports = {
  handleSmartReconnection,
  checkForActiveInstance,
  getReconnectionStatus,
  cancelReconnection,
  resetCircuit,
  isCircuitOpen,
  MAX_RECONNECTION_ATTEMPTS,
  INITIAL_BACKOFF,
  MAX_BACKOFF
};

