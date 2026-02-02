const Queue = require('bull');
const { downloadMediaFile, getFileCategory, getFileExtension } = require('../services/downloadService');
const { uploadFile } = require('../services/storageService');
const { 
  updateMessageMedia, 
  markAsProcessed,
  updateMessageMetadata,
  getMessageByMessageId
} = require('../services/dbService');
const { forwardToN8N } = require('../services/n8nService');
const { getSocket } = require('../utils/socketManager');
const { startTiming, STAGES, logProcessingStep, STATUS } = require('../services/loggingService');
const { redisConfig, redis } = require('../config/redis');
const pino = require('pino');
const logger = pino({ level: 'info' });

// Create queue
const mediaQueue = new Queue('whatsapp-media-processing', {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: parseInt(process.env.RETRY_ATTEMPTS) || 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

// Set concurrency
const concurrency = parseInt(process.env.QUEUE_CONCURRENCY) || 5;

/**
 * Process media message with comprehensive logging
 */
mediaQueue.process(concurrency, async (job) => {
  const { messageId, agentId, mimetype, hasMediaUrl } = job.data;
  
  logger.info({ messageId, mimetype }, 'Processing media message');
  
  // ✅ IDEMPOTENCY: Check if job already completed (prevent duplicate processing)
  // Note: Bull's jobId prevents duplicate jobs, but we add extra safety here
  if (job.attemptsMade > 0 && job.opts.attempts && job.attemptsMade >= job.opts.attempts) {
    logger.warn({ messageId, attempts: job.attemptsMade }, 'Job exceeded max attempts - skipping retry');
    return { success: false, messageId, reason: 'max_attempts_reached' };
  }
  
  try {
    // Get message record with retry logic (message might not be inserted yet due to batch processing)
    let messageRecord = null;
    const maxRetries = 10;
    const retryDelay = 500; // 500ms between retries
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      messageRecord = await getMessageByMessageId(messageId);
      
      if (messageRecord) {
        break; // Found the message, exit retry loop
      }
      
      if (attempt < maxRetries) {
        logger.debug({ messageId, attempt, maxRetries }, 'Message not found, retrying...');
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    if (!messageRecord) {
      throw new Error(`Message not found in database after ${maxRetries} attempts (message may still be in batch queue)`);
    }
    
    // ✅ FIX: Check if media already processed (prevent duplicate uploads)
    // But still send webhook if it wasn't sent before
    if (messageRecord.media_url) {
      logger.info({ messageId, existingUrl: messageRecord.media_url }, 'Media already processed, skipping upload');
      
      // ✅ CRITICAL: Send webhook even if media is already processed (for retries)
      if (job.data.metadata?.webhookPayload && messageRecord.media_url) {
        try {
          const { forwardMessageToWebhook } = require('../services/baileysService');
          const webhookPayload = {
            ...job.data.metadata.webhookPayload,
            mediaUrl: messageRecord.media_url, // Use existing media URL
            hasMediaUrl: true,
          };
          
          logger.info({ messageId, mediaUrl: messageRecord.media_url }, 'Sending webhook for already-processed media');
          await forwardMessageToWebhook(agentId, webhookPayload);
          logger.info({ messageId }, 'Webhook sent successfully for already-processed media');
        } catch (webhookError) {
          // Log but don't fail - webhook is non-critical
          logger.error({ messageId, error: webhookError.message }, 'Failed to send webhook for already-processed media');
        }
      }
      
      return { success: true, messageId, reason: 'already_processed', media_url: messageRecord.media_url };
    }
    
    // STEP 1: Handle media file (if needed)
    if (mimetype && !hasMediaUrl) {
      logger.info({ messageId }, 'Media file needs download and upload');
      
      // LOG & TIME: Download
      const downloadTimer = startTiming(messageId, STAGES.DOWNLOADING, {
        mimetype,
        agentId
      });
      
      try {
        const socket = getSocket(agentId);
        
        // ✅ HARD GUARD: Fail fast if socket missing
        if (!socket) {
          throw new Error(`MEDIA_PIPELINE_BROKEN: No active socket found for agent ${agentId} - media cannot be downloaded`);
        }
        
        // ✅ HARD GUARD: Verify store exists before attempting download
        if (!socket.store || !socket.store.messages) {
          throw new Error(`MEDIA_PIPELINE_BROKEN: Baileys store not available for agent ${agentId} - media cannot be downloaded`);
        }
        
        // ✅ FIX: Pass storeRemoteJid if available (for @lid message optimization)
        const storeRemoteJid = job.data.metadata?.storeRemoteJid || null;
        const { buffer, size } = await downloadMediaFile(socket, messageId, mimetype, storeRemoteJid);
        
        await downloadTimer.success('File downloaded successfully', {
          fileSize: size,
          sizeKB: Math.round(size / 1024)
        });
        
        logger.info({ messageId, size }, 'File downloaded');
        
        // LOG & TIME: Upload
        const uploadTimer = startTiming(messageId, STAGES.UPLOADING, {
          fileSize: size,
          mimetype
        });
        
        try {
          // ✅ FIX: Use Redis distributed lock to prevent concurrent uploads across workers
          const lockKey = `media_upload_lock:${messageId}`;
          const lockTTL = 300; // 5 minutes max lock time
          let lockAcquired = false;
          let uploadResult;
          
          try {
            // Try to acquire Redis lock (SET NX EX - set if not exists with expiration)
            const lockResult = await redis.set(lockKey, '1', 'EX', lockTTL, 'NX');
            
            if (lockResult === 'OK') {
              lockAcquired = true;
              logger.info({ messageId }, 'Acquired upload lock, proceeding with upload');
              
              // Double-check media_url wasn't set by another process before we got the lock
              const currentMessage = await getMessageByMessageId(messageId);
              if (currentMessage && currentMessage.media_url) {
                logger.info({ messageId, existingUrl: currentMessage.media_url }, 'Media URL already set, releasing lock and using existing');
                await redis.del(lockKey);
                uploadResult = {
                  url: currentMessage.media_url,
                  storageKey: currentMessage.metadata?.storageKey || `${agentId}/${getFileCategory(mimetype)}/${new Date().toISOString().split('T')[0]}_${messageId}.${getFileExtension(mimetype)}`,
                  expiresAt: currentMessage.metadata?.urlExpiresAt || new Date(Date.now() + (604800 * 1000)).toISOString()
                };
              } else {
                // Perform upload
                uploadResult = await uploadFile(buffer, messageId, agentId, mimetype);
              }
            } else {
              // Lock already held by another process - wait and check if media_url was set
              logger.info({ messageId }, 'Upload lock held by another process, waiting...');
              
              // Wait up to 30 seconds for lock to be released
              const maxWait = 30000; // 30 seconds
              const waitInterval = 500; // Check every 500ms
              let waited = 0;
              
              while (waited < maxWait) {
                await new Promise(resolve => setTimeout(resolve, waitInterval));
                waited += waitInterval;
                
                // Check if media_url was set by the other process
                const currentMessage = await getMessageByMessageId(messageId);
                if (currentMessage && currentMessage.media_url) {
                  logger.info({ messageId, existingUrl: currentMessage.media_url }, 'Media URL set by another process, using existing');
                  uploadResult = {
                    url: currentMessage.media_url,
                    storageKey: currentMessage.metadata?.storageKey || `${agentId}/${getFileCategory(mimetype)}/${new Date().toISOString().split('T')[0]}_${messageId}.${getFileExtension(mimetype)}`,
                    expiresAt: currentMessage.metadata?.urlExpiresAt || new Date(Date.now() + (604800 * 1000)).toISOString()
                  };
                  break;
                }
                
                // Check if lock was released
                const lockExists = await redis.exists(lockKey);
                if (!lockExists) {
                  logger.info({ messageId }, 'Lock released, but media_url not set, proceeding with upload');
                  uploadResult = await uploadFile(buffer, messageId, agentId, mimetype);
                  break;
                }
              }
              
              if (!uploadResult) {
                throw new Error('Timeout waiting for upload lock');
              }
            }
          } finally {
            // Release lock if we acquired it
            if (lockAcquired) {
              await redis.del(lockKey);
              logger.info({ messageId }, 'Released upload lock');
            }
          }
          
          // Final check: if media_url was set by another process after our upload
          const finalCheck = await getMessageByMessageId(messageId);
          if (finalCheck && finalCheck.media_url && finalCheck.media_url !== uploadResult.url) {
            logger.warn({ messageId, ourUrl: uploadResult.url, existingUrl: finalCheck.media_url }, 'Media URL changed by another process, using existing');
            uploadResult = {
              url: finalCheck.media_url,
              storageKey: finalCheck.metadata?.storageKey || uploadResult.storageKey,
              expiresAt: finalCheck.metadata?.urlExpiresAt || uploadResult.expiresAt
            };
          }
          
          await uploadTimer.success('File uploaded to storage', {
            storageKey: uploadResult.storageKey,
            url: uploadResult.url,
            expiresAt: uploadResult.expiresAt
          });
          
          logger.info({ messageId, url: uploadResult.url }, 'File uploaded');
          
          // ✅ CRITICAL: Update message_log table with media_url, media_mimetype, and media_size
          // Use update with conflict handling to prevent race conditions
          await updateMessageMedia(messageId, {
            url: uploadResult.url, // ✅ URL to file in bucket
            mimetype: mimetype, // ✅ MIME type (image/jpeg, video/mp4, application/pdf, etc.)
            storageKey: uploadResult.storageKey,
            expiresAt: uploadResult.expiresAt,
            size: size // ✅ File size in bytes
          });
          
          logger.info({ messageId, url: uploadResult.url, mimetype, size }, 'Media URL saved to message_log table');
          
          // Update local record
          messageRecord.media_url = uploadResult.url;
          messageRecord.media_size = size;
          messageRecord.metadata = {
            ...messageRecord.metadata,
            storageKey: uploadResult.storageKey,
            urlExpiresAt: uploadResult.expiresAt
          };
          
          // ✅ ARCHITECTURAL FIX: Send webhook AFTER media upload completes
          // This ensures webhook includes valid mediaUrl
          if (job.data.metadata?.webhookPayload) {
            try {
              const { forwardMessageToWebhook } = require('../services/baileysService');
              const webhookPayload = {
                ...job.data.metadata.webhookPayload,
                mediaUrl: uploadResult.url, // ✅ Include uploaded media URL
                hasMediaUrl: true,
              };
              
              logger.info({ messageId, mediaUrl: uploadResult.url }, 'Sending webhook after media upload');
              await forwardMessageToWebhook(agentId, webhookPayload);
              logger.info({ messageId }, 'Webhook sent successfully with mediaUrl');
            } catch (webhookError) {
              // Log but don't fail the job - webhook is non-critical
              logger.error({ messageId, error: webhookError.message }, 'Failed to send webhook after upload');
            }
          } else {
            logger.warn({ messageId, hasMetadata: !!job.data.metadata, hasWebhookPayload: !!job.data.metadata?.webhookPayload }, 'Webhook payload missing - webhook will not be sent');
          }
        } catch (uploadError) {
          await uploadTimer.failed(uploadError);
          throw uploadError;
        }
      } catch (downloadError) {
        await downloadTimer.failed(downloadError);
        throw downloadError;
      }
    } else if (hasMediaUrl) {
      // LOG: Skipped download (already has URL)
      await logProcessingStep(
        messageId,
        STAGES.DOWNLOADING,
        STATUS.SKIPPED,
        'Media URL already exists (audio file)',
        {
          metadata: {
            existingUrl: messageRecord.media_url,
            mimetype
          }
        }
      );
      
      logger.info({ messageId }, 'Skipped download - URL exists');
    } else {
      // LOG: Skipped (text only)
      await logProcessingStep(
        messageId,
        STAGES.DOWNLOADING,
        STATUS.SKIPPED,
        'No media file - text-only message',
        {
          metadata: {
            messageType: messageRecord.message_type
          }
        }
      );
      
      logger.info({ messageId }, 'No media - text only');
    }
    
    // STEP 2: Forward to N8N
    const forwardTimer = startTiming(messageId, STAGES.FORWARDING, {
      hasMedia: !!messageRecord.media_url,
      messageType: messageRecord.message_type
    });
    
    try {
      const n8nResponse = await forwardToN8N(messageRecord);
      
      await forwardTimer.success('Successfully forwarded to N8N', {
        n8nStatus: n8nResponse.status,
        hasResponse: !!n8nResponse.data
      });
      
      logger.info({ messageId }, 'Forwarded to N8N');
    } catch (forwardError) {
      await forwardTimer.failed(forwardError);
      throw forwardError;
    }
    
    // STEP 3: Mark as processed
    await markAsProcessed(messageId, true);
    
    // LOG: Completed
    await logProcessingStep(
      messageId,
      STAGES.COMPLETED,
      STATUS.SUCCESS,
      'Message processing completed successfully',
      {
        metadata: {
          hasMedia: !!messageRecord.media_url,
          mediaType: messageRecord.message_type,
          forwardedToN8N: true
        }
      }
    );
    
    logger.info({ messageId }, 'Processing completed');
    
    return { success: true, messageId };
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Processing error');
    
    // ✅ ARCHITECTURAL ERROR: Don't retry if it's a store/pipeline issue
    const isArchitecturalError = error.message.includes('MEDIA_PIPELINE_BROKEN') || 
                                  error.message.includes('store not') ||
                                  error.message.includes('not persisted to store');
    
    if (isArchitecturalError) {
      logger.error({ messageId, error: error.message }, 'MEDIA_PIPELINE_BROKEN: This is an architectural issue - retrying will not help');
      // Mark as permanently failed - don't retry
      await markAsProcessed(messageId, false).catch(() => {});
    }
    
    // LOG: Failed
    await logProcessingStep(
      messageId,
      STAGES.FAILED,
      STATUS.FAILED,
      `Processing failed: ${error.message}`,
      {
        errorMessage: error.message,
        errorStack: error.stack,
        metadata: {
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts,
          isArchitecturalError
        }
      }
    );
    
    // Update message metadata with error
    try {
      await updateMessageMetadata(messageId, {
        error: error.message,
        errorStack: error.stack,
        failedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
        isArchitecturalError
      });
    } catch (metaError) {
      logger.error({ messageId, error: metaError.message }, 'Failed to update error metadata');
    }
    
    // If architectural error, don't throw (prevents retry)
    if (isArchitecturalError) {
      return { success: false, messageId, reason: 'architectural_error', error: error.message };
    }
    
    throw error;
  }
});

/**
 * Add message to processing queue
 */
async function queueMessage(messageData) {
  const { messageId, agentId, metadata } = messageData;
  
  // ✅ FIX: Check if media already processed (prevent duplicate uploads)
  try {
    const { getMessageByMessageId } = require('../services/dbService');
    const existingMessage = await getMessageByMessageId(messageId);
    
    if (existingMessage && existingMessage.media_url) {
      logger.info({ messageId, existingUrl: existingMessage.media_url }, 'Media already processed, skipping queue');
      return { id: `media-${messageId}`, alreadyProcessed: true };
    }
  } catch (checkError) {
    // If check fails, proceed with queueing (non-critical)
    logger.debug({ messageId, error: checkError.message }, 'Could not check existing message, proceeding with queue');
  }
  
  const hasMediaUrl = !!metadata.mediaUrl; // Audio files already have URLs
  const mimetype = metadata.mimetype;
  
  // Determine if this needs media processing
  const needsProcessing = mimetype || hasMediaUrl;
  
  const jobData = {
    messageId,
    agentId,
    mimetype,
    hasMediaUrl,
    metadata: metadata, // ✅ CRITICAL: Include metadata (contains webhookPayload)
    timestamp: new Date().toISOString()
  };
  
  // ✅ FIX: Check if job already exists in queue (prevent duplicate queueing)
  try {
    const existingJob = await mediaQueue.getJob(`media-${messageId}`);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        logger.info({ messageId, jobId: existingJob.id, state }, 'Media job already in queue, skipping duplicate');
        return existingJob;
      }
    }
  } catch (jobCheckError) {
    // If check fails, proceed with adding job (non-critical)
    logger.debug({ messageId, error: jobCheckError.message }, 'Could not check existing job, proceeding with queue');
  }
  
  // Add to queue with options
  try {
    const job = await mediaQueue.add(jobData, {
      jobId: `media-${messageId}`, // ✅ Prevent duplicate jobs (Bull will ignore if exists)
      attempts: parseInt(process.env.RETRY_ATTEMPTS) || 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: true,
      removeOnFail: false
    });
    
    logger.info({ messageId, jobId: job.id }, 'Message queued for processing');
    
    return job;
  } catch (queueError) {
    // ✅ FIX: Handle Redis connection errors gracefully
    if (queueError.message && queueError.message.includes('ECONNREFUSED')) {
      logger.error({ 
        messageId, 
        error: queueError.message,
        host: redisConfig.host,
        port: redisConfig.port
      }, 'Redis connection failed - cannot queue media job. Please start Redis server.');
      
      // Return error object so caller can handle it
      throw new Error(`REDIS_CONNECTION_FAILED: Cannot queue media job - Redis server not running. Please start Redis at ${redisConfig.host}:${redisConfig.port}`);
    }
    
    // Re-throw other errors
    throw queueError;
  }
}

// Queue event handlers
mediaQueue.on('completed', (job, result) => {
  logger.info({ 
    jobId: job.id, 
    messageId: result.messageId 
  }, 'Job completed');
});

mediaQueue.on('failed', (job, error) => {
  logger.error({ 
    jobId: job.id, 
    messageId: job.data.messageId,
    error: error.message,
    attempts: job.attemptsMade
  }, 'Job failed');
  
  // If max attempts reached, mark as failed
  if (job.attemptsMade >= (parseInt(process.env.RETRY_ATTEMPTS) || 3)) {
    markAsProcessed(job.data.messageId, false).catch(err => {
      logger.error({ messageId: job.data.messageId, error: err.message }, 'Failed to mark as failed');
    });
  }
});

mediaQueue.on('stalled', (job) => {
  logger.warn({ jobId: job.id, messageId: job.data.messageId }, 'Job stalled');
});

mediaQueue.on('error', (error) => {
  logger.error({ error: error.message }, 'Queue error');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing queue');
  await mediaQueue.close();
  process.exit(0);
});

module.exports = {
  mediaQueue,
  queueMessage
};
