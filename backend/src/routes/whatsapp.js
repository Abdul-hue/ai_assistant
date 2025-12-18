const express = require('express');
const { 
  connectToWhatsApp, 
  getSessionStatus, 
  getQRCode, 
  sendMessage, 
  disconnectWhatsApp 
} = require('../services/whatsappService');
const { authMiddleware } = require('../middleware/auth');
const pool = require('../database');

const router = express.Router();

// POST /api/whatsapp/connect
router.post('/connect', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.body;
    const userId = req.user.id;

    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID required' });
    }

    // Verify agent belongs to user
    const agentResult = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized - agent not found' });
    }

    // Create or update WhatsApp session
    await pool.query(
      `INSERT INTO whatsapp_sessions (user_id, agent_id, is_active)
       VALUES ($1, $2, true)`,
      [userId, agentId]
    );

    // Connect to WhatsApp
    await connectToWhatsApp(userId, agentId);

    res.json({ success: true, message: 'WhatsApp connection initiated - scan QR code' });
  } catch (error) {
    console.error('Connect error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/whatsapp/qr
router.get('/qr', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const qrCode = await getQRCode(userId);

    if (!qrCode) {
      return res.status(400).json({ error: 'QR code not yet generated - please wait' });
    }

    res.json({ qr: qrCode, status: 'success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/whatsapp/status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const status = await getSessionStatus(userId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/whatsapp/send
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    const userId = req.user.id;

    if (!phoneNumber || !message) {
      return res.status(400).json({ error: 'Phone number and message required' });
    }

    await sendMessage(userId, phoneNumber, message);
    res.json({ success: true, message: 'Message sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    await disconnectWhatsApp(userId);
    res.json({ success: true, message: 'WhatsApp disconnected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEBUG AND MONITORING ENDPOINTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/whatsapp/session/:agentId/debug - Debug endpoint to check session status
router.get('/session/:agentId/debug', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    
    // Verify ownership
    const agentCheck = await pool.query(
      'SELECT id, agent_name FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );
    
    if (agentCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized - agent not found' });
    }
    
    // Get database state
    const { supabaseAdmin } = require('../config/supabase');
    const { data: dbState, error: dbError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('*')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (dbError) {
      console.error('DB error:', dbError);
    }
    
    // Get runtime state
    const { activeSessions, connectionMonitors, healthCheckIntervals } = require('../services/baileysService');
    const session = activeSessions.get(agentId);
    
    const runtimeState = {
      hasActiveSession: !!session,
      isConnected: session?.isConnected || false,
      connectionState: session?.connectionState || 'unknown',
      websocketState: session?.socket?.ws?.readyState,
      websocketStateText: session?.socket?.ws?.readyState === 1 ? 'OPEN' : 
                          session?.socket?.ws?.readyState === 0 ? 'CONNECTING' : 
                          session?.socket?.ws?.readyState === 2 ? 'CLOSING' : 
                          session?.socket?.ws?.readyState === 3 ? 'CLOSED' : 'UNKNOWN',
      phoneNumber: session?.phoneNumber || null,
      socketCreatedAt: session?.socketCreatedAt ? new Date(session.socketCreatedAt).toISOString() : null,
      connectedAt: session?.connectedAt ? new Date(session.connectedAt).toISOString() : null,
      qrCode: session?.qrCode ? 'present (truncated)' : null,
      qrGeneratedAt: session?.qrGeneratedAt ? new Date(session.qrGeneratedAt).toISOString() : null,
      qrAttempts: session?.qrAttempts || 0,
      failureReason: session?.failureReason || null,
      failureAt: session?.failureAt ? new Date(session.failureAt).toISOString() : null
    };
    
    // Get monitoring state
    const monitoringState = {
      hasConnectionMonitor: connectionMonitors?.has(agentId) || false,
      hasHealthCheck: healthCheckIntervals?.has(agentId) || false,
      hasHeartbeat: !!session?.heartbeatInterval
    };
    
    // Get reconnection status
    const { getReconnectionStatus } = require('../utils/reconnectionManager');
    const reconnectionStatus = getReconnectionStatus(agentId);
    
    // Calculate heartbeat age if available
    let heartbeatAgeSeconds = null;
    if (dbState?.last_heartbeat) {
      const lastHeartbeat = new Date(dbState.last_heartbeat);
      heartbeatAgeSeconds = Math.round((Date.now() - lastHeartbeat.getTime()) / 1000);
    }
    
    res.json({
      agentId,
      agentName: agentCheck.rows[0].agent_name,
      database: dbState ? {
        ...dbState,
        session_data: dbState.session_data ? 'present (truncated)' : null,
        qr_code: dbState.qr_code ? 'present (truncated)' : null,
        heartbeatAgeSeconds
      } : null,
      runtime: runtimeState,
      monitoring: monitoringState,
      reconnection: reconnectionStatus,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/whatsapp/agents/:agentId/reconnect - Manually trigger reconnection
router.post('/agents/:agentId/reconnect', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    
    // Verify ownership
    const agentCheck = await pool.query(
      'SELECT id, agent_name FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );
    
    if (agentCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized - agent not found' });
    }
    
    console.log(`[WHATSAPP] Manual reconnection requested for agent ${agentId} by user ${userId}`);
    
    const { handleSmartReconnection } = require('../utils/reconnectionManager');
    
    // Trigger reconnection asynchronously
    handleSmartReconnection(agentId, 'manual_api_request', 1)
      .then(result => {
        if (result) {
          console.log(`[WHATSAPP] Manual reconnection successful for ${agentId}`);
        }
      })
      .catch(error => {
        console.error(`[WHATSAPP] Manual reconnection failed for ${agentId}:`, error.message);
      });
    
    res.json({ 
      success: true, 
      message: 'Reconnection initiated',
      agentId,
      agentName: agentCheck.rows[0].agent_name
    });
    
  } catch (error) {
    console.error('Reconnect endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/whatsapp/health - Overall WhatsApp service health
router.get('/health', authMiddleware, async (req, res) => {
  try {
    const { activeSessions, connectionMonitors, healthCheckIntervals } = require('../services/baileysService');
    const { supabaseAdmin } = require('../config/supabase');
    
    // Get all sessions from database
    const { data: dbSessions, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, status, is_active, last_heartbeat');
    
    if (error) {
      throw error;
    }
    
    const activeSess = Array.from(activeSessions.keys());
    const totalDbSessions = dbSessions?.length || 0;
    const activeDbSessions = dbSessions?.filter(s => s.is_active).length || 0;
    const connectedDbSessions = dbSessions?.filter(s => s.status === 'connected').length || 0;
    
    res.json({
      healthy: true,
      runtime: {
        totalActiveSessions: activeSess.length,
        connectionMonitors: connectionMonitors?.size || 0,
        healthCheckIntervals: healthCheckIntervals?.size || 0,
        activeSessions: activeSess
      },
      database: {
        totalSessions: totalDbSessions,
        activeSessions: activeDbSessions,
        connectedSessions: connectedDbSessions
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ healthy: false, error: error.message });
  }
});

module.exports = router;
