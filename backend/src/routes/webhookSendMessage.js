const express = require('express');
const rateLimit = require('express-rate-limit');
const { supabaseAdmin } = require('../config/supabase');
const { sendMessage, getWhatsAppStatus } = require('../services/baileysService');

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
    const { agentId, to, message } = req.body || {};

    console.log(`${logPrefix} Incoming webhook request`, {
      agentId: agentId ? agentId.substring(0, 8) + '...' : 'missing',
      to: to ? to.substring(0, 10) + '...' : 'missing',
      hasMessage: typeof message === 'string',
      messageLength: typeof message === 'string' ? message.length : 0
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

    // Validate message
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.warn(`${logPrefix} Invalid message`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing message',
        details: 'Message cannot be empty'
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      console.warn(`${logPrefix} Message too long: ${message.length} chars`);
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
    
    if (!statusResult.connected || !statusResult.is_active) {
      console.warn(`${logPrefix} WhatsApp not connected for agent ${agentId}`);
      return res.status(400).json({
        success: false,
        error: 'WhatsApp not connected',
        details: `Agent ${agentData.agent_name} is not connected to WhatsApp. Status: ${statusResult.status}`,
        status: statusResult.status
      });
    }

    // Send message via Baileys
    try {
      await sendMessage(agentId, sanitizedTo, message.trim());
      
      console.log(`${logPrefix} ✅ Message sent successfully`, {
        agentId: agentId.substring(0, 8) + '...',
        to: sanitizedTo.substring(0, 10) + '...',
        messageLength: message.length
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

module.exports = router;

