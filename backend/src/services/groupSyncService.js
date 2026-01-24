/**
 * WhatsApp Group Synchronization Service
 * 
 * Handles automatic synchronization of WhatsApp groups when a user connects
 * via QR code. Syncs ONLY group names and metadata to the Supabase database.
 * 
 * ❌ Does NOT sync group participants or member-level details.
 * ❌ Does NOT write to group_participants table.
 */

const { supabaseAdmin } = require('../config/supabase');

/**
 * Normalize group JID to standard format
 * @param {string} groupJid - Group JID in any format
 * @returns {string} - Normalized group JID
 */
function normalizeGroupJid(groupJid) {
  if (!groupJid || typeof groupJid !== 'string') {
    return '';
  }
  
  // Ensure it ends with @g.us
  if (!groupJid.endsWith('@g.us')) {
    return groupJid.endsWith('@g') ? groupJid + '.us' : groupJid + '@g.us';
  }
  
  return groupJid.trim();
}

/**
 * Extract group metadata from Baileys group object
 * @param {object} group - Baileys group object
 * @returns {object} - Structured metadata object
 */
function extractGroupMetadata(group) {
  const metadata = {
    subject_time: group.subjectTime || null,
    subject_owner: group.subjectOwner || null,
    creation: group.creation || null,
    desc_id: group.descId || null,
    restrict: group.restrict || false,
    announce: group.announce || false,
    ephemeral_duration: group.ephemeralDuration || null,
    invite_code: group.inviteCode || null,
  };

  return metadata;
}

/**
 * Handle individual group updates (for real-time sync)
 * Syncs ONLY group names and metadata - NO participant data.
 * @param {string} agentId - Agent UUID
 * @param {Array} groups - Array of group objects from Baileys
 * @returns {Promise<{success: number, failed: number, errors: Array}>}
 */
async function handleGroupUpdate(agentId, groups) {
  if (!groups || !Array.isArray(groups) || groups.length === 0) {
    return { success: 0, failed: 0, errors: [] };
  }

  const errors = [];
  let successCount = 0;
  let failedCount = 0;

  // Process groups in batches of 50
  const batchSize = 50;
  for (let i = 0; i < groups.length; i += batchSize) {
    const batch = groups.slice(i, i + batchSize);
    
    try {
      const groupsToUpsert = batch
        .map((group) => {
          try {
            const groupJid = normalizeGroupJid(group.id || group.jid);
            
            if (!groupJid || !groupJid.endsWith('@g.us')) {
              return null; // Skip invalid group JIDs
            }

            const groupName = group.subject || group.name || 'Unnamed Group';

            const groupData = {
              agent_id: agentId,
              whatsapp_group_id: groupJid,
              name: groupName,
              description: group.desc || null,
              invite_code: group.inviteCode || null,
              is_announcement: group.announce || false,
              is_restricted: group.restrict || false,
              is_important: false, // Default to false for new groups
              created_at: group.creation ? new Date(group.creation * 1000).toISOString() : null,
              subject_changed_at: group.subjectTime ? new Date(group.subjectTime * 1000).toISOString() : null,
              metadata: extractGroupMetadata(group),
              updated_at: new Date().toISOString(),
            };
            
            return groupData;
          } catch (error) {
            console.error(`[GROUP-SYNC] Error processing group:`, error);
            return null;
          }
        })
        .filter((group) => group !== null);

      if (groupsToUpsert.length === 0) {
        continue;
      }

      // Batch upsert to database
      const { data, error } = await supabaseAdmin
        .from('groups')
        .upsert(groupsToUpsert, {
          onConflict: 'agent_id,whatsapp_group_id',
          ignoreDuplicates: false,
        })
        .select();

      if (error) {
        console.error(`[GROUP-SYNC] Batch upsert error:`, error);
        errors.push({
          batch: i,
          error: error.message,
          groups: groupsToUpsert.length,
        });
        failedCount += groupsToUpsert.length;
      } else {
        successCount += groupsToUpsert.length;
        console.log(`[GROUP-SYNC] ✅ Synced batch ${Math.floor(i / batchSize) + 1}: ${groupsToUpsert.length} groups`);
      }
    } catch (error) {
      console.error(`[GROUP-SYNC] Error processing batch:`, error);
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
 * Main sync function - Fetch groups via groupFetchAllParticipating on connection open
 * CRITICAL: Do not rely on chat history for group names
 * Syncs ONLY group names and metadata - NO participant data.
 * @param {string} agentId - Agent UUID
 * @param {object} sock - Baileys WASocket instance
 * @returns {Promise<{success: number, failed: number, total: number, errors: Array}>}
 */
async function syncGroupsForAgent(agentId, sock) {
  if (!sock || !agentId) {
    throw new Error('Invalid parameters: sock and agentId are required');
  }

  console.log(`[GROUP-SYNC] 🔄 Group sync initialized for agent ${agentId.substring(0, 8)}...`);

  try {
    if (!sock.user) {
      console.warn(`[GROUP-SYNC] ⚠️ Socket not connected, skipping sync`);
      return {
        success: 0,
        failed: 0,
        total: 0,
        errors: [{ error: 'Socket not connected' }],
      };
    }

    // CRITICAL: Fetch groups via groupFetchAllParticipating (not from chat history)
    console.log(`[GROUP-SYNC] 📥 Fetching active groups via groupFetchAllParticipating()...`);
    
    try {
      const groups = await sock.groupFetchAllParticipating();
      
      if (!groups || typeof groups !== 'object') {
        console.log(`[GROUP-SYNC] ⚠️ No groups returned from groupFetchAllParticipating`);
        return {
          success: 0,
          failed: 0,
          total: 0,
          errors: [],
        };
      }
      
      // Convert to array (handles Map, Object, Array)
      let groupsArray = [];
      if (groups instanceof Map) {
        groupsArray = Array.from(groups.values());
      } else if (Array.isArray(groups)) {
        groupsArray = groups;
      } else if (typeof groups === 'object') {
        groupsArray = Object.values(groups);
      }
      
      console.log(`[GROUP-SYNC] 📥 Retrieved ${groupsArray.length} active groups from groupFetchAllParticipating()`);
      
      // Map group id to subject (name)
      const groupsWithNames = groupsArray.map(group => ({
        id: group.id || group.jid,
        subject: group.subject || group.name || 'Unnamed Group',
        ...group
      }));
      
      const result = await handleGroupUpdate(agentId, groupsWithNames);
      
      if (result.success > 0) {
        console.log(`[SYNC] Found ${result.success} active groups`);
        console.log(`[GROUP-SYNC] ✅ Synced ${result.success} active groups to database`);
      }
      
      return {
        success: result.success,
        failed: result.failed,
        total: groupsArray.length,
        errors: result.errors,
      };
    } catch (fetchError) {
      console.error(`[GROUP-SYNC] ❌ Error fetching groups:`, fetchError);
      return {
        success: 0,
        failed: 0,
        total: 0,
        errors: [{ error: fetchError.message }],
      };
    }
  } catch (error) {
    console.error(`[GROUP-SYNC] ❌ Sync initialization failed:`, error);
    return {
      success: 0,
      failed: 0,
      total: 0,
      errors: [{ error: error.message }],
    };
  }
}

/**
 * Setup real-time group update listeners
 * Syncs ONLY group name/metadata changes - ignores participant changes.
 * @param {string} agentId - Agent UUID
 * @param {object} sock - Baileys WASocket instance
 */
function setupGroupUpdateListeners(agentId, sock) {
  if (!sock || !sock.ev) {
    console.warn(`[GROUP-SYNC] ⚠️ Socket events not available for group listeners`);
    return;
  }

  console.log(`[GROUP-SYNC] 🎧 Setting up real-time group update listeners for agent ${agentId.substring(0, 8)}...`);

  // Listen for groups.set - MAIN event that sends ALL groups
  sock.ev.on('groups.set', async ({ groups }) => {
    try {
      if (!groups || groups.length === 0) {
        return;
      }

      const groupArray = Array.isArray(groups) 
        ? groups 
        : groups instanceof Set 
          ? Array.from(groups)
          : groups instanceof Map
            ? Array.from(groups.values())
            : Object.values(groups);

      console.log(`[GROUP-SYNC] 📥 Received groups.set event: ${groupArray.length} group(s)`);
      console.log(`[GROUP-SYNC] 🔄 Syncing all groups to database...`);

      const result = await handleGroupUpdate(agentId, groupArray);

      if (result.success > 0) {
        console.log(`[GROUP-SYNC] ✅ Initial sync complete: ${result.success}/${groupArray.length} groups synced`);
      }

      if (result.failed > 0) {
        console.warn(`[GROUP-SYNC] ⚠️ Failed to sync ${result.failed} group(s)`);
      }
    } catch (error) {
      console.error(`[GROUP-SYNC] ❌ Error handling groups.set:`, error);
    }
  });

  // Listen for group updates
  sock.ev.on('groups.update', async (updates) => {
    try {
      if (!updates || (Array.isArray(updates) && updates.length === 0)) {
        return;
      }

      const updateArray = Array.isArray(updates) ? updates : [updates];
      
      console.log(`[GROUP-SYNC] 📥 Received ${updateArray.length} group update(s)`);
      
      const result = await handleGroupUpdate(agentId, updateArray);
      
      if (result.success > 0) {
        console.log(`[GROUP-SYNC] ✅ Updated ${result.success} group(s) in real-time`);
      }
    } catch (error) {
      console.error(`[GROUP-SYNC] ❌ Error handling group update:`, error);
    }
  });

  // Listen for new groups
  sock.ev.on('groups.upsert', async (groups) => {
    try {
      if (!groups || (Array.isArray(groups) && groups.length === 0)) {
        return;
      }

      const groupArray = Array.isArray(groups) ? groups : [groups];
      
      console.log(`[GROUP-SYNC] 📥 Received ${groupArray.length} new/updated group(s)`);
      
      const result = await handleGroupUpdate(agentId, groupArray);
      
      if (result.success > 0) {
        console.log(`[GROUP-SYNC] ✅ Upserted ${result.success} group(s) in real-time`);
      }
    } catch (error) {
      console.error(`[GROUP-SYNC] ❌ Error handling group upsert:`, error);
    }
  });

  console.log(`[GROUP-SYNC] ✅ Group update listeners active`);
}

module.exports = {
  normalizeGroupJid,
  extractGroupMetadata,
  handleGroupUpdate,
  syncGroupsForAgent,
  setupGroupUpdateListeners,
};
