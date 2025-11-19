const express = require('express');
const rateLimit = require('express-rate-limit');
const { supabaseAdmin } = require('../config/supabase');
const { processAndStoreToPinecone } = require('../services/vectorStoreService');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONTENT_BYTES = 10 * 1024 * 1024; // 10 MB limit for extracted text

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
 * Normalize uploaded_files payload to a usable array
 * Supports legacy stringified JSON values and new JSONB arrays
 */
function normalizeUploadedFiles(uploadedFiles) {
  if (!uploadedFiles) {
    return [];
  }

  if (Array.isArray(uploadedFiles)) {
    return uploadedFiles;
  }

  if (typeof uploadedFiles === 'string') {
    try {
      const parsed = JSON.parse(uploadedFiles);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[WEBHOOK-UPLOAD] Failed to parse uploaded_files string:', err.message);
      return [];
    }
  }

  return [];
}

router.post('/', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `upload-${Date.now()}`;
  const logPrefix = `[WEBHOOK-UPLOAD][${requestId}]`;

  try {
    const { agent_id: agentId, content, file_id: payloadFileId } = req.body || {};

    console.log(`${logPrefix} Incoming webhook payload`, {
      agentId,
      hasContent: typeof content === 'string',
      contentLength: typeof content === 'string' ? content.length : 0,
      payloadFileId
    });

    // Validate agent_id
    if (!agentId || typeof agentId !== 'string' || !UUID_REGEX.test(agentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing agent_id'
      });
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty content'
      });
    }

    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_CONTENT_BYTES) {
      return res.status(413).json({
        success: false,
        error: `Content size exceeds limit of ${MAX_CONTENT_BYTES} bytes`,
        contentBytes
      });
    }

    // Fetch agent uploaded file metadata
    const { data: agentData, error: agentError, status: agentStatus } = await supabaseAdmin
      .from('agents')
      .select('id, uploaded_files')
      .eq('id', agentId)
      .maybeSingle();

    if (agentError && agentStatus !== 406) {
      console.error(`${logPrefix} Error fetching agent:`, agentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch agent metadata'
      });
    }

    if (!agentData) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
        agent_id: agentId
      });
    }

    const uploadedFiles = normalizeUploadedFiles(agentData.uploaded_files);

    if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No uploaded files found for this agent',
        agent_id: agentId
      });
    }

    const selectedFile = payloadFileId
      ? uploadedFiles.find((file) => file.id === payloadFileId)
      : uploadedFiles[uploadedFiles.length - 1];

    if (!selectedFile) {
      return res.status(404).json({
        success: false,
        error: 'File metadata not found for provided file_id',
        agent_id: agentId,
        file_id: payloadFileId
      });
    }

    if (!selectedFile.id || !UUID_REGEX.test(selectedFile.id)) {
      console.warn(`${logPrefix} File metadata missing valid id`, selectedFile);
      return res.status(400).json({
        success: false,
        error: 'Uploaded file metadata is missing a valid file id'
      });
    }

    const upsertPayload = {
      agent_id: agentId,
      file_id: selectedFile.id,
      file_name: selectedFile.name || selectedFile.fileName || null,
      storage_path: selectedFile.storagePath || selectedFile.path || null,
      content,
      content_type: selectedFile.type || 'text/plain'
    };

    const { data: upserted, error: upsertError } = await supabaseAdmin
      .from('agent_document_contents')
      .upsert(upsertPayload, {
        onConflict: 'agent_id,file_id'
      })
      .select()
      .maybeSingle();

    if (upsertError) {
      console.error(`${logPrefix} Failed to upsert document content:`, upsertError);
      return res.status(500).json({
        success: false,
        error: 'Failed to store document content'
      });
    }

    console.log(`${logPrefix} Document content stored successfully`, {
      agentId,
      fileId: upsertPayload.file_id,
      contentLength: content.length
    });

    let pineconeResult = { chunksStored: 0 };

    try {
      pineconeResult = await processAndStoreToPinecone({
        agentId,
        content,
        fileMetadata: selectedFile
      });
    } catch (pineconeError) {
      console.error(`${logPrefix} Pinecone processing failed:`, pineconeError);
      return res.status(500).json({
        success: false,
        error: 'Failed to store vectors in Pinecone'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Document content processed successfully',
      data: {
        agent_id: agentId,
        file_id: upsertPayload.file_id,
        file_name: upsertPayload.file_name,
        content_length: content.length,
        chunks_stored: pineconeResult.chunksStored,
        processed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error(`${logPrefix} Unexpected webhook error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;

