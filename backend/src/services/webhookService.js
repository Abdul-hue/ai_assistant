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

    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        const attemptNumber = attempt + 1;
        console.log(`[WEBHOOK] Attempt ${attemptNumber}/${maxRetries}:`, {
          url: url.substring(0, 50) + '...', // Log partial URL for security
          source: payload.source,
          messageId: payload.messageId || payload.id,
          from: payload.from ? payload.from.substring(0, 10) + '...' : 'unknown'
        });
        
        const response = await axios.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'WhatsApp-Dashboard/1.0',
            'X-Webhook-Source': payload.source || 'unknown'
          },
          timeout: 10000 // 10 second timeout
        });
        
        console.log('[WEBHOOK] ✅ Webhook sent successfully:', {
          status: response.status,
          source: payload.source,
          messageId: payload.messageId || payload.id
        });
        
        return response.data; // Success
        
      } catch (error) {
        attempt++;
        
        const isLastAttempt = attempt >= maxRetries;
        const retryDelay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        
        const errorDetails = {
          attempt,
          error: error.message,
          source: payload.source,
          messageId: payload.messageId || payload.id,
          status: error.response?.status,
          willRetry: !isLastAttempt
        };
        
        if (isLastAttempt) {
          console.error('[WEBHOOK] ❌ Webhook failed after all retries:', errorDetails);
          return null; // Failed after all retries
        } else {
          console.warn(`[WEBHOOK] ⚠️ Attempt ${attempt} failed, retrying in ${retryDelay}ms:`, errorDetails);
        }
        
        // Wait before retrying
        await this.sleep(retryDelay);
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

