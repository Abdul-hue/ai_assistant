/**
 * WhatsApp Data API Routes
 * 
 * Provides endpoints to fetch WhatsApp contacts and groups
 * Contacts: Fetched from database (synced via contactSyncService)
 * Groups: Fetched from Baileys connection (live data)
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { activeSessions } = require('../services/baileysService');
const { listAllNames } = require('../services/listAllNames');

const router = express.Router();

/**
 * GET /api/whatsapp/contacts/:agentId
 * Get WhatsApp contacts from database (synced contacts)
 * Returns contacts that have been synced to the database from WhatsApp
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

    console.log('[WHATSAPP-API] Fetching WhatsApp contacts from database...');
    
    // Fetch contacts from database (these are synced from WhatsApp via contactSyncService)
    // Sort by is_important first, then updated_at DESC
    // Include metadata to filter out groups
    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from('contacts')
      .select('id, name, phone_number, is_important, updated_at, created_at, metadata')
      .eq('agent_id', agentId)
      .order('is_important', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false });

    if (contactsError) {
      console.error('[WHATSAPP-API] Error fetching contacts from database:', contactsError);
      return res.status(500).json({ error: 'Failed to fetch contacts' });
    }

    if (!contacts || contacts.length === 0) {
      console.log('[WHATSAPP-API] No contacts found in database for this agent');
      return res.json([]);
    }

    // Filter out any groups that may have been saved as contacts previously
    // Groups have JIDs ending with @g.us, which might be stored in metadata.whatsapp_id
    const individualContacts = contacts.filter(contact => {
      // Check metadata for group JID
      if (contact.metadata && typeof contact.metadata === 'object') {
        const whatsappId = contact.metadata.whatsapp_id || '';
        if (whatsappId.endsWith('@g.us')) {
          return false; // This is a group, exclude it
        }
      }
      return true; // Keep individual contacts
    });

    console.log(`[WHATSAPP-API] Filtered ${contacts.length - individualContacts.length} groups from contacts`);

    // Format contacts to match expected frontend structure
    // DO NOT expose JID to frontend
    const whatsappContacts = individualContacts.map(contact => ({
      id: contact.id,
      name: contact.name || 'Unknown',
      phone: contact.phone_number,
      is_important: contact.is_important || false,
      updated_at: contact.updated_at,
    }));

    console.log(`[WHATSAPP-API] Returning ${whatsappContacts.length} contacts from database`);
    res.json(whatsappContacts);
  } catch (error) {
    console.error('[WHATSAPP-API] Get contacts error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/whatsapp/groups/:agentId
 * Get WhatsApp groups from database (synced groups)
 * Returns groups with is_important flag, sorted by importance then updated_at
 */
router.get('/groups/:agentId', authMiddleware, async (req, res) => {
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

    console.log('[WHATSAPP-API] Fetching WhatsApp groups from database...');
    
    // Fetch groups from database (synced via groupSyncService)
    // Sort by is_important first, then updated_at DESC
    const { data: groups, error: groupsError } = await supabaseAdmin
      .from('groups')
      .select('id, whatsapp_group_id, name, is_important, updated_at, created_at')
      .eq('agent_id', agentId)
      .order('is_important', { ascending: false })
      .order('updated_at', { ascending: false });

    if (groupsError) {
      console.error('[WHATSAPP-API] Error fetching groups from database:', groupsError);
      return res.status(500).json({ error: 'Failed to fetch groups' });
    }

    if (!groups || groups.length === 0) {
      console.log('[WHATSAPP-API] No groups found in database for this agent');
      return res.json([]);
    }

    // Format groups - DO NOT expose JID to frontend
    const formattedGroups = groups.map(group => ({
      id: group.id,
      groupName: group.name || 'Unnamed Group',
      is_important: group.is_important || false,
      updated_at: group.updated_at,
    }));

    console.log(`[WHATSAPP-API] Returning ${formattedGroups.length} groups from database`);
    res.json(formattedGroups);

  } catch (error) {
    console.error('[WHATSAPP-API] Get groups error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/whatsapp/contacts/:contactId/important
 * Toggle important status for a contact
 */
router.patch('/contacts/:contactId/important', authMiddleware, async (req, res) => {
  try {
    const { contactId } = req.params;
    const { is_important } = req.body;
    const userId = req.user.id;

    if (typeof is_important !== 'boolean') {
      return res.status(400).json({ error: 'is_important must be a boolean' });
    }

    // Verify contact belongs to user's agent
    const { data: contact, error: contactError } = await supabaseAdmin
      .from('contacts')
      .select('id, agent_id, name')
      .eq('id', contactId)
      .single();

    if (contactError || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Verify agent belongs to user
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', contact.agent_id)
      .eq('user_id', userId)
      .single();

    if (agentError || !agent) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update is_important and updated_at
    const { data: updatedContact, error: updateError } = await supabaseAdmin
      .from('contacts')
      .update({ 
        is_important: is_important,
        updated_at: new Date().toISOString()
      })
      .eq('id', contactId)
      .select('id, name, phone_number, is_important, updated_at')
      .single();

    if (updateError) {
      console.error('[WHATSAPP-API] Error updating contact importance:', updateError);
      return res.status(500).json({ error: 'Failed to update contact' });
    }

    console.log(`[WHATSAPP-API] Updated contact ${contactId} is_important to ${is_important}`);
    res.json(updatedContact);

  } catch (error) {
    console.error('[WHATSAPP-API] Toggle contact important error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/whatsapp/groups/:groupId/important
 * Toggle important status for a group
 */
router.patch('/groups/:groupId/important', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { is_important } = req.body;
    const userId = req.user.id;

    if (typeof is_important !== 'boolean') {
      return res.status(400).json({ error: 'is_important must be a boolean' });
    }

    // Verify group belongs to user's agent
    const { data: group, error: groupError } = await supabaseAdmin
      .from('groups')
      .select('id, agent_id, name')
      .eq('id', groupId)
      .single();

    if (groupError || !group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Verify agent belongs to user
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', group.agent_id)
      .eq('user_id', userId)
      .single();

    if (agentError || !agent) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update is_important and updated_at
    const { data: updatedGroup, error: updateError } = await supabaseAdmin
      .from('groups')
      .update({ 
        is_important: is_important,
        updated_at: new Date().toISOString()
      })
      .eq('id', groupId)
      .select('id, name, is_important, updated_at')
      .single();

    if (updateError) {
      console.error('[WHATSAPP-API] Error updating group importance:', updateError);
      return res.status(500).json({ error: 'Failed to update group' });
    }

    console.log(`[WHATSAPP-API] Updated group ${groupId} is_important to ${is_important}`);
    res.json(updatedGroup);

  } catch (error) {
    console.error('[WHATSAPP-API] Toggle group important error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DEBUG ENDPOINT: Check what's in the contact store
 */
router.get('/debug/contacts/:agentId', authMiddleware, async (req, res) => {
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

    const session = activeSessions.get(agentId);
    
    if (!session?.socket) {
      return res.json({ error: 'Not connected' });
    }
    
    const sock = session.socket;
    
    // Check store
    const storeInfo = {
      hasStore: !!sock.store,
      hasContacts: !!sock.store?.contacts,
      contactsType: sock.store?.contacts?.constructor?.name,
      contactsSize: sock.store?.contacts instanceof Map ? sock.store.contacts.size : 
                    Array.isArray(sock.store?.contacts) ? sock.store.contacts.length :
                    typeof sock.store?.contacts === 'object' ? Object.keys(sock.store.contacts).length : 0,
    };
    
    // Sample contacts
    let sampleContacts = [];
    if (sock.store?.contacts instanceof Map) {
      sampleContacts = Array.from(sock.store.contacts.values()).slice(0, 5);
    } else if (Array.isArray(sock.store?.contacts)) {
      sampleContacts = sock.store.contacts.slice(0, 5);
    } else if (typeof sock.store?.contacts === 'object') {
      sampleContacts = Object.values(sock.store.contacts).slice(0, 5);
    }
    
    res.json({
      storeInfo,
      sampleContacts: sampleContacts.map(c => ({
        jid: c.id || c.jid,
        name: c.name,
        verifiedName: c.verifiedName,
        notify: c.notify,
        pushName: c.pushName,
      })),
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

module.exports = router;
