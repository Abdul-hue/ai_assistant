const { sendToWebhook } = require('../lib/sendToWebhook');
const { processAgentFile, normalizeUploadedFiles } = require('./agentFileProcessingService');

/**
 * Extract text content from the most recent uploaded file and forward to webhook.
 *
 * @param {object} agentRow - Row returned from the agents table.
 * @returns {Promise<void>}
 */
async function processAgentDocuments(agentRow) {
  if (!agentRow) {
    console.warn('[DOCUMENT-PROCESSOR] Missing agent data, skipping processing');
    return;
  }

  const agentId = agentRow.id;
  const uploadedFiles = normalizeUploadedFiles(agentRow.uploaded_files);

  console.log(
    `[DOCUMENT-PROCESSOR] Agent ${agentId} uploaded_files count: ${uploadedFiles.length}`
  );

  if (!uploadedFiles.length) {
    console.log(`[DOCUMENT-PROCESSOR] Agent ${agentId} has no uploaded files; skipping extraction`);
    return;
  }

  const latestFile = uploadedFiles[uploadedFiles.length - 1];

  if (!latestFile?.url || !latestFile?.type) {
    console.warn(
      `[DOCUMENT-PROCESSOR] Uploaded file for agent ${agentId} is missing url or type; skipping`
    );
    return;
  }

  try {
    console.log(
      `[DOCUMENT-PROCESSOR] [${new Date().toISOString()}] Extracting content for agent ${agentId} file ${latestFile.name || latestFile.id}`
    );
    console.log('[DOCUMENT-PROCESSOR] File metadata:', latestFile);

    const processingResult = await processAgentFile({
      agentId,
      fileId: latestFile.id,
      agentRecord: {
        id: agentRow.id,
        uploaded_files: agentRow.uploaded_files,
      },
      skipAgentFetch: true,
    });

    const extractedContent = processingResult.content || '';

    if (!extractedContent.trim()) {
      console.warn(
        `[DOCUMENT-PROCESSOR] Extracted content is empty for agent ${agentId}; skipping webhook`
      );
      return;
    }

    const preview = extractedContent.replace(/\s+/g, ' ').slice(0, 80);

    console.log(
      `[DOCUMENT-PROCESSOR] Extraction complete for agent ${agentId}, file ${latestFile.id} (${processingResult.contentLength} chars): "${preview}"`
    );

    const webhookUrl =
      process.env.WEBHOOK_ENDPOINT ||
      process.env.AGENT_DOCUMENT_WEBHOOK_URL ||
      'https://auto.nsolbpo.com/webhook/upload-documents';

    console.log(`[DOCUMENT-PROCESSOR] Sending extracted content to webhook: ${webhookUrl}`);

    const result = await sendToWebhook(agentId, extractedContent, {
      id: latestFile.id,
      name: latestFile.name,
      url: latestFile.url,
      type: latestFile.type,
      size: latestFile.size,
      uploadedAt: latestFile.uploadedAt,
      storagePath: latestFile.storagePath,
    });

    if (result?.success) {
      console.log(
        `[DOCUMENT-PROCESSOR] ✅ Webhook delivered successfully for agent ${agentId} (status ${result.status})`
      );
    } else {
      console.warn(
        `[DOCUMENT-PROCESSOR] ⚠️ Webhook delivery failed for agent ${agentId}`,
        result?.error ? { error: result.error, status: result.status } : ''
      );
    }
  } catch (error) {
    console.error(
      `[DOCUMENT-PROCESSOR] Failed to process document for agent ${agentId}:`,
      {
        message: error?.message,
        stack: error?.stack,
      }
    );
  }
}

module.exports = {
  processAgentDocuments,
};

