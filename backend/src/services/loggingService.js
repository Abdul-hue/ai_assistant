const { supabaseAdmin } = require('../config/supabase');
const pino = require('pino');
const logger = pino({ level: 'info' });

/**
 * Log stages for message processing
 */
const STAGES = {
  RECEIVED: 'received',
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  FORWARDING: 'forwarding',
  FORWARDED: 'forwarded',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * Log statuses
 */
const STATUS = {
  STARTED: 'started',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

/**
 * Create a processing log entry
 * @param {string} messageId - WhatsApp message ID
 * @param {string} stage - Processing stage (see STAGES)
 * @param {string} status - Status (see STATUS)
 * @param {string} message - Human-readable message
 * @param {Object} options - Additional options
 * @param {number} options.durationMs - Duration in milliseconds
 * @param {Object} options.metadata - Additional metadata
 * @param {string} options.errorMessage - Error message if failed
 * @param {string} options.errorStack - Error stack trace if failed
 */
async function logProcessingStep(messageId, stage, status, message, options = {}) {
  try {
    const logEntry = {
      message_id: messageId,
      report_id: null, // Not using reports table, leave null
      stage,
      status,
      message,
      metadata: options.metadata || {},
      duration_ms: options.durationMs || null,
      created_at: new Date().toISOString()
    };
    
    // Add error details if present
    if (options.errorMessage) {
      logEntry.metadata = {
        ...logEntry.metadata,
        error_message: options.errorMessage,
        error_stack: options.errorStack
      };
    }
    
    const { data, error } = await supabaseAdmin
      .from('processing_logs')
      .insert([logEntry])
      .select()
      .single();
    
    if (error) {
      // Don't throw - logging should never break the main flow
      logger.error({ messageId, error: error.message }, 'Failed to write processing log');
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Error in logProcessingStep');
    return null;
  }
}

/**
 * Helper: Log with automatic timing
 * Returns a function to call when step completes
 */
function startTiming(messageId, stage, metadata = {}) {
  const startTime = Date.now();
  
  // Log start
  logProcessingStep(messageId, stage, STATUS.STARTED, `${stage} started`, { metadata }).catch(err => {
    logger.error({ messageId, stage, error: err.message }, 'Failed to log stage start');
  });
  
  // Return completion function
  return {
    success: async (message, additionalMetadata = {}) => {
      const duration = Date.now() - startTime;
      await logProcessingStep(
        messageId,
        stage,
        STATUS.SUCCESS,
        message || `${stage} completed successfully`,
        {
          durationMs: duration,
          metadata: { ...metadata, ...additionalMetadata }
        }
      );
    },
    
    failed: async (error, additionalMetadata = {}) => {
      const duration = Date.now() - startTime;
      await logProcessingStep(
        messageId,
        stage,
        STATUS.FAILED,
        `${stage} failed: ${error.message}`,
        {
          durationMs: duration,
          metadata: { ...metadata, ...additionalMetadata },
          errorMessage: error.message,
          errorStack: error.stack
        }
      );
    },
    
    skipped: async (reason, additionalMetadata = {}) => {
      const duration = Date.now() - startTime;
      await logProcessingStep(
        messageId,
        stage,
        STATUS.SKIPPED,
        reason || `${stage} skipped`,
        {
          durationMs: duration,
          metadata: { ...metadata, ...additionalMetadata }
        }
      );
    }
  };
}

/**
 * Get processing history for a message
 */
async function getProcessingHistory(messageId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('processing_logs')
      .select('*')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Failed to get processing history');
    return [];
  }
}

/**
 * Get failed processing logs (for monitoring)
 */
async function getFailedLogs(limit = 100, since = null) {
  try {
    let query = supabaseAdmin
      .from('processing_logs')
      .select('*')
      .eq('status', STATUS.FAILED)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (since) {
      query = query.gte('created_at', since);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get failed logs');
    return [];
  }
}

/**
 * Get processing statistics
 */
async function getProcessingStats(messageId) {
  try {
    const logs = await getProcessingHistory(messageId);
    
    if (logs.length === 0) {
      return null;
    }
    
    const totalDuration = logs.reduce((sum, log) => sum + (log.duration_ms || 0), 0);
    const failedSteps = logs.filter(log => log.status === STATUS.FAILED);
    const successSteps = logs.filter(log => log.status === STATUS.SUCCESS);
    
    return {
      messageId,
      totalSteps: logs.length,
      successfulSteps: successSteps.length,
      failedSteps: failedSteps.length,
      totalDurationMs: totalDuration,
      stages: logs.map(log => ({
        stage: log.stage,
        status: log.status,
        duration: log.duration_ms,
        timestamp: log.created_at
      })),
      firstLog: logs[0].created_at,
      lastLog: logs[logs.length - 1].created_at
    };
  } catch (error) {
    logger.error({ messageId, error: error.message }, 'Failed to get stats');
    return null;
  }
}

module.exports = {
  STAGES,
  STATUS,
  logProcessingStep,
  startTiming,
  getProcessingHistory,
  getFailedLogs,
  getProcessingStats
};
