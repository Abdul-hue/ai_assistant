const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabase } = require('../database');

const router = express.Router();

/**
 * GET /api/dashboard/stats
 * Get dashboard statistics for the current user
 * Returns: total agents, active agents (last 24h), total messages
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized - user ID not found' });
    }

    // Query 1: Total Agents - Count from agents table (not message_log)
    const { count: totalAgents, error: totalAgentsError } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (totalAgentsError) {
      console.error('[DASHBOARD] Error counting total agents:', totalAgentsError);
    }

    // Query 2: Active Agents - Count from agents table where is_active = true
    // CRITICAL: Only count agents that exist in the agents table (not from message_log)
    // This ensures deleted agents don't show up in the count
    const { count: activeAgentsByStatus, error: activeAgentsError } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true);

    if (activeAgentsError) {
      console.error('[DASHBOARD] Error counting active agents by status:', activeAgentsError);
    }

    // Also count agents with messages in last 24 hours, but only if they exist in agents table
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Get distinct agent IDs from messages in last 24h
    const { data: distinctActiveAgents, error: distinctActiveError } = await supabase
      .from('message_log')
      .select('agent_id')
      .eq('user_id', userId)
      .not('agent_id', 'is', null)
      .gte('received_at', twentyFourHoursAgo.toISOString());

    let activeAgentsFromMessages = 0;
    if (!distinctActiveError && distinctActiveAgents && distinctActiveAgents.length > 0) {
      const uniqueActiveAgentIds = new Set(distinctActiveAgents.map(a => a.agent_id).filter(Boolean));
      
      // CRITICAL: Verify these agent IDs exist in the agents table (not deleted)
      if (uniqueActiveAgentIds.size > 0) {
        const agentIdsArray = Array.from(uniqueActiveAgentIds);
        const { count: validAgentsCount } = await supabase
          .from('agents')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('id', agentIdsArray);
        
        activeAgentsFromMessages = validAgentsCount || 0;
      }
    }

    // Use the higher count (either by status or by recent messages from valid agents)
    const activeAgents = Math.max(activeAgentsByStatus || 0, activeAgentsFromMessages);

    // Query 3: Total Messages - Count all messages for user from message_log
    // CRITICAL: Only count messages that:
    // 1. Have a valid user_id matching the current user
    // 2. Have a valid agent_id (not null) - messages must belong to an agent
    // 3. Have a valid message_id (not null) - must be actual messages, not system entries
    // 4. The agent_id must belong to an agent owned by the current user (double verification)
    
    // First, get all agent IDs owned by this user
    const { data: userAgents, error: agentsError } = await supabase
      .from('agents')
      .select('id')
      .eq('user_id', userId);

    if (agentsError) {
      console.error('[DASHBOARD] Error fetching user agents for message count:', agentsError);
    }

    let totalMessages = 0;
    if (userAgents && userAgents.length > 0) {
      const agentIds = userAgents.map(a => a.id);
      
      // Count messages only for agents owned by this user
      const { count, error: totalMessagesError } = await supabase
        .from('message_log')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId) // Primary filter: user_id
        .in('agent_id', agentIds) // Secondary filter: agent must belong to user
        .not('message_id', 'is', null); // Exclude entries without message_id

      if (totalMessagesError) {
        console.error('[DASHBOARD] Error counting total messages:', totalMessagesError);
      } else {
        totalMessages = count || 0;
      }
    }

    res.json({
      total_agents: totalAgents || 0,
      active_agents: activeAgents,
      total_messages: totalMessages || 0,
    });
  } catch (error) {
    console.error('[DASHBOARD] Unexpected error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch dashboard statistics',
      message: error.message 
    });
  }
});

module.exports = router;

