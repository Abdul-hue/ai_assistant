const { supabaseAdmin } = require('../config/supabase');
const { initializeWhatsApp, activeSessions } = require('./baileysService');

/**
 * Monitor connections and auto-reconnect if needed
 * Run this every 5 minutes
 */
async function monitorConnections() {
  try {
    console.log('[CONNECTION-MONITOR] 🔍 Checking connection health...');
    
    // Get all active sessions from database
    const { data: sessions, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, user_id, status, phone_number, last_heartbeat')
      .eq('is_active', true);
    
    if (error) {
      console.error('[CONNECTION-MONITOR] ❌ Error fetching sessions:', error);
      return;
    }
    
    if (!sessions || sessions.length === 0) {
      console.log('[CONNECTION-MONITOR] ℹ️  No active sessions to monitor');
      return;
    }
    
    console.log(`[CONNECTION-MONITOR] 📱 Monitoring ${sessions.length} active session(s)`);
    
    for (const dbSession of sessions) {
      const { agent_id, user_id, status, last_heartbeat } = dbSession;
      
      // Check if session exists in memory
      const memorySession = activeSessions.get(agent_id);
      
      // Case 1: Session in DB but not in memory
      if (!memorySession) {
        console.log(`[CONNECTION-MONITOR] ⚠️  Agent ${agent_id.substring(0, 8)}... is active in DB but not in memory - reconnecting`);
        
        try {
          await initializeWhatsApp(agent_id, user_id);
          console.log(`[CONNECTION-MONITOR] ✅ Reconnected agent ${agent_id.substring(0, 8)}...`);
        } catch (error) {
          console.error(`[CONNECTION-MONITOR] ❌ Failed to reconnect ${agent_id.substring(0, 8)}...:`, error.message);
        }
        
        continue;
      }
      
      // Case 2: Session in memory but not connected
      if (!memorySession.isConnected) {
        console.log(`[CONNECTION-MONITOR] ⚠️  Agent ${agent_id.substring(0, 8)}... in memory but not connected - reconnecting`);
        
        try {
          await initializeWhatsApp(agent_id, user_id);
          console.log(`[CONNECTION-MONITOR] ✅ Reconnected agent ${agent_id.substring(0, 8)}...`);
        } catch (error) {
          console.error(`[CONNECTION-MONITOR] ❌ Failed to reconnect ${agent_id.substring(0, 8)}...:`, error.message);
        }
        
        continue;
      }
      
      // Case 3: Heartbeat is stale (no heartbeat in 5 minutes)
      if (last_heartbeat) {
        const lastHeartbeatDate = new Date(last_heartbeat);
        const minutesSinceHeartbeat = (Date.now() - lastHeartbeatDate.getTime()) / 1000 / 60;
        
        if (minutesSinceHeartbeat > 5) {
          console.log(`[CONNECTION-MONITOR] ⚠️  Agent ${agent_id.substring(0, 8)}... has stale heartbeat (${Math.floor(minutesSinceHeartbeat)} min) - reconnecting`);
          
          try {
            await initializeWhatsApp(agent_id, user_id);
            console.log(`[CONNECTION-MONITOR] ✅ Reconnected agent ${agent_id.substring(0, 8)}...`);
          } catch (error) {
            console.error(`[CONNECTION-MONITOR] ❌ Failed to reconnect ${agent_id.substring(0, 8)}...:`, error.message);
          }
        }
      }
    }
    
    console.log('[CONNECTION-MONITOR] ✅ Health check complete');
  } catch (error) {
    console.error('[CONNECTION-MONITOR] ❌ Error in monitoring:', error);
  }
}

// Run every 5 minutes
let monitoringInterval = null;

function startMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  
  // Run immediately on startup
  monitorConnections();
  
  // Then run every 5 minutes
  monitoringInterval = setInterval(monitorConnections, 5 * 60 * 1000);
  
  console.log('[CONNECTION-MONITOR] ✅ Connection monitoring started (checking every 5 minutes)');
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log('[CONNECTION-MONITOR] ⏹️  Connection monitoring stopped');
  }
}

module.exports = {
  monitorConnections,
  startMonitoring,
  stopMonitoring,
  monitoringInterval
};

