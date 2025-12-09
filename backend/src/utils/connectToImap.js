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
      authTimeout: 10000,
      connTimeout: 10000
    }
  };

  let connection = null;
  try {
    connection = await imaps.connect(config);
    await connection.end();
    return true;
  } catch (error) {
    console.error('IMAP validation error:', error);
    if (connection) {
      try {
        await connection.end();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}

module.exports = { connectToImap, validateImap };

