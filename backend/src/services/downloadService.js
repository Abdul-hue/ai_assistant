const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const logger = pino({ level: 'info' });

/**
 * Downloads media file from WhatsApp
 * @param {Object} socket - Baileys socket instance
 * @param {string} messageId - WhatsApp message ID
 * @param {string} mimetype - File MIME type
 * @param {string} storeRemoteJid - Optional: specific remoteJid to check first (for @lid message optimization)
 * @returns {Promise<{buffer: Buffer, mimetype: string, size: number}>}
 */
async function downloadMediaFile(socket, messageId, mimetype, storeRemoteJid = null) {
  try {
    // #region debug log
    fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'downloadService.js:12',message:'downloadMediaFile entry',data:{messageId,hasSocket:!!socket,hasStore:!!socket?.store,hasMessages:!!socket?.store?.messages,socketKeys:Object.keys(socket||{}).slice(0,10)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // ✅ HARD GUARD: Fail fast if store is missing (architectural issue, not operational)
    if (!socket || !socket.store) {
      // #region debug log
      fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'downloadService.js:16',message:'Socket store missing',data:{messageId,hasSocket:!!socket,hasStore:!!socket?.store,socketType:typeof socket},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      throw new Error(`MEDIA_PIPELINE_BROKEN: Baileys store not initialized - media cannot be downloaded. Socket: ${!!socket}, Store: ${!!socket?.store}`);
    }
    
    if (!socket.store.messages) {
      // #region debug log
      fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'downloadService.js:22',message:'Socket store.messages missing',data:{messageId,storeKeys:Object.keys(socket.store||{}).slice(0,10)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      throw new Error(`MEDIA_PIPELINE_BROKEN: Baileys store.messages not available - media cannot be downloaded. Store keys: ${Object.keys(socket.store || {}).join(', ')}`);
    }
    
    // #region debug log
    fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'downloadService.js:33',message:'Before store query',data:{messageId,storeType:typeof socket.store.messages,hasGet:typeof socket.store.messages?.get,storeMethods:Object.keys(socket.store.messages||{}).slice(0,10)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    // Get message from store
    // In Baileys, messages are stored by remoteJid, so we need to search all conversations
    let message = null;
    
    // #region debug log
    fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'downloadService.js:33',message:'Before store query',data:{messageId,storeType:typeof socket.store.messages,isMap:socket.store.messages instanceof Map,hasGet:typeof socket.store.messages?.get,hasKeys:typeof socket.store.messages?.keys},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    // ✅ FIX: Baileys store.messages is a plain object, not a Map
    // Structure: { [remoteJid]: { [messageId]: message } }
    // Use Object.keys() instead of Map methods
    if (socket.store.messages && typeof socket.store.messages === 'object') {
      // ✅ OPTIMIZATION: If storeRemoteJid is provided (for @lid messages), check that first
      if (storeRemoteJid && socket.store.messages[storeRemoteJid]) {
        const conversation = socket.store.messages[storeRemoteJid];
        if (conversation instanceof Map) {
          message = conversation.get(messageId);
        } else if (typeof conversation === 'object') {
          message = conversation[messageId];
        }
        
        if (message) {
          // #region debug log
          fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'downloadService.js:55',message:'Found message in specified storeRemoteJid',data:{messageId,storeRemoteJid,found:!!message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
        }
      }
      
      // If not found in specified remoteJid, search all conversations
      if (!message) {
        const remoteJids = Object.keys(socket.store.messages);
        // #region debug log
        fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'downloadService.js:62',message:'Searching all conversations',data:{messageId,conversationCount:remoteJids.length,storeRemoteJid,remoteJids:remoteJids.slice(0,3)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        for (const remoteJid of remoteJids) {
          const conversation = socket.store.messages[remoteJid]; // Use bracket notation for object
          if (conversation) {
            // Conversation can be a Map or an object
            if (conversation instanceof Map) {
              message = conversation.get(messageId);
            } else if (typeof conversation === 'object') {
              message = conversation[messageId]; // Use bracket notation
            }
            
            if (message) {
              // #region debug log
              fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'downloadService.js:75',message:'Found message in conversation',data:{messageId,remoteJid,found:!!message,hasKey:!!message.key,messageType:typeof message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
              // #endregion
              break;
            }
          }
        }
      }
    }
    
    if (!message) {
      // #region debug log
      const conversationCount = socket.store.messages ? Object.keys(socket.store.messages).length : 0;
      fetch('http://127.0.0.1:7242/ingest/57baeca8-31de-45dc-82e3-6e00affba741',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'downloadService.js:68',message:'Message not found in store',data:{messageId,storeAvailable:!!socket.store.messages,conversationCount,remoteJids:Object.keys(socket.store.messages||{}).slice(0,5)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      // ✅ HARD GUARD: Fail fast with architectural error message
      throw new Error(`MEDIA_PIPELINE_BROKEN: message ${messageId} not persisted to store before media job - media cannot be downloaded (searched ${conversationCount} conversations)`);
    }
    
    // Download media
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger: pino({ level: 'error' }),
        reuploadRequest: socket.updateMediaMessage,
      }
    );
    
    if (!buffer || buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    // Validate file size
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 52428800; // 50MB
    if (buffer.length > maxSize) {
      throw new Error(`File size ${buffer.length} exceeds maximum ${maxSize}`);
    }
    
    return {
      buffer,
      mimetype,
      size: buffer.length
    };
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Failed to download media');
    throw error;
  }
}

/**
 * Get file extension from MIME type
 */
function getFileExtension(mimetype) {
  if (!mimetype) return 'bin';
  
  const mimeMap = {
    // Documents
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    
    // Images
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    
    // Videos
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    
    // Audio
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/webm': 'webm',
  };
  
  return mimeMap[mimetype.toLowerCase()] || 'bin';
}

/**
 * Determine file category from MIME type
 */
function getFileCategory(mimetype) {
  if (!mimetype) return 'others';
  
  const mime = mimetype.toLowerCase();
  
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('spreadsheetml') || mime.includes('excel') || mime === 'application/vnd.ms-excel') return 'spreadsheets';
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'documents';
  if (mime === 'application/pdf') return 'documents';
  
  return 'others';
}

module.exports = {
  downloadMediaFile,
  getFileExtension,
  getFileCategory
};
