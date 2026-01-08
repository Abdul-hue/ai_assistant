/**
 * Database Cleanup Script
 * Removes orphaned emails and sync states that reference non-existent accounts
 * 
 * Usage: node backend/scripts/cleanup-db.js
 * Or: npm run cleanup-db
 */

// ✅ Load environment variables first
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { supabaseAdmin } = require('../src/config/supabase');

async function cleanupDatabase() {
  console.log('🧹 Starting database cleanup...\n');

  try {
    // Step 1: Get all account IDs first (more reliable approach)
    console.log('📧 Checking for orphaned emails...');
    const { data: accounts } = await supabaseAdmin
      .from('email_accounts')
      .select('id');

    const accountIds = accounts?.map(a => a.id) || [];

    if (accountIds.length === 0) {
      console.log('⚠️  No accounts found. Skipping cleanup.');
      return;
    }

    console.log(`   Found ${accountIds.length} valid accounts`);

    // Find orphaned emails (emails referencing non-existent accounts)
    const { data: allEmails } = await supabaseAdmin
      .from('emails')
      .select('id, email_account_id');

    const orphanedEmails = (allEmails || []).filter(
      email => !accountIds.includes(email.email_account_id)
    );

    if (orphanedEmails.length > 0) {
      console.log(`   Found ${orphanedEmails.length} orphaned emails`);
      const orphanedIds = orphanedEmails.map(e => e.id);
      
      const { error: deleteError } = await supabaseAdmin
        .from('emails')
        .delete()
        .in('id', orphanedIds);

      if (deleteError) {
        console.error('   ❌ Error deleting orphaned emails:', deleteError.message);
      } else {
        console.log(`   ✅ Deleted ${orphanedEmails.length} orphaned emails`);
      }
    } else {
      console.log('   ✅ No orphaned emails found');
    }

    // Step 2: Find and delete orphaned sync states
    console.log('\n📊 Checking for orphaned sync states...');
    const { data: allSyncStates } = await supabaseAdmin
      .from('email_sync_state')
      .select('id, account_id');

    const orphanedSyncStates = allSyncStates?.filter(
      state => !accountIds.includes(state.account_id)
    ) || [];

    if (orphanedSyncStates.length > 0) {
      console.log(`   Found ${orphanedSyncStates.length} orphaned sync states`);
      const orphanedIds = orphanedSyncStates.map(s => s.id);
      
      const { error: deleteError } = await supabaseAdmin
        .from('email_sync_state')
        .delete()
        .in('id', orphanedIds);

      if (deleteError) {
        console.error('   ❌ Error deleting orphaned sync states:', deleteError.message);
      } else {
        console.log(`   ✅ Deleted ${orphanedSyncStates.length} orphaned sync states`);
      }
    } else {
      console.log('   ✅ No orphaned sync states found');
    }

    // Step 3: Summary
    console.log('\n✅ Database cleanup completed!');
    console.log(`   Total accounts: ${accountIds.length}`);
    console.log(`   Orphaned emails removed: ${orphanedEmails.length}`);
    console.log(`   Orphaned sync states removed: ${orphanedSyncStates.length}`);

  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
  }
}

// Run cleanup
if (require.main === module) {
  cleanupDatabase()
    .then(() => {
      console.log('\n🎉 Cleanup script finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupDatabase };

