const express = require('express');
const rateLimit = require('express-rate-limit');
const pdfParse = require('pdf-parse');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_BUCKET = process.env.AGENT_FILES_BUCKET || 'agent-files';
const WEBHOOK_URL = process.env.AGENT_DOCUMENT_WEBHOOK_URL || 'https://auto.nsolbpo.com/webhook/upload-documents';
const MAX_FILE_BYTES = parseInt(process.env.EXTRACTOR_MAX_FILE_BYTES || `${25 * 1024 * 1024}`, 10); // 25 MB default

const extractLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many extraction requests, please retry later'
  }
});

router.use(extractLimiter);

function sanitizePath(rawPath, bucket) {
  if (!rawPath || typeof rawPath !== 'string') {
    return '';
  }

  const normalized = rawPath.replace(/\\/g, '/').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith(`${bucket}/`)) {
    return normalized.substring(bucket.length + 1);
  }

  return normalized.replace(/^\/+/, '');
}

async function extractPdf(buffer) {
  const parsed = await pdfParse(buffer);
  return parsed.text || '';
}

async function extractPlainText(buffer) {
  return buffer.toString('utf8');
}

async function extractContent(buffer, fileType) {
  if (!buffer || buffer.length === 0) {
    return '';
  }

  if (fileType === 'application/pdf') {
    return extractPdf(buffer);
  }

  if (fileType === 'text/plain') {
    return extractPlainText(buffer);
  }

  // Fallback: attempt UTF-8 text
  return buffer.toString('utf8');
}

router.post('/', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `extract-${Date.now()}`;
  const logPrefix = `[EXTRACT-PDF][${requestId}]`;

  try {
    const {
      agent_id: agentId,
      file_path: filePath,
      bucket = DEFAULT_BUCKET,
      file_type: fileType = 'application/pdf',
      file_id: fileId = null,
      file_name: fileName = null
    } = req.body || {};

    console.log(`${logPrefix} Incoming extraction request`, {
      agentId,
      filePath,
      bucket,
      fileType
    });

    if (!agentId || typeof agentId !== 'string' || !UUID_REGEX.test(agentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing agent_id'
      });
    }

    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing file_path'
      });
    }

    const sanitizedPath = sanitizePath(filePath, bucket);

    if (!sanitizedPath) {
      return res.status(400).json({
        success: false,
        error: 'Unable to determine storage path'
      });
    }

    console.log(`${logPrefix} Downloading file from bucket ${bucket} at path ${sanitizedPath}`);

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from(bucket)
      .download(sanitizedPath);

    if (downloadError || !fileData) {
      console.error(`${logPrefix} Failed to download file`, downloadError);
      return res.status(500).json({
        success: false,
        error: 'Failed to download file from storage'
      });
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_FILE_BYTES) {
      return res.status(413).json({
        success: false,
        error: `File exceeds size limit of ${MAX_FILE_BYTES} bytes`
      });
    }

    const extractedText = await extractContent(buffer, fileType);

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(422).json({
        success: false,
        error: 'Failed to extract text content from file'
      });
    }

    console.log(`${logPrefix} Extracted ${extractedText.length} characters`);

    const payload = {
      agent_id: agentId,
      content: extractedText,
      file_id: fileId,
      file_name: fileName,
      storage_path: `${bucket}/${sanitizedPath}`
    };

    console.log(`${logPrefix} Sending extracted content to webhook ${WEBHOOK_URL}`);

    const webhookResponse = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!webhookResponse.ok) {
      const errorBody = await webhookResponse.text();
      console.error(`${logPrefix} Webhook call failed`, {
        status: webhookResponse.status,
        body: errorBody
      });
      return res.status(502).json({
        success: false,
        error: 'Webhook call failed',
        webhook_status: webhookResponse.status
      });
    }

    let webhookJson = null;
    try {
      webhookJson = await webhookResponse.clone().json();
    } catch {
      webhookJson = await webhookResponse.text();
    }

    console.log(`${logPrefix} Webhook response`, {
      status: webhookResponse.status,
      body: webhookJson
    });

    console.log(`${logPrefix} Extraction complete`, {
      agentId,
      filePath: sanitizedPath,
      contentLength: extractedText.length
    });

    return res.status(200).json({
      success: true,
      agent_id: agentId,
      file_id: fileId,
      file_name: fileName,
      storage_path: `${bucket}/${sanitizedPath}`,
      content_length: extractedText.length,
      webhook_status: webhookResponse.status
    });
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

