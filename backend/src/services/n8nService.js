const axios = require('axios');
const pino = require('pino');
const logger = pino({ level: 'info' });

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const TIMEOUT = 15000; // 15 seconds

/**
 * Forward message data to N8N webhook
 * @param {Object} messageRecord - Complete message record from database
 * @returns {Promise<Object>} N8N response
 */
async function forwardToN8N(messageRecord) {
  if (!N8N_WEBHOOK_URL) {
    throw new Error('N8N_WEBHOOK_URL not configured');
  }
  
  try {
    // Build payload for N8N
    const payload = {
      // Message identification
      message_id: messageRecord.message_id,
      whatsapp_message_id: messageRecord.whatsapp_message_id,
      uuid_id: messageRecord.uuid_id,
      
      // Sender information
      sender_phone: messageRecord.sender_phone,
      sender_name: messageRecord.metadata?.senderName || null,
      conversation_id: messageRecord.conversation_id,
      
      // Message content
      message_type: messageRecord.message_type,
      message_text: messageRecord.message_text,
      
      // Media information (if applicable)
      media_url: messageRecord.media_url,
      media_mimetype: messageRecord.media_mimetype,
      media_size: messageRecord.media_size,
      media_metadata: messageRecord.metadata?.storageKey ? {
        fileName: extractFileName(messageRecord.metadata.storageKey),
        fileExtension: extractFileExtension(messageRecord.media_mimetype),
        storageKey: messageRecord.metadata.storageKey,
        urlExpiresAt: messageRecord.metadata.urlExpiresAt
      } : null,
      
      // Context
      agent_id: messageRecord.agent_id,
      user_id: messageRecord.user_id,
      source: messageRecord.source,
      is_from_me: messageRecord.is_from_me,
      is_group_message: messageRecord.is_group_message || false,
      group_id: messageRecord.group_id || null,
      
      // Timestamps
      received_at: messageRecord.received_at,
      processed_at: new Date().toISOString(),
      timestamp: messageRecord.timestamp,
      
      // Additional metadata
      metadata: messageRecord.metadata
    };
    
    logger.info({ messageId: messageRecord.message_id }, 'Forwarding to N8N');
    
    // Send to N8N
    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-Media-Processor/1.0'
      },
      timeout: TIMEOUT
    });
    
    logger.info({ 
      messageId: messageRecord.message_id,
      status: response.status 
    }, 'Successfully forwarded to N8N');
    
    return {
      success: true,
      status: response.status,
      data: response.data
    };
  } catch (error) {
    logger.error({ 
      messageId: messageRecord.message_id,
      error: error.message 
    }, 'Failed to forward to N8N');
    
    throw new Error(`N8N forwarding failed: ${error.message}`);
  }
}

/**
 * Extract filename from storage key
 */
function extractFileName(storageKey) {
  if (!storageKey) return null;
  const parts = storageKey.split('/');
  return parts[parts.length - 1];
}

/**
 * Extract file extension from mimetype
 */
function extractFileExtension(mimetype) {
  if (!mimetype) return null;
  
  const mimeMap = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3'
  };
  
  return mimeMap[mimetype] || 'unknown';
}

module.exports = {
  forwardToN8N
};
