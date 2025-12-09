/**
 * Test Encryption Utility
 * Verifies that encryption/decryption is working correctly
 * 
 * Usage: node test-encryption.js
 */

require('dotenv').config();
const { encryptPassword, decryptPassword } = require('./src/utils/encryption');

console.log('\n' + '='.repeat(60));
console.log('🔐 ENCRYPTION TEST');
console.log('='.repeat(60));

// Check if ENCRYPTION_KEY is set
if (!process.env.ENCRYPTION_KEY) {
  console.error('\n❌ ERROR: ENCRYPTION_KEY not set in .env');
  console.log('\nRun: node scripts/generateEncryptionKey.js');
  console.log('Then add the output to your .env file\n');
  process.exit(1);
}

// Check key length
const keyLength = process.env.ENCRYPTION_KEY.length;
if (keyLength !== 64) {
  console.error(`\n❌ ERROR: ENCRYPTION_KEY must be 64 characters, got ${keyLength}`);
  console.log('\nRun: node scripts/generateEncryptionKey.js');
  console.log('Then add the output to your .env file\n');
  process.exit(1);
}

console.log('\n✅ ENCRYPTION_KEY is set and has correct length');

// Test encryption
try {
  const originalPassword = 'test123password';
  console.log('\n📝 Original password:', originalPassword);

  const encrypted = encryptPassword(originalPassword);
  console.log('🔒 Encrypted:', encrypted);

  // Test decryption
  const decrypted = decryptPassword(encrypted);
  console.log('🔓 Decrypted:', decrypted);

  // Verify match
  if (originalPassword === decrypted) {
    console.log('\n✅ SUCCESS: Encryption/Decryption working correctly!');
    console.log('✅ Match:', originalPassword === decrypted);
  } else {
    console.error('\n❌ ERROR: Decrypted password does not match original!');
    process.exit(1);
  }
} catch (error) {
  console.error('\n❌ ERROR:', error.message);
  console.error('\nStack:', error.stack);
  process.exit(1);
}

console.log('\n' + '='.repeat(60) + '\n');

