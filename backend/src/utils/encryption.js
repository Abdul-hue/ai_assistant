/**
 * Encryption Utility
 * Provides secure password encryption/decryption using AES-256-CBC
 * 
 * Requirements:
 * - ENCRYPTION_KEY must be set in environment variables
 * - ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)
 */

const crypto = require('crypto');

/**
 * Encrypt a password using AES-256-CBC
 * @param {string} password - The password to encrypt
 * @returns {string} - Encrypted password in format: iv:encryptedData
 */
function encryptPassword(password) {
  try {
    const encryptionKey = process.env.ENCRYPTION_KEY;

    // Validate key exists
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not set in environment variables');
    }

    // Validate key length (must be 64 hex characters = 32 bytes)
    if (encryptionKey.length !== 64) {
      throw new Error(
        `ENCRYPTION_KEY must be 64 hex characters (32 bytes). Got ${encryptionKey.length} characters. ` +
        `Run: node scripts/generateEncryptionKey.js to generate a new key.`
      );
    }

    // Convert hex string to buffer
    const keyBuffer = Buffer.from(encryptionKey, 'hex');

    // Validate buffer length
    if (keyBuffer.length !== 32) {
      throw new Error(
        `ENCRYPTION_KEY must be exactly 32 bytes. Got ${keyBuffer.length} bytes. ` +
        `Run: node scripts/generateEncryptionKey.js to generate a new key.`
      );
    }

    // Generate random IV (Initialization Vector) - 16 bytes for AES
    const iv = crypto.randomBytes(16);

    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);

    // Encrypt the password
    let encrypted = cipher.update(password, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    // Return iv:encrypted format
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('❌ Encryption error:', error.message);
    throw error;
  }
}

/**
 * Decrypt a password
 * @param {string} encryptedPassword - Encrypted password in format: iv:encryptedData
 * @returns {string} - Decrypted password
 */
function decryptPassword(encryptedPassword) {
  try {
    const encryptionKey = process.env.ENCRYPTION_KEY;

    // Validate key exists
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not set in environment variables');
    }

    // Validate key length
    if (encryptionKey.length !== 64) {
      throw new Error(
        `ENCRYPTION_KEY must be 64 hex characters (32 bytes). Got ${encryptionKey.length} characters. ` +
        `Run: node scripts/generateEncryptionKey.js to generate a new key.`
      );
    }

    // Handle legacy unencrypted passwords (backward compatibility)
    if (!encryptedPassword.includes(':')) {
      console.warn('⚠️  Password appears to be unencrypted (legacy format)');
      return encryptedPassword;
    }

    // Split iv and encrypted data
    const [ivHex, encryptedHex] = encryptedPassword.split(':');

    if (!ivHex || !encryptedHex) {
      throw new Error('Invalid encrypted password format. Expected: iv:encryptedData');
    }

    // Convert from hex to buffer
    const keyBuffer = Buffer.from(encryptionKey, 'hex');
    const iv = Buffer.from(ivHex, 'hex');

    // Validate buffer lengths
    if (keyBuffer.length !== 32) {
      throw new Error(`Invalid key buffer length: ${keyBuffer.length}, expected 32`);
    }

    if (iv.length !== 16) {
      throw new Error(`Invalid IV buffer length: ${iv.length}, expected 16`);
    }

    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);

    // Decrypt
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  } catch (error) {
    console.error('❌ Decryption error:', error.message);
    throw error;
  }
}

module.exports = {
  encryptPassword,
  decryptPassword,
};

