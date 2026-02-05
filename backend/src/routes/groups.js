const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// Test endpoint to verify route is working
router.get('/test', (req, res) => {
  res.json({ message: 'Groups route is working!' });
});

/**
 * GET /api/groups/:agentId
 * Get all groups for an agent
 */
router.get('/:agentId', authMiddleware, async (req, res) => {
  console.log('[GROUPS] GET /api/groups/:agentId called', { 
    agentId: req.params.agentId, 
    path: req.path, 
    originalUrl: req.originalUrl,
    userId: req.user?.id 
  });
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    console.log('[GROUPS] Verifying agent ownership...', { agentId, userId });

    // Verify agent belongs to user
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (agentError || !agent) {
      console.log('[GROUPS] Agent not found or access denied', { agentError, agent });
      return res.status(404).json({ error: 'Agent not found' });
    }

    console.log('[GROUPS] Agent verified, fetching groups...', { agentId });

    // Get groups
    const { data: groups, error } = await supabaseAdmin
      .from('groups')
      .select('*')
      .eq('agent_id', agentId)
      .order('name', { ascending: true });

    if (error) {
      console.error('[GROUPS] Database error:', error);
      throw error;
    }

    console.log('[GROUPS] Found groups:', { count: groups?.length || 0, groups: groups?.map(g => ({ id: g.id, name: g.name })) });

    res.json(groups || []);
  } catch (error) {
    console.error('[GROUPS] Get groups error:', error);
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

    if (groupError || !group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if agent belongs to user (handle nested object structure)
    const agentUserId = group.agents?.user_id || (group.agents && Array.isArray(group.agents) ? group.agents[0]?.user_id : null);
    if (agentUserId !== userId) {
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
 * GET /api/groups/contacts/:agentId
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
 * PATCH /api/groups/contacts/:contactId/important
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

    if (contactError || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Check if agent belongs to user (handle nested object structure)
    const agentUserId = contact.agents?.user_id || (contact.agents && Array.isArray(contact.agents) ? contact.agents[0]?.user_id : null);
    if (agentUserId !== userId) {
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

/**
 * DELETE /api/groups/:groupId
 * Delete a specific group by ID
 */
router.delete('/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Verify group belongs to user's agent
    const { data: group, error: groupError } = await supabaseAdmin
      .from('groups')
      .select('id, agent_id, name, agents!inner(user_id)')
      .eq('id', groupId)
      .single();

    if (groupError || !group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if agent belongs to user
    const agentUserId = group.agents?.user_id || (group.agents && Array.isArray(group.agents) ? group.agents[0]?.user_id : null);
    if (agentUserId !== userId) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Delete the group (cascade will handle group_participants)
    const { error: deleteError } = await supabaseAdmin
      .from('groups')
      .delete()
      .eq('id', groupId)
      .eq('agent_id', group.agent_id);

    if (deleteError) {
      console.error('[GROUPS] Failed to delete group:', deleteError);
      return res.status(500).json({ error: 'Failed to delete group' });
    }

    console.log('[GROUPS] Group deleted successfully:', { groupId, groupName: group.name });
    return res.json({ 
      success: true,
      message: 'Group deleted successfully' 
    });
  } catch (error) {
    console.error('[GROUPS] Delete group error:', error);
    return res.status(500).json({ error: 'Failed to delete group' });
  }
});

/**
 * DELETE /api/groups/agent/:agentId
 * Delete all groups for an agent
 */
router.delete('/agent/:agentId', authMiddleware, async (req, res) => {
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
      return res.status(404).json({ error: 'Agent not found or unauthorized' });
    }

    // Delete all groups for this agent (cascade will handle group_participants)
    const { data: deletedGroups, error: deleteError } = await supabaseAdmin
      .from('groups')
      .delete()
      .eq('agent_id', agentId)
      .select('id');

    if (deleteError) {
      console.error('[GROUPS] Failed to delete groups:', deleteError);
      return res.status(500).json({ error: 'Failed to delete groups' });
    }

    const count = deletedGroups?.length || 0;
    console.log('[GROUPS] All groups deleted successfully:', { agentId, count });
    
    return res.json({ 
      success: true,
      message: 'All groups deleted successfully', 
      deleted_count: count 
    });
  } catch (error) {
    console.error('[GROUPS] Delete all groups error:', error);
    return res.status(500).json({ error: 'Failed to delete groups' });
  }
});

module.exports = router;
