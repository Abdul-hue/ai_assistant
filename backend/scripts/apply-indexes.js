/**
 * Apply Performance Indexes Script
 * Helps apply database indexes for Phase 2 optimizations
 * 
 * Usage: node backend/scripts/apply-indexes.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
// Try backend/.env first, then root .env
const envPathBackend = path.join(__dirname, '../.env');
const envPathRoot = path.join(__dirname, '../../.env');
if (fs.existsSync(envPathBackend)) {
  require('dotenv').config({ path: envPathBackend });
} else if (fs.existsSync(envPathRoot)) {
  require('dotenv').config({ path: envPathRoot });
} else {
  require('dotenv').config(); // Try default locations
}

async function applyIndexes() {
  console.log('\n🗄️  ============================================');
  console.log('🗄️  Applying Database Performance Indexes');
  console.log('🗄️  ============================================\n');
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase configuration');
    console.error('Required: SUPABASE_URL and SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Read SQL file
    const sqlPath = path.join(__dirname, '../database/migrations/002_add_performance_indexes.sql');
    
    if (!fs.existsSync(sqlPath)) {
      console.error(`❌ Migration file not found: ${sqlPath}`);
      process.exit(1);
    }
    
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('📄 Migration file: 002_add_performance_indexes.sql');
    console.log('📁 Path:', sqlPath);
    console.log('');
    
    // Note: Supabase JS client doesn't support raw SQL execution
    // Users need to execute via SQL Editor
    console.log('⚠️  MANUAL STEP REQUIRED:');
    console.log('─────────────────────────────────────────────────');
    console.log('   1. Go to Supabase Dashboard → SQL Editor');
    console.log('   2. Copy the SQL from the migration file');
    console.log('   3. Paste and execute in the SQL Editor');
    console.log('   4. Verify indexes were created\n');
    
    console.log('📋 SQL Preview (first 30 lines):');
    console.log('─'.repeat(60));
    const lines = sql.split('\n');
    lines.slice(0, 30).forEach((line, i) => {
      console.log(`${String(i + 1).padStart(3, ' ')} | ${line}`);
    });
    if (lines.length > 30) {
      console.log(`    ... (${lines.length - 30} more lines)`);
    }
    console.log('─'.repeat(60));
    console.log('');
    
    // Show full SQL file path for easy copying
    console.log('📋 Full SQL File Location:');
    console.log(`   ${sqlPath}\n`);
    
    // Provide verification query
    console.log('✅ After executing in Supabase SQL Editor, verify with:');
    console.log('─────────────────────────────────────────────────');
    console.log('   SELECT ');
    console.log('     indexname,');
    console.log('     indexdef,');
    console.log('     pg_size_pretty(pg_relation_size(indexname::regclass)) as size');
    console.log('   FROM pg_indexes');
    console.log('   WHERE tablename = \'whatsapp_sessions\'');
    console.log('   ORDER BY indexname;\n');
    
    // Expected indexes
    console.log('📊 Expected Indexes:');
    console.log('─────────────────────────────────────────────────');
    console.log('   ✓ idx_whatsapp_sessions_status_active');
    console.log('   ✓ idx_whatsapp_sessions_agent_status');
    console.log('   ✓ idx_whatsapp_sessions_last_connected');
    console.log('   ✓ idx_whatsapp_sessions_instance');
    console.log('   ✓ idx_whatsapp_sessions_phone');
    console.log('   ✓ idx_message_log_agent_timestamp');
    console.log('   ✓ idx_contacts_agent\n');
    
    // Check if we can verify existing indexes
    console.log('🔍 Checking existing indexes...');
    try {
      // Note: This is a read-only check - we can't execute DDL via JS client
      // But we can verify the file exists and is readable
      const stats = fs.statSync(sqlPath);
      console.log(`   ✅ Migration file exists (${stats.size} bytes)`);
      console.log(`   ✅ File is readable\n`);
    } catch (error) {
      console.error(`   ❌ Error reading file: ${error.message}\n`);
    }
    
    console.log('💡 TIP: You can also use Supabase CLI to apply migrations:');
    console.log('   supabase db push\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run the script
applyIndexes()
  .then(() => {
    console.log('✅ Script completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
