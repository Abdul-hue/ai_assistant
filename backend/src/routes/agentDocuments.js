const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { queryAgentDocuments } = require('../services/vectorStoreService');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const queryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many document queries, please retry shortly',
  },
});

router.post('/query', authMiddleware, queryLimiter, async (req, res) => {
  const requestId = req.headers['x-request-id'] || `query-${Date.now()}`;
  const logPrefix = `[AGENT-DOCS][${requestId}]`;

  try {
    const { agent_id: agentId, query, top_k: topK = 5 } = req.body || {};

    if (!agentId || typeof agentId !== 'string' || !UUID_REGEX.test(agentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing agent_id',
      });
    }

    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Query text is required',
      });
    }

    const safeTopK = Number.isFinite(topK) ? Math.min(Math.max(Number(topK), 1), 20) : 5;

    const { data: agentRecord, error: agentError, status } = await supabaseAdmin
      .from('agents')
      .select('id, user_id')
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
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this agent',
      });
    }

    console.log(`${logPrefix} Querying Pinecone`, {
      agentId,
      topK: safeTopK,
      userId: req.user?.id,
    });

    const matches = await queryAgentDocuments(agentId, query, safeTopK);

    const formatted = matches.map((match) => ({
      id: match.id,
      score: match.score,
      agent_id: match.metadata?.agent_id || agentId,
      file_id: match.metadata?.file_id || null,
      file_name: match.metadata?.file_name || null,
      chunk_index: match.metadata?.chunk_index ?? null,
      total_chunks: match.metadata?.total_chunks ?? null,
      text: match.metadata?.text || '',
      storage_path: match.metadata?.storage_path || null,
      uploaded_at: match.metadata?.uploaded_at || null,
      content_type: match.metadata?.content_type || null,
    }));

    return res.status(200).json({
      success: true,
      data: {
        agent_id: agentId,
        query,
        matches: formatted,
      },
    });
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to query documents',
    });
  }
});

module.exports = router;


