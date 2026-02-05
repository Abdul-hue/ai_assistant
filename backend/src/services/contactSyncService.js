/**
 * WhatsApp Contact Synchronization Service
 * 
 * Store-first architecture that works even when contacts.set event doesn't fire.
 * Handles automatic synchronization of WhatsApp contacts from Baileys to Supabase.
 * 
 * KEY FEATURES:
 * - Store-first sync (primary mechanism, doesn't depend on events)
 * - Accepts all contact types including @lid (encrypted linked device IDs)
 * - Accepts WhatsApp profile names (notify/pushName) when saved names unavailable
 * - Robust retry mechanism without external dependencies
 * - Comprehensive logging for debugging
 */

const { supabaseAdmin } = require('../config/supabase');

// Note: We no longer depend on getSessionForAgent from baileysService
// Instead, we use closure-captured socket references stored in socketReferences Map

// Store periodic sync intervals and socket references for cleanup
const periodicSyncIntervals = new Map();
const socketReferences = new Map(); // Store socket references for retries

/**
 * Normalize phone number to standard format (+1234567890)
 * Supports ALL country codes - no filtering by country
 * @param {string} phone - Phone number in any format
 * @returns {string} - Normalized phone number with country code
 */
function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return '';
  }

  // Remove @s.whatsapp.net, @c.us, or @lid suffix if present
  let normalized = phone.replace(/@s\.whatsapp\.net$/i, '');
  normalized = normalized.replace(/@c\.us$/i, '');
  normalized = normalized.replace(/@lid$/i, '');

  // Remove all non-digit characters except leading +
  normalized = normalized
    .trim()
    .replace(/[^\d+]/g, '')
    .replace(/(?!^)\+/g, ''); // Remove all + except at the start

  // If empty after cleaning, return empty
  if (!normalized || normalized.length === 0) {
    return '';
  }

  // If it already starts with +, validate and return
  if (normalized.startsWith('+')) {
    // Ensure there are digits after the +
    const digitsOnly = normalized.substring(1);
    if (digitsOnly.length >= 7 && /^\d+$/.test(digitsOnly)) {
      return normalized; // Valid format: +1234567890
    }
    // If invalid, remove + and continue processing
    normalized = digitsOnly;
  }

  // Remove leading zeros (common in some countries like UK, but keep the number)
  // Only remove leading zero if the number is long enough (>= 8 digits)
  if (normalized.startsWith('0') && normalized.length >= 8) {
    normalized = normalized.substring(1);
  }

  // Validate: phone number must be at least 7 digits (minimum valid phone number length)
  // Maximum is 15 digits (E.164 standard)
  if (normalized.length < 7 || normalized.length > 15) {
    // Log for debugging but don't reject - WhatsApp might have non-standard formats
    console.log(`[CONTACT-SYNC] ⚠️ Phone number length unusual: ${normalized} (${normalized.length} digits)`);
  }

  // Add + prefix if not present
  if (normalized && !normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }

  return normalized;
}

/**
 * Get contact type based on JID
 * @param {string} jid - Contact JID
 * @returns {string} - Contact type
 */
function getContactType(jid) {
  if (!jid) return 'unknown';
  
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.includes('@broadcast') || jid.includes('status@broadcast')) return 'broadcast';
  if (jid.includes('newsletter') || jid.includes('Newsletter')) return 'newsletter';
  if (jid.endsWith('@lid')) return 'lid';
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) return 'individual';
  
  return 'unknown';
}

/**
 * Extract contact identifier (phone number, lid, or JID)
 * @param {object} contact - Baileys contact object
 * @returns {object} - {type: 'phone'|'lid'|'jid', value: string}
 */
function extractContactIdentifier(contact) {
  const jid = contact.id || contact.jid || '';
  
  // Strategy 1: Extract from standard JID format (@s.whatsapp.net or @c.us)
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) {
    const phone = jid.split('@')[0];
    return { type: 'phone', value: normalizePhoneNumber(phone) };
  }
  
  // Strategy 2: Extract from lid (encrypted) - no phone number available
  if (jid.endsWith('@lid')) {
    return { type: 'lid', value: jid };
  }
  
  // Strategy 3: Check contact metadata for phone
  if (contact.phoneNumber) {
    return { type: 'phone', value: normalizePhoneNumber(contact.phoneNumber) };
  }
  
  // Strategy 4: Try to extract from any numeric prefix
  const numericMatch = jid.match(/^(\d+)/);
  if (numericMatch && numericMatch[1].length >= 7) {
    return { type: 'phone', value: normalizePhoneNumber(numericMatch[1]) };
  }
  
  // Strategy 5: Use JID as fallback
  return { type: 'jid', value: jid };
}

/**
 * Classify contact type based on JID and properties
 * @param {object} contact - Baileys contact object
 * @returns {string} - Contact type: 'saved', 'whatsapp', 'group', 'business', 'broadcast', 'lid'
 */
function classifyContactType(contact) {
  const jid = contact.id || contact.jid || '';
  const jidType = getContactType(jid);
  
  // Groups
  if (jidType === 'group') {
    return 'group';
  }
  
  // Broadcasts
  if (jidType === 'broadcast') {
    return 'broadcast';
  }
  
  // Newsletters
  if (jidType === 'newsletter') {
    return 'newsletter';
  }
  
  // LID contacts (encrypted linked device)
  if (jidType === 'lid') {
    return 'lid';
  }
  
  // Business accounts
  if (contact.business || contact.verifiedName) {
    return 'business';
  }
  
  // Saved contacts (has name/verifiedName from phone book)
  if (contact.name || contact.verifiedName) {
    return 'saved';
  }
  
  // WhatsApp-only contacts (only has notify/pushName)
  if (contact.notify || contact.pushName) {
    return 'whatsapp';
  }
  
  // Default to whatsapp for unknown types
  return 'whatsapp';
}

/**
 * Extract WhatsApp-specific metadata from a contact
 * @param {object} contact - Baileys contact object
 * @returns {object} - Structured metadata object
 */
function extractContactMetadata(contact) {
  const metadata = {
    whatsapp_id: contact.id || null,
    is_business: contact.business || false,
    verified_name: contact.verifiedName || null,
    notify: contact.notify || contact.pushName || null,
  };

  // Add profile picture URL if available
  if (contact.imgUrl) {
    metadata.profile_picture_url = contact.imgUrl;
  }

  // Add status/about message if available
  if (contact.status) {
    metadata.status = contact.status;
  }

  // Add last seen if available
  if (contact.lastSeen) {
    metadata.last_seen = contact.lastSeen;
  }

  // Add any other relevant fields
  if (contact.labels) {
    metadata.labels = contact.labels;
  }

  return metadata;
}

/**
 * Process a single contact for database sync
 * @param {object} contact - Baileys contact object
 * @param {string} agentId - Agent UUID
 * @returns {object|null} - Contact data object or null if should be skipped
 */
function processContactForSync(contact, agentId) {
  try {
    const jid = contact.id || contact.jid || '';
    const contactType = classifyContactType(contact);
    const jidType = getContactType(jid);
    
    // CRITICAL: Only sync individual contacts with phone numbers
    // Skip groups, broadcasts, newsletters, and @lid contacts (no phone number)
    if (contactType === 'group' || 
        contactType === 'broadcast' || 
        contactType === 'newsletter' ||
        jidType === 'lid' ||
        jidType === 'group') {
      return null;
    }
    
    // CRITICAL: Require phone number - skip @lid and other contacts without phone numbers
    const identifier = extractContactIdentifier(contact);
    if (identifier.type !== 'phone' || !identifier.value) {
      return null; // Skip contacts without phone numbers
    }
    
    // Accept any valid name (saved OR WhatsApp display name)
    const hasAnyName = !!(contact.name || contact.verifiedName || contact.notify || contact.pushName);
    if (!hasAnyName) {
      return null; // Skip contacts without any name
    }
    
    // Prefer saved name, fallback to WhatsApp display name
    const contactName = contact.name || contact.verifiedName || contact.notify || contact.pushName;
    
    // Skip if name is empty or "Unknown"
    if (!contactName || !contactName.trim() || contactName.trim().toLowerCase() === 'unknown') {
      return null;
    }
    
    // Determine if contact is saved in phone book
    const isSaved = !!(contact.name || contact.verifiedName);
    
    // Get notify name (WhatsApp profile name) - stored separately if different from saved name
    const notifyName = contact.notify || contact.pushName || null;
    
    // Build contact data object
    const contactData = {
      agent_id: agentId,
      name: contactName.trim(), // Saved name (preferred) or WhatsApp display name
      phone_number: identifier.value, // Required - phone number from JID
      contact_type: isSaved ? 'saved' : 'whatsapp', // 'saved' for phone book, 'whatsapp' for display name only
      notify_name: notifyName, // WhatsApp profile name (if different from saved name)
      is_saved: isSaved, // true for phone book contacts, false for WhatsApp-only
      jid: jid, // Store full JID for reference
      metadata: extractContactMetadata(contact),
      is_important: false,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    return contactData;
    
  } catch (error) {
    console.error(`[CONTACT-SYNC] ❌ Error processing contact:`, error);
    return null;
  }
}

/**
 * Log comprehensive contact diagnostics
 * @param {Array} contacts - Array of contacts to analyze
 */
function logContactDiagnostics(contacts) {
  console.log('\n[CONTACT-DIAGNOSTIC] ===== CONTACT ANALYSIS =====');
  
  const types = {
    individual: { count: 0, withPhone: 0, withName: 0, withSavedName: 0 },
    lid: { count: 0, withName: 0, withSavedName: 0 },
    group: { count: 0 },
    business: { count: 0 },
    broadcast: { count: 0 },
    newsletter: { count: 0 },
    unknown: { count: 0 }
  };
  
  contacts.forEach((contact) => {
    const jid = contact.id || contact.jid || '';
    const type = getContactType(jid);
    const contactType = classifyContactType(contact);
    
    if (types[contactType]) {
      types[contactType].count++;
    } else {
      types.unknown.count++;
    }
    
    const hasName = !!(contact.name || contact.verifiedName || contact.notify || contact.pushName);
    const hasSavedName = !!(contact.name || contact.verifiedName);
    
    if (type === 'individual') {
      if (hasName) types.individual.withName++;
      if (hasSavedName) types.individual.withSavedName++;
      const hasPhone = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
      if (hasPhone) types.individual.withPhone++;
    }
    
    if (type === 'lid') {
      if (hasName) types.lid.withName++;
      if (hasSavedName) types.lid.withSavedName++;
    }
  });
  
  console.log('[CONTACT-DIAGNOSTIC] Contact Breakdown:');
  Object.entries(types).forEach(([type, stats]) => {
    if (stats.count > 0) {
      console.log(`  ${type}: ${stats.count}`);
      if (stats.withName !== undefined) console.log(`    - With names: ${stats.withName}`);
      if (stats.withSavedName !== undefined) console.log(`    - With saved names: ${stats.withSavedName}`);
      if (stats.withPhone !== undefined) console.log(`    - With phone: ${stats.withPhone}`);
    }
  });
  console.log('[CONTACT-DIAGNOSTIC] ============================\n');
}

/**
 * Process and sync contacts to database
 * @param {string} agentId - Agent UUID
 * @param {Array} contacts - Array of contact objects
 * @param {string} syncSource - Source of sync: 'store', 'event', 'manual', 'periodic'
 * @returns {Promise<{success: number, failed: number, skipped: number, errors: Array}>}
 */
async function processAndSyncContacts(agentId, contacts, syncSource = 'store') {
  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return { success: 0, failed: 0, skipped: 0, errors: [] };
  }

  console.log(`[CONTACT-SYNC] 📦 Processing ${contacts.length} contacts (source: ${syncSource})...`);
  console.log(`[CONTACT-SYNC] ⚠️ NOTE: Syncing contacts with phone numbers and any name (saved OR WhatsApp display names)`);
  console.log(`[CONTACT-SYNC] 🌍 SUPPORTING ALL COUNTRY CODES - No country filtering applied`);
  
  // Log diagnostics
  logContactDiagnostics(contacts);
  
  // Track country codes for diagnostic purposes
  const countryCodeMap = new Map();
  contacts.forEach(contact => {
    const identifier = extractContactIdentifier(contact);
    if (identifier.type === 'phone' && identifier.value) {
      // Extract country code (first 1-3 digits after +)
      const phone = identifier.value;
      if (phone.startsWith('+')) {
        // Common country codes: 1-3 digits
        const match = phone.match(/^\+(\d{1,3})/);
        if (match) {
          const countryCode = match[1];
          countryCodeMap.set(countryCode, (countryCodeMap.get(countryCode) || 0) + 1);
        }
      }
    }
  });
  
  if (countryCodeMap.size > 0) {
    console.log(`[CONTACT-SYNC] 🌍 Country code breakdown:`);
    const sortedCodes = Array.from(countryCodeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 country codes
    sortedCodes.forEach(([code, count]) => {
      console.log(`[CONTACT-SYNC]   +${code}: ${count} contact(s)`);
    });
  }

  const errors = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  // Process contacts in batches of 50 for better performance
  const batchSize = 50;
  
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);
    
    const contactsToUpsert = batch
      .map(contact => processContactForSync(contact, agentId))
      .filter(contact => contact !== null);

    if (contactsToUpsert.length === 0) {
      skippedCount += batch.length;
      console.log(`[CONTACT-SYNC] ⏭️ Batch ${Math.floor(i / batchSize) + 1}: All contacts filtered out`);
      continue;
    }

    console.log(`[CONTACT-SYNC] 📤 Batch ${Math.floor(i / batchSize) + 1}: Upserting ${contactsToUpsert.length} contacts...`);

    try {
      // Add sync_source to all contacts and handle upsert based on contact type
      const contactsWithSource = contactsToUpsert.map(contact => ({
        ...contact,
        sync_source: syncSource,
      }));

      // Separate contacts with phone numbers from @lid contacts
      const contactsWithPhone = contactsWithSource.filter(c => c.phone_number);
      const contactsWithoutPhone = contactsWithSource.filter(c => !c.phone_number && c.metadata?.lid);

      let batchErrors = [];

      // Upsert contacts with phone numbers (use agent_id + phone_number)
      if (contactsWithPhone.length > 0) {
        try {
          // Fetch existing contacts in batch
          const phoneNumbers = contactsWithPhone.map(c => c.phone_number).filter(Boolean);
          const { data: existingContacts, error: fetchError } = await supabaseAdmin
            .from('contacts')
            .select('id, phone_number')
            .eq('agent_id', agentId)
            .in('phone_number', phoneNumbers);

          if (fetchError) {
            console.error(`[CONTACT-SYNC] ❌ Error fetching existing contacts:`, fetchError);
            batchErrors.push(fetchError);
            failedCount += contactsWithPhone.length;
          } else {
            // Create a map of existing contacts by phone number
            const existingMap = new Map();
            if (existingContacts) {
              existingContacts.forEach(ec => {
                existingMap.set(ec.phone_number, ec.id);
              });
            }

            // Separate into updates and inserts
            const toUpdate = [];
            const toInsert = [];

            for (const contact of contactsWithPhone) {
              const existingId = existingMap.get(contact.phone_number);
              if (existingId) {
                toUpdate.push({ ...contact, id: existingId });
              } else {
                toInsert.push(contact);
              }
            }

            // Batch update existing contacts (Supabase doesn't support batch update by different IDs easily, so we do them individually)
            if (toUpdate.length > 0) {
              // Process updates in smaller chunks to avoid overwhelming the database
              const updateChunkSize = 10;
              for (let i = 0; i < toUpdate.length; i += updateChunkSize) {
                const updateChunk = toUpdate.slice(i, i + updateChunkSize);
                await Promise.all(updateChunk.map(async (contact) => {
                  try {
                    const { id, ...updateData } = contact;
                    const { error: updateError } = await supabaseAdmin
                      .from('contacts')
                      .update(updateData)
                      .eq('id', id);

                    if (updateError) {
                      console.error(`[CONTACT-SYNC] ❌ Contact update error:`, updateError);
                      batchErrors.push(updateError);
                      failedCount++;
                    } else {
                      successCount++;
                    }
                  } catch (updateErr) {
                    console.error(`[CONTACT-SYNC] ❌ Contact update exception:`, updateErr);
                    batchErrors.push(updateErr);
                    failedCount++;
                  }
                }));
              }
            }

            // Batch insert new contacts
            if (toInsert.length > 0) {
              const { error: insertError } = await supabaseAdmin
                .from('contacts')
                .insert(toInsert);

              if (insertError) {
                console.error(`[CONTACT-SYNC] ❌ Contact insert error:`, insertError);
                batchErrors.push(insertError);
                failedCount += toInsert.length;
              } else {
                successCount += toInsert.length;
              }
            }
          }
        } catch (error) {
          console.error(`[CONTACT-SYNC] ❌ Phone contacts batch error:`, error);
          batchErrors.push(error);
          failedCount += contactsWithPhone.length;
        }
      }

      // Upsert @lid contacts (use agent_id + jid from metadata)
      if (contactsWithoutPhone.length > 0) {
        for (const contact of contactsWithoutPhone) {
          try {
            // For @lid contacts, use agent_id + jid as unique key
            const lidJid = contact.metadata?.lid || contact.jid;
            if (!lidJid) {
              failedCount++;
              continue;
            }

            // First, try to find existing contact by agent_id + jid
            const { data: existing } = await supabaseAdmin
              .from('contacts')
              .select('id')
              .eq('agent_id', agentId)
              .eq('jid', lidJid)
              .single();

            if (existing) {
              // Update existing
              const { error } = await supabaseAdmin
                .from('contacts')
                .update(contact)
                .eq('id', existing.id);

              if (error) {
                console.error(`[CONTACT-SYNC] ❌ @lid contact update error:`, error);
                batchErrors.push(error);
                failedCount++;
              } else {
                successCount++;
              }
            } else {
              // Insert new
              const { error } = await supabaseAdmin
                .from('contacts')
                .insert({ ...contact, jid: lidJid });

              if (error) {
                console.error(`[CONTACT-SYNC] ❌ @lid contact insert error:`, error);
                batchErrors.push(error);
                failedCount++;
              } else {
                successCount++;
              }
            }
          } catch (error) {
            console.error(`[CONTACT-SYNC] ❌ @lid contact upsert exception:`, error);
            batchErrors.push(error);
            failedCount++;
          }
        }
      }

      // Check if there were any errors in this batch
      if (batchErrors.length > 0) {
        console.error(`[CONTACT-SYNC] ❌ Batch ${Math.floor(i / batchSize) + 1} had ${batchErrors.length} error(s)`);
        errors.push({ 
          batch: Math.floor(i / batchSize) + 1, 
          errors: batchErrors.map(e => e.message || String(e)),
          totalContacts: contactsToUpsert.length
        });
      } else {
        console.log(`[CONTACT-SYNC] ✅ Batch ${Math.floor(i / batchSize) + 1}: Synced ${contactsToUpsert.length} contacts`);
      }
    } catch (error) {
      console.error(`[CONTACT-SYNC] ❌ Batch ${Math.floor(i / batchSize) + 1} error:`, error);
      errors.push({ batch: Math.floor(i / batchSize) + 1, error: error.message });
      failedCount += contactsToUpsert.length;
    }
  }

  console.log(`[CONTACT-SYNC] 📊 Sync summary: ${successCount} success, ${failedCount} failed, ${skippedCount} skipped`);

  return {
    success: successCount,
    failed: failedCount,
    skipped: skippedCount,
    errors,
    totalProcessed: contacts.length,
  };
}

/**
 * Read contacts from Baileys store
 * @param {object} store - Baileys store object
 * @returns {Promise<Array>} - Array of contacts
 */
async function readContactsFromStore(store) {
  if (!store || !store.contacts) {
    return [];
  }

  let allContacts = [];
  
  try {
    if (typeof store.contacts.all === 'function') {
      allContacts = await store.contacts.all();
    } else if (store.contacts instanceof Map) {
      allContacts = Array.from(store.contacts.values());
    } else if (Array.isArray(store.contacts)) {
      allContacts = store.contacts;
    } else if (typeof store.contacts === 'object') {
      allContacts = Object.values(store.contacts);
    }
  } catch (error) {
    console.error(`[CONTACT-SYNC] ❌ Error reading from store:`, error.message);
    return [];
  }

  return allContacts;
}

/**
 * Wait for contacts to become available (event-driven with store fallback)
 * @param {string} agentId - Agent UUID
 * @param {object} sock - Baileys WASocket instance
 * @param {number} timeout - Maximum time to wait in milliseconds (default: 60s)
 * @returns {Promise<Array>} - Array of contacts when available
 */
async function waitForContacts(agentId, sock, timeout = 60000) {
  return new Promise((resolve) => {
    let resolved = false;
    let contactsFound = [];
    const startTime = Date.now();
    
    // Strategy 1: Wait for contacts.set event (most reliable)
    const onContactsSet = async ({ contacts }) => {
      if (resolved) return;
      
      console.log(`[CONTACT-SYNC] 🎉 contacts.set event fired!`);
      
      // Convert to array
      const contactArray = Array.isArray(contacts) 
        ? contacts 
        : contacts instanceof Set 
          ? Array.from(contacts)
          : contacts instanceof Map
            ? Array.from(contacts.values())
            : Object.values(contacts);
      
      if (contactArray.length > 0) {
        resolved = true;
        contactsFound = contactArray;
        sock.ev.off('contacts.set', onContactsSet);
        clearTimeout(timeoutTimer);
        clearInterval(storeCheckInterval);
        console.log(`[CONTACT-SYNC] ✅ Got ${contactArray.length} contacts from contacts.set event`);
        resolve(contactArray);
      }
    };
    
    // Strategy 2: Periodically check store (fallback)
    const checkStore = async () => {
      if (resolved) return;
      
      try {
        const store = sock.store || {};
        if (store.contacts) {
          const storeContacts = await readContactsFromStore(store);
          if (storeContacts.length > 0) {
            resolved = true;
            contactsFound = storeContacts;
            sock.ev.off('contacts.set', onContactsSet);
            clearTimeout(timeoutTimer);
            clearInterval(storeCheckInterval);
            console.log(`[CONTACT-SYNC] ✅ Got ${storeContacts.length} contacts from store`);
            resolve(storeContacts);
          }
        }
      } catch (error) {
        // Ignore store check errors
      }
    };
    
    // Set up event listener
    sock.ev.on('contacts.set', onContactsSet);
    
    // Check store immediately
    checkStore();
    
    // Check store every 5 seconds
    const storeCheckInterval = setInterval(checkStore, 5000);
    
    // Timeout after specified time
    const timeoutTimer = setTimeout(() => {
      if (resolved) return;
      
      resolved = true;
      sock.ev.off('contacts.set', onContactsSet);
      clearInterval(storeCheckInterval);
      
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`[CONTACT-SYNC] ⏱️ Timeout after ${elapsed}s - no contacts found yet`);
      console.log(`[CONTACT-SYNC] ℹ️ Contacts will sync via events as they arrive`);
      
      // Return empty array - events will handle sync
      resolve([]);
    }, timeout);
  });
}

/**
 * Store-first sync with event-driven fallback
 * @param {string} agentId - Agent UUID
 * @param {object} sock - Baileys WASocket instance
 * @returns {Promise<{success: number, failed: number, total: number, errors: Array}>}
 */
async function syncContactsFromStore(agentId, sock) {
  console.log(`[CONTACT-SYNC] 🚀 Starting hybrid sync (event-driven + store polling) for agent ${agentId.substring(0, 8)}...`);
  
  // Store socket reference
  socketReferences.set(agentId, sock);
  
  try {
    // Check if socket is connected
    if (!sock?.user) {
      console.warn(`[CONTACT-SYNC] ⚠️ Socket not connected, skipping sync`);
      return {
        success: 0,
        failed: 0,
        total: 0,
        errors: [{ error: 'Socket not connected' }],
      };
    }
    
    // Wait for contacts (event-driven with store fallback, timeout: 60s)
    console.log(`[CONTACT-SYNC] ⏳ Waiting for contacts (event-driven, timeout: 60s)...`);
    const contacts = await waitForContacts(agentId, sock, 60000);
    
    if (contacts.length === 0) {
      console.log(`[CONTACT-SYNC] ℹ️ No contacts found yet - events will sync them as they arrive`);
      return {
        success: 0,
        failed: 0,
        total: 0,
        errors: [],
        skipped: 0,
        note: 'No contacts found yet - events will sync them',
      };
    }
    
    // Process and sync contacts
    console.log(`[CONTACT-SYNC] 📦 Processing ${contacts.length} contacts...`);
    const result = await processAndSyncContacts(agentId, contacts, 'store');
    
    console.log(`[CONTACT-SYNC] ✅ Sync successful: ${result.success} synced, ${result.failed} failed, ${result.skipped} skipped`);
    return {
      success: result.success,
      failed: result.failed,
      total: result.totalProcessed,
      errors: result.errors,
      skipped: result.skipped,
    };
    
  } catch (error) {
    console.error(`[CONTACT-SYNC] ❌ Sync error:`, error.message);
    // Don't throw - events will handle sync
    return {
      success: 0,
      failed: 0,
      total: 0,
      errors: [{ error: error.message }],
      skipped: 0,
      note: 'Sync error - events will handle contact sync',
    };
  }
}

/**
 * Main sync function - uses store-first approach
 * @param {string} agentId - Agent UUID
 * @param {object} sock - Baileys WASocket instance
 * @returns {Promise<{success: number, failed: number, total: number, errors: Array}>}
 */
async function syncContactsForAgent(agentId, sock) {
  if (!sock || !agentId) {
    throw new Error('Invalid parameters: sock and agentId are required');
  }

  console.log(`[CONTACT-SYNC] 🔄 Starting contact sync for agent ${agentId.substring(0, 8)}...`);

  try {
    // Check if socket is connected
    if (!sock.user) {
      console.warn(`[CONTACT-SYNC] ⚠️ Socket not connected, skipping sync`);
      return {
        success: 0,
        failed: 0,
        total: 0,
        errors: [{ error: 'Socket not connected' }],
      };
    }

    // Use hybrid sync (event-driven + store polling)
    // This waits for contacts.set event OR checks store periodically
    const result = await syncContactsFromStore(agentId, sock);
    
    // If sync found contacts, return success
    if (result.total > 0) {
      return result;
    }
    
    // If sync didn't find contacts, that's okay - events will handle it
    console.log(`[CONTACT-SYNC] ℹ️ Initial sync didn't find contacts yet - events will sync them as they arrive`);
    return result;
    
  } catch (error) {
    console.error(`[CONTACT-SYNC] ❌ Sync failed:`, error);
    // Don't throw - events will handle sync
    return {
      success: 0,
      failed: 0,
      total: 0,
      errors: [{ error: error.message }],
      note: 'Sync failed - events will handle contact sync',
    };
  }
}

/**
 * Setup periodic contact sync (every 5 minutes)
 * @param {string} agentId - Agent UUID
 * @param {object} sock - Baileys WASocket instance
 */
function setupPeriodicSync(agentId, sock) {
  // Clear any existing interval for this agent
  if (periodicSyncIntervals.has(agentId)) {
    clearInterval(periodicSyncIntervals.get(agentId));
  }

  console.log(`[CONTACT-SYNC] ⏰ Setting up periodic sync (every 5 minutes) for agent ${agentId.substring(0, 8)}...`);

  // Store socket reference
  socketReferences.set(agentId, sock);

  const intervalId = setInterval(async () => {
    try {
      // Get socket from stored reference
      const currentSock = socketReferences.get(agentId);
      
      if (!currentSock?.user) {
        console.log(`[CONTACT-SYNC] ⏭️ Periodic sync skipped: Socket not connected`);
        return;
      }

      const store = currentSock.store || {};
      if (!store.contacts) {
        console.log(`[CONTACT-SYNC] ⏭️ Periodic sync skipped: Store not available`);
        return;
      }

      console.log(`[CONTACT-SYNC] 🔄 Starting periodic sync...`);
      
      const allContacts = await readContactsFromStore(store);

      if (allContacts && allContacts.length > 0) {
        const result = await processAndSyncContacts(agentId, allContacts, 'periodic');
        console.log(`[CONTACT-SYNC] ✅ Periodic sync complete: ${result.success}/${allContacts.length} contacts synced`);
      }
    } catch (error) {
      console.error(`[CONTACT-SYNC] ❌ Periodic sync error:`, error.message);
    }
  }, 5 * 60 * 1000); // 5 minutes

  periodicSyncIntervals.set(agentId, intervalId);
}

/**
 * Clean up periodic sync for an agent
 * @param {string} agentId - Agent UUID
 */
function cleanupPeriodicSync(agentId) {
  if (periodicSyncIntervals.has(agentId)) {
    clearInterval(periodicSyncIntervals.get(agentId));
    periodicSyncIntervals.delete(agentId);
    console.log(`[CONTACT-SYNC] 🧹 Cleaned up periodic sync for agent ${agentId.substring(0, 8)}`);
  }
  
  // Clean up socket reference
  socketReferences.delete(agentId);
}

/**
 * Setup real-time contact update listeners (secondary to store sync)
 * @param {string} agentId - Agent UUID
 * @param {object} sock - Baileys WASocket instance
 */
function setupContactUpdateListeners(agentId, sock) {
  if (!sock || !sock.ev) {
    console.warn(`[CONTACT-SYNC] ⚠️ Socket events not available for contact listeners`);
    return;
  }

  console.log(`[CONTACT-SYNC] 🎧 Setting up real-time contact update listeners for agent ${agentId.substring(0, 8)}...`);
  console.log(`[CONTACT-SYNC] ⚠️ NOTE: Store-first sync is primary mechanism. Events are secondary.`);
  
  // Store socket reference
  socketReferences.set(agentId, sock);
  
  // Setup periodic sync
  setupPeriodicSync(agentId, sock);

  // Listen for contacts.set - this is a secondary mechanism
  sock.ev.on('contacts.set', async ({ contacts }) => {
    try {
      console.log(`\n[CONTACT-SYNC] ========== contacts.set EVENT ==========`);
      console.log(`[CONTACT-SYNC] 🎉 contacts.set event FIRED!`);
      
      if (!contacts) {
        console.log(`[CONTACT-SYNC] ⚠️ contacts.set event fired but contacts is null/undefined`);
        console.log(`[CONTACT-SYNC] ========== END contacts.set ==========\n`);
        return;
      }
      
      // Handle both array and Set/Map
      const contactArray = Array.isArray(contacts) 
        ? contacts 
        : contacts instanceof Set 
          ? Array.from(contacts)
          : contacts instanceof Map
            ? Array.from(contacts.values())
            : Object.values(contacts);

      if (contactArray.length === 0) {
        console.log(`[CONTACT-SYNC] ⚠️ contacts.set event fired but contacts array is empty`);
        console.log(`[CONTACT-SYNC] ========== END contacts.set ==========\n`);
        return;
      }

      console.log(`[CONTACT-SYNC] 📥 Received contacts.set: ${contactArray.length} total contacts`);
      
      // Filter to valid contacts (with phone numbers and any name - saved OR WhatsApp display name)
      const validContacts = contactArray.filter(contact => {
        const jid = contact.id || contact.jid || '';
        // Only individual contacts with phone numbers
        const isIndividual = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
        // Must have any name (saved OR WhatsApp display name)
        const hasAnyName = !!(contact.name || contact.verifiedName || contact.notify || contact.pushName);
        return isIndividual && hasAnyName;
      });
      
      const savedCount = validContacts.filter(c => c.name || c.verifiedName).length;
      const whatsappCount = validContacts.length - savedCount;
      console.log(`[CONTACT-SYNC] 📥 Filtered to ${validContacts.length} contacts (${savedCount} saved, ${whatsappCount} WhatsApp names, ${contactArray.length - validContacts.length} filtered out)`);
      
      // Process valid contacts
      const result = await processAndSyncContacts(agentId, validContacts, 'event');
      
      console.log(`[CONTACT-SYNC] ✅ Synced ${result.success}/${validContacts.length} contacts from contacts.set`);
      console.log(`[CONTACT-SYNC] ========== END contacts.set ==========\n`);
      
    } catch (error) {
      console.error(`[CONTACT-SYNC] ❌ Error handling contacts.set:`, error);
      console.log(`[CONTACT-SYNC] ========== END contacts.set ==========\n`);
    }
  });

  // Listen for contact updates
  sock.ev.on('contacts.update', async (updates) => {
    try {
      if (!updates || (Array.isArray(updates) && updates.length === 0)) {
        return;
      }

      const updateArray = Array.isArray(updates) ? updates : [updates];
      console.log(`[CONTACT-SYNC] 📥 Received ${updateArray.length} contact update(s)`);
      
      // Filter to valid contacts (with phone numbers and any name - saved OR WhatsApp display name)
      const validContacts = updateArray.filter(contact => {
        const jid = contact.id || contact.jid || '';
        const isIndividual = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
        const hasAnyName = !!(contact.name || contact.verifiedName || contact.notify || contact.pushName);
        return isIndividual && hasAnyName;
      });
      
      if (validContacts.length === 0) {
        console.log(`[CONTACT-SYNC] ⏭️ No valid contacts to update`);
        return;
      }
      
      const result = await processAndSyncContacts(agentId, validContacts, 'event');
      
      if (result.success > 0) {
        console.log(`[CONTACT-SYNC] ✅ Updated ${result.success} contact(s) in real-time`);
      }
    } catch (error) {
      console.error(`[CONTACT-SYNC] ❌ Error handling contact update:`, error);
    }
  });

  // Listen for new contacts being added
  sock.ev.on('contacts.upsert', async (contacts) => {
    try {
      if (!contacts || (Array.isArray(contacts) && contacts.length === 0)) {
        return;
      }

      const contactArray = Array.isArray(contacts) ? contacts : [contacts];
      console.log(`[CONTACT-SYNC] 📥 Received ${contactArray.length} contact(s) to upsert`);
      
      // Filter to valid contacts (with phone numbers and any name - saved OR WhatsApp display name)
      const validContacts = contactArray.filter(contact => {
        const jid = contact.id || contact.jid || '';
        const isIndividual = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
        const hasAnyName = !!(contact.name || contact.verifiedName || contact.notify || contact.pushName);
        return isIndividual && hasAnyName;
      });
      
      if (validContacts.length === 0) {
        console.log(`[CONTACT-SYNC] ⏭️ No valid contacts to upsert`);
        return;
      }
      
      const result = await processAndSyncContacts(agentId, validContacts, 'event');
      
      if (result.success > 0) {
        console.log(`[CONTACT-SYNC] ✅ Upserted ${result.success} contact(s) in real-time`);
      }
    } catch (error) {
      console.error(`[CONTACT-SYNC] ❌ Error handling contact upsert:`, error);
    }
  });

  // Listen for messaging-history.set (sometimes contains contacts)
  sock.ev.on('messaging-history.set', async (data) => {
    try {
      if (data && data.contacts && Array.isArray(data.contacts)) {
        console.log(`\n[CONTACT-SYNC] ========== messaging-history.set EVENT ==========`);
        console.log(`[CONTACT-SYNC] 📥 Received contacts via messaging-history.set: ${data.contacts.length} contacts`);
        
        // DIAGNOSTIC: Sample first 10 contacts to see what data we have
        console.log('[CONTACT-SYNC] 🔍 DIAGNOSTIC - Sample of first 10 contacts:');
        data.contacts.slice(0, 10).forEach((contact, index) => {
          const jid = contact.id || contact.jid || '';
          console.log(`[CONTACT-SYNC]   ${index + 1}. JID: ${jid}`);
          console.log(`[CONTACT-SYNC]      - name: ${contact.name || 'NULL'}`);
          console.log(`[CONTACT-SYNC]      - verifiedName: ${contact.verifiedName || 'NULL'}`);
          console.log(`[CONTACT-SYNC]      - notify: ${contact.notify || 'NULL'}`);
          console.log(`[CONTACT-SYNC]      - pushName: ${contact.pushName || 'NULL'}`);
          console.log(`[CONTACT-SYNC]      - Has saved name? ${!!(contact.name || contact.verifiedName)}`);
          console.log(`[CONTACT-SYNC]      - Has WhatsApp name? ${!!(contact.notify || contact.pushName)}`);
          console.log(`[CONTACT-SYNC]      - Has any name? ${!!(contact.name || contact.verifiedName || contact.notify || contact.pushName)}`);
          console.log(`[CONTACT-SYNC]      - Is individual? ${jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')}`);
        });
        
        // Count different types
        const withSavedName = data.contacts.filter(c => c.name || c.verifiedName).length;
        const withNotify = data.contacts.filter(c => c.notify || c.pushName).length;
        const groups = data.contacts.filter(c => {
          const jid = c.id || c.jid || '';
          return jid.endsWith('@g.us');
        }).length;
        const individuals = data.contacts.filter(c => {
          const jid = c.id || c.jid || '';
          return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
        }).length;
        
        console.log(`[CONTACT-SYNC] 📊 Contact breakdown:`);
        console.log(`[CONTACT-SYNC]    - Total received: ${data.contacts.length}`);
        console.log(`[CONTACT-SYNC]    - With saved name (name/verifiedName): ${withSavedName}`);
        console.log(`[CONTACT-SYNC]    - With notify/pushName only: ${withNotify}`);
        console.log(`[CONTACT-SYNC]    - Groups (@g.us): ${groups}`);
        console.log(`[CONTACT-SYNC]    - Individual contacts (@s.whatsapp.net/@c.us): ${individuals}`);
        console.log(`[CONTACT-SYNC]    - Individual with saved name: ${data.contacts.filter(c => {
          const jid = c.id || c.jid || '';
          const isIndividual = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
          return isIndividual && (c.name || c.verifiedName);
        }).length}`);
        console.log(`[CONTACT-SYNC]    - Individual with any name (saved OR WhatsApp): ${data.contacts.filter(c => {
          const jid = c.id || c.jid || '';
          const isIndividual = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
          return isIndividual && (c.name || c.verifiedName || c.notify || c.pushName);
        }).length}`);
        
        // Filter to valid contacts (with phone numbers and any name - saved OR WhatsApp display name)
        const validContacts = data.contacts.filter(contact => {
          const jid = contact.id || contact.jid || '';
          const isIndividual = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
          const hasAnyName = !!(contact.name || contact.verifiedName || contact.notify || contact.pushName);
          return isIndividual && hasAnyName;
        });
        
        const savedCount = validContacts.filter(c => c.name || c.verifiedName).length;
        const whatsappCount = validContacts.length - savedCount;
        console.log(`[CONTACT-SYNC] 📥 Filtered to ${validContacts.length} contacts (${savedCount} saved, ${whatsappCount} WhatsApp names, ${data.contacts.length - validContacts.length} filtered out)`);
        
        if (validContacts.length === 0) {
          console.log(`[CONTACT-SYNC] ⏭️ No valid contacts to sync from messaging-history`);
          console.log(`[CONTACT-SYNC] ========== END messaging-history.set ==========\n`);
          return;
        }
        
        const result = await processAndSyncContacts(agentId, validContacts, 'event');
        
        console.log(`[CONTACT-SYNC] ✅ Synced ${result.success}/${validContacts.length} contacts from messaging-history`);
        console.log(`[CONTACT-SYNC] ========== END messaging-history.set ==========\n`);
      }
    } catch (error) {
      console.error(`[CONTACT-SYNC] ❌ Error processing messaging-history.set:`, error);
    }
  });

  console.log(`[CONTACT-SYNC] ✅ Contact update listeners active`);
}

/**
 * Handle individual contact updates (for backward compatibility)
 * @param {string} agentId - Agent UUID
 * @param {Array} contacts - Array of contact objects from Baileys
 * @param {string} syncSource - Source of sync: 'event', 'store', 'manual', 'periodic'
 * @returns {Promise<{success: number, failed: number, errors: Array, skipped: number}>}
 */
async function handleContactUpdate(agentId, contacts, syncSource = 'event') {
  return await processAndSyncContacts(agentId, contacts, syncSource);
}

module.exports = {
  normalizePhoneNumber,
  extractContactMetadata,
  classifyContactType,
  getContactType,
  extractContactIdentifier,
  processContactForSync,
  processAndSyncContacts,
  syncContactsFromStore,
  handleContactUpdate,
  syncContactsForAgent,
  setupContactUpdateListeners,
  setupPeriodicSync,
  cleanupPeriodicSync,
};
