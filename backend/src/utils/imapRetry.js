/**
 * IMAP Retry Utility with Exponential Backoff
 * Handles Gmail throttling and other transient IMAP errors gracefully
 */

/**
 * Check if error is a throttling/rate limit error
 * @param {Error} error - The error to check
 * @returns {boolean} - True if error indicates throttling
 */
function isThrottlingError(error) {
  if (!error) return false;
  
  const errorMessage = error.message || '';
  const errorText = error.textCode || '';
  const errorType = error.type || '';
  
  // Check for Gmail throttling indicators
  const throttlingIndicators = [
    '[THROTTLED]',
    'THROTTLED',
    'rate limit',
    'rate_limit',
    'too many requests',
    'quota exceeded',
    'quota_exceeded',
    'system error',
    'temporary failure',
    'temporary_failure',
    'try again',
    'try_again'
  ];
  
  const messageLower = errorMessage.toLowerCase();
  const textCodeLower = errorText.toLowerCase();
  
  return throttlingIndicators.some(indicator => 
    messageLower.includes(indicator.toLowerCase()) ||
    textCodeLower.includes(indicator.toLowerCase())
  ) || errorType === 'no'; // IMAP NO response often indicates throttling
}

/**
 * Check if error is a connection error that should trigger reconnection
 * @param {Error} error - The error to check
 * @returns {boolean} - True if error indicates connection issue
 */
function isConnectionError(error) {
  if (!error) return false;
  
  const errorMessage = error.message || '';
  const messageLower = errorMessage.toLowerCase();
  
  const connectionIndicators = [
    'connection',
    'timeout',
    'econnreset',
    'socket',
    'network',
    'econnrefused',
    'enotfound',
    'authentication failed',
    'auth failed',
    'not authenticated',
    'not_authenticated',
    'authentication',
    'session expired',
    'session closed',
    'connection closed',
    'connection lost'
  ];
  
  return connectionIndicators.some(indicator => 
    messageLower.includes(indicator)
  );
}

/**
 * Check if error is retryable (not a permanent failure)
 * @param {Error} error - The error to check
 * @returns {boolean} - True if error is retryable
 */
function isRetryableError(error) {
  if (!error) return false;
  
  const errorMessage = error.message || '';
  const messageLower = errorMessage.toLowerCase();
  
  // Check for connection errors first (these are retryable, including "Not authenticated")
  // "Not authenticated" is a connection error that can be fixed by reconnecting
  if (isConnectionError(error)) {
    return true;
  }
  
  // Check for throttling errors (retryable)
  if (isThrottlingError(error)) {
    return true;
  }
  
  // Don't retry permanent authentication errors (like wrong credentials)
  // But "Not authenticated" (session expired) is handled above as connection error
  if (messageLower.includes('invalid credentials') || 
      messageLower.includes('wrong password') ||
      messageLower.includes('login failed') ||
      (messageLower.includes('authentication') && 
       !messageLower.includes('not authenticated') &&
       !messageLower.includes('temporary'))) {
    return false;
  }
  
  // Don't retry invalid mailbox errors (permanent)
  if (error.textCode === 'NONEXISTENT' && 
      messageLower.includes('mailbox')) {
    return false;
  }
  
  // Default: don't retry unknown errors
  return false;
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} baseDelay - Base delay in milliseconds (default: 1000)
 * @param {number} maxDelay - Maximum delay in milliseconds (default: 60000)
 * @param {number} multiplier - Exponential multiplier (default: 2)
 * @returns {number} - Delay in milliseconds
 */
function calculateBackoffDelay(attempt, baseDelay = 1000, maxDelay = 60000, multiplier = 2) {
  const delay = Math.min(baseDelay * Math.pow(multiplier, attempt), maxDelay);
  // Add jitter (random 0-20% of delay) to prevent thundering herd
  const jitter = delay * 0.2 * Math.random();
  return Math.floor(delay + jitter);
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry IMAP operation with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 5)
 * @param {number} options.baseDelay - Base delay in ms (default: 2000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 60000)
 * @param {Function} options.shouldRetry - Custom function to determine if error is retryable
 * @param {Function} options.onRetry - Callback called before each retry
 * @param {string} options.operationName - Name of operation for logging
 * @returns {Promise<any>} - Result of operation
 */
async function retryWithBackoff(operation, options = {}) {
  const {
    maxRetries = 5,
    baseDelay = 2000,
    maxDelay = 60000,
    shouldRetry = isRetryableError,
    onRetry = null,
    operationName = 'IMAP operation'
  } = options;
  
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (!shouldRetry(error)) {
        console.error(`[RETRY] ${operationName} failed with non-retryable error:`, error.message);
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === maxRetries) {
        console.error(`[RETRY] ${operationName} failed after ${maxRetries} retries:`, error.message);
        throw error;
      }
      
      // Calculate backoff delay
      const delay = calculateBackoffDelay(attempt, baseDelay, maxDelay);
      const isThrottled = isThrottlingError(error);
      
      console.warn(
        `[RETRY] ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`,
        isThrottled ? '[THROTTLED - using longer backoff]' : ''
      );
      
      // Call onRetry callback if provided
      if (onRetry) {
        try {
          await onRetry(error, attempt, delay);
        } catch (callbackError) {
          console.error('[RETRY] onRetry callback error:', callbackError);
        }
      }
      
      // Wait before retrying (longer delay for throttling)
      const actualDelay = isThrottled ? delay * 2 : delay;
      console.log(`[RETRY] Waiting ${actualDelay}ms before retry...`);
      await sleep(actualDelay);
    }
  }
  
  // Should never reach here, but just in case
  throw lastError || new Error(`${operationName} failed after ${maxRetries} retries`);
}

/**
 * Retry IMAP operation with connection recovery
 * Handles connection errors by reconnecting before retrying
 * @param {Function} operation - Async function that takes connection as parameter
 * @param {Function} getConnection - Async function that returns a new connection
 * @param {Object} options - Retry options
 * @returns {Promise<any>} - Result of operation
 */
async function retryWithReconnect(operation, getConnection, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 3000,
    maxDelay = 30000,
    operationName = 'IMAP operation with reconnect'
  } = options;
  
  let connection = null;
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Get or recreate connection
      if (!connection || isConnectionError(lastError)) {
        if (connection) {
          try {
            connection.end();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        
        console.log(`[RETRY] ${operationName}: Getting new connection (attempt ${attempt + 1})`);
        connection = await getConnection();
      }
      
      // Execute operation
      return await operation(connection);
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error)) {
        console.error(`[RETRY] ${operationName} failed with non-retryable error:`, error.message);
        if (connection) {
          try {
            connection.end();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === maxRetries) {
        console.error(`[RETRY] ${operationName} failed after ${maxRetries} retries:`, error.message);
        if (connection) {
          try {
            connection.end();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        throw error;
      }
      
      const delay = calculateBackoffDelay(attempt, baseDelay, maxDelay);
      const isThrottled = isThrottlingError(error);
      
      console.warn(
        `[RETRY] ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`,
        isThrottled ? '[THROTTLED]' : isConnectionError(error) ? '[CONNECTION ERROR]' : ''
      );
      
      // Longer delay for throttling
      const actualDelay = isThrottled ? delay * 3 : delay;
      console.log(`[RETRY] Waiting ${actualDelay}ms before retry...`);
      await sleep(actualDelay);
    }
  }
  
  if (connection) {
    try {
      connection.end();
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  
  throw lastError || new Error(`${operationName} failed after ${maxRetries} retries`);
}

module.exports = {
  retryWithBackoff,
  retryWithReconnect,
  isThrottlingError,
  isConnectionError,
  isRetryableError,
  calculateBackoffDelay,
  sleep
};

