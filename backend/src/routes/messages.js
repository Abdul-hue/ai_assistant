/**
 * Messages API Routes
 * 
 * Handles chat interface endpoints:
 * - GET /api/agents/chat-list - Get all agents with last message and unread count
 * - GET /api/agents/:agentId/messages - Get conversation history
 * - POST /api/agents/:agentId/messages - Send message to agent
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');
const { sendMessage } = require('../services/baileysService');
const webhookService = require('../services/webhookService');

/**
 * GET /api/agents/chat-list
 * Get all agents with their last message and unread count
 */
router.get('/chat-list', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized - user ID not found' });
    }

    // Get all user's agents (including avatar_url and persona)
    const { data: agents, error: agentsError } = await supabaseAdmin
      .from('agents')
      .select('id, agent_name, whatsapp_phone_number, is_active, avatar_url, persona')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (agentsError) {
      console.error('[MESSAGES] Error fetching agents:', agentsError);
      throw agentsError;
    }

    if (!agents || agents.length === 0) {
      return res.json({ success: true, agents: [] });
    }

    // For each agent, get last message and unread count
    const agentsWithInfo = await Promise.all(
      agents.map(async (agent) => {
        try {
          // Get last message
          // Use received_at (existing column) - timestamp will be populated by trigger
          const { data: lastMessageData, error: lastMessageError } = await supabaseAdmin
            .from('message_log')
            .select('*')
            .eq('agent_id', agent.id)
            .order('received_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastMessageError) {
            console.error(`[MESSAGES] Error fetching last message for agent ${agent.id}:`, lastMessageError);
          }

          // Normalize message data to match expected format
          let normalizedLastMessage = null;
          if (lastMessageData) {
            // Handle id: prefer uuid_id if id is integer, otherwise use id or message_id
            const messageId = lastMessageData.uuid_id || 
                              (typeof lastMessageData.id === 'string' ? lastMessageData.id : null) ||
                              lastMessageData.message_id;
            
            normalizedLastMessage = {
              id: messageId,
              agent_id: lastMessageData.agent_id,
              user_id: lastMessageData.user_id,
              message: lastMessageData.message || lastMessageData.message_text || '',
              // ✅ FIX: Respect sender_type from database (don't override if explicitly set)
              // Only use fallback if sender_type is null/undefined
              sender_type: lastMessageData.sender_type !== null && lastMessageData.sender_type !== undefined
                ? lastMessageData.sender_type
                : (lastMessageData.sender_phone ? 'contact' : 'agent'),
              is_from_me: lastMessageData.is_from_me !== undefined ? lastMessageData.is_from_me : false,
              timestamp: lastMessageData.timestamp || lastMessageData.received_at || lastMessageData.created_at,
              status: lastMessageData.status || 'delivered',
              message_type: lastMessageData.message_type || 'text',
              whatsapp_message_id: lastMessageData.whatsapp_message_id || lastMessageData.message_id,
              contact_id: lastMessageData.contact_id || null,
              read_at: lastMessageData.read_at || null,
              // ✅ NEW: Include source field for button parsing
              source: lastMessageData.source || null,
            };
          }

          // Get unread count (messages where sender_type != 'user' and read_at is null)
          const { count: unreadCount } = await supabaseAdmin
            .from('message_log')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', agent.id)
            .neq('sender_type', 'user')
            .is('read_at', null);

          return {
            id: agent.id,
            agent_name: agent.agent_name,
            whatsapp_phone_number: agent.whatsapp_phone_number,
            is_active: agent.is_active,
            avatar_url: agent.avatar_url || null,
            persona: agent.persona || null,
            lastMessage: normalizedLastMessage || undefined,
            unreadCount: unreadCount || 0,
          };
        } catch (error) {
          console.error(`[MESSAGES] Error processing agent ${agent.id}:`, error);
          // Return agent with default values on error
          return {
            id: agent.id,
            agent_name: agent.agent_name,
            whatsapp_phone_number: agent.whatsapp_phone_number,
            is_active: agent.is_active,
            avatar_url: agent.avatar_url || null,
            persona: agent.persona || null,
            lastMessage: undefined,
            unreadCount: 0,
          };
        }
      })
    );

    res.json({ success: true, agents: agentsWithInfo });
  } catch (error) {
    console.error('[MESSAGES] Error fetching chat list:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch chat list',
      message: error.message 
    });
  }
});

/**
 * GET /api/agents/:agentId/messages
 * Get conversation history for specific agent
 */
router.get('/:agentId/messages', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    const { limit = 100, before } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized - user ID not found' });
    }

    // Verify agent ownership
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (agentError) {
      console.error('[MESSAGES] Error verifying agent:', agentError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!agent) {
      return res.status(403).json({ error: 'Unauthorized - agent not found or not owned by user' });
    }

    // Build query - use received_at (existing column) - timestamp will be populated by trigger
    let query = supabaseAdmin
      .from('message_log')
      .select('*')
      .eq('agent_id', agentId)
      .order('received_at', { ascending: false })
      .limit(parseInt(limit));

    if (before) {
      // Use received_at for pagination (timestamp will be populated by trigger)
      query = query.lt('received_at', before);
    }

    const { data: messages, error: messagesError } = await query;

    if (messagesError) {
      console.error('[MESSAGES] Error fetching messages:', messagesError);
      throw messagesError;
    }

    // Normalize messages to match expected format
    const normalizedMessages = (messages || []).map(msg => {
      // Handle id: prefer uuid_id if id is integer, otherwise use id or message_id
      const messageId = msg.uuid_id || 
                        (typeof msg.id === 'string' ? msg.id : null) ||
                        msg.message_id ||
                        `temp-${msg.received_at}-${msg.message_text?.substring(0, 10)}`;
      
      return {
        id: messageId,
        agent_id: msg.agent_id,
        user_id: msg.user_id,
        contact_id: msg.contact_id || null,
        message: msg.message_text || msg.message || '',
        // ✅ FIX: Respect sender_type from database (don't override if explicitly set)
        sender_type: msg.sender_type !== null && msg.sender_type !== undefined
          ? msg.sender_type
          : (msg.sender_phone ? 'contact' : 'agent'),
        is_from_me: msg.is_from_me !== undefined ? msg.is_from_me : false,
        timestamp: msg.timestamp || msg.received_at || msg.created_at,
        status: msg.status || 'delivered',
        message_type: msg.message_type || 'text',
        whatsapp_message_id: msg.whatsapp_message_id || msg.message_id || null,
        read_at: msg.read_at || null,
        // ✅ FIX: Respect source from database (don't default to 'whatsapp' if it's 'dashboard')
        source: msg.source || null, // Include source field, don't override
      };
    });

    // Deduplicate messages by ID first
    const byIdMap = new Map();
    normalizedMessages.forEach(msg => {
      // Use ID as key, but if duplicate ID exists, prefer the one with more complete data
      if (!byIdMap.has(msg.id) || 
          (!byIdMap.get(msg.id).whatsapp_message_id && msg.whatsapp_message_id)) {
        byIdMap.set(msg.id, msg);
      }
    });
    
    // Then deduplicate by content + timestamp (in case IDs differ but content is same)
    const byContentMap = new Map();
    Array.from(byIdMap.values()).forEach(msg => {
      // Create a unique key from message content + timestamp (rounded to nearest second) + sender
      const timestamp = new Date(msg.timestamp).getTime();
      const roundedTimestamp = Math.floor(timestamp / 1000) * 1000; // Round to nearest second
      const contentKey = `${(msg.message || '').trim()}_${roundedTimestamp}_${msg.agent_id}_${msg.is_from_me ? 'user' : 'agent'}`;
      
      // Only keep the first occurrence of messages with same content and timestamp
      if (!byContentMap.has(contentKey)) {
        byContentMap.set(contentKey, msg);
      }
    });
    
    const deduplicatedMessages = Array.from(byContentMap.values());

    // Sort by timestamp (oldest first) for chat display
    const sortedMessages = deduplicatedMessages.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });

    res.json({ 
      success: true, 
      messages: sortedMessages 
    });
  } catch (error) {
    console.error('[MESSAGES] Error fetching messages:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch messages',
      message: error.message 
    });
  }
});

/**
 * POST /api/agents/:agentId/messages
 * Send message to agent
 */
router.post('/:agentId/messages', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    const { message, contact_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized - user ID not found' });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Verify agent ownership
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (agentError) {
      console.error('[MESSAGES] Error verifying agent:', agentError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!agent) {
      return res.status(403).json({ error: 'Unauthorized - agent not found or not owned by user' });
    }

    // Check if agent has WhatsApp number connected
    if (!agent.whatsapp_phone_number) {
      return res.status(400).json({ 
        error: 'Agent WhatsApp not connected',
        details: 'The agent must have a WhatsApp number connected to receive messages'
      });
    }

    // Send message directly to agent's WhatsApp number using the agent's own session
    // No need for owner number - just send directly to the agent
    const sanitizePhone = (phone) => {
      if (!phone) return null;
      return phone.replace(/[+\s-]/g, '');
    };

        const agentPhoneNumber = sanitizePhone(agent.whatsapp_phone_number); // Agent's WhatsApp number (TO)
        const sanitizedAgentPhone = agentPhoneNumber; // Keep for webhook

    // Send message directly to agent's WhatsApp number using the agent's own session
    let whatsappMessageId = null;
    try {
      // Send message using agent's own WhatsApp session TO the agent's WhatsApp number
      await sendMessage(agentId, agentPhoneNumber, message.trim());
      
      // Generate WhatsApp message ID for tracking
      whatsappMessageId = `wa-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      console.log('[MESSAGES] ✅ WhatsApp message sent via Baileys', {
        agentId: agentId,
        agentName: agent.agent_name,
        toPhone: agentPhoneNumber,
        messageLength: message.length
      });
    } catch (whatsappError) {
      console.error('[MESSAGES] ❌ Failed to send WhatsApp message:', whatsappError);
      
      // Check if it's a connection error
      if (whatsappError.message && whatsappError.message.includes('not connected')) {
        return res.status(503).json({ 
          success: false,
          error: 'Agent WhatsApp not connected',
          details: `The agent's WhatsApp (${agent.whatsapp_phone_number}) is not connected. Please connect the agent first.`,
          whatsappError: true
        });
      }
      
      // If WhatsApp send fails, return error
      return res.status(500).json({ 
        success: false,
        error: 'Failed to send WhatsApp message',
        details: whatsappError.message,
        whatsappError: true
      });
    }

    // Insert user message into database
    const now = new Date().toISOString();
    const userMessageId = whatsappMessageId || `user-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

    // Use agent's phone number for conversation_id and sender_phone
    // Since we're sending directly to the agent, the conversation is with the agent
    // Store message with agent's phone number as sender_phone
    // Since we're using the agent's session to send, the message comes from the agent's number
    const insertPayload = {
      message_id: userMessageId,
      conversation_id: `${agentPhoneNumber}@s.whatsapp.net`, // Conversation with agent's number
      sender_phone: agentPhoneNumber, // Agent's phone number (sender - using agent's session)
      agent_id: agentId,
      user_id: userId,
      message_text: message.trim(),
      received_at: now,
      created_at: now,
      message_type: 'text',
      source: 'dashboard', // CRITICAL: Mark as dashboard origin
    };
    
    // Check for duplicate message before inserting
    // Prevent duplicate inserts based on message content, timestamp, and agent_id
    // Use a wider time window (10 seconds) to catch duplicates
    const timeWindow = 10000; // 10 seconds
    const trimmedMessage = message.trim();
    
    // Check for duplicates - try multiple approaches since schema might vary
    let duplicateCheck = await supabaseAdmin
      .from('message_log')
      .select('id, message_text, received_at, sender_type, is_from_me')
      .eq('agent_id', agentId)
      .eq('user_id', userId)
      .eq('message_text', trimmedMessage)
      .gte('received_at', new Date(new Date(now).getTime() - timeWindow).toISOString())
      .lte('received_at', new Date(new Date(now).getTime() + timeWindow).toISOString())
      .order('received_at', { ascending: false })
      .limit(5); // Get multiple to check all possibilities
    
    // Filter results to find user messages (either by sender_type or is_from_me)
    const duplicateMessages = (duplicateCheck.data || []).filter(msg => {
      const isUserMessage = msg.sender_type === 'user' || 
                           msg.is_from_me === true ||
                           (msg.sender_type === null && msg.is_from_me === null); // Fallback for legacy
      return isUserMessage;
    });

    if (duplicateMessages.length > 0) {
      const existingMessageId = duplicateMessages[0].id;
      console.log('[MESSAGES] ⚠️ Duplicate message detected, returning existing message:', {
        existingId: existingMessageId,
        messageText: trimmedMessage.substring(0, 50),
        foundDuplicates: duplicateMessages.length
      });
      // Return existing message instead of inserting duplicate
      const { data: existingMessage } = await supabaseAdmin
        .from('message_log')
        .select('*')
        .eq('id', existingMessageId)
        .single();
      
      if (existingMessage) {
        // Normalize and return existing message
        const messageId = existingMessage.uuid_id || 
                          (typeof existingMessage.id === 'string' ? existingMessage.id : null) ||
                          existingMessage.message_id;
        
        return res.json({ 
          success: true, 
          message: {
            id: messageId,
            agent_id: existingMessage.agent_id,
            user_id: existingMessage.user_id,
            contact_id: existingMessage.contact_id || null,
            message: existingMessage.message || existingMessage.message_text || '',
            sender_type: existingMessage.sender_type || 'user',
            is_from_me: existingMessage.is_from_me !== undefined ? existingMessage.is_from_me : true,
            timestamp: existingMessage.timestamp || existingMessage.received_at || existingMessage.created_at,
            status: existingMessage.status || 'sent',
            message_type: existingMessage.message_type || 'text',
            whatsapp_message_id: existingMessage.whatsapp_message_id || existingMessage.message_id || null,
            read_at: existingMessage.read_at || null,
          }
        });
      }
    }
    
    // Log if we're about to insert (for debugging)
    console.log('[MESSAGES] ✅ No duplicate found, proceeding with insert:', {
      agentId,
      userId,
      messageLength: trimmedMessage.length,
      messagePreview: trimmedMessage.substring(0, 30)
    });

    // Try insert with new columns first (if migration has been run)
    // If it fails with column error, retry with legacy columns only
    let result = await supabaseAdmin
      .from('message_log')
      .insert({
        ...insertPayload,
        message: message.trim(), // New column (may not exist yet)
        timestamp: now, // New column (may not exist yet)
        sender_type: 'user', // New column (may not exist yet)
        is_from_me: true, // New column (may not exist yet)
        status: 'sent', // New column (may not exist yet)
        whatsapp_message_id: whatsappMessageId || userMessageId, // New column (may not exist yet)
        ...(contact_id && { contact_id }), // New column (may not exist yet)
        source: 'dashboard', // CRITICAL: Mark as dashboard origin
      })
      .select()
      .single();
    
    // If insert failed because new columns don't exist, retry with legacy columns only
    if (result.error && result.error.message && result.error.message.includes('column')) {
      console.log('[MESSAGES] New columns not available, using legacy columns only');
      result = await supabaseAdmin
        .from('message_log')
        .insert(insertPayload)
        .select()
        .single();
    }
    
    const { data: userMessage, error: insertError } = result;

    if (insertError) {
      // Check if it's a duplicate key error
      if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
        console.log('[MESSAGES] Duplicate key error, fetching existing message');
        // Try to fetch the existing message
        const { data: existingMsg } = await supabaseAdmin
          .from('message_log')
          .select('*')
          .eq('agent_id', agentId)
          .eq('user_id', userId)
          .eq('message_text', message.trim())
          .order('received_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (existingMsg) {
          const messageId = existingMsg.uuid_id || 
                            (typeof existingMsg.id === 'string' ? existingMsg.id : null) ||
                            existingMsg.message_id;
          
          return res.json({ 
            success: true, 
            message: {
              id: messageId,
              agent_id: existingMsg.agent_id,
              user_id: existingMsg.user_id,
              contact_id: existingMsg.contact_id || null,
              message: existingMsg.message || existingMsg.message_text || '',
              sender_type: existingMsg.sender_type || 'user',
              is_from_me: existingMsg.is_from_me !== undefined ? existingMsg.is_from_me : true,
              timestamp: existingMsg.timestamp || existingMsg.received_at || existingMsg.created_at,
              status: existingMsg.status || 'sent',
              message_type: existingMsg.message_type || 'text',
              whatsapp_message_id: existingMsg.whatsapp_message_id || existingMsg.message_id || null,
              read_at: existingMsg.read_at || null,
            }
          });
        }
      }
      
      console.error('[MESSAGES] Error inserting user message:', insertError);
      throw insertError;
    }

    // CRITICAL: Send webhook for dashboard message
    // This allows the webhook receiver to process dashboard messages separately from WhatsApp messages
    try {
      const webhookUrl = process.env.WHATSAPP_MESSAGE_WEBHOOK_PROD || 
                        process.env.WHATSAPP_MESSAGE_WEBHOOK || 
                        process.env.WHATSAPP_MESSAGE_WEBHOOK_TEST;
      
      if (webhookUrl) {
        // Get agent's phone number for 'to' field
        const agentPhoneForWebhook = sanitizedAgentPhone || agent.whatsapp_phone_number?.replace(/[+\s-]/g, '');
        
        const webhookPayload = {
          source: 'dashboard',
          messageId: userMessage.message_id || userMessage.id,
          from: agentPhoneForWebhook, // Dashboard user sending to agent
          to: agentPhoneForWebhook, // Agent's number (same in this case)
          body: message.trim(),
          timestamp: now,
          isFromMe: true, // Dashboard messages are from the user (via agent's session)
          agentId: agentId,
          user_id: userId,
          metadata: {
            messageType: 'text',
            conversationId: `${agentPhoneNumber}@s.whatsapp.net`,
          }
        };
        
        // Send webhook asynchronously (don't block response)
        webhookService.sendWebhook(webhookUrl, webhookPayload).catch(error => {
          console.error('[MESSAGES][WEBHOOK] Error sending dashboard message webhook:', error.message);
          // Don't throw - webhook failures shouldn't block message sending
        });
        
        console.log('[MESSAGES][WEBHOOK] ✅ Dashboard message webhook triggered:', {
          messageId: webhookPayload.messageId,
          source: 'dashboard',
          agentId: agentId.substring(0, 8) + '...'
        });
      } else {
        console.log('[MESSAGES][WEBHOOK] ⚠️ Webhook URL not configured, skipping webhook');
      }
    } catch (webhookError) {
      console.error('[MESSAGES][WEBHOOK] Error preparing webhook:', webhookError.message);
      // Don't throw - webhook failures shouldn't block message sending
    }

    // Note: Agent response will come through WhatsApp and be processed by Baileys
    // The messages.upsert handler in baileysService.js will receive the agent's response
    // and save it to message_log automatically when the agent responds via WhatsApp
    // No need to simulate response here - it will come via WhatsApp webhook/AI processing

    res.json({ 
      success: true, 
      message: userMessage 
    });
  } catch (error) {
    console.error('[MESSAGES] Error sending message:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send message',
      message: error.message 
    });
  }
});

module.exports = router;

