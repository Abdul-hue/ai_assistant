const { fetchEmails } = require('./imapSmtpService');
const { supabaseAdmin } = require('../config/supabase');

/**
 * Comprehensive Email Sync Service
 * Syncs ALL folders when user first connects email account
 * Uses existing fetchEmails function for reliability
 */

/**
 * Main function: Sync all folders for newly connected account
 */
async function comprehensiveFolderSync(accountId, userId, io = null) {
  console.log(`\n========================================`);
  console.log(`[COMPREHENSIVE SYNC] Starting for account ${accountId}`);
  console.log(`========================================\n`);

  try {
    // 1. Check if already completed
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error('Email account not found');
    }

    // Check if comprehensive sync already done
    if (account.comprehensive_sync_completed) {
      console.log(`[COMPREHENSIVE SYNC] ✅ Already completed for ${account.email}, skipping`);
      return { success: true, skipped: true, message: 'Already completed' };
    }

    if (account.comprehensive_sync_status === 'in_progress') {
      console.log(`[COMPREHENSIVE SYNC] ⏳ Already in progress for ${account.email}, skipping`);
      return { success: true, skipped: true, message: 'Already in progress' };
    }

    // 2. Mark as started
    await updateSyncStatus(accountId, 'in_progress', {
      started_at: new Date().toISOString()
    });

    // Notify frontend
    if (io && userId) {
      io.to(userId).emit('comprehensive_sync_started', {
        accountId,
        email: account.email
      });
    }

    // 3. Get all folders
    console.log(`[COMPREHENSIVE SYNC] Fetching folder list...`);
    const { getFolders } = require('./imapSmtpService');
    const foldersResult = await getFolders(accountId);
    
    if (!foldersResult.success) {
      throw new Error(`Failed to get folders: ${foldersResult.error}`);
    }

    // Extract folder names and filter out non-selectable folders
    const allFolders = (foldersResult.folders || [])
      .map(f => f.name || f)
      .filter(folderName => {
        // Filter out [Gmail] parent folder (not selectable)
        if (folderName === '[Gmail]') {
          return false;
        }
        // Only include folders that are actually selectable
        const folder = foldersResult.folders.find(f => (f.name || f) === folderName);
        if (folder && folder.attributes) {
          // Skip if marked as \Noselect
          return !folder.attributes.includes('\\Noselect');
        }
        return true;
      });
    
    console.log(`[COMPREHENSIVE SYNC] Found ${allFolders.length} selectable folders:`, allFolders);

    // 4. Sync each folder
    const syncResults = {
      total: allFolders.length,
      completed: 0,
      failed: 0,
      totalEmails: 0,
      folders: {}
    };

    for (const folderName of allFolders) {
      try {
        console.log(`\n[COMPREHENSIVE SYNC] 📂 Syncing: ${folderName} (${syncResults.completed + 1}/${allFolders.length})`);
        
        // ✅ Add timeout to prevent getting stuck on large folders
        const syncPromise = syncSingleFolder(accountId, folderName);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Sync timeout after 60 seconds')), 60000)
        );
        
        const result = await Promise.race([syncPromise, timeoutPromise]);
        
        syncResults.folders[folderName] = {
          status: 'completed',
          count: result.count || 0,
          completed_at: new Date().toISOString()
        };
        syncResults.completed++;
        syncResults.totalEmails += result.count || 0;

        // Update progress
        await updateSyncProgress(accountId, syncResults.folders);

        // Notify frontend
        if (io && userId) {
          io.to(userId).emit('comprehensive_sync_progress', {
            accountId,
            folder: folderName,
            count: result.count,
            progress: {
              current: syncResults.completed,
              total: syncResults.total,
              percentage: Math.round((syncResults.completed / syncResults.total) * 100)
            }
          });
        }

        console.log(`[COMPREHENSIVE SYNC] ✅ ${folderName}: ${result.count || 0} emails (${syncResults.completed}/${allFolders.length} folders done)`);
        
        // Small delay to avoid IMAP throttling
        await sleep(1000);

      } catch (error) {
        console.error(`[COMPREHENSIVE SYNC] ❌ Error syncing ${folderName}:`, error.message);
        syncResults.folders[folderName] = {
          status: 'failed',
          error: error.message,
          failed_at: new Date().toISOString()
        };
        syncResults.failed++;
        // Continue with other folders - don't let one folder failure stop the whole sync
        console.log(`[COMPREHENSIVE SYNC] ⏭️  Continuing with next folder...`);
      }
    }

    // 5. Mark as completed
    await updateSyncStatus(accountId, 'completed', {
      completed_at: new Date().toISOString(),
      total_emails: syncResults.totalEmails,
      total_folders: syncResults.completed
    });

    console.log(`\n========================================`);
    console.log(`[COMPREHENSIVE SYNC] ✅ COMPLETED`);
    console.log(`Folders: ${syncResults.completed}/${syncResults.total}`);
    console.log(`Emails: ${syncResults.totalEmails}`);
    console.log(`Failed: ${syncResults.failed}`);
    console.log(`========================================\n`);

    // Notify frontend
    if (io && userId) {
      io.to(userId).emit('comprehensive_sync_completed', {
        accountId,
        email: account.email,
        results: syncResults
      });
    }

    return { success: true, results: syncResults };

  } catch (error) {
    console.error(`[COMPREHENSIVE SYNC] ❌ Fatal error:`, error);
    await updateSyncStatus(accountId, 'failed', {
      error: error.message,
      failed_at: new Date().toISOString()
    });
    return { success: false, error: error.message };
  }
}

/**
 * Sync single folder using existing fetchEmails function
 */
async function syncSingleFolder(accountId, folderName) {
  try {
    console.log(`[COMPREHENSIVE SYNC] ${folderName}: Starting sync...`);
    
    // ✅ CRITICAL: Use forceRefresh=true to ensure we fetch 20 most recent emails
    // This prevents fetchEmails from trying to fetch ALL messages when there's no sync state
    // forceRefresh forces it to use FORCE_REFRESH mode which fetches only the last 20 emails
    console.log(`[COMPREHENSIVE SYNC] ${folderName}: Calling fetchEmails with forceRefresh=true`);
    const result = await fetchEmails(accountId, folderName, {
      limit: 20,
      headersOnly: false,
      forceRefresh: true // ✅ Force FORCE_REFRESH mode for each folder (fetches only 20 most recent)
    });

    if (!result.success) {
      throw new Error(result.error || 'Fetch failed');
    }

    const emailCount = result.savedCount || result.count || 0;
    console.log(`[COMPREHENSIVE SYNC] ${folderName}: Synced ${emailCount} emails`);
    
    // ✅ Mark this folder as initially synced in email_sync_state
    // This ensures background sync knows this folder has been synced
    try {
      const { data: syncState } = await supabaseAdmin
        .from('email_sync_state')
        .select('initial_sync_completed')
        .eq('account_id', accountId)
        .eq('folder_name', folderName)
        .maybeSingle();
      
      if (!syncState?.initial_sync_completed) {
        await supabaseAdmin
          .from('email_sync_state')
          .upsert({
            account_id: accountId,
            folder_name: folderName,
            initial_sync_completed: true,
            initial_sync_date: new Date().toISOString()
          }, {
            onConflict: 'account_id,folder_name'
          });
        console.log(`[COMPREHENSIVE SYNC] ✅ Marked ${folderName} as initially synced`);
      }
    } catch (markError) {
      console.warn(`[COMPREHENSIVE SYNC] ⚠️  Error marking ${folderName} as synced:`, markError.message);
      // Don't fail the whole sync if marking fails
    }
    
    return { count: emailCount };
    
  } catch (error) {
    console.error(`[COMPREHENSIVE SYNC] Error in ${folderName}:`, error.message);
    throw error;
  }
}

/**
 * Update sync status
 */
async function updateSyncStatus(accountId, status, metadata = {}) {
  const updates = { comprehensive_sync_status: status };

  if (status === 'in_progress') {
    updates.comprehensive_sync_started_at = metadata.started_at;
  } else if (status === 'completed') {
    updates.comprehensive_sync_completed = true;
    updates.comprehensive_sync_completed_at = metadata.completed_at;
  }

  const { error } = await supabaseAdmin
    .from('email_accounts')
    .update(updates)
    .eq('id', accountId);

  if (error) {
    console.error('[COMPREHENSIVE SYNC] Error updating status:', error);
  }
}

/**
 * Update sync progress
 */
async function updateSyncProgress(accountId, progress) {
  const { error } = await supabaseAdmin
    .from('email_accounts')
    .update({ comprehensive_sync_progress: progress })
    .eq('id', accountId);

  if (error) {
    console.error('[COMPREHENSIVE SYNC] Error updating progress:', error);
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  comprehensiveFolderSync
};
