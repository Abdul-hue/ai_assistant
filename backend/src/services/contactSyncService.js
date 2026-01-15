/**
 * WhatsApp Contact Synchronization Service
 * 
 * Handles automatic synchronization of WhatsApp contacts when a user connects
 * via QR code. Syncs contacts from Baileys to the Supabase database.
 */

const { supabaseAdmin } = require('../config/supabase');

/**
 * Normalize phone number to standard format (+1234567890)
 * Matches the normalization pattern used in contactsService.js
 * @param {string} phone - Phone number in any format
 * @returns {string} - Normalized phone number with country code
 */
function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return '';
  }

  // Remove @s.whatsapp.net suffix if present (from JID format like "1234567890@s.whatsapp.net")
  let normalized = phone.replace(/@s\.whatsapp\.net$/i, '');

  // Remove all non-digit characters except leading +
  normalized = normalized
    .trim()
    .replace(/[^\d+]/g, '')
    .replace(/(?!^)\+/g, '');

  // If it doesn't start with +, add it (assuming it's a valid number)
  if (normalized && !normalized.startsWith('+')) {
    // If it starts with 0, remove it (common in some countries)
    if (normalized.startsWith('0')) {
      normalized = normalized.substring(1);
    }
    // Add + prefix
    normalized = '+' + normalized;
  }

  return normalized;
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
    notify: contact.notify || null,
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
 * Handle individual contact updates (for real-time sync)
 * @param {string} agentId - Agent UUID
 * @param {Array} contacts - Array of contact objects from Baileys
 * @returns {Promise<{success: number, failed: number, errors: Array}>}
 */
async function handleContactUpdate(agentId, contacts) {
  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return { success: 0, failed: 0, errors: [] };
  }

  const errors = [];
  let successCount = 0;
  let failedCount = 0;

  // Process contacts in batches of 50 for better performance
  const batchSize = 50;
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);
    
    try {
      const contactsToUpsert = batch
        .map((contact) => {
          try {
            // Extract phone number from JID format (e.g., "1234567890@s.whatsapp.net")
            // Baileys contact objects can have id, jid, or both
            let phoneNumber = '';
            
            if (contact.id) {
              phoneNumber = contact.id;
            } else if (contact.jid) {
              phoneNumber = contact.jid;
            } else if (typeof contact === 'string') {
              // Sometimes contact is just a JID string
              phoneNumber = contact;
            }

            // Remove @s.whatsapp.net suffix if present
            if (phoneNumber.includes('@')) {
              phoneNumber = phoneNumber.split('@')[0];
            }

            // Normalize phone number
            const normalizedPhone = normalizePhoneNumber(phoneNumber);
            
            if (!normalizedPhone || normalizedPhone.length < 3) {
              return null; // Skip invalid phone numbers
            }

            // Get contact name (prefer notify, then name, then pushname, then fallback to phone)
            const contactName = contact.notify || 
                               contact.name || 
                               contact.pushname || 
                               contact.vname || 
                               normalizedPhone;

            const contactData = {
              agent_id: agentId,
              name: contactName,
              phone_number: normalizedPhone,
              metadata: extractContactMetadata(contact),
              updated_at: new Date().toISOString(),
            };

            // Only set created_at for new contacts (will be set by database default on insert)
            // For updates, we don't want to change created_at
            
            return contactData;
          } catch (error) {
            console.error(`[CONTACT-SYNC] Error processing contact:`, error);
            return null;
          }
        })
        .filter((contact) => contact !== null);

      if (contactsToUpsert.length === 0) {
        continue;
      }

      // Batch upsert to database
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .upsert(contactsToUpsert, {
          onConflict: 'agent_id,phone_number',
          ignoreDuplicates: false,
        })
        .select();

      if (error) {
        console.error(`[CONTACT-SYNC] Batch upsert error:`, error);
        errors.push({
          batch: i,
          error: error.message,
          contacts: contactsToUpsert.length,
        });
        failedCount += contactsToUpsert.length;
      } else {
        successCount += contactsToUpsert.length;
        console.log(`[CONTACT-SYNC] ✅ Synced batch ${Math.floor(i / batchSize) + 1}: ${contactsToUpsert.length} contacts`);
      }
    } catch (error) {
      console.error(`[CONTACT-SYNC] Error processing batch:`, error);
      errors.push({
        batch: i,
        error: error.message,
      });
      failedCount += batch.length;
    }
  }

  return {
    success: successCount,
    failed: failedCount,
    errors,
  };
}

/**
 * Main sync function - fetches all contacts from WhatsApp and syncs to database
 * @param {string} agentId - Agent UUID
 * @param {object} sock - Baileys WASocket instance
 * @param {boolean} isRetry - Whether this is a retry attempt (for logging)
 * @returns {Promise<{success: number, failed: number, total: number, errors: Array}>}
 */
async function syncContactsForAgent(agentId, sock, isRetry = false) {
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

    // Fetch contacts from WhatsApp
    // Baileys loads contacts incrementally, so we need to access them from the store
    // Contacts are typically available through sock.store.contacts or via events
    
    let contacts = [];
    
    try {
      // Method 1: Try sock.store.contacts.all() - this is the standard Baileys method (used in baileysService.js:3332)
      if (sock.store && sock.store.contacts) {
        try {
          if (typeof sock.store.contacts.all === 'function') {
            contacts = await sock.store.contacts.all();
            if (contacts && contacts.length > 0) {
              console.log(`[CONTACT-SYNC] 📋 Retrieved ${contacts.length} contacts via sock.store.contacts.all()`);
            }
          } else {
            // Try calling it as a function first
            try {
              const contactStore = await sock.store.contacts();
              if (contactStore && typeof contactStore.all === 'function') {
                contacts = await contactStore.all();
                if (contacts && contacts.length > 0) {
                  console.log(`[CONTACT-SYNC] 📋 Retrieved ${contacts.length} contacts via sock.store.contacts().all()`);
                }
              }
            } catch (funcError) {
              // Ignore - try next method
            }
          }
        } catch (allError) {
          console.warn(`[CONTACT-SYNC] ⚠️ sock.store.contacts.all() failed:`, allError.message);
        }
      }

      // Method 2: Try to get contacts from store if available (alternative patterns)
      if (contacts.length === 0 && sock.store) {
        // Baileys store structure: sock.store.contacts might be a function or object
        if (typeof sock.store.contacts === 'function') {
          try {
            const contactStore = await sock.store.contacts();
            if (contactStore) {
              if (typeof contactStore.all === 'function') {
                contacts = await contactStore.all();
              } else if (Array.isArray(contactStore)) {
                contacts = contactStore;
              } else if (typeof contactStore === 'object') {
                // Convert object/map to array
                contacts = Object.values(contactStore);
              }
            }
          } catch (funcError) {
            console.warn(`[CONTACT-SYNC] ⚠️ sock.store.contacts() function call failed:`, funcError.message);
          }
        } else if (sock.store.contacts && typeof sock.store.contacts === 'object') {
          // Direct access to contacts object
          if (Array.isArray(sock.store.contacts)) {
            contacts = sock.store.contacts;
          } else {
            contacts = Object.values(sock.store.contacts);
          }
        }
      }
      
      // Method 3: Try alternative store access patterns
      if (contacts.length === 0 && sock.store?.contacts) {
        try {
          // Some Baileys versions expose contacts differently
          const storeContacts = sock.store.contacts;
          if (storeContacts && typeof storeContacts === 'object') {
            if (storeContacts.contacts) {
              contacts = Object.values(storeContacts.contacts);
            } else if (Array.isArray(storeContacts)) {
              contacts = storeContacts;
            }
          }
        } catch (altError) {
          // Ignore alternative access errors
        }
      }
    } catch (storeError) {
      console.warn(`[CONTACT-SYNC] ⚠️ Could not fetch from store:`, storeError.message);
    }

    // Baileys loads contacts incrementally as they're needed
    // If we don't have contacts in store yet, schedule a delayed retry
    if (contacts.length === 0) {
      console.log(`[CONTACT-SYNC] ℹ️ No contacts in store yet (normal - Baileys loads incrementally)`);
      console.log(`[CONTACT-SYNC] ⏰ Scheduling delayed contact fetch in 5 seconds...`);
      
      // Schedule a delayed retry to fetch contacts after Baileys has loaded them
      setTimeout(async () => {
        try {
          console.log(`[CONTACT-SYNC] 🔄 Retrying contact fetch after 5s delay...`);
          const retryResult = await syncContactsForAgent(agentId, sock, true);
          if (retryResult.total > 0) {
            console.log(`[CONTACT-SYNC] ✅ Delayed fetch successful: ${retryResult.success}/${retryResult.total} contacts synced`);
          } else {
            console.log(`[CONTACT-SYNC] ℹ️ Contacts still not loaded after 5s - will sync via real-time events`);
          }
        } catch (retryError) {
          console.warn(`[CONTACT-SYNC] ⚠️ Delayed fetch failed:`, retryError.message);
        }
      }, 5000); // Retry after 5 seconds
      
      // Also schedule another retry after 15 seconds for contacts that load later
      setTimeout(async () => {
        try {
          console.log(`[CONTACT-SYNC] 🔄 Second retry for contacts that loaded later (15s)...`);
          const retryResult = await syncContactsForAgent(agentId, sock, true);
          if (retryResult.total > 0) {
            console.log(`[CONTACT-SYNC] ✅ Second fetch successful: ${retryResult.success}/${retryResult.total} contacts synced`);
          }
        } catch (retryError) {
          // Silently ignore - contacts will sync via events
        }
      }, 15000); // Second retry after 15 seconds
      
      // Final retry after 30 seconds for any remaining contacts
      setTimeout(async () => {
        try {
          console.log(`[CONTACT-SYNC] 🔄 Final retry for remaining contacts (30s)...`);
          const retryResult = await syncContactsForAgent(agentId, sock, true);
          if (retryResult.total > 0) {
            console.log(`[CONTACT-SYNC] ✅ Final fetch successful: ${retryResult.success}/${retryResult.total} contacts synced`);
          }
        } catch (retryError) {
          // Silently ignore - contacts will sync via events
        }
      }, 30000); // Final retry after 30 seconds
      
      console.log(`[CONTACT-SYNC] ℹ️ Contacts will also be synced automatically via real-time events as they load`);
      // Return early - contacts will be synced via events and delayed retries
      return {
        success: 0,
        failed: 0,
        total: 0,
        errors: [],
        note: 'Contacts will be synced via real-time events and delayed retries as they are loaded by Baileys',
      };
    }

    console.log(`[CONTACT-SYNC] 📋 Found ${contacts.length} contacts to sync`);

    // Sync contacts to database
    const result = await handleContactUpdate(agentId, contacts);

    // Update last_synced_at timestamp (if you add this column to contacts table)
    try {
      await supabaseAdmin
        .from('agents')
        .update({
          // You can add a last_contacts_synced_at field to agents table
          updated_at: new Date().toISOString(),
        })
        .eq('id', agentId);
    } catch (updateError) {
      console.warn(`[CONTACT-SYNC] ⚠️ Could not update sync timestamp:`, updateError.message);
    }

    console.log(`[CONTACT-SYNC] ✅ Sync complete: ${result.success} succeeded, ${result.failed} failed`);

    return {
      ...result,
      total: contacts.length,
    };
  } catch (error) {
    console.error(`[CONTACT-SYNC] ❌ Sync failed:`, error);
    return {
      success: 0,
      failed: 0,
      total: 0,
      errors: [{ error: error.message }],
    };
  }
}

/**
 * Setup real-time contact update listeners
 * @param {string} agentId - Agent UUID
 * @param {object} sock - Baileys WASocket instance
 */
function setupContactUpdateListeners(agentId, sock) {
  if (!sock || !sock.ev) {
    console.warn(`[CONTACT-SYNC] ⚠️ Socket events not available for contact listeners`);
    return;
  }

  console.log(`[CONTACT-SYNC] 🎧 Setting up real-time contact update listeners for agent ${agentId.substring(0, 8)}...`);

  // Listen for contact updates
  sock.ev.on('contacts.update', async (updates) => {
    try {
      if (!updates || (Array.isArray(updates) && updates.length === 0)) {
        return;
      }

      // Handle both array and single object
      const updateArray = Array.isArray(updates) ? updates : [updates];
      
      console.log(`[CONTACT-SYNC] 📥 Received ${updateArray.length} contact update(s)`);
      
      const result = await handleContactUpdate(agentId, updateArray);
      
      if (result.success > 0) {
        console.log(`[CONTACT-SYNC] ✅ Updated ${result.success} contact(s) in real-time`);
      }
      
      if (result.failed > 0) {
        console.warn(`[CONTACT-SYNC] ⚠️ Failed to update ${result.failed} contact(s)`);
      }
    } catch (error) {
      console.error(`[CONTACT-SYNC] ❌ Error handling contact update:`, error);
      // Don't throw - we want to continue listening
    }
  });

  // Listen for new contacts being added
  sock.ev.on('contacts.upsert', async (contacts) => {
    try {
      if (!contacts || (Array.isArray(contacts) && contacts.length === 0)) {
        return;
      }

      // Handle both array and single object
      const contactArray = Array.isArray(contacts) ? contacts : [contacts];
      
      console.log(`[CONTACT-SYNC] 📥 Received ${contactArray.length} new/updated contact(s)`);
      
      const result = await handleContactUpdate(agentId, contactArray);
      
      if (result.success > 0) {
        console.log(`[CONTACT-SYNC] ✅ Upserted ${result.success} contact(s) in real-time`);
      }
      
      if (result.failed > 0) {
        console.warn(`[CONTACT-SYNC] ⚠️ Failed to upsert ${result.failed} contact(s)`);
      }
    } catch (error) {
      console.error(`[CONTACT-SYNC] ❌ Error handling contact upsert:`, error);
      // Don't throw - we want to continue listening
    }
  });

  // Listen for any other contact-related events that might contain contact data
  // Some Baileys versions might use different event names
  sock.ev.on('messaging-history.set', async (data) => {
    try {
      // This event sometimes contains contact information
      if (data && data.contacts && Array.isArray(data.contacts)) {
        console.log(`[CONTACT-SYNC] 📥 Received contacts via messaging-history.set: ${data.contacts.length} contacts`);
        const result = await handleContactUpdate(agentId, data.contacts);
        if (result.success > 0) {
          console.log(`[CONTACT-SYNC] ✅ Synced ${result.success} contact(s) from messaging-history`);
        }
      }
    } catch (error) {
      // Silently ignore - this event might not always have contacts
    }
  });

  console.log(`[CONTACT-SYNC] ✅ Contact update listeners active`);
}

module.exports = {
  normalizePhoneNumber,
  extractContactMetadata,
  handleContactUpdate,
  syncContactsForAgent,
  setupContactUpdateListeners,
};
