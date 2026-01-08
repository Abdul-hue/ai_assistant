const DEFAULT_WEBHOOK = 'https://auto.nsolbpo.com/webhook/upload-documents';
const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS || 2);
const RETRY_DELAY_MS = Number(process.env.WEBHOOK_RETRY_DELAY_MS || 2000);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends extracted file content to an external webhook with retry logic.
 *
 * @param {string} agentId
 * @param {string} extractedContent
 * @param {object} fileMetadata
 * @returns {Promise<{success: boolean, status?: number, error?: string}>}
 */
async function sendToWebhook(agentId, extractedContent, fileMetadata = {}) {
  const webhookUrl =
    process.env.WEBHOOK_ENDPOINT ||
    process.env.AGENT_DOCUMENT_WEBHOOK_URL ||
    DEFAULT_WEBHOOK;

  if (!webhookUrl) {
    console.warn('[WEBHOOK] Skipping webhook call: no endpoint configured');
    return { success: false, error: 'missing_webhook_url' };
  }

  if (!agentId) {
    console.warn('[WEBHOOK] Missing agentId; skipping webhook call');
    return { success: false, error: 'missing_agent_id' };
  }

  if (typeof extractedContent !== 'string') {
    console.warn('[WEBHOOK] Extracted content is not a string; coercing to empty string');
  }

  const payload = {
    agent_id: agentId,
    extracted_content: extractedContent || '',
    file_metadata: fileMetadata,
  };

  const body = JSON.stringify(payload);
  const preview = (payload.extracted_content || '')
    .replace(/\s+/g, ' ')
    .slice(0, 80);

  console.log('[WEBHOOK] Preparing request', {
    url: webhookUrl,
    payloadPreview: preview,
    fileId: fileMetadata?.id,
  });

  for (let attempt = 1; attempt <= Math.max(1, MAX_ATTEMPTS); attempt += 1) {
    try {
      console.log(`[WEBHOOK] ▶️ Attempt ${attempt} to ${webhookUrl}`);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '<no body>');
        console.error('[WEBHOOK] Failed to send payload', {
          status: response.status,
          body: errorText,
          payload,
        });

        if (attempt < Math.max(1, MAX_ATTEMPTS)) {
          console.log(`[WEBHOOK] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await delay(RETRY_DELAY_MS);
          continue;
        }

        return { success: false, status: response.status, error: errorText };
      }

      console.log(
        `[WEBHOOK] ✅ Sent extracted content to ${webhookUrl} (status ${response.status})`
      );
      return { success: true, status: response.status };
    } catch (error) {
      console.error('[WEBHOOK] Error sending payload:', {
        name: error?.name,
        message: error?.message,
        payload,
      });

      if (attempt < Math.max(1, MAX_ATTEMPTS)) {
        console.log(`[WEBHOOK] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await delay(RETRY_DELAY_MS);
        continue;
      }

      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'unknown_error' };
}

module.exports = {
  sendToWebhook,
};

