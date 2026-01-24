# Baileys Library: Groups and Contacts Integration Analysis

## Executive Summary

This document provides a comprehensive analysis and recommendations for implementing group message synchronization, group name management, and contact/group selection functionality in the WhatsApp AI Assistant dashboard using the Baileys library.

---

## Table of Contents

1. [Current Implementation Overview](#current-implementation-overview)
2. [Baileys Groups API Analysis](#baileys-groups-api-analysis)
3. [Database Schema Recommendations](#database-schema-recommendations)
4. [Backend Implementation Strategy](#backend-implementation-strategy)
5. [Frontend Dashboard Integration](#frontend-dashboard-integration)
6. [User Selection Interface Design](#user-selection-interface-design)
7. [Implementation Roadmap](#implementation-roadmap)

---

## 1. Current Implementation Overview

### 1.1 Existing Contact Sync

The application currently implements contact synchronization via `contactSyncService.js`:

- **Event-Based Sync**: Uses Baileys events (`contacts.set`, `contacts.update`, `contacts.upsert`)
- **Database Storage**: Contacts stored in `contacts` table with `agent_id`, `name`, `phone_number`, `metadata`
- **Real-Time Updates**: Listener-based architecture for automatic contact updates

### 1.2 Current Group Handling

**Current Status**: Groups are **explicitly skipped** in message processing:

```javascript
// From baileysService.js line 4906-4909
if (remoteJid.endsWith('@g.us')) {
  console.log('[BAILEYS] 🚫 Skipping group message from:', remoteJid);
  return false;
}
```

**Gap**: No group synchronization, storage, or management exists.

---

## 2. Baileys Groups API Analysis

### 2.1 Baileys Group Events

Baileys provides several events for group management:

#### 2.1.1 `groups.set`
- **When**: Fired when WhatsApp sends all groups (similar to `contacts.set`)
- **Timing**: Usually 10-30 seconds after connection
- **Payload**: Array or Map of group objects
- **Usage**: Initial group synchronization

```javascript
sock.ev.on('groups.set', async ({ groups }) => {
  // groups is an array or Map of group objects
  // Each group has: id, subject, participants, creation, etc.
});
```

#### 2.1.2 `groups.update`
- **When**: Fired when group metadata changes (name, description, participants)
- **Payload**: Array of updated group objects
- **Usage**: Real-time group updates

```javascript
sock.ev.on('groups.update', async (updates) => {
  // updates is an array of group update objects
});
```

#### 2.1.3 `groups.upsert`
- **When**: Fired when new groups are added or existing groups are modified
- **Payload**: Array of group objects
- **Usage**: New group detection and updates

```javascript
sock.ev.on('groups.upsert', async (groups) => {
  // groups is an array of new/updated group objects
});
```

### 2.2 Group Object Structure

A typical Baileys group object contains:

```typescript
interface BaileysGroup {
  id: string;                    // JID format: "120363123456789012@g.us"
  subject: string;               // Group name
  subjectTime?: number;          // Timestamp when name was last changed
  subjectOwner?: string;         // JID of user who changed the name
  creation?: number;             // Group creation timestamp
  desc?: string;                 // Group description
  descId?: string;               // Description ID
  restrict?: boolean;            // Restrict group settings
  announce?: boolean;            // Announcement group (only admins can message)
  size?: number;                // Number of participants
  participants: Array<{          // Group participants
    id: string;                  // Participant JID
    admin?: 'admin' | 'superadmin'; // Admin status
  }>;
  ephemeralDuration?: number;    // Disappearing messages duration
  inviteCode?: string;          // Group invite link code
}
```

### 2.3 Group Message Detection

Group messages have JIDs ending with `@g.us`:

```javascript
// Check if message is from a group
const isGroupMessage = remoteJid.endsWith('@g.us');

// Extract group ID
const groupId = remoteJid; // e.g., "120363123456789012@g.us"

// Extract group name (requires lookup from stored groups)
const groupName = await getGroupName(groupId);
```

### 2.4 Fetching Group Information

Baileys provides methods to fetch group metadata:

```javascript
// Get group metadata
const groupMetadata = await sock.groupMetadata(remoteJid);

// Get group participants
const participants = await sock.groupParticipants(remoteJid);

// Get group invite link
const inviteCode = await sock.groupInviteCode(remoteJid);
```

---

## 3. Database Schema Recommendations

### 3.1 Groups Table

Create a new `groups` table to store group information:

```sql
-- Create groups table
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  whatsapp_group_id VARCHAR(255) NOT NULL,  -- JID format: "120363123456789012@g.us"
  name VARCHAR(255) NOT NULL,                 -- Group subject/name
  description TEXT,                          -- Group description
  invite_code VARCHAR(100),                   -- Group invite link code
  participant_count INTEGER DEFAULT 0,        -- Number of participants
  is_announcement BOOLEAN DEFAULT false,     -- Announcement group flag
  is_restricted BOOLEAN DEFAULT false,        -- Restricted group flag
  created_at TIMESTAMP WITH TIME ZONE,        -- Group creation time (from WhatsApp)
  subject_changed_at TIMESTAMP WITH TIME ZONE, -- Last time subject was changed
  metadata JSONB DEFAULT '{}'::jsonb,        -- Additional group metadata
  is_important BOOLEAN DEFAULT false,        -- User-selected important flag
  created_at_db TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_groups_agent_id ON groups(agent_id);
CREATE INDEX IF NOT EXISTS idx_groups_whatsapp_id ON groups(whatsapp_group_id);
CREATE INDEX IF NOT EXISTS idx_groups_important ON groups(agent_id, is_important) WHERE is_important = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_agent_whatsapp ON groups(agent_id, whatsapp_group_id);

-- Enable RLS
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their agent groups"
  ON groups FOR SELECT
  USING (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update their agent groups"
  ON groups FOR UPDATE
  USING (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ));
```

### 3.2 Group Participants Table

Store group participants separately for better querying:

```sql
-- Create group_participants table
CREATE TABLE IF NOT EXISTS group_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  whatsapp_jid VARCHAR(255) NOT NULL,        -- Participant JID
  is_admin BOOLEAN DEFAULT false,            -- Admin status
  is_super_admin BOOLEAN DEFAULT false,       -- Super admin status
  joined_at TIMESTAMP WITH TIME ZONE,         -- When participant joined
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_group_participants_group_id ON group_participants(group_id);
CREATE INDEX IF NOT EXISTS idx_group_participants_jid ON group_participants(whatsapp_jid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_participants_unique ON group_participants(group_id, whatsapp_jid);
```

### 3.3 Agent-Group Selection Table (Optional)

For many-to-many relationship if agents can be assigned to multiple groups:

```sql
-- Create agent_group_selections table (if needed)
CREATE TABLE IF NOT EXISTS agent_group_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  is_important BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0,                -- For sorting/ordering
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_group_selections_agent ON agent_group_selections(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_group_selections_group ON agent_group_selections(group_id);
```

### 3.4 Update Message Log Table

Add group support to existing message log:

```sql
-- Add group_id column to message_log (if not exists)
ALTER TABLE message_log 
ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_group_message BOOLEAN DEFAULT false;

-- Create index for group messages
CREATE INDEX IF NOT EXISTS idx_message_log_group_id ON message_log(group_id) WHERE is_group_message = true;
```

---

## 4. Backend Implementation Strategy

### 4.1 Create Group Sync Service

Create `backend/src/services/groupSyncService.js`:

```javascript
/**
 * WhatsApp Group Synchronization Service
 * 
 * Handles automatic synchronization of WhatsApp groups when a user connects
 * via QR code. Syncs groups from Baileys to the Supabase database.
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
            const participantCount = group.participants?.length || group.size || 0;

            const groupData = {
              agent_id: agentId,
              whatsapp_group_id: groupJid,
              name: groupName,
              description: group.desc || null,
              invite_code: group.inviteCode || null,
              participant_count: participantCount,
              is_announcement: group.announce || false,
              is_restricted: group.restrict || false,
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
        
        // Sync participants for each group
        for (const group of batch) {
          if (group.participants && Array.isArray(group.participants)) {
            await syncGroupParticipants(agentId, group.id || group.jid, group.participants)
              .catch(err => console.error(`[GROUP-SYNC] Error syncing participants:`, err));
          }
        }
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
 * Sync group participants
 * @param {string} agentId - Agent UUID
 * @param {string} groupJid - Group JID
 * @param {Array} participants - Array of participant objects
 */
async function syncGroupParticipants(agentId, groupJid, participants) {
  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return;
  }

  // First, get the group ID from database
  const { data: groupData, error: groupError } = await supabaseAdmin
    .from('groups')
    .select('id')
    .eq('agent_id', agentId)
    .eq('whatsapp_group_id', normalizeGroupJid(groupJid))
    .single();

  if (groupError || !groupData) {
    console.error(`[GROUP-SYNC] Group not found for participants sync:`, groupJid);
    return;
  }

  const groupId = groupData.id;

  // Prepare participants data
  const participantsToUpsert = participants.map((participant) => {
    const jid = participant.id || participant.jid;
    return {
      group_id: groupId,
      whatsapp_jid: jid,
      is_admin: participant.admin === 'admin' || participant.admin === 'superadmin',
      is_super_admin: participant.admin === 'superadmin',
      updated_at: new Date().toISOString(),
    };
  });

  // Upsert participants
  const { error } = await supabaseAdmin
    .from('group_participants')
    .upsert(participantsToUpsert, {
      onConflict: 'group_id,whatsapp_jid',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error(`[GROUP-SYNC] Error syncing participants:`, error);
  } else {
    console.log(`[GROUP-SYNC] ✅ Synced ${participantsToUpsert.length} participants for group ${groupJid}`);
  }
}

/**
 * Main sync function - Similar to contact sync
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

    console.log(`[GROUP-SYNC] ✅ Connection verified - waiting for groups.set event (usually 10-30s after connection)`);
    console.log(`[GROUP-SYNC] ℹ️ Event listeners are active - groups will sync automatically when WhatsApp sends them`);
    
    return {
      success: 0,
      failed: 0,
      total: 0,
      errors: [],
      note: 'Groups will be synced automatically via groups.set event (usually 10-30s after connection)',
    };
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
  syncGroupParticipants,
};
```

### 4.2 Update Baileys Service

Modify `backend/src/services/baileysService.js` to:

1. **Import group sync service**:
```javascript
const {
  syncGroupsForAgent,
  setupGroupUpdateListeners,
} = require('./groupSyncService');
```

2. **Enable group message processing** (remove the skip logic):
```javascript
// REMOVE or MODIFY this section (around line 4906):
// OLD:
if (remoteJid.endsWith('@g.us')) {
  console.log('[BAILEYS] 🚫 Skipping group message from:', remoteJid);
  return false;
}

// NEW: Process group messages if agent is configured to handle them
if (remoteJid.endsWith('@g.us')) {
  // Check if agent should handle this group
  const shouldHandleGroup = await checkIfAgentHandlesGroup(agentId, remoteJid);
  if (!shouldHandleGroup) {
    console.log('[BAILEYS] 🚫 Skipping group message - not in important groups:', remoteJid);
    return false;
  }
  // Continue processing group message...
}
```

3. **Initialize group sync on connection** (around line 4215):
```javascript
// After contact sync setup
setupGroupUpdateListeners(agentId, sock);
syncGroupsForAgent(agentId, sock)
  .then((result) => {
    if (result.total > 0) {
      console.log(`[BAILEYS] ✅ Initial group sync: ${result.success}/${result.total} groups synced`);
    } else {
      console.log(`[BAILEYS] ℹ️ Groups will be synced via real-time events as they load`);
    }
  })
  .catch((syncError) => {
    console.error(`[BAILEYS] ⚠️ Group sync error (non-critical):`, syncError.message);
  });
```

### 4.3 Create API Endpoints

Create `backend/src/routes/groups.js`:

```javascript
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

/**
 * GET /api/groups/:agentId
 * Get all groups for an agent
 */
router.get('/:agentId', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    // Verify agent belongs to user
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (agentError || !agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Get groups
    const { data: groups, error } = await supabaseAdmin
      .from('groups')
      .select('*')
      .eq('agent_id', agentId)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    res.json(groups || []);
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/groups/:groupId/important
 * Mark/unmark group as important
 */
router.patch('/:groupId/important', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { is_important } = req.body;
    const userId = req.user.id;

    // Verify group belongs to user's agent
    const { data: group, error: groupError } = await supabaseAdmin
      .from('groups')
      .select('agent_id, agents!inner(user_id)')
      .eq('id', groupId)
      .single();

    if (groupError || !group || group.agents.user_id !== userId) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Update importance flag
    const { data, error } = await supabaseAdmin
      .from('groups')
      .update({ is_important: is_important === true })
      .eq('id', groupId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error('Update group importance error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/contacts/:agentId
 * Get all contacts for an agent (with importance flag)
 */
router.get('/contacts/:agentId', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    // Verify agent belongs to user
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (agentError || !agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Get contacts (add is_important column if it doesn't exist)
    const { data: contacts, error } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('agent_id', agentId)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    res.json(contacts || []);
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/contacts/:contactId/important
 * Mark/unmark contact as important
 */
router.patch('/contacts/:contactId/important', authMiddleware, async (req, res) => {
  try {
    const { contactId } = req.params;
    const { is_important } = req.body;
    const userId = req.user.id;

    // Verify contact belongs to user's agent
    const { data: contact, error: contactError } = await supabaseAdmin
      .from('contacts')
      .select('agent_id, agents!inner(user_id)')
      .eq('id', contactId)
      .single();

    if (contactError || !contact || contact.agents.user_id !== userId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Update importance flag (add is_important column if it doesn't exist)
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .update({ is_important: is_important === true })
      .eq('id', contactId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error('Update contact importance error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

### 4.4 Update Contacts Table Schema

Add `is_important` column to contacts table:

```sql
-- Add is_important column to contacts table
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS is_important BOOLEAN DEFAULT false;

-- Create index for important contacts
CREATE INDEX IF NOT EXISTS idx_contacts_important ON contacts(agent_id, is_important) WHERE is_important = true;
```

---

## 5. Frontend Dashboard Integration

### 5.1 Create Groups API Hook

Create `frontend/src/hooks/useGroups.ts`:

```typescript
import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface Group {
  id: string;
  agent_id: string;
  whatsapp_group_id: string;
  name: string;
  description: string | null;
  invite_code: string | null;
  participant_count: number;
  is_announcement: boolean;
  is_restricted: boolean;
  is_important: boolean;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  agent_id: string;
  name: string;
  phone_number: string;
  is_important: boolean;
  created_at: string;
  updated_at: string;
}

async function fetchGroups(agentId: string): Promise<Group[]> {
  const response = await apiClient.get(`/groups/${agentId}`);
  return response.data;
}

async function fetchContacts(agentId: string): Promise<Contact[]> {
  const response = await apiClient.get(`/groups/contacts/${agentId}`);
  return response.data;
}

async function updateGroupImportance(groupId: string, isImportant: boolean): Promise<Group> {
  const response = await apiClient.patch(`/groups/${groupId}/important`, {
    is_important: isImportant,
  });
  return response.data;
}

async function updateContactImportance(contactId: string, isImportant: boolean): Promise<Contact> {
  const response = await apiClient.patch(`/groups/contacts/${contactId}/important`, {
    is_important: isImportant,
  });
  return response.data;
}

export function useGroups(
  agentId: string | null,
  options?: Omit<UseQueryOptions<Group[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: ['groups', agentId],
    queryFn: () => fetchGroups(agentId!),
    enabled: !!agentId,
    ...options,
  });
}

export function useContacts(
  agentId: string | null,
  options?: Omit<UseQueryOptions<Contact[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: ['contacts', agentId],
    queryFn: () => fetchContacts(agentId!),
    enabled: !!agentId,
    ...options,
  });
}

export function useUpdateGroupImportance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ groupId, isImportant }: { groupId: string; isImportant: boolean }) =>
      updateGroupImportance(groupId, isImportant),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['groups', data.agent_id] });
    },
  });
}

export function useUpdateContactImportance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ contactId, isImportant }: { contactId: string; isImportant: boolean }) =>
      updateContactImportance(contactId, isImportant),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', data.agent_id] });
    },
  });
}
```

### 5.2 Create Contact/Group Selection Component

Create `frontend/src/components/ContactGroupSelector.tsx`:

```typescript
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Users, 
  MessageSquare, 
  Search, 
  Star, 
  StarOff,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { useGroups, useContacts, useUpdateGroupImportance, useUpdateContactImportance } from '@/hooks/useGroups';
import { useToast } from '@/hooks/use-toast';

interface ContactGroupSelectorProps {
  agentId: string;
  onSelectionChange?: (selectedContacts: string[], selectedGroups: string[]) => void;
}

export function ContactGroupSelector({ agentId, onSelectionChange }: ContactGroupSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'contacts' | 'groups'>('contacts');
  
  const { data: groups = [], isLoading: groupsLoading } = useGroups(agentId);
  const { data: contacts = [], isLoading: contactsLoading } = useContacts(agentId);
  const updateGroupImportance = useUpdateGroupImportance();
  const updateContactImportance = useUpdateContactImportance();
  const { toast } = useToast();

  // Filter contacts and groups based on search
  const filteredContacts = useMemo(() => {
    if (!searchTerm) return contacts;
    const search = searchTerm.toLowerCase();
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(search) ||
        contact.phone_number.toLowerCase().includes(search)
    );
  }, [contacts, searchTerm]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm) return groups;
    const search = searchTerm.toLowerCase();
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(search) ||
        (group.description && group.description.toLowerCase().includes(search))
    );
  }, [groups, searchTerm]);

  // Get selected items
  const selectedContacts = useMemo(
    () => contacts.filter((c) => c.is_important).map((c) => c.id),
    [contacts]
  );
  const selectedGroups = useMemo(
    () => groups.filter((g) => g.is_important).map((g) => g.id),
    [groups]
  );

  // Notify parent of selection changes
  React.useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange(selectedContacts, selectedGroups);
    }
  }, [selectedContacts, selectedGroups, onSelectionChange]);

  const handleToggleContact = async (contactId: string, currentValue: boolean) => {
    try {
      await updateContactImportance.mutateAsync({
        contactId,
        isImportant: !currentValue,
      });
      toast({
        title: currentValue ? 'Contact unmarked' : 'Contact marked as important',
        description: currentValue
          ? 'This contact will no longer be prioritized'
          : 'This contact will now be prioritized for AI responses',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update contact importance',
      });
    }
  };

  const handleToggleGroup = async (groupId: string, currentValue: boolean) => {
    try {
      await updateGroupImportance.mutateAsync({
        groupId,
        isImportant: !currentValue,
      });
      toast({
        title: currentValue ? 'Group unmarked' : 'Group marked as important',
        description: currentValue
          ? 'This group will no longer be prioritized'
          : 'This group will now be prioritized for AI responses',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update group importance',
      });
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Manage Contacts & Groups
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Select which contacts and groups are important for this agent to prioritize
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts or groups..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'contacts' | 'groups')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="contacts" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Contacts ({contacts.length})
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Groups ({groups.length})
            </TabsTrigger>
          </TabsList>

          {/* Contacts Tab */}
          <TabsContent value="contacts" className="space-y-2 mt-4">
            {contactsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading contacts...</div>
            ) : filteredContacts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchTerm ? 'No contacts found' : 'No contacts available'}
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground truncate">{contact.name}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {contact.phone_number}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleContact(contact.id, contact.is_important)}
                      className="ml-2"
                    >
                      {contact.is_important ? (
                        <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                      ) : (
                        <StarOff className="h-5 w-5 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Groups Tab */}
          <TabsContent value="groups" className="space-y-2 mt-4">
            {groupsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading groups...</div>
            ) : filteredGroups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchTerm ? 'No groups found' : 'No groups available'}
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredGroups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-foreground truncate">{group.name}</div>
                        {group.is_announcement && (
                          <Badge variant="secondary" className="text-xs">Announcement</Badge>
                        )}
                      </div>
                      {group.description && (
                        <div className="text-sm text-muted-foreground truncate mt-1">
                          {group.description}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        {group.participant_count} participants
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleGroup(group.id, group.is_important)}
                      className="ml-2"
                    >
                      {group.is_important ? (
                        <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                      ) : (
                        <StarOff className="h-5 w-5 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Summary */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{selectedContacts.length}</span> important
            contacts, <span className="font-medium text-foreground">{selectedGroups.length}</span>{' '}
            important groups
          </div>
          <div className="flex items-center gap-2">
            {selectedContacts.length > 0 || selectedGroups.length > 0 ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

### 5.3 Integrate into Agent Detail/Edit Page

Add the selector to agent management pages:

```typescript
// In agent detail/edit page
import { ContactGroupSelector } from '@/components/ContactGroupSelector';

// Inside component:
<ContactGroupSelector 
  agentId={agentId} 
  onSelectionChange={(contacts, groups) => {
    console.log('Selected contacts:', contacts);
    console.log('Selected groups:', groups);
    // Save selection or update agent configuration
  }}
/>
```

---

## 6. User Selection Interface Design

### 6.1 Dashboard Integration Options

#### Option A: Agent Card Expansion
- Click agent card → Expand to show contacts/groups
- Quick selection with star icons
- Inline editing

#### Option B: Dedicated Settings Page
- Navigate to agent settings page
- Full-featured selector with search, filters, bulk actions
- Better for managing many contacts/groups

#### Option C: Modal/Dialog
- Click "Manage Contacts & Groups" button on agent card
- Opens modal with full selector
- Good balance of accessibility and space

**Recommendation**: Start with **Option C (Modal)** for MVP, then add **Option B** for advanced management.

### 6.2 UI/UX Recommendations

1. **Visual Indicators**:
   - ⭐ Star icon for important items (filled = important, outline = not important)
   - Badge showing count of important items
   - Color coding: Important items highlighted

2. **Search & Filter**:
   - Real-time search across names, phone numbers, descriptions
   - Filter by: Important only, Announcement groups, etc.
   - Sort by: Name, Date added, Participant count

3. **Bulk Actions**:
   - "Select All Important"
   - "Clear All Selections"
   - "Mark as Important" / "Unmark as Important"

4. **Statistics**:
   - Show total contacts/groups
   - Show important count
   - Show last sync time

5. **Empty States**:
   - "No contacts/groups yet" message
   - "Connect WhatsApp to sync" CTA
   - Loading skeletons

---

## 7. Implementation Roadmap

### Phase 1: Database & Backend Foundation (Week 1)
- [ ] Create `groups` table migration
- [ ] Create `group_participants` table migration
- [ ] Add `is_important` column to `contacts` table
- [ ] Create `groupSyncService.js`
- [ ] Create API routes for groups and contacts
- [ ] Update Baileys service to enable group sync

### Phase 2: Group Message Processing (Week 2)
- [ ] Modify message processing to handle group messages
- [ ] Add group message filtering based on `is_important` flag
- [ ] Update message log to include group information
- [ ] Test group message flow end-to-end

### Phase 3: Frontend Integration (Week 3)
- [ ] Create `useGroups` hook
- [ ] Create `ContactGroupSelector` component
- [ ] Integrate into agent management pages
- [ ] Add UI for viewing groups in dashboard

### Phase 4: User Selection Interface (Week 4)
- [ ] Implement selection UI (modal/dialog)
- [ ] Add search and filtering
- [ ] Add bulk actions
- [ ] Add statistics and empty states
- [ ] Polish UI/UX

### Phase 5: Testing & Optimization (Week 5)
- [ ] End-to-end testing
- [ ] Performance optimization (pagination, lazy loading)
- [ ] Error handling and edge cases
- [ ] Documentation updates

---

## 8. Key Considerations

### 8.1 Performance
- **Pagination**: For agents with many contacts/groups, implement pagination
- **Lazy Loading**: Load contacts/groups on demand
- **Caching**: Cache group metadata to reduce API calls
- **Batch Updates**: Use batch operations for bulk importance updates

### 8.2 Security
- **RLS Policies**: Ensure proper Row Level Security on all tables
- **Agent Ownership**: Verify agent belongs to user before operations
- **Input Validation**: Validate all inputs (JIDs, names, etc.)

### 8.3 Scalability
- **Indexes**: Ensure proper database indexes for queries
- **Architecture**: Consider separate service for group sync if volume is high
- **Rate Limiting**: Implement rate limiting on API endpoints

### 8.4 User Experience
- **Real-Time Updates**: Use WebSocket/SSE for real-time sync status
- **Feedback**: Show clear feedback on selection changes
- **Error Messages**: Provide helpful error messages
- **Loading States**: Show loading indicators during operations

---

## 9. Example Usage Flow

### 9.1 User Connects WhatsApp
1. User scans QR code
2. Baileys connects and fires `groups.set` event
3. `groupSyncService` syncs all groups to database
4. Groups appear in dashboard after sync completes

### 9.2 User Selects Important Groups
1. User navigates to agent settings
2. Opens "Manage Contacts & Groups" modal
3. Searches for specific group
4. Clicks star icon to mark as important
5. Selection saved to database
6. Agent now processes messages from this group

### 9.3 Agent Processes Group Message
1. Group message arrives via Baileys
2. System checks if group `is_important = true`
3. If important, process message normally
4. If not important, skip (or log for analytics)

---

## 10. Conclusion

This implementation provides a complete solution for:
- ✅ Syncing WhatsApp groups using Baileys events
- ✅ Storing groups and participants in database
- ✅ Displaying groups and contacts in dashboard
- ✅ Allowing users to select important contacts/groups
- ✅ Filtering agent responses based on selections

The architecture follows existing patterns (contact sync) and integrates seamlessly with the current codebase. The phased approach allows for incremental development and testing.

---

## Appendix: Baileys Group API Reference

### Key Baileys Functions for Groups

```javascript
// Get group metadata
const metadata = await sock.groupMetadata(groupJid);

// Get group participants
const participants = await sock.groupParticipants(groupJid);

// Get group invite code
const inviteCode = await sock.groupInviteCode(groupJid);

// Update group subject
await sock.groupUpdateSubject(groupJid, 'New Group Name');

// Update group description
await sock.groupUpdateDescription(groupJid, 'New Description');

// Leave group
await sock.groupLeave(groupJid);
```

### Group Event Payload Examples

```javascript
// groups.set event
{
  groups: [
    {
      id: "120363123456789012@g.us",
      subject: "My Group",
      participants: [
        { id: "1234567890@s.whatsapp.net", admin: "admin" },
        { id: "0987654321@s.whatsapp.net" }
      ],
      creation: 1234567890,
      subjectTime: 1234567890,
      desc: "Group description"
    }
  ]
}
```

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Author**: AI Assistant  
**Status**: Ready for Implementation
