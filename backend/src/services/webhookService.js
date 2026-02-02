/**
 * Centralized Webhook Service
 * Handles all webhook sending with retry logic and error handling
 */

const axios = require('axios');

class WebhookService {
  /**
   * Send webhook with exponential backoff retry
   * @param {string} url - Webhook URL
   * @param {Object} payload - Webhook payload
   * @param {number} maxRetries - Maximum retry attempts (default 3)
   * @returns {Promise<Object|null>} - Response data on success, null on failure
   */
  async sendWebhook(url, payload, maxRetries = 3) {
    if (!url) {
      console.warn('[WEBHOOK] Webhook URL not configured, skipping webhook');
      return null;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FIX: Increased timeout and improved timeout error handling
    // Uses existing env variables: N8N_WEBHOOK_TIMEOUT and WEBHOOK_RETRY_MAX_ATTEMPTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const WEBHOOK_TIMEOUT_MS = parseInt(process.env.N8N_WEBHOOK_TIMEOUT) || 
                                parseInt(process.env.WEBHOOK_TIMEOUT_MS) || 
                                30000; // 30 seconds (increased from 10s) - uses N8N_WEBHOOK_TIMEOUT from .env
    const WEBHOOK_MAX_RETRIES = parseInt(process.env.WEBHOOK_RETRY_MAX_ATTEMPTS) || 
                                 parseInt(process.env.WEBHOOK_MAX_RETRIES) || 
                                 maxRetries; // Uses WEBHOOK_RETRY_MAX_ATTEMPTS from .env

    let attempt = 0;
    
    while (attempt < WEBHOOK_MAX_RETRIES) {
      try {
        const attemptNumber = attempt + 1;
        console.log(`[WEBHOOK] Attempt ${attemptNumber}/${WEBHOOK_MAX_RETRIES}:`, {
          url: url.substring(0, 50) + '...', // Log partial URL for security
          source: payload.source,
          messageId: payload.messageId || payload.id,
          from: payload.from ? payload.from.substring(0, 10) + '...' : 'unknown',
          timeout: `${WEBHOOK_TIMEOUT_MS / 1000}s`
        });
        
        const startTime = Date.now();
        const response = await axios.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'WhatsApp-Dashboard/1.0',
            'X-Webhook-Source': payload.source || 'unknown'
          },
          timeout: WEBHOOK_TIMEOUT_MS // Increased to 30 seconds
        });
        
        const duration = Date.now() - startTime;
        console.log('[WEBHOOK] ✅ Webhook sent successfully:', {
          status: response.status,
          source: payload.source,
          messageId: payload.messageId || payload.id,
          duration: `${duration}ms`
        });
        
        return response.data; // Success
        
      } catch (error) {
        attempt++;
        
        const isLastAttempt = attempt >= WEBHOOK_MAX_RETRIES;
        const retryDelay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // FIX: Detect timeout errors and handle them appropriately
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const isTimeoutError = error.code === 'ECONNABORTED' || 
                              error.message.includes('timeout') || 
                              error.message.includes('exceeded');
        
        const errorDetails = {
          attempt,
          error: error.message,
          source: payload.source,
          messageId: payload.messageId || payload.id,
          status: error.response?.status,
          isTimeout: isTimeoutError,
          willRetry: !isLastAttempt && !isTimeoutError // Don't retry on timeout after first attempt
        };
        
        if (isLastAttempt) {
          console.error('[WEBHOOK] ❌ Webhook failed after all retries:', errorDetails);
          return null; // Failed after all retries
        } else if (isTimeoutError && attempt === 1) {
          // On first timeout, retry once more (endpoint might be slow but working)
          console.warn(`[WEBHOOK] ⚠️ Attempt ${attempt} timed out (endpoint slow), retrying once more in ${retryDelay}ms:`, errorDetails);
          await this.sleep(retryDelay);
        } else if (isTimeoutError) {
          // Multiple timeouts = endpoint is too slow, don't keep retrying
          console.error('[WEBHOOK] ❌ Multiple timeouts detected - endpoint too slow, aborting:', errorDetails);
          return null;
        } else {
          // Network/server errors - retry with backoff
          console.warn(`[WEBHOOK] ⚠️ Attempt ${attempt} failed, retrying in ${retryDelay}ms:`, errorDetails);
          await this.sleep(retryDelay);
        }
      }
    }
    
    return null;
  }
  
  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new WebhookService();

