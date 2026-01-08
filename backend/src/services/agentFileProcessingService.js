const path = require('path');
const { randomUUID } = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { extractBufferContent } = require('../lib/extractFileContent');
const { processAndStoreToPinecone } = require('./vectorStoreService');
const pool = require('../database');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET_NAME = process.env.AGENT_FILES_BUCKET || 'agent-files';
const MAX_FILE_BYTES = parseInt(process.env.EXTRACTOR_MAX_FILE_BYTES || `${25 * 1024 * 1024}`, 10);

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
      console.warn('[AGENT-FILE] Failed to parse uploaded_files string:', err.message);
      return [];
    }
  }

  return [];
}

function sanitizeStoragePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    return '';
  }

  const normalized = rawPath.replace(/\\/g, '/').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith(`${BUCKET_NAME}/`)) {
    return normalized.substring(BUCKET_NAME.length + 1);
  }

  return normalized.replace(/^\/+/, '');
}

function deriveStoragePath(fileMetadata = {}) {
  const explicitPath = fileMetadata.storagePath || fileMetadata.path || fileMetadata.storage_path;
  if (explicitPath) {
    const sanitized = sanitizeStoragePath(explicitPath);
    if (sanitized) {
      return sanitized;
    }
  }

  if (fileMetadata.url && typeof fileMetadata.url === 'string') {
    // Signed URL format: .../object/sign/<bucket>/<path>?token=...
    const marker = `/object/sign/${BUCKET_NAME}/`;
    const idx = fileMetadata.url.indexOf(marker);
    if (idx !== -1) {
      const remainder = fileMetadata.url.substring(idx + marker.length);
      const queryIdx = remainder.indexOf('?');
      const extracted = queryIdx !== -1 ? remainder.substring(0, queryIdx) : remainder;
      const sanitized = sanitizeStoragePath(extracted);
      if (sanitized) {
        return sanitized;
      }
    }
  }

  return '';
}

function inferMimeType(fileMetadata = {}, storagePath = '') {
  if (fileMetadata.type) {
    return fileMetadata.type;
  }

  if (!storagePath) {
    return null;
  }

  const ext = path.extname(storagePath).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.txt':
      return 'text/plain';
    case '.md':
      return 'text/markdown';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return null;
  }
}

async function fetchAgentRecord(agentId) {
  const { data, error, status } = await supabaseAdmin
    .from('agents')
    .select('id, user_id, uploaded_files')
    .eq('id', agentId)
    .maybeSingle();

  if (error && status !== 406) {
    throw new Error(`Failed to fetch agent metadata: ${error.message}`);
  }

  if (!data) {
    throw new Error('Agent not found');
  }

  return data;
}

async function downloadFileBuffer(storagePath) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download file from storage: ${error?.message || 'Unknown error'}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(`File exceeds size limit of ${MAX_FILE_BYTES} bytes`);
  }

  return buffer;
}

let ensureTablePromise = null;

async function ensureDocumentContentTable() {
  if (ensureTablePromise) {
    return ensureTablePromise;
  }

  ensureTablePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_document_contents (
        id UUID PRIMARY KEY,
        agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        file_id UUID NOT NULL,
        file_name TEXT,
        storage_path TEXT,
        content TEXT NOT NULL,
        content_type VARCHAR(50) DEFAULT 'text/plain',
        extracted_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS agent_document_contents_agent_file_unique
      ON agent_document_contents(agent_id, file_id)
    `);
  })().catch((err) => {
    ensureTablePromise = null;
    throw err;
  });

  return ensureTablePromise;
}

async function persistDocumentContent({ agentId, fileMetadata, content, contentType, storagePath }) {
  await ensureDocumentContentTable();

  const insertId = randomUUID();

  const params = [
    insertId,
    agentId,
    fileMetadata.id,
    fileMetadata.name || fileMetadata.fileName || null,
    `${BUCKET_NAME}/${storagePath}`,
    content,
    contentType || 'text/plain',
  ];

  await pool.query(
    `
      INSERT INTO agent_document_contents (
        id,
        agent_id,
        file_id,
        file_name,
        storage_path,
        content,
        content_type,
        extracted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (agent_id, file_id)
      DO UPDATE SET
        file_name = EXCLUDED.file_name,
        storage_path = EXCLUDED.storage_path,
        content = EXCLUDED.content,
        content_type = EXCLUDED.content_type,
        extracted_at = NOW()
    `,
    params
  );
}

async function handlePineconeUpsert({ agentId, content, fileMetadata }) {
  try {
    const result = await processAndStoreToPinecone({
      agentId,
      content,
      fileMetadata,
    });

    return result?.chunksStored ?? result?.chunks ?? 0;
  } catch (error) {
    console.error('[AGENT-FILE] Pinecone storage failed:', error.message);
    throw new Error(`Failed to store vectors in Pinecone: ${error.message}`);
  }
}

async function processAgentFile({ agentId, fileId, agentRecord = null, skipAgentFetch = false }) {
  if (!agentId || !UUID_REGEX.test(agentId)) {
    throw new Error('Valid agentId is required');
  }

  const logPrefix = `[AGENT-FILE][${agentId}]`;
  console.log(`${logPrefix} Starting processing`, { fileId });

  let agentData = agentRecord;

  if (!agentData && !skipAgentFetch) {
    agentData = await fetchAgentRecord(agentId);
  }

  if (!agentData) {
    throw new Error('Agent record is required to process file');
  }

  const uploadedFiles = normalizeUploadedFiles(agentData.uploaded_files);

  if (!uploadedFiles.length) {
    throw new Error('No uploaded files found for this agent');
  }

  const fileMetadata = fileId
    ? uploadedFiles.find((file) => file?.id === fileId)
    : uploadedFiles[uploadedFiles.length - 1];

  if (!fileMetadata) {
    throw new Error('File metadata not found for the provided file identifier');
  }

  if (!fileMetadata.id || !UUID_REGEX.test(fileMetadata.id)) {
    throw new Error('File metadata is missing a valid file id');
  }

  const storagePath = deriveStoragePath(fileMetadata);

  if (!storagePath) {
    throw new Error('Unable to determine storage path for the file');
  }

  const mimeType = inferMimeType(fileMetadata, storagePath);

  if (!mimeType) {
    throw new Error('Unable to determine MIME type for the file');
  }

  console.log(`${logPrefix} Downloading file`, { storagePath, mimeType });
  const buffer = await downloadFileBuffer(storagePath);

  console.log(`${logPrefix} Extracting text content`, { size: buffer.length });
  const extractedContent = await extractBufferContent(buffer, mimeType);

  if (!extractedContent || !extractedContent.trim()) {
    throw new Error('Extracted content is empty');
  }

  await persistDocumentContent({
    agentId,
    fileMetadata,
    content: extractedContent,
    contentType: mimeType,
    storagePath,
  });

  const chunksStored = await handlePineconeUpsert({
    agentId,
    content: extractedContent,
    fileMetadata,
  });

  console.log(`${logPrefix} Processing complete`, {
    fileId: fileMetadata.id,
    fileName: fileMetadata.name,
    contentLength: extractedContent.length,
    chunksStored,
  });

  return {
    agentId,
    fileId: fileMetadata.id,
    fileName: fileMetadata.name || null,
    content: extractedContent,
    contentLength: extractedContent.length,
    chunksStored,
    mimeType,
    storagePath: `${BUCKET_NAME}/${storagePath}`,
  };
}

module.exports = {
  processAgentFile,
  normalizeUploadedFiles,
  sanitizeStoragePath,
};


