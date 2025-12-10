/**
 * IMAP Connection Utility
 * Creates a node-imap compatible connection using imap-simple
 * This ensures all IMAP operations use the same connection method
 */

const imaps = require('imap-simple');
const { decryptPassword } = require('./encryption');

/**
 * Connect to IMAP server
 * @param {Object} account - Email account object from database
 * @returns {Promise<Object>} - node-imap compatible connection
 */
async function connectToImap(account) {
  try {
    const password = decryptPassword(account.imap_password);

    const config = {
      imap: {
        user: account.imap_username || account.email,
        password,
        host: account.imap_host,
        port: account.imap_port || 993,
        tls: account.use_ssl !== false,
        authTimeout: 10000,
        connTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
      }
    };

    return await imaps.connect(config);
  } catch (err) {
    console.error('IMAP Connection Error:', err);
    throw new Error('Failed to connect to IMAP: ' + err.message);
  }
}

/**
 * Validate IMAP connection with credentials
 * Used for testing connections before saving accounts
 * @param {Object} config - Connection config with email, password, host, port, useSsl
 * @returns {Promise<boolean>} - True if connection successful
 */
async function validateImap({ email, password, host, port, useSsl }) {
  const config = {
    imap: {
      user: email,
      password,
      host,
      port: port || 993,
      tls: useSsl !== false,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 15000, // Increased timeout
      connTimeout: 15000,
      keepalive: true
    }
  };

  let connection = null;
  try {
    console.log(`[VALIDATE IMAP] Testing connection to ${host}:${port || 993} for ${email}`);
    connection = await imaps.connect(config);
    console.log(`[VALIDATE IMAP] ✅ Connection successful`);
    
    // Try to open INBOX to verify full connection works
    try {
      await connection.openBox('INBOX');
      console.log(`[VALIDATE IMAP] ✅ INBOX opened successfully`);
    } catch (openError) {
      console.warn(`[VALIDATE IMAP] ⚠️  Could not open INBOX:`, openError.message);
      // Still consider it valid if connection was established
    }
    
    if (connection) {
      try {
        await connection.end();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    return true;
  } catch (error) {
    console.error(`[VALIDATE IMAP] ❌ Validation failed:`, error.message);
    
    // Provide more helpful error message
    let errorMessage = error.message;
    if (error.message?.includes('Connection ended unexpectedly') || error.message?.includes('connection closed')) {
      errorMessage = 'Connection closed unexpectedly. This usually means invalid credentials. Please verify your email and app password.';
    } else if (error.message?.includes('authentication') || error.message?.includes('credentials') || error.message?.includes('LOGIN') || error.message?.includes('AUTHENTICATIONFAILED')) {
      errorMessage = 'Authentication failed. Please check your email and password.';
    } else if (error.message?.includes('ECONNREFUSED')) {
      errorMessage = 'Connection refused. Please check the IMAP host and port.';
    } else if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timeout')) {
      errorMessage = 'Connection timeout. Please check your network connection.';
    }
    
    if (connection) {
      try {
        await connection.end();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    // Create a new error with the improved message
    const improvedError = new Error(errorMessage);
    improvedError.originalError = error;
    throw improvedError;
  }
}

module.exports = { connectToImap, validateImap };

