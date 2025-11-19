require('dotenv').config();
const pool = require('../database');
const { supabaseAdmin } = require('../config/supabase');

// Webhook environment configuration
const WEBHOOK_ENV = process.env.WEBHOOK_ENV || 'production';
const TEST_WEBHOOK_URL = 'https://auto.nsolbpo4abe-a8d8-0912dae2d8ab';
const PRODUCTION_WEBHOOK_URL = 'https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab';

// Select webhook URL based on environment
const DEFAULT_WEBHOOK_URL = WEBHOOK_ENV === 'test' ? TEST_WEBHOOK_URL : PRODUCTION_WEBHOOK_URL;

const TIMEOUT_MS = Number(process.env.N8N_WEBHOOK_TIMEOUT || 10000);
const MAX_ATTEMPTS = Number(process.env.WEBHOOK_RETRY_MAX_ATTEMPTS || 3);
const INITIAL_DELAY = Number(process.env.WEBHOOK_RETRY_INITIAL_DELAY || 2000);

console.log(`[N8N] Webhook environment: ${WEBHOOK_ENV}`);
console.log(`[N8N] Using webhook URL: ${DEFAULT_WEBHOOK_URL}`);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get webhook URL for an agent (can be customized per agent in the future)
 */
function getWebhookUrl(agentId) {
  // For now, use the default URL based on environment
  // In the future, this could check agent-specific webhook URLs
  return DEFAULT_WEBHOOK_URL;
}

/**
 * Log webhook execution to database
 */
async function logWebhookExecution(agentId, webhookUrl, payload, status, responseData, errorMessage = null) {
  try {
    await pool.query(
      `INSERT INTO n8n_webhook_logs (agent_id, webhook_url, payload, response_status, response_body, error_message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        agentId,
        webhookUrl,
        JSON.stringify(payload),
        status || 0,
        responseData ? JSON.stringify(responseData) : null,
        errorMessage
      ]
    );
  } catch (error) {
    console.error(`[N8N] ❌ Failed to log webhook execution:`, error.message);
  }
}

async function triggerN8nWebhook(agentId, payload) {
  // CRITICAL: Fetch user_id from agents table before sending webhook
  let userId = null;
  try {
    const { data: agentData, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('user_id')
      .eq('id', agentId)
      .single();

    if (agentError) {
      console.error(`[N8N] ❌ Failed to fetch agent user_id:`, agentError.message);
      // Continue without user_id rather than failing completely
    } else if (agentData && agentData.user_id) {
      userId = agentData.user_id;
      console.log(`[N8N] ✅ Fetched user_id for agent ${agentId}: ${userId}`);
    } else {
      console.warn(`[N8N] ⚠️ Agent ${agentId} not found or has no user_id set in database`);
    }
  } catch (fetchError) {
    console.error(`[N8N] ❌ Error fetching user_id:`, fetchError.message);
    // Continue without user_id rather than failing completely
  }

  // Add user_id to payload body if it exists (snake_case to match database field)
  // Handle both nested body structure and flat payload structure
  const enhancedPayload = payload.body
    ? {
        ...payload,
        body: {
          ...payload.body,
          ...(userId && { user_id: userId }), // Include user_id in body only if it exists
        }
      }
    : {
        ...payload,
        ...(userId && { user_id: userId }), // Include user_id at root level if payload is flat
      };

  const webhookUrl = getWebhookUrl(agentId);
  const isTestWebhook = webhookUrl.includes('/webhook-test/');
  
  console.log(`[N8N] 🔗 Triggering webhook for agent ${agentId} (attempt 1/${MAX_ATTEMPTS})`);
  console.log(`[N8N] 📊 Payload size: ${JSON.stringify(enhancedPayload).length} bytes`);
  console.log(`[N8N] 🌐 Webhook URL: ${webhookUrl}`);
  console.log(`[N8N] 🔧 Mode: ${isTestWebhook ? 'TEST' : 'PRODUCTION'}`);
  if (userId) {
    console.log(`[N8N] 👤 User ID: ${userId}`);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const start = Date.now();
    
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-AI-Dashboard/1.0',
          'X-Agent-ID': agentId,
          'X-Webhook-Env': WEBHOOK_ENV,
          'X-Message-Type': enhancedPayload.body?.messageType || enhancedPayload.messageType || 'text',
          'X-Sender-Phone': enhancedPayload.body?.from || enhancedPayload.senderPhone || 'unknown',
          ...(userId && { 'X-User-ID': userId }) // Include user_id in header as well
        },
        body: JSON.stringify(enhancedPayload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await response.text();
      let parsed;
      try { 
        parsed = JSON.parse(text); 
      } catch { 
        parsed = { raw: text }; 
      }

      const status = response.status;
      const duration = Date.now() - start;

      // Log webhook attempt to database
      await logWebhookExecution(agentId, webhookUrl, enhancedPayload, status, parsed);

      // Success (2xx)
      if (status >= 200 && status < 300) {
        console.log(`[N8N] ✅ Webhook succeeded for agent ${agentId} (${status}) in ${duration}ms`);
        return { success: true, status, data: parsed };
      }

      // Handle specific error cases
      if (status === 404) {
        if (isTestWebhook) {
          console.log(`[N8N] ⚠️ Test webhook expired for agent ${agentId}. Activate workflow in n8n to continue.`);
          return { 
            success: false, 
            status: 404, 
            error: 'Test webhook expired', 
            hint: 'Activate the workflow in n8n to enable webhook processing' 
          };
        } else {
          console.log(`[N8N] ❌ Webhook not found (404) for agent ${agentId} - check n8n workflow configuration`);
          return { 
            success: false, 
            status: 404, 
            error: 'Webhook not found', 
            hint: 'Check n8n workflow configuration and ensure webhook is properly set up' 
          };
        }
      }

      if (status === 500) {
        console.log(`[N8N] ❌ Workflow startup failed (500) for agent ${agentId}: ${parsed?.message || 'Unknown error'}`);
        
        // Only retry 500 errors, with exponential backoff
        if (attempt < MAX_ATTEMPTS) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          console.log(`[N8N] 🔄 Retry attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delay}ms delay`);
          await sleep(delay);
          continue; // Retry
        }
        
        return { 
          success: false, 
          status: 500, 
          error: 'Workflow startup failed', 
          retries: attempt,
          hint: parsed?.message || 'Check n8n workflow for errors'
        };
      }

      // Other client errors (4xx) - don't retry
      if (status >= 400 && status < 500) {
        console.log(`[N8N] ❌ Client error (${status}) for agent ${agentId} - not retrying`);
        return { 
          success: false, 
          status, 
          error: `Client error: ${status}`,
          hint: parsed?.message || 'Check webhook configuration'
        };
      }

      // Server errors (5xx) - retry
      console.log(`[N8N] ⚠️ Server error (${status}) for agent ${agentId} - will retry`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[N8N] 🔄 Retry attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delay}ms delay`);
        await sleep(delay);
        continue;
      }
      
      return { 
        success: false, 
        status, 
        error: `Server error: ${status}`,
        retries: attempt
      };
      
    } catch (err) {
      const errorMessage = err.message;
      console.error(`[N8N] ❌ Network error for agent ${agentId}: ${errorMessage}`);
      
      // Log the error
      await logWebhookExecution(agentId, webhookUrl, enhancedPayload, 0, null, errorMessage);
      
      // Only retry on network errors, not on other errors
      if (attempt < MAX_ATTEMPTS && (err.name === 'AbortError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[N8N] 🔄 Retry attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delay}ms delay`);
        await sleep(delay);
        continue;
      }
      
      return { 
        success: false, 
        error: errorMessage,
        retries: attempt
      };
    }
  }
  
  console.error(`[N8N] 💥 All ${MAX_ATTEMPTS} attempts failed for agent ${agentId}`);
  return { 
    success: false, 
    error: 'Max retries exceeded',
    retries: MAX_ATTEMPTS
  };
}

module.exports = { triggerN8nWebhook };


