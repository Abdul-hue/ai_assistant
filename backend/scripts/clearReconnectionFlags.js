/**
 * Clear needs_reconnection flags for all email accounts
 * Run this script to reset accounts stuck in reconnection loop
 * 
 * Usage: node backend/scripts/clearReconnectionFlags.js
 *        OR: cd backend && node scripts/clearReconnectionFlags.js
 */

const path = require('path');
const fs = require('fs');

// ✅ FIX: Load .env from backend directory (works from root or backend dir)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  // Fallback: try root directory .env
  const rootEnvPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(rootEnvPath)) {
    require('dotenv').config({ path: rootEnvPath });
  } else {
    // Last resort: just load from current directory
    require('dotenv').config();
  }
}

const { supabaseAdmin } = require('../src/config/supabase');

async function clearReconnectionFlags() {
  console.log('🔧 Clearing needs_reconnection flags...');
  
  const { data, error } = await supabaseAdmin
    .from('email_accounts')
    .update({
      needs_reconnection: false,
      last_error: null,
      sync_status: 'idle'
    })
    .eq('needs_reconnection', true)
    .select('email');
  
  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
  
  console.log(`✅ Cleared flags for ${data?.length || 0} accounts`);
  if (data && data.length > 0) {
    data.forEach(acc => console.log(`   - ${acc.email}`));
  }
  
  process.exit(0);
}

clearReconnectionFlags();

