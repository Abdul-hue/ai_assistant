const { supabaseAdmin } = require('../config/supabase');
const pino = require('pino');
const logger = pino({ level: 'info' });

/**
 * Create new message record
 * @param {Object} messageData - Message data from webhook
 * @returns {Promise<Object>} Inserted record
 */
async function createMessage(messageData) {
  try {
    const {
      messageId,
      from,
      to,
      body,
      timestamp,
      isFromMe,
      agentId,
      userId,
      metadata
    } = messageData;
    
    const record = {
      message_id: messageId,
      whatsapp_message_id: messageId,
      conversation_id: metadata.conversationId || `${from}@s.whatsapp.net`,
      sender_phone: from,
      message_text: body,
      message_type: metadata.messageType?.toLowerCase() || 'text',
      media_mimetype: metadata.mimetype || null,
      media_url: metadata.mediaUrl || null, // For audio (already uploaded)
      agent_id: agentId,
      user_id: userId,
      source: messageData.source || 'whatsapp',
      is_from_me: isFromMe,
      timestamp: timestamp,
      received_at: new Date().toISOString(),
      processed: false,
      status: 'received',
      metadata: {
        senderName: metadata.senderName,
        ...metadata
      }
    };
    
    const { data, error } = await supabaseAdmin
      .from('message_log')
      .insert([record])
      .select()
      .single();
    
    if (error) {
      // Handle duplicate message_id
      if (error.code === '23505') {
        logger.warn({ messageId }, 'Duplicate message_id, skipping insert');
        return await getMessageByMessageId(messageId);
      }
      throw error;
    }
    
    logger.info({ id: data.id, messageId }, 'Message created in database');
    return data;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to create message');
    throw error;
  }
}

/**
 * Update message with media information
 */
async function updateMessageMedia(messageId, mediaData) {
  try {
    const { url, storageKey, expiresAt, size, mimetype } = mediaData;
    
    // Get current metadata
    const { data: current } = await supabaseAdmin
      .from('message_log')
      .select('metadata')
      .eq('message_id', messageId)
      .single();
    
    // ✅ CRITICAL: Update media_url, media_mimetype, and media_size in message_log table
    const updateData = {
      media_url: url, // ✅ Store URL to bucket
      media_mimetype: mimetype || null, // ✅ Store MIME type (image/jpeg, video/mp4, application/pdf, etc.)
      media_size: size, // ✅ Store file size
      metadata: {
        ...(current?.metadata || {}),
        storageKey,
        urlExpiresAt: expiresAt
      }
    };
    
    const { data, error } = await supabaseAdmin
      .from('message_log')
      .update(updateData)
      .eq('message_id', messageId)
      .select()
      .single();
    
    if (error) throw error;
    
    logger.info({ messageId, url, mimetype, size }, 'Message media updated in database');
    return data;
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Failed to update media');
    throw error;
  }
}

/**
 * Mark message as processed
 */
async function markAsProcessed(messageId, success = true) {
  try {
    const updateData = {
      processed: success,
      processed_at: new Date().toISOString(),
      status: success ? 'processed' : 'failed'
    };
    
    const { data, error } = await supabaseAdmin
      .from('message_log')
      .update(updateData)
      .eq('message_id', messageId)
      .select()
      .single();
    
    if (error) throw error;
    
    logger.info({ messageId, success }, 'Message marked as processed');
    return data;
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Failed to mark as processed');
    throw error;
  }
}

/**
 * Update message metadata (for errors, etc.)
 */
async function updateMessageMetadata(messageId, metadataUpdates) {
  try {
    // First get current metadata (use maybeSingle to handle missing messages)
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('message_log')
      .select('metadata')
      .eq('message_id', messageId)
      .maybeSingle();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }
    
    // If message doesn't exist, log and return null
    if (!current) {
      logger.warn({ messageId }, 'Message not found when updating metadata');
      return null;
    }
    
    const updatedMetadata = {
      ...(current.metadata || {}),
      ...metadataUpdates
    };
    
    const { data, error } = await supabaseAdmin
      .from('message_log')
      .update({ metadata: updatedMetadata })
      .eq('message_id', messageId)
      .select()
      .maybeSingle();
    
    if (error) throw error;
    
    return data;
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Failed to update metadata');
    throw error;
  }
}

/**
 * Get message by message_id
 * Uses maybeSingle() to handle cases where message doesn't exist yet
 */
async function getMessageByMessageId(messageId) {
  const { data, error } = await supabaseAdmin
    .from('message_log')
    .select('*')
    .eq('message_id', messageId)
    .maybeSingle(); // Use maybeSingle() instead of single() to return null if not found
  
  if (error) {
    logger.error({ messageId, error: error.message, code: error.code }, 'Failed to get message');
    throw error;
  }
  
  return data; // Returns null if not found, or the message object if found
}

/**
 * Get unprocessed messages
 */
async function getUnprocessedMessages(limit = 100) {
  const { data, error } = await supabaseAdmin
    .from('message_log')
    .select('*')
    .eq('processed', false)
    .order('received_at', { ascending: true })
    .limit(limit);
  
  if (error) throw error;
  return data;
}

module.exports = {
  createMessage,
  updateMessageMedia,
  markAsProcessed,
  updateMessageMetadata,
  getMessageByMessageId,
  getUnprocessedMessages
};
