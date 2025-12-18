const { 
  default: makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState, 
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const EventEmitter = require('events');
const { supabaseAdmin } = require('../config/supabase');
const axios = require('axios');
const lockfile = require('proper-lockfile');
const https = require('https');

const STORAGE_BUCKET = 'agent-files';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const DEFAULT_AUDIO_BUCKET = 'agent-audio-messages';
const FALLBACK_AUDIO_BUCKET = process.env.AUDIO_FALLBACK_BUCKET || 'agent-files';
let audioBucketName = process.env.AUDIO_BUCKET || DEFAULT_AUDIO_BUCKET;
const DEFAULT_AUDIO_SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days
let audioBucketChecked = false;
const QR_EXPIRY_MS = 3 * 60 * 1000; // 3 minutes - WhatsApp QR code validity
const QR_EXPIRATION_MS = 60 * 1000; // 60 seconds - QR expiration for cleanup
const MAX_QR_PENDING_MS = 5 * 60 * 1000; // 5 minutes - Max time in qr_pending before reset

// SECURITY: Generate unique instance ID for multi-instance prevention
const os = require('os');
const INSTANCE_ID = `${os.hostname()}-${process.pid}-${Date.now()}`;
const INSTANCE_HOSTNAME = os.hostname();
const INSTANCE_PID = process.pid;

// Log instance information on startup
console.log('\n[BAILEYS] ========== INSTANCE INFORMATION ==========');
console.log(`[BAILEYS] Instance ID: ${INSTANCE_ID}`);
console.log(`[BAILEYS] Hostname: ${INSTANCE_HOSTNAME}`);
console.log(`[BAILEYS] Process ID: ${INSTANCE_PID}`);
console.log(`[BAILEYS] Started at: ${new Date().toISOString()}`);
console.log('[BAILEYS] ===============================================\n');

// Store active sessions in memory
const activeSessions = new Map();
const qrGenerationTracker = new Map();
const connectionLocks = new Map(); // agentId -> boolean
const lastConnectionAttempt = new Map(); // agentId -> timestamp ms
const last401Failure = new Map(); // agentId -> timestamp ms (prevents auto-retry after 401)
// Cache for @lid JID to actual phone number mapping (for linked device messages)
// Format: "@lid JID" -> "phone@s.whatsapp.net"
const lidToPhoneCache = new Map();
const COOLDOWN_MS = 5000; // 5 seconds between connection attempts
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes after 401 errors before allowing retry
const MESSAGE_FORWARD_TIMEOUT_MS = 10000;
const DEFAULT_MESSAGE_WEBHOOK_TEST = 'https://auto.nsolbpo.com/webhook-test/a18ff948-9380-4abe-a8d8-0912dae2d8ab';
const DEFAULT_MESSAGE_WEBHOOK_PROD = 'https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab';

const agentEventEmitter = new EventEmitter();
agentEventEmitter.setMaxListeners(0);

function emitAgentEvent(agentId, type, payload = {}) {
  agentEventEmitter.emit(`agent:${agentId}`, {
    type,
    payload,
    agentId,
    timestamp: new Date().toISOString()
  });
}

function subscribeToAgentEvents(agentId, listener) {
  const key = `agent:${agentId}`;
  agentEventEmitter.on(key, listener);
  return () => agentEventEmitter.off(key, listener);
}

function getInboundMessageWebhook() {
  const explicit = process.env.WHATSAPP_MESSAGE_WEBHOOK;
  if (explicit) {
    return explicit;
  }

  const prodSpecific = process.env.WHATSAPP_MESSAGE_WEBHOOK_PROD;
  const testSpecific = process.env.WHATSAPP_MESSAGE_WEBHOOK_TEST;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    return prodSpecific || testSpecific || DEFAULT_MESSAGE_WEBHOOK_PROD;
  }

  return testSpecific || prodSpecific || DEFAULT_MESSAGE_WEBHOOK_TEST;
}

/**
 * Check if an incoming WhatsApp message is a duplicate of a recent dashboard message
 * This prevents webhook spam when dashboard messages echo back via WhatsApp
 * @param {Object} params - Message parameters
 * @param {string} params.content - Message text content
 * @param {string} params.fromNumber - Sender phone number (sanitized)
 * @param {string} params.timestamp - Message timestamp (ISO string)
 * @param {number} params.timeWindow - Time window in ms (default 5000ms = 5s)
 * @param {string} params.agentId - Agent ID for filtering
 * @returns {Promise<boolean>} - True if duplicate found
 */
async function checkIfRecentDashboardMessage({ content, fromNumber, timestamp, timeWindow = 5000, agentId }) {
  if (!content || !fromNumber || !timestamp || !agentId) {
    return false; // Missing required params, allow webhook (fail open)
  }

  try {
    const timestampDate = new Date(timestamp);
    const windowStart = new Date(timestampDate.getTime() - timeWindow);
    const windowEnd = new Date(timestampDate.getTime() + timeWindow);
    
    // Query database for matching dashboard message within time window
    // The index on (source, sender_phone, received_at) will be used first,
    // then we filter by message_text in the WHERE clause
    const { data: recentMessage, error } = await supabaseAdmin
      .from('message_log')
      .select('id, message_text, received_at, source')
      .eq('agent_id', agentId)
      .eq('source', 'dashboard')
      .eq('sender_phone', fromNumber)
      .gte('received_at', windowStart.toISOString())
      .lte('received_at', windowEnd.toISOString())
      .eq('message_text', content.trim()) // Filter by content after index lookup
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      console.error('[BAILEYS][DUPLICATE-CHECK] Error checking for duplicate message:', error.message);
      return false; // On error, allow webhook to be sent (fail open)
    }
    
    if (recentMessage) {
      console.log(`[BAILEYS][DUPLICATE-CHECK] ✅ Duplicate detected: WhatsApp echo of dashboard message ${recentMessage.id}`);
      console.log(`[BAILEYS][DUPLICATE-CHECK] Dashboard message: ${recentMessage.received_at}, WhatsApp echo: ${timestamp}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('[BAILEYS][DUPLICATE-CHECK] Exception in checkIfRecentDashboardMessage:', error.message);
    return false; // On exception, allow webhook to be sent (fail open)
  }
}

async function forwardMessageToWebhook(agentId, messagePayload) {
  const webhookService = require('./webhookService');
  const webhookUrl = getInboundMessageWebhook();

  if (!webhookUrl) {
    console.warn('[BAILEYS][WEBHOOK] ⚠️ No inbound webhook configured. Skipping message forward.');
    return;
  }

  try {
    // CRITICAL: Fetch user_id from agents table before sending webhook
    let userId = null;
    try {
      const { data: agentData, error: agentError } = await supabaseAdmin
        .from('agents')
        .select('user_id')
        .eq('id', agentId)
        .single();

      if (agentError) {
        console.error(`[BAILEYS][WEBHOOK] ❌ Failed to fetch agent user_id:`, agentError.message);
        // Continue without user_id rather than failing completely
      } else if (agentData && agentData.user_id) {
        userId = agentData.user_id;
        console.log(`[BAILEYS][WEBHOOK] ✅ Fetched user_id for agent ${agentId}: ${userId}`);
      } else {
        console.warn(`[BAILEYS][WEBHOOK] ⚠️ Agent ${agentId} has no user_id set in database`);
      }
    } catch (fetchError) {
      console.error(`[BAILEYS][WEBHOOK] ❌ Error fetching user_id:`, fetchError.message);
      // Continue without user_id rather than failing completely
    }

    // Construct standardized webhook payload
    // Ensure source is always included (defaults to 'whatsapp' if not set)
    const webhookPayload = {
      source: messagePayload.source || 'whatsapp', // Default to 'whatsapp' for backward compatibility
      messageId: messagePayload.messageId || messagePayload.id,
      from: messagePayload.from,
      to: messagePayload.to,
      body: messagePayload.content || messagePayload.body || messagePayload.message_text || '',
      timestamp: messagePayload.timestamp || messagePayload.received_at || new Date().toISOString(),
      isFromMe: messagePayload.isFromMe !== undefined ? messagePayload.isFromMe : (messagePayload.fromMe || false),
      agentId: agentId,
      ...(userId && { user_id: userId }), // Include user_id only if it exists
      metadata: {
        ...(messagePayload.metadata || {}),
        messageType: messagePayload.messageType || messagePayload.type || 'text',
        conversationId: messagePayload.conversationId || messagePayload.remoteJid || null,
        senderName: messagePayload.senderName || null,
        mediaUrl: messagePayload.mediaUrl || null,
        mimetype: messagePayload.mimetype || null,
      }
    };

    // Use centralized webhook service with retry logic
    await webhookService.sendWebhook(webhookUrl, webhookPayload);

    const label = messagePayload.messageType || messagePayload.type || 'message';
    console.log(
      `[BAILEYS][WEBHOOK] ✅ Forwarded ${label} ${webhookPayload.messageId} from ${webhookPayload.from} (source: ${webhookPayload.source})${userId ? ` (user_id: ${userId})` : ''}`
    );
  } catch (error) {
    // Webhook service handles retries and logging, so we just log here
    console.error(
      `[BAILEYS][WEBHOOK] ❌ Error in forwardMessageToWebhook:`,
      error.message
    );
    // Don't throw - webhook failures shouldn't block message processing
  }
}

function sanitizeNumberFromJid(jid) {
  if (!jid || typeof jid !== 'string') {
    return null;
  }

  const atSplit = jid.split('@')[0] || '';
  const base = atSplit.split(':')[0];
  const digits = base.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function unwrapMessageContent(message) {
  if (!message) {
    return {};
  }

  if (message.ephemeralMessage?.message) {
    return unwrapMessageContent(message.ephemeralMessage.message);
  }

  if (message.viewOnceMessage?.message) {
    return unwrapMessageContent(message.viewOnceMessage.message);
  }

  return message;
}

function getExtensionFromMime(mimetype) {
  if (!mimetype || typeof mimetype !== 'string') {
    return 'ogg';
  }

  const mapping = {
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'audio/3gpp': '3gp',
    'audio/3gpp2': '3g2',
  };

  return mapping[mimetype.toLowerCase()] || mimetype.split('/').pop() || 'ogg';
}

async function ensureAudioBucket() {
  if (audioBucketChecked) {
    return;
  }

  try {
    let bucketExists = false;

    if (typeof supabaseAdmin.storage.getBucket === 'function') {
      const { data, error } = await supabaseAdmin.storage.getBucket(audioBucketName);
      bucketExists = Boolean(data) && !error;
    }

    if (!bucketExists) {
      const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
      if (listError) {
        console.error('[BAILEYS][STORAGE] ❌ Failed to list buckets:', listError);
        throw listError;
      }
      bucketExists = (buckets || []).some((bucket) => bucket.name === audioBucketName);
    }

    if (!bucketExists) {
      console.log('[BAILEYS][STORAGE] 🎵 Creating audio bucket:', audioBucketName);
      const { error: createError } = await supabaseAdmin.storage.createBucket(audioBucketName, {
        public: false,
      });

      if (createError && !createError.message?.toLowerCase().includes('already exists')) {
        console.error('[BAILEYS][STORAGE] ❌ Failed to create audio bucket:', createError);
        if (audioBucketName !== FALLBACK_AUDIO_BUCKET) {
          console.warn(
            '[BAILEYS][STORAGE] ⚠️ Falling back to existing bucket:',
            FALLBACK_AUDIO_BUCKET
          );
          audioBucketName = FALLBACK_AUDIO_BUCKET;
          audioBucketChecked = false;
          return ensureAudioBucket();
        }
        throw createError;
      }
    }

    audioBucketChecked = true;
  } catch (error) {
    console.error('[BAILEYS][STORAGE] ❌ Unable to ensure audio bucket:', error);
    if (audioBucketName !== FALLBACK_AUDIO_BUCKET) {
      console.warn('[BAILEYS][STORAGE] ⚠️ Switching to fallback bucket:', FALLBACK_AUDIO_BUCKET);
      audioBucketName = FALLBACK_AUDIO_BUCKET;
      audioBucketChecked = false;
      await ensureAudioBucket();
    } else {
      throw error;
    }
  }
}

async function saveAudioFile(buffer, agentId, messageId, mimetype = 'audio/ogg') {
  await ensureAudioBucket();

  const extension = getExtensionFromMime(mimetype);
  const normalizedAgentId = agentId.replace(/[^a-zA-Z0-9-_]/g, '');
  const baseFileName = `${Date.now()}-${messageId}`.replace(/[^a-zA-Z0-9-_]/g, '');
  let storagePath = `${normalizedAgentId}/${baseFileName}.${extension}`;

  const uploadOptions = {
    cacheControl: '3600',
    upsert: false,
    contentType: mimetype,
  };

  // Retry configuration for network errors
  const MAX_RETRIES = 3;
  const INITIAL_RETRY_DELAY = 1000; // 1 second
  const MAX_RETRY_DELAY = 10000; // 10 seconds

  // Helper function to check if error is retryable (network errors)
  const isRetryableError = (error) => {
    if (!error) return false;
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || error.originalError?.code || '';
    const errorCause = error.originalError?.cause?.code || '';
    
    // Check for network-related errors
    return errorMessage.includes('fetch failed') ||
           errorMessage.includes('econnreset') ||
           errorMessage.includes('network') ||
           errorMessage.includes('timeout') ||
           errorCode === 'ECONNRESET' ||
           errorCode === 'ETIMEDOUT' ||
           errorCode === 'ENOTFOUND' ||
           errorCause === 'ECONNRESET' ||
           errorCause === 'ETIMEDOUT';
  };

  // Retry logic with exponential backoff
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { error } = await supabaseAdmin.storage.from(audioBucketName).upload(storagePath, buffer, uploadOptions);
      
      if (!error) {
        // Success!
        break;
      }

      // Handle file exists error (not retryable, but needs different path)
      if (error.message?.includes('exists')) {
        const uniqueSuffix = randomUUID().slice(0, 8);
        storagePath = `${normalizedAgentId}/${baseFileName}-${uniqueSuffix}.${extension}`;
        const { error: retryError } = await supabaseAdmin.storage
          .from(audioBucketName)
          .upload(storagePath, buffer, uploadOptions);
        if (!retryError) {
          // Success with new path
          break;
        }
        lastError = retryError;
        // If retry with new path fails due to network, continue retry loop
        if (isRetryableError(retryError) && attempt < MAX_RETRIES) {
          lastError = retryError;
          continue;
        }
        throw retryError;
      }

      // Check if error is retryable
      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        lastError = error;
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
        console.warn(`[BAILEYS][STORAGE] ⚠️ Network error on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${delay}ms:`, error.message || error.code);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Non-retryable error or max retries reached
      lastError = error;
      break;
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
        console.warn(`[BAILEYS][STORAGE] ⚠️ Network error on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${delay}ms:`, error.message || error.code);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Non-retryable error or max retries reached
      break;
    }
  }

  // If we still have an error after all retries
  if (lastError) {
    console.error('[BAILEYS][STORAGE] ❌ Failed to upload audio after retries:', {
      message: lastError.message,
      code: lastError.code || lastError.originalError?.code,
      cause: lastError.originalError?.cause?.code,
      attempts: MAX_RETRIES + 1
    });
    throw lastError;
  }

  // Generate signed URL with retry logic for network errors
  let mediaUrl = null;
  const URL_MAX_RETRIES = 2;
  const URL_RETRY_DELAY = 500;

  for (let attempt = 0; attempt <= URL_MAX_RETRIES; attempt++) {
    try {
      const ttl = Number(process.env.AUDIO_SIGNED_URL_TTL || DEFAULT_AUDIO_SIGNED_URL_TTL);
      const { data, error } = await supabaseAdmin.storage
        .from(audioBucketName)
        .createSignedUrl(storagePath, ttl);

      if (!error && data?.signedUrl) {
        mediaUrl = data.signedUrl;
        break;
      }

      // If error is network-related and we have retries left, retry
      const isUrlNetworkError = error && (
        error.message?.toLowerCase().includes('fetch failed') ||
        error.message?.toLowerCase().includes('econnreset') ||
        error.message?.toLowerCase().includes('network') ||
        error.message?.toLowerCase().includes('timeout') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT'
      );
      
      if (isUrlNetworkError && attempt < URL_MAX_RETRIES) {
        console.warn(`[BAILEYS][STORAGE] ⚠️ Network error creating signed URL (attempt ${attempt + 1}/${URL_MAX_RETRIES + 1}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, URL_RETRY_DELAY * (attempt + 1)));
        continue;
      }

      // Non-retryable error or max retries - try public URL fallback
      if (error) {
        console.warn('[BAILEYS][STORAGE] ⚠️ Failed to create signed URL, attempting public URL fallback:', error.message);
        try {
          const { data: publicData } = await supabaseAdmin.storage.from(audioBucketName).getPublicUrl(storagePath);
          mediaUrl = publicData?.publicUrl || null;
        } catch (publicUrlError) {
          console.warn('[BAILEYS][STORAGE] ⚠️ Failed to get public URL as fallback:', publicUrlError.message);
        }
      }
      break;
    } catch (error) {
      // If error is network-related and we have retries left, retry
      const isUrlNetworkError = error && (
        error.message?.toLowerCase().includes('fetch failed') ||
        error.message?.toLowerCase().includes('econnreset') ||
        error.message?.toLowerCase().includes('network') ||
        error.message?.toLowerCase().includes('timeout') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT'
      );
      
      if (isUrlNetworkError && attempt < URL_MAX_RETRIES) {
        console.warn(`[BAILEYS][STORAGE] ⚠️ Network error generating URL (attempt ${attempt + 1}/${URL_MAX_RETRIES + 1}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, URL_RETRY_DELAY * (attempt + 1)));
        continue;
      }
      console.warn('[BAILEYS][STORAGE] ⚠️ Error generating audio URL:', error.message);
      break;
    }
  }

  console.log('[BAILEYS][STORAGE] 🎵 Audio stored', {
    storagePath,
    mimetype,
    bytes: buffer?.length || 0,
    hasUrl: !!mediaUrl,
  });

  return {
    url: mediaUrl,
    path: storagePath,
  };
}

// Sync credentials from files to database
// Called after every creds.update event to ensure database has latest credentials
async function syncCredsToDatabase(agentId) {
  console.log(`[BAILEYS] 💾 Syncing credentials to database for ${agentId.substring(0, 40)}`);
  
  const authPath = path.join(__dirname, '../../auth_sessions', agentId);
  const credsPath = path.join(authPath, 'creds.json');
  
  // CRITICAL: Use file locking to prevent concurrent reads during writes
  let release = null;
  
  try {
    // Ensure directory exists
    if (!fs.existsSync(authPath)) {
      try {
        fs.mkdirSync(authPath, { recursive: true });
        console.log(`[BAILEYS] 📁 Created auth directory for sync: ${authPath}`);
      } catch (mkdirError) {
        console.error(`[BAILEYS] ❌ Error creating auth directory for sync:`, mkdirError);
        return;
      }
    }
    
    if (!fs.existsSync(credsPath)) {
      console.log(`[BAILEYS] ℹ️ No credentials file to sync`);
      return;
    }
    
    // Acquire lock before reading (prevents reading during write)
    try {
      release = await lockfile.lock(credsPath, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000
        },
        stale: 10000 // Consider lock stale after 10 seconds
      });
    } catch (lockError) {
      console.error('[BAILEYS] ❌ Could not acquire file lock (file might be corrupted):', lockError.message);
      // Don't sync if we can't get lock - file might be mid-write
      return;
    }
    
    // Read with lock held
    const rawCreds = fs.readFileSync(credsPath, 'utf-8');
    
    if (!rawCreds || rawCreds.trim().length === 0) {
      console.warn('[BAILEYS] ⚠️ Credentials file is empty - skipping sync');
      return;
    }
    
    let credsData;
    try {
      credsData = JSON.parse(rawCreds);
    } catch (parseError) {
      console.error('[BAILEYS] ❌ Failed to parse creds.json, skipping sync:', parseError.message);
      return;
    }
    
    // REMOVED: Strict validation - Baileys has already validated these credentials
    // Trust Baileys' internal format (Buffer objects, not base64 strings)
    
    // Save to database
    const { error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .upsert({
        agent_id: agentId,
        session_data: { creds: credsData },
        updated_at: new Date().toISOString()
      }, { onConflict: 'agent_id' });
      
    if (error) throw error;
    
    console.log(`[BAILEYS] ✅ Credentials synced to database successfully`);
    
  } catch (error) {
    console.error(`[BAILEYS] ❌ Error syncing to database:`, error);
  } finally {
    // Always release lock
    if (release) {
      try {
        await release();
      } catch (releaseError) {
        console.error('[BAILEYS] ⚠️ Error releasing file lock:', releaseError.message);
      }
    }
  }
}

// CRITICAL: Helper to safely get key length from various formats
function getKeyLength(key) {
  if (Buffer.isBuffer(key)) {
    return key.length;
  }
  if (typeof key === 'string') {
    // Try to decode as base64 first, then as raw string
    try {
      return Buffer.from(key, 'base64').length;
    } catch {
      return Buffer.from(key).length;
    }
  }
  if (key instanceof Uint8Array || Array.isArray(key)) {
    return Buffer.from(key).length;
  }
  if (typeof key === 'object' && key !== null) {
    // Handle objects that might be serialized Buffers/Uint8Arrays
    try {
      if (key.type === 'Buffer' && Array.isArray(key.data)) {
        // JSON-serialized Buffer: { type: 'Buffer', data: [1,2,3,...] }
        return key.data.length;
      }
      // Try to convert object to array
      const arr = Object.values(key);
      if (arr.length > 0 && typeof arr[0] === 'number') {
        return Buffer.from(arr).length;
      }
      // Last resort: try Buffer.from directly
      return Buffer.from(key).length;
    } catch (e) {
      throw new Error(`Cannot convert key to Buffer: ${e.message}`);
    }
  }
  throw new Error(`Unsupported key type: ${typeof key}`);
}

// CRITICAL: Validate credential integrity to prevent Bad MAC errors
// Returns { valid: boolean, reason: string }
function validateCredentialIntegrity(creds) {
  if (!creds || typeof creds !== 'object') {
    return { valid: false, reason: 'Credentials not an object' };
  }
  
  // Check required keys
  if (!creds.noiseKey || !creds.signedIdentityKey || !creds.signedPreKey) {
    return { 
      valid: false, 
      reason: `Missing required keys: ${!creds.noiseKey ? 'noiseKey ' : ''}${!creds.signedIdentityKey ? 'signedIdentityKey ' : ''}${!creds.signedPreKey ? 'signedPreKey' : ''}`
    };
  }
  
  // Check key structures
  if (!creds.noiseKey.private || !creds.noiseKey.public) {
    return { valid: false, reason: 'Noise key missing private/public components' };
  }
  
  // Check key lengths (prevent truncated keys)
  // CRITICAL: Handle different key formats (Buffer, Uint8Array, string, object)
  let noisePrivateLen, noisePublicLen;
  try {
    noisePrivateLen = getKeyLength(creds.noiseKey.private);
    noisePublicLen = getKeyLength(creds.noiseKey.public);
  } catch (e) {
    return { valid: false, reason: `Error checking noise key lengths: ${e.message}` };
  }
  
  if (noisePrivateLen !== 32) {
    return { 
      valid: false, 
      reason: `Noise private key invalid length: ${noisePrivateLen} (expected 32)` 
    };
  }
  
  if (noisePublicLen !== 32) {
    return { 
      valid: false, 
      reason: `Noise public key invalid length: ${noisePublicLen} (expected 32)` 
    };
  }
  
  return { valid: true };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MULTI-LAYER CONNECTION MONITORING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Storage for monitoring intervals
const connectionMonitors = new Map();
const healthCheckIntervals = new Map();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER 1: WebSocket State Monitor - DISABLED
// 
// ⚠️ CRITICAL: This monitor has been DISABLED because it causes FALSE POSITIVES.
// 
// Problem: In Baileys, `sock.ws?.readyState` returns `undefined` because:
// - Baileys wraps the WebSocket in a nested structure
// - The path `sock.ws.readyState` doesn't exist as expected
// - This causes the monitor to think the connection is dead (undefined !== 1)
// - Result: Unnecessary reconnection every 30 seconds even when connection is WORKING
//
// Solution: Use these alternatives instead (which work correctly):
// 1. Health ping monitor (60s) - Actively tests connection with query, detects real issues
// 2. Connection events (immediate) - Baileys fires 'close' event on actual disconnection
// 3. Database heartbeat (60s) - For multi-instance coordination
//
// The health ping monitor at 60s intervals is sufficient for detecting real disconnections
// while avoiding false positives from WebSocket state checks.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startConnectionStateMonitor(sock, agentId) {
  // DISABLED: Do not start any interval - just log that we're using better alternatives
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... ℹ️ WebSocket state monitor DISABLED (causes false positives)`);
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... ✅ Using: Health pings (60s) + Connection events + DB heartbeat`);
  
  // Clean up any existing monitor if it was somehow started
  if (connectionMonitors.has(agentId)) {
    clearInterval(connectionMonitors.get(agentId));
    connectionMonitors.delete(agentId);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER 2: Health Check with Ping (every 60 seconds)
// Actively tests connection by sending a query
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startHealthPingMonitor(sock, agentId) {
  // Clear existing health check if any
  if (healthCheckIntervals.has(agentId)) {
    clearInterval(healthCheckIntervals.get(agentId));
  }
  
  const healthInterval = setInterval(async () => {
    try {
      const session = activeSessions.get(agentId);
      if (!session || !session.isConnected) {
        console.log(`[HEALTH] ${agentId.substring(0, 8)}... Session not connected, stopping health check`);
        clearInterval(healthInterval);
        healthCheckIntervals.delete(agentId);
        return;
      }
      
      const startTime = Date.now();
      
      // Send a lightweight query to test connection
      // This uses Baileys internal mechanism to verify connection is alive
      await sock.query({
        tag: 'iq',
        attrs: {
          to: '@s.whatsapp.net',
          type: 'get',
          xmlns: 'w:p'
        },
        content: [{ tag: 'ping', attrs: {} }]
      });
      
      const latency = Date.now() - startTime;
      console.log(`[HEALTH] ${agentId.substring(0, 8)}... ✅ Health check PASSED (${latency}ms)`);
      
      // Update connection quality in database (silently)
      try {
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            last_heartbeat: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
      } catch (dbError) {
        // Ignore DB errors for health check
      }
      
    } catch (error) {
      console.error(`[HEALTH] ${agentId.substring(0, 8)}... ❌ Health check FAILED:`, error.message);
      
      const session = activeSessions.get(agentId);
      if (session) {
        // Only trigger reconnection if session thinks it's connected
        if (session.isConnected) {
          clearInterval(healthInterval);
          healthCheckIntervals.delete(agentId);
          
          session.isConnected = false;
          
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          await handleSmartReconnection(agentId, 'health_check_failed', 1);
        }
      }
    }
  }, 60000); // 60 seconds
  
  healthCheckIntervals.set(agentId, healthInterval);
  console.log(`[HEALTH] ${agentId.substring(0, 8)}... ✅ Health ping monitor started (60s interval)`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER 3: Database Heartbeat (every 60 seconds) - PASSIVE
// Updates last_heartbeat in database for multi-instance coordination
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startHeartbeat(agentId, session) {
  // Simple heartbeat - just update database every 60 seconds
  // This is PASSIVE monitoring only - no connection interference
  const heartbeat = setInterval(async () => {
    const currentSession = activeSessions.get(agentId);
    
    // Stop if session removed or not connected
    if (!currentSession || !currentSession.isConnected) {
      clearInterval(heartbeat);
      return;
    }
    
    // Just update heartbeat in database - no reconnection logic
    try {
      await supabaseAdmin
        .from('whatsapp_sessions')
        .update({
          last_heartbeat: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('agent_id', agentId);
    } catch (error) {
      // Silently ignore heartbeat errors - not critical
    }
  }, 60000); // Every 60 seconds
  
  if (session) {
    session.heartbeatInterval = heartbeat;
  }
  
  return heartbeat;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cleanup all monitoring for an agent
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function cleanupMonitoring(agentId) {
  console.log(`[CLEANUP] ${agentId.substring(0, 8)}... Cleaning up all monitoring...`);
  
  // Clear connection state monitor
  const monitor = connectionMonitors.get(agentId);
  if (monitor) {
    clearInterval(monitor);
    connectionMonitors.delete(agentId);
    console.log(`[CLEANUP] ${agentId.substring(0, 8)}... WebSocket monitor cleared`);
  }
  
  // Clear health check
  const health = healthCheckIntervals.get(agentId);
  if (health) {
    clearInterval(health);
    healthCheckIntervals.delete(agentId);
    console.log(`[CLEANUP] ${agentId.substring(0, 8)}... Health check cleared`);
  }
  
  // Clear heartbeat from session
  const session = activeSessions.get(agentId);
  if (session?.heartbeatInterval) {
    clearInterval(session.heartbeatInterval);
    session.heartbeatInterval = null;
    console.log(`[CLEANUP] ${agentId.substring(0, 8)}... Heartbeat cleared`);
  }
  
  // Close socket if exists
  if (session?.socket) {
    try {
      session.socket.ev?.removeAllListeners();
      session.socket.ws?.close();
    } catch (err) {
      console.error(`[CLEANUP] ${agentId.substring(0, 8)}... Error closing socket:`, err.message);
    }
  }
  
  console.log(`[CLEANUP] ${agentId.substring(0, 8)}... ✅ Cleanup complete`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Start all monitoring for an agent (called after connection.open)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startAllMonitoring(sock, agentId, session) {
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... 🔍 Starting monitoring layers...`);
  
  // Layer 1: Event-based monitoring (via connection.update listener - already active)
  // Baileys fires 'connection': 'close' immediately when socket disconnects
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... ✅ Event-based monitoring active (connection.update listener)`);
  
  // Layer 2: Health ping monitor (60s) - Actively tests connection quality
  // This is the PRIMARY disconnection detection mechanism
  startHealthPingMonitor(sock, agentId);
  
  // Layer 3: Database heartbeat (60s) - For multi-instance coordination
  startHeartbeat(agentId, session);
  
  // NOTE: WebSocket state monitor is DISABLED - it caused false reconnections
  // See startConnectionStateMonitor() comments for full explanation
  // startConnectionStateMonitor(sock, agentId);  // ← DISABLED
  
  console.log(`[MONITOR] ${agentId.substring(0, 8)}... ✅ Monitoring active: Health pings (60s) + DB heartbeat (60s) + Connection events`);
}

// CRITICAL: Backup credentials to prevent data loss
async function backupCredentials(agentId) {
  try {
    const authPath = path.join(__dirname, '../../auth_sessions', agentId);
    const credsPath = path.join(authPath, 'creds.json');
    
    if (!fs.existsSync(credsPath)) {
      return;
    }
    
    // Create backup with timestamp
    const timestamp = Date.now();
    const backupPath = path.join(authPath, `creds.json.backup.${timestamp}`);
    
    fs.copyFileSync(credsPath, backupPath);
    console.log(`[BAILEYS] 💾 Credentials backed up to ${backupPath}`);
    
    // Keep only last 3 backups
    const backupFiles = fs.readdirSync(authPath)
      .filter(f => f.startsWith('creds.json.backup.'))
      .sort()
      .reverse();
    
    if (backupFiles.length > 3) {
      for (const oldBackup of backupFiles.slice(3)) {
        fs.unlinkSync(path.join(authPath, oldBackup));
        console.log(`[BAILEYS] 🗑️ Deleted old backup: ${oldBackup}`);
      }
    }
    
  } catch (error) {
    console.error(`[BAILEYS] ⚠️ Backup failed:`, error.message);
  }
}

// Validate credential freshness before using existing credentials
// Returns { valid: boolean, reason: string }
async function validateCredentialFreshness(agentId, creds) {
  console.log(`[BAILEYS] 🔍 Validating credential freshness for ${agentId.substring(0, 40)}...`);
  
  try {
    // CRITICAL: Add timeout to prevent hanging on slow database queries
    const DB_QUERY_TIMEOUT_MS = 5000; // 5 seconds
    
    let sessionData, statusError;
    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database query timeout')), DB_QUERY_TIMEOUT_MS)
      );
      
      // Race database query against timeout
      const queryPromise = supabaseAdmin
        .from('whatsapp_sessions')
        .select('status, is_active, disconnected_at, updated_at')
        .eq('agent_id', agentId)
        .maybeSingle();
      
      const result = await Promise.race([queryPromise, timeoutPromise]);
      sessionData = result.data;
      statusError = result.error;
    } catch (timeoutError) {
      if (timeoutError.message === 'Database query timeout') {
        console.error(`[BAILEYS] ❌ Database query timeout after ${DB_QUERY_TIMEOUT_MS}ms`);
        // On timeout, be conservative and reject credentials
        return {
          valid: false,
          reason: `Database query timeout - cannot verify credential freshness`
        };
      }
      // Re-throw other errors
      throw timeoutError;
    }
    
    if (statusError) {
      console.warn(`[BAILEYS] ⚠️ Error checking session status:`, statusError);
      // If we can't check status, be conservative and reject credentials
      return {
        valid: false,
        reason: `Database status check failed: ${statusError.message}`
      };
    }
    
    if (sessionData) {
      // CRITICAL: If status is 'disconnected' or 'conflict', credentials are stale
      if (sessionData.status === 'disconnected') {
        console.log(`[BAILEYS] ❌ Credentials rejected: Session status is 'disconnected' (manual disconnect)`);
        return {
          valid: false,
          reason: 'Session was manually disconnected - credentials are stale'
        };
      }
      
      if (sessionData.status === 'conflict') {
        console.log(`[BAILEYS] ❌ Credentials rejected: Session status is 'conflict' (401/440 error)`);
        return {
          valid: false,
          reason: 'Session has conflict status - credentials are invalidated'
        };
      }
      
      // Check if credentials are older than disconnect timestamp (if available)
      if (sessionData.disconnected_at && creds) {
        const disconnectTime = new Date(sessionData.disconnected_at).getTime();
        // If we have a way to timestamp credentials, check them
        // For now, we rely on status check above
      }
    }
    
    // Check 2: Credential structure - must have me.id to be valid
    if (!creds || typeof creds !== 'object') {
      console.log(`[BAILEYS] ❌ Credentials rejected: Invalid structure (not an object)`);
      return {
        valid: false,
        reason: 'Invalid credential structure'
      };
    }
    
    if (!creds.me || !creds.me.id) {
      console.log(`[BAILEYS] ❌ Credentials rejected: Missing device ID (me.id)`);
      return {
        valid: false,
        reason: 'Credentials missing device ID - not paired'
      };
    }
    
    // Check 3: Registration state - if registered=false AND status is disconnected, credentials are stale
    // Note: registered=false is normal after QR pairing, so we only check this in combination with status
    if (creds.registered === false && sessionData?.status === 'disconnected') {
      console.log(`[BAILEYS] ❌ Credentials rejected: Unregistered credentials from disconnected session`);
      return {
        valid: false,
        reason: 'Unregistered credentials from disconnected session'
      };
    }
    
    // All checks passed
    console.log(`[BAILEYS] ✅ Credentials validated: Fresh and valid`);
    console.log(`[BAILEYS] Device ID: ${creds.me.id.split(':')[0]}, Registered: ${creds.registered}, Status: ${sessionData?.status || 'unknown'}`);
    return {
      valid: true,
      reason: 'Credentials are fresh and valid'
    };
    
  } catch (error) {
    console.error(`[BAILEYS] ❌ Error validating credentials:`, error);
    // On error, be conservative and reject credentials
    return {
      valid: false,
      reason: `Validation error: ${error.message}`
    };
  }
}

// Restore credentials from database to files
// Called when local files don't exist but database might have saved credentials
async function restoreCredsFromDatabase(agentId) {
  console.log(`[BAILEYS] 🔄 Attempting to restore credentials from database...`);
  
  try {
    // CRITICAL: Check session status first - don't restore if corrupted/conflict
    const { data: sessionStatus, error: statusError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, is_active')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (statusError) {
      console.error(`[BAILEYS] ⚠️ Error checking session status:`, statusError);
      // Continue to try restore, but log warning
    } else if (sessionStatus) {
      // Don't restore if session is in conflict or disconnected state
      if (sessionStatus.status === 'conflict' || sessionStatus.status === 'disconnected') {
        console.log(`[BAILEYS] ⚠️ Session is in ${sessionStatus.status} state - skipping credential restore`);
        console.log(`[BAILEYS] This indicates corrupted/invalid credentials - will generate fresh QR`);
        return false;
      }
    }
    
    const { data, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('session_data')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (error) throw error;
    
    if (!data || !data.session_data?.creds) {
      console.log(`[BAILEYS] ℹ️ No credentials in database to restore`);
      return false;
    }
    
    // Validate credentials structure before restoring
    const creds = data.session_data.creds;
    if (!creds || typeof creds !== 'object') {
      console.log(`[BAILEYS] ⚠️ Invalid credentials structure in database - skipping restore`);
      return false;
    }
    
    // CRITICAL: Validate credential freshness before restoring
    const validation = await validateCredentialFreshness(agentId, creds);
    if (!validation.valid) {
      console.log(`[BAILEYS] ⚠️ Credentials in database are stale: ${validation.reason}`);
      console.log(`[BAILEYS] Will not restore - will generate fresh QR instead`);
      return false;
    }
    
    const authPath = path.join(__dirname, '../../auth_sessions', agentId);
    const credsPath = path.join(authPath, 'creds.json');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(authPath)) {
      fs.mkdirSync(authPath, { recursive: true });
    }
    
    // Write credentials to file
    fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
    
    console.log(`[BAILEYS] ✅ Credentials restored from database to ${credsPath}`);
    console.log(`[BAILEYS] Restored creds: has me=${!!creds.me}, registered=${creds.registered}`);
    
    return true;
  } catch (error) {
    console.error(`[BAILEYS] ❌ Error restoring from database:`, error);
    return false;
  }
}

// Network connectivity check
async function checkNetworkRequirements() {
  console.log(`[BAILEYS] 🌐 Checking network connectivity...`);
  
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get('https://web.whatsapp.com', { timeout: 5000 }, (res) => {
      console.log(`[BAILEYS] ✅ WhatsApp Web reachable (status: ${res.statusCode})`);
      resolve(true);
    });
    
    req.on('error', (error) => {
      console.error(`[BAILEYS] ❌ Cannot reach WhatsApp servers:`, error.message);
      console.error(`[BAILEYS] Please check: 1) Internet connection 2) Firewall 3) Proxy`);
      resolve(false);
    });
    
    req.on('timeout', () => {
      console.error(`[BAILEYS] ❌ Connection timeout to WhatsApp servers`);
      req.destroy();
      resolve(false);
    });
  });
}

// Helper function to check if a PID exists on the system
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    // Signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = No such process
    return false;
  }
}

// CRITICAL: Ensure agent has unique session - prevent credential sharing
async function ensureAgentIsolation(agentId) {
  console.log(`[BAILEYS] 🔒 Ensuring agent isolation for: ${agentId.substring(0, 40)}`);
  
  try {
    // Step 1: Check if agent already has active session IN THIS INSTANCE
    const existingSession = activeSessions.get(agentId);
    if (existingSession) {
      // CRITICAL FIX: Don't do full logout - just clean up the socket
      // Full logout deletes credentials which breaks reconnection!
      console.log(`[BAILEYS] ⚠️ Agent already has session in this instance - cleaning up socket only`);
      
      // Stop intervals
      if (existingSession.heartbeatInterval) {
        clearInterval(existingSession.heartbeatInterval);
        existingSession.heartbeatInterval = null;
      }
      
      // Close socket without logout (preserves credentials)
      if (existingSession.socket) {
        try {
          existingSession.socket.ev?.removeAllListeners();
          existingSession.socket.end?.();
        } catch (e) {
          // Ignore socket cleanup errors
        }
        existingSession.socket = null;
      }
      
      // Clear from memory but DON'T clear database credentials
      activeSessions.delete(agentId);
      qrGenerationTracker.delete(agentId);
      
      console.log(`[BAILEYS] ✅ Socket cleaned up - credentials preserved`);
    }
    
    // Step 2: Check database for OTHER instances using this agent
    const { data: dbSession, error: dbError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, phone_number, is_active, instance_id, instance_hostname, instance_pid, last_heartbeat')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (dbError) {
      console.error(`[BAILEYS] ⚠️ Database error checking isolation:`, dbError);
      // Continue anyway - don't block initialization
      return;
    }
    
    if (dbSession && dbSession.is_active && dbSession.instance_id) {
      // Another instance is using this agent
      if (dbSession.instance_id !== INSTANCE_ID) {
        const timeSinceHeartbeat = dbSession.last_heartbeat 
          ? Date.now() - new Date(dbSession.last_heartbeat).getTime()
          : null;
        
        // Check if PID actually exists (for same hostname only)
        const pidExists = dbSession.instance_hostname === INSTANCE_HOSTNAME && dbSession.instance_pid
          ? isPidAlive(dbSession.instance_pid)
          : null;
        
        // If PID doesn't exist (dead process), take over immediately
        if (pidExists === false) {
          // PID doesn't exist - process is dead, we can take over
          console.log(`[BAILEYS] ⚠️ Found dead instance (PID ${dbSession.instance_pid} doesn't exist)`);
          console.log(`[BAILEYS] ⚠️ Taking over session from dead instance`);
          console.log(`[BAILEYS] Previous Instance: ${dbSession.instance_hostname} (${dbSession.instance_id})`);
          console.log(`[BAILEYS] New Instance: ${INSTANCE_HOSTNAME} (${INSTANCE_ID})`);
        } else if (timeSinceHeartbeat && timeSinceHeartbeat < 2 * 60 * 1000) {
          // PID exists or unknown, and heartbeat is recent (< 2 min) - real conflict
          console.error(`[BAILEYS] ❌ MULTI-INSTANCE CONFLICT DETECTED!`);
          console.error(`[BAILEYS] ❌ Agent ${agentId.substring(0, 40)} is ALREADY ACTIVE on another instance:`);
          console.error(`[BAILEYS] ❌ Other Instance ID: ${dbSession.instance_id}`);
          console.error(`[BAILEYS] ❌ Other Hostname: ${dbSession.instance_hostname}`);
          console.error(`[BAILEYS] ❌ Other PID: ${dbSession.instance_pid} ${pidExists === true ? '(ALIVE)' : pidExists === false ? '(DEAD)' : '(UNKNOWN - different hostname)'}`);
          console.error(`[BAILEYS] ❌ Last Heartbeat: ${timeSinceHeartbeat / 1000}s ago`);
          console.error(`[BAILEYS] ❌ Phone: ${dbSession.phone_number}`);
          console.error(`[BAILEYS] `);
          console.error(`[BAILEYS] 🚨 CRITICAL: This will cause 401/440 errors and session conflicts!`);
          console.error(`[BAILEYS] 🚨 ACTION REQUIRED: Stop the other instance or use a different agent.`);
          console.error(`[BAILEYS] `);
          console.error(`[BAILEYS] Current Instance: ${INSTANCE_HOSTNAME} (${INSTANCE_ID})`);
          console.error(`[BAILEYS] Other Instance: ${dbSession.instance_hostname} (${dbSession.instance_id})`);
          
          // Mark as conflict in database
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              status: 'conflict',
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          throw new Error(`Multi-instance conflict: Agent ${agentId.substring(0, 20)} is already active on ${dbSession.instance_hostname}`);
        } else {
          // Stale heartbeat (>5 min) - assume other instance died, we can take over
          console.log(`[BAILEYS] ⚠️ Found stale session from another instance (heartbeat ${timeSinceHeartbeat ? Math.round(timeSinceHeartbeat/1000) : 'unknown'}s ago)`);
          console.log(`[BAILEYS] ⚠️ Assuming other instance crashed - taking over session`);
          console.log(`[BAILEYS] Previous Instance: ${dbSession.instance_hostname} (${dbSession.instance_id})`);
          console.log(`[BAILEYS] New Instance: ${INSTANCE_HOSTNAME} (${INSTANCE_ID})`);
        }
      } else {
        // Same instance - this is fine
        console.log(`[BAILEYS] ✅ Session belongs to this instance - proceeding`);
      }
    }
    
    // Step 3: Check if phone number is used by another agent
    if (dbSession && dbSession.phone_number && dbSession.is_active) {
      const phoneNumber = dbSession.phone_number;
      
      const { data: conflictingSessions } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('agent_id, phone_number, instance_id, instance_hostname')
        .eq('phone_number', phoneNumber)
        .eq('is_active', true)
        .neq('agent_id', agentId);
      
      if (conflictingSessions && conflictingSessions.length > 0) {
        console.error(`[BAILEYS] ❌ PHONE NUMBER CONFLICT: ${phoneNumber} is linked to multiple agents:`);
        conflictingSessions.forEach((session, i) => {
          console.error(`[BAILEYS] ❌   ${i+1}. Agent: ${session.agent_id.substring(0, 20)} on ${session.instance_hostname}`);
        });
        console.error(`[BAILEYS] ❌ This violates WhatsApp's one-device-per-number policy!`);
      }
    }
    
    // Step 4: Check in-memory sessions for phone number conflicts
    if (dbSession && dbSession.phone_number) {
      const phoneNumber = dbSession.phone_number;
      
      for (const [otherId, session] of activeSessions.entries()) {
        if (otherId !== agentId && session.phoneNumber === phoneNumber && session.isConnected) {
          console.error(`[BAILEYS] ❌ MEMORY CONFLICT: Phone ${phoneNumber} is in use by agent ${otherId.substring(0, 20)}`);
          throw new Error(`Phone number ${phoneNumber} is currently in use by another agent.`);
        }
      }
    }
    
    console.log(`[BAILEYS] ✅ Agent isolation verified - safe to proceed`);
    
  } catch (error) {
    console.error(`[BAILEYS] ❌ Agent isolation check failed:`, error.message);
    throw error;
  }
}

// CRITICAL: Network diagnostic function for pairing failures
async function diagnoseNetworkIssue(agentId) {
  console.log(`[BAILEYS] 🔍 Running network diagnostics for pairing failure...`);
  
  // Test 1: Basic connectivity
  try {
    const https = require('https');
    await new Promise((resolve, reject) => {
      const req = https.get('https://web.whatsapp.com', { timeout: 5000 }, (res) => {
        console.log(`[BAILEYS] ✅ WhatsApp Web reachable (status: ${res.statusCode})`);
        resolve();
      });
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Timeout')));
    });
  } catch (error) {
    console.error(`[BAILEYS] ❌ WhatsApp Web unreachable:`, error.message);
    console.error(`[BAILEYS] 💡 Check: 1) Internet connection 2) Firewall 3) Proxy settings`);
  }
  
  // Test 2: DNS resolution
  try {
    const dns = require('dns').promises;
    const addresses = await dns.resolve4('web.whatsapp.com');
    console.log(`[BAILEYS] ✅ DNS resolution successful: ${addresses[0]}`);
  } catch (error) {
    console.error(`[BAILEYS] ❌ DNS resolution failed:`, error.message);
  }
  
  // Test 3: WebSocket connectivity (optional - requires 'ws' module)
  try {
    const WebSocket = require('ws');
    const ws = new WebSocket('wss://web.whatsapp.com/ws/chat', {
      handshakeTimeout: 10000
    });
    
    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        console.log(`[BAILEYS] ✅ WebSocket connection successful`);
        ws.close();
        resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket timeout')), 10000);
    });
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log(`[BAILEYS] ℹ️ WebSocket test skipped (ws module not available)`);
    } else {
      console.error(`[BAILEYS] ❌ WebSocket connection failed:`, error.message);
      console.error(`[BAILEYS] 💡 This may indicate: firewall blocking WSS, proxy issues, or network instability`);
    }
  }
}

// Initialize WhatsApp connection
/**
 * Clear expired QR codes from session
 * @param {string} agentId - Agent ID
 */
function clearExpiredQR(agentId) {
  const session = activeSessions.get(agentId);
  if (!session) return;
  
  if (session.qrCode && session.qrGeneratedAt) {
    const qrAge = Date.now() - session.qrGeneratedAt;
    if (qrAge > QR_EXPIRATION_MS) {
      console.log(`[BAILEYS] 🧹 Clearing expired QR for agent ${agentId.substring(0, 8)}... (${Math.round(qrAge/1000)}s old)`);
      session.qrCode = null;
      session.qrGeneratedAt = null;
      activeSessions.set(agentId, session);
    }
  }
}

/**
 * Cleanup stale QR states (qr_pending for >5 minutes)
 * @param {string} agentId - Agent ID
 */
async function cleanupStaleQRState(agentId) {
  try {
    const { data: dbState } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, updated_at, qr_code')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (dbState?.status === 'qr_pending') {
      const stateAge = Date.now() - new Date(dbState.updated_at).getTime();
      
      if (stateAge > MAX_QR_PENDING_MS) {
        console.log(`[BAILEYS] 🧹 Cleaning up stale QR state (>5 min old, ${Math.round(stateAge/1000)}s)`);
        
        // Reset in-memory state
        const session = activeSessions.get(agentId);
        if (session) {
          session.qrCode = null;
          session.qrGeneratedAt = null;
          session.connectionState = 'disconnected';
        }
        qrGenerationTracker.delete(agentId);
        
        // Update database
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({ 
            status: 'disconnected',
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
      }
    }
  } catch (error) {
    console.error(`[BAILEYS] Error in cleanupStaleQRState:`, error.message);
    // Don't throw - cleanup failures shouldn't block initialization
  }
}

async function initializeWhatsApp(agentId, userId = null) {
  console.log(`\n[BAILEYS] ==================== INITIALIZATION START ====================`);
  console.log(`[BAILEYS] Initializing WhatsApp for agent: ${agentId.substring(0, 40)}`);
  console.log(`[BAILEYS] Node: ${process.version}, Platform: ${process.platform}`);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CRITICAL: Prevent race condition - only ONE initialization at a time per agent
  // This prevents startup, reconnectAllAgents, and connectionMonitor from competing
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const lockValue = connectionLocks.get(agentId);
  if (lockValue) {
    // Check if it's a timestamp (new format) or boolean (old format from safeInitializeWhatsApp)
    const lockAge = typeof lockValue === 'number' ? Date.now() - lockValue : 0;
    
    // If lock is older than 90 seconds, consider it stale and clear it
    if (typeof lockValue === 'number' && lockAge > 90000) {
      console.log(`[BAILEYS] ⚠️ Clearing stale initialization lock (${Math.round(lockAge/1000)}s old)`);
      connectionLocks.delete(agentId);
    } else {
      console.log(`[BAILEYS] ⏸️ Initialization already in progress, checking session state...`);
      
      // Return current session state if exists and is valid
      const existingSession = activeSessions.get(agentId);
      if (existingSession?.isConnected) {
        console.log(`[BAILEYS] ✅ Session already connected, returning existing state`);
        return {
          success: true,
          status: 'connected',
          qrCode: null,
          phoneNumber: existingSession.phoneNumber,
          isActive: true
        };
      }
      
      if (existingSession?.qrCode) {
        console.log(`[BAILEYS] ✅ QR already pending, returning existing state`);
        return {
          success: true,
          status: 'qr_pending',
          qrCode: existingSession.qrCode,
          phoneNumber: null,
          isActive: false
        };
      }
      
      console.log(`[BAILEYS] ⏸️ No valid session state, waiting for current init to complete...`);
      return {
        success: false,
        error: 'Initialization already in progress',
        status: 'initializing'
      };
    }
  }
  
  // Set initialization lock with timestamp
  connectionLocks.set(agentId, Date.now());
  console.log(`[BAILEYS] 🔒 Initialization lock acquired`);
  
  emitAgentEvent(agentId, 'status', { status: 'initializing' });
  
  // CRITICAL: Check network connectivity first
  const networkOk = await checkNetworkRequirements();
  if (!networkOk) {
    console.error(`[BAILEYS] ❌ Network check failed - aborting`);
    throw new Error('Cannot reach WhatsApp servers. Check network/firewall settings.');
  }
  
  // CRITICAL: Ensure agent isolation - prevent credential sharing
  try {
    await ensureAgentIsolation(agentId);
  } catch (error) {
    console.error(`[BAILEYS] ❌ Agent isolation failed:`, error.message);
    return {
      success: false,
      error: error.message,
      status: 'error'
    };
  }
  
  try {
    // CRITICAL FIX: Cleanup stale QR states before checking
    await cleanupStaleQRState(agentId);
    
    // Prevent multiple initializations
    if (activeSessions.has(agentId)) {
      const existingSession = activeSessions.get(agentId);
      
      // CRITICAL FIX: Check if there's BOTH a recent QR generation AND an active QR code
      const qrGenTime = qrGenerationTracker.get(agentId);
      let hasActiveQR = existingSession?.qrCode !== null;
      const QR_COOLDOWN_MS = 120000; // 2 minutes
      const isWithinCooldown = qrGenTime && (Date.now() - qrGenTime) < QR_COOLDOWN_MS;
      
      // Clear expired QR codes before checking
      clearExpiredQR(agentId);
      hasActiveQR = existingSession?.qrCode !== null; // Re-check after clearing
      
      if (isWithinCooldown && hasActiveQR) {
        console.log(`[BAILEYS] ⏸️ QR already generated recently and still active`);
        console.log(`[BAILEYS] 📊 QR State:`, {
          hasQRInMemory: !!existingSession.qrCode,
          qrGeneratedAt: existingSession.qrGeneratedAt ? new Date(existingSession.qrGeneratedAt).toISOString() : null,
          cooldownRemaining: Math.round((QR_COOLDOWN_MS - (Date.now() - qrGenTime)) / 1000) + 's',
          socketState: existingSession.socket?.ws?.readyState
        });
        return {
          success: true,
          status: 'qr_pending',
          qrCode: existingSession.qrCode,
          phoneNumber: existingSession.phoneNumber,
          isActive: existingSession.isConnected
        };
      }
      
      // If cooldown active but QR expired/missing, force new generation
      if (isWithinCooldown && !hasActiveQR) {
        console.log(`[BAILEYS] ⚠️ Cooldown active but QR expired/missing - forcing new generation`);
        qrGenerationTracker.delete(agentId); // Clear cooldown to allow generation
      }
      
      if (existingSession.socket && existingSession.isConnected) {
        console.log(`[BAILEYS] ✅ Existing connection found`);
        return {
          success: true,
          status: 'authenticated',
          phoneNumber: existingSession.phoneNumber,
          isActive: true
        };
      }
      
      console.log(`[BAILEYS] 🧹 Cleaning up stale session`);
      if (existingSession.socket) {
        existingSession.socket.ev.removeAllListeners();
        existingSession.socket.end();
      }
      activeSessions.delete(agentId);
      qrGenerationTracker.delete(agentId);
    }

    // CRITICAL FIX: Check database status and force QR if needed
    // If database says qr_pending but we have no QR in memory, force generation
    console.log(`[BAILEYS] 🔍 Checking database status FIRST (before local files)...`);
    const { data: dbSessionStatus, error: dbStatusError } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, is_active, disconnected_at, session_data, qr_code, updated_at')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    const currentState = activeSessions.get(agentId);
    if (dbSessionStatus?.status === 'qr_pending' && (!currentState || !currentState.qrCode)) {
      console.log(`[BAILEYS] 🔄 QR pending but missing - forcing new generation`);
      // Reset cooldown to allow immediate generation
      qrGenerationTracker.delete(agentId);
      // Clear any stale session
      if (currentState) {
        activeSessions.delete(agentId);
      }
    }
    
    if (dbStatusError) {
      console.warn(`[BAILEYS] ⚠️ Error checking database status:`, dbStatusError);
    }
    
    // CRITICAL: If status is 'disconnected', force fresh start (delete local files, clear DB)
    if (dbSessionStatus && dbSessionStatus.status === 'disconnected') {
      console.log(`[BAILEYS] ⚠️ Database status is 'disconnected' - forcing fresh start`);
      console.log(`[BAILEYS] This indicates a manual disconnect - all credentials must be cleared`);
      
      // Delete local auth directory completely (with error handling)
      const authPath = path.join(__dirname, '../../auth_sessions', agentId);
      if (fs.existsSync(authPath)) {
        console.log(`[BAILEYS] 🗑️ Deleting local auth directory (disconnected session)...`);
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
          console.log(`[BAILEYS] ✅ Local credentials deleted successfully`);
        } catch (deleteError) {
          console.error(`[BAILEYS] ❌ Failed to delete local auth directory:`, deleteError.message);
          console.error(`[BAILEYS] Error details:`, deleteError);
          // Continue anyway - database cleanup is more important
          // User may need to manually delete directory if permissions issue
        }
      } else {
        console.log(`[BAILEYS] ℹ️ No local auth directory to delete`);
      }
      
      // Clear database session data completely
      try {
        const { error: dbClearError } = await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            session_data: null,
            qr_code: null,
            qr_generated_at: null,
            is_active: false,
            status: 'disconnected',
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
        
        if (dbClearError) {
          console.error(`[BAILEYS] ❌ Failed to clear database session data:`, dbClearError);
          throw new Error(`Database cleanup failed: ${dbClearError.message}`);
        }
        console.log(`[BAILEYS] ✅ Database cleared successfully`);
      } catch (dbError) {
        console.error(`[BAILEYS] ❌ Database cleanup error:`, dbError);
        // Don't throw - allow initialization to continue with fresh QR
      }
      
      console.log(`[BAILEYS] ✅ Fresh start complete - will generate fresh QR`);
      // Continue to fresh QR generation below
    }
    
    // Mark session as initializing in database before proceeding
    try {
      await supabaseAdmin
        .from('whatsapp_sessions')
        .upsert({
          agent_id: agentId,
          status: 'initializing',
          is_active: false,
          phone_number: null,
          qr_code: null,
          qr_generated_at: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'agent_id' });
    } catch (dbPrepError) {
      console.warn(`[BAILEYS] ⚠️ Failed to mark session initializing:`, dbPrepError.message);
    }

    // Load auth state using Baileys' built-in function
    console.log(`[BAILEYS] 📂 Loading authentication state...`);
    const authPath = path.join(__dirname, '../../auth_sessions', agentId);

    // CRITICAL FIX B: Only check local files if status is NOT 'disconnected'
    // If we just cleared everything above, skip local file check
    const credsFile = path.join(authPath, 'creds.json');
    const hasValidCreds = fs.existsSync(credsFile) && 
                         dbSessionStatus && 
                         dbSessionStatus.status !== 'disconnected';
    
    let useFileAuth = false;
    
    if (hasValidCreds) {
      try {
        const credsContent = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
        
        // Simple check: Do we have a paired device?
        const isPaired = credsContent.me && credsContent.me.id;
        
        if (isPaired) {
          console.log(`[BAILEYS] ✅ Found credentials with paired device - loading...`);
          console.log(`[BAILEYS] Device ID: ${credsContent.me.id.split(':')[0]}`);
          useFileAuth = true;
        } else {
          console.log(`[BAILEYS] ℹ️  Credentials exist but no paired device - will generate QR`);
        }
      } catch (error) {
        console.log(`[BAILEYS] ⚠️ Error reading credentials:`, error.message);
        // Delete corrupted credentials
        if (fs.existsSync(authPath)) {
          console.log(`[BAILEYS] 🗑️ Deleting corrupted credentials...`);
          fs.rmSync(authPath, { recursive: true, force: true });
        }
      }
    } else {
      if (!fs.existsSync(credsFile)) {
        console.log(`[BAILEYS] 🆕 No credentials file found locally`);
      } else if (dbSessionStatus?.status === 'disconnected') {
        console.log(`[BAILEYS] ⚠️ Local credentials exist but status is 'disconnected' - ignoring local file`);
      }
      
      // CRITICAL: Only try to restore from database if status is NOT 'disconnected' or 'conflict'
      if (dbSessionStatus && 
          dbSessionStatus.status !== 'disconnected' && 
          dbSessionStatus.status !== 'conflict') {
        // CRITICAL: Try to restore from Supabase before generating new QR
        console.log(`[BAILEYS] 🔍 Checking Supabase for backed-up credentials...`);
        const restored = await restoreCredsFromDatabase(agentId);
        
        if (restored) {
          console.log(`[BAILEYS] ✅ Credentials restored from Supabase - will use them`);
          useFileAuth = true;
        } else {
          console.log(`[BAILEYS] 🆕 No credentials in Supabase either - will generate QR`);
        }
      } else {
        console.log(`[BAILEYS] ⚠️ Status is '${dbSessionStatus?.status || 'unknown'}' - skipping database restore, will generate fresh QR`);
      }
    }

    let state, saveCredsToFile;
    
    if (useFileAuth) {
      // Load existing credentials from files
      console.log(`[BAILEYS] 📂 Loading credentials from files...`);
      
      // REMOVED: Strict integrity check - trust Baileys' format
      // Baileys validates its own credential format when loading
      
      const authState = await useMultiFileAuthState(authPath);
      state = authState.state;
      saveCredsToFile = authState.saveCreds;
      
      console.log(`[BAILEYS] 🔍 Loaded auth state:`, {
        hasCreds: !!state.creds,
        registered: state.creds?.registered,
        hasMe: !!state.creds?.me,
        hasDeviceId: !!state.creds?.me?.id,
        hasNoiseKey: !!state.creds?.noiseKey,
        hasSignedIdentityKey: !!state.creds?.signedIdentityKey
      });
    }
    
    if (!useFileAuth) {
      // Create COMPLETELY FRESH state for QR generation  
      console.log(`[BAILEYS] 🆕 Creating fresh auth state for QR generation...`);
      
      // Delete entire auth directory if it exists to ensure completely fresh start
      if (fs.existsSync(authPath)) {
        console.log(`[BAILEYS] 🗑️ Deleting entire auth directory for completely fresh start...`);
        fs.rmSync(authPath, { recursive: true, force: true });
      }
      
      // Create fresh directory
      fs.mkdirSync(authPath, { recursive: true });
      console.log(`[BAILEYS] 📁 Created fresh auth directory`);
      
      // Load completely fresh state (no existing files)
      const authState = await useMultiFileAuthState(authPath);
      state = authState.state;
      saveCredsToFile = authState.saveCreds;
      
      console.log(`[BAILEYS] 🔍 Fresh state initialized:`, {
        hasCreds: !!state.creds,
        registered: state.creds?.registered,
        hasMe: !!state.creds?.me,
        willGenerateQR: !state.creds || !state.creds.me
      });
    }

    // CRITICAL: Wrap saveCreds with atomic writes and credential validation
    const saveCreds = async () => {
      try {
        // CRITICAL: Validate credential integrity BEFORE saving
        const currentCreds = state.creds;
        
        // Check 1: Ensure required keys exist
        if (!currentCreds.noiseKey || !currentCreds.signedIdentityKey || !currentCreds.signedPreKey) {
          console.error(`[BAILEYS] ❌ CRITICAL: Incomplete credentials detected, skipping save`);
          console.error(`[BAILEYS] Missing keys:`, {
            hasNoiseKey: !!currentCreds.noiseKey,
            hasSignedIdentityKey: !!currentCreds.signedIdentityKey,
            hasSignedPreKey: !!currentCreds.signedPreKey
          });
          return; // Don't save corrupted credentials
        }
        
        // Check 2: Validate key buffer lengths (prevent truncated keys)
        if (currentCreds.noiseKey?.private) {
          try {
            const keyLen = getKeyLength(currentCreds.noiseKey.private);
            if (keyLen !== 32) {
              console.error(`[BAILEYS] ❌ CRITICAL: Noise key has invalid length (${keyLen}), expected 32`);
              return; // Don't save corrupted credentials
            }
          } catch (e) {
            console.error(`[BAILEYS] ❌ CRITICAL: Cannot validate noise key length: ${e.message}`);
            return; // Don't save corrupted credentials
          }
        }
        
        // REMOVED: Strict validation - trust Baileys' internal credential format
        // Baileys validates credentials when they're created/updated
        
        // CRITICAL: Ensure directory exists before saving (with error handling)
        try {
          if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
            console.log(`[BAILEYS] 📁 Created auth directory: ${authPath}`);
          }
        } catch (mkdirError) {
          console.error(`[BAILEYS] ❌ Error creating auth directory:`, mkdirError);
          throw new Error(`Failed to create auth directory: ${mkdirError.message}`);
        }
        
        // Verify directory exists before attempting to save
        if (!fs.existsSync(authPath)) {
          throw new Error(`Auth directory does not exist after creation attempt: ${authPath}`);
        }
        
        // CRITICAL: Use atomic write pattern to prevent file corruption
        const credsPath = path.join(authPath, 'creds.json');
        const tempPath = path.join(authPath, `creds.json.tmp.${Date.now()}`);
        
        try {
          // Step 1: Write to temporary file first
          const credsData = JSON.stringify(currentCreds, null, 2);
          fs.writeFileSync(tempPath, credsData, { encoding: 'utf-8', flag: 'w' });
          
          // Step 2: Verify temp file is readable and valid JSON
          const verifyData = fs.readFileSync(tempPath, 'utf-8');
          JSON.parse(verifyData); // Will throw if invalid JSON
          
          // Step 3: Atomic rename (replaces old file safely)
          fs.renameSync(tempPath, credsPath);
          
          console.log(`[BAILEYS] ✅ Credentials saved atomically to ${credsPath}`);
          
        } catch (writeError) {
          // Clean up temp file if it exists
          if (fs.existsSync(tempPath)) {
            try {
              fs.unlinkSync(tempPath);
            } catch (unlinkError) {
              // Ignore cleanup errors
            }
          }
          throw writeError;
        }
        
        // Also save keys using original function
        await saveCredsToFile(); // This saves other key files
        
        // Sync to database with file locking
        await syncCredsToDatabase(agentId);
        
      } catch (error) {
        console.error(`[BAILEYS] ❌ CRITICAL ERROR saving credentials:`, error.message);
        console.error(`[BAILEYS] Error details:`, error);
        
        // If save fails, mark credentials as potentially corrupted
        const currentSession = activeSessions.get(agentId);
        if (currentSession) {
          currentSession.credentialError = error.message;
          currentSession.credentialErrorAt = Date.now();
        }
        
        // Don't throw - allow connection to continue, but log the error
      }
    };

    const credStatus = state.creds ? `🔑 Loaded credentials (registered: ${state.creds.registered})` : '🆕 No credentials - will generate QR';
    console.log(`[BAILEYS] ${credStatus}`);
    
    // CRITICAL FIX: Determine connection strategy based on ACTUAL paired device indicators
    // The `registered` flag is NOT reliable after restart - it stays false even for valid sessions
    // Instead, check for: me.id (device ID) + signal keys (noiseKey, signedIdentityKey)
    const hasDeviceId = !!state.creds?.me?.id;
    const hasSignalKeys = !!(state.creds?.noiseKey && state.creds?.signedIdentityKey);
    const hasPairedDevice = hasDeviceId && hasSignalKeys;
    const shouldGenerateQR = !hasPairedDevice;
    
    console.log('[BAILEYS] 🔍 Connection Strategy:', {
      hasDeviceId,
      hasSignalKeys,
      hasPairedDevice,
      willUseCredentials: hasPairedDevice,
      willGenerateQR: shouldGenerateQR,
      deviceId: hasDeviceId ? state.creds.me.id.split(':')[0] : null
    });
    
    // If we have paired device, clear QR trackers - expect direct connection
    if (hasPairedDevice) {
      console.log('[BAILEYS] ✅ Using existing credentials - expecting direct connection (no QR)');
      qrGenerationTracker.delete(agentId);
    }
    
    // CRITICAL: Fetch latest Baileys version for compatibility
    console.log(`[BAILEYS] 🔍 Fetching latest Baileys version...`);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[BAILEYS] Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);
    
    // CRITICAL: Create socket with proper config
    console.log(`[BAILEYS] 🔌 Creating WebSocket connection...`);
    
    // CRITICAL: Enhanced logger to intercept raw protocol messages and extract sender_pn for @lid messages
    // Use trace level to catch ALL logs, and intercept at PARENT logger level (not just child)
    const customLogger = pino({ level: 'trace' });
    
    // Intercept at PARENT logger level (trace, debug, info) to catch protocol messages BEFORE processing
    const originalTrace = customLogger.trace.bind(customLogger);
    const originalDebug = customLogger.debug.bind(customLogger);
    const originalInfo = customLogger.info.bind(customLogger);
    
    customLogger.trace = function(obj, msg) {
      interceptSenderPn(obj);
      return originalTrace(obj, msg);
    };
    
    customLogger.debug = function(obj, msg) {
      interceptSenderPn(obj);
      return originalDebug(obj, msg);
    };
    
    customLogger.info = function(obj, msg) {
      interceptSenderPn(obj);
      return originalInfo(obj, msg);
    };
    
    // Helper function to extract and cache sender_pn AND peer_recipient_pn from protocol messages
    function interceptSenderPn(obj) {
      if (obj && typeof obj === 'object') {
        // Check for recv.attrs (message receive) - this is where sender_pn and peer_recipient_pn appear in protocol logs
        if (obj.recv && obj.recv.attrs) {
          const attrs = obj.recv.attrs;
          
          // INCOMING MESSAGE: Extract sender_pn from @lid messages
          if (attrs.from && attrs.from.endsWith('@lid') && attrs.sender_pn) {
            const lidJid = attrs.from;
            const senderPn = attrs.sender_pn;
            // Extract just the phone number (remove @s.whatsapp.net if present)
            const phoneNumber = senderPn.includes('@') 
              ? senderPn.split('@')[0] 
              : senderPn;
            const senderJid = `${phoneNumber}@s.whatsapp.net`;
            lidToPhoneCache.set(lidJid, senderJid);
            console.log(`[BAILEYS] 🔍 LOGGER INTERCEPT: Cached sender_pn ${lidJid} -> ${phoneNumber}`);
          }
          
          // OUTGOING MESSAGE: Extract peer_recipient_pn from @lid messages
          if (attrs.recipient && attrs.recipient.endsWith('@lid') && attrs.peer_recipient_pn) {
            const recipientLidJid = attrs.recipient;
            const peerRecipientPn = attrs.peer_recipient_pn;
            const phoneNumber = peerRecipientPn.includes('@')
              ? peerRecipientPn.split('@')[0]
              : peerRecipientPn;
            const recipientJid = `${phoneNumber}@s.whatsapp.net`;
            lidToPhoneCache.set(recipientLidJid, recipientJid);
            console.log(`[BAILEYS] 🔍 LOGGER INTERCEPT: Cached peer_recipient_pn ${recipientLidJid} -> ${phoneNumber}`);
          }
        }
      }
    }
    
    // Also intercept child loggers (for completeness)
    const originalChild = customLogger.child.bind(customLogger);
    customLogger.child = function(bindings) {
      const child = originalChild(bindings);
      // Intercept all log methods to catch protocol messages
      ['info', 'debug', 'trace'].forEach(method => {
        const originalMethod = child[method];
        if (originalMethod && typeof originalMethod === 'function') {
          child[method] = function(obj, msg) {
            interceptSenderPn(obj);
            return originalMethod.call(this, obj, msg);
          };
        }
      });
      return child;
    };
    
    const sock = makeWASocket({
      // CRITICAL: Use proper auth structure with cacheable signal key store
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      version, // Use fetched version
      printQRInTerminal: true, // CRITICAL: Enable for debugging!
      logger: customLogger, // Use custom logger to intercept sender_pn
      browser: Browsers.ubuntu('Chrome'),
      
      // CRITICAL: Proper keepalive configuration
      keepAliveIntervalMs: 30000, // Changed from 10s to 30s (less aggressive)
      defaultQueryTimeoutMs: 60000, // Reduced from 180s to 60s
      connectTimeoutMs: 60000, // Reduced from 180s to 60s
      qrTimeout: 60000, // Standard QR timeout
      
      retryRequestDelayMs: 2000, // Increased from 1s to 2s
      maxMsgRetryCount: 5, // Reduced from 10 to 5
      
      // IMPORTANT: Remove emitOwnEvents and fireInitQueries
      // Let Baileys handle these internally
      
      // CRITICAL: getMessage handler - return undefined to prevent errors
      getMessage: async (key) => {
        return undefined;
      },
      
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: true // Changed to true - helps maintain connection
    });

    console.log(`[BAILEYS] ✅ Socket created with EXTENDED timeouts for pairing (3min)`);
    console.log(`[BAILEYS] ℹ️  This allows more time for QR scan -> credential exchange`);
    console.log(`[BAILEYS] 🔍 Socket info:`, {
      socketExists: !!sock,
      hasEventEmitter: !!sock.ev,
      hasWebSocket: !!sock.ws,
      timestamp: new Date().toISOString()
    });
    
    // CRITICAL: Try to intercept raw WebSocket messages BEFORE Baileys processes them
    // This is APPROACH 2 - intercept raw socket messages if accessible
    if (sock.ws && typeof sock.ws.on === 'function') {
      try {
        // Intercept raw WebSocket messages to extract sender_pn
        sock.ws.on('message', (data) => {
          // REMOVED: lastActivity tracking - we can't reliably track it
          
          try {
            // Baileys uses binary protocol, but we can try to parse JSON if it's text
            if (typeof data === 'string') {
              const parsed = JSON.parse(data);
              if (parsed.attrs?.from?.endsWith('@lid') && parsed.attrs?.sender_pn) {
                const lidJid = parsed.attrs.from;
                const senderPn = parsed.attrs.sender_pn;
                const phoneNumber = senderPn.includes('@') ? senderPn.split('@')[0] : senderPn;
                const senderJid = `${phoneNumber}@s.whatsapp.net`;
                lidToPhoneCache.set(lidJid, senderJid);
                console.log(`[BAILEYS] 🔍 RAW SOCKET: Cached sender_pn ${lidJid} -> ${phoneNumber}`);
              }
            }
          } catch (e) {
            // Ignore parse errors - Baileys uses binary protocol, not JSON
          }
        });
        console.log(`[BAILEYS] ✅ Raw WebSocket message interceptor attached`);
        
        // REMOVED: WebSocket debugging listeners - not needed and adds noise
      } catch (wsError) {
        console.log(`[BAILEYS] ⚠️ Could not attach raw WebSocket interceptor: ${wsError.message}`);
      }
    } else {
      console.log(`[BAILEYS] ℹ️ Raw WebSocket not accessible (this is normal - Baileys may not expose it)`);
    }

    // CRITICAL: Register creds.update handler with validation
    sock.ev.on('creds.update', async () => {
      console.log(`[BAILEYS] 🔐 ============ CREDS.UPDATE FIRED ============`);
      try {
        // CRITICAL: Validate credential integrity BEFORE saving
        const currentCreds = state.creds;
        
        // Check 1: Ensure required keys exist
        if (!currentCreds.noiseKey || !currentCreds.signedIdentityKey || !currentCreds.signedPreKey) {
          console.error(`[BAILEYS] ❌ CRITICAL: Incomplete credentials detected, skipping save`);
          console.error(`[BAILEYS] Missing keys:`, {
            hasNoiseKey: !!currentCreds.noiseKey,
            hasSignedIdentityKey: !!currentCreds.signedIdentityKey,
            hasSignedPreKey: !!currentCreds.signedPreKey
          });
          return; // Don't save corrupted credentials
        }
        
        // Check 2: Validate key buffer lengths (prevent truncated keys)
        if (currentCreds.noiseKey?.private) {
          try {
            const keyLen = getKeyLength(currentCreds.noiseKey.private);
            if (keyLen !== 32) {
              console.error(`[BAILEYS] ❌ CRITICAL: Noise key has invalid length (${keyLen}), expected 32`);
              return; // Don't save corrupted credentials
            }
          } catch (e) {
            console.error(`[BAILEYS] ❌ CRITICAL: Cannot validate noise key length: ${e.message}`);
            return; // Don't save corrupted credentials
          }
        }
        
        // Check 3: Ensure keys haven't been corrupted mid-flight
        const keysChecksum = Buffer.from(JSON.stringify({
          noiseKey: currentCreds.noiseKey?.public?.toString('base64'),
          identityKey: currentCreds.signedIdentityKey?.public?.toString('base64')
        })).toString('base64');
        
        // Store checksum for future validation
        currentCreds._keysChecksum = keysChecksum;
        
        console.log(`[BAILEYS] ✅ Credential validation passed, saving...`);
        
        // saveCreds handles both file save and database sync with atomic writes
        await saveCreds();
        
        console.log(`[BAILEYS] ✅ Credentials saved successfully`);
        console.log(`[BAILEYS] 🔐 ============ CREDS.UPDATE COMPLETE ============\n`);
      } catch (error) {
        console.error(`[BAILEYS] ❌ CRITICAL ERROR saving credentials:`, error.message);
        console.error(`[BAILEYS] Error details:`, error);
        
        // If save fails, mark credentials as potentially corrupted
        if (session) {
          session.credentialError = error.message;
          session.credentialErrorAt = Date.now();
        }
        
        // Don't throw - allow connection to continue, but log the error
      }
    });

    // Store session with health monitoring
    const sessionData = {
      socket: sock,
      state: state,
      saveCreds: saveCreds,
      phoneNumber: null,
      isConnected: false,
      qrCode: null,
      qrGeneratedAt: null,
      socketCreatedAt: Date.now(),
      connectionState: 'initializing',
      qrAttempts: 0,
      connectedAt: null,
      failureReason: null,
      failureAt: null
    };
    
    activeSessions.set(agentId, sessionData);

    console.log(`[BAILEYS] ✅ Session stored in memory with health monitoring`);
    
    // CRITICAL: Start heartbeat mechanism for instance tracking
    const heartbeatInterval = setInterval(async () => {
      const session = activeSessions.get(agentId);
      if (!session) {
        clearInterval(heartbeatInterval);
        return;
      }
      
      if (session.isConnected) {
        try {
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              last_heartbeat: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
        } catch (error) {
          console.error(`[BAILEYS] Heartbeat failed for ${agentId}:`, error.message);
        }
      }
    }, 60000); // Every minute
    
    // Store heartbeat interval for cleanup
    sessionData.heartbeatInterval = heartbeatInterval;
    
    // CRITICAL: Periodic credential backup (every hour for connected sessions)
    const backupInterval = setInterval(async () => {
      const session = activeSessions.get(agentId);
      if (session && session.isConnected) {
        await backupCredentials(agentId);
      } else {
        clearInterval(backupInterval);
      }
    }, 60 * 60 * 1000); // Every hour
    
    sessionData.backupInterval = backupInterval;
    
    // CRITICAL: Add socket health check to detect premature disconnects
    // REMOVED: Health check interval - causes false disconnects
    // Baileys handles keepalive internally, we don't need to monitor it

    // Connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;
      
      if (connection === 'close' && lastDisconnect) {
        const session = activeSessions.get(agentId);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const hasQR = !!session?.qrCode;
        const wasPairing = hasQR && !session?.isConnected;
        const errorMessage = lastDisconnect?.error?.message || '';
        
        // Only log significant close events (not normal QR timeout)
        if (statusCode && statusCode !== 515) { // 515 = QR timeout, expected
          console.log(`[BAILEYS] ❌ Connection closed: ${statusCode} - ${errorMessage || 'unknown'}`);
        }
        
        if (wasPairing && statusCode && statusCode !== 515) {
          // Connection closed during pairing (not QR timeout)
          console.log(`[BAILEYS] ⚠️ Connection closed during pairing - network issue or server rejection`);
        }
      }

      // Handle QR code - ONLY process if we don't have valid paired credentials
      if (qr) {
        const session = activeSessions.get(agentId);
        const qrAttempt = session ? session.qrAttempts + 1 : 1;

        // CRITICAL: Skip QR if already connected
        if (session?.isConnected) {
          console.log(`[BAILEYS] ⚠️ QR ignored - already connected`);
          return;
        }
        
        // CRITICAL: Skip QR if we have paired device credentials
        // QR should only be generated when there are NO valid credentials
        if (state.creds?.me?.id && state.creds?.registered !== false) {
          console.log(`[BAILEYS] ⚠️ QR ignored - have valid paired credentials, expecting direct connection`);
          return;
        }
        
        if (session) {
          session.connectionState = 'qr_pending';
        }
        
        // Log QR generation concisely
        console.log(`[BAILEYS] 📱 QR Code #${qrAttempt} - scan within 60s`);
        
        qrGenerationTracker.set(agentId, Date.now());
        
        try {
          await supabaseAdmin
            .from('whatsapp_sessions')
            .upsert({
              agent_id: agentId,
              qr_code: qr,
              is_active: false,
              status: 'qr_pending',
              qr_generated_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'agent_id'
            });
          
          if (session) {
            session.qrCode = qr;
            session.qrGeneratedAt = Date.now();
            session.qrAttempts = qrAttempt;
          }
          
          emitAgentEvent(agentId, 'qr', { qr, attempt: qrAttempt });
          
          // ━━━ SOCKET.IO EMISSION FOR REAL-TIME QR ━━━
          try {
            const app = require('../../app');
            const io = app.get('io');
            if (io) {
              io.to(`whatsapp:${agentId}`).emit('whatsapp:qr', {
                agentId,
                qr,
                attempt: qrAttempt,
                timestamp: new Date().toISOString()
              });
              console.log(`[BAILEYS] 📡 QR emitted via Socket.IO to whatsapp:${agentId.substring(0, 8)}...`);
            }
          } catch (socketError) {
            // Socket.IO not critical - frontend can still poll
          }
        } catch (error) {
          console.error(`[BAILEYS] ❌ Error saving QR:`, error);
        }
      }

      // Connection connecting state
      if (connection === 'connecting') {
        console.log(`[BAILEYS] 🔄 Connecting to WhatsApp...`);
      }

      // Connection success
      if (connection === 'open') {
        console.log(`\n[BAILEYS] ========== 🎉 CONNECTION SUCCESS 🎉 ==========`);
        
        qrGenerationTracker.delete(agentId);
        console.log(`[BAILEYS] 🛑 QR generation disabled for ${agentId.substring(0, 40)} (connection open)`);
        
        // CRITICAL: Clear 401 failure timestamp on successful connection
        last401Failure.delete(agentId);
        console.log(`[BAILEYS] ✅ 401 failure cooldown cleared - connection successful`);
        
        const phoneNumber = sock.user?.id || 'Unknown';
        const cleanPhone = phoneNumber.split(':')[0].replace('@s.whatsapp.net', '');
        
        console.log(`[BAILEYS] 📱 User:`, sock.user);
        console.log(`[BAILEYS] 📞 Phone: ${cleanPhone}`);
        
        try {
          // CRITICAL: Use upsert to ensure row exists, and set status field
          const { data: updateResult, error: updateError } = await supabaseAdmin
              .from('whatsapp_sessions')
              .upsert({
                agent_id: agentId,
                phone_number: cleanPhone,
                status: 'connected',
                is_active: true,
                qr_code: null,
                qr_generated_at: null,
                last_connected: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                // Instance tracking
                instance_id: INSTANCE_ID,
                instance_hostname: INSTANCE_HOSTNAME,
                instance_pid: INSTANCE_PID,
                instance_started_at: new Date().toISOString(),
                last_heartbeat: new Date().toISOString()
              }, {
                onConflict: 'agent_id'
              })
              .select();
          
          if (updateError) {
            console.error(`[BAILEYS] ❌ DB update error:`, updateError);
          } else {
            console.log(`[BAILEYS] ✅ Database updated with upsert`);
            console.log(`[BAILEYS] ✅ status = 'connected', is_active = TRUE`);
            console.log(`[BAILEYS] ✅ Phone: ${cleanPhone}`);
          }
          
          const session = activeSessions.get(agentId);
          if (session) {
            session.isConnected = true;
            session.phoneNumber = cleanPhone;
            session.qrCode = null;
            session.qrGeneratedAt = null;
            session.connectionState = 'open';
            session.connectedAt = Date.now();
            session.socketReadyState = session.socket?.ws?.readyState ?? null;
            session.failureReason = null;
            session.failureAt = null;
          }
          
          emitAgentEvent(agentId, 'connected', {
            phoneNumber: cleanPhone
          });
          
          // ━━━ SOCKET.IO EMISSION FOR CONNECTION SUCCESS ━━━
          try {
            const app = require('../../app');
            const io = app.get('io');
            if (io) {
              io.to(`whatsapp:${agentId}`).emit('whatsapp:connected', {
                agentId,
                status: 'connected',
                phoneNumber: cleanPhone,
                message: 'WhatsApp connected successfully!',
                timestamp: new Date().toISOString()
              });
              console.log(`[BAILEYS] 📡 Connection success emitted via Socket.IO`);
            }
          } catch (socketError) {
            console.error(`[BAILEYS] Socket.IO emit error:`, socketError.message);
          }
          
          console.log(`[BAILEYS] 🎊 WhatsApp fully connected`);
          console.log(`[BAILEYS] ========== CONNECTION COMPLETE ==========\n`);
          
          // CRITICAL: Release initialization lock now that connection is established
          connectionLocks.delete(agentId);
          console.log(`[BAILEYS] 🔓 Initialization lock released (connected)`);
          
          // ━━━ START MONITORING ━━━
          // Disconnection detection via:
          // 1. Connection events (immediate) - Baileys fires 'close' on disconnect
          // 2. Health ping monitor (60s) - Actively tests connection
          // 3. Database heartbeat (60s) - Multi-instance coordination
          // NOTE: WebSocket state monitor DISABLED (caused false reconnections)
          if (session) {
            startAllMonitoring(sock, agentId, session);
          }
          
        } catch (error) {
          console.error(`[BAILEYS] ❌ Error:`, error);
        }
      }

      // Connection close
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message;
        const payload = lastDisconnect?.error?.output?.payload;
        const data = lastDisconnect?.error?.data;
        const wsCloseEvent = sock?.ws && typeof sock.ws === 'object' && 'closeEvent' in sock.ws ? sock.ws.closeEvent : null;
        const session = activeSessions.get(agentId);

        if (session) {
          session.isConnected = false;
          session.connectionState = 'closed';
          session.socketReadyState = session.socket?.ws?.readyState ?? null;
        }

        console.log(`\n[BAILEYS] ========== CONNECTION CLOSED ==========`);
        console.log(`[BAILEYS] Code: ${statusCode}, Reason: ${reason}`);
        if (payload) {
          console.log(`[BAILEYS] Payload: ${JSON.stringify(payload)}`);
        }
        if (data) {
          console.log(`[BAILEYS] Data: ${JSON.stringify(data)}`);
        }
        if (wsCloseEvent) {
          console.log(`[BAILEYS] WS Close Event:`, wsCloseEvent);
        }
        if (session) {
          session.connectionState = 'closed';
          session.socketReadyState = session.socket?.ws?.readyState ?? null;
        }
        
        emitAgentEvent(agentId, 'disconnected', {
          reason,
          statusCode
        });
        
        // ━━━ CLEANUP ALL MONITORING ON DISCONNECT ━━━
        cleanupMonitoring(agentId);
        
        // ━━━ SOCKET.IO EMISSION FOR DISCONNECTION ━━━
        try {
          const app = require('../../app');
          const io = app.get('io');
          if (io) {
            io.to(`whatsapp:${agentId}`).emit('whatsapp:disconnected', {
              agentId,
              statusCode,
              reason,
              timestamp: new Date().toISOString()
            });
            console.log(`[BAILEYS] 📡 Disconnection emitted via Socket.IO`);
          }
        } catch (socketError) {
          // Socket.IO not critical
        }
        
        // CRITICAL: Handle 405 error specifically (Connection Failure before QR)
        if (statusCode === 405) {
          console.log(`[BAILEYS] ⚠️ Error 405 - Connection Failure (likely before QR generation)`);
          console.log(`[BAILEYS] This usually means:`);
          console.log(`  1. Network/firewall blocking WhatsApp servers`);
          console.log(`  2. Invalid auth state preventing QR generation`);
          console.log(`  3. WhatsApp Web servers temporarily unavailable`);
          
          // Delete auth directory and retry
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            console.log(`[BAILEYS] 🗑️ Deleting auth directory to force fresh QR...`);
            fs.rmSync(authDir, { recursive: true, force: true });
          }
          
          // Clear from active sessions but don't delete from DB (let user retry)
          activeSessions.delete(agentId);
          qrGenerationTracker.delete(agentId);
          connectionLocks.delete(agentId); // Release lock
          
          console.log(`[BAILEYS] ✅ Cleared for retry. User should click "Connect" again.`);
          return; // Don't continue processing
        }
        
        // CRITICAL: Handle error 440 - Stream Conflict (Session Replaced)
        if (statusCode === 440) {
          console.log(`[BAILEYS] ⚠️ Error 440 - Stream Conflict (session replaced)`);
          console.log(`[BAILEYS] This means the WhatsApp session was opened elsewhere`);
          console.log(`[BAILEYS] Common causes: Multiple devices, QR scanned again, or credential sharing`);
          
          // Mark session as conflict and clean up
          if (session) {
            session.isConnected = false;
            session.connectionState = 'conflict';
            session.failureReason = 'Session replaced - WhatsApp opened on another device';
            session.failureAt = Date.now();
          }
          
          // Stop health check and heartbeat to prevent warning spam
          // REMOVED: healthCheckInterval - no longer used
          if (session?.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
            session.heartbeatInterval = null;
            console.log(`[BAILEYS] ✅ Heartbeat stopped`);
          }
          
          // Clean up socket
          if (session?.socket) {
            try {
              session.socket.ev.removeAllListeners();
              session.socket.end();
            } catch (e) {
              console.log(`[BAILEYS] Socket cleanup: ${e.message}`);
            }
          }
          
          // Remove from active sessions
          activeSessions.delete(agentId);
          qrGenerationTracker.delete(agentId);
          connectionLocks.delete(agentId);
          
          // Clear auth directory - credentials are invalidated
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log(`[BAILEYS] 🗑️ Cleared auth directory (credentials invalidated)`);
          }
          
          // Update database
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              session_data: null,
              qr_code: null,
              qr_generated_at: null,
              is_active: false,
              status: 'conflict',
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          console.log(`[BAILEYS] ✅ Session cleared. User must reconnect manually.`);
          console.log(`[BAILEYS] 💡 TIP: Ensure no other devices/instances are using this agent.`);
          
          // Record failure to prevent auto-retry
          last401Failure.set(agentId, Date.now());
          
          return; // Don't continue processing
        }
        
        // CRITICAL: Handle error 428 - Connection Lost (AUTO-RECONNECT)
        if (statusCode === 428) {
          console.log(`[BAILEYS] 🔄 428 - Connection Lost (network issue)`);
          
          // Release lock before reconnect attempt
          connectionLocks.delete(agentId);
          
          // Use smart reconnection with exponential backoff
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          
          // Async reconnection - don't await to avoid blocking
          handleSmartReconnection(agentId, 'disconnect_428', 1)
            .then(result => {
              if (result) {
                console.log(`[BAILEYS] ✅ Smart reconnection successful after 428`);
              }
            })
            .catch(error => {
              console.error(`[BAILEYS] ❌ Smart reconnection failed:`, error.message);
            });
          
          return;
        }
        
        // Error 515 - Restart Required (EXPECTED after QR pairing!)
        if (statusCode === 515) {
          console.log(`[BAILEYS] 🔄 Error 515 - Restart required (EXPECTED after QR pairing)`);
          
          // Remove from memory to force clean restart
          activeSessions.delete(agentId);
          qrGenerationTracker.delete(agentId);
          connectionLocks.delete(agentId); // Release lock before reconnect
          
          // Use smart reconnection (515 is expected, so start with attempt 1)
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          
          // Wait 3 seconds then reconnect (give WhatsApp time to register credentials)
          setTimeout(async () => {
            console.log(`[BAILEYS] 🔄 Reconnecting after 515...`);
            try {
              await handleSmartReconnection(agentId, 'disconnect_515_restart', 1);
            } catch (error) {
              console.error(`[BAILEYS] ❌ Reconnection failed after 515:`, error.message);
            }
          }, 3000);
          
          return;
        }
        
        qrGenerationTracker.delete(agentId);
        
        // CRITICAL: Handle Bad MAC errors (session corruption) - enhanced detection
        const errorMessage = reason || payload?.error || data?.reason || '';
        const errorString = JSON.stringify(lastDisconnect?.error || {}).toLowerCase();
        
        // Detect Bad MAC in multiple ways
        const isBadMacError = 
          errorMessage.includes('Bad MAC') || 
          errorMessage.includes('bad-mac') ||
          errorMessage.includes('Bad MAC Error') || 
          errorMessage.includes('session error') ||
          errorMessage.includes('decryption-error') ||
          errorMessage.includes('hmac') ||
          errorString.includes('bad mac') ||
          errorString.includes('bad-mac') ||
          (statusCode === 401 && (
            errorMessage.includes('MAC') || 
            errorMessage.includes('decrypt')
          ));
        
        if (isBadMacError) {
          console.log(`[BAILEYS] ❌ Bad MAC Error detected - Session key corruption/desync`);
          console.log(`[BAILEYS] Error details:`, {
            statusCode,
            reason,
            payload,
            errorString: errorString.substring(0, 200)
          });
          console.log(`[BAILEYS] This indicates:`);
          console.log(`  1. Credentials were corrupted during save/load`);
          console.log(`  2. Session keys are out of sync with WhatsApp servers`);
          console.log(`  3. File system or database corruption occurred`);
          console.log(`  4. Concurrent credential writes from multiple instances`);
          
          // Stop all intervals immediately
          // REMOVED: healthCheckInterval - no longer used
          if (session?.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
            session.heartbeatInterval = null;
          }
          // Close socket
          if (session?.socket) {
            try {
              session.socket.ev.removeAllListeners();
              session.socket.end();
            } catch (err) {
              console.log('[BAILEYS] Socket cleanup:', err.message);
            }
          }
          
          // Mark as corrupted
          const failureReason = 'Bad MAC - Session key corruption detected';
          if (session) {
            session.failureReason = failureReason;
            session.failureAt = Date.now();
            session.isConnected = false;
            session.connectionState = 'conflict';
          }
          
          // Remove from memory
          activeSessions.delete(agentId);
          connectionLocks.delete(agentId);
          last401Failure.set(agentId, Date.now());
          
          // CRITICAL: Delete corrupted credentials completely
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            console.log(`[BAILEYS] 🗑️ Deleting corrupted credentials...`);
            try {
              // Delete all files in auth directory
              const files = fs.readdirSync(authDir);
              for (const file of files) {
                const filePath = path.join(authDir, file);
                fs.unlinkSync(filePath);
                console.log(`[BAILEYS] 🗑️ Deleted: ${file}`);
              }
              fs.rmdirSync(authDir);
              console.log(`[BAILEYS] ✅ Corrupted auth directory deleted`);
            } catch (deleteError) {
              console.error(`[BAILEYS] ❌ Error deleting corrupted files:`, deleteError.message);
              // Force delete entire directory
              try {
                fs.rmSync(authDir, { recursive: true, force: true });
              } catch (forceError) {
                console.error(`[BAILEYS] ❌ Force delete failed:`, forceError.message);
              }
            }
          }
          
          // Clear database credentials
          try {
            await supabaseAdmin
              .from('whatsapp_sessions')
              .update({
                session_data: null,
                qr_code: null,
                qr_generated_at: null,
                is_active: false,
                status: 'conflict',
                phone_number: null,
                updated_at: new Date().toISOString()
              })
              .eq('agent_id', agentId);
            
            console.log(`[BAILEYS] ✅ Database credentials cleared`);
          } catch (dbError) {
            console.error(`[BAILEYS] ❌ Database clear error:`, dbError.message);
          }
          
          console.log(`[BAILEYS] ✅ Bad MAC cleanup complete`);
          console.log(`[BAILEYS] 🔄 User must reconnect manually to get fresh QR code`);
          console.log(`[BAILEYS] 💡 TIP: Ensure no other instances are running for this agent`);
          
          return; // Don't continue processing
        }
        
        if (statusCode === 401) {
          console.log(`[BAILEYS] ❌ 401 - Clearing session due to conflict or device removal`);
          
          if (session?.socket) {
            try {
              session.socket.ev.removeAllListeners();
              session.socket.end?.();
            } catch (err) {
              console.log('[BAILEYS] Socket cleanup after 401 failed:', err.message);
            }
          }

          // CRITICAL: Mark session as conflict FIRST to stop health check
          // The health check will see conflict state and stop itself
          const failureReason = payload?.error || reason || 'conflict';
          if (session) {
            session.failureReason = failureReason;
            session.failureAt = Date.now();
            session.isConnected = false;
            session.connectionState = 'conflict'; // This triggers health check to stop
            session.qrCode = null;
            session.qrGeneratedAt = null;
            session.socket = null;
            session.state = null;
            session.saveCreds = null;
          }

          // Stop health check and heartbeat intervals
          if (session?.healthCheckInterval) {
            clearInterval(session.healthCheckInterval);
            session.healthCheckInterval = null;
            console.log(`[BAILEYS] ✅ Health check interval stopped`);
          }
          if (session?.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
            session.heartbeatInterval = null;
            console.log(`[BAILEYS] ✅ Heartbeat interval stopped`);
          }

          // Remove from active sessions IMMEDIATELY to stop health check
          // Health check checks if session exists, so deleting it stops the loop
          activeSessions.delete(agentId);
          console.log(`[BAILEYS] ✅ Session removed from active sessions`);

          connectionLocks.delete(agentId);
          lastConnectionAttempt.set(agentId, Date.now());
          
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
          }
          
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              session_data: null,
              qr_code: null,
              qr_generated_at: null,
              is_active: false,
              status: 'conflict',
              phone_number: null,
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          console.log(`[BAILEYS] ✅ Session cleared after 401. Failure reason: ${failureReason}`);

          // CRITICAL: Record 401 failure timestamp to prevent automatic retries
          last401Failure.set(agentId, Date.now());
          console.log(`[BAILEYS] 🚫 Auto-retry disabled for ${Math.ceil(FAILURE_COOLDOWN_MS / 60000)} minutes after 401 error`);
          console.log(`[BAILEYS] ⚠️  Manual reconnection required - user must click "Connect" to get new QR code`);

          return;
        }

        // CRITICAL: Handle error 404 - Session Not Found (FATAL)
        if (statusCode === 404) {
          console.log(`[BAILEYS] ❌ 404 - Session not found - clearing credentials`);
          console.log(`[BAILEYS] This means the session was deleted from WhatsApp servers`);
          
          if (session?.socket) {
            try {
              session.socket.ev.removeAllListeners();
              session.socket.end?.();
            } catch (err) {
              console.log('[BAILEYS] Socket cleanup after 404 failed:', err.message);
            }
          }

          // Mark session as conflict
          const failureReason = 'Session not found - likely deleted from WhatsApp servers';
          if (session) {
            session.failureReason = failureReason;
            session.failureAt = Date.now();
            session.isConnected = false;
            session.connectionState = 'conflict';
            session.qrCode = null;
            session.qrGeneratedAt = null;
            session.socket = null;
            session.state = null;
            session.saveCreds = null;
          }

          // Stop health check and heartbeat intervals
          if (session?.healthCheckInterval) {
            clearInterval(session.healthCheckInterval);
            session.healthCheckInterval = null;
            console.log(`[BAILEYS] ✅ Health check interval stopped`);
          }
          if (session?.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
            session.heartbeatInterval = null;
            console.log(`[BAILEYS] ✅ Heartbeat interval stopped`);
          }

          // Remove from active sessions
          activeSessions.delete(agentId);
          console.log(`[BAILEYS] ✅ Session removed from active sessions`);

          connectionLocks.delete(agentId);
          lastConnectionAttempt.set(agentId, Date.now());
          
          // Delete auth directory - credentials are invalid
          const authDir = path.join(__dirname, '../../auth_sessions', agentId);
          if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log(`[BAILEYS] 🗑️ Cleared auth directory (session not found)`);
          }
          
          // Update database - mark as conflict and clear session data
          await supabaseAdmin
            .from('whatsapp_sessions')
            .update({
              session_data: null,
              qr_code: null,
              qr_generated_at: null,
              is_active: false,
              status: 'conflict',
              phone_number: null,
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          console.log(`[BAILEYS] ✅ Session cleared after 404. Failure reason: ${failureReason}`);
          console.log(`[BAILEYS] 🚫 Auto-retry disabled - manual reconnection required`);

          // Record failure to prevent auto-retry
          last401Failure.set(agentId, Date.now());
          return;
        }

        // CRITICAL: Handle errors 408/500/503 - Recoverable (Smart Reconnection)
        if ([408, 500, 503].includes(statusCode)) {
          const errorName = statusCode === 408 ? 'Timeout' : 
                           statusCode === 500 ? 'Server Error' : 'Service Unavailable';
          console.log(`[BAILEYS] 🟡 ${statusCode} - ${errorName} - RECOVERABLE (smart reconnection)`);
          console.log(`[BAILEYS] Auth state: PRESERVED - credentials still valid`);
          
          // Use smart reconnection with exponential backoff
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          
          handleSmartReconnection(agentId, `disconnect_${statusCode}`, 1)
            .then(result => {
              if (result) {
                console.log(`[BAILEYS] ✅ Smart reconnection successful after ${statusCode}`);
              }
            })
            .catch(error => {
              console.error(`[BAILEYS] ❌ Smart reconnection failed after ${statusCode}:`, error.message);
            });
          
          return;
        }

        // CRITICAL: Handle error 410 - Restart Required (Protocol Update)
        if (statusCode === 410) {
          console.log(`[BAILEYS] 🔄 410 - Restart required (protocol update)`);
          console.log(`[BAILEYS] Auth state: PRESERVED - credentials still valid`);
          
          // Clear QR tracker to allow restart
          qrGenerationTracker.delete(agentId);
          
          // Use smart reconnection
          const { handleSmartReconnection } = require('../utils/reconnectionManager');
          
          setTimeout(async () => {
            console.log(`[BAILEYS] 🔄 Smart reconnection after protocol update...`);
            try {
              await handleSmartReconnection(agentId, 'disconnect_410_protocol_update', 1);
            } catch (error) {
              console.error(`[BAILEYS] ❌ Restart failed after 410:`, error.message);
            }
          }, 2000);
          
          return;
        }
        
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            is_active: false,
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
      }
      
    });

    // Handle messages
    // Message handler - logs incoming and outgoing messages with actual text
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      console.log(`\n[BAILEYS] ========== MESSAGES RECEIVED (${type}) ==========`);
      console.log(`[BAILEYS] 📊 Received ${messages?.length || 0} message(s) of type: ${type}`);
      
      // CRITICAL: Don't skip 'notify' type messages entirely - some real messages come as 'notify'
      // Instead, we'll filter them in shouldProcessMessage based on content
      // Only skip if there are no messages to process
      if (!messages || messages.length === 0) {
        console.log('[BAILEYS] 🚫 No messages in batch, skipping');
        return;
      }

      // CRITICAL: Fetch user_id from agents table for message_log insertion
      let userIdForMessage = userId;
      if (!userIdForMessage) {
        try {
          const { data: agentData } = await supabaseAdmin
            .from('agents')
            .select('user_id')
            .eq('id', agentId)
            .single();
          if (agentData) {
            userIdForMessage = agentData.user_id;
            console.log(`[BAILEYS] ✅ Fetched user_id for message logging: ${userIdForMessage}`);
          }
        } catch (error) {
          console.error(`[BAILEYS] ❌ Failed to fetch user_id for agent:`, error.message);
        }
      }

      const session = activeSessions.get(agentId);
      const agentNumber =
        sanitizeNumberFromJid(session?.phoneNumber) ||
        sanitizeNumberFromJid(sock?.user?.id) ||
        null;

      // CRITICAL: Skip messages during initial connection phase
      // If the session is not fully connected yet, these are likely connection/sync messages
      if (!session?.isConnected && !agentNumber) {
        console.log('[BAILEYS] 🚫 Skipping messages during connection initialization phase');
        return;
      }

      const shouldProcessMessage = (message) => {
        const remoteJid = message?.key?.remoteJid || '';

        if (!remoteJid) {
          console.log('[BAILEYS] 🚫 Skipping message with missing remoteJid');
          return false;
        }

        if (remoteJid.endsWith('@g.us')) {
          console.log('[BAILEYS] 🚫 Skipping group message from:', remoteJid);
          return false;
        }

        if (remoteJid.endsWith('@broadcast')) {
          console.log('[BAILEYS] 🚫 Skipping broadcast message from:', remoteJid);
          return false;
        }

        if (remoteJid.includes('status') || remoteJid.endsWith('@status')) {
          console.log('[BAILEYS] 🚫 Skipping status update from:', remoteJid);
          return false;
        }

        if (message?.message?.newsletterAdminInviteMessage || remoteJid.includes('@newsletter')) {
          console.log('[BAILEYS] 🚫 Skipping newsletter message from:', remoteJid);
          return false;
        }

        if (!remoteJid.endsWith('@s.whatsapp.net') && !remoteJid.endsWith('@lid')) {
          console.log('[BAILEYS] 🚫 Skipping unsupported JID type:', remoteJid);
          return false;
        }

        // CRITICAL: Skip system/connection messages that have no actual content
        // These are typically protocol messages during WhatsApp initialization
        if (!message?.message) {
          console.log('[BAILEYS] 🚫 Skipping message with no message content (system message)');
          return false;
        }

        // Skip protocol messages (like protocolMessage, senderKeyDistributionMessage, etc.)
        const protocolMessageTypes = [
          'protocolMessage',
          'senderKeyDistributionMessage',
          'deviceSentMessage',
          'messageContextInfo',
          'reactionMessage',
          'pollCreationMessage',
          'pollUpdateMessage',
        ];
        
        const messageKeys = Object.keys(message.message || {});
        const hasOnlyProtocolMessages = messageKeys.every(key => 
          protocolMessageTypes.includes(key) || 
          key === 'messageContextInfo' ||
          key === 'messageStubType'
        );

        if (hasOnlyProtocolMessages && messageKeys.length > 0) {
          console.log('[BAILEYS] 🚫 Skipping protocol/system message:', messageKeys.join(', '));
          return false;
        }

        return true;
      };

      for (const msg of messages) {
        if (!shouldProcessMessage(msg)) {
          continue;
        }

        const fromMe = Boolean(msg?.key?.fromMe);
        const remoteJid = msg?.key?.remoteJid || 'unknown';
        const messageId = msg?.key?.id || 'unknown';
        const direction = fromMe ? '📤 Outgoing' : '📨 Incoming';
        const participant = fromMe ? 'to' : 'from';

        const participantJid =
          msg?.key?.participant ||
          msg?.participant ||
          msg?.message?.extendedTextMessage?.contextInfo?.participant ||
          msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo?.participant ||
          msg?.message?.ephemeralMessage?.message?.conversation?.contextInfo?.participant ||
          null;

        const contactCandidateJid = fromMe ? participantJid || remoteJid : remoteJid;

        const contactNumber = sanitizeNumberFromJid(contactCandidateJid);
        const fromNumber = fromMe ? agentNumber : contactNumber;
        const toNumber = fromMe ? contactNumber : agentNumber;

        // ✅ CRITICAL: Message routing logic for dashboard vs WhatsApp
        // 
        // Dashboard flow (SAVE to DB + CALL webhook):
        // - Agent sends message to its OWN number via dashboard
        // - This is: fromMe=true AND contactNumber === agentNumber
        // - source = 'dashboard' (shown in agent chat UI)
        //
        // Incoming WhatsApp messages (SAVE to DB + CALL webhook with source=whatsapp):
        // - Another contact sends message TO the agent
        // - This is: fromMe=false (ANY contact can send to agent)
        // - source = 'whatsapp' (NOT shown in agent chat UI)
        //
        // Outgoing to OTHER contacts (SAVE to DB + CALL webhook with source=whatsapp):
        // - Agent sends message to family/friends/work contacts on WhatsApp
        // - This is: fromMe=true AND contactNumber !== agentNumber
        // - source = 'whatsapp' (NOT shown in agent chat UI)
        //
        const isDashboardMessage = fromMe && contactNumber && agentNumber && contactNumber === agentNumber;
        const isIncomingWhatsApp = !fromMe; // Any incoming message from any contact
        const isOutgoingToOther = fromMe && contactNumber && agentNumber && contactNumber !== agentNumber;

        // Log what type of message we're processing
        if (isDashboardMessage) {
          console.log(`[BAILEYS] 📊 Processing DASHBOARD message (agent to self): ${agentNumber}`);
        } else if (isIncomingWhatsApp) {
          console.log(`[BAILEYS] 📱 Processing INCOMING WhatsApp message from: ${contactNumber} to agent: ${agentNumber}`);
        } else if (isOutgoingToOther) {
          console.log(`[BAILEYS] 📤 Processing OUTGOING message to contact: ${contactNumber} (no webhook)`);
        }

        // ✅ TASK 4: Handle button response messages
        let messageText = null;
        let buttonResponse = null;
        
        if (msg.message) {
          // Check for button response first
          if (msg.message.buttonsResponseMessage) {
            const buttonMsg = msg.message.buttonsResponseMessage;
            buttonResponse = {
              selectedButtonId: buttonMsg.selectedButtonId || buttonMsg.selectedId,
              selectedButtonText: buttonMsg.selectedButtonText || buttonMsg.selectedDisplayText || null,
              contextInfo: buttonMsg.contextInfo || null
            };
            messageText = buttonResponse.selectedButtonText || `[Button: ${buttonResponse.selectedButtonId}]`;
            console.log(`[BAILEYS] 🔘 Button response received:`, {
              buttonId: buttonResponse.selectedButtonId,
              buttonText: buttonResponse.selectedButtonText,
              from: sanitizedFromNumber
            });
          } else if (msg.message.conversation) {
            messageText = msg.message.conversation;
          } else if (msg.message.extendedTextMessage?.text) {
            messageText = msg.message.extendedTextMessage.text;
          } else if (msg.message.imageMessage?.caption) {
            messageText = `[Image] ${msg.message.imageMessage.caption}`;
          } else if (msg.message.videoMessage?.caption) {
            messageText = `[Video] ${msg.message.videoMessage.caption}`;
          } else if (msg.message.documentMessage?.caption) {
            messageText = `[Document] ${msg.message.documentMessage.caption}`;
          } else if (msg.message.audioMessage) {
            messageText = '[Audio/Voice Message]';
          } else if (msg.message.stickerMessage) {
            messageText = '[Sticker]';
          } else if (msg.message.imageMessage) {
            messageText = '[Image]';
          } else if (msg.message.videoMessage) {
            messageText = '[Video]';
          } else if (msg.message.documentMessage) {
            messageText = '[Document]';
          } else if (msg.message.contactMessage) {
            messageText = `[Contact: ${msg.message.contactMessage.displayName || 'Unknown'}]`;
          } else if (msg.message.locationMessage) {
            messageText = '[Location]';
          } else {
            messageText = `[Unknown message type: ${Object.keys(msg.message).join(', ')}]`;
          }
        } else {
          messageText = '[No message content]';
        }

        // CRITICAL: Skip messages with no actual content - these are system/connection messages
        // that shouldn't be logged as user messages
        if (!messageText || messageText === '[No message content]' || messageText.trim().length === 0) {
          console.log(`[BAILEYS] 🚫 Skipping message with no content: ${messageId}`);
          continue;
        }

        // CRITICAL: Skip system/connection messages that have placeholder content
        // These are typically protocol messages or connection status messages
        const systemMessagePatterns = [
          '[Unknown message type:',
          '[No message content]',
          'protocolMessage',
          'senderKeyDistributionMessage',
          'deviceSentMessage',
          'messageContextInfo',
          'reactionMessage',
          'pollCreationMessage',
          'pollUpdateMessage',
        ];

        const isSystemMessage = systemMessagePatterns.some(pattern => 
          messageText.includes(pattern) || 
          messageText.toLowerCase().includes('system') ||
          messageText.toLowerCase().includes('protocol')
        );

        if (isSystemMessage) {
          console.log(`[BAILEYS] 🚫 Skipping system/protocol message: ${messageText.substring(0, 50)}`);
          continue;
        }

        // CRITICAL: Skip messages from WhatsApp system (status@broadcast, etc.)
        // These are typically status updates, system notifications, etc.
        // NOTE: @lid messages are VALID user messages from linked devices/business accounts - don't skip them
        if (remoteJid.includes('status') || 
            remoteJid.includes('broadcast') || 
            remoteJid.includes('@g.us') ||
            remoteJid.includes('newsletter')) {
          console.log(`[BAILEYS] 🚫 Skipping system/status message from: ${remoteJid}`);
          continue;
        }
        
        // For @lid messages, extract actual sender from sender_pn attribute (incoming) or peer_recipient_pn (outgoing)
        // @lid messages are from linked devices/business accounts and are valid user messages
        let actualSenderJid = remoteJid;
        let actualRecipientJid = remoteJid; // NEW: Track actual recipient for outgoing messages
        if (remoteJid.endsWith('@lid')) {
          // CRITICAL: Check cache FIRST (fastest method - populated by custom logger intercepting protocol)
          let senderPn = null;
          if (lidToPhoneCache.has(remoteJid)) {
            senderPn = lidToPhoneCache.get(remoteJid);
            console.log(`[BAILEYS] ✅ Found sender_pn in cache for ${remoteJid}: ${senderPn}`);
          }
          
          // Method 1: Check msg.key.attrs (if not in cache)
          if (!senderPn && msg?.key?.attrs && typeof msg.key.attrs === 'object') {
            senderPn = msg.key.attrs.sender_pn || null;
            if (senderPn) {
              console.log(`[BAILEYS] ✅ Found sender_pn in msg.key.attrs: ${senderPn}`);
            }
          }
          
          // Method 2: Check msg.attrs (alternative location)
          if (!senderPn && msg?.attrs && typeof msg.attrs === 'object') {
            senderPn = msg.attrs.sender_pn || null;
            if (senderPn) {
              console.log(`[BAILEYS] ✅ Found sender_pn in msg.attrs: ${senderPn}`);
            }
          }
          
          // Method 3: Check if it's directly on msg.key
          if (!senderPn && msg?.key && typeof msg.key === 'object') {
            senderPn = msg.key.sender_pn || null;
            if (senderPn) {
              console.log(`[BAILEYS] ✅ Found sender_pn on msg.key: ${senderPn}`);
            }
          }
          
          // Method 5: Try to get from socket's contact store using pushName
          if (!senderPn && msg?.pushName && sock?.store?.contacts) {
            try {
              // Search contacts by pushName to find matching phone number
              const contacts = await sock.store.contacts.all();
              const matchingContact = contacts.find(c => c.name === msg.pushName);
              if (matchingContact && matchingContact.id) {
                const contactJid = matchingContact.id;
                if (contactJid.endsWith('@s.whatsapp.net')) {
                  senderPn = contactJid;
                  // Cache it for future use
                  lidToPhoneCache.set(remoteJid, contactJid);
                  console.log(`[BAILEYS] ✅ Found sender via contact store (pushName: ${msg.pushName}): ${senderPn}`);
                }
              }
            } catch (contactError) {
              // Ignore contact store errors
            }
          }
          
          // Method 6: Try to get from socket's message store (Baileys might store it there)
          if (!senderPn && sock?.store?.messages) {
            try {
              const storedMessages = await sock.store.messages.get(remoteJid);
              if (storedMessages && storedMessages[messageId]) {
                const storedMsg = storedMessages[messageId];
                // Check various locations in stored message
                const storedSenderPn = storedMsg?.key?.attrs?.sender_pn ||
                                     storedMsg?.attrs?.sender_pn ||
                                     storedMsg?.sender_pn ||
                                     null;
                if (storedSenderPn) {
                  senderPn = storedSenderPn;
                  lidToPhoneCache.set(remoteJid, storedSenderPn);
                  console.log(`[BAILEYS] ✅ Found sender_pn in message store: ${senderPn}`);
                }
              }
            } catch (storeError) {
              // Ignore store errors
            }
          }
          
          if (senderPn) {
            // Convert sender_pn to proper JID format if needed
            actualSenderJid = senderPn.includes('@') ? senderPn : `${senderPn}@s.whatsapp.net`;
            console.log(`[BAILEYS] ℹ️ @lid message detected, using sender_pn: ${actualSenderJid} (original remoteJid: ${remoteJid})`);
          }
          
          // OUTGOING MESSAGE: Extract peer_recipient_pn for recipient identification
          if (fromMe) {
            let peerRecipientPn = null;
            
            // Method 1: Check msg.key.attrs (most reliable)
            if (msg?.key?.attrs && typeof msg.key.attrs === 'object') {
              peerRecipientPn = msg.key.attrs.peer_recipient_pn || null;
              if (peerRecipientPn) {
                console.log(`[BAILEYS] ✅ Found peer_recipient_pn in msg.key.attrs: ${peerRecipientPn}`);
              }
            }
            
            // Method 2: Check msg.attrs
            if (!peerRecipientPn && msg?.attrs && typeof msg.attrs === 'object') {
              peerRecipientPn = msg.attrs.peer_recipient_pn || null;
              if (peerRecipientPn) {
                console.log(`[BAILEYS] ✅ Found peer_recipient_pn in msg.attrs: ${peerRecipientPn}`);
              }
            }
            
            // Method 3: Check if it's directly on msg.key
            if (!peerRecipientPn && msg?.key && typeof msg.key === 'object') {
              peerRecipientPn = msg.key.peer_recipient_pn || null;
              if (peerRecipientPn) {
                console.log(`[BAILEYS] ✅ Found peer_recipient_pn on msg.key: ${peerRecipientPn}`);
              }
            }
            
            // Method 4: Check cache (populated by logger interceptor)
            if (!peerRecipientPn && lidToPhoneCache.has(remoteJid)) {
              actualRecipientJid = lidToPhoneCache.get(remoteJid);
              console.log(`[BAILEYS] ✅ Found peer_recipient_pn in cache for ${remoteJid}: ${actualRecipientJid}`);
            } else if (peerRecipientPn) {
              // Convert peer_recipient_pn to proper JID format
              actualRecipientJid = peerRecipientPn.includes('@') ? peerRecipientPn : `${peerRecipientPn}@s.whatsapp.net`;
              // Cache it for future use
              lidToPhoneCache.set(remoteJid, actualRecipientJid);
              console.log(`[BAILEYS] 💾 Cached peer_recipient_pn mapping: ${remoteJid} -> ${actualRecipientJid}`);
            }
          }
          
          if (!senderPn && !fromMe) {
            // CRITICAL: Log COMPLETE message structure for @lid messages to find sender_pn
            // This is APPROACH 1 - comprehensive debug logging to find where sender_pn is stored
            console.log(`[BAILEYS] ⚠️ @lid message detected but sender_pn not found. COMPLETE message structure:`, JSON.stringify({
              // Check ALL possible locations for sender_pn
              key: msg?.key ? {
                id: msg.key.id,
                remoteJid: msg.key.remoteJid,
                fromMe: msg.key.fromMe,
                attrs: msg.key.attrs,
                participant: msg.key.participant,
                // Check if sender_pn is directly on key
                sender_pn: msg.key.sender_pn,
                // Check all key properties
                allKeys: Object.keys(msg.key),
              } : null,
              // Check top-level attrs
              attrs: msg?.attrs,
              // Check message.attrs
              messageAttrs: msg?.message?.attrs,
              // Check extendedTextMessage contextInfo
              extendedTextContext: msg?.message?.extendedTextMessage?.contextInfo,
              // Check all message properties
              messageKeys: msg?.message ? Object.keys(msg.message) : [],
              // Other properties
              pushName: msg?.pushName,
              notify: msg?.notify,
              verifiedBisName: msg?.verifiedBisName,
              // Check if sender_pn is at top level
              sender_pn: msg?.sender_pn,
              // Show ALL top-level keys
              allTopLevelKeys: msg ? Object.keys(msg) : [],
            }, null, 2));
            
            // Also try to find sender_pn by deep searching the entire message object
            const deepSearchForSenderPn = (obj, path = 'root', depth = 0) => {
              if (depth > 5) return null; // Limit depth
              if (!obj || typeof obj !== 'object') return null;
              
              if ('sender_pn' in obj) {
                console.log(`[BAILEYS] 🔍 Found sender_pn at path: ${path}.sender_pn = ${obj.sender_pn}`);
                return obj.sender_pn;
              }
              
              for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                  const result = deepSearchForSenderPn(obj[key], `${path}.${key}`, depth + 1);
                  if (result) return result;
                }
              }
              return null;
            };
            
            const foundSenderPn = deepSearchForSenderPn(msg);
            if (foundSenderPn) {
              const phoneNumber = foundSenderPn.includes('@') ? foundSenderPn.split('@')[0] : foundSenderPn;
              const senderJid = `${phoneNumber}@s.whatsapp.net`;
              actualSenderJid = senderJid;
              lidToPhoneCache.set(remoteJid, senderJid);
              console.log(`[BAILEYS] ✅ Found sender_pn via deep search: ${remoteJid} -> ${phoneNumber}`);
            }
            
            // Last resort: Try to extract from the raw message if it's available
            // Sometimes Baileys stores raw protocol data in a different format
            if (msg && typeof msg === 'object') {
              // Deep search for sender_pn in the entire message object
              const deepSearch = (obj, depth = 0) => {
                if (depth > 3) return null; // Limit depth to avoid infinite recursion
                if (!obj || typeof obj !== 'object') return null;
                
                if ('sender_pn' in obj) {
                  return obj.sender_pn;
                }
                
                for (const key in obj) {
                  if (obj.hasOwnProperty(key)) {
                    const result = deepSearch(obj[key], depth + 1);
                    if (result) return result;
                  }
                }
                return null;
              };
              
              const foundSenderPn = deepSearch(msg);
              if (foundSenderPn) {
                actualSenderJid = foundSenderPn.includes('@') ? foundSenderPn : `${foundSenderPn}@s.whatsapp.net`;
                // Cache it for future use
                lidToPhoneCache.set(remoteJid, actualSenderJid);
                console.log(`[BAILEYS] ✅ Found sender_pn via deep search: ${actualSenderJid}`);
              }
            }
          }
          
          // If we found sender_pn, cache it for future messages from this @lid
          if (actualSenderJid !== remoteJid && actualSenderJid) {
            lidToPhoneCache.set(remoteJid, actualSenderJid);
            console.log(`[BAILEYS] 💾 Cached @lid mapping: ${remoteJid} -> ${actualSenderJid}`);
          }
        }

        console.log(`[BAILEYS] ✅ Processing individual message ${participant} ${remoteJid}${actualSenderJid !== remoteJid ? ` (actual sender: ${actualSenderJid})` : ''}`);
        console.log(`[BAILEYS] Message: ${messageText}`);
        console.log(`[BAILEYS] Message ID: ${messageId}`);
        if (msg.messageTimestamp) {
          console.log(`[BAILEYS] Timestamp: ${new Date(Number(msg.messageTimestamp) * 1000).toISOString()}`);
        }
        console.log(`[BAILEYS] ----------------------------------------`);

        const effectiveMessage = unwrapMessageContent(msg.message);
        const textContent =
          effectiveMessage?.conversation ||
          effectiveMessage?.extendedTextMessage?.text ||
          effectiveMessage?.imageMessage?.caption ||
          effectiveMessage?.videoMessage?.caption ||
          effectiveMessage?.buttonsResponseMessage?.selectedDisplayText ||
          effectiveMessage?.listResponseMessage?.title ||
          effectiveMessage?.templateButtonReplyMessage?.selectedDisplayText ||
          null;

          const timestampRaw =
            (msg.messageTimestamp &&
              (typeof msg.messageTimestamp === 'object' && typeof msg.messageTimestamp.toNumber === 'function'
                ? msg.messageTimestamp.toNumber()
                : Number(msg.messageTimestamp))) ||
            Math.floor(Date.now() / 1000);

        const timestampIso = new Date(timestampRaw * 1000).toISOString();

        // ✅ TASK 4: Set messageType based on button response or default to TEXT
        let messageType = buttonResponse ? 'BUTTON_RESPONSE' : 'TEXT';
        // Use messageText (already extracted and validated) as primary source, fallback to textContent
        // messageText is more comprehensive and handles more message types
        let content = messageText && messageText !== '[No message content]' && !messageText.startsWith('[Unknown message type:') 
          ? messageText 
          : (textContent || null);
        let mediaUrl = null;
        let mediaMimetype = null;
        let mediaSize = null;
        
        // Update contact extraction for @lid messages - use actualRecipientJid for outgoing, actualSenderJid for incoming
        let finalContactCandidateJid = contactCandidateJid;
        let finalFromNumber = fromNumber;
        let finalToNumber = toNumber;
        if (actualSenderJid !== remoteJid || (fromMe && actualRecipientJid !== remoteJid)) {
          if (fromMe) {
            // OUTGOING: Use actualRecipientJid (from peer_recipient_pn)
            finalContactCandidateJid = participantJid || actualRecipientJid;
          } else {
            // INCOMING: Use actualSenderJid (from sender_pn)
            finalContactCandidateJid = actualSenderJid;
          }
          
          const updatedContactNumber = sanitizeNumberFromJid(finalContactCandidateJid);
          finalFromNumber = fromMe ? agentNumber : updatedContactNumber;
          finalToNumber = fromMe ? updatedContactNumber : agentNumber;
          
          if (fromMe) {
            console.log(`[BAILEYS] 🔄 Updated contact info for OUTGOING @lid: fromNumber=${finalFromNumber}, toNumber=${finalToNumber}, actualRecipientJid=${actualRecipientJid}`);
          } else {
            console.log(`[BAILEYS] 🔄 Updated contact info for INCOMING @lid: fromNumber=${finalFromNumber}, toNumber=${finalToNumber}, actualSenderJid=${actualSenderJid}`);
          }
        }
        
        const messageMetadata = {
          platform: 'whatsapp',
          phoneNumber: agentNumber,
            direction: fromMe ? 'outgoing' : 'incoming',
          remoteJid: actualSenderJid, // Use actual sender JID for @lid messages
          messageId,
        };

        const wrappedAudioMessage = unwrapMessageContent(msg.message)?.audioMessage;

        if (wrappedAudioMessage) {
          messageType = 'AUDIO';
          const audioMessage = wrappedAudioMessage;
          mediaMimetype = audioMessage?.mimetype || 'audio/ogg';

          if (typeof audioMessage?.seconds === 'number') {
            messageMetadata.durationSeconds = audioMessage.seconds;
          }

          if (audioMessage?.ptt) {
            messageMetadata.isPtt = true;
          }

          try {
            console.log('[BAILEYS] 🎵 Downloading audio message:', { messageId, mediaMimetype });
            const messageForDownload = {
              ...msg,
              message: {
                audioMessage,
              },
            };

            const audioBuffer = await downloadMediaMessage(messageForDownload, 'buffer', {}, {
              logger: pino({ level: 'error' }),
              reuploadRequest: sock.updateMediaMessage,
            });

            if (audioBuffer) {
              mediaSize = audioBuffer.length;
              messageMetadata.mediaSize = mediaSize;
              try {
                const { url, path: storagePath } = await saveAudioFile(audioBuffer, agentId, messageId, mediaMimetype);
                mediaUrl = url;
                messageMetadata.storagePath = storagePath;
                console.log('[BAILEYS] 🎵 Audio message processed', { messageId, mediaUrl });
              } catch (uploadError) {
                // Log error but don't break message processing - webhook will still be sent without mediaUrl
                console.error('[BAILEYS] ❌ Failed to upload audio file (message will continue without mediaUrl):', {
                  messageId,
                  error: uploadError.message,
                  code: uploadError.code || uploadError.originalError?.code,
                });
                // Set mediaUrl to null so webhook knows there's no media available
                mediaUrl = null;
                messageMetadata.storagePath = null;
              }
            } else {
              console.warn('[BAILEYS] ⚠️ Audio buffer empty after download', { messageId });
            }
          } catch (error) {
            console.error('[BAILEYS] ❌ Failed to process audio message', { messageId, error: error.message });
            // Continue processing - don't break the entire message flow
            mediaUrl = null;
            messageMetadata.storagePath = null;
          }

          content = null;
        }

        // For @lid messages, always use actualSenderJid to get the correct phone number
        // CRITICAL: For @lid messages, use finalFromNumber/finalToNumber that were already calculated correctly
        // These values account for message direction (fromMe) and use agentNumber for outgoing, contact for incoming
        let sanitizedFromNumber;
        let sanitizedToNumber;

        if (remoteJid.endsWith('@lid')) {
          // For @lid messages, use the finalFromNumber/finalToNumber that were calculated earlier
          // These already account for message direction (fromMe flag)
          sanitizedFromNumber = finalFromNumber || sanitizeNumberFromJid(agentNumber) || agentNumber;
          sanitizedToNumber = finalToNumber || sanitizeNumberFromJid(actualSenderJid) || actualSenderJid;
          
          if (fromMe) {
            console.log(`[BAILEYS] ✅ @lid OUTGOING: from=${sanitizedFromNumber} (bot), to=${sanitizedToNumber} (contact)`);
          } else {
            console.log(`[BAILEYS] ✅ @lid INCOMING: from=${sanitizedFromNumber} (contact), to=${sanitizedToNumber} (bot)`);
          }
        } else {
          // Regular message (not @lid) - use standard extraction
          sanitizedFromNumber = typeof finalFromNumber === 'string' && finalFromNumber.length > 0
            ? finalFromNumber
            : sanitizeNumberFromJid(actualSenderJid) || actualSenderJid;
          
          sanitizedToNumber = typeof finalToNumber === 'string' && finalToNumber.length > 0
            ? finalToNumber
            : sanitizeNumberFromJid(fromMe ? actualSenderJid : agentNumber) || (fromMe ? actualSenderJid : agentNumber);
        }

        const cleanedMetadata = Object.fromEntries(
          Object.entries(messageMetadata).filter(([, value]) => value !== undefined && value !== null)
        );

        // ✅ CRITICAL: Check for duplicate messages before inserting
        // This prevents duplicate messages when:
        // 1. User sends message via chat interface (saved in messages route with generated message_id)
        // 2. WhatsApp echoes back the message (received via messages.upsert with WhatsApp message_id)
        const timeWindow = 10000; // 10 seconds window for duplicate detection
        const duplicateCheckStart = new Date(new Date(timestampIso).getTime() - timeWindow).toISOString();
        const duplicateCheckEnd = new Date(new Date(timestampIso).getTime() + timeWindow).toISOString();
        
        // Check for duplicate by message_id first (most reliable)
        const { data: existingByMessageId } = await supabaseAdmin
          .from('message_log')
          .select('id')
          .eq('message_id', messageId)
          .eq('agent_id', agentId)
          .maybeSingle();
        
        if (existingByMessageId) {
          console.log(`[BAILEYS][DB] ⚠️ Duplicate message detected by message_id: ${messageId}, skipping insert`);
          continue; // Skip to next message
        }
        
        // Also check for duplicate by content, timestamp, sender, and conversation (fallback)
        // This catches cases where message_id differs (e.g., generated ID vs WhatsApp ID) but it's the same message
        // For outgoing messages (fromMe=true), check if same content was sent to same recipient recently
        // For incoming messages (fromMe=false), check if same content was received from same sender recently
        const { data: existingByContent } = await supabaseAdmin
          .from('message_log')
          .select('id, message_id, received_at')
          .eq('agent_id', agentId)
          .eq('message_text', content)
          .eq('conversation_id', remoteJid)
          .eq('sender_phone', sanitizedFromNumber)
          .gte('received_at', duplicateCheckStart)
          .lte('received_at', duplicateCheckEnd)
          .order('received_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (existingByContent) {
          const timeDiff = Math.abs(new Date(timestampIso).getTime() - new Date(existingByContent.received_at).getTime());
          console.log(`[BAILEYS][DB] ⚠️ Duplicate message detected by content/timestamp: ${messageId} (existing: ${existingByContent.message_id}, time diff: ${timeDiff}ms), skipping insert`);
          continue; // Skip to next message
        }

        // ✅ CRITICAL FIX: Check if there's a recent dashboard message for button messages
        // WhatsApp echoes back button messages as plain text (without button patterns)
        // This prevents the WhatsApp echo from overwriting the dashboard message with buttons
        // Check for dashboard messages even if fromMe is false (WhatsApp might not set it correctly)
        if (content) {
          // Check if there's a recent dashboard message with source='dashboard' and sender_type='agent'
          // The dashboard message might have button patterns (*1 Option 1*) that WhatsApp echo doesn't have
          // Use a wider time window (30 seconds) to catch messages that arrive slightly before/after
          const widerTimeWindow = 30000; // 30 seconds
          const widerStart = new Date(new Date(timestampIso).getTime() - widerTimeWindow).toISOString();
          const widerEnd = new Date(new Date(timestampIso).getTime() + widerTimeWindow).toISOString();
          
          const { data: recentDashboardMessage } = await supabaseAdmin
            .from('message_log')
            .select('id, message_id, message_text, message, received_at, source, sender_type')
            .eq('agent_id', agentId)
            .eq('source', 'dashboard')
            .eq('sender_type', 'agent')
            .eq('conversation_id', remoteJid)
            .eq('sender_phone', sanitizedFromNumber)
            .gte('received_at', widerStart)
            .lte('received_at', widerEnd)
            .order('received_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (recentDashboardMessage) {
            // Check if the dashboard message text contains this content (button messages have extra text)
            const dashboardText = (recentDashboardMessage.message_text || recentDashboardMessage.message || '').trim();
            const echoContent = content.trim();
            
            // Match if:
            // 1. Dashboard message contains the echo content (button messages have extra text)
            // 2. Echo content contains the first part of dashboard message (for button messages)
            // 3. They're similar enough (for button messages, echo is just the text part)
            const dashboardContainsEcho = dashboardText.includes(echoContent);
            const echoContainsDashboardStart = echoContent.includes(dashboardText.substring(0, Math.min(50, dashboardText.length)));
            const isSimilar = dashboardText.substring(0, 50) === echoContent.substring(0, 50);
            
            if (dashboardContainsEcho || echoContainsDashboardStart || isSimilar) {
              const timeDiff = Math.abs(new Date(timestampIso).getTime() - new Date(recentDashboardMessage.received_at).getTime());
              console.log(`[BAILEYS][DB] ⚠️ WhatsApp echo detected for dashboard message: ${messageId}`, {
                dashboardId: recentDashboardMessage.message_id,
                timeDiff: `${timeDiff}ms`,
                dashboardText: dashboardText.substring(0, 100),
                echoContent: echoContent.substring(0, 100),
                reason: 'Skipping insert to preserve dashboard message with buttons'
              });
              continue; // Skip storing WhatsApp echo - keep the dashboard message with buttons
            }
          }
        }

        // Determine source based on message routing logic (defined earlier in loop)
        // - isDashboardMessage: agent sends to self via dashboard → source = 'dashboard'
        // - isIncomingWhatsApp: contact sends to agent → source = 'whatsapp'
        const messageSource = isDashboardMessage ? 'dashboard' : 'whatsapp';

        const dbPayload = {
          message_id: messageId,
          agent_id: agentId, // CRITICAL: Include agent_id
          user_id: userIdForMessage, // CRITICAL: Include user_id for filtering
          conversation_id: remoteJid,
          sender_phone: sanitizedFromNumber,
          message_text: content,
          message_type: messageType,
          media_url: mediaUrl,
          media_mimetype: mediaMimetype,
          media_size: mediaSize,
          metadata: cleanedMetadata,
          received_at: timestampIso,
          created_at: timestampIso,
          source: messageSource, // Set based on isDashboardMessage or isIncomingWhatsApp
        };

        try {
          const { error: insertError } = await supabaseAdmin.from('message_log').insert(dbPayload);
          if (insertError) {
            // Check if it's a duplicate key error (message_id already exists)
            if (insertError.code === '23505' || insertError.message?.includes('duplicate key') || insertError.message?.includes('unique constraint')) {
              console.log(`[BAILEYS][DB] ⚠️ Duplicate message detected (database constraint): ${messageId}, skipping`);
            } else {
            console.error('[BAILEYS][DB] ❌ Failed to insert chat message', {
              messageId,
              agentId,
              insertError,
            });
            }
          } else {
            console.log(`[BAILEYS][DB] ✅ Message saved: ${messageId} (${messageType})`);
          }
        } catch (error) {
          // Check if it's a duplicate key error
          if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
            console.log(`[BAILEYS][DB] ⚠️ Duplicate message detected (catch block): ${messageId}, skipping`);
          } else {
          console.error('[BAILEYS][DB] ❌ Unexpected error inserting chat message', {
            messageId,
            agentId,
            error: error.message,
          });
          }
        }

        // Extract sender name from message (pushName, verifiedBisName, or notify)
        const senderName = msg.pushName || 
                           msg.verifiedBisName || 
                           msg.notify || 
                           null;

        // CRITICAL: For @lid messages, check cache ONE MORE TIME right before webhook
        // The logger intercepts protocol messages and populates cache, but it might happen
        // slightly after message processing starts. Add a small delay to let logger intercept first.
        let webhookFromNumber = sanitizedFromNumber;
        if (remoteJid.endsWith('@lid')) {
          // Give logger a moment to intercept the protocol message and populate cache
          await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
          
          // Check cache now (logger should have populated it by now)
          if (lidToPhoneCache.has(remoteJid)) {
            const cachedSenderJid = lidToPhoneCache.get(remoteJid);
            const cachedPhoneNumber = sanitizeNumberFromJid(cachedSenderJid);
            if (cachedPhoneNumber) {
              webhookFromNumber = cachedPhoneNumber;
              console.log(`[BAILEYS] ✅ Using cached sender_pn for webhook: ${remoteJid} -> ${webhookFromNumber}`);
            }
          } else {
            console.log(`[BAILEYS] ⚠️ Cache not populated yet for ${remoteJid}, using fallback: ${webhookFromNumber}`);
          }
        }

        const webhookPayload = {
          id: messageId,
          messageId,
          from: webhookFromNumber || sanitizedFromNumber || actualSenderJid,
          to: sanitizedToNumber,
          senderName: senderName,
          conversationId: actualSenderJid, // Use actual sender JID for @lid messages
          messageType,
          type: messageType.toLowerCase(),
          content: content || null,
          mediaUrl,
          mimetype: mediaMimetype || null,
          timestamp: timestampIso,
          fromMe: fromMe, // Include fromMe flag for webhook
          // ✅ TASK 4: Include button response data if available
          buttonResponse: buttonResponse || null,
          metadata: {
            ...cleanedMetadata,
            senderName: senderName,
          },
        };

        if (typeof webhookPayload.from === 'string' && webhookPayload.from.includes('@')) {
          webhookPayload.from = sanitizeNumberFromJid(webhookPayload.from) || webhookPayload.from;
        }

        if (typeof webhookPayload.to === 'string' && webhookPayload.to.includes('@')) {
          webhookPayload.to = sanitizeNumberFromJid(webhookPayload.to) || webhookPayload.to;
        }

        // Forward message if:
        // 1. TEXT message with content (even if it's a placeholder like [Image], [Video], etc.)
        // 2. BUTTON_RESPONSE message (user clicked a button)
        // 3. AUDIO message with mediaUrl
        // Note: We forward TEXT messages even with placeholder content so webhook can handle all message types
        const shouldForward =
          (messageType === 'TEXT' && content && content.trim().length > 0) ||
          (messageType === 'BUTTON_RESPONSE' && buttonResponse) ||
          (messageType === 'AUDIO' && Boolean(mediaUrl));

        if (shouldForward) {
          // CRITICAL: Check if this is a duplicate (echo of dashboard message)
          // Only check for incoming messages (not fromMe) to avoid blocking legitimate outgoing messages
          let isDuplicate = false;
          if (!fromMe && content) {
            isDuplicate = await checkIfRecentDashboardMessage({
              content: content.trim(),
              fromNumber: sanitizedFromNumber,
              timestamp: timestampIso,
              timeWindow: 5000, // 5 second window
              agentId: agentId
            });
          }

          if (isDuplicate) {
            console.log(`[BAILEYS][WEBHOOK] ⏭️ Skipping webhook for duplicate dashboard message echo:`, {
              messageId,
              from: sanitizedFromNumber,
              contentPreview: content ? content.substring(0, 50) : null,
            });
          } else {
            // Add source to webhook payload based on message type
            // - Dashboard messages (agent to self): source = 'dashboard'
            // - Incoming/Outgoing WhatsApp messages: source = 'whatsapp'
            webhookPayload.source = isDashboardMessage ? 'dashboard' : 'whatsapp';
            
            const messageSource = isDashboardMessage ? 'DASHBOARD' : 'WHATSAPP';
            console.log(`[BAILEYS][WEBHOOK] 📤 Forwarding ${messageType} message to webhook (${messageSource}):`, {
              messageId,
              from: sanitizedFromNumber,
              to: sanitizedToNumber,
              senderName: senderName,
              source: webhookPayload.source,
              isDashboardMessage,
              isIncomingWhatsApp,
              isOutgoingToOther,
              hasContent: Boolean(content),
              contentLength: content?.length || 0,
              hasMediaUrl: Boolean(mediaUrl),
              contentPreview: content ? content.substring(0, 50) : null,
              remoteJid: actualSenderJid,
            });
            await forwardMessageToWebhook(agentId, webhookPayload);
          }
        } else {
          console.log(`[BAILEYS] ⚠️ Skipping webhook forwarding:`, {
            messageId,
            messageType,
            hasContent: Boolean(content),
            contentLength: content ? content.length : 0,
            hasMediaUrl: Boolean(mediaUrl),
            reason: messageType === 'TEXT' 
              ? (content ? 'content is empty' : 'no content extracted')
              : (mediaUrl ? 'unknown' : 'no mediaUrl')
          });
        }
      }

      console.log(`[BAILEYS] ========== END MESSAGES ==========`); 
    });

    console.log(`[BAILEYS] ==================== INIT COMPLETE ====================\n`);
    
    // Note: Lock is NOT released here - connection setup is complete but QR scan is pending
    // Lock will be released when connection succeeds or fails via connection.update handler
    
    // Return success response with proper state
    return {
      success: true,
      status: 'qr_pending',
      phoneNumber: null,
      isActive: false // Critical: Not connected yet, waiting for QR scan
    };

  } catch (error) {
    console.error(`[BAILEYS] ❌ Error initializing:`, error);
    
    // Release lock on error
    connectionLocks.delete(agentId);
    console.log(`[BAILEYS] 🔓 Initialization lock released (error)`);
    
    return {
      success: false,
      error: error.message,
      status: 'error',
      isActive: false
    };
  }
}

async function safeInitializeWhatsApp(agentId, userId = null) {
  const now = Date.now();

  // Check if initialization is already in progress (with stale lock detection)
  const lockValue = connectionLocks.get(agentId);
  if (lockValue) {
    const lockAge = typeof lockValue === 'number' ? now - lockValue : 0;
    
    // If lock is less than 90 seconds old, it's still active
    if (typeof lockValue === 'number' && lockAge < 90000) {
      console.log(`[BAILEYS] ⏳ Connection already in progress (${Math.round(lockAge/1000)}s ago)`);
      return {
        success: false,
        status: 'connecting',
        error: 'Connection already in progress'
      };
    }
    // Otherwise, lock is stale and will be cleared by initializeWhatsApp
  }

  // PHASE 2 FIX: Check database status FIRST to differentiate manual disconnect from error
  // This allows bypassing cooldown for manual disconnects while keeping it for errors
  console.log(`[BAILEYS] 🔍 Checking database status to determine cooldown eligibility...`);
  const { data: dbSession, error: dbError } = await supabaseAdmin
    .from('whatsapp_sessions')
    .select('status, is_active, disconnected_at')
    .eq('agent_id', agentId)
    .maybeSingle();

  if (dbError) {
    console.warn(`[BAILEYS] ⚠️ Error checking database status:`, dbError);
    // Continue with cooldown check - be conservative on error
  }

  // PHASE 2: If status is 'disconnected' (manual disconnect), bypass cooldown
  if (dbSession?.status === 'disconnected') {
    console.log(`[BAILEYS] ✅ Status is 'disconnected' (manual disconnect) - bypassing 401 cooldown`);
    console.log(`[BAILEYS] ✅ User initiated clean disconnect - allowing immediate reconnection`);
    
    // Clear any existing 401 cooldown (defensive - should already be cleared on disconnect)
    const hadCooldown = last401Failure.has(agentId);
    if (hadCooldown) {
      last401Failure.delete(agentId);
      console.log(`[BAILEYS] ✅ Cleared existing 401 cooldown (defensive cleanup)`);
    }
    
    // Allow connection to proceed - no cooldown for manual disconnects
    // Continue to connection attempt below
  } else if (dbSession?.status === 'conflict') {
    // PHASE 2: If status is 'conflict' (error disconnect), apply cooldown
    console.log(`[BAILEYS] 🚫 Session has conflict status (error disconnect) - checking cooldown...`);
    
    // Check if there was a recent 401 failure (prevent auto-retry after errors)
    const last401 = last401Failure.get(agentId);
    if (last401 && (now - last401) < FAILURE_COOLDOWN_MS) {
      const waitMs = FAILURE_COOLDOWN_MS - (now - last401);
      const waitMinutes = Math.ceil(waitMs / 60000);
      console.log(`[BAILEYS] 🚫 401 error occurred recently (${waitMinutes} min ago) - cooldown active`);
      console.log(`[BAILEYS] 🚫 Auto-retry blocked for error scenarios. Manual reconnection required.`);
      
      return {
        success: false,
        status: 'conflict',
        error: `Session conflict detected. Please wait ${waitMinutes} minute(s) or disconnect and reconnect manually.`,
        retryAfter: waitMs,
        requiresManualAction: true
      };
    }
    
    // Cooldown expired or no cooldown - but still conflict status
    console.log(`[BAILEYS] ⚠️ Session has conflict status but cooldown expired - allowing reconnection attempt`);
    console.log(`[BAILEYS] ⚠️ User will need to disconnect first to clear conflict state`);
    // Continue to connection attempt - initializeWhatsApp will handle conflict state
  } else {
    // PHASE 2: For other statuses (connecting, qr_pending, connected, etc.), check 401 cooldown
    // This handles edge cases where last401Failure exists but status isn't set yet
    const last401 = last401Failure.get(agentId);
    if (last401 && (now - last401) < FAILURE_COOLDOWN_MS) {
      const waitMs = FAILURE_COOLDOWN_MS - (now - last401);
      const waitMinutes = Math.ceil(waitMs / 60000);
      console.log(`[BAILEYS] 🚫 401 error occurred recently for agent ${agentId.substring(0, 40)}`);
      console.log(`[BAILEYS] 🚫 Status: ${dbSession?.status || 'unknown'}, Cooldown: ${waitMinutes} min remaining`);
      console.log(`[BAILEYS] 🚫 Auto-retry blocked. Manual reconnection required.`);
      
      // If status is not 'disconnected', apply cooldown
      return {
        success: false,
        status: 'cooldown',
        error: `Recent 401 error. Please wait ${waitMinutes} minute(s) or disconnect and reconnect manually.`,
        retryAfter: waitMs,
        requiresManualAction: true
      };
    }
  }

  // PHASE 2: Bypass general connection cooldown for manual disconnects
  // Only apply general cooldown if status is NOT 'disconnected'
  const lastAttempt = lastConnectionAttempt.get(agentId) || 0;
  if (dbSession?.status !== 'disconnected' && (now - lastAttempt) < COOLDOWN_MS) {
    const waitMs = COOLDOWN_MS - (now - lastAttempt);
    console.log(`[BAILEYS] 🕒 General cooldown active for agent ${agentId.substring(0, 40)}. Retry in ${Math.ceil(waitMs / 1000)}s`);
    return {
      success: false,
      status: 'cooldown',
      retryAfter: waitMs
    };
  } else if (dbSession?.status === 'disconnected' && (now - lastAttempt) < COOLDOWN_MS) {
    // Manual disconnect - bypass general cooldown
    console.log(`[BAILEYS] ✅ Manual disconnect detected - bypassing general connection cooldown`);
  }

  // Note: Lock is now managed inside initializeWhatsApp to prevent race conditions
  lastConnectionAttempt.set(agentId, now);
  
  // Call initializeWhatsApp directly - it handles its own locking
  return await initializeWhatsApp(agentId, userId);
}

// Disconnect
async function disconnectWhatsApp(agentId) {
  console.log(`\n[BAILEYS] ==================== DISCONNECT START ====================`);
  console.log(`[BAILEYS] Disconnecting: ${agentId.substring(0, 40)}`);
  
  const cleanupSteps = {
    logoutAttempted: false,
    logoutSucceeded: false,
    intervalsCleared: false,
    socketClosed: false,
    instanceTrackingCleared: false,
    memoryCleared: false,
    localFilesDeleted: false,
    databaseCleared: false
  };
  
  const errors = [];
  const disconnectedAt = new Date().toISOString();
  
  try {
    const session = activeSessions.get(agentId);
    
    // STEP 1: Attempt explicit logout from WhatsApp servers
    if (session?.socket) {
      console.log(`[BAILEYS] 🔐 Step 1: Attempting explicit logout from WhatsApp servers...`);
      cleanupSteps.logoutAttempted = true;
      
      try {
        // Check if socket is still connected before attempting logout
        if (session.isConnected && session.socket && typeof session.socket.logout === 'function') {
          await Promise.race([
            session.socket.logout(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Logout timeout')), 5000))
          ]);
          cleanupSteps.logoutSucceeded = true;
          console.log(`[BAILEYS] ✅ Logout successful - device unregistered from WhatsApp servers`);
        } else {
          console.log(`[BAILEYS] ℹ️ Socket not connected or logout not available - skipping logout`);
          cleanupSteps.logoutSucceeded = true; // Not an error if already disconnected
        }
      } catch (logoutError) {
        // Logout might fail if already disconnected - this is acceptable
        if (logoutError.message === 'Logout timeout' || logoutError.message.includes('not connected')) {
          console.log(`[BAILEYS] ℹ️ Logout skipped: ${logoutError.message}`);
          cleanupSteps.logoutSucceeded = true; // Not an error
        } else {
          console.warn(`[BAILEYS] ⚠️ Logout failed (non-critical):`, logoutError.message);
          errors.push({ step: 'logout', error: logoutError.message });
          // Continue cleanup even if logout fails
        }
      }
      
      // STEP 2: Stop health check, heartbeat, connection monitor, and backup intervals
      console.log(`[BAILEYS] 🛑 Step 2: Stopping all intervals...`);
      try {
        // REMOVED: healthCheckInterval - no longer used
        if (session.heartbeatInterval) {
          clearInterval(session.heartbeatInterval);
          session.heartbeatInterval = null;
        }
        if (session.backupInterval) {
          clearInterval(session.backupInterval);
          session.backupInterval = null;
        }
        cleanupSteps.intervalsCleared = true;
        console.log(`[BAILEYS] ✅ All intervals cleared`);
      } catch (intervalError) {
        console.warn(`[BAILEYS] ⚠️ Error clearing intervals:`, intervalError.message);
        errors.push({ step: 'intervals', error: intervalError.message });
      }
      
      // STEP 3: Close socket and remove event listeners
      console.log(`[BAILEYS] 🔌 Step 3: Closing socket and removing event listeners...`);
      try {
        session.socket.ev.removeAllListeners();
        session.socket.end();
        cleanupSteps.socketClosed = true;
        console.log(`[BAILEYS] ✅ Socket closed`);
      } catch (socketError) {
        console.warn(`[BAILEYS] ⚠️ Error closing socket:`, socketError.message);
        errors.push({ step: 'socket', error: socketError.message });
      }
    } else {
      console.log(`[BAILEYS] ℹ️ No active session found - skipping socket cleanup`);
      cleanupSteps.socketClosed = true; // Not an error if no session
    }
    
    // STEP 4: Clear instance tracking in database (with retry)
    console.log(`[BAILEYS] 🗄️ Step 4: Clearing instance tracking in database...`);
    const maxRetries = 3;
    let instanceTrackingSuccess = false;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { error: instanceError } = await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            instance_id: null,
            instance_hostname: null,
            instance_pid: null,
            last_heartbeat: null,
            updated_at: disconnectedAt
          })
          .eq('agent_id', agentId);
        
        if (instanceError) {
          throw instanceError;
        }
        
        instanceTrackingSuccess = true;
        cleanupSteps.instanceTrackingCleared = true;
        console.log(`[BAILEYS] ✅ Instance tracking cleared (attempt ${attempt})`);
        break;
      } catch (instanceError) {
        if (attempt === maxRetries) {
          console.error(`[BAILEYS] ❌ Failed to clear instance tracking after ${maxRetries} attempts:`, instanceError.message);
          errors.push({ step: 'instance_tracking', error: instanceError.message });
        } else {
          console.warn(`[BAILEYS] ⚠️ Instance tracking clear failed (attempt ${attempt}/${maxRetries}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // Exponential backoff
        }
      }
    }
    
    // STEP 5: Clear from memory
    console.log(`[BAILEYS] 🧠 Step 5: Clearing from memory...`);
    try {
      activeSessions.delete(agentId);
      qrGenerationTracker.delete(agentId);
      connectionLocks.delete(agentId);
      lastConnectionAttempt.delete(agentId);
      cleanupSteps.memoryCleared = true;
      console.log(`[BAILEYS] ✅ Memory cleared`);
    } catch (memoryError) {
      console.warn(`[BAILEYS] ⚠️ Error clearing memory:`, memoryError.message);
      errors.push({ step: 'memory', error: memoryError.message });
    }
    
    // Clear 401 failure cooldown on manual disconnect (user wants to reconnect)
    last401Failure.delete(agentId);
    console.log(`[BAILEYS] ✅ 401 failure cooldown cleared (manual disconnect)`);
    
    // STEP 6: Delete local auth directory (with error handling)
    console.log(`[BAILEYS] 🗑️ Step 6: Deleting local auth directory...`);
    const authDir = path.join(__dirname, '../../auth_sessions', agentId);
    if (fs.existsSync(authDir)) {
      try {
        fs.rmSync(authDir, { recursive: true, force: true });
        cleanupSteps.localFilesDeleted = true;
        console.log(`[BAILEYS] ✅ Local credentials deleted`);
      } catch (deleteError) {
        console.error(`[BAILEYS] ❌ Failed to delete local auth directory:`, deleteError.message);
        console.error(`[BAILEYS] Error details:`, deleteError);
        errors.push({ step: 'local_files', error: deleteError.message });
        // Continue - database cleanup is more important
      }
    } else {
      console.log(`[BAILEYS] ℹ️ No local auth directory to delete`);
      cleanupSteps.localFilesDeleted = true; // Not an error if doesn't exist
    }
    
    // STEP 7: Clear database session data completely (with retry and NULL verification)
    console.log(`[BAILEYS] 🗄️ Step 7: Clearing database session data...`);
    let dbClearSuccess = false;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // CRITICAL: Use explicit NULL (not empty string or object)
        // Include disconnected_at - if column doesn't exist, database will ignore it
        // (PostgreSQL/Supabase allows extra fields in updates)
        const updateData = {
          session_data: null, // Explicitly set to NULL
          qr_code: null,
          qr_generated_at: null,
          is_active: false,
          phone_number: null,
          status: 'disconnected', // Set status to disconnected
          disconnected_at: disconnectedAt, // Track when disconnect occurred (column may not exist yet)
          updated_at: disconnectedAt
        };
        
        const { error: dbError, data: dbData } = await supabaseAdmin
          .from('whatsapp_sessions')
          .update(updateData)
          .eq('agent_id', agentId)
          .select('session_data'); // Verify update succeeded
        
        if (dbError) {
          // Check if error is due to missing disconnected_at column
          if (dbError.message && dbError.message.includes('disconnected_at')) {
            console.log(`[BAILEYS] ℹ️ disconnected_at column not found, retrying without it...`);
            // Retry without disconnected_at column
            const { error: retryError, data: retryData } = await supabaseAdmin
              .from('whatsapp_sessions')
              .update({
                session_data: null,
                qr_code: null,
                qr_generated_at: null,
                is_active: false,
                phone_number: null,
                status: 'disconnected',
                updated_at: disconnectedAt
              })
              .eq('agent_id', agentId)
              .select('session_data');
            
            if (retryError) {
              throw retryError;
            }
            
            // Use retry data for verification
            if (retryData && retryData.length > 0) {
              const updatedSession = retryData[0];
              if (updatedSession.session_data !== null && updatedSession.session_data !== undefined) {
                console.warn(`[BAILEYS] ⚠️ session_data is not NULL after update:`, typeof updatedSession.session_data);
                // Try one more explicit NULL update
                await supabaseAdmin
                  .from('whatsapp_sessions')
                  .update({ session_data: null })
                  .eq('agent_id', agentId)
                  .is('session_data', null); // Use is() to ensure NULL
              }
            }
          } else {
            throw dbError;
          }
        } else {
          // Verify session_data is actually NULL (not empty object/string)
          if (dbData && dbData.length > 0) {
            const updatedSession = dbData[0];
            if (updatedSession.session_data !== null && updatedSession.session_data !== undefined) {
              console.warn(`[BAILEYS] ⚠️ session_data is not NULL after update:`, typeof updatedSession.session_data);
              // Try one more explicit NULL update
              await supabaseAdmin
                .from('whatsapp_sessions')
                .update({ session_data: null })
                .eq('agent_id', agentId)
                .is('session_data', null); // Use is() to ensure NULL
            }
          }
        }
        
        dbClearSuccess = true;
        cleanupSteps.databaseCleared = true;
        console.log(`[BAILEYS] ✅ Database cleared (attempt ${attempt})`);
        console.log(`[BAILEYS] ✅ Status set to 'disconnected', disconnected_at: ${disconnectedAt}`);
        break;
      } catch (dbError) {
        if (attempt === maxRetries) {
          console.error(`[BAILEYS] ❌ Failed to clear database after ${maxRetries} attempts:`, dbError.message);
          errors.push({ step: 'database', error: dbError.message });
        } else {
          console.warn(`[BAILEYS] ⚠️ Database clear failed (attempt ${attempt}/${maxRetries}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // Exponential backoff
        }
      }
    }
    
    // STEP 8: Verify cleanup succeeded
    console.log(`[BAILEYS] ✅ Step 8: Verifying cleanup...`);
    const allCriticalStepsSucceeded = 
      cleanupSteps.socketClosed &&
      cleanupSteps.memoryCleared &&
      cleanupSteps.databaseCleared;
    
    if (allCriticalStepsSucceeded) {
      console.log(`[BAILEYS] ✅ All critical cleanup steps succeeded`);
    } else {
      console.warn(`[BAILEYS] ⚠️ Some cleanup steps failed:`, cleanupSteps);
    }
    
    if (errors.length > 0) {
      console.warn(`[BAILEYS] ⚠️ Cleanup completed with ${errors.length} non-critical error(s):`);
      errors.forEach(err => {
        console.warn(`[BAILEYS]   - ${err.step}: ${err.error}`);
      });
    }
    
    console.log(`[BAILEYS] ==================== DISCONNECT COMPLETE ====================\n`);
    emitAgentEvent(agentId, 'disconnected', { reason: 'manual', disconnectedAt, cleanupSteps, errors });
    
    // Return cleanup status for verification
    return {
      success: allCriticalStepsSucceeded,
      cleanupSteps,
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    console.error(`[BAILEYS] ❌ Critical error during disconnect:`, error);
    emitAgentEvent(agentId, 'disconnected', { reason: 'error', error: error.message });
    throw error; // Re-throw critical errors
  }
}

// Get QR code for an agent
function getQRCode(agentId) {
  const session = activeSessions.get(agentId);
  return session?.qrCode || null;
}

// Get status
function getSessionStatus(agentId) {
  const session = activeSessions.get(agentId);
  
  if (!session) {
    return {
      exists: false,
      isConnected: false,
      phoneNumber: null,
      qrCode: null
    };
  }
  
  return {
    exists: true,
    isConnected: session.isConnected,
    phoneNumber: session.phoneNumber,
    qrCode: session.qrCode
  };
}

async function getWhatsAppStatus(agentId) {
  const nowIso = new Date().toISOString();
  const response = {
    success: true,
    connected: false,
    status: 'disconnected',
    is_active: false,
    qr_code: null,
    phone_number: null,
    updated_at: nowIso,
    source: 'none',
    message: null,
    socket_state: null,
    last_activity: null,
    failure_reason: null,
    failure_at: null
  };

  try {
    const session = activeSessions.get(agentId);

    if (session) {
      response.source = 'memory';
      response.socket_state = session.socket?.ws?.readyState ?? null;
      // REMOVED: last_activity tracking - we can't reliably track it
      response.phone_number =
        session.phoneNumber ||
        session.socket?.user?.id?.split(':')[0]?.replace('@s.whatsapp.net', '') ||
        null;

      if (session.failureReason) {
        response.failure_reason = session.failureReason;
        response.failure_at = session.failureAt
          ? new Date(session.failureAt).toISOString()
          : nowIso;
        response.status = 'conflict';
        if (!response.message) {
          response.message = session.failureReason;
        }
      }

      if (session.isConnected || response.socket_state === 1) {
        response.connected = true;
        response.is_active = true;
        response.status = 'connected';
        response.qr_code = null;
      } else if (session.qrCode) {
        // CRITICAL: Check if QR is expired before returning it
        if (session.qrGeneratedAt) {
          const qrAge = Date.now() - session.qrGeneratedAt;
          if (qrAge > QR_EXPIRATION_MS) {
            console.log(`[BAILEYS] ⚠️ QR in memory is expired (${Math.round(qrAge/1000)}s old), clearing`);
            session.qrCode = null;
            session.qrGeneratedAt = null;
            response.status = 'disconnected';
            response.qr_code = null;
          } else {
            response.status = 'qr_pending';
            response.qr_code = session.qrCode;
          }
        } else {
          response.status = 'qr_pending';
          response.qr_code = session.qrCode;
        }
      } else if (session.connectionState) {
        response.status = session.connectionState;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('status, is_active, qr_code, phone_number, updated_at')
      .eq('agent_id', agentId)
      .maybeSingle();

    if (error) {
      console.error(`[BAILEYS] ⚠️ Supabase status fetch error for ${agentId.substring(0, 40)}:`, error.message);
    }

    if (data) {
      response.source =
        response.source === 'memory' ? 'memory+database' : 'database';
      response.updated_at = data.updated_at || response.updated_at;
      if (!response.phone_number && data.phone_number) {
        response.phone_number = data.phone_number;
      }

      // CRITICAL: Only trust database status if there's no active session in memory
      // If memory session exists, it's the source of truth (more recent)
      if (!response.connected && !session) {
        // No active session in memory - check database
        if (data.is_active && data.status === 'connected' && data.phone_number) {
          // Database says connected, but verify it's not stale
          // If status is conflict, don't trust is_active
          if (data.status !== 'conflict') {
            response.connected = true;
            response.is_active = true;
            response.status = 'connected';
            response.qr_code = null;
          } else {
            // Status is conflict - mark as disconnected
            response.connected = false;
            response.is_active = false;
            response.status = 'conflict';
          }
        } else if (data.qr_code) {
          // CRITICAL: Check if database QR is expired
          const { data: qrData } = await supabaseAdmin
            .from('whatsapp_sessions')
            .select('qr_generated_at')
            .eq('agent_id', agentId)
            .maybeSingle();
          
          if (qrData?.qr_generated_at) {
            const qrAge = Date.now() - new Date(qrData.qr_generated_at).getTime();
            if (qrAge > QR_EXPIRATION_MS) {
              console.log(`[BAILEYS] ⚠️ QR in database is expired (${Math.round(qrAge/1000)}s old), clearing`);
              await supabaseAdmin
                .from('whatsapp_sessions')
                .update({ qr_code: null, status: 'disconnected' })
                .eq('agent_id', agentId);
              response.status = 'disconnected';
              response.qr_code = null;
            } else {
              response.qr_code = data.qr_code;
              response.status = 'qr_pending';
            }
          } else {
            response.qr_code = data.qr_code;
            response.status = 'qr_pending';
          }
        } else if (data.status) {
          response.status = data.status;
          // If status is conflict, ensure is_active is false
          if (data.status === 'conflict') {
            response.is_active = false;
            response.connected = false;
          }
        }
      }

      if (data.status === 'conflict' && !response.message) {
        response.message = 'WhatsApp reported a session conflict. Please remove other linked devices and reconnect.';
        if (!response.failure_reason) {
          response.failure_reason = 'conflict';
        }
      }
    }

    if (response.source === 'none') {
      response.message = 'No active WhatsApp session';
      response.source = 'fallback';
    }
    
    // CRITICAL: Add detailed QR state logging
    if (response.status === 'qr_pending') {
      const session = activeSessions.get(agentId);
      const qrGenTime = qrGenerationTracker.get(agentId);
      console.log(`[BAILEYS] 📊 QR State Check:`, {
        agentId: agentId.substring(0, 8) + '...',
        hasQRInMemory: !!session?.qrCode,
        hasQRInDatabase: !!data?.qr_code,
        qrCodeInResponse: !!response.qr_code,
        qrGeneratedAt: session?.qrGeneratedAt ? new Date(session.qrGeneratedAt).toISOString() : null,
        cooldownRemaining: qrGenTime ? Math.max(0, Math.round((120000 - (Date.now() - qrGenTime)) / 1000)) + 's' : 'none',
        dbStatus: data?.status,
        socketState: session?.socket?.ws?.readyState
      });
    }

    return response;
  } catch (error) {
    console.error(`[BAILEYS] ❌ Error in getWhatsAppStatus for ${agentId.substring(0, 40)}:`, error);
    return {
      success: false,
      connected: false,
      status: 'error',
      is_active: false,
      qr_code: null,
      phone_number: null,
      updated_at: nowIso,
      source: 'error',
      message: error.message,
      socket_state: null,
      last_activity: null
    };
  }
}

// Send message
/**
 * ✅ TASK 2: Send message with button support
 * @param {string} agentId - Agent ID
 * @param {string} to - Recipient phone number
 * @param {string|object} message - Plain text string or button message object
 * @param {boolean} isButtonMessage - Whether message is a button message (optional, auto-detected)
 * @returns {Promise<void>}
 */
async function sendMessage(agentId, to, message, isButtonMessage = false) {
  const session = activeSessions.get(agentId);
  
  if (!session || !session.isConnected) {
    throw new Error('WhatsApp not connected');
  }
  
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  
  // ✅ TASK 2: Handle button messages
  if (isButtonMessage || (message && typeof message === 'object' && message.buttons)) {
    // Button message format
    const buttonMessage = typeof message === 'object' ? message : JSON.parse(message);
    
    if (!buttonMessage.text || !Array.isArray(buttonMessage.buttons) || buttonMessage.buttons.length === 0) {
      throw new Error('Invalid button message format. Must have text and buttons array.');
    }
    
    // ✅ FIX: Use Baileys buttonsMessage format (the format that actually works)
    // Based on Baileys GitHub examples and documentation, the working format is:
    // { text, footer, buttons: [{ buttonId, buttonText: { displayText }, type: 1 }], headerType: 1 }
    // This is the standard format that Baileys supports, even if WhatsApp has restrictions
    
    const baileysButtons = buttonMessage.buttons.slice(0, 3).map((btn, index) => {
      const buttonText = btn.text.substring(0, 20); // Max 20 chars per WhatsApp
      const buttonId = btn.id || `btn_${index + 1}`;
      
      return {
        buttonId: buttonId,
        buttonText: { 
          displayText: buttonText
        },
        type: 1 // REPLY button type (1 = quick reply button)
      };
    });
    
    // Build buttonsMessage in the format Baileys expects (from official examples)
    const baileysMessage = {
      text: buttonMessage.text,
      buttons: baileysButtons,
      headerType: 1 // TEXT header type
    };
    
    // Add optional footer if provided
    if (buttonMessage.footer) {
      baileysMessage.footer = buttonMessage.footer.substring(0, 60);
    }
    
    console.log(`[BAILEYS] 📤 Sending buttonsMessage to ${to}`, {
      textLength: buttonMessage.text.length,
      buttonCount: baileysButtons.length,
      buttonIds: baileysButtons.map(b => b.buttonId),
      buttonTexts: baileysButtons.map(b => b.buttonText.displayText),
      hasFooter: !!buttonMessage.footer,
      jid: jid,
      messageFormat: JSON.stringify(baileysMessage, null, 2)
    });
    
    try {
      const result = await session.socket.sendMessage(jid, baileysMessage);
      console.log(`[BAILEYS] ✅ buttonsMessage sent successfully to ${to}`, {
        messageId: result?.key?.id,
        status: result?.status,
        hasButtons: baileysButtons.length > 0
      });
    } catch (sendError) {
      console.error(`[BAILEYS] ❌ Failed to send buttonsMessage:`, sendError.message);
      console.error(`[BAILEYS] Error stack:`, sendError.stack);
      
      // Log full error details for debugging
      const errorDetails = {
        message: sendError.message,
        name: sendError.name,
        code: sendError.code,
        status: sendError.status,
        statusCode: sendError.statusCode
      };
      
      if (sendError.response) {
        errorDetails.response = sendError.response;
      }
      if (sendError.data) {
        errorDetails.data = sendError.data;
      }
      
      console.error(`[BAILEYS] Error details:`, JSON.stringify(errorDetails, null, 2));
      
      // Final fallback: plain text
      console.log(`[BAILEYS] ⚠️ Falling back to plain text message`);
      try {
        await session.socket.sendMessage(jid, { text: buttonMessage.text });
        console.log(`[BAILEYS] ✅ Plain text fallback sent to ${to}`);
      } catch (textError) {
        console.error(`[BAILEYS] ❌ Even plain text failed:`, textError.message);
        throw textError;
      }
      
      throw new Error(`buttonsMessage failed: ${sendError.message}. Sent as plain text instead.`);
    }
  } else {
    // Plain text message
    const textMessage = typeof message === 'string' ? message : String(message);
    await session.socket.sendMessage(jid, { text: textMessage });
    console.log(`[BAILEYS] ✅ Text message sent to ${to}`);
  }
}

// Cleanup expired QR codes
setInterval(async () => {
  try {
    const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();
    
    const { data: expiredSessions } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id')
      .lt('qr_generated_at', twoMinutesAgo)
      .eq('is_active', false)
      .not('qr_code', 'is', null);
    
    if (expiredSessions && expiredSessions.length > 0) {
      console.log(`[CLEANUP] Clearing ${expiredSessions.length} expired QR codes`);
      
      for (const session of expiredSessions) {
        qrGenerationTracker.delete(session.agent_id);
        
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            qr_code: null,
            qr_generated_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', session.agent_id);
      }
      
      console.log(`[CLEANUP] ✅ Complete`);
    }
  } catch (error) {
    console.error('[CLEANUP] Error:', error);
  }
}, 300000);

async function bufferFromFile(file) {
  if (!file) {
    throw new Error('File payload missing');
  }

  if (typeof file.arrayBuffer === 'function') {
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (file.buffer) {
    return Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
  }

  throw new Error('Unsupported file payload - expected File or Buffer');
}

function sanitiseFileName(filename) {
  return filename.replace(/[^a-z0-9\.\-_]/gi, '_');
}

async function uploadAgentFile(agentId, file) {
  if (!agentId) throw new Error('Agent ID is required');
  if (!file?.name) throw new Error('File name is required');

  if (!ALLOWED_FILE_TYPES.has(file.type)) {
    throw new Error('File type not supported. Use PDF, DOC, or DOCX');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File exceeds 10MB limit');
  }

  const buffer = await bufferFromFile(file);
  const timestamp = Date.now();
  const safeName = sanitiseFileName(file.name);
  const storagePath = `${agentId}/${timestamp}_${safeName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error('[FILES] Upload failed:', uploadError);
    throw new Error('Upload failed. Try again');
  }

  const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error('[FILES] Failed to create signed URL:', signedUrlError);
    throw new Error('Upload succeeded but fetching URL failed');
  }

  const metadata = {
    id: randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type,
    url: signedUrlData.signedUrl,
    uploadedAt: new Date().toISOString(),
    storagePath: `${STORAGE_BUCKET}/${storagePath}`
  };

  return {
    url: signedUrlData.signedUrl,
    metadata
  };
}

async function updateAgentFiles(agentId, files) {
  if (!agentId) throw new Error('Agent ID is required');

  const sanitizedFiles = Array.isArray(files) ? files : [];

  const { data, error } = await supabaseAdmin
    .from('agents')
    .update({ uploaded_files: sanitizedFiles })
    .eq('id', agentId)
    .select('uploaded_files')
    .single();

  if (error) {
    console.error('[FILES] Failed to update file list:', error);
    throw new Error('Failed to update files');
  }

  return data.uploaded_files || [];
}

async function deleteAgentFile(agentId, fileId) {
  if (!agentId || !fileId) throw new Error('Agent ID and file ID are required');

  const { data: agentData, error: agentError } = await supabaseAdmin
    .from('agents')
    .select('uploaded_files')
    .eq('id', agentId)
    .maybeSingle();

  if (agentError) {
    console.error('[FILES] Failed to load uploaded files:', agentError);
    throw new Error('Failed to delete file. Try again');
  }

  const files = agentData?.uploaded_files || [];
  const fileToDelete = files.find((item) => item.id === fileId);

  if (!fileToDelete) {
    throw new Error('File not found');
  }

  const storagePath = fileToDelete.storagePath?.replace(`${STORAGE_BUCKET}/`, '');

  if (storagePath) {
    const { error: removeError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove([storagePath]);

    if (removeError) {
      console.error('[FILES] Failed to remove storage object:', removeError);
      throw new Error('Delete failed. Try again');
    }
  }

  const updatedFiles = files.filter((item) => item.id !== fileId);

  await updateAgentFiles(agentId, updatedFiles);

  return updatedFiles;
}

async function updateIntegrationEndpoints(agentId, endpoints) {
  if (!agentId) throw new Error('Agent ID is required');

  const list = Array.isArray(endpoints) ? endpoints : [];

  if (list.length > 10) {
    throw new Error('Maximum 10 endpoints allowed');
  }

  const seen = new Set();
  const sanitized = list.map((endpoint) => {
    if (!endpoint?.name || !endpoint?.url) {
      throw new Error('Endpoint name and URL are required');
    }

    const key = endpoint.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new Error('Endpoint name already exists');
    }
    seen.add(key);

    return {
      id: endpoint.id || randomUUID(),
      name: endpoint.name,
      url: endpoint.url
    };
  });

  const { data, error } = await supabaseAdmin
    .from('agents')
    .update({ integration_endpoints: sanitized })
    .eq('id', agentId)
    .select('integration_endpoints')
    .single();

  if (error) {
    console.error('[ENDPOINTS] Failed to update endpoints:', error);
    throw new Error('Failed to update integration endpoints');
  }

  return data.integration_endpoints || [];
}

// Initialize existing sessions on startup (optional - for session recovery)
// Initialize existing WhatsApp sessions on server startup
// This function is called when the backend starts to restore active connections
async function initializeExistingSessions() {
  try {
    console.log('\n[BAILEYS] ========== STARTUP: CHECKING FOR EXISTING SESSIONS ==========');
    console.log('[BAILEYS] 🔍 Querying database for active WhatsApp sessions...');
    
    // CRITICAL: Don't auto-reconnect sessions with conflict status (401 errors)
    // These require manual user intervention
    // ALSO: Include sessions with credentials (session_data not null) even if is_active is false
    // This handles cases where server restarted during reconnection
    const { data: activeSessionsData, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, phone_number, status, session_data')
      .or('is_active.eq.true,session_data.not.is.null') // Active OR has credentials
      .not('status', 'in', '("conflict","disconnected")') // Exclude conflict and manually disconnected
      .limit(20); // Support up to 20 concurrent connections
    
    if (error) {
      console.error('[BAILEYS] ❌ Error fetching active sessions:', error);
      return;
    }
    
    if (!activeSessionsData || activeSessionsData.length === 0) {
      console.log('[BAILEYS] ℹ️  No existing active sessions found in database');
      console.log('[BAILEYS] 📝 Connection persistence: When users connect, sessions will persist across server restarts');
      console.log('[BAILEYS] ========== STARTUP CHECK COMPLETE ==========\n');
      return;
    }
    
    // Check for conflict sessions that won't be auto-reconnected
    const { data: conflictSessions } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, status')
      .eq('is_active', true)
      .eq('status', 'conflict')
      .limit(20);
    
    if (conflictSessions && conflictSessions.length > 0) {
      console.log(`[BAILEYS] ⚠️  Found ${conflictSessions.length} session(s) with conflict status (will NOT auto-reconnect):`);
      conflictSessions.forEach((session, index) => {
        console.log(`[BAILEYS]    ${index + 1}. Agent: ${session.agent_id.substring(0, 20)}... Status: ${session.status}`);
      });
      console.log(`[BAILEYS] ℹ️  These sessions require manual reconnection due to 401 errors (device removed/conflict)`);
    }
    
    if (activeSessionsData.length === 0) {
      console.log(`[BAILEYS] ℹ️  No active sessions to auto-reconnect (conflict sessions excluded)`);
      console.log('[BAILEYS] 📝 Connection persistence: When users connect, sessions will persist across server restarts');
      console.log('[BAILEYS] ========== STARTUP CHECK COMPLETE ==========\n');
      return;
    }
    
    // Filter to only sessions with credentials for actual reconnection
    const sessionsWithCreds = activeSessionsData.filter(s => s.session_data?.creds);
    const sessionsWithoutCreds = activeSessionsData.filter(s => !s.session_data?.creds);
    
    console.log(`[BAILEYS] ✅ Found ${activeSessionsData.length} session(s) to check:`);
    console.log(`[BAILEYS]    - With credentials (will reconnect): ${sessionsWithCreds.length}`);
    console.log(`[BAILEYS]    - Without credentials (need QR scan): ${sessionsWithoutCreds.length}`);
    
    sessionsWithCreds.forEach((session, index) => {
      console.log(`[BAILEYS]    ${index + 1}. Agent: ${session.agent_id.substring(0, 20)}... Phone: ${session.phone_number || 'Unknown'} [HAS CREDS]`);
    });
    
    // Use sessions with credentials for reconnection
    const sessionsToReconnect = sessionsWithCreds;
    
    if (sessionsToReconnect.length === 0) {
      console.log(`[BAILEYS] ℹ️  No sessions with valid credentials to auto-reconnect`);
      console.log('[BAILEYS] 📝 Users will need to scan QR code to connect their agents');
      console.log('[BAILEYS] ========== STARTUP CHECK COMPLETE ==========\n');
      return;
    }
    
    console.log(`\n[BAILEYS] 🔄 AUTO-RECONNECTING ${sessionsToReconnect.length} session(s) with credentials...`);
    console.log('[BAILEYS] This ensures WhatsApp connections persist across server restarts.');
    console.log('[BAILEYS] ⚠️  Note: Sessions with conflict/disconnected status are excluded.\n');
    
    // Auto-reconnect each session with credentials
    let successCount = 0;
    let failCount = 0;
    
    for (const sessionData of sessionsToReconnect) {
      try {
        console.log(`[BAILEYS] 🔄 Restoring session for agent: ${sessionData.agent_id.substring(0, 20)}...`);
        
        // Call initializeWhatsApp to restore the connection
        // This will load saved credentials and reconnect automatically
        const result = await initializeWhatsApp(sessionData.agent_id, null);
        
        if (result.success) {
          successCount++;
          console.log(`[BAILEYS] ✅ Session restored successfully for ${sessionData.agent_id.substring(0, 20)}...`);
        } else {
          failCount++;
          console.log(`[BAILEYS] ⚠️  Session restoration failed for ${sessionData.agent_id.substring(0, 20)}...: ${result.error}`);
        }
        
        // Small delay between reconnections to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        failCount++;
        console.error(`[BAILEYS] ❌ Error restoring session for ${sessionData.agent_id.substring(0, 20)}...:`, error.message);
      }
    }
    
    console.log(`\n[BAILEYS] ========== AUTO-RECONNECT SUMMARY ==========`);
    console.log(`[BAILEYS] ✅ Successfully restored: ${successCount} session(s)`);
    console.log(`[BAILEYS] ❌ Failed to restore: ${failCount} session(s)`);
    console.log(`[BAILEYS] 📱 WhatsApp connections ${successCount > 0 ? 'ACTIVE and ready to receive messages' : 'will reconnect when accessed'}`);
    console.log(`[BAILEYS] ========== STARTUP COMPLETE ==========\n`);
    
  } catch (error) {
    console.error('[BAILEYS] ❌ Critical error in initializeExistingSessions:', error.message);
    console.log('[BAILEYS] ⚠️  Server will continue, but WhatsApp sessions may need manual reconnection');
    // Don't crash the server
  }
}

/**
 * Reconnect all agents that were active before server restart
 * Called on server startup to restore connections
 */
async function reconnectAllAgents() {
  try {
    console.log('[RECONNECT-ALL] 🔍 Finding agents to reconnect...');
    
    // Get all agents that were connected or active
    const { data: sessions, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, user_id, status, phone_number')
      .in('status', ['connected', 'qr_pending', 'connecting'])
      .eq('is_active', true);
    
    if (error) {
      console.error('[RECONNECT-ALL] ❌ Error fetching sessions:', error);
      return;
    }
    
    if (!sessions || sessions.length === 0) {
      console.log('[RECONNECT-ALL] ℹ️  No agents to reconnect');
      return;
    }
    
    console.log(`[RECONNECT-ALL] 📱 Found ${sessions.length} agent(s) to reconnect`);
    
    // Reconnect each agent
    for (const session of sessions) {
      try {
        console.log(`[RECONNECT-ALL] 🔌 Reconnecting agent: ${session.agent_id}`);
        
        // Small delay between reconnections to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Initialize the connection (will use existing credentials)
        await initializeWhatsApp(session.agent_id, session.user_id);
        
        console.log(`[RECONNECT-ALL] ✅ Agent ${session.agent_id} reconnected`);
      } catch (error) {
        console.error(`[RECONNECT-ALL] ❌ Failed to reconnect ${session.agent_id}:`, error.message);
        
        // Update status to error
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            status: 'error',
            last_error: error.message,
            is_active: false
          })
          .eq('agent_id', session.agent_id);
      }
    }
    
    console.log('[RECONNECT-ALL] ✅ Reconnection process complete');
  } catch (error) {
    console.error('[RECONNECT-ALL] ❌ Error in reconnectAllAgents:', error);
  }
}

module.exports = {
  initializeWhatsApp,
  safeInitializeWhatsApp,
  disconnectWhatsApp,
  getQRCode,
  getSessionStatus,
  getWhatsAppStatus,
  sendMessage,
  uploadAgentFile,
  updateAgentFiles,
  deleteAgentFile,
  updateIntegrationEndpoints,
  activeSessions,
  connectionLocks, // Expose for connection monitor to check
  initializeExistingSessions,
  subscribeToAgentEvents,
  reconnectAllAgents,
  // Multi-layer monitoring exports
  cleanupMonitoring,
  startAllMonitoring,
  connectionMonitors,
  healthCheckIntervals
};
