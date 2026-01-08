/**
 * WhatsApp Service Constants
 * 
 * MAINTAINABILITY: All magic numbers extracted to a single location
 * for easier configuration and understanding
 */

module.exports = {
  // QR Code timeouts
  QR_CODE_TIMEOUT_MS: 30000,          // 30 seconds - How long to wait for QR generation
  QR_CODE_CACHE_TTL_MS: 60000,        // 60 seconds - QR code expiration time
  QR_CHECK_INTERVAL_MS: 500,          // 500ms - Polling interval for QR code availability
  MAX_QR_ATTEMPTS: 30,                // Maximum attempts to check for QR code (30 * 500ms = 15s)
  
  // Connection timeouts
  CONNECTION_RETRY_DELAY_MS: 2000,    // 2 seconds - Delay between connection retries
  CONNECTION_TIMEOUT_MS: 60000,       // 60 seconds - Baileys connection timeout
  KEEP_ALIVE_INTERVAL_MS: 30000,      // 30 seconds - Keep-alive ping interval
  QUERY_TIMEOUT_MS: 60000,            // 60 seconds - Default query timeout
  
  // Session management
  SESSION_CLEANUP_INTERVAL_MS: 300000, // 5 minutes - How often to cleanup inactive sessions
  SESSION_IDLE_TIMEOUT_MS: 3600000,    // 1 hour - When to consider a session idle
  
  // Message limits
  MAX_MESSAGE_LENGTH: 4096,            // WhatsApp's maximum message length
  MAX_RETRY_ATTEMPTS: 3,               // Maximum message send retry attempts
  RETRY_DELAY_MS: 1000,                // 1 second - Delay between retry attempts
  
  // Rate limiting (per agent)
  MAX_MESSAGES_PER_MINUTE: 60,         // Maximum messages to send per minute
  MAX_MESSAGES_PER_HOUR: 1000,         // Maximum messages to send per hour
  
  // Baileys browser info
  BROWSER_NAME: 'Chrome (Linux)',
  BROWSER_VERSION: '',
  
  // Logging
  LOG_LEVEL: 'silent', // Options: 'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'
};

