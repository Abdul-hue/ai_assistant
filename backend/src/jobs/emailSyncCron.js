/**
 * Email Sync Cron Job
 * Runs scheduled email sync every 10 minutes
 * Uses the same sync logic as the manual sync button (syncNewEmailsOnly)
 */

const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');
const { syncNewEmailsOnly } = require('../services/backgroundSyncService');

/**
 * Start the email sync cron job
 * Runs every 10 minutes - syncs INBOX folder for all active accounts
 * This matches the behavior of the manual "Sync from IMAP" button
 */
function startEmailSyncCron() {
  // Run every 10 minutes: */10 * * * *
  cron.schedule('*/10 * * * *', async () => {
    console.log('[CRON] 🔄 Starting automatic email sync (every 10 minutes)...');
    const startTime = Date.now();
    
    try {
      // Get all active IMAP accounts
      const { data: accounts, error } = await supabaseAdmin
        .from('email_accounts')
        .select('id, email, is_active, needs_reconnection')
        .eq('is_active', true)
        .not('imap_host', 'is', null)
        .not('imap_username', 'is', null);

      if (error) {
        console.error('[CRON] ❌ Error fetching accounts:', error.message);
        throw error;
      }

      if (!accounts || accounts.length === 0) {
        console.log('[CRON] ℹ️  No active accounts to sync');
        return;
      }

      console.log(`[CRON] 📊 Found ${accounts.length} active account(s) to sync`);

      // Sync each account's INBOX folder (same as manual sync button)
      let totalSynced = 0;
      let successCount = 0;
      let errorCount = 0;

      for (const account of accounts) {
        try {
          // ✅ FIX: Check if IDLE is actually in IDLE mode (not just monitoring)
          // If IDLE is just polling (not real IDLE mode), we should still sync via cron
          const appModule = require('../../app');
          const idleManager = appModule.idleManager || appModule.default?.idleManager;
          let shouldSkip = false;
          
          if (idleManager && idleManager.activeConnections.has(account.id)) {
            const connectionData = idleManager.activeConnections.get(account.id);
            // Only skip if IDLE is actually in IDLE mode (idleStarted = true)
            // If IDLE is just polling (idleStarted = false), we should sync via cron
            if (connectionData && connectionData.idleStarted === true) {
              console.log(`[CRON] ⏭️  Skipping ${account.email} - IDLE mode is active (real-time detection)`);
              shouldSkip = true;
            } else {
              console.log(`[CRON] ℹ️  IDLE is monitoring ${account.email} but not in IDLE mode (polling only), syncing via cron...`);
            }
          }
          
          if (shouldSkip) {
            continue;
          }

          console.log(`[CRON] 🔄 Syncing INBOX for ${account.email}...`);
          
          // Use the same sync function as the manual button
          const count = await syncNewEmailsOnly(account.id, 'INBOX');
          
          totalSynced += count;
          successCount++;
          
          if (count > 0) {
            console.log(`[CRON] ✅ Synced ${count} new email(s) for ${account.email}`);
          } else {
            console.log(`[CRON] ✅ No new emails for ${account.email}`);
          }
        } catch (accountError) {
          errorCount++;
          console.error(`[CRON] ❌ Error syncing ${account.email}:`, accountError.message);
          // Continue with next account instead of failing entire sync
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[CRON] ✅ Automatic sync completed in ${duration}s: ${totalSynced} total new emails, ${successCount} accounts synced, ${errorCount} errors`);
      
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[CRON] ❌ Automatic sync failed after ${duration}s:`, error.message);
      console.error('[CRON] Stack:', error.stack);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });
  
  console.log('[CRON] ✅ Automatic email sync cron job started (runs every 10 minutes)');
  console.log('[CRON] 📝 This will automatically sync INBOX folder for all active accounts');
  console.log('[CRON] 📝 Same behavior as the manual "Sync from IMAP" button');
}

module.exports = { startEmailSyncCron };

