const express = require('express');
const router = express.Router();
const { createMessage } = require('../services/dbService');
const { queueMessage } = require('../workers/mediaWorker');
const { logProcessingStep, STAGES, STATUS } = require('../services/loggingService');
const { 
  getProcessingHistory, 
  getFailedLogs,
  getProcessingStats 
} = require('../services/loggingService');
const pino = require('pino');
const logger = pino({ level: 'info' });

/**
 * Webhook endpoint for WhatsApp messages
 * POST /webhook/:webhookId
 */
router.post('/webhook/:webhookId', async (req, res) => {
  const payload = req.body;
  const messageId = payload.messageId;
  
  try {
    logger.info({ messageId, from: payload.from }, 'Webhook received');
    
    // LOG: Webhook received
    await logProcessingStep(
      messageId,
      STAGES.RECEIVED,
      STATUS.SUCCESS,
      'Webhook payload received',
      {
        metadata: {
          from: payload.from,
          messageType: payload.metadata?.messageType,
          mimetype: payload.metadata?.mimetype,
          hasMediaUrl: !!payload.metadata?.mediaUrl,
          webhookId: req.params.webhookId
        }
      }
    );
    
    // Validate payload
    if (!messageId || !payload.from) {
      await logProcessingStep(
        messageId || 'unknown',
        STAGES.RECEIVED,
        STATUS.FAILED,
        'Invalid payload structure',
        {
          errorMessage: 'Missing required fields',
          metadata: { missing: !messageId ? 'messageId' : 'from' }
        }
      );
      
      return res.status(400).json({ 
        error: 'Invalid payload', 
        missing: !messageId ? 'messageId' : 'from' 
      });
    }
    
    // Store in database
    const messageRecord = await createMessage(payload);
    
    // Respond immediately
    res.status(200).json({ 
      received: true,
      messageId: messageId,
      id: messageRecord.id
    });
    
    // Queue for processing
    await queueMessage({
      messageId: messageId,
      agentId: payload.agentId,
      metadata: payload.metadata || {}
    });
    
    // LOG: Queued for processing
    await logProcessingStep(
      messageId,
      STAGES.QUEUED,
      STATUS.SUCCESS,
      'Message queued for async processing',
      {
        metadata: {
          dbId: messageRecord.id,
          agentId: payload.agentId
        }
      }
    );
    
    logger.info({ messageId }, 'Message stored and queued');
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Webhook processing error');
    
    // LOG: Processing failed
    await logProcessingStep(
      messageId || 'unknown',
      STAGES.RECEIVED,
      STATUS.FAILED,
      'Webhook processing failed',
      {
        errorMessage: error.message,
        errorStack: error.stack
      }
    );
    
    // Still return 200 to WhatsApp
    res.status(200).json({ 
      received: true, 
      warning: 'Stored with errors' 
    });
  }
});

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'whatsapp-media-processor'
  });
});

/**
 * Queue status endpoint
 */
router.get('/queue/status', async (req, res) => {
  try {
    const { mediaQueue } = require('../workers/mediaWorker');
    
    const [waiting, active, completed, failed] = await Promise.all([
      mediaQueue.getWaitingCount(),
      mediaQueue.getActiveCount(),
      mediaQueue.getCompletedCount(),
      mediaQueue.getFailedCount()
    ]);
    
    res.json({
      status: 'ok',
      queue: {
        waiting,
        active,
        completed,
        failed
      }
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get queue status');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get processing history for a message
 * GET /logs/:messageId
 */
router.get('/logs/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const history = await getProcessingHistory(messageId);
    const stats = await getProcessingStats(messageId);
    
    res.json({
      messageId,
      history,
      stats
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get processing history');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get recent failed logs
 * GET /logs/failed?limit=50&since=2025-01-15T00:00:00Z
 */
router.get('/logs/failed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const since = req.query.since || null;
    
    const failedLogs = await getFailedLogs(limit, since);
    
    res.json({
      count: failedLogs.length,
      logs: failedLogs
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get failed logs');
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
