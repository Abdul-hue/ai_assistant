/**
 * List All Names Service
 * 
 * Lists only saved contacts (with name/verifiedName) and active groups
 * from groupFetchAllParticipating()
 */

/**
 * List all saved contacts and active groups
 * @param {object} sock - Baileys WASocket instance
 * @returns {Promise<{contacts: Array, groups: Array}>}
 */
async function listAllNames(sock) {
  const result = {
    contacts: [],
    groups: []
  };
  
  try {
    // CONTACTS: Only output contacts where (contact.name || contact.verifiedName) exists
    if (sock.store?.contacts) {
      try {
        console.log('[LIST-NAMES] Reading contacts from store...');
        // Use all() method if available, otherwise iterate
        let allContacts = [];
        if (typeof sock.store.contacts.all === 'function') {
          console.log('[LIST-NAMES] Using store.contacts.all() method');
          allContacts = await sock.store.contacts.all();
        } else if (sock.store.contacts instanceof Map) {
          console.log('[LIST-NAMES] Store is a Map, converting to array');
          allContacts = Array.from(sock.store.contacts.values());
        } else if (Array.isArray(sock.store.contacts)) {
          console.log('[LIST-NAMES] Store is an array');
          allContacts = sock.store.contacts;
        } else if (typeof sock.store.contacts === 'object') {
          console.log('[LIST-NAMES] Store is an object, converting values');
          allContacts = Object.values(sock.store.contacts);
        }
        
        console.log(`[LIST-NAMES] Found ${allContacts.length} total contacts in store`);
        
        // NEW - includes ALL individual contacts (even without saved names)
        const savedContacts = allContacts.filter(contact => {
          const jid = contact.id || contact.jid;
          if (!jid) return false;
          
          // Include ALL individual contacts (not groups or broadcasts)
          const isIndividualContact = jid.endsWith('@s.whatsapp.net') || 
                                      jid.endsWith('@c.us') || 
                                      jid.endsWith('@lid');
          
          // Log for debugging
          if (isIndividualContact) {
            const name = contact.name || contact.verifiedName || contact.notify || contact.pushName || 'NO NAME';
            console.log(`[LIST-NAMES] Contact: ${jid} → Name: ${name}`);
          }
          
          return isIndividualContact;
        });
        
        console.log(`[LIST-NAMES] Filtered to ${savedContacts.length} individual contacts`);
        
        result.contacts = savedContacts.map(contact => ({
          id: contact.id || contact.jid,
          jid: contact.id || contact.jid,
          name: getBestContactName(contact), // Use helper function
          verifiedName: contact.verifiedName,
          notify: contact.notify,
          pushName: contact.pushName,
        }));
        
        console.log(`[SYNC] Found ${result.contacts.length} saved address book contacts`);
      } catch (error) {
        console.error(`[LIST-NAMES] Error reading contacts from store:`, error.message);
        console.error(`[LIST-NAMES] Error stack:`, error.stack);
      }
    } else {
      console.log('[LIST-NAMES] ⚠️ sock.store.contacts is not available');
    }
    
    // GROUPS: Only output groups retrieved from groupFetchAllParticipating
    if (sock.user) {
      try {
        const groups = await sock.groupFetchAllParticipating();
        
        if (groups && typeof groups === 'object') {
          let groupsArray = [];
          
          if (groups instanceof Map) {
            groupsArray = Array.from(groups.values());
          } else if (Array.isArray(groups)) {
            groupsArray = groups;
          } else if (typeof groups === 'object') {
            groupsArray = Object.values(groups);
          }
          
          // Map group id to subject (name)
          result.groups = groupsArray.map(group => ({
            id: group.id || group.jid,
            name: group.subject || group.name || 'Unnamed Group',
          }));
          
          console.log(`[SYNC] Found ${result.groups.length} active groups`);
        }
      } catch (error) {
        console.error(`[LIST-NAMES] Error fetching groups:`, error.message);
      }
    }
    
    return result;
  } catch (error) {
    console.error(`[LIST-NAMES] Error listing names:`, error.message);
    return result;
  }
}

/**
 * Get best available name for a contact
 * Falls back through multiple fields to find ANY name
 */
function getBestContactName(contact) {
  if (!contact) return null;
  
  // Priority order:
  // 1. verifiedName (businesses with verified names)
  // 2. name (user-saved name in their phone)
  // 3. notify (name the contact set for themselves on WhatsApp)
  // 4. pushName (name from last message push)
  
  return contact.verifiedName || 
         contact.name || 
         contact.notify || 
         contact.pushName || 
         null;
}

module.exports = {
  listAllNames,
};
