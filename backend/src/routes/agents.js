const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const pool = require('../database'); // DEPRECATED: Use supabase SDK directly for new code
const { supabase } = require('../database'); // Direct Supabase SDK access
const { randomUUID } = require('crypto');
const { validate, validateUUID } = require('../validators/middleware');
const { createAgentSchema, updateAgentSchema, sendMessageSchema } = require('../validators/agent');
const { processAgentDocuments } = require('../services/documentProcessor');

const router = express.Router();
const {
  safeInitializeWhatsApp,
  getSessionStatus,
  getWhatsAppStatus,
  getQRCode,
  sendMessage,
  disconnectWhatsApp,
  subscribeToAgentEvents,
} = require('../services/baileysService');

// POST /api/agents (create agent)
// SECURITY: Input validation with Zod
router.post('/', authMiddleware, validate(createAgentSchema), async (req, res) => {
  try {
    const { name, description, systemPrompt, erpCrsData, integrationEndpoints = [], uploadedFiles = [] } = req.body;
    const userId = req.user.id;

    if (!name) {
      return res.status(400).json({ error: 'Agent name required' });
    }

    const endpointsWithIds = integrationEndpoints.map((endpoint) => ({
      id: endpoint.id || randomUUID(),
      name: endpoint.name,
      url: endpoint.url
    }));

    const result = await pool.query(
      `INSERT INTO agents (
        user_id, agent_name, description, initial_prompt,
        company_data, integration_endpoints, uploaded_files
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        userId,
        name,
        description || '',
        systemPrompt || '',
        JSON.stringify(erpCrsData || {}),
        JSON.stringify(endpointsWithIds),
        JSON.stringify(uploadedFiles || []),
      ]
    );

    const createdAgent = result.rows[0];

    console.log(`✅ Agent created: ${name} (${createdAgent.id})`);
    res.status(201).json(createdAgent);

    // Non-blocking: process document extraction & webhook after response
    setImmediate(() => {
      processAgentDocuments(createdAgent).catch((error) => {
        console.error(
          `[AGENTS] Document processing failed for agent ${createdAgent.id}:`,
          error
        );
      });
    });
  } catch (error) {
    console.error('Create agent error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/agents (list user's agents)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM agents WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/agents/:id
// SECURITY: UUID validation
router.get('/:id', authMiddleware, validateUUID('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM agents WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/agents/:id/details
// Get complete agent details with WhatsApp session and statistics
// SECURITY: UUID validation, user ownership verification
router.get('/:id/details', authMiddleware, validateUUID('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log(`[AGENT-DETAILS] Fetching details for agent: ${id}, user: ${userId}`);

    // Query 1: Get agent information
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (agentError || !agentData) {
      console.warn(`[AGENT-DETAILS] Agent not found: ${id}`);
      return res.status(404).json({ 
        error: 'Agent not found',
        message: 'Agent does not exist or you do not have access to it'
      });
    }

    // Query 2: Get WhatsApp session information (LEFT JOIN)
    const { data: sessionData, error: sessionError } = await supabase
      .from('whatsapp_sessions')
      .select('id, phone_number, is_active, last_connected, qr_code, status, connection_state, created_at, updated_at')
      .eq('agent_id', id)
      .maybeSingle(); // Use maybeSingle instead of single to handle no session gracefully

    if (sessionError) {
      console.error(`[AGENT-DETAILS] Error fetching WhatsApp session:`, sessionError);
      // Continue without session data rather than failing
    }

    // SECURITY: Verify agent belongs to user before fetching statistics
    // (Already verified in Query 1, but being explicit for security)
    if (agentData.user_id !== userId) {
      console.warn(`[AGENT-DETAILS] Security: User ${userId} attempted to access agent ${id} owned by ${agentData.user_id}`);
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'You do not have access to this agent'
      });
    }

    // Query 3: Get message statistics from message_log table
    // CRITICAL: Filter by both agent_id AND user_id for security
    const { count: totalMessages, error: countError } = await supabase
      .from('message_log')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', id)
      .eq('user_id', userId);

    if (countError) {
      console.error(`[AGENT-DETAILS] Error counting messages:`, countError);
    }

    // Query 4: Get last message (text and timestamp) from message_log
    // CRITICAL: Filter by both agent_id AND user_id for security
    const { data: lastMessageData, error: lastMessageError } = await supabase
      .from('message_log')
      .select('message_text, received_at')
      .eq('agent_id', id)
      .eq('user_id', userId)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMessageError) {
      console.error(`[AGENT-DETAILS] Error fetching last message:`, lastMessageError);
    }

    // Query 5: Get unprocessed messages count
    // CRITICAL: Filter by both agent_id AND user_id for security
    const { count: unprocessedMessages, error: unprocessedError } = await supabase
      .from('message_log')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', id)
      .eq('user_id', userId)
      .eq('processed', false);

    if (unprocessedError) {
      console.error(`[AGENT-DETAILS] Error counting unprocessed messages:`, unprocessedError);
    }

    // SECURITY: Build WhatsApp session object, excluding sensitive fields
    let whatsappSession = null;
    if (sessionData) {
      whatsappSession = {
        id: sessionData.id,
        phone_number: sessionData.phone_number,
        is_active: sessionData.is_active,
        last_connected: sessionData.last_connected,
        status: sessionData.status,
        created_at: sessionData.created_at,
        updated_at: sessionData.updated_at,
        // SECURITY: Only include qr_code if connection is in progress (not connected yet)
        qr_code: (!sessionData.is_active && sessionData.status === 'qr_pending') 
          ? sessionData.qr_code 
          : null
        // IMPORTANT: Do NOT expose session_state (contains encryption keys)
      };
    }

    // Build statistics object
    const statistics = {
      total_messages: totalMessages || 0,
      last_message_at: lastMessageData?.received_at || null,
      last_message_text: lastMessageData?.message_text || null,
      unprocessed_messages: unprocessedMessages || 0
    };

    // Build complete response
    const response = {
      agent: {
        ...agentData,
        whatsapp_session: whatsappSession
      },
      statistics
    };

    console.log(`[AGENT-DETAILS] Successfully fetched details for agent: ${id}`);
    res.json(response);

  } catch (error) {
    console.error(`[AGENT-DETAILS] Unexpected error:`, error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch agent details'
    });
  }
});

// PUT /api/agents/:id (update agent configuration)
// SECURITY: Input validation with Zod
router.put('/:id', authMiddleware, validateUUID('id'), validate(updateAgentSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { name, description, systemPrompt, erpCrsData, integrationEndpoints, uploadedFiles } = req.body;

    const endpointsWithIds = Array.isArray(integrationEndpoints)
      ? integrationEndpoints.map((endpoint) => ({
          id: endpoint.id || randomUUID(),
          name: endpoint.name,
          url: endpoint.url,
        }))
      : undefined;

    const result = await pool.query(
      `UPDATE agents SET
        agent_name = COALESCE($1, agent_name),
        description = COALESCE($2, description),
        initial_prompt = COALESCE($3, initial_prompt),
        company_data = COALESCE($4::jsonb, company_data),
        integration_endpoints = COALESCE($5::jsonb, integration_endpoints),
        uploaded_files = COALESCE($6::jsonb, uploaded_files),
        updated_at = NOW()
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [
        name,
        description,
        systemPrompt,
        erpCrsData ? JSON.stringify(erpCrsData) : null,
        endpointsWithIds ? JSON.stringify(endpointsWithIds) : null,
        uploadedFiles ? JSON.stringify(uploadedFiles) : null,
        id,
        userId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    console.log(`✅ Agent updated: ${id}`);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update agent error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/agents/:id
// SECURITY: UUID validation
router.delete('/:id', authMiddleware, validateUUID('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const agentResult = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    try {
      await disconnectWhatsApp(id);
      console.log(`[AGENT-DELETE] ✅ WhatsApp disconnect triggered for ${id}`);
    } catch (disconnectError) {
      console.warn(`[AGENT-DELETE] ⚠️ Failed to disconnect WhatsApp for ${id}:`, disconnectError.message);
    }

    try {
      await supabase
        .from('whatsapp_sessions')
        .delete()
        .eq('agent_id', id);
      console.log(`[AGENT-DELETE] ✅ WhatsApp session removed for ${id}`);
    } catch (sessionError) {
      console.warn(`[AGENT-DELETE] ⚠️ Failed to delete WhatsApp session for ${id}:`, sessionError.message);
    }

    const result = await pool.query(
      'DELETE FROM agents WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    console.log(`✅ Agent deleted: ${id}`);
    res.json({ success: true, message: 'Agent deleted' });
  } catch (error) {
    console.error('[AGENT-DELETE] ❌ Error deleting agent:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/agents/:id/chat-history
router.get('/:id/chat-history', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { limit = 100, offset = 0 } = req.query;

    // Verify agent belongs to user
    const agentResult = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const messages = await pool.query(
      `SELECT * FROM chat_messages
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    res.json(messages.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/agents/:id/chat-history (clear chat history)
router.delete('/:id/chat-history', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify authorization
    const agentResult = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await pool.query(
      'DELETE FROM chat_messages WHERE agent_id = $1',
      [id]
    );

    console.log(`✅ Chat history cleared for agent: ${id}`);
    res.json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================== WhatsApp Agent Endpoints =====================

// POST /api/agents/:agentId/init-whatsapp
// SECURITY: UUID validation
router.post('/:agentId/init-whatsapp', authMiddleware, validateUUID('agentId'), async (req, res) => {
  try {
    // Extract agentId from params and body (defensive approach)
    const agentId = req.params.agentId || req.body.agentId;
    const userId = req.user.id;

    // Comprehensive logging for debugging
    console.log(`[INIT-WHATSAPP] DEBUG - Incoming request details:`);
    console.log(`[INIT-WHATSAPP] DEBUG - Route params:`, req.params);
    console.log(`[INIT-WHATSAPP] DEBUG - Request body:`, req.body);
    console.log(`[INIT-WHATSAPP] DEBUG - Headers:`, {
      'content-type': req.headers['content-type'],
      'authorization': req.headers.authorization ? 'Bearer [REDACTED]' : 'MISSING',
      'user-agent': req.headers['user-agent']
    });
    console.log(`[INIT-WHATSAPP] DEBUG - Extracted agentId: ${agentId}, userId: ${userId}`);

    // CRITICAL: Validate agentId - prevent null inserts
    if (!agentId || agentId === 'null' || agentId === null || agentId === '' || agentId === undefined) {
      console.error(`[INIT-WHATSAPP] CRITICAL: agentId is required but missing`);
      console.error(`[INIT-WHATSAPP] CRITICAL - Request details:`, {
        params: req.params,
        body: req.body,
        agentId: agentId,
        type: typeof agentId
      });
      return res.status(400).json({ 
        error: 'agentId is required',
        details: `agentId: ${agentId}, type: ${typeof agentId}`
      });
    }

    // Validate Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.error(`[INIT-WHATSAPP] CRITICAL: Authorization header is required`);
      return res.status(401).json({ 
        error: 'Authorization header is required',
        details: 'Missing Authorization header in request'
      });
    }

    // Additional validation for UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(agentId)) {
      console.error(`[INIT-WHATSAPP] CRITICAL: Invalid UUID format for agentId: ${agentId}`);
      return res.status(400).json({ 
        error: 'Invalid agent ID format',
        details: `Expected UUID format, got: ${agentId}`
      });
    }

    // Verify agent belongs to user
    const agentResult = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Import Baileys service and QR code library
    const QRCode = require('qrcode');
    
    // Initialize WhatsApp session
    console.log(`[INIT-WHATSAPP] DEBUG - About to call initializeWhatsApp with: agentId=${agentId}, userId=${userId}`);
    const result = await safeInitializeWhatsApp(agentId, userId);
    console.log(`[INIT-WHATSAPP] DEBUG - initializeWhatsApp result:`, result);
    
    if (result.success) {
      // Wait for QR code generation (up to 15 seconds)
      let qr = null;
      let attempts = 0;
      const maxAttempts = 30; // 15 seconds
      
      while (!qr && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
        qr = getQRCode(agentId);
        attempts++;
        console.log(`[INIT-WHATSAPP] DEBUG - QR attempt ${attempts}: ${qr ? 'QR found' : 'No QR yet'}`);
      }
      
      let qrCodeDataUrl = null;
      if (qr) {
        try {
          // Convert QR string to data URL for frontend display
          qrCodeDataUrl = await QRCode.toDataURL(qr);
          console.log(`[INIT-WHATSAPP] DEBUG - QR code converted to data URL`);
        } catch (qrError) {
          console.error(`[INIT-WHATSAPP] DEBUG - Failed to convert QR to data URL:`, qrError);
          qrCodeDataUrl = qr; // Fallback to raw string
        }
      }
      
      console.log(`[INIT-WHATSAPP] DEBUG - Final response: success=${result.success}, hasQR=${!!qrCodeDataUrl}, status=${result.status}`);
      
      res.json({
        success: true,
        qrCode: qrCodeDataUrl,
        status: qr ? 'qr_pending' : result.status,
        phoneNumber: result.phoneNumber,
        isActive: result.isActive || false, // CRITICAL: Include isActive flag
        requiresScan: !!qr && !result.phoneNumber // New field: indicates QR needs scanning
      });
    } else {
      if (result.status === 'connecting') {
        return res.status(202).json({
          success: false,
          status: 'connecting',
          message: 'Connection already in progress. Please wait...'
        });
      }

      if (result.status === 'cooldown') {
        return res.status(429).json({
          success: false,
          status: 'cooldown',
          retryAfter: result.retryAfter,
          message: `Please wait ${Math.ceil((result.retryAfter || 0) / 1000)} seconds before retrying`
        });
      }

      res.status(500).json({
        success: false,
        error: result.error || 'Failed to initialize WhatsApp',
        status: result.status || 'error',
        isActive: false
      });
    }
  } catch (error) {
    console.error('init-whatsapp error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/agents/:agentId/whatsapp-status
// SECURITY: UUID validation
router.get('/:agentId/whatsapp-status', authMiddleware, validateUUID('agentId'), async (req, res) => {
  const { agentId } = req.params;
  const userId = req.user.id;

  console.log(`[WHATSAPP-STATUS] Status check requested for agent ${agentId.substring(0, 8)}..., user ${userId.substring(0, 8)}...`);

  try {
    const agentResult = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );

    if (!agentResult || agentResult.rows.length === 0) {
      console.log(`[WHATSAPP-STATUS] Agent ${agentId.substring(0, 8)}... not found for user ${userId.substring(0, 8)}...`);
      return res.status(404).json({
        success: false,
        connected: false,
        status: 'disconnected',
        is_active: false,
        qr_code: null,
        phone_number: null,
        message: 'Agent not found'
      });
    }
  } catch (dbError) {
    console.error(`[WHATSAPP-STATUS] Database verification error:`, dbError);
    return res.status(500).json({
      success: false,
      connected: false,
      status: 'error',
      is_active: false,
      qr_code: null,
      phone_number: null,
      message: 'Failed to verify agent ownership'
    });
  }

  try {
    const statusPayload = await getWhatsAppStatus(agentId);
    console.log(`[WHATSAPP-STATUS] Responding for agent ${agentId.substring(0, 8)}...:`, statusPayload);
    res.json(statusPayload);
  } catch (error) {
    console.error(`[WHATSAPP-STATUS] Unexpected error:`, error);
    res.json({
      success: false,
      connected: false,
      status: 'error',
      is_active: false,
      qr_code: null,
      phone_number: null,
      message: error.message || 'Failed to retrieve WhatsApp status'
    });
  }
});

// GET /api/agents/:agentId/whatsapp/stream - Server Sent Events for QR/status updates
router.get('/:agentId/whatsapp/stream', authMiddleware, validateUUID('agentId'), async (req, res) => {
  const { agentId } = req.params;
  const userId = req.user.id;

  try {
    const agentResult = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );

    if (!agentResult || agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }
  } catch (error) {
    console.error('[WHATSAPP-STREAM] Ownership verification failed:', error);
    return res.status(500).json({ error: 'Failed to verify agent ownership' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (type, payload) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Send initial status snapshot
  try {
    const statusPayload = await getWhatsAppStatus(agentId);
    sendEvent('status', statusPayload);
  } catch (statusError) {
    console.error('[WHATSAPP-STREAM] Failed to fetch initial status:', statusError);
  }

  const unsubscribe = subscribeToAgentEvents(agentId, (event) => {
    sendEvent(event.type, {
      ...event.payload,
      agentId: event.agentId,
      timestamp: event.timestamp
    });
  });

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

// POST /api/agents/:agentId/verify-whatsapp-connected
router.post('/:agentId/verify-whatsapp-connected', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    // Verify agent ownership
    const agent = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );
    
    if (agent.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const status = await getSessionStatus(agentId);
    
    if (status.status === 'authenticated' || status.status === 'connected') {
      // Update agent status in database
      await pool.query(
        'UPDATE agents SET is_active = true, updated_at = NOW() WHERE id = $1',
        [agentId]
      );
      
      // Update whatsapp_sessions table
      const { supabaseAdmin } = require('../config/supabase');
      await supabaseAdmin
        .from('whatsapp_sessions')
        .update({ 
          is_active: true, 
          phone_number: status.phoneNumber,
          updated_at: new Date()
        })
        .eq('agent_id', agentId);
      
      console.log(`✅ WhatsApp verified for agent ${agentId}: ${status.phoneNumber}`);
      
      return res.json({
        connected: true,
        phoneNumber: status.phoneNumber
      });
    }
    
    res.json({ connected: false });
  } catch (err) {
    console.error('verify-whatsapp-connected error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/:agentId/disconnect-whatsapp
router.get('/:agentId/disconnect-whatsapp', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    // Verify agent ownership
    const agent = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );
    
    if (agent.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { disconnectWhatsApp } = require('../services/baileysService');
    await disconnectWhatsApp(agentId);
    
    // Update database
    await pool.query(
      'UPDATE agents SET is_active = false, updated_at = NOW() WHERE id = $1',
      [agentId]
    );
    
    const { supabaseAdmin } = require('../config/supabase');
    await supabaseAdmin
      .from('whatsapp_sessions')
      .update({ 
        is_active: false, 
        updated_at: new Date()
      })
      .eq('agent_id', agentId);
    
    console.log(`✅ WhatsApp disconnected for agent ${agentId}`);
    
    res.json({ success: true, message: 'WhatsApp disconnected' });
  } catch (err) {
    console.error('disconnect-whatsapp error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;