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

// Store active sessions in memory
const activeSessions = new Map();
const qrGenerationTracker = new Map();
const connectionLocks = new Map(); // agentId -> boolean
const lastConnectionAttempt = new Map(); // agentId -> timestamp ms
const COOLDOWN_MS = 5000;
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

async function forwardMessageToWebhook(agentId, messagePayload) {
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

    // Construct webhook payload with user_id (snake_case to match database field)
    const webhookPayload = {
      agentId,
      ...(userId && { user_id: userId }), // Include user_id only if it exists
      ...messagePayload,
    };

    await axios.post(
      webhookUrl,
      webhookPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-WhatsApp-Agent': agentId,
          'X-WhatsApp-RemoteJid': messagePayload.from,
        },
        timeout: MESSAGE_FORWARD_TIMEOUT_MS,
      }
    );

    const label = messagePayload.messageType || messagePayload.type || 'message';
    console.log(
      `[BAILEYS][WEBHOOK] ✅ Forwarded ${label} ${messagePayload.messageId || messagePayload.id} from ${messagePayload.from}${userId ? ` (user_id: ${userId})` : ''}`
    );
  } catch (error) {
    const status = error.response?.status;
    const responseData = error.response?.data;
    const messageHint = responseData || error.message;

    console.error(
      `[BAILEYS][WEBHOOK] ❌ Failed to forward ${messagePayload.messageType || messagePayload.type || 'message'} ${
        messagePayload.messageId || messagePayload.id
      } to ${webhookUrl}. Status: ${status || 'n/a'}`,
      messageHint
    );
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

  let uploadError;

  try {
    const { error } = await supabaseAdmin.storage.from(audioBucketName).upload(storagePath, buffer, uploadOptions);
    uploadError = error;
  } catch (error) {
    uploadError = error;
  }

  if (uploadError) {
    if (uploadError.message?.includes('exists')) {
      const uniqueSuffix = randomUUID().slice(0, 8);
      storagePath = `${normalizedAgentId}/${baseFileName}-${uniqueSuffix}.${extension}`;
      const { error: retryError } = await supabaseAdmin.storage
        .from(audioBucketName)
        .upload(storagePath, buffer, uploadOptions);
      if (retryError) {
        console.error('[BAILEYS][STORAGE] ❌ Failed to upload audio after retry:', retryError);
        throw retryError;
      }
    } else {
      console.error('[BAILEYS][STORAGE] ❌ Failed to upload audio:', uploadError);
      throw uploadError;
    }
  }

  let mediaUrl = null;

  try {
    const ttl = Number(process.env.AUDIO_SIGNED_URL_TTL || DEFAULT_AUDIO_SIGNED_URL_TTL);
    const { data, error } = await supabaseAdmin.storage
      .from(audioBucketName)
      .createSignedUrl(storagePath, ttl);

    if (error) {
      console.warn('[BAILEYS][STORAGE] ⚠️ Failed to create signed URL, attempting public URL fallback:', error);
      const { data: publicData } = await supabaseAdmin.storage.from(audioBucketName).getPublicUrl(storagePath);
      mediaUrl = publicData?.publicUrl || null;
    } else {
      mediaUrl = data?.signedUrl || null;
    }
  } catch (error) {
    console.warn('[BAILEYS][STORAGE] ⚠️ Error generating audio URL:', error);
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
  
  try {
    const authPath = path.join(__dirname, '../../auth_sessions', agentId);
    const credsPath = path.join(authPath, 'creds.json');
    
    if (!fs.existsSync(credsPath)) {
      console.log(`[BAILEYS] ℹ️ No credentials file to sync`);
      return;
    }
    const rawCreds = fs.readFileSync(credsPath, 'utf-8');

    if (!rawCreds || rawCreds.trim().length === 0) {
      console.warn('[BAILEYS] ⚠️ Credentials file is empty - skipping database sync');
      return;
    }

    let credsData;
    try {
      credsData = JSON.parse(rawCreds);
    } catch (parseError) {
      console.error('[BAILEYS] ❌ Failed to parse creds.json, skipping sync:', parseError.message);
      return;
    }
    
    // Save complete credentials object to database
    // This includes: me (device ID), registered, signedIdentityKey, etc.
    const { error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .upsert({
        agent_id: agentId,
        session_data: { creds: credsData },
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'agent_id'
      });
    
    if (error) throw error;
    
    console.log(`[BAILEYS] ✅ Credentials synced to database (has me: ${!!credsData.me}, registered: ${credsData.registered})`);
  } catch (error) {
    console.error(`[BAILEYS] ❌ Error syncing to database:`, error);
  }
}

// Restore credentials from database to files
// Called when local files don't exist but database might have saved credentials
async function restoreCredsFromDatabase(agentId) {
  console.log(`[BAILEYS] 🔄 Attempting to restore credentials from database...`);
  
  try {
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
    
    const authPath = path.join(__dirname, '../../auth_sessions', agentId);
    const credsPath = path.join(authPath, 'creds.json');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(authPath)) {
      fs.mkdirSync(authPath, { recursive: true });
    }
    
    // Write credentials to file
    fs.writeFileSync(credsPath, JSON.stringify(data.session_data.creds, null, 2));
    
    console.log(`[BAILEYS] ✅ Credentials restored from database to ${credsPath}`);
    console.log(`[BAILEYS] Restored creds: has me=${!!data.session_data.creds.me}, registered=${data.session_data.creds.registered}`);
    
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

// CRITICAL: Ensure agent has unique session - prevent credential sharing
async function ensureAgentIsolation(agentId) {
  console.log(`[BAILEYS] 🔒 Ensuring agent isolation for: ${agentId.substring(0, 40)}`);
  
  try {
    // Step 1: Check if agent already has active session
    const existingSession = activeSessions.get(agentId);
    if (existingSession && existingSession.isConnected) {
      console.log(`[BAILEYS] ⚠️ Agent already has active connection - disconnecting old one`);
      await disconnectWhatsApp(agentId);
    }
    
    // Step 2: Check if credentials being restored belong to another agent
    const { data: dbSession } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, phone_number, is_active')
      .eq('agent_id', agentId)
      .maybeSingle();
    
    if (dbSession && dbSession.phone_number && dbSession.is_active) {
      const phoneNumber = dbSession.phone_number;
      
      // Check if another agent is using this phone number
      const { data: conflictingSessions } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('agent_id, phone_number')
        .eq('phone_number', phoneNumber)
        .eq('is_active', true)
        .neq('agent_id', agentId);
      
      if (conflictingSessions && conflictingSessions.length > 0) {
        console.error(`[BAILEYS] ❌ CRITICAL: Phone ${phoneNumber} is already linked to another agent`);
        console.error(`[BAILEYS] ❌ Conflicting agents:`, conflictingSessions.map(s => s.agent_id));
        
        // Mark current session as inactive to prevent confusion
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            is_active: false,
            status: 'disconnected',
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
        
        throw new Error('This WhatsApp number is already connected to another agent. Please disconnect it first.');
      }
    }
    
    // Step 3: Check in-memory sessions for phone number conflicts
    if (dbSession && dbSession.phone_number) {
      const phoneNumber = dbSession.phone_number;
      
      for (const [otherId, session] of activeSessions.entries()) {
        if (otherId !== agentId && session.phoneNumber === phoneNumber && session.isConnected) {
          console.error(`[BAILEYS] ❌ CRITICAL: Phone ${phoneNumber} is in use by agent ${otherId}`);
          throw new Error('This WhatsApp number is currently in use by another agent.');
        }
      }
    }
    
    console.log(`[BAILEYS] ✅ Agent isolation verified - safe to proceed`);
  } catch (error) {
    console.error(`[BAILEYS] ❌ Agent isolation check failed:`, error.message);
    throw error;
  }
}

// Initialize WhatsApp connection
async function initializeWhatsApp(agentId, userId = null) {
  console.log(`\n[BAILEYS] ==================== INITIALIZATION START ====================`);
  console.log(`[BAILEYS] Initializing WhatsApp for agent: ${agentId.substring(0, 40)}`);
  console.log(`[BAILEYS] Node: ${process.version}, Platform: ${process.platform}`);
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
    // Prevent multiple initializations
    if (activeSessions.has(agentId)) {
      const existingSession = activeSessions.get(agentId);
      
      const qrGenTime = qrGenerationTracker.get(agentId);
      if (qrGenTime && (Date.now() - qrGenTime) < 120000) {
        console.log(`[BAILEYS] ⏸️ QR already generated recently`);
      return {
          success: true,
          status: 'qr_pending',
          phoneNumber: existingSession.phoneNumber,
          isActive: existingSession.isConnected
        };
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

    // CRITICAL: Check if valid credentials exist (for 515 restart)
    // After QR pairing, credentials have 'me' object but registered=false initially
    // They become registered=true only after first successful connection
    // So we check for 'me' object, not registration status
    const credsFile = path.join(authPath, 'creds.json');
    const hasValidCreds = fs.existsSync(credsFile);
    
    let useFileAuth = false;
    
    if (hasValidCreds) {
      // Check if credentials are valid by looking for 'me' object
      // FIX: Don't check registered=true, as it's false after QR pairing!
      try {
        const credsContent = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
        
        // Valid credentials = has 'me' object (phone number/ID assigned)
        // registered flag is false after QR pairing, true after first connection
        const isValidCreds = credsContent.me && credsContent.me.id;
        
        if (isValidCreds) {
          console.log(`[BAILEYS] ✅ Found valid credentials with paired device - loading...`);
          console.log(`[BAILEYS] Device ID: ${credsContent.me.id.split(':')[0]}`);
          console.log(`[BAILEYS] Registration status: ${credsContent.registered} (false after QR pairing is normal)`);
          useFileAuth = true;
        } else {
          console.log(`[BAILEYS] ⚠️ Found credentials without device pairing - will generate fresh QR`);
          console.log(`[BAILEYS] Creds status: has me=${!!credsContent.me}, has me.id=${!!credsContent.me?.id}`);
        }
      } catch (error) {
        console.log(`[BAILEYS] ⚠️ Error reading credentials:`, error.message);
      }
    } else {
      console.log(`[BAILEYS] 🆕 No credentials file found locally`);
      
      // CRITICAL: Try to restore from Supabase before generating new QR
      console.log(`[BAILEYS] 🔍 Checking Supabase for backed-up credentials...`);
      const restored = await restoreCredsFromDatabase(agentId);
      
      if (restored) {
        console.log(`[BAILEYS] ✅ Credentials restored from Supabase - will use them`);
        useFileAuth = true;
      } else {
        console.log(`[BAILEYS] 🆕 No credentials in Supabase either - will generate QR`);
      }
    }

    let state, saveCredsToFile;
    
    if (useFileAuth) {
      // Load existing credentials from files
      console.log(`[BAILEYS] 📂 Loading credentials from files...`);
      const authState = await useMultiFileAuthState(authPath);
      state = authState.state;
      saveCredsToFile = authState.saveCreds;
      
      console.log(`[BAILEYS] 🔍 Loaded auth state:`, {
        hasCreds: !!state.creds,
        registered: state.creds?.registered,
        hasMe: !!state.creds?.me
      });
    } else {
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

    // Wrap saveCreds to also sync to database
    const saveCreds = async () => {
      await saveCredsToFile(); // Save to files first
      await syncCredsToDatabase(agentId); // Then sync to database
    };

    const credStatus = state.creds ? `🔑 Loaded credentials (registered: ${state.creds.registered})` : '🆕 No credentials - will generate QR';
    console.log(`[BAILEYS] ${credStatus}`);
    
    // CRITICAL: Fetch latest Baileys version for compatibility
    console.log(`[BAILEYS] 🔍 Fetching latest Baileys version...`);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[BAILEYS] Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);
    
    // CRITICAL: Create socket with proper config
    console.log(`[BAILEYS] 🔌 Creating WebSocket connection...`);
    
    const sock = makeWASocket({
      // CRITICAL: Use proper auth structure with cacheable signal key store
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      version, // Use fetched version
      printQRInTerminal: true, // CRITICAL: Enable for debugging!
      logger: pino({ level: 'debug' }), // Use debug for troubleshooting
      browser: Browsers.ubuntu('Chrome'),
      
      // CRITICAL FIX: More aggressive timeouts to keep socket alive during QR scan
      keepAliveIntervalMs: 15000, // Send keepalive every 15s (was 30s)
      defaultQueryTimeoutMs: 120000,
      connectTimeoutMs: 120000,
      qrTimeout: 180000, // QR valid for 3 minutes (was 2min)
      
      retryRequestDelayMs: 250, // Faster retries (was 500ms)
      maxMsgRetryCount: 5, // More retries (was 3)
      emitOwnEvents: true, // CRITICAL: May be needed for QR events
      fireInitQueries: true, // CRITICAL: Fire initial queries immediately
      
      // CRITICAL: getMessage handler - return undefined to prevent errors
      getMessage: async (key) => {
        return undefined;
      },
      
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: false // Set to false to reduce initial connection overhead
    });

    console.log(`[BAILEYS] ✅ Socket created with aggressive keepalive (every 15s) and 3min QR timeout`);
    console.log(`[BAILEYS] 🔍 Socket info:`, {
      socketExists: !!sock,
      hasEventEmitter: !!sock.ev,
      timestamp: new Date().toISOString()
    });

    // CRITICAL: Register creds.update handler
    sock.ev.on('creds.update', async () => {
      console.log(`[BAILEYS] 🔐 ============ CREDS.UPDATE FIRED ============`);
      
      // saveCreds handles both file save and database sync
      await saveCreds();
      
      console.log(`[BAILEYS] ✅ Credentials saved during pairing`);
      console.log(`[BAILEYS] 🔐 ============ CREDS.UPDATE COMPLETE ============\n`);
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
      lastPingAt: Date.now(),
      lastActivity: Date.now(),
      connectionState: 'initializing',
      qrAttempts: 0,
      connectedAt: null,
      failureReason: null,
      failureAt: null
    };
    
    activeSessions.set(agentId, sessionData);

    console.log(`[BAILEYS] ✅ Session stored in memory with health monitoring`);
    
    // CRITICAL: Add socket health check to detect premature disconnects
    const healthCheckInterval = setInterval(() => {
      const session = activeSessions.get(agentId);
      if (!session) {
        console.log(`[BAILEYS] Health check: Session removed, clearing interval`);
        clearInterval(healthCheckInterval);
        return;
      }
      
      const now = Date.now();
      const socketAge = now - session.socketCreatedAt;
      const timeSinceLastPing = now - session.lastPingAt;
      
      // If socket is alive but not connected for > 90s, log warning
      if (!session.isConnected && socketAge > 90000) {
        console.warn(`[BAILEYS] ⚠️ Socket alive for ${Math.round(socketAge/1000)}s but not connected yet`);
        console.warn(`[BAILEYS] ⚠️ Has QR: ${!!session.qrCode}, QR attempts: ${session.qrAttempts}`);
      }
      
      session.lastPingAt = now;
      session.lastActivity = now;
      
      // Stop health check after 5 minutes (socket should be connected or closed by then)
      if (socketAge > 300000) {
        console.log(`[BAILEYS] Health check: Socket > 5min old, stopping health checks`);
        clearInterval(healthCheckInterval);
      }
    }, 30000); // Check every 30 seconds

    console.log(`[BAILEYS] ✅ Socket health monitor started (checks every 30s)`);

    // Connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;
      
      console.log(`\n[BAILEYS] ========== CONNECTION UPDATE ==========`);
      console.log(`[BAILEYS] Status: ${connection || 'undefined'}`);
      console.log(`[BAILEYS] Has QR: ${!!qr}`);
      console.log(`[BAILEYS] Is New Login: ${isNewLogin}`);
      
      // Handle QR code
      if (qr) {
        const session = activeSessions.get(agentId);
        const qrAttempt = session ? session.qrAttempts + 1 : 1;

        if (session?.isConnected) {
          console.log(`[BAILEYS] ⚠️ QR event received for already connected agent ${agentId.substring(0, 40)} – ignoring`);
          return;
        }
        
        if (session) {
          session.connectionState = 'qr_pending';
          session.lastActivity = Date.now();
        }
        
        console.log(`[BAILEYS] 🎯 QR CODE RECEIVED! (Attempt #${qrAttempt})`);
        console.log(`[BAILEYS] 🎯 AgentId: ${agentId.substring(0, 40)}`);
        console.log(`[BAILEYS] 🎯 QR Length: ${qr.length} chars`);
        console.log(`[BAILEYS] 🎯 Socket age: ${session ? Math.round((Date.now() - session.socketCreatedAt)/1000) : 0}s`);
        
        const existingQR = qrGenerationTracker.get(agentId);
        
        if (existingQR && (Date.now() - existingQR) < 120000) {
          console.log(`[BAILEYS] ⏭️ Ignoring new QR - existing valid (${Math.round((Date.now() - existingQR)/1000)}s old)`);
          return;
        }
        
        console.log(`[BAILEYS] ✅ NEW QR CODE - Saving to database and memory (generated at ${new Date().toISOString()})`);
        
        qrGenerationTracker.set(agentId, Date.now());
        
        try {
          await supabaseAdmin
            .from('whatsapp_sessions')
            .upsert({
              agent_id: agentId,
              qr_code: qr,
              is_active: false,
              status: 'qr_pending', // CRITICAL: Set status to qr_pending
              qr_generated_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'agent_id'
            });
          
          console.log(`[BAILEYS] ✅ QR saved to database (attempt #${qrAttempt})`);
          
          if (session) {
            session.qrCode = qr;
            session.qrGeneratedAt = Date.now();
            session.qrAttempts = qrAttempt;
          }
          
          emitAgentEvent(agentId, 'qr', {
            qr,
            attempt: qrAttempt,
            generatedAt: new Date().toISOString()
          });
          
          console.log(`[BAILEYS] ✅ QR valid for 3 minutes - please scan immediately`);
          console.log(`[BAILEYS] ℹ️ Socket will maintain connection with keepalive every 15s`);
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
                status: 'connected', // CRITICAL: Set status field
                is_active: true,
                qr_code: null,
                qr_generated_at: null,
                last_connected: new Date().toISOString(),
                updated_at: new Date().toISOString()
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
            session.lastActivity = Date.now();
            session.socketReadyState = session.socket?.ws?.readyState ?? null;
            session.failureReason = null;
            session.failureAt = null;
          }
          
          emitAgentEvent(agentId, 'connected', {
            phoneNumber: cleanPhone
          });
          
          console.log(`[BAILEYS] 🎊 WhatsApp fully connected`);
          console.log(`[BAILEYS] ========== CONNECTION COMPLETE ==========\n`);
          
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
          session.lastActivity = Date.now();
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
          session.lastActivity = Date.now();
        }
        
        emitAgentEvent(agentId, 'disconnected', {
          reason,
          statusCode
        });
        
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
          
          console.log(`[BAILEYS] ✅ Cleared for retry. User should click "Connect" again.`);
          return; // Don't continue processing
        }
        
        // CRITICAL: Handle error 515 - Restart Required (EXPECTED after QR pairing!)
        if (statusCode === 515) {
          console.log(`[BAILEYS] 🔄 Error 515 - Stream Errored (restart required)`);
          console.log(`[BAILEYS] This is EXPECTED after QR pairing - credentials saved, restarting...`);
          
          // Clean up old socket
          if (session?.socket) {
            try {
              session.socket.end();
            } catch (e) {
              console.log(`[BAILEYS] Socket already ended`);
            }
          }
          
          // Clear tracker to allow restart
          qrGenerationTracker.delete(agentId);
          
          // Wait 2 seconds then restart with saved credentials
          setTimeout(async () => {
            console.log(`[BAILEYS] 🔄 Reconnecting with saved credentials...`);
            try {
              await initializeWhatsApp(agentId, userId);
              console.log(`[BAILEYS] ✅ Restart initiated after 515 error`);
            } catch (error) {
              console.error(`[BAILEYS] ❌ Reconnection failed:`, error);
            }
          }, 2000);
          
          return; // Don't continue processing
        }
        
        qrGenerationTracker.delete(agentId);
        
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
              updated_at: new Date().toISOString()
            })
            .eq('agent_id', agentId);
          
          const failureReason = payload?.error || reason || 'conflict';
          console.log(`[BAILEYS] ✅ Session cleared after 401. Failure reason: ${failureReason}`);

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

          return;
        }
        
        await supabaseAdmin
          .from('whatsapp_sessions')
          .update({
            is_active: false,
            updated_at: new Date().toISOString()
          })
          .eq('agent_id', agentId);
        
        console.log(`[BAILEYS] ========== CLOSE COMPLETE ==========\n`);
      }
      
      console.log(`[BAILEYS] ========== UPDATE PROCESSED ==========\n`);
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

        let messageText = null;

        if (msg.message) {
          if (msg.message.conversation) {
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
        if (remoteJid.includes('status') || 
            remoteJid.includes('broadcast') || 
            remoteJid.includes('@g.us') ||
            remoteJid.includes('newsletter') ||
            remoteJid.includes('@lid') && !remoteJid.includes('@s.whatsapp.net')) {
          console.log(`[BAILEYS] 🚫 Skipping system/status message from: ${remoteJid}`);
          continue;
        }

        console.log(`[BAILEYS] ✅ Processing individual message ${participant} ${remoteJid}`);
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

        let messageType = 'TEXT';
        let content = textContent;
        let mediaUrl = null;
        let mediaMimetype = null;
        let mediaSize = null;
        const messageMetadata = {
          platform: 'whatsapp',
          phoneNumber: agentNumber,
            direction: fromMe ? 'outgoing' : 'incoming',
          remoteJid,
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
              const { url, path: storagePath } = await saveAudioFile(audioBuffer, agentId, messageId, mediaMimetype);
              mediaUrl = url;
              messageMetadata.storagePath = storagePath;
              console.log('[BAILEYS] 🎵 Audio message processed', { messageId, mediaUrl });
        } else {
              console.warn('[BAILEYS] ⚠️ Audio buffer empty after download', { messageId });
            }
          } catch (error) {
            console.error('[BAILEYS] ❌ Failed to process audio message', { messageId, error: error.message });
          }

          content = null;
        }

        const sanitizedFromNumber =
          typeof fromNumber === 'string' && fromNumber.length > 0
            ? fromNumber
            : sanitizeNumberFromJid(remoteJid) || remoteJid;
        const sanitizedToNumber =
          typeof toNumber === 'string' && toNumber.length > 0
            ? toNumber
            : sanitizeNumberFromJid(fromMe ? remoteJid : agentNumber) || (fromMe ? remoteJid : agentNumber);

        const cleanedMetadata = Object.fromEntries(
          Object.entries(messageMetadata).filter(([, value]) => value !== undefined && value !== null)
        );

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
        };

        try {
          const { error: insertError } = await supabaseAdmin.from('message_log').insert(dbPayload);
          if (insertError) {
            console.error('[BAILEYS][DB] ❌ Failed to insert chat message', {
              messageId,
              agentId,
              insertError,
            });
          }
        } catch (error) {
          console.error('[BAILEYS][DB] ❌ Unexpected error inserting chat message', {
            messageId,
            agentId,
            error: error.message,
          });
        }

        const webhookPayload = {
          id: messageId,
          messageId,
          from: sanitizedFromNumber || remoteJid,
          to: sanitizedToNumber,
          conversationId: remoteJid,
          messageType,
          type: messageType.toLowerCase(),
          content: content || null,
          mediaUrl,
          mimetype: mediaMimetype || null,
          timestamp: timestampIso,
          metadata: cleanedMetadata,
        };

        if (typeof webhookPayload.from === 'string' && webhookPayload.from.includes('@')) {
          webhookPayload.from = sanitizeNumberFromJid(webhookPayload.from) || webhookPayload.from;
        }

        if (typeof webhookPayload.to === 'string' && webhookPayload.to.includes('@')) {
          webhookPayload.to = sanitizeNumberFromJid(webhookPayload.to) || webhookPayload.to;
        }

        const shouldForward =
          (messageType === 'TEXT' && Boolean(content)) ||
          (messageType === 'AUDIO' && Boolean(mediaUrl));

        if (shouldForward) {
          await forwardMessageToWebhook(agentId, webhookPayload);
        } else {
          console.log('[BAILEYS] ℹ️ Skipping webhook forwarding (no content or media)');
        }
      }

      console.log(`[BAILEYS] ========== END MESSAGES ==========`); 
    });

    console.log(`[BAILEYS] ==================== INIT COMPLETE ====================\n`);
    
    // Return success response with proper state
    return {
      success: true,
      status: 'qr_pending',
      phoneNumber: null,
      isActive: false // Critical: Not connected yet, waiting for QR scan
    };

  } catch (error) {
    console.error(`[BAILEYS] ❌ Error initializing:`, error);
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

  if (connectionLocks.get(agentId)) {
    console.log(`[BAILEYS] ⏳ Connection already in progress for agent ${agentId.substring(0, 40)}`);
    return {
      success: false,
      status: 'connecting',
      error: 'Connection already in progress'
    };
  }

  const lastAttempt = lastConnectionAttempt.get(agentId) || 0;
  if (now - lastAttempt < COOLDOWN_MS) {
    const waitMs = COOLDOWN_MS - (now - lastAttempt);
    console.log(`[BAILEYS] 🕒 Cooldown active for agent ${agentId.substring(0, 40)}. Retry in ${Math.ceil(waitMs / 1000)}s`);
    return {
      success: false,
      status: 'cooldown',
      retryAfter: waitMs
    };
  }

  connectionLocks.set(agentId, true);
  lastConnectionAttempt.set(agentId, now);

  try {
    return await initializeWhatsApp(agentId, userId);
  } finally {
    connectionLocks.delete(agentId);
  }
}

// Disconnect
async function disconnectWhatsApp(agentId) {
  console.log(`[BAILEYS] Disconnecting: ${agentId.substring(0, 40)}`);
  
  const session = activeSessions.get(agentId);
  if (session?.socket) {
    session.socket.ev.removeAllListeners();
    session.socket.end();
  }
  
  activeSessions.delete(agentId);
  qrGenerationTracker.delete(agentId);
  
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
      phone_number: null,
      updated_at: new Date().toISOString()
    })
    .eq('agent_id', agentId);
  
  console.log(`[BAILEYS] ✅ Disconnected`);
  emitAgentEvent(agentId, 'disconnected', { reason: 'manual' });
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
      response.last_activity = session.lastActivity
        ? new Date(session.lastActivity).toISOString()
        : nowIso;
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
        response.status = 'qr_pending';
        response.qr_code = session.qrCode;
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

      if (!response.connected) {
        if (data.is_active && data.status === 'connected') {
          response.connected = true;
          response.is_active = true;
          response.status = 'connected';
          response.qr_code = null;
        } else if (data.qr_code) {
          response.qr_code = data.qr_code;
          response.status = 'qr_pending';
        } else if (data.status) {
          response.status = data.status;
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
async function sendMessage(agentId, to, message) {
    const session = activeSessions.get(agentId);
  
  if (!session || !session.isConnected) {
    throw new Error('WhatsApp not connected');
  }
  
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  await session.socket.sendMessage(jid, { text: message });
  
  console.log(`[BAILEYS] ✅ Message sent to ${to}`);
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
    
    const { data: activeSessionsData, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id, phone_number, status')
      .eq('is_active', true)
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
    
    console.log(`[BAILEYS] ✅ Found ${activeSessionsData.length} active session(s) in database:`);
    activeSessionsData.forEach((session, index) => {
      console.log(`[BAILEYS]    ${index + 1}. Agent: ${session.agent_id.substring(0, 20)}... Phone: ${session.phone_number || 'Unknown'}`);
    });
    
    console.log(`\n[BAILEYS] 🔄 AUTO-RECONNECTING ${activeSessionsData.length} session(s)...`);
    console.log('[BAILEYS] This ensures WhatsApp connections persist across server restarts.\n');
    
    // Auto-reconnect each active session
    let successCount = 0;
    let failCount = 0;
    
    for (const sessionData of activeSessionsData) {
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
  initializeExistingSessions,
  subscribeToAgentEvents
};
