const express = require('express');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 * POST /api/webhooks/button-response
 * Handles button click events from WhatsApp
 * 
 * Request Body:
 * {
 *   "agentId": "uuid",
 *   "from": "phone-number",
 *   "buttonId": "create_draft_39482",
 *   "buttonText": "Create a Draft uid(39482)",
 *   "timestamp": "2024-01-01T12:00:00.000Z"
 * }
 */
router.post('/', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `button-${Date.now()}`;
  const logPrefix = `[BUTTON-HANDLER][${requestId}]`;

  try {
    const { agentId, from, buttonId, buttonText, timestamp } = req.body || {};

    console.log(`${logPrefix} Incoming button response`, {
      agentId: agentId ? agentId.substring(0, 8) + '...' : 'missing',
      from: from ? from.substring(0, 10) + '...' : 'missing',
      buttonId: buttonId || 'missing',
      buttonText: buttonText || 'missing'
    });

    // Validate required fields
    if (!agentId || typeof agentId !== 'string' || !UUID_REGEX.test(agentId)) {
      console.warn(`${logPrefix} Invalid agentId`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing agentId',
        details: 'agentId must be a valid UUID'
      });
    }

    if (!from || typeof from !== 'string') {
      console.warn(`${logPrefix} Invalid from phone number`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing from phone number'
      });
    }

    if (!buttonId || typeof buttonId !== 'string') {
      console.warn(`${logPrefix} Invalid buttonId`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing buttonId'
      });
    }

    // Extract UID from button ID (format: create_draft_39482)
    let uid = null;
    try {
      const uidMatch = buttonId.match(/^create_draft_(\d+)$/);
      if (uidMatch) {
        uid = uidMatch[1];
        console.log(`[BUTTON-CLICK] User clicked: ${buttonId}, extracted UID: ${uid}`);
      } else {
        console.warn(`${logPrefix} Button ID does not match expected pattern: ${buttonId}`);
        // Still proceed, but log warning
      }
    } catch (uidError) {
      console.error(`${logPrefix} Error extracting UID from buttonId:`, uidError.message);
      // Continue anyway - might be a different button type
    }

    // Verify agent exists
    const { data: agentData, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, agent_name, whatsapp_phone_number')
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

    // Construct the message to send back via send-message webhook
    // Use buttonText if available, otherwise construct from UID
    const draftMessage = buttonText || (uid ? `Create a Draft uid(${uid})` : buttonId);

    // Get the base URL for internal webhook call
    const baseUrl = process.env.API_BASE_URL || 
                   process.env.WEBHOOK_BASE_URL || 
                   (req.protocol + '://' + req.get('host'));

    const sendMessageWebhookUrl = `${baseUrl}/api/webhooks/send-message`;

    console.log(`[BUTTON-HANDLER] Sending draft message for UID: ${uid || 'unknown'}`, {
      agentId: agentId.substring(0, 8) + '...',
      to: from.substring(0, 10) + '...',
      message: draftMessage,
      webhookUrl: sendMessageWebhookUrl
    });

    // Call send-message webhook internally
    try {
      const response = await axios.post(sendMessageWebhookUrl, {
        agentId: agentId,
        to: from,
        message: draftMessage
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': `${requestId}-internal`,
          'X-Internal-Request': 'true'
        },
        timeout: 30000 // 30 second timeout
      });

      console.log(`${logPrefix} ✅ Successfully sent draft message via send-message webhook`, {
        status: response.status,
        uid: uid || 'unknown'
      });

      return res.status(200).json({
        success: true,
        message: 'Button response processed successfully',
        data: {
          agentId,
          from,
          buttonId,
          uid: uid || null,
          draftMessage,
          sentAt: new Date().toISOString()
        }
      });
    } catch (webhookError) {
      console.error(`${logPrefix} ❌ Failed to call send-message webhook:`, {
        message: webhookError.message,
        status: webhookError.response?.status,
        data: webhookError.response?.data
      });

      // Return error but don't fail completely - button was clicked
      return res.status(500).json({
        success: false,
        error: 'Failed to send draft message',
        details: webhookError.response?.data?.error || webhookError.message,
        buttonClicked: true,
        buttonId,
        uid: uid || null
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

