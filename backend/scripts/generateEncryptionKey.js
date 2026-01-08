/**
 * Generate Encryption Key Script
 * Generates a secure 256-bit (32-byte) encryption key for AES-256-CBC
 * 
 * Usage: node scripts/generateEncryptionKey.js
 */

const crypto = require('crypto');

// Generate a random 256-bit (32-byte) key
const encryptionKey = crypto.randomBytes(32).toString('hex');

console.log('\n' + '='.repeat(60));
console.log('🔐 ENCRYPTION KEY GENERATOR');
console.log('='.repeat(60));
console.log('\nAdd this to your .env file:');
console.log(`\nENCRYPTION_KEY=${encryptionKey}\n`);
console.log('='.repeat(60));
console.log('\n✅ Key length:', encryptionKey.length, 'characters (64 hex = 32 bytes)');
console.log('✅ Key format: Valid hex string');
console.log('✅ Algorithm: AES-256-CBC compatible\n');

