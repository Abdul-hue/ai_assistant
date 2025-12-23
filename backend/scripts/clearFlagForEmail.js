/**
 * Clear needs_reconnection flag for a specific email account
 * 
 * Usage: node backend/scripts/clearFlagForEmail.js wasay2805@gmail.com
 */

const path = require('path');
const fs = require('fs');

// Load .env from backend directory
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  const rootEnvPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(rootEnvPath)) {
    require('dotenv').config({ path: rootEnvPath });
  } else {
    require('dotenv').config();
  }
}

const { supabaseAdmin } = require('../src/config/supabase');

async function clearFlagForEmail(email) {
  if (!email) {
    console.error('❌ Please provide an email address');
    console.log('Usage: node backend/scripts/clearFlagForEmail.js email@example.com');
    process.exit(1);
  }
  
  console.log(`🔧 Clearing needs_reconnection flag for ${email}...`);
  
  const { data, error } = await supabaseAdmin
    .from('email_accounts')
    .update({
      needs_reconnection: false,
      last_error: null,
      sync_status: 'idle'
    })
    .eq('email', email)
    .select('id, email');
  
  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
  
  if (!data || data.length === 0) {
    console.log(`⚠️  No account found with email: ${email}`);
    process.exit(1);
  }
  
  console.log(`✅ Cleared flag for ${data[0].email} (ID: ${data[0].id})`);
  process.exit(0);
}

const email = process.argv[2];
clearFlagForEmail(email);

