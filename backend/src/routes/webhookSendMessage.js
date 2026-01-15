const express = require('express');
const rateLimit = require('express-rate-limit');
const { supabaseAdmin } = require('../config/supabase');
const { sendMessage, getWhatsAppStatus, safeInitializeWhatsApp, activeSessions, isNumberOnWhatsApp } = require('../services/baileysService');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 4096; // WhatsApp message limit

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many webhook requests, please retry later'
  }
});

router.use(webhookLimiter);

/**
 * Sanitize phone number - remove non-digits, keep only numbers
 */
function sanitizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/**
 * POST /api/webhooks/send-message
 * Public webhook endpoint for N8N to send WhatsApp messages
 * 
 * Request Body:
 * {
 *   "agentId": "uuid",
 *   "to": "phone-number",
 *   "message": "message text"
 * }
 */
router.post('/', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `send-${Date.now()}`;
  const logPrefix = `[WEBHOOK-SEND-MESSAGE][${requestId}]`;

  try {
    let { agentId, to, message } = req.body || {};

    // Validate and process message as plain text string
    let messagePayload = null;
    
    if (typeof message === 'string') {
      messagePayload = message.trim();
    } else {
      messagePayload = null;
    }

    console.log(`${logPrefix} Incoming webhook request`, {
      agentId: agentId ? agentId.substring(0, 8) + '...' : 'missing',
      to: to ? to.substring(0, 10) + '...' : 'missing',
      hasMessage: messagePayload !== null,
      messageLength: messagePayload ? messagePayload.length : 0
    });

    // Validate agentId
    if (!agentId || typeof agentId !== 'string' || !UUID_REGEX.test(agentId)) {
      console.warn(`${logPrefix} Invalid agentId`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing agentId',
        details: 'agentId must be a valid UUID'
      });
    }

    // Validate phone number
    const sanitizedTo = sanitizePhoneNumber(to);
    if (!sanitizedTo || sanitizedTo.length < 10) {
      console.warn(`${logPrefix} Invalid phone number: ${to}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing phone number',
        details: 'Phone number must contain at least 10 digits'
      });
    }

    // ✅ NEW: Check if number is on WhatsApp BEFORE attempting to send
    try {
      console.log(`${logPrefix} 🔍 Validating if number is on WhatsApp...`);
      const whatsappCheck = await isNumberOnWhatsApp(agentId, sanitizedTo);
      
      if (!whatsappCheck.isOnWhatsApp) {
        console.warn(`${logPrefix} ⚠️ Number not on WhatsApp: ${sanitizedTo.substring(0, 8)}...`);
        
        // Return 200 status with success: false
        return res.status(200).json({
          success: false,
          error: 'NUMBER_NOT_ON_WHATSAPP',
          errorType: 'NUMBER_NOT_ON_WHATSAPP',
          details: `The number ${sanitizedTo} is not registered on WhatsApp`,
          message: `I couldn't send your message because ${sanitizedTo} is not registered on WhatsApp. Ask them to register on WhatsApp first`,
          phoneNumber: sanitizedTo,
          timestamp: new Date().toISOString()
        });
      }
      
      console.log(`${logPrefix} ✅ Number verified on WhatsApp: ${sanitizedTo.substring(0, 8)}...`);
    } catch (validationError) {
      // Handle rate limiting
      if (validationError.message.includes('Rate limit')) {
        console.warn(`${logPrefix} ⚠️ Validation rate limit exceeded`);
        return res.status(200).json({
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          errorType: 'RATE_LIMIT_EXCEEDED',
          details: 'Too many validation requests. Please try again in a moment.',
          message: 'I\'ve checked too many numbers recently. Please wait about a minute and try again.',
          retryAfter: 60,
          timestamp: new Date().toISOString()
        });
      }
      
      // For other validation errors, log but continue with sending
      // This prevents false negatives from blocking legitimate messages
      console.error(`${logPrefix} ⚠️ WhatsApp validation error (continuing anyway):`, validationError.message);
      // Continue with sending - validation is a nice-to-have, not a blocker
    }

    // Validate message
    if (!messagePayload || typeof messagePayload !== 'string' || messagePayload.trim().length === 0) {
      console.warn(`${logPrefix} Invalid message`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing message',
        details: 'Message must be a non-empty string'
      });
    }

    if (messagePayload.length > MAX_MESSAGE_LENGTH) {
      console.warn(`${logPrefix} Message too long: ${messagePayload.length} chars`);
      return res.status(400).json({
        success: false,
        error: 'Message too long',
        details: `Message must be less than ${MAX_MESSAGE_LENGTH} characters (WhatsApp limit)`
      });
    }

    // Verify agent exists in database
    const { data: agentData, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, agent_name')
      .eq('id', agentId)
      .maybeSingle();

    if (agentError) {
      console.error(`${logPrefix} Database error fetching agent:`, agentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to verify agent',
        details: 'Database error'
      });
    }

    if (!agentData) {
      console.warn(`${logPrefix} Agent not found: ${agentId}`);
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
        details: `No agent found with ID: ${agentId}`
      });
    }

    // Check WhatsApp connection status
    const statusResult = await getWhatsAppStatus(agentId);
    const session = activeSessions.get(agentId);
    
    if (!statusResult.connected || !statusResult.is_active || !session || !session.isConnected) {
      // CRITICAL: Check session status BEFORE attempting reconnection
      // This prevents automatic reconnection after 401 errors (device_removed conflicts)
      const { data: whatsappSession } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('status, is_active')
        .eq('agent_id', agentId)
        .maybeSingle();
      
      // If status is 'conflict', it means a 401 error occurred (device_removed)
      // Don't attempt automatic reconnection - require manual action
      if (whatsappSession?.status === 'conflict') {
        console.warn(`${logPrefix} 🚫 Session has conflict status (401 error/device_removed) - manual reconnection required`);
        return res.status(503).json({
          success: false,
          error: 'SESSION_CONFLICT',
          details: 'WhatsApp session was disconnected due to device removal or conflict. Please manually reconnect the agent and scan a new QR code.',
          action_required: 'manual_reconnect',
          status: 'conflict'
        });
      }
      
      console.warn(`${logPrefix} ⚠️  Agent not connected, attempting to reconnect...`);
      
      // Get user_id from database
      const { data: agentWithUser } = await supabaseAdmin
        .from('agents')
        .select('user_id')
        .eq('id', agentId)
        .single();
      
      if (!agentWithUser) {
        return res.status(404).json({
          success: false,
          error: 'AGENT_NOT_FOUND',
          details: 'Agent not found in database'
        });
      }
      
      // Attempt to reconnect using safeInitializeWhatsApp (respects cooldowns and conflict checks)
      try {
        console.log(`${logPrefix} 🔄 Initiating reconnection...`);
        const reconnectResult = await safeInitializeWhatsApp(agentId, agentWithUser.user_id);
        
        // Check if reconnection was blocked due to cooldown or conflict
        if (!reconnectResult.success) {
          if (reconnectResult.status === 'conflict' || reconnectResult.status === 'cooldown') {
            return res.status(503).json({
              success: false,
              error: reconnectResult.status === 'conflict' ? 'SESSION_CONFLICT' : 'COOLDOWN_ACTIVE',
              details: reconnectResult.error || 'Reconnection blocked due to recent error or cooldown period',
              action_required: reconnectResult.requiresManualAction ? 'manual_reconnect' : 'wait',
              retryAfter: reconnectResult.retryAfter,
              status: reconnectResult.status
            });
          }
          
          // Other failure reasons
          return res.status(503).json({
            success: false,
            error: 'RECONNECTION_FAILED',
            details: reconnectResult.error || 'Failed to reconnect WhatsApp',
            action_required: 'scan_qr',
            status: reconnectResult.status
          });
        }
        
        // ✅ CRITICAL: Check the status immediately - if it's qr_pending, we can't send messages yet
        if (reconnectResult.status === 'qr_pending') {
          // Get the QR code from status
          const statusWithQR = await getWhatsAppStatus(agentId);
          return res.status(503).json({
            success: false,
            error: 'QR_CODE_REQUIRED',
            details: 'WhatsApp reconnection requires QR code scanning. Please scan the QR code to connect.',
            action_required: 'scan_qr',
            status: 'qr_pending',
            qr_code: statusWithQR.qr_code
          });
        }
        
        // If status is 'connected', we can proceed immediately
        // Otherwise, wait a bit for connection to establish
        if (reconnectResult.status !== 'connected') {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        // Check if now connected
        const reconnectedStatus = await getWhatsAppStatus(agentId);
        const reconnectedSession = activeSessions.get(agentId);
        
        // Check if connection is established
        if (!reconnectedStatus.connected || !reconnectedStatus.is_active || !reconnectedSession || !reconnectedSession.isConnected) {
          // Provide more specific error based on status
          const errorMessage = reconnectedStatus.status === 'connecting' 
            ? 'WhatsApp is still connecting. Please wait a moment and try again.'
            : reconnectedStatus.status === 'conflict'
            ? 'WhatsApp session conflict detected. Please manually reconnect the agent.'
            : reconnectedStatus.status === 'qr_pending'
            ? 'WhatsApp requires QR code scanning. Please scan the QR code to connect.'
            : 'Failed to reconnect WhatsApp. Please check the agent connection status.';
          
          return res.status(503).json({
            success: false,
            error: reconnectedStatus.status === 'qr_pending' ? 'QR_CODE_REQUIRED' : 'RECONNECTION_FAILED',
            details: errorMessage,
            action_required: reconnectedStatus.status === 'conflict' ? 'manual_reconnect' : 'scan_qr',
            status: reconnectedStatus.status,
            qr_code: reconnectedStatus.qr_code || null
          });
        }
        
        console.log(`${logPrefix} ✅ Reconnected successfully`);
      } catch (reconnectError) {
        console.error(`${logPrefix} ❌ Reconnection error:`, reconnectError);
        return res.status(503).json({
          success: false,
          error: 'RECONNECTION_ERROR',
          details: reconnectError.message
        });
      }
    }

    // Get user_id from agent for message_log insertion
    const { data: agentWithUser, error: userError } = await supabaseAdmin
      .from('agents')
      .select('user_id, whatsapp_phone_number')
      .eq('id', agentId)
      .single();

    if (userError || !agentWithUser) {
      console.error(`${logPrefix} ❌ Failed to fetch agent user_id:`, userError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch agent information',
        details: 'Could not retrieve user_id for message logging'
      });
    }

    // Send message via Baileys
    try {
      await sendMessage(agentId, sanitizedTo, messagePayload);
      
      console.log(`${logPrefix} ✅ Message sent successfully`, {
        agentId: agentId.substring(0, 8) + '...',
        to: sanitizedTo.substring(0, 10) + '...',
        messageLength: messagePayload.length
      });

      // CRITICAL: Save agent response to message_log table so it appears in chat interface
      // This ensures AI responses are immediately visible in the dashboard chat
      const now = new Date().toISOString();
      const agentMessageId = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      const agentPhoneNumber = agentWithUser.whatsapp_phone_number 
        ? agentWithUser.whatsapp_phone_number.replace(/[+\s-]/g, '') 
        : sanitizedTo;
      
      const conversationId = `${agentPhoneNumber}@s.whatsapp.net`;
      
      // Check for duplicate message before inserting (prevent duplicates if message comes back through WhatsApp)
      const timeWindow = 10000; // 10 seconds window
      const duplicateCheckStart = new Date(new Date(now).getTime() - timeWindow).toISOString();
      const duplicateCheckEnd = new Date(new Date(now).getTime() + timeWindow).toISOString();
      
      const { data: existingMessage } = await supabaseAdmin
        .from('message_log')
        .select('id, message_id')
        .eq('agent_id', agentId)
        .eq('message_text', messagePayload.trim())
        .eq('conversation_id', conversationId)
        .eq('sender_phone', agentPhoneNumber)
        .eq('sender_type', 'agent')
        .gte('received_at', duplicateCheckStart)
        .lte('received_at', duplicateCheckEnd)
        .maybeSingle();
      
      if (existingMessage) {
        console.log(`${logPrefix} ⚠️ Duplicate agent message detected, skipping insert:`, {
          existingId: existingMessage.id,
          existingMessageId: existingMessage.message_id
        });
        // Return success but don't insert duplicate
        return res.status(200).json({
          success: true,
          message: 'Message sent successfully (duplicate detected, not saved)',
          data: {
            agentId,
            to: sanitizedTo,
            sentAt: now,
            messageId: existingMessage.id || existingMessage.message_id || agentMessageId,
            duplicate: true
          }
        });
      }
      
      // Insert agent response into message_log
      const { data: savedMessage, error: insertError } = await supabaseAdmin
        .from('message_log')
        .insert({
          message_id: agentMessageId,
          conversation_id: conversationId,
          sender_phone: agentPhoneNumber,
          agent_id: agentId,
          user_id: agentWithUser.user_id,
          message_text: messagePayload,
          message: messagePayload, // New column
          received_at: now,
          created_at: now,
          timestamp: now, // New column
          message_type: 'text',
          sender_type: 'agent', // CRITICAL: Mark as agent message
          is_from_me: false, // CRITICAL: Agent messages are not from user
          status: 'sent',
          source: 'webhook', // Mark as coming from webhook (AI response)
        })
        .select()
        .single();

      if (insertError) {
        // If new columns don't exist, try with legacy columns only
        if (insertError.message && insertError.message.includes('column')) {
          console.log(`${logPrefix} ⚠️ New columns not available, using legacy columns only`);
          const { error: legacyError } = await supabaseAdmin
            .from('message_log')
            .insert({
              message_id: agentMessageId,
              conversation_id: conversationId,
              sender_phone: agentPhoneNumber,
              agent_id: agentId,
              user_id: agentWithUser.user_id,
              message_text: messagePayload,
              received_at: now,
              created_at: now,
              message_type: 'text',
              sender_type: 'agent',
              is_from_me: false,
              source: 'webhook',
            });
          
          if (legacyError) {
            console.error(`${logPrefix} ❌ Failed to save agent message to database:`, legacyError);
            // Don't fail the request - message was sent successfully via WhatsApp
            // It will be saved when it comes back through messages.upsert
          } else {
            console.log(`${logPrefix} ✅ Agent message saved to database (legacy columns)`);
          }
        } else {
          console.error(`${logPrefix} ❌ Failed to save agent message to database:`, insertError);
          // Don't fail the request - message was sent successfully via WhatsApp
        }
      } else {
        console.log(`${logPrefix} ✅ Agent message saved to database:`, {
          messageId: savedMessage?.id || savedMessage?.uuid_id || agentMessageId,
          senderType: 'agent'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Message sent successfully',
        data: {
          agentId,
          to: sanitizedTo,
          sentAt: now,
          messageId: savedMessage?.id || savedMessage?.uuid_id || agentMessageId
        }
      });
    } catch (sendError) {
      console.error(`${logPrefix} ❌ Failed to send message:`, sendError.message);
      
      // Check if it's a connection error
      if (sendError.message.includes('not connected')) {
        return res.status(400).json({
          success: false,
          error: 'WhatsApp connection lost',
          details: 'The WhatsApp session was disconnected. Please reconnect the agent.',
          status: statusResult.status
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to send message',
        details: sendError.message
      });
    }

  } catch (error) {
    console.error(`${logPrefix} ❌ Unexpected error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * GET /api/webhooks/send-message/test
 * Returns example payloads for testing
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Send message webhook test endpoint',
    endpoint: '/api/webhooks/send-message',
    method: 'POST',
    examples: {
      basicMessage: {
        agentId: 'b361a914-18bb-405c-92eb-8afe549ca9e1',
        to: '923336906200',
        message: 'Hello! This is a plain text message.'
      },
      longMessage: {
        agentId: 'b361a914-18bb-405c-92eb-8afe549ca9e1',
        to: '923336906200',
        message: 'This is a longer message that can contain multiple lines.\n\nIt supports newlines and formatting as plain text.'
      }
    },
    validation: {
      maxMessageTextLength: MAX_MESSAGE_LENGTH,
      requiredFields: ['agentId', 'to', 'message']
    },
    curlExample: `curl -X POST https://pa.duhanashrah.ai/api/webhooks/send-message \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "your-agent-id-here",
    "to": "923336906200",
    "message": "Hello! This is a test message."
  }'`
  });
});

module.exports = router;

