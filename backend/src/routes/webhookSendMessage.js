const express = require('express');
const rateLimit = require('express-rate-limit');
const { supabaseAdmin } = require('../config/supabase');
const { sendMessage, getWhatsAppStatus, safeInitializeWhatsApp, activeSessions } = require('../services/baileysService');

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

    // ✅ TASK 1: Parse button JSON messages
    // Support both plain text and button object format
    let messagePayload = null;
    let isButtonMessage = false;
    
    if (typeof message === 'string') {
      // Try to parse as JSON (for button messages)
      try {
        const parsed = JSON.parse(message);
        if (parsed && typeof parsed === 'object' && parsed.buttons) {
          // This is a button message
          messagePayload = parsed;
          isButtonMessage = true;
          console.log(`${logPrefix} ✅ Detected button message format`, {
            hasText: !!parsed.text,
            buttonCount: parsed.buttons?.length || 0
          });
        } else {
          // Not a button message, use as plain text
          messagePayload = message.trim();
        }
      } catch (e) {
        // Not JSON, use as plain text
        messagePayload = message.trim();
      }
    } else if (message && typeof message === 'object' && message.buttons) {
      // Already an object with buttons
      messagePayload = message;
      isButtonMessage = true;
      console.log(`${logPrefix} ✅ Detected button message object`, {
        hasText: !!message.text,
        buttonCount: message.buttons?.length || 0
      });
    } else {
      // Invalid format
      messagePayload = null;
    }

    console.log(`${logPrefix} Incoming webhook request`, {
      agentId: agentId ? agentId.substring(0, 8) + '...' : 'missing',
      to: to ? to.substring(0, 10) + '...' : 'missing',
      messageType: isButtonMessage ? 'button' : 'text',
      hasMessage: messagePayload !== null,
      messageLength: typeof messagePayload === 'string' ? messagePayload.length : (messagePayload?.text?.length || 0)
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

    // ✅ TASK 1: Validate message (support both text and button formats)
    if (!messagePayload) {
      console.warn(`${logPrefix} Invalid message`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing message',
        details: 'Message must be a string or a button object with text and buttons array'
      });
    }

    if (isButtonMessage) {
      // Validate button message format
      if (!messagePayload.text || typeof messagePayload.text !== 'string' || messagePayload.text.trim().length === 0) {
        console.warn(`${logPrefix} Button message missing text`);
        return res.status(400).json({
          success: false,
          error: 'Invalid button message',
          details: 'Button messages must include a text field'
        });
      }

      if (!Array.isArray(messagePayload.buttons) || messagePayload.buttons.length === 0) {
        console.warn(`${logPrefix} Button message missing buttons array`);
        return res.status(400).json({
          success: false,
          error: 'Invalid button message',
          details: 'Button messages must include a buttons array with at least one button'
        });
      }

      if (messagePayload.buttons.length > 3) {
        console.warn(`${logPrefix} Too many buttons: ${messagePayload.buttons.length}`);
        return res.status(400).json({
          success: false,
          error: 'Too many buttons',
          details: 'WhatsApp supports a maximum of 3 buttons per message'
        });
      }

      // Validate each button
      for (let i = 0; i < messagePayload.buttons.length; i++) {
        const button = messagePayload.buttons[i];
        if (!button.id || typeof button.id !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'Invalid button',
            details: `Button ${i + 1} must have an id (string)`
          });
        }
        if (!button.text || typeof button.text !== 'string' || button.text.trim().length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Invalid button',
            details: `Button ${i + 1} must have a text (string)`
          });
        }
        if (button.text.length > 20) {
          return res.status(400).json({
            success: false,
            error: 'Button text too long',
            details: `Button ${i + 1} text must be 20 characters or less`
          });
        }
      }

      if (messagePayload.text.length > MAX_MESSAGE_LENGTH) {
        console.warn(`${logPrefix} Button message text too long: ${messagePayload.text.length} chars`);
        return res.status(400).json({
          success: false,
          error: 'Message text too long',
          details: `Message text must be less than ${MAX_MESSAGE_LENGTH} characters (WhatsApp limit)`
        });
      }
    } else {
      // Validate plain text message
      if (typeof messagePayload !== 'string' || messagePayload.trim().length === 0) {
        console.warn(`${logPrefix} Invalid message`);
        return res.status(400).json({
          success: false,
          error: 'Invalid or missing message',
          details: 'Message cannot be empty'
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

    // ✅ CRITICAL FIX: Store dashboard message BEFORE checking WhatsApp connection
    // This ensures the message is stored even if WhatsApp is disconnected
    let dashboardMessageId = null;
    console.log(`${logPrefix} 🔍 Starting dashboard message storage...`, {
      agentId: agentId.substring(0, 8) + '...',
      isButtonMessage,
      hasMessagePayload: !!messagePayload
    });
    
    try {
      const { data: agentDataForStorage, error: agentDataError } = await supabaseAdmin
        .from('agents')
        .select('user_id, whatsapp_phone_number')
        .eq('id', agentId)
        .single();

      console.log(`${logPrefix} 🔍 Agent data lookup for storage:`, {
        hasAgentData: !!agentDataForStorage,
        hasError: !!agentDataError,
        hasUserId: !!agentDataForStorage?.user_id,
        hasPhone: !!agentDataForStorage?.whatsapp_phone_number
      });

      if (agentDataForStorage && agentDataForStorage.user_id && agentDataForStorage.whatsapp_phone_number) {
        const now = new Date().toISOString();
        const agentMessageId = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        
        // Format button message for dashboard display
        let dashboardMessage = isButtonMessage ? messagePayload.text : messagePayload;
        
        if (isButtonMessage && Array.isArray(messagePayload.buttons)) {
          const buttonLines = messagePayload.buttons.map((btn, index) => {
            const buttonNumber = index + 1;
            return `*${buttonNumber} ${btn.text}*`;
          }).join('\n');
          
          dashboardMessage = `${messagePayload.text}\n\n${buttonLines}`;
          
          console.log(`${logPrefix} 📝 Formatted button message for dashboard:`, {
            originalText: messagePayload.text,
            buttonCount: messagePayload.buttons.length,
            formattedLength: dashboardMessage.length,
            formattedMessage: dashboardMessage.substring(0, 200)
          });
        }
        
        const insertPayload = {
          message_id: agentMessageId,
          conversation_id: `${agentDataForStorage.whatsapp_phone_number}@s.whatsapp.net`,
          sender_phone: agentDataForStorage.whatsapp_phone_number,
          agent_id: agentId,
          user_id: agentDataForStorage.user_id,
          message_text: dashboardMessage,
          received_at: now,
          created_at: now,
          message_type: 'text',
          source: 'dashboard',
          sender_type: 'agent',
          is_from_me: false,
          status: 'delivered',
        };

        console.log(`${logPrefix} 🔍 Attempting database insert:`, {
          message_id: insertPayload.message_id,
          source: insertPayload.source,
          sender_type: insertPayload.sender_type,
          messagePreview: insertPayload.message_text.substring(0, 100)
        });

        const { data: insertedData, error: insertError } = await supabaseAdmin
          .from('message_log')
          .insert(insertPayload)
          .select()
          .single();

        if (insertError) {
          console.error(`${logPrefix} ❌ Failed to store agent response in database:`, {
            error: insertError.message,
            code: insertError.code,
            details: insertError.details,
            hint: insertError.hint
          });
        } else {
          dashboardMessageId = insertedData?.id || insertedData?.message_id;
          console.log(`${logPrefix} ✅ Agent response stored in database:`, {
            id: dashboardMessageId,
            message_id: insertedData?.message_id,
            source: insertedData?.source,
            sender_type: insertedData?.sender_type,
            messagePreview: (insertedData?.message_text || '').substring(0, 100)
          });
        }
      } else {
        console.warn(`${logPrefix} ⚠️  Cannot store agent response:`, {
          hasAgentData: !!agentDataForStorage,
          hasUserId: !!agentDataForStorage?.user_id,
          hasPhone: !!agentDataForStorage?.whatsapp_phone_number
        });
      }
    } catch (dbError) {
      console.error(`${logPrefix} ❌ Error storing agent response:`, dbError.message);
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

    // ✅ TASK 1: Send message via Baileys (supports both text and button messages)
    try {
      await sendMessage(agentId, sanitizedTo, messagePayload, isButtonMessage);
      
      console.log(`${logPrefix} ✅ Message sent successfully`, {
        agentId: agentId.substring(0, 8) + '...',
        to: sanitizedTo.substring(0, 10) + '...',
        messageType: isButtonMessage ? 'button' : 'text',
        messageLength: isButtonMessage ? messagePayload.text.length : messagePayload.length,
        buttonCount: isButtonMessage ? messagePayload.buttons.length : 0,
        dashboardMessageId: dashboardMessageId
      });

      return res.status(200).json({
        success: true,
        message: 'Message sent successfully',
        data: {
          agentId,
          to: sanitizedTo,
          sentAt: new Date().toISOString()
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
 * ✅ TASK 5: Test endpoint for button message validation
 * GET /api/webhooks/send-message/test
 * Returns example payloads for testing
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Button message test endpoint',
    examples: {
      plainText: {
        agentId: 'b361a914-18bb-405c-92eb-8afe549ca9e1',
        to: '923336906200',
        message: 'Hello! This is a plain text message.'
      },
      buttonMessage: {
        agentId: 'b361a914-18bb-405c-92eb-8afe549ca9e1',
        to: '923336906200',
        message: {
          text: '👋 Welcome! Please choose an option:',
          buttons: [
            { id: 'option_1', text: 'Option 1' },
            { id: 'option_2', text: 'Option 2' },
            { id: 'option_3', text: 'Option 3' }
          ]
        }
      },
      buttonMessageJSON: {
        agentId: 'b361a914-18bb-405c-92eb-8afe549ca9e1',
        to: '923336906200',
        message: JSON.stringify({
          text: '👋 Welcome! Please choose an option:',
          buttons: [
            { id: 'option_1', text: 'Option 1' },
            { id: 'option_2', text: 'Option 2' },
            { id: 'option_3', text: 'Option 3' }
          ]
        })
      }
    },
    buttonResponseFormat: {
      description: 'When a user clicks a button, your webhook will receive:',
      payload: {
        id: 'message-id',
        messageId: 'message-id',
        from: '923336906200',
        to: 'agent-phone-number',
        messageType: 'BUTTON_RESPONSE',
        type: 'button_response',
        content: 'Option 1', // The button text
        buttonResponse: {
          selectedButtonId: 'option_1',
          selectedButtonText: 'Option 1',
          contextInfo: {}
        },
        timestamp: '2025-12-17T10:00:00.000Z'
      }
    },
    validation: {
      maxButtons: 3,
      maxButtonTextLength: 20,
      maxMessageTextLength: 4096
    }
  });
});

module.exports = router;

