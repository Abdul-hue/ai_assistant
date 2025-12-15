const express = require('express');
const multer = require('multer');
const pino = require('pino');
const { authMiddleware } = require('../middleware/auth');
const pool = require('../database'); // DEPRECATED: Use supabase SDK directly for new code
const { supabase } = require('../database'); // Direct Supabase SDK access
const { supabaseAdmin } = require('../config/supabase');
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

// Agent Avatar Management (MUST BE BEFORE /:id route to avoid conflicts)
const AGENT_AVATAR_BUCKET = 'agent_avator';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];

let agentAvatarBucketChecked = false;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Unsupported file type. Please upload jpg, jpeg, png, gif, or webp images.'));
  },
});

async function ensureAgentAvatarBucket() {
  if (agentAvatarBucketChecked) {
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.storage.getBucket(AGENT_AVATAR_BUCKET);
    if (!error && data) {
      agentAvatarBucketChecked = true;
      return;
    }
  } catch (error) {
    console.warn('[AGENT AVATAR] Bucket lookup failed, attempting creation');
  }

  try {
    const { error: createError } = await supabaseAdmin.storage.createBucket(AGENT_AVATAR_BUCKET, {
      public: true,
    });

    if (createError && !createError.message?.toLowerCase().includes('already exists')) {
      console.error('[AGENT AVATAR] Failed to create agent_avator bucket');
      throw createError;
    }
    agentAvatarBucketChecked = true;
  } catch (error) {
    console.error('[AGENT AVATAR] Unable to ensure agent avatar bucket');
    throw error;
  }
}

function buildAgentAvatarFileName(agentId, originalName, mimetype) {
  const timestamp = Date.now();
  const extension =
    originalName?.split('.').pop()?.toLowerCase() ||
    mimetype?.split('/').pop() ||
    'jpg';
  // Use format: {agent_id}_avatar_{timestamp}.{extension}
  return `${agentId}_avatar_${timestamp}.${extension}`;
}

function extractAgentAvatarStoragePath(url) {
  if (!url) return null;
  const marker = `${AGENT_AVATAR_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return url.substring(index + marker.length);
}

// POST /api/agents/:agentId/avatar - Upload agent avatar (MUST BE BEFORE /:id)
router.post('/:agentId/avatar', authMiddleware, validateUUID('agentId'), upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No avatar file uploaded' });
    }

    const { agentId } = req.params;
    const userId = req.user.id;

    // Verify agent ownership
    const agentResult = await pool.query(
      'SELECT id, avatar_url FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agentResult.rows[0];

    await ensureAgentAvatarBucket();

    const filename = buildAgentAvatarFileName(agentId, req.file.originalname, req.file.mimetype);

    const { error: uploadError } = await supabaseAdmin.storage
      .from(AGENT_AVATAR_BUCKET)
      .upload(filename, req.file.buffer, {
        cacheControl: '3600',
        upsert: true,
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      console.error('[AGENT AVATAR] ❌ Failed to upload avatar:', uploadError.message);
      return res.status(500).json({ error: 'Failed to upload avatar' });
    }

    const { data: publicData } = supabaseAdmin.storage.from(AGENT_AVATAR_BUCKET).getPublicUrl(filename);
    const avatarUrl = publicData?.publicUrl || null;

    if (!avatarUrl) {
      return res.status(500).json({ error: 'Failed to generate avatar URL' });
    }

    // Delete old avatar if exists
    if (agent.avatar_url) {
      const oldPath = extractAgentAvatarStoragePath(agent.avatar_url);
      if (oldPath) {
        await supabaseAdmin.storage.from(AGENT_AVATAR_BUCKET).remove([oldPath]);
      }
    }

    // Update agent with new avatar URL - use Supabase to ensure consistency
    const { data: updatedAgent, error: updateError } = await supabaseAdmin
      .from('agents')
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', agentId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError || !updatedAgent) {
      console.error('[AGENT AVATAR] ❌ Failed to update agent:', updateError);
      return res.status(500).json({ error: 'Failed to update agent' });
    }

    console.log(`✅ Agent avatar uploaded for agent ${agentId}`);
    res.json({ avatar_url: avatarUrl, agent: updatedAgent });
  } catch (error) {
    console.error('[AGENT AVATAR] ❌ Failed to upload avatar:', error.message);
    const status = error.message?.includes('Unsupported file type') ? 400 : 500;
    res.status(status).json({ error: error.message || 'Failed to upload avatar' });
  }
});

// DELETE /api/agents/:agentId/avatar - Delete agent avatar (MUST BE BEFORE /:id)
router.delete('/:agentId/avatar', authMiddleware, validateUUID('agentId'), async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    // Verify agent ownership and get avatar URL
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, avatar_url')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (agentError || !agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Delete avatar from storage if exists
    if (agent.avatar_url) {
      const path = extractAgentAvatarStoragePath(agent.avatar_url);
      if (path) {
        await supabaseAdmin.storage.from(AGENT_AVATAR_BUCKET).remove([path]);
      }
    }

    // Update agent to remove avatar URL
    const { error: updateError } = await supabaseAdmin
      .from('agents')
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq('id', agentId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('[AGENT AVATAR] ❌ Failed to delete avatar:', updateError);
      return res.status(500).json({ error: 'Failed to delete avatar' });
    }

    console.log(`✅ Agent avatar deleted for agent ${agentId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[AGENT AVATAR] ❌ Failed to delete avatar:', error.message);
    res.status(500).json({ error: 'Failed to delete avatar' });
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

    // Integration endpoints are stored in the agents.integration_endpoints JSONB column
    // No separate query needed - they're already in agentData

    // Build statistics object
    const statistics = {
      total_messages: totalMessages || 0,
      last_message_at: lastMessageData?.received_at || null,
      last_message_text: lastMessageData?.message_text || null,
      unprocessed_messages: unprocessedMessages || 0
    };

    // Build complete response
    // integration_endpoints are already in agentData.integration_endpoints (JSONB column)
    const response = {
      agent: {
        ...agentData,
        whatsapp_session: whatsappSession,
        // integration_endpoints is already in agentData from the JSONB column
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

// GET /api/agents/:id/debug-connection
// Diagnostic endpoint to check connection status
router.get('/:id/debug-connection', authMiddleware, validateUUID('id'), async (req, res) => {
  try {
    const { id: agentId } = req.params;
    const userId = req.user.id;
    
    // Verify agent belongs to user
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('id, user_id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();
    
    if (agentError || !agentData) {
      return res.status(404).json({
        status: 'not_found',
        message: 'Agent not found or you do not have access to it'
      });
    }
    
    // Check in-memory session
    const { activeSessions, getWhatsAppStatus } = require('../services/baileysService');
    const session = activeSessions.get(agentId);
    
    // Check database
    const { data: dbSession } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    // Get status
    const statusResult = await getWhatsAppStatus(agentId);
    
    if (!session) {
      return res.json({
        status: 'not_found',
        message: 'Agent not in active sessions',
        in_memory: false,
        database_state: {
          status: dbSession?.status,
          is_active: dbSession?.is_active,
          phone_number: dbSession?.phone_number,
          last_error: dbSession?.last_error,
          last_heartbeat: dbSession?.last_heartbeat
        },
        recommendation: 'Call /api/agents/:id/init-whatsapp to connect'
      });
    }
    
    res.json({
      status: 'found',
      in_memory: true,
      memory_state: {
        is_connected: session.isConnected || false,
        connection_state: session.connectionState || 'unknown',
        phone_number: session.phoneNumber || null,
        socket_age_ms: session.socketCreatedAt ? Date.now() - session.socketCreatedAt : null,
        last_activity_ms: session.lastActivity ? Date.now() - session.lastActivity : null,
        reconnect_attempts: session.reconnectAttempts || 0
      },
      database_state: {
        status: dbSession?.status,
        is_active: dbSession?.is_active,
        phone_number: dbSession?.phone_number,
        last_error: dbSession?.last_error,
        last_heartbeat: dbSession?.last_heartbeat
      },
      status_result: {
        connected: statusResult.connected,
        is_active: statusResult.is_active,
        status: statusResult.status
      },
      recommendation: !session.isConnected ? 'Connection lost - needs reconnection' : 'Connected and healthy'
    });
  } catch (error) {
    console.error('[DEBUG-CONNECTION] Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// PUT /api/agents/:id (update agent configuration)
// SECURITY: Input validation with Zod
router.put('/:id', authMiddleware, validateUUID('id'), (req, res, next) => {
  // Log incoming request before validation
  console.log('📥 [UPDATE-AGENT] Incoming request:', {
    method: req.method,
    path: req.path,
    agentId: req.params.id,
    userId: req.user?.id,
    body: JSON.stringify(req.body, null, 2),
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, validate(updateAgentSchema), async (req, res) => {
  try {
    const agentId = req.params.id;
    const userId = req.user.id;
    
    console.log('✅ [UPDATE-AGENT] Validation passed, processing update:', {
      agentId,
      userId,
      validatedBody: JSON.stringify(req.body, null, 2),
    });
    
    const {
      name, agent_name, persona, avatar_url, description, systemPrompt, webhookUrl,
      enableChatHistory, erpCrsData, featureToggles,
      integrationEndpoints, isActive,
      ownerName, ownerPhone, timezone, webhookEnabled,
    } = req.body;

    // Verify agent belongs to user
    const { data: existingAgent, error: fetchError } = await supabase
      .from('agents')
      .select('id, user_id, agent_name, persona, avatar_url')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingAgent) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Agent not found or you do not have permission to edit it',
      });
    }

    // Prepare update object (only include provided fields)
    const updateData = {};
    
    // Handle agent_name - support both 'name' and 'agent_name' for backward compatibility
    if (agent_name !== undefined) {
      const trimmedName = String(agent_name).trim();
      if (trimmedName === '') {
        return res.status(400).json({ error: 'Agent name cannot be empty' });
      }
      updateData.agent_name = trimmedName;
      console.log('[UPDATE-AGENT] Will update agent_name to:', trimmedName);
    } else if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (trimmedName === '') {
        return res.status(400).json({ error: 'Agent name cannot be empty' });
      }
      updateData.agent_name = trimmedName;
      console.log('[UPDATE-AGENT] Will update agent_name (from name field) to:', trimmedName);
    }
    
    // Handle persona
    if (persona !== undefined) {
      updateData.persona = persona !== null && persona !== '' ? String(persona).trim() : null;
      console.log('[UPDATE-AGENT] Will update persona to:', updateData.persona);
    }
    
    // Handle avatar_url
    if (avatar_url !== undefined) {
      updateData.avatar_url = avatar_url !== null && avatar_url !== '' ? String(avatar_url).trim() : null;
      console.log('[UPDATE-AGENT] Will update avatar_url');
    }
    if (description !== undefined) updateData.description = description;
    if (systemPrompt !== undefined) updateData.initial_prompt = systemPrompt; // Use initial_prompt (actual column name)
    if (webhookUrl !== undefined) updateData.webhook_url = webhookUrl || null;
    if (enableChatHistory !== undefined) updateData.enable_chat_history = enableChatHistory;
    if (erpCrsData !== undefined) updateData.company_data = erpCrsData;
    if (featureToggles !== undefined) updateData.feature_toggles = featureToggles;
    if (isActive !== undefined) updateData.is_active = isActive;
    if (ownerName !== undefined) updateData.agent_owner_name = ownerName || null;
    if (ownerPhone !== undefined) updateData.agent_phone_number = ownerPhone || null;
    if (timezone !== undefined) updateData.timezone = timezone || null;
    if (webhookEnabled !== undefined) updateData.webhook_enabled = webhookEnabled;
    
    // Handle integration endpoints - store in JSONB column
    if (integrationEndpoints !== undefined) {
      // Transform endpoints to match the expected format
      const endpointsToStore = Array.isArray(integrationEndpoints) && integrationEndpoints.length > 0
        ? integrationEndpoints.map(ep => ({
            id: ep.id || require('crypto').randomUUID(),
            name: ep.name,
            url: ep.url,
            method: ep.method || 'POST',
            headers: ep.headers || {},
          }))
        : [];
      
      // Update the integration_endpoints JSONB column
      updateData.integration_endpoints = endpointsToStore;
    }
    
    updateData.updated_at = new Date().toISOString();

    // Update agent
    const { data: updatedAgent, error: updateError } = await supabase
      .from('agents')
      .update(updateData)
      .eq('id', agentId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Error updating agent:', updateError);
      return res.status(500).json({
        error: 'UPDATE_FAILED',
        message: 'Failed to update agent',
      });
    }

    // Handle integration endpoints - store in JSONB column
    if (integrationEndpoints !== undefined) {
      // Transform endpoints to match the expected format
      const endpointsToStore = Array.isArray(integrationEndpoints) && integrationEndpoints.length > 0
        ? integrationEndpoints.map(ep => ({
            id: ep.id || require('crypto').randomUUID(),
            name: ep.name,
            url: ep.url,
            method: ep.method || 'POST',
            headers: ep.headers || {},
          }))
        : [];
      
      // Update the integration_endpoints JSONB column
      updateData.integration_endpoints = endpointsToStore;
    }

    // Fetch complete agent data (integration_endpoints are in the JSONB column)
    const { data: completeAgent, error: fetchCompleteError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();

    if (fetchCompleteError) {
      console.error('❌ Error fetching complete agent data:', fetchCompleteError);
      // Still return the updated agent even if we can't fetch it again
      return res.json({
        success: true,
        data: updatedAgent,
        message: 'Agent updated successfully',
      });
    }

    // Integration endpoints are already in the completeAgent.integration_endpoints JSONB column
    const responseData = completeAgent;

    res.json({
      success: true,
      data: responseData,
      message: 'Agent updated successfully',
    });
  } catch (error) {
    console.error('❌ Error in update agent route:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to update agent',
    });
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

// NOTE: The PUT /:id route above now handles agent_name, persona, and avatar_url
// All agent updates (including profile updates) go through the main PUT /:id route

module.exports = router;