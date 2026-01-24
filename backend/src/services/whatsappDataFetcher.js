/**
 * WhatsApp Data Fetcher Service
 * 
 * Minimal implementation to fetch only contacts and groups from WhatsApp
 * after QR code authentication. No message handling, no history sync.
 * 
 * @module whatsappDataFetcher
 */

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * Normalize JID to standard format
 * @param {string} jid - WhatsApp JID
 * @returns {string|null} - Normalized JID or null if invalid
 */
function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') {
    return null;
  }
  
  // Remove any whitespace
  const normalized = jid.trim();
  
  // Must contain @ symbol to be valid
  if (!normalized.includes('@')) {
    return null;
  }
  
  return normalized;
}

/**
 * Extract contact name from Baileys contact object
 * @param {object} contact - Baileys contact object
 * @returns {string|null} - Contact name or null
 */
function extractContactName(contact) {
  if (!contact || typeof contact !== 'object') {
    return null;
  }
  
  // Priority: notify > name > pushname > vname
  return contact.notify || 
         contact.name || 
         contact.pushname || 
         contact.vname || 
         null;
}

/**
 * Setup contact event listeners and buffer contacts
 * MUST be called BEFORE socket connection to capture all events
 * @param {object} sock - Baileys WASocket instance
 * @returns {Map<string, {jid: string, name: string|null}>} - Contacts buffer map
 */
function setupContactBuffer(sock) {
  const contactsMap = new Map();
  
  // CRITICAL: Register listeners BEFORE connection to capture contacts.set
  // contacts.set fires 10-30 seconds after connection.open with ALL contacts
  
  const onContactsSet = ({ contacts }) => {
    try {
      // Handle different data structures (Array, Set, Map, Object)
      let contactsArray = [];
      
      if (Array.isArray(contacts)) {
        contactsArray = contacts;
      } else if (contacts instanceof Set) {
        contactsArray = Array.from(contacts);
      } else if (contacts instanceof Map) {
        contactsArray = Array.from(contacts.values());
      } else if (typeof contacts === 'object' && contacts !== null) {
        contactsArray = Object.values(contacts);
      }
      
      console.log(`[DATA-FETCHER] 📥 contacts.set event: ${contactsArray.length} contact(s) received`);
      
      // Process each contact
      for (const contact of contactsArray) {
        const jid = contact.id || contact.jid || null;
        const normalizedJid = normalizeJid(jid);
        
        if (!normalizedJid) {
          continue;
        }
        
        // Skip system contacts and broadcasts
        if (normalizedJid.includes('@broadcast') || 
            normalizedJid.includes('@status') ||
            normalizedJid.includes('@newsletter') ||
            normalizedJid.endsWith('@g.us')) { // Skip groups (handled separately)
          continue;
        }
        
        // Only include individual contacts
        if (!normalizedJid.endsWith('@s.whatsapp.net') && !normalizedJid.endsWith('@lid')) {
          continue;
        }
        
        const name = extractContactName(contact);
        
        // Store in map (deduplicates by JID)
        contactsMap.set(normalizedJid, {
          jid: normalizedJid,
          name: name,
        });
      }
      
      console.log(`[DATA-FETCHER] ✅ Buffered ${contactsMap.size} unique contacts from contacts.set`);
    } catch (error) {
      console.error('[DATA-FETCHER] ❌ Error processing contacts.set:', error.message);
    }
  };
  
  // Listen for contacts.upsert (real-time updates for new/updated contacts)
  const onContactsUpsert = (contacts) => {
    try {
      const contactArray = Array.isArray(contacts) ? contacts : [contacts];
      
      for (const contact of contactArray) {
        const jid = contact.id || contact.jid || null;
        const normalizedJid = normalizeJid(jid);
        
        if (!normalizedJid || 
            normalizedJid.includes('@broadcast') || 
            normalizedJid.includes('@status') ||
            normalizedJid.includes('@newsletter') ||
            normalizedJid.endsWith('@g.us')) {
          continue;
        }
        
        if (!normalizedJid.endsWith('@s.whatsapp.net') && !normalizedJid.endsWith('@lid')) {
          continue;
        }
        
        const name = extractContactName(contact);
        contactsMap.set(normalizedJid, {
          jid: normalizedJid,
          name: name,
        });
      }
      
      console.log(`[DATA-FETCHER] 📥 contacts.upsert: ${contactArray.length} contact(s), total buffered: ${contactsMap.size}`);
    } catch (error) {
      console.error('[DATA-FETCHER] ❌ Error processing contacts.upsert:', error.message);
    }
  };
  
  // Register event listeners (BEFORE connection to capture all events)
  sock.ev.on('contacts.set', onContactsSet);
  sock.ev.on('contacts.upsert', onContactsUpsert);
  
  // Return map and cleanup function
  return {
    map: contactsMap,
    cleanup: () => {
      sock.ev.off('contacts.set', onContactsSet);
      sock.ev.off('contacts.upsert', onContactsUpsert);
    }
  };
}

/**
 * Wait for contacts.set event and extract contacts
 * Priority: events buffer → sock.store.contacts fallback → empty array
 * @param {object} sock - Baileys WASocket instance
 * @param {Map} contactsBuffer - Pre-buffered contacts from events
 * @param {number} timeout - Timeout in milliseconds (default: 35000)
 * @returns {Promise<Array<{jid: string, name: string|null}>>} - Array of contacts
 */
function fetchContacts(sock, contactsBuffer, timeout = 40000) {
  return new Promise((resolve) => {
    let timer = null;
    let contactsSetFired = false;
    let resolved = false;
    
    // Wait for contacts.set event with timeout
    const onContactsSet = ({ contacts }) => {
      if (resolved) return;
      
      contactsSetFired = true;
      console.log('[DATA-FETCHER] 📥 contacts.set event fired!');
      
      // Process contacts from the event (they should already be in buffer from setupContactBuffer)
      // But we'll wait a bit for any additional upserts
      if (timer) {
        clearTimeout(timer);
      }
      
      // Wait 3 seconds after contacts.set for any additional upserts
      timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        sock.ev.off('contacts.set', onContactsSet);
        const contactsArray = Array.from(contactsBuffer.values());
        console.log(`[DATA-FETCHER] ✅ Contacts from events: ${contactsArray.length} contacts`);
        resolve(contactsArray);
      }, 3000);
    };
    
    // Check if contacts.set already fired (might have fired before we set up this listener)
    // The buffer should already have contacts if it fired
    if (contactsBuffer.size > 0) {
      console.log(`[DATA-FETCHER] ℹ️ Contacts already in buffer (${contactsBuffer.size}), contacts.set may have fired early`);
    }
    
    sock.ev.on('contacts.set', onContactsSet);
    
    // Set timeout to resolve even if contacts.set never fires
    timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      sock.ev.off('contacts.set', onContactsSet);
      
      // FALLBACK: If contacts.set never fired, try sock.store.contacts again
      if (!contactsSetFired && contactsBuffer.size === 0) {
        console.log('[DATA-FETCHER] ⚠️ contacts.set never fired after timeout, trying sock.store.contacts fallback...');
        
        try {
          const contactsStore = sock.store?.contacts;
          
          if (contactsStore) {
            let contactsArray = [];
            
            if (contactsStore instanceof Map) {
              contactsArray = Array.from(contactsStore.values());
            } else if (Array.isArray(contactsStore)) {
              contactsArray = contactsStore;
            } else if (typeof contactsStore === 'object') {
              contactsArray = Object.values(contactsStore);
            }
            
            console.log(`[DATA-FETCHER] Found ${contactsArray.length} contacts in store`);
            
            // Process store contacts
            for (const contact of contactsArray) {
              const jid = contact.id || contact.jid || null;
              const normalizedJid = normalizeJid(jid);
              
              if (!normalizedJid || 
                  normalizedJid.includes('@broadcast') || 
                  normalizedJid.includes('@status') ||
                  normalizedJid.includes('@newsletter') ||
                  normalizedJid.endsWith('@g.us')) {
                continue;
              }
              
              if (!normalizedJid.endsWith('@s.whatsapp.net') && !normalizedJid.endsWith('@lid')) {
                continue;
              }
              
              const name = extractContactName(contact);
              contactsBuffer.set(normalizedJid, {
                jid: normalizedJid,
                name: name,
              });
            }
            
            console.log(`[DATA-FETCHER] ✅ Contacts from store fallback: ${contactsBuffer.size} contacts after filtering`);
          } else {
            console.log('[DATA-FETCHER] ⚠️ sock.store.contacts is not available');
          }
        } catch (error) {
          console.error('[DATA-FETCHER] ❌ Error reading sock.store.contacts:', error.message);
        }
      }
      
      const contactsArray = Array.from(contactsBuffer.values());
      console.log(`[DATA-FETCHER] ✅ Contacts fetch complete: ${contactsArray.length} contacts (${contactsSetFired ? 'from events' : contactsBuffer.size > 0 ? 'from store fallback' : 'empty - no contacts found'})`);
      resolve(contactsArray);
    }, timeout);
  });
}

/**
 * Fetch groups from WhatsApp with retry logic
 * CRITICAL: Wait for metadata hydration before fetching
 * @param {object} sock - Baileys WASocket instance
 * @param {number} initialDelay - Initial delay in ms before first fetch (default: 3000)
 * @param {number} retryDelay - Delay before retry if empty (default: 5000)
 * @returns {Promise<Array<{jid: string, name: string}>>} - Array of groups
 */
async function fetchGroups(sock, initialDelay = 5000, retryDelay = 8000) {
  try {
    // CRITICAL: Wait for sock.user.id to be available (indicates metadata hydration)
    console.log('[DATA-FETCHER] Waiting for metadata hydration before fetching groups...');
    
    let waitCount = 0;
    while (!sock.user?.id && waitCount < 15) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      waitCount++;
    }
    
    if (!sock.user?.id) {
      console.warn('[DATA-FETCHER] ⚠️ sock.user.id not available after 15s, proceeding anyway');
    } else {
      console.log('[DATA-FETCHER] ✅ Metadata hydrated (sock.user.id available)');
    }
    
    // Additional delay for metadata sync (groups need more time)
    console.log(`[DATA-FETCHER] Waiting ${initialDelay}ms for groups metadata to sync...`);
    await new Promise(resolve => setTimeout(resolve, initialDelay));
    
    // Initial fetch attempt
    console.log('[DATA-FETCHER] Fetching groups (attempt 1)...');
    let groups;
    try {
      groups = await sock.groupFetchAllParticipating();
    } catch (error) {
      console.error('[DATA-FETCHER] Error in groupFetchAllParticipating:', error.message);
      groups = null;
    }
    
    // Convert to array and normalize
    let groupsArray = normalizeGroupsData(groups);
    
    console.log(`[DATA-FETCHER] Attempt 1: Found ${groupsArray.length} groups`);
    
    // RETRY LOGIC: If empty, wait and retry once
    if (groupsArray.length === 0) {
      console.log(`[DATA-FETCHER] ⚠️ Groups empty, waiting ${retryDelay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      
      console.log('[DATA-FETCHER] Fetching groups (attempt 2 - retry)...');
      try {
        groups = await sock.groupFetchAllParticipating();
        groupsArray = normalizeGroupsData(groups);
        console.log(`[DATA-FETCHER] Attempt 2: Found ${groupsArray.length} groups`);
      } catch (error) {
        console.error('[DATA-FETCHER] Error in retry groupFetchAllParticipating:', error.message);
      }
    }
    
    // If still empty, try one more time after longer wait
    if (groupsArray.length === 0) {
      console.log('[DATA-FETCHER] ⚠️ Groups still empty, waiting 10s for final attempt...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      console.log('[DATA-FETCHER] Fetching groups (attempt 3 - final)...');
      try {
        groups = await sock.groupFetchAllParticipating();
        groupsArray = normalizeGroupsData(groups);
        console.log(`[DATA-FETCHER] Attempt 3: Found ${groupsArray.length} groups`);
      } catch (error) {
        console.error('[DATA-FETCHER] Error in final groupFetchAllParticipating:', error.message);
      }
    }
    
    console.log(`[DATA-FETCHER] ✅ Final result: ${groupsArray.length} unique groups`);
    return groupsArray;
    
  } catch (error) {
    console.error('[DATA-FETCHER] ❌ Error fetching groups:', error.message);
    console.error('[DATA-FETCHER] Stack:', error.stack);
    return [];
  }
}

/**
 * Normalize groups data from Baileys response
 * @param {any} groups - Groups data from Baileys (Map, Object, Array, etc.)
 * @returns {Array<{jid: string, name: string}>} - Normalized groups array
 */
function normalizeGroupsData(groups) {
  if (!groups || typeof groups !== 'object') {
    return [];
  }
  
  // Convert groups object/Map to array
  let groupsArray = [];
  
  if (groups instanceof Map) {
    groupsArray = Array.from(groups.values());
  } else if (Array.isArray(groups)) {
    groupsArray = groups;
  } else if (typeof groups === 'object') {
    groupsArray = Object.values(groups);
  }
  
  // Normalize groups
  const normalizedGroups = groupsArray
    .map((group) => {
      // Get group JID
      const jid = group.id || group.jid || null;
      const normalizedJid = normalizeJid(jid);
      
      if (!normalizedJid) {
        return null;
      }
      
      // Only include groups (@g.us)
      if (!normalizedJid.endsWith('@g.us')) {
        return null;
      }
      
      // Get group name (subject)
      const name = group.subject || group.name || 'Unnamed Group';
      
      return {
        jid: normalizedJid,
        name: name,
      };
    })
    .filter((group) => group !== null);
  
  // Remove duplicates
  const uniqueGroups = [];
  const seenJids = new Set();
  
  for (const group of normalizedGroups) {
    if (!seenJids.has(group.jid)) {
      seenJids.add(group.jid);
      uniqueGroups.push(group);
    }
  }
  
  return uniqueGroups;
}

/**
 * Initialize WhatsApp socket with minimal configuration
 * @param {string} authPath - Path to store auth state
 * @param {object} options - Additional options
 * @returns {Promise<object>} - Baileys socket instance
 */
async function initializeSocket(authPath, options = {}) {
  const { 
    printQRInTerminal = false,
    logger = pino({ level: 'silent' }) // Silent logger to avoid noise
  } = options;
  
  // Ensure auth directory exists
  if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
  }
  
  // Get latest Baileys version
  const { version } = await fetchLatestBaileysVersion();
  
  // Initialize auth state (persists across restarts)
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  
  // Create socket with minimal configuration
  // CRITICAL: markOnlineOnConnect must be true for metadata hydration
  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal,
    auth: state,
    browser: Browsers.macOS('Desktop'), // Browser identifier
    // CRITICAL: Disable message sync and history
    syncFullHistory: false, // Don't sync message history
    markOnlineOnConnect: true, // REQUIRED: Must be true for metadata hydration (contacts/groups sync)
    generateHighQualityLinkPreview: false, // Don't generate link previews
    // No message listeners will be added - this is intentional
    // NEVER add messages.upsert listener
  });
  
  // Save credentials when they update
  sock.ev.on('creds.update', saveCreds);
  
  return sock;
}

/**
 * Wait for QR code to be generated
 * @param {object} sock - Baileys socket instance
 * @param {number} timeout - Timeout in milliseconds (default: 60000)
 * @returns {Promise<string>} - QR code string
 */
function waitForQR(sock, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('QR code timeout - no QR generated within 60 seconds'));
    }, timeout);
    
    // Listen for QR code in connection updates
    const handler = (update) => {
      if (update.qr) {
        clearTimeout(timer);
        sock.ev.off('connection.update', handler);
        resolve(update.qr);
      }
    };
    
    sock.ev.on('connection.update', handler);
  });
}

/**
 * Wait for successful connection
 * @param {object} sock - Baileys socket instance
 * @param {number} timeout - Timeout in milliseconds (default: 120000)
 * @returns {Promise<void>}
 */
function waitForConnection(sock, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.ev.off('connection.update', handler);
      reject(new Error('Connection timeout - QR not scanned within 2 minutes'));
    }, timeout);
    
    const handler = (update) => {
      const { connection, lastDisconnect } = update;
      
      if (connection === 'open') {
        clearTimeout(timer);
        sock.ev.off('connection.update', handler);
        resolve();
      } else if (connection === 'close') {
        clearTimeout(timer);
        sock.ev.off('connection.update', handler);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.output?.payload?.message || 
                      lastDisconnect?.error?.message || 
                      'Unknown';
        
        if (statusCode === DisconnectReason.loggedOut) {
          reject(new Error('WhatsApp account logged out. Please scan QR again.'));
        } else {
          reject(new Error(`Connection closed: ${reason} (code: ${statusCode})`));
        }
      }
    };
    
    sock.ev.on('connection.update', handler);
  });
}

/**
 * Main function: Fetch contacts and groups after QR authentication
 * @param {string} agentId - Agent identifier (used for auth path)
 * @param {object} options - Options
 * @param {function} onQR - Callback when QR code is generated
 * @returns {Promise<{contacts: Array, groups: Array}>} - Contacts and groups data
 */
async function fetchWhatsAppData(agentId, options = {}, onQR = null) {
  const {
    authPath = path.join(process.cwd(), 'auth', agentId),
    qrTimeout = 60000,
    connectionTimeout = 120000,
    waitForGroups = 5000, // Wait 5 seconds after connection for groups to load
  } = options;
  
  let sock = null;
  let contactBuffer = null;
  
  try {
    console.log('[DATA-FETCHER] Initializing WhatsApp socket...');
    
    // Initialize socket
    sock = await initializeSocket(authPath, {
      printQRInTerminal: false,
    });
    
    // CRITICAL: Setup contact buffer BEFORE connection
    // This ensures we capture contacts.set event when it fires
    console.log('[DATA-FETCHER] Setting up contact event listeners...');
    contactBuffer = setupContactBuffer(sock);
    
    // Log initial state
    console.log('[DATA-FETCHER] Socket state:', {
      hasUser: !!sock.user,
      userId: sock.user?.id,
      hasStore: !!sock.store,
      hasContactsStore: !!sock.store?.contacts,
    });
    
    // Check if already connected (using existing auth state)
    if (sock.user) {
      console.log('[DATA-FETCHER] Already connected using existing auth state');
      // Wait a bit for contacts to load in warm session
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.log('[DATA-FETCHER] Waiting for QR code...');
      
      // Wait for QR code
      const qr = await waitForQR(sock, qrTimeout);
      
      // Notify caller of QR code
      if (onQR && typeof onQR === 'function') {
        onQR(qr);
      }
      
      console.log('[DATA-FETCHER] QR code generated, waiting for scan...');
      
      // Wait for connection
      await waitForConnection(sock, connectionTimeout);
      
      console.log('[DATA-FETCHER] ✅ Connected successfully');
    }
    
    // CRITICAL: Wait for metadata hydration (sock.user.id available)
    console.log('[DATA-FETCHER] Waiting for metadata hydration...');
    let hydrationWait = 0;
    while (!sock.user?.id && hydrationWait < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      hydrationWait++;
    }
    
    if (sock.user?.id) {
      console.log('[DATA-FETCHER] ✅ Metadata hydrated');
    } else {
      console.warn('[DATA-FETCHER] ⚠️ Metadata not fully hydrated, proceeding anyway');
    }
    
    // CRITICAL: Wait longer for contacts.set event (can take 10-30 seconds after connection)
    // Also check store immediately in case contacts are already loaded
    console.log('[DATA-FETCHER] Checking for contacts in store first...');
    let contacts = [];
    
    // First, try to get contacts from store (might be available immediately in warm sessions)
    try {
      const contactsStore = sock.store?.contacts;
      if (contactsStore) {
        let contactsArray = [];
        
        if (contactsStore instanceof Map) {
          contactsArray = Array.from(contactsStore.values());
        } else if (Array.isArray(contactsStore)) {
          contactsArray = contactsStore;
        } else if (typeof contactsStore === 'object') {
          contactsArray = Object.values(contactsStore);
        }
        
        for (const contact of contactsArray) {
          const jid = contact.id || contact.jid || null;
          const normalizedJid = normalizeJid(jid);
          
          if (!normalizedJid || 
              normalizedJid.includes('@broadcast') || 
              normalizedJid.includes('@status') ||
              normalizedJid.includes('@newsletter') ||
              normalizedJid.endsWith('@g.us')) {
            continue;
          }
          
          if (!normalizedJid.endsWith('@s.whatsapp.net') && !normalizedJid.endsWith('@lid')) {
            continue;
          }
          
          const name = extractContactName(contact);
          contactBuffer.map.set(normalizedJid, {
            jid: normalizedJid,
            name: name,
          });
        }
        
        if (contactBuffer.map.size > 0) {
          console.log(`[DATA-FETCHER] ✅ Found ${contactBuffer.map.size} contacts in store immediately`);
        }
      }
    } catch (error) {
      console.error('[DATA-FETCHER] Error reading store:', error.message);
    }
    
    // Now wait for contacts.set event (fires 10-30s after connection for cold logins)
    // Use longer timeout to ensure we capture the event
    console.log('[DATA-FETCHER] Waiting for contacts.set event (can take 10-30 seconds)...');
    const contactsTimeout = Math.max(40000, waitForGroups + 30000); // At least 40 seconds
    contacts = await fetchContacts(sock, contactBuffer.map, contactsTimeout);
    
    // Cleanup contact buffer listeners
    if (contactBuffer.cleanup) {
      contactBuffer.cleanup();
    }
    
    // Fetch groups via API (with retry if empty)
    // Wait longer for groups to be available
    console.log('[DATA-FETCHER] Fetching groups (with retry if empty)...');
    const groups = await fetchGroups(sock, 5000, 8000); // Longer delays for groups
    
    // Return structured data
    const result = {
      contacts: contacts,
      groups: groups,
    };
    
    console.log(`[DATA-FETCHER] ✅ Data fetch complete: ${contacts.length} contacts, ${groups.length} groups`);
    
    return result;
    
  } catch (error) {
    console.error('[DATA-FETCHER] ❌ Error:', error.message);
    throw error;
  } finally {
    // Clean up socket if needed
    // Note: We don't disconnect here to allow the connection to persist
    // The caller can decide whether to keep the connection or disconnect
    if (sock && options.disconnectOnComplete) {
      console.log('[DATA-FETCHER] Disconnecting socket...');
      sock.end();
    }
  }
}

/**
 * Fetch data with automatic retry on failure
 * @param {string} agentId - Agent identifier
 * @param {object} options - Options
 * @param {function} onQR - QR callback
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<{contacts: Array, groups: Array}>}
 */
async function fetchWhatsAppDataWithRetry(agentId, options = {}, onQR = null, maxRetries = 3) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DATA-FETCHER] Attempt ${attempt}/${maxRetries}`);
      return await fetchWhatsAppData(agentId, options, onQR);
    } catch (error) {
      lastError = error;
      console.error(`[DATA-FETCHER] Attempt ${attempt} failed:`, error.message);
      
      if (attempt < maxRetries) {
        const delay = attempt * 2000; // Exponential backoff: 2s, 4s, 6s
        console.log(`[DATA-FETCHER] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

module.exports = {
  fetchWhatsAppData,
  fetchWhatsAppDataWithRetry,
  setupContactBuffer,
  fetchContacts,
  fetchGroups,
  normalizeGroupsData,
  initializeSocket,
  waitForQR,
  waitForConnection,
};
