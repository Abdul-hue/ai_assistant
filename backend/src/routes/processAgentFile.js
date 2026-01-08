const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { processAgentFile } = require('../services/agentFileProcessingService');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const processLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many processing requests, please retry later',
  },
});

router.post('/', authMiddleware, processLimiter, async (req, res) => {
  const requestId = req.headers['x-request-id'] || `process-${Date.now()}`;
  const logPrefix = `[PROCESS-AGENT-FILE][${requestId}]`;

  try {
    const { agent_id: agentId, file_id: fileId } = req.body || {};

    console.log(`${logPrefix} Incoming request`, {
      agentId,
      fileId,
      userId: req.user?.id,
    });

    if (!agentId || typeof agentId !== 'string' || !UUID_REGEX.test(agentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing agent_id',
      });
    }

    if (fileId && (typeof fileId !== 'string' || !UUID_REGEX.test(fileId))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file_id format',
      });
    }

    const { data: agentRecord, error: agentError, status } = await supabaseAdmin
      .from('agents')
      .select('id, user_id, uploaded_files')
      .eq('id', agentId)
      .maybeSingle();

    if (agentError && status !== 406) {
      console.error(`${logPrefix} Failed to load agent`, agentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to load agent metadata',
      });
    }

    if (!agentRecord) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    if (agentRecord.user_id && agentRecord.user_id !== req.user.id) {
      console.warn(`${logPrefix} Unauthorized access attempt`, {
        agentId,
        ownerId: agentRecord.user_id,
        requesterId: req.user.id,
      });
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this agent',
      });
    }

    const result = await processAgentFile({
      agentId,
      fileId: fileId || null,
      agentRecord,
      skipAgentFetch: true,
    });

    return res.status(200).json({
      success: true,
      message: 'File processed successfully',
      data: {
        agent_id: result.agentId,
        file_id: result.fileId,
        file_name: result.fileName,
        content_length: result.contentLength,
        chunks_stored: result.chunksStored,
        storage_path: result.storagePath,
        processed_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process file',
    });
  }
});

module.exports = router;


