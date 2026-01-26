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
            // Extract JID to check if it's a group or individual contact
            let contactJid = '';
            
            if (contact.id) {
              contactJid = contact.id;
            } else if (contact.jid) {
              contactJid = contact.jid;
            } else if (typeof contact === 'string') {
              // Sometimes contact is just a JID string
              contactJid = contact;
            }

            // CRITICAL: Filter out groups and non-individual contacts
            // Only include individual contacts: @s.whatsapp.net, @c.us, @lid
            // Exclude: @g.us (groups), @broadcast, status@broadcast, newsletters
            if (!contactJid) {
              return null; // Skip if no JID
            }

            const isGroup = contactJid.endsWith('@g.us');
            const isBroadcast = contactJid.includes('@broadcast') || contactJid.includes('status@broadcast');
            const isNewsletter = contactJid.includes('newsletter') || contactJid.includes('Newsletter');
            
            if (isGroup || isBroadcast || isNewsletter) {
              // Skip groups, broadcasts, and newsletters
              return null;
            }

            // Only process individual contacts: @s.whatsapp.net, @c.us, @lid
            const isIndividualContact = contactJid.endsWith('@s.whatsapp.net') || 
                                       contactJid.endsWith('@c.us') || 
                                       contactJid.endsWith('@lid');
            
            if (!isIndividualContact) {
              // Skip unknown JID formats
              return null;
            }

            // Extract phone number from JID
            let phoneNumber = contactJid;
            if (phoneNumber.includes('@')) {
              phoneNumber = phoneNumber.split('@')[0];
            }

            // Normalize phone number
            const normalizedPhone = normalizePhoneNumber(phoneNumber);
            
            if (!normalizedPhone || normalizedPhone.length < 3) {
              return null; // Skip invalid phone numbers
            }

            // CRITICAL: Only save contacts that are saved in WhatsApp contacts directory
            // Saved contacts MUST have 'name' (saved in phone) or 'verifiedName' (business account)
            // 'notify' and 'pushName' are NOT indicators of saved contacts - they're for unsaved numbers
            const hasSavedName = contact.name || contact.verifiedName;
            
            if (!hasSavedName) {
              // Skip unsaved contacts (only have pushName/notify/id)
              // These are NOT in the user's WhatsApp contacts directory
              return null;
            }
            
            // Get contact name (prefer name, then verifiedName)
            // These are the ONLY valid names for saved contacts
            let contactName = contact.name || contact.verifiedName;
            
            // Handle edge case: empty or whitespace-only names
            if (!contactName || typeof contactName !== 'string' || !contactName.trim()) {
              // If name is empty/whitespace, skip this contact
              return null;
            }
            
            // Trim whitespace from name
            contactName = contactName.trim();

            const contactData = {
              agent_id: agentId,
              name: contactName,
              phone_number: normalizedPhone,
              metadata: extractContactMetadata(contact),
              is_important: false, // Default to false for new contacts
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
    
    // Try to fetch contacts from store as fallback (if available)
    // Try to fetch contacts from store as fallback (if available)
    // This helps with immediate sync on first connection
    let storeContacts = [];
    try {
      if (sock.store?.contacts) {
        console.log(`[CONTACT-SYNC] 🔍 Attempting to fetch contacts from store as fallback...`);
        
        let allStoreContacts = [];
        if (typeof sock.store.contacts.all === 'function') {
          allStoreContacts = await sock.store.contacts.all();
        } else if (sock.store.contacts instanceof Map) {
          allStoreContacts = Array.from(sock.store.contacts.values());
        } else if (Array.isArray(sock.store.contacts)) {
          allStoreContacts = sock.store.contacts;
        } else if (typeof sock.store.contacts === 'object') {
          allStoreContacts = Object.values(sock.store.contacts);
        }
        
        if (allStoreContacts && allStoreContacts.length > 0) {
          console.log(`[CONTACT-SYNC] 📦 Found ${allStoreContacts.length} contacts in store`);
          
          // Filter to only individual saved contacts (same logic as event handler)
          storeContacts = allStoreContacts.filter(contact => {
            const jid = contact.id || contact.jid || '';
            
            // Exclude groups, broadcasts, newsletters
            if (jid.endsWith('@g.us') || 
                jid.includes('@broadcast') || 
                jid.includes('status@broadcast') ||
                jid.includes('newsletter') ||
                jid.includes('Newsletter')) {
              return false;
            }
            
            // Only include individual contacts
            const isIndividual = jid.endsWith('@s.whatsapp.net') || 
                                jid.endsWith('@c.us') || 
                                jid.endsWith('@lid');
            
            if (!isIndividual) {
              return false;
            }
            
            // Only include saved contacts (have 'name' or 'verifiedName')
            return !!(contact.name || contact.verifiedName);
          });
          
          if (storeContacts.length > 0) {
            console.log(`[CONTACT-SYNC] ✅ Found ${storeContacts.length} individual saved contacts in store - syncing now`);
            const result = await handleContactUpdate(agentId, storeContacts);
            console.log(`[CONTACT-SYNC] ✅ Store sync complete: ${result.success}/${storeContacts.length} contacts synced`);
            return {
              success: result.success,
              failed: result.failed,
              total: storeContacts.length,
              errors: result.errors,
              note: 'Contacts synced from store (event-based sync will continue)',
            };
          } else {
            console.log(`[CONTACT-SYNC] ℹ️ No saved contacts found in store yet - waiting for contacts.set event`);
          }
        } else {
          console.log(`[CONTACT-SYNC] ℹ️ Store is empty - waiting for contacts.set event`);
        }
      }
    } catch (storeError) {
      console.warn(`[CONTACT-SYNC] ⚠️ Error reading from store (non-critical):`, storeError.message);
      // Continue - event-based sync will handle it
    }
    
    // Set up a delayed retry to check store again after 30 seconds
    // This helps if contacts.set event is delayed or doesn't fire
    setTimeout(async () => {
      try {
        if (sock.store?.contacts && sock.user) {
          console.log(`[CONTACT-SYNC] 🔄 Retry: Checking store again after 30s delay...`);
          
          let allStoreContacts = [];
          if (typeof sock.store.contacts.all === 'function') {
            allStoreContacts = await sock.store.contacts.all();
          } else if (sock.store.contacts instanceof Map) {
            allStoreContacts = Array.from(sock.store.contacts.values());
          } else if (Array.isArray(sock.store.contacts)) {
            allStoreContacts = sock.store.contacts;
          } else if (typeof sock.store.contacts === 'object') {
            allStoreContacts = Object.values(sock.store.contacts);
          }
          
          if (allStoreContacts && allStoreContacts.length > 0) {
            const retryContacts = allStoreContacts.filter(contact => {
              const jid = contact.id || contact.jid || '';
              if (jid.endsWith('@g.us') || 
                  jid.includes('@broadcast') || 
                  jid.includes('status@broadcast') ||
                  jid.includes('newsletter') ||
                  jid.includes('Newsletter')) {
                return false;
              }
              const isIndividual = jid.endsWith('@s.whatsapp.net') || 
                                  jid.endsWith('@c.us') || 
                                  jid.endsWith('@lid');
              if (!isIndividual) return false;
              return !!(contact.name || contact.verifiedName);
            });
            
            if (retryContacts.length > 0) {
              console.log(`[CONTACT-SYNC] ✅ Retry: Found ${retryContacts.length} saved contacts - syncing now`);
              await handleContactUpdate(agentId, retryContacts);
            }
          }
        }
      } catch (retryError) {
        console.warn(`[CONTACT-SYNC] ⚠️ Retry sync error (non-critical):`, retryError.message);
      }
    }, 30000); // 30 seconds delay
    
    // Return immediately - event listeners will handle the rest
    // Contacts will be synced via events handled by setupContactUpdateListeners()
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
  console.log(`[CONTACT-SYNC] ⏰ Waiting for contacts.set event (usually fires 10-30s after connection opens)...`);

  // CRITICAL: Listen for contacts.set - this is the MAIN event that sends ALL contacts
  // WhatsApp sends this 10-30 seconds after connection opens
  sock.ev.on('contacts.set', async ({ contacts }) => {
    try {
      console.log(`[CONTACT-SYNC] 🎉 contacts.set event FIRED!`);
      
      if (!contacts) {
        console.log(`[CONTACT-SYNC] ⚠️ contacts.set event fired but contacts is null/undefined`);
        return;
      }
      
      if (contacts.length === 0) {
        console.log(`[CONTACT-SYNC] ⚠️ contacts.set event fired but contacts array is empty`);
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

      console.log(`[CONTACT-SYNC] 📥 Received contacts.set event: ${contactArray.length} total contact(s)`);
      
      // Track filtering stats for detailed logging
      let groupsCount = 0;
      let broadcastsCount = 0;
      let newslettersCount = 0;
      let nonIndividualCount = 0;
      let unsavedCount = 0;
      
      // CRITICAL: Filter to only individual saved contacts (not groups, broadcasts, etc.)
      const savedContacts = contactArray.filter(contact => {
        // Get JID to check type
        const jid = contact.id || contact.jid || '';
        
        // Exclude groups, broadcasts, newsletters
        if (jid.endsWith('@g.us')) {
          groupsCount++;
          return false;
        }
        if (jid.includes('@broadcast') || jid.includes('status@broadcast')) {
          broadcastsCount++;
          return false;
        }
        if (jid.includes('newsletter') || jid.includes('Newsletter')) {
          newslettersCount++;
          return false;
        }
        
        // Only include individual contacts
        const isIndividual = jid.endsWith('@s.whatsapp.net') || 
                            jid.endsWith('@c.us') || 
                            jid.endsWith('@lid');
        
        if (!isIndividual) {
          nonIndividualCount++;
          return false;
        }
        
        // CRITICAL: Only include saved contacts (have 'name' or 'verifiedName')
        // 'notify' and 'pushName' are NOT indicators of saved contacts
        const hasSavedName = contact.name || contact.verifiedName;
        if (!hasSavedName) {
          unsavedCount++;
          // Clean up temporary contact from store
          if (sock.store?.contacts && contact.id) {
            try {
              sock.store.contacts.delete(contact.id);
            } catch (e) {
              // Ignore cleanup errors
            }
          }
          return false;
        }
        return true;
      });
      
      // Detailed logging of filtering results
      console.log(`[CONTACT-SYNC] 📊 Filtering breakdown:`);
      console.log(`[CONTACT-SYNC]   - Total received: ${contactArray.length}`);
      console.log(`[CONTACT-SYNC]   - Groups (@g.us): ${groupsCount}`);
      console.log(`[CONTACT-SYNC]   - Broadcasts: ${broadcastsCount}`);
      console.log(`[CONTACT-SYNC]   - Newsletters: ${newslettersCount}`);
      console.log(`[CONTACT-SYNC]   - Non-individual JIDs: ${nonIndividualCount}`);
      console.log(`[CONTACT-SYNC]   - Unsaved contacts (no name/verifiedName): ${unsavedCount}`);
      console.log(`[CONTACT-SYNC]   - ✅ Saved contacts (will sync): ${savedContacts.length}`);
      console.log(`[CONTACT-SYNC] 🔄 Syncing ${savedContacts.length} saved contacts to database...`);

      const result = await handleContactUpdate(agentId, savedContacts);

      if (result.success > 0) {
        console.log(`[SYNC] Found ${result.success} saved address book contacts`);
        console.log(`[CONTACT-SYNC] ✅ Initial sync complete: ${result.success}/${savedContacts.length} saved contacts synced`);
        
        // Update sync timestamp
        try {
          await supabaseAdmin
            .from('agents')
            .update({
              updated_at: new Date().toISOString(),
            })
            .eq('id', agentId);
        } catch (updateError) {
          // Ignore timestamp update errors
        }
      }

      if (result.failed > 0) {
        console.warn(`[CONTACT-SYNC] ⚠️ Failed to sync ${result.failed} contact(s)`);
      }
    } catch (error) {
      console.error(`[CONTACT-SYNC] ❌ Error handling contacts.set:`, error);
      // Don't throw - we want to continue listening
    }
  });

  // Listen for contact updates (when existing contacts change)
  sock.ev.on('contacts.update', async (updates) => {
    try {
      if (!updates || (Array.isArray(updates) && updates.length === 0)) {
        return;
      }

      // Handle both array and single object
      const updateArray = Array.isArray(updates) ? updates : [updates];
      
      console.log(`[CONTACT-SYNC] 📥 Received ${updateArray.length} contact update(s)`);
      
      // Filter to only individual saved contacts (same logic as other handlers)
      const savedContacts = updateArray.filter(contact => {
        const jid = contact.id || contact.jid || '';
        
        // Exclude groups, broadcasts, newsletters
        if (jid.endsWith('@g.us') || 
            jid.includes('@broadcast') || 
            jid.includes('status@broadcast') ||
            jid.includes('newsletter') ||
            jid.includes('Newsletter')) {
          return false;
        }
        
        // Only include individual contacts
        const isIndividual = jid.endsWith('@s.whatsapp.net') || 
                            jid.endsWith('@c.us') || 
                            jid.endsWith('@lid');
        
        if (!isIndividual) {
          return false;
        }
        
        // Only include saved contacts (have 'name' or 'verifiedName')
        const hasSavedName = contact.name || contact.verifiedName;
        if (!hasSavedName) {
          return false;
        }
        
        // Check for empty/whitespace names
        const contactName = contact.name || contact.verifiedName;
        if (!contactName || typeof contactName !== 'string' || !contactName.trim()) {
          return false;
        }
        
        return true;
      });
      
      if (savedContacts.length === 0) {
        console.log(`[CONTACT-SYNC] ⏭️ All ${updateArray.length} updated contact(s) filtered out (not saved contacts)`);
        return;
      }
      
      console.log(`[CONTACT-SYNC] 🔄 Processing ${savedContacts.length} saved contact update(s) (${updateArray.length - savedContacts.length} filtered out)`);
      
      const result = await handleContactUpdate(agentId, savedContacts);
      
      if (result.success > 0) {
        console.log(`[CONTACT-SYNC] ✅ Updated ${result.success} saved contact(s) in real-time`);
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
      
      // CRITICAL: Filter to only individual saved contacts (not groups, broadcasts, etc.)
      const savedContacts = contactArray.filter(contact => {
        // Get JID to check type
        const jid = contact.id || contact.jid || '';
        
        // Exclude groups, broadcasts, newsletters
        if (jid.endsWith('@g.us') || 
            jid.includes('@broadcast') || 
            jid.includes('status@broadcast') ||
            jid.includes('newsletter') ||
            jid.includes('Newsletter')) {
          return false;
        }
        
        // Only include individual contacts
        const isIndividual = jid.endsWith('@s.whatsapp.net') || 
                            jid.endsWith('@c.us') || 
                            jid.endsWith('@lid');
        
        if (!isIndividual) {
          return false;
        }
        
        // Only include saved contacts (have 'name' or 'verifiedName')
        const hasSavedName = contact.name || contact.verifiedName;
        if (!hasSavedName) {
          // Clean up temporary contact from store if it exists
          if (sock.store?.contacts && contact.id) {
            try {
              sock.store.contacts.delete(contact.id);
            } catch (e) {
              // Ignore cleanup errors
            }
          }
          return false;
        }
        
        // Check for empty/whitespace names
        const contactName = contact.name || contact.verifiedName;
        if (!contactName || typeof contactName !== 'string' || !contactName.trim()) {
          return false;
        }
        
        return true;
      });
      
      if (savedContacts.length === 0) {
        console.log(`[CONTACT-SYNC] ⏭️ Received ${contactArray.length} contact(s), but none are saved contacts (all filtered out)`);
        return;
      }
      
      console.log(`[CONTACT-SYNC] 📥 Received ${contactArray.length} contact(s), ${savedContacts.length} are saved contacts (${contactArray.length - savedContacts.length} filtered out)`);
      
      const result = await handleContactUpdate(agentId, savedContacts);
      
      if (result.success > 0) {
        console.log(`[SYNC] Found ${result.success} saved address book contacts`);
        console.log(`[CONTACT-SYNC] ✅ Upserted ${result.success} saved contact(s) in real-time`);
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
        
        // CRITICAL: Filter to only individual saved contacts (not groups, broadcasts, etc.)
        const savedContacts = data.contacts.filter(contact => {
          // Get JID to check type
          const jid = contact.id || contact.jid || '';
          
          // Exclude groups, broadcasts, newsletters
          if (jid.endsWith('@g.us') || 
              jid.includes('@broadcast') || 
              jid.includes('status@broadcast') ||
              jid.includes('newsletter') ||
              jid.includes('Newsletter')) {
            return false;
          }
          
          // Only include individual contacts
          const isIndividual = jid.endsWith('@s.whatsapp.net') || 
                              jid.endsWith('@c.us') || 
                              jid.endsWith('@lid');
          
          if (!isIndividual) {
            return false;
          }
          
          // Only include saved contacts (have 'name' or 'verifiedName')
          const hasSavedName = contact.name || contact.verifiedName;
          if (!hasSavedName && sock.store?.contacts && contact.id) {
            // Clean up temporary contact from store
            try {
              sock.store.contacts.delete(contact.id);
            } catch (e) {
              // Ignore cleanup errors
            }
          }
          
          if (!hasSavedName) {
            return false;
          }
          
          // Check for empty/whitespace names
          const contactName = contact.name || contact.verifiedName;
          if (!contactName || typeof contactName !== 'string' || !contactName.trim()) {
            return false;
          }
          
          return true;
        });
        
        if (savedContacts.length === 0) {
          console.log(`[CONTACT-SYNC] ⏭️ All ${data.contacts.length} contacts from messaging-history filtered out (not saved contacts)`);
          return;
        }
        
        console.log(`[CONTACT-SYNC] 📥 Filtered to ${savedContacts.length} saved contacts from messaging-history (${data.contacts.length - savedContacts.length} filtered out)`);
        const result = await handleContactUpdate(agentId, savedContacts);
        if (result.success > 0) {
          console.log(`[SYNC] Found ${result.success} saved address book contacts`);
          console.log(`[CONTACT-SYNC] ✅ Synced ${result.success} saved contact(s) from messaging-history`);
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
