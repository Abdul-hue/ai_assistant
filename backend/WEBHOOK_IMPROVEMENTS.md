# 🚀 WhatsApp Webhook Improvements - Implementation Guide

This document provides code implementations for the critical improvements identified in the webhook analysis.

---

## 🔴 CRITICAL FIX #1: Add Retry Logic

### Current Code (No Retry)
**File:** `backend/src/services/baileysService.js:93-161`

### Improved Code (With Retry)

```javascript
async function forwardMessageToWebhook(agentId, messagePayload) {
  const webhookUrl = getInboundMessageWebhook();

  if (!webhookUrl) {
    console.warn('[BAILEYS][WEBHOOK] ⚠️ No inbound webhook configured. Skipping message forward.');
    return;
  }

  const MAX_RETRIES = Number(process.env.WEBHOOK_RETRY_MAX_ATTEMPTS || 3);
  const INITIAL_DELAY = Number(process.env.WEBHOOK_RETRY_INITIAL_DELAY || 2000);
  const TIMEOUT_MS = MESSAGE_FORWARD_TIMEOUT_MS;

  // Fetch user_id (existing code)
  let userId = null;
  try {
    const { data: agentData, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('user_id')
      .eq('id', agentId)
      .single();

    if (agentError) {
      console.error(`[BAILEYS][WEBHOOK] ❌ Failed to fetch agent user_id:`, agentError.message);
    } else if (agentData && agentData.user_id) {
      userId = agentData.user_id;
      console.log(`[BAILEYS][WEBHOOK] ✅ Fetched user_id for agent ${agentId}: ${userId}`);
    }
  } catch (fetchError) {
    console.error(`[BAILEYS][WEBHOOK] ❌ Error fetching user_id:`, fetchError.message);
  }

  const webhookPayload = {
    agentId,
    ...(userId && { user_id: userId }),
    ...messagePayload,
  };

  // Retry loop
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      
      const response = await axios.post(
        webhookUrl,
        webhookPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-WhatsApp-Agent': agentId,
            'X-WhatsApp-RemoteJid': messagePayload.from,
          },
          timeout: TIMEOUT_MS,
        }
      );

      const duration = Date.now() - startTime;
      const label = messagePayload.messageType || messagePayload.type || 'message';
      
      console.log(
        `[BAILEYS][WEBHOOK] ✅ Forwarded ${label} ${messagePayload.messageId || messagePayload.id} from ${messagePayload.from}${userId ? ` (user_id: ${userId})` : ''} (attempt ${attempt}/${MAX_RETRIES}, ${duration}ms)`
      );

      // Log to database
      await logWebhookAttempt(agentId, webhookUrl, webhookPayload, response.status, response.data, null, duration);

      return; // Success - exit retry loop
      
    } catch (error) {
      const status = error.response?.status;
      const responseData = error.response?.data;
      const errorMessage = error.message;
      const isNetworkError = !status && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND');
      const isServerError = status >= 500 && status < 600;
      const isClientError = status >= 400 && status < 500;

      // Log attempt to database
      await logWebhookAttempt(agentId, webhookUrl, webhookPayload, status || 0, responseData, errorMessage, null);

      // Don't retry on client errors (4xx) - these are configuration issues
      if (isClientError && status !== 408) { // 408 = timeout, retry it
        console.error(
          `[BAILEYS][WEBHOOK] ❌ Client error (${status}) - not retrying. Message: ${messagePayload.messageId || messagePayload.id}`
        );
        return; // Don't retry
      }

      // Retry on network errors and server errors (5xx)
      if (attempt < MAX_RETRIES && (isNetworkError || isServerError || status === 408)) {
        const delay = INITIAL_DELAY * Math.pow(2, attempt - 1); // Exponential backoff: 2s, 4s, 8s
        console.warn(
          `[BAILEYS][WEBHOOK] ⚠️ Attempt ${attempt}/${MAX_RETRIES} failed (${status || errorMessage}). Retrying in ${delay}ms...`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue; // Retry
      }

      // All retries exhausted
      console.error(
        `[BAILEYS][WEBHOOK] ❌ Failed to forward ${messagePayload.messageType || messagePayload.type || 'message'} ${
          messagePayload.messageId || messagePayload.id
        } to ${webhookUrl} after ${MAX_RETRIES} attempts. Status: ${status || 'n/a'}, Error: ${errorMessage}`
      );
      return; // Give up
    }
  }
}

// Helper function to log webhook attempts
async function logWebhookAttempt(agentId, webhookUrl, payload, status, responseData, errorMessage, duration) {
  try {
    await supabaseAdmin
      .from('n8n_webhook_logs')
      .insert({
        agent_id: agentId,
        webhook_url: webhookUrl,
        payload: payload,
        response_status: status || 0,
        response_body: responseData || null,
        error_message: errorMessage || null,
        created_at: new Date().toISOString()
      });
  } catch (logError) {
    console.error(`[BAILEYS][WEBHOOK] ❌ Failed to log webhook attempt:`, logError.message);
  }
}
```

---

## 🔴 CRITICAL FIX #2: Add Duplicate Prevention

### Add to Top of baileysService.js

```javascript
// Track processed messages to prevent duplicates
const processedMessages = new Map(); // messageId -> timestamp
const PROCESSED_MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [messageId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > PROCESSED_MESSAGE_TTL) {
      processedMessages.delete(messageId);
    }
  }
}, 60 * 60 * 1000); // Every hour
```

### Add to messages.upsert Handler

```javascript
// In messages.upsert handler, before processing:
for (const msg of messages) {
  if (!shouldProcessMessage(msg)) {
    continue;
  }

  const messageId = msg?.key?.id || 'unknown';
  
  // CRITICAL: Check for duplicates
  if (processedMessages.has(messageId)) {
    console.log(`[BAILEYS] ⏭️ Skipping duplicate message: ${messageId}`);
    continue;
  }

  // Also check database for existing message
  try {
    const { data: existingMessage } = await supabaseAdmin
      .from('message_log')
      .select('message_id')
      .eq('message_id', messageId)
      .maybeSingle();
    
    if (existingMessage) {
      console.log(`[BAILEYS] ⏭️ Message ${messageId} already exists in database - skipping`);
      processedMessages.set(messageId, Date.now());
      continue;
    }
  } catch (dbError) {
    console.error(`[BAILEYS] ⚠️ Error checking duplicate:`, dbError.message);
    // Continue processing - don't block on duplicate check failure
  }

  // Mark as processed
  processedMessages.set(messageId, Date.now());

  // ... rest of message processing ...
}
```

---

## 🔴 CRITICAL FIX #3: Make Webhook Calls Non-Blocking

### Option A: Fire and Forget (Recommended)

```javascript
// In messages.upsert handler, replace:
if (shouldForward) {
  await forwardMessageToWebhook(agentId, webhookPayload);
}

// With:
if (shouldForward) {
  // Fire and forget - don't block message processing
  forwardMessageToWebhook(agentId, webhookPayload).catch(err => {
    console.error('[BAILEYS][WEBHOOK] Async webhook error:', err.message);
  });
}
```

### Option B: Use Message Queue (Better for Production)

```javascript
// Install: npm install bull
const Queue = require('bull');
const webhookQueue = new Queue('webhook-processing', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

// In messages.upsert handler:
if (shouldForward) {
  await webhookQueue.add('forward-message', {
    agentId,
    payload: webhookPayload
  }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  });
}

// Queue processor
webhookQueue.process('forward-message', async (job) => {
  const { agentId, payload } = job.data;
  await forwardMessageToWebhook(agentId, payload);
});
```

---

## 🟠 HIGH PRIORITY FIX #4: Add Circuit Breaker

### Add Circuit Breaker Implementation

```javascript
// Add to top of baileysService.js
const circuitBreakers = new Map(); // agentId -> { failures: 0, state: 'CLOSED' | 'OPEN' | 'HALF_OPEN', nextAttempt: null }

const CIRCUIT_BREAKER_THRESHOLD = 5; // Open after 5 failures
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute cooldown

function getCircuitBreakerState(agentId) {
  const breaker = circuitBreakers.get(agentId) || { failures: 0, state: 'CLOSED', nextAttempt: null };
  
  if (breaker.state === 'OPEN') {
    if (Date.now() > breaker.nextAttempt) {
      breaker.state = 'HALF_OPEN';
      breaker.failures = 0;
      console.log(`[BAILEYS][WEBHOOK] 🔄 Circuit breaker HALF_OPEN for agent ${agentId} - testing`);
    } else {
      return 'OPEN'; // Still in cooldown
    }
  }
  
  return breaker.state;
}

function recordCircuitBreakerSuccess(agentId) {
  const breaker = circuitBreakers.get(agentId) || { failures: 0, state: 'CLOSED', nextAttempt: null };
  breaker.failures = 0;
  breaker.state = 'CLOSED';
  circuitBreakers.set(agentId, breaker);
}

function recordCircuitBreakerFailure(agentId) {
  const breaker = circuitBreakers.get(agentId) || { failures: 0, state: 'CLOSED', nextAttempt: null };
  breaker.failures++;
  
  if (breaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    breaker.state = 'OPEN';
    breaker.nextAttempt = Date.now() + CIRCUIT_BREAKER_TIMEOUT;
    console.error(`[BAILEYS][WEBHOOK] 🔴 Circuit breaker OPEN for agent ${agentId} - too many failures`);
  }
  
  circuitBreakers.set(agentId, breaker);
}

// Update forwardMessageToWebhook to use circuit breaker
async function forwardMessageToWebhook(agentId, messagePayload) {
  // Check circuit breaker
  const breakerState = getCircuitBreakerState(agentId);
  if (breakerState === 'OPEN') {
    console.warn(`[BAILEYS][WEBHOOK] ⚠️ Circuit breaker OPEN for agent ${agentId} - skipping webhook`);
    return;
  }

  // ... existing webhook code ...

  try {
    // ... webhook call ...
    recordCircuitBreakerSuccess(agentId);
  } catch (error) {
    recordCircuitBreakerFailure(agentId);
    throw error;
  }
}
```

---

## 🟠 HIGH PRIORITY FIX #5: Add Rate Limiting

### Add Rate Limiter

```javascript
// Add to top of baileysService.js
const webhookRateLimiters = new Map(); // agentId -> { count: 0, resetAt: timestamp }

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 messages per minute per agent

function checkRateLimit(agentId) {
  const limiter = webhookRateLimiters.get(agentId) || { count: 0, resetAt: Date.now() + RATE_LIMIT_WINDOW_MS };
  
  // Reset if window expired
  if (Date.now() > limiter.resetAt) {
    limiter.count = 0;
    limiter.resetAt = Date.now() + RATE_LIMIT_WINDOW_MS;
  }
  
  // Check limit
  if (limiter.count >= RATE_LIMIT_MAX) {
    const waitTime = Math.ceil((limiter.resetAt - Date.now()) / 1000);
    console.warn(`[BAILEYS][WEBHOOK] ⚠️ Rate limit exceeded for agent ${agentId}. Wait ${waitTime}s`);
    return true; // Rate limited
  }
  
  // Increment counter
  limiter.count++;
  webhookRateLimiters.set(agentId, limiter);
  return false; // Not rate limited
}

// Update forwardMessageToWebhook
async function forwardMessageToWebhook(agentId, messagePayload) {
  // Check rate limit
  if (checkRateLimit(agentId)) {
    console.warn(`[BAILEYS][WEBHOOK] ⚠️ Rate limited - skipping webhook for agent ${agentId}`);
    return;
  }

  // ... rest of webhook code ...
}
```

---

## 📊 Complete Implementation Summary

### Files to Modify

1. **`backend/src/services/baileysService.js`**
   - Add retry logic to `forwardMessageToWebhook()`
   - Add duplicate prevention
   - Add circuit breaker
   - Add rate limiting
   - Make webhook calls non-blocking
   - Add webhook logging function

### Environment Variables to Add

```bash
# Webhook retry configuration
WEBHOOK_RETRY_MAX_ATTEMPTS=3
WEBHOOK_RETRY_INITIAL_DELAY=2000

# Rate limiting (optional)
WEBHOOK_RATE_LIMIT_MAX=30
WEBHOOK_RATE_LIMIT_WINDOW_MS=60000
```

### Database Migration (if needed)

```sql
-- Ensure n8n_webhook_logs table exists (should already exist)
-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_n8n_webhook_logs_agent_created 
ON n8n_webhook_logs(agent_id, created_at DESC);

-- Add index for error tracking
CREATE INDEX IF NOT EXISTS idx_n8n_webhook_logs_error_status 
ON n8n_webhook_logs(response_status) 
WHERE response_status >= 400;
```

---

## ✅ Testing Checklist

After implementing fixes:

- [ ] Send test message → Verify webhook received
- [ ] Disconnect n8n → Verify retry attempts logged
- [ ] Send duplicate message → Verify skipped
- [ ] Send 30+ messages in 1 minute → Verify rate limiting
- [ ] Cause 5+ webhook failures → Verify circuit breaker opens
- [ ] Check `n8n_webhook_logs` table → Verify all attempts logged
- [ ] Verify webhook calls don't block message processing

---

**Last Updated:** 2025-11-27

