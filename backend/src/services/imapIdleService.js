/**
 * IMAP IDLE Service
 * Real-time email monitoring using IDLE and polling
 */

const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const { supabaseAdmin } = require('../config/supabase');
const { connectToImap } = require('../utils/connectToImap');
const { parseEmailFromImap, saveOrUpdateEmail } = require('./imapEmailSyncService');
const { callEmailWebhook } = require('../utils/emailWebhook');
const { retryWithBackoff, isThrottlingError, isConnectionError } = require('../utils/imapRetry');

// ============================================
// IDLE MANAGER CLASS
// ============================================

class ImapIdleManager {
  constructor(wsManager) {
    this.activeConnections = new Map(); // accountId -> {connection, folders, openFolder}
    this.wsManager = wsManager;
    this.monitoringIntervals = new Map();
    // Track connection failures to prevent endless retry loops
    this.connectionFailureCount = new Map(); // accountId -> failure count
    this.lastFailureTime = new Map(); // accountId -> timestamp
    this.maxFailures = 3; // Stop after 3 consecutive failures
    this.cooldownPeriod = 5 * 60 * 1000; // 5 minutes cooldown after failures
  }

  // ============================================
  // START IDLE MONITORING
  // ============================================

  /**
   * Start IDLE monitoring for account
   */
  async startIdleMonitoring(account) {
    try {
      // ✅ CRITICAL: Validate account exists and is active
      if (!account || !account.id) {
        console.error(`[IDLE] ❌ Invalid account provided: ${account?.email || 'unknown'}`);
        return;
      }

      // ✅ CRITICAL: Prevent multiple instances from starting
      if (this.activeConnections.has(account.id)) {
        console.log(`[IDLE] ⏭️  Already monitoring account ${account.email}. Skipping duplicate start.`);
        return;
      }

      // Verify account still exists in database
      const { data: accountData, error: accountError } = await supabaseAdmin
        .from('email_accounts')
        .select('*')
        .eq('id', account.id)
        .eq('is_active', true)
        .single();

      if (accountError || !accountData) {
        console.error(`[IDLE] ❌ Account ${account.id} (${account.email || 'unknown'}) not found or inactive. Skipping IDLE setup.`);
        return;
      }

      // ✅ CRITICAL: Check if account needs reconnection before attempting connection
      if (accountData.needs_reconnection) {
        console.log(`[IDLE] ⏭️  Skipping IDLE start for ${account.email} - account needs reconnection`);
        return;
      }

      console.log(`[IDLE] Starting IDLE monitoring for ${account.email}`);

      // Connect to IMAP with error handling
      let connection;
      try {
        connection = await connectToImap(account);
      } catch (connectError) {
        // ✅ Handle "Connection ended unexpectedly" - likely rate limiting
        if (connectError.message?.includes('Connection ended unexpectedly') || 
            connectError.message?.includes('ended unexpectedly')) {
          console.error(`[IDLE] ❌ Connection ended unexpectedly for ${account.email}. Likely rate limiting. Marking as needs_reconnection.`);
          await supabaseAdmin
            .from('email_accounts')
            .update({
              needs_reconnection: true,
              last_error: `Connection ended unexpectedly - possible rate limiting. Please wait 10-15 minutes and try again.`,
              last_connection_attempt: new Date().toISOString()
            })
            .eq('id', account.id);
          return; // Don't start IDLE
        }
        throw connectError; // Re-throw other errors
      }

      // Get folders to monitor
      const boxes = await connection.getBoxes();
      const folders = this.flattenFolders(boxes);

      // Store connection info
      this.activeConnections.set(account.id, {
        connection,
        account,
        folders: folders.filter(f => !f.attributes?.includes('\\Noselect')),
        monitoring: true,
      });

      // Start monitoring
      await this.monitorFolders(account.id);

<<<<<<< Updated upstream
      console.log(`[IDLE] IDLE monitoring started for ${account.email}`);
=======
      // ✅ Open INBOX folder
      await connection.openBox('INBOX');
      console.log(`[IDLE] ✅ INBOX opened for ${account.email}`);
      
      // ✅ CRITICAL: Set up mail listener BEFORE starting IDLE mode
      // The listener must be registered before IDLE starts to catch events
      connection.imap.on('mail', async (numNewMsgs) => {
        const accountEmail = account.email;
        const accountIdFromClosure = account.id;
        console.log(`[IDLE] 📧 ${accountEmail} received ${numNewMsgs} new email(s)`);
        
        // ✅ FIX: Get account from connectionData (most up-to-date) or use closure variable
        const connectionData = this.activeConnections.get(accountIdFromClosure);
        const currentAccount = connectionData?.account || account;
        
        // ✅ FIX: Run sync in background without blocking IDLE connection
        // This ensures sync completes even if IDLE connection ends
        (async () => {
          try {
          // ✅ FIX: Get fresh account data - try by ID first, then by email as fallback
          let freshAccount = null;
          
          console.log(`[IDLE] 🔍 Looking up account: ID=${currentAccount.id}, email=${currentAccount.email || accountEmail}`);
          
          // First try: Look up by account ID from connectionData
          const { data: accountById, error: idError } = await supabaseAdmin
            .from('email_accounts')
            .select('id, email, user_id, is_active')
            .eq('id', currentAccount.id)
            .eq('is_active', true)
            .single();
          
          if (idError && idError.code !== 'PGRST116') {
            console.error(`[IDLE] ❌ Error looking up account by ID ${currentAccount.id}:`, idError.message);
          }
          
          if (accountById) {
            freshAccount = accountById;
            console.log(`[IDLE] ✅ Found account by ID: ${freshAccount.id}`);
          } else {
            // Fallback: Look up by email (account may have been reconnected with new ID)
            console.log(`[IDLE] ⚠️  Account ${currentAccount.id} not found, trying lookup by email: ${currentAccount.email || accountEmail}`);
            const { data: accountByEmail, error: emailError } = await supabaseAdmin
              .from('email_accounts')
              .select('id, email, user_id, is_active')
              .eq('email', currentAccount.email || accountEmail)
              .eq('is_active', true)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (emailError) {
              console.error(`[IDLE] ❌ Error looking up account by email:`, emailError.message);
            }
            
            if (accountByEmail) {
              freshAccount = accountByEmail;
              console.log(`[IDLE] ✅ Found account by email: ${freshAccount.id} (old ID was ${currentAccount.id})`);
              // Update the connectionData account ID for future lookups
              if (connectionData) {
                connectionData.account.id = freshAccount.id;
                connectionData.account.email = freshAccount.email;
                // Also update the activeConnections map with new ID if different
                if (freshAccount.id !== currentAccount.id) {
                  this.activeConnections.set(freshAccount.id, connectionData);
                  this.activeConnections.delete(currentAccount.id);
                }
              }
            } else {
              console.error(`[IDLE] ❌ Account ${currentAccount.id} (${currentAccount.email || accountEmail}) not found in database`);
              return; // Don't stop IDLE, just skip this sync
            }
          }
          
          if (!freshAccount) {
            console.error(`[IDLE] ❌ Could not find account for ${currentAccount.email || accountEmail}, aborting sync`);
        return;
      }
          
          // Trigger background sync for this specific account/folder
          const { syncNewEmailsOnly } = require('./backgroundSyncService');
          console.log(`[IDLE] 🔄 Triggering sync for account ${freshAccount.id} (${freshAccount.email})`);
          
          const count = await syncNewEmailsOnly(freshAccount.id, 'INBOX');
          
          console.log(`[IDLE] ✅ Synced ${count} new emails for ${freshAccount.email}`);
          
          // Notify frontend via WebSocket
          if (this.wsManager && freshAccount.user_id) {
            this.wsManager.io.to(freshAccount.user_id).emit('new_emails', {
              accountId: freshAccount.id,
              accountEmail: freshAccount.email,
              count,
              folder: 'INBOX',
              timestamp: new Date().toISOString()
            });
            console.log(`[IDLE] 📡 Sent WebSocket notification to user ${freshAccount.user_id}`);
          } else {
            console.warn(`[IDLE] ⚠️  Cannot send WebSocket notification: wsManager=${!!this.wsManager}, user_id=${freshAccount.user_id}`);
          }
          } catch (syncError) {
            console.error(`[IDLE] ❌ Sync error for ${accountEmail}:`, syncError.message);
            console.error(`[IDLE] Stack:`, syncError.stack);
            // Don't throw - keep IDLE connection alive
          }
        })(); // Execute immediately without blocking
      });
      
      // IDLE handled automatically by imap-simple library
      console.log(`[IDLE] ✅ IDLE monitoring active for ${account.email}`);
      
      // ✅ Track connection health
      this.connectionHealth.set(account.id, {
        lastCheck: Date.now(),
        consecutiveDrops: 0,
        lastDropTime: null,
        establishedAt: Date.now()
      });
      
      // ✅ Handle connection errors
      connection.imap.on('error', async (error) => {
        const errorMsg = error.message || String(error);
        console.error(`[IDLE] ❌ Connection error for ${account.email}:`, errorMsg);
        
        // Update health tracking
        const health = this.connectionHealth.get(account.id) || {};
        health.consecutiveDrops = (health.consecutiveDrops || 0) + 1;
        health.lastDropTime = Date.now();
        this.connectionHealth.set(account.id, health);
        
        console.log(`[IDLE] 📊 Connection health: ${health.consecutiveDrops} consecutive drops for ${account.email}`);
        
        // Clean up this connection
        this.stopIdleMonitoring(account.id);
        
        // ❌ DON'T mark account as needs_reconnection for IDLE errors
        // Sync jobs will handle reconnection separately
        
        // ✅ FIX: Prevent duplicate restart attempts
        if (this.isRestarting.has(account.id)) {
          console.log(`[IDLE] ⏭️  Restart already in progress for ${account.email}, skipping duplicate restart`);
          return;
        }
        
        // Calculate backoff delay (exponential backoff: 30s, 60s, 120s, max 5min)
        const backoffDelay = Math.min(
          300000, // Max 5 minutes
          Math.pow(2, health.consecutiveDrops - 1) * 30000 // 30s * 2^(drops-1)
        );
        
        console.log(`[IDLE] 🔄 Scheduling restart for ${account.email} in ${Math.round(backoffDelay / 1000)}s (backoff due to ${health.consecutiveDrops} drops)`);
        
        // Clear any existing restart timeout
        if (this.restartTimeouts.has(account.id)) {
          clearTimeout(this.restartTimeouts.get(account.id));
        }
        
        // Schedule restart with backoff
        const timeoutId = setTimeout(() => {
          this.restartTimeouts.delete(account.id);
          this.isRestarting.add(account.id);
          
          console.log(`[IDLE] 🔄 Attempting to restart IDLE for ${account.email}...`);
          this.startIdleMonitoring(account)
            .then(() => {
              this.isRestarting.delete(account.id);
              // Reset drop count on successful restart
              const health = this.connectionHealth.get(account.id);
              if (health) {
                health.consecutiveDrops = 0;
                health.lastCheck = Date.now();
                health.establishedAt = Date.now();
                this.connectionHealth.set(account.id, health);
              }
            })
            .catch(err => {
              this.isRestarting.delete(account.id);
              console.error(`[IDLE] ❌ Failed to restart IDLE:`, err.message);
            });
        }, backoffDelay);
        
        this.restartTimeouts.set(account.id, timeoutId);
      });
      
      // ✅ Handle connection end
      connection.imap.on('end', () => {
        console.log(`[IDLE] ⚠️  Connection ended for ${account.email}`);
        
        // Update health tracking
        const health = this.connectionHealth.get(account.id) || {};
        health.consecutiveDrops = (health.consecutiveDrops || 0) + 1;
        health.lastDropTime = Date.now();
        this.connectionHealth.set(account.id, health);
        
        const dropCount = health.consecutiveDrops || 0;
        const timeSinceLastDrop = health.lastDropTime ? Date.now() - health.lastDropTime : 0;
        console.log(`[IDLE] 📊 Connection end stats: ${dropCount} consecutive drops, ${Math.round(timeSinceLastDrop / 1000)}s since last drop`);
        
        this.stopIdleMonitoring(account.id);
        
        // ✅ FIX: Prevent duplicate restart attempts
        if (this.isRestarting.has(account.id)) {
          console.log(`[IDLE] ⏭️  Restart already in progress for ${account.email}, skipping duplicate restart`);
          return;
        }
        
        // Calculate backoff delay
        const backoffDelay = Math.min(
          300000, // Max 5 minutes
          Math.pow(2, dropCount - 1) * 30000 // Exponential backoff
        );
        
        console.log(`[IDLE] 🔄 Scheduling restart for ${account.email} in ${Math.round(backoffDelay / 1000)}s`);
        
        // Clear any existing restart timeout
        if (this.restartTimeouts.has(account.id)) {
          clearTimeout(this.restartTimeouts.get(account.id));
        }
        
        // Schedule restart with backoff
        const timeoutId = setTimeout(() => {
          this.restartTimeouts.delete(account.id);
          this.isRestarting.add(account.id);
          
          console.log(`[IDLE] 🔄 Restarting IDLE after connection end for ${account.email}...`);
          this.startIdleMonitoring(account)
            .then(() => {
              this.isRestarting.delete(account.id);
              // Reset drop count on successful restart
              const health = this.connectionHealth.get(account.id);
              if (health) {
                health.consecutiveDrops = 0;
                health.lastCheck = Date.now();
                health.establishedAt = Date.now();
                this.connectionHealth.set(account.id, health);
              }
            })
            .catch(err => {
              this.isRestarting.delete(account.id);
              console.error(`[IDLE] ❌ Failed to restart IDLE:`, err.message);
            });
        }, backoffDelay);
        
        this.restartTimeouts.set(account.id, timeoutId);
      });
      
      // ✅ Handle close event
      connection.imap.on('close', () => {
        console.log(`[IDLE] Connection closed for ${account.email}`);
        this.stopIdleMonitoring(account.id);
      });
      
      // ✅ NEW: Periodic health check (every 2 minutes)
      const healthCheckInterval = setInterval(() => {
        const health = this.connectionHealth.get(account.id);
        if (!health) {
          clearInterval(healthCheckInterval);
        return;
      }
        
        const connectionData = this.activeConnections.get(account.id);
        if (!connectionData || !connectionData.connection) {
          clearInterval(healthCheckInterval);
          return;
        }
        
        const connection = connectionData.connection;
        const isAlive = connection.imap && connection.imap.state === 'authenticated';
        
        health.lastCheck = Date.now();
        this.connectionHealth.set(account.id, health);
        
        if (!isAlive) {
          console.warn(`[IDLE] ⚠️  Health check: Connection for ${account.email} is not authenticated (state: ${connection.imap?.state || 'unknown'})`);
        } else {
          const uptime = Math.round((Date.now() - health.establishedAt) / 1000);
          console.log(`[IDLE] ✅ Health check: ${account.email} connection healthy (uptime: ${uptime}s, drops: ${health.consecutiveDrops})`);
        }
      }, 120000); // Every 2 minutes
      
      // Store health check interval for cleanup
      this.healthCheckIntervals.set(account.id, healthCheckInterval);

      console.log(`[IDLE] ✅ IDLE monitoring active for ${account.email}`);
>>>>>>> Stashed changes
    } catch (error) {
      // ✅ Handle "Connection ended unexpectedly" in catch block too
      if (error.message?.includes('Connection ended unexpectedly') || 
          error.message?.includes('ended unexpectedly')) {
        console.error(`[IDLE] ❌ Connection ended unexpectedly for ${account?.email || account?.id}. Likely rate limiting. Marking as needs_reconnection.`);
        if (account?.id) {
          await supabaseAdmin
            .from('email_accounts')
            .update({
              needs_reconnection: true,
              last_error: `Connection ended unexpectedly - possible rate limiting. Please wait 10-15 minutes and try again.`,
              last_connection_attempt: new Date().toISOString()
            })
            .eq('id', account.id);
        }
        return;
      }
      console.error(`[IDLE] Error starting monitoring for ${account?.email || 'unknown'}:`, error.message);
    }
  }

  // ============================================
  // STOP IDLE MONITORING
  // ============================================

  /**
   * Stop IDLE monitoring for account
   */
  async stopIdleMonitoring(accountId) {
    try {
      const connectionData = this.activeConnections.get(accountId);

      if (!connectionData) {
        console.log(`[IDLE] No active connection for account ${accountId}`);
        return;
      }

      console.log(`[IDLE] Stopping IDLE monitoring for account ${accountId}`);

      // Clear monitoring interval
      if (this.monitoringIntervals.has(accountId)) {
        clearInterval(this.monitoringIntervals.get(accountId));
        this.monitoringIntervals.delete(accountId);
      }
      
      // ✅ Clear failure tracking when stopping
      this.connectionFailureCount.delete(accountId);
      this.lastFailureTime.delete(accountId);

      // Close connection
      connectionData.monitoring = false;
<<<<<<< Updated upstream
      try {
        connectionData.connection.end();
      } catch (e) {
        // Ignore errors when closing
=======
      
      try {
        const nodeImap = connectionData.connection?.imap;
        if (nodeImap && connectionData.idleStarted && typeof nodeImap.idleStop === 'function') {
          console.log(`[IDLE] Stopping IDLE mode for account ${accountId}...`);
          try {
            nodeImap.idleStop();
            connectionData.idleStarted = false;
            console.log(`[IDLE] ✅ IDLE mode stopped for account ${accountId}`);
          } catch (idleStopError) {
            console.warn(`[IDLE] Error stopping IDLE mode:`, idleStopError.message);
          }
        }
      } catch (idleCheckError) {
        // Ignore errors when checking for IDLE
      }
      
      // ✅ FIX: Remove event listeners to prevent memory leak
      if (connectionData.connection) {
        // Remove event listeners from underlying IMAP connection
        if (connectionData.connection.imap) {
          connectionData.connection.imap.removeAllListeners('mail');
          connectionData.connection.imap.removeAllListeners('error');
          connectionData.connection.imap.removeAllListeners('end');
          connectionData.connection.imap.removeAllListeners('close');
        }
        // Remove event listeners from imap-simple connection wrapper
        connectionData.connection.removeAllListeners('mail');
        connectionData.connection.removeAllListeners('update');
        connectionData.connection.removeAllListeners('expunge');
        
        // Close connection
        try {
          if (typeof connectionData.connection.end === 'function') {
            connectionData.connection.end();
          }
        } catch (e) {
          // Ignore errors when closing
        }
>>>>>>> Stashed changes
      }

      this.activeConnections.delete(accountId);

      console.log(`[IDLE] IDLE monitoring stopped for account ${accountId}`);
    } catch (error) {
      console.error(`[IDLE] Error stopping monitoring:`, error);
    }
  }

  // ============================================
  // MONITOR FOLDERS
  // ============================================

  /**
   * Monitor folders for new emails
   */
  async monitorFolders(accountId) {
    const connectionData = this.activeConnections.get(accountId);

    if (!connectionData) return;

    try {
      // For primary folders, use polling approach combined with IDLE
      // Start polling for new emails
      const pollingInterval = setInterval(async () => {
        if (!connectionData.monitoring) {
          clearInterval(pollingInterval);
          return;
        }

        try {
          // ✅ Check if account needs reconnection before attempting sync
          const { data: accountCheck } = await supabaseAdmin
            .from('email_accounts')
            .select('id, needs_reconnection')
            .eq('id', accountId)
            .eq('is_active', true)
            .single();

          if (!accountCheck || accountCheck.needs_reconnection) {
            console.log(`[IDLE] ⏭️  Skipping check for ${accountId} - account needs reconnection`);
            return;
          }

          // Check if connection is still valid before checking for emails
          const connectionData = this.activeConnections.get(accountId);
          if (connectionData && !this.isConnectionAuthenticated(connectionData.connection)) {
            console.warn(`[IDLE] Connection lost for account ${accountId}, reconnecting...`);
            await this.reconnectAccount(accountId);
          }
          
          await this.checkForNewEmails(accountId);
        } catch (error) {
          // Handle authentication errors
          if (isConnectionError(error) || error.message?.includes('Not authenticated')) {
            console.warn(`[IDLE] Authentication error for account ${accountId}, will reconnect on next check`);
            // Don't log as error, will auto-reconnect
          } else {
            console.error(`[IDLE] Error checking for new emails for account ${accountId}:`, error.message);
          }
        }
      }, 30000); // Check every 30 seconds

      this.monitoringIntervals.set(accountId, pollingInterval);

      // Also try to use IDLE if supported
      this.setupIdleForFolder(accountId, 'INBOX');
    } catch (error) {
      console.error(`[IDLE] Error setting up monitoring:`, error);
    }
  }

  // ============================================
  // SETUP IDLE FOR FOLDER
  // ============================================

  /**
   * Setup IDLE for specific folder
   */
  async setupIdleForFolder(accountId, folderName) {
    const connectionData = this.activeConnections.get(accountId);

    if (!connectionData) return;

    try {
      const connection = connectionData.connection;

      // Check if connection is still authenticated
      if (!this.isConnectionAuthenticated(connection)) {
        console.warn(`[IDLE] Connection not authenticated, reconnecting before setting up IDLE...`);
        const reconnected = await this.reconnectAccount(accountId);
        if (!reconnected) {
          console.error(`[IDLE] Failed to reconnect, skipping IDLE setup for ${folderName}`);
          return;
        }
        connection = connectionData.connection;
      }

      // Open folder in read-only mode with retry
      const box = await retryWithBackoff(
        async () => {
          try {
            // Check connection before using
            if (!this.isConnectionAuthenticated(connection)) {
              console.warn(`[IDLE] Connection lost, reconnecting...`);
              const reconnected = await this.reconnectAccount(accountId);
              if (!reconnected) {
                throw new Error('Failed to reconnect IMAP connection');
              }
              connection = connectionData.connection;
            }
            
            return await connection.openBox(folderName, true);
          } catch (error) {
            // Handle authentication errors by reconnecting
            if (isConnectionError(error) || error.message?.includes('Not authenticated')) {
              console.warn(`[IDLE] Authentication error, attempting reconnect...`);
              const reconnected = await this.reconnectAccount(accountId);
              if (reconnected) {
                connection = connectionData.connection;
                // Retry the operation after reconnection
                return await connection.openBox(folderName, true);
              } else {
                throw new Error('Failed to reconnect after authentication error');
              }
            }
            
            // Handle folder not found gracefully
            if (error.textCode === 'NONEXISTENT' || error.message?.includes('Unknown Mailbox')) {
              throw new Error(`Folder ${folderName} does not exist`);
            }
            throw error;
          }
        },
        {
          maxRetries: 3, // Allow more retries with reconnection
          baseDelay: 2000,
          maxDelay: 30000,
          operationName: `[IDLE] Setting up IDLE for ${folderName}`,
          shouldRetry: (error) => {
            // Don't retry if it's a folder not found error
            if (error.message?.includes('does not exist')) {
              return false;
            }
            // Explicitly check for "Not authenticated" errors (these are retryable via reconnection)
            const errorMsg = (error.message || '').toLowerCase();
            if (errorMsg.includes('not authenticated') || errorMsg.includes('authentication')) {
              return true;
            }
            // Retry on connection/auth errors and throttling
            return isConnectionError(error) || isThrottlingError(error);
          },
          onRetry: async (error, attempt, delay) => {
            // If it's an auth error, try to reconnect before retrying
            const errorMsg = (error.message || '').toLowerCase();
            if (isConnectionError(error) || errorMsg.includes('not authenticated')) {
              console.log(`[IDLE] Attempting to reconnect before retry ${attempt}...`);
              await this.reconnectAccount(accountId);
              connection = connectionData.connection;
            }
          }
        }
      );
      console.log(`[IDLE] Opening IDLE for folder ${folderName} (${box.messages.total} messages)`);

      // Get current state
      const { data: syncState } = await supabaseAdmin
        .from('email_sync_state')
        .select('*')
        .eq('account_id', accountId)
        .eq('folder_name', folderName)
        .single();

      const currentMaxUid = syncState?.last_uid_synced || 0;

      // Setup listeners for new mail
      connection.on('mail', async () => {
        console.log(`[IDLE] New mail notification for ${folderName}`);
        await this.syncNewEmails(accountId, folderName, currentMaxUid);

        // Broadcast to connected clients
        if (this.wsManager) {
          this.wsManager.broadcastToUser(connectionData.account.user_id, {
            type: 'new_email',
            folder: folderName,
            accountId: accountId,
            timestamp: new Date().toISOString(),
          });
        }
      });

      connection.on('update', (seqno, info) => {
        console.log(`[IDLE] Update notification for ${folderName}: seqno=${seqno}`);

        // Broadcast flag updates
        if (this.wsManager) {
          this.wsManager.broadcastToUser(connectionData.account.user_id, {
            type: 'email_flag_update',
            folder: folderName,
            seqno: seqno,
            info: info,
          });
        }
      });

      connection.on('expunge', (seqno) => {
        console.log(`[IDLE] Expunge notification for ${folderName}: seqno=${seqno}`);

        if (this.wsManager) {
          this.wsManager.broadcastToUser(connectionData.account.user_id, {
            type: 'email_deleted',
            folder: folderName,
            seqno: seqno,
          });
        }
      });

      // Note: imap-simple doesn't have openIdle, but we use polling instead
    } catch (error) {
      // Handle authentication errors by reconnecting
      if (isConnectionError(error) || error.message?.includes('Not authenticated')) {
        console.warn(`[IDLE] Authentication error setting up IDLE for ${folderName}, will retry on next check`);
        // Don't throw - will retry on next polling cycle
        return;
      }
      
      // Handle throttling and folder errors gracefully
      if (isThrottlingError(error)) {
        console.error(`[IDLE] Throttling error setting up IDLE for ${folderName}:`, error.message);
        return;
      }
      
      if (error.message?.includes('does not exist') || 
          error.textCode === 'NONEXISTENT') {
        console.warn(`[IDLE] Folder ${folderName} not found, skipping IDLE setup`);
        return;
      }
      
      console.error(`[IDLE] Error setting up IDLE for ${folderName}:`, error.message);
      // Don't throw - prevent process crash
    }
  }

  // ============================================
  // CHECK FOR NEW EMAILS
  // ============================================

  /**
   * Check for new emails
   */
  async checkForNewEmails(accountId) {
    const connectionData = this.activeConnections.get(accountId);

    if (!connectionData) return;

    try {
      // ✅ CRITICAL: Check if account needs reconnection before syncing
      const { data: accountCheck } = await supabaseAdmin
        .from('email_accounts')
        .select('id, needs_reconnection')
        .eq('id', accountId)
        .eq('is_active', true)
        .single();

      if (!accountCheck) {
        console.warn(`[IDLE] ⚠️  Account ${accountId} was deleted or deactivated. Stopping monitoring.`);
        await this.stopIdleMonitoring(accountId);
        return;
      }

      if (accountCheck.needs_reconnection) {
        console.log(`[IDLE] ⏭️  Skipping check for ${accountId} - account needs reconnection`);
        return;
      }

      const { account, folders } = connectionData;

      // Check main folders
      const mainFolders = ['INBOX', 'Sent', 'Drafts'];

      for (const folderName of mainFolders) {
        const folder = folders.find(f => f.name === folderName);

        if (folder) {
          await this.syncNewEmailsForFolder(account.id, folderName);
        }
      }
    } catch (error) {
      console.error(`[IDLE] Error checking for new emails:`, error);
    }
  }

  // ============================================
  // SYNC NEW EMAILS FOR FOLDER
  // ============================================

  /**
   * Reconnect IMAP connection for an account
   */
  async reconnectAccount(accountId) {
    const connectionData = this.activeConnections.get(accountId);
    if (!connectionData) return false;

    // ✅ CRITICAL: Check if account is marked as needing reconnection
    // If it is, don't try to reconnect - user must fix credentials first
    try {
      const { data: account } = await supabaseAdmin
        .from('email_accounts')
        .select('needs_reconnection, last_connection_attempt')
        .eq('id', accountId)
        .single();
      
      if (account?.needs_reconnection) {
        console.log(`[IDLE] ⏸️  Account ${accountId} is marked as needing reconnection. Stopping IDLE monitoring.`);
        console.log(`[IDLE] 💡 User must fix credentials and clear the flag before reconnection.`);
        await this.stopIdleMonitoring(accountId);
        return false;
      }
    } catch (dbError) {
      console.warn(`[IDLE] ⚠️  Could not check account status:`, dbError.message);
      // Continue with reconnection attempt if we can't check status
    }

    // ✅ Check if we're in cooldown period
    const lastFailure = this.lastFailureTime.get(accountId);
    if (lastFailure && (Date.now() - lastFailure) < this.cooldownPeriod) {
      const remainingMinutes = Math.ceil((this.cooldownPeriod - (Date.now() - lastFailure)) / 60000);
      console.log(`[IDLE] ⏸️  Account ${accountId} in cooldown period (${remainingMinutes} minutes remaining). Skipping reconnect.`);
      return false;
    }

    // ✅ Check if we've exceeded max failures
    const failureCount = this.connectionFailureCount.get(accountId) || 0;
    if (failureCount >= this.maxFailures) {
      console.error(`[IDLE] ❌ Account ${accountId} has exceeded max failures (${failureCount}). Stopping IDLE monitoring.`);
      await this.stopIdleMonitoring(accountId);
      await supabaseAdmin
        .from('email_accounts')
        .update({
          needs_reconnection: true,
          last_error: `IDLE connection failed ${failureCount} times. Please reconnect manually.`,
          last_connection_attempt: new Date().toISOString()
        })
        .eq('id', accountId);
      return false;
    }

    try {
      console.log(`[IDLE] Reconnecting IMAP for account ${accountId}... (attempt ${failureCount + 1}/${this.maxFailures})`);
      
      // Close old connection
      try {
        if (connectionData.connection) {
          // ✅ FIX: Remove event listeners to prevent memory leak
          if (connectionData.connection.imap) {
            connectionData.connection.imap.removeAllListeners('mail');
            connectionData.connection.imap.removeAllListeners('error');
            connectionData.connection.imap.removeAllListeners('end');
            connectionData.connection.imap.removeAllListeners('close');
          }
          connectionData.connection.removeAllListeners('mail');
          connectionData.connection.removeAllListeners('update');
          connectionData.connection.removeAllListeners('expunge');
          
          if (typeof connectionData.connection.end === 'function') {
            connectionData.connection.end();
          }
        }
      } catch (e) {
        // Ignore errors when closing
      }

      // Get fresh account data from database
      const { data: account, error } = await supabaseAdmin
        .from('email_accounts')
        .select('*')
        .eq('id', accountId)
        .single();

      if (error || !account) {
        console.error(`[IDLE] Account ${accountId} not found, stopping monitoring`);
        await this.stopIdleMonitoring(accountId);
        return false;
      }

      // Create new connection with retry (but limit retries to avoid spam)
      const newConnection = await retryWithBackoff(
        async () => {
          return await connectToImap(account);
        },
        {
          maxRetries: 2, // Reduced from 3 to avoid spam
          baseDelay: 5000, // Increased delay
          maxDelay: 30000,
          operationName: `[IDLE] Reconnecting account ${accountId}`
        }
      );
      
      // Get folders with retry
      const boxes = await retryWithBackoff(
        async () => {
          return await newConnection.getBoxes();
        },
        {
          maxRetries: 2,
          baseDelay: 2000,
          maxDelay: 30000,
          operationName: `[IDLE] Getting folders after reconnect`
        }
      );
      
      const folders = this.flattenFolders(boxes);

      // Update connection data
      connectionData.connection = newConnection;
      connectionData.account = account;
      connectionData.folders = folders.filter(f => !f.attributes?.includes('\\Noselect'));

      // ✅ Reset failure count on successful reconnect
      this.connectionFailureCount.set(accountId, 0);
      this.lastFailureTime.delete(accountId);

      console.log(`[IDLE] ✅ Successfully reconnected account ${accountId}`);
      return true;
    } catch (error) {
      // ✅ Increment failure count
      const newFailureCount = (this.connectionFailureCount.get(accountId) || 0) + 1;
      this.connectionFailureCount.set(accountId, newFailureCount);
      this.lastFailureTime.set(accountId, Date.now());
      
      console.error(`[IDLE] ❌ Error reconnecting account ${accountId} (failure ${newFailureCount}/${this.maxFailures}):`, error.message);
      
      // ✅ Handle "Connection ended unexpectedly" - likely rate limiting
      if (error.message?.includes('Connection ended unexpectedly') || 
          error.message?.includes('ended unexpectedly')) {
        console.warn(`[IDLE] ⚠️  Gmail may be rate-limiting connections. Waiting ${Math.ceil(this.cooldownPeriod / 60000)} minutes before retry.`);
      }
      
      return false;
    }
  }

  /**
   * Check if connection is still authenticated
   * For imap-simple, we check the underlying node-imap connection
   */
  isConnectionAuthenticated(connection) {
    if (!connection) return false;
    
    try {
      // imap-simple wraps node-imap, check the underlying _imap connection
      const imap = connection._imap || connection;
      
      // Check if socket is still alive
      if (imap._socket && (imap._socket.destroyed || imap._socket.readyState === 'closed')) {
        return false;
      }

      // Check if connection has been destroyed
      if (connection._destroyed || imap._destroyed) {
        return false;
      }

      // Check connection state - node-imap states: 'disconnected', 'connected', 'authenticated', 'selected', 'logout'
      const state = imap.state || connection.state;
      if (state === 'logout' || state === 'disconnected') {
        return false;
      }
        
      // If socket exists and is not destroyed, and state is not logout/disconnected, assume it's valid
      // We'll catch authentication errors when we try to use it
      return true;
    } catch (error) {
      // If we can't check the state, assume connection is bad
      console.warn(`[IDLE] Error checking connection state:`, error.message);
      return false;
    }
  }

  /**
   * Sync new emails for folder
   */
  async syncNewEmailsForFolder(accountId, folderName) {
    try {
      // ✅ CRITICAL: Validate account exists and is active before processing
      const { data: accountCheck } = await supabaseAdmin
        .from('email_accounts')
        .select('id, needs_reconnection')
        .eq('id', accountId)
        .eq('is_active', true)
        .single();
      
      if (!accountCheck) {
        console.warn(`[IDLE] ⚠️  Account ${accountId} was deleted or deactivated. Stopping sync.`);
        await this.stopIdleMonitoring(accountId);
        return;
      }

      // ✅ CRITICAL: Skip sync if account needs reconnection (prevents endless retry loops)
      if (accountCheck.needs_reconnection) {
        console.log(`[IDLE] ⏭️  Skipping sync for ${accountId}/${folderName} - account needs reconnection`);
        return;
      }
      
      const connectionData = this.activeConnections.get(accountId);

      if (!connectionData) return;

      let connection = connectionData.connection;

      // Check if connection is still authenticated
      if (!this.isConnectionAuthenticated(connection)) {
        console.warn(`[IDLE] Connection lost for account ${accountId}, reconnecting...`);
        const reconnected = await this.reconnectAccount(accountId);
        if (!reconnected) {
          console.error(`[IDLE] Failed to reconnect account ${accountId}, skipping sync`);
          return;
        }
        connection = connectionData.connection;
      }

      // Get sync state
      const { data: syncState } = await supabaseAdmin
        .from('email_sync_state')
        .select('*')
        .eq('account_id', accountId)
        .eq('folder_name', folderName)
        .single();

      const lastSyncUid = syncState?.last_uid_synced || 0;

      // Open folder with retry and reconnection on auth errors
      const box = await retryWithBackoff(
        async () => {
          try {
            // Check connection before using
            if (!this.isConnectionAuthenticated(connection)) {
              console.warn(`[IDLE] Connection not authenticated, reconnecting...`);
              const reconnected = await this.reconnectAccount(accountId);
              if (!reconnected) {
                throw new Error('Failed to reconnect IMAP connection');
              }
              connection = connectionData.connection;
            }
            
            return await connection.openBox(folderName, false);
          } catch (error) {
            // Handle authentication errors by reconnecting
            if (isConnectionError(error) || error.message?.includes('Not authenticated')) {
              console.warn(`[IDLE] Authentication error, attempting reconnect...`);
              const reconnected = await this.reconnectAccount(accountId);
              if (reconnected) {
                connection = connectionData.connection;
                // Retry the operation after reconnection
                return await connection.openBox(folderName, false);
              } else {
                throw new Error('Failed to reconnect after authentication error');
              }
            }
            
            // Handle folder not found errors gracefully
            if (error.textCode === 'NONEXISTENT' || error.message?.includes('Unknown Mailbox')) {
              console.warn(`[IDLE] Folder ${folderName} does not exist, skipping`);
              throw new Error(`Folder ${folderName} does not exist`);
            }
            throw error;
          }
        },
        {
          maxRetries: 3, // Allow more retries with reconnection
          baseDelay: 2000,
          maxDelay: 30000,
          operationName: `[IDLE] Opening folder ${folderName}`,
          shouldRetry: (error) => {
            // Don't retry if it's a folder not found error
            if (error.message?.includes('does not exist')) {
              return false;
            }
            // Explicitly check for "Not authenticated" errors (these are retryable via reconnection)
            const errorMsg = (error.message || '').toLowerCase();
            if (errorMsg.includes('not authenticated') || errorMsg.includes('authentication')) {
              return true;
            }
            // Retry on connection/auth errors and throttling
            return isConnectionError(error) || isThrottlingError(error);
          },
          onRetry: async (error, attempt, delay) => {
            // If it's an auth error, try to reconnect before retrying
            const errorMsg = (error.message || '').toLowerCase();
            if (isConnectionError(error) || errorMsg.includes('not authenticated')) {
              console.log(`[IDLE] Attempting to reconnect before retry ${attempt}...`);
              await this.reconnectAccount(accountId);
              connection = connectionData.connection;
            }
          }
        }
      );

      // imap-simple doesn't support UID range searches, so we fetch all and filter client-side
      // This is less efficient but works reliably
      const fetchOptions = {
        bodies: '',
        struct: true,
        markSeen: false
      };

      // Search for all messages with retry for throttling and auth errors
      const allMessages = await retryWithBackoff(
        async () => {
          // Check connection before using
          if (!this.isConnectionAuthenticated(connection)) {
            console.warn(`[IDLE] Connection lost during search, reconnecting...`);
            const reconnected = await this.reconnectAccount(accountId);
            if (!reconnected) {
              throw new Error('Failed to reconnect IMAP connection');
            }
            connection = connectionData.connection;
            // Reopen folder after reconnection
            await connection.openBox(folderName, false);
          }
          
          return await connection.search(['ALL'], fetchOptions);
        },
        {
          maxRetries: 5,
          baseDelay: 3000,
          maxDelay: 60000,
          operationName: `[IDLE] Searching messages in ${folderName}`,
          shouldRetry: (error) => {
            // Explicitly check for "Not authenticated" errors (these are retryable via reconnection)
            const errorMsg = (error.message || '').toLowerCase();
            if (errorMsg.includes('not authenticated') || errorMsg.includes('authentication')) {
              return true;
            }
            // Retry on connection/auth errors and throttling
            return isConnectionError(error) || isThrottlingError(error);
          },
          onRetry: async (error, attempt, delay) => {
            // If it's an auth error, try to reconnect before retrying
            const errorMsg = (error.message || '').toLowerCase();
            if (isConnectionError(error) || errorMsg.includes('not authenticated')) {
              console.log(`[IDLE] Attempting to reconnect before retry ${attempt}...`);
              await this.reconnectAccount(accountId);
              connection = connectionData.connection;
              // Reopen folder after reconnection
              await connection.openBox(folderName, false);
            }
          }
        }
      );

      // Filter to only new messages (UID > lastSyncUid)
      const messages = lastSyncUid > 0
        ? allMessages.filter(msg => {
            const uid = parseInt(msg.attributes.uid);
            return uid > lastSyncUid;
          })
        : allMessages;

      if (messages.length === 0) {
        // ✅ CRITICAL: Clear needs_reconnection flag even when no new emails found
        // Just successfully checking for emails means the connection is working
        try {
          await supabaseAdmin
            .from('email_accounts')
            .update({
              needs_reconnection: false,
              last_error: null,
              last_successful_sync_at: new Date().toISOString()
            })
            .eq('id', accountId);
          
          console.log(`[IDLE] ✅ Cleared needs_reconnection flag for ${accountId} (check successful, no new emails)`);
        } catch (updateErr) {
          console.warn('[IDLE] Failed to clear needs_reconnection flag:', updateErr.message);
        }
        return;
      }

      console.log(`[IDLE] Found ${messages.length} new emails in ${folderName}`);

      let newEmailsCount = 0;

      for (const msg of messages) {
        let numericUid = null;
        try {
          // ✅ CRITICAL: Validate account still exists before processing
          const { data: accountCheck } = await supabaseAdmin
            .from('email_accounts')
            .select('id')
            .eq('id', accountId)
            .eq('is_active', true)
            .single();
          
          if (!accountCheck) {
            console.warn(`[IDLE] ⚠️  Account ${accountId} was deleted or deactivated. Stopping email processing.`);
            break; // Stop processing if account was deleted
          }
          
          const all = msg.parts.find(part => part.which === '');
          const uid = msg.attributes.uid;
          numericUid = parseInt(uid) || 0;
          const flags = msg.attributes.flags || [];
          
          const idHeader = 'Imap-Id: ' + uid + '\r\n';
          const mail = await simpleParser(idHeader + all.body);
          const emailData = await parseEmailFromImap(mail, numericUid, folderName);

          if (emailData) {
            const result = await saveOrUpdateEmail(accountId, emailData, flags);

            if (result.action === 'inserted') {
              newEmailsCount++;
              
              // Call webhook/API for new emails
              try {
                await callEmailWebhook(emailData, accountId, connectionData.account.user_id);
              } catch (webhookError) {
                console.error(`[IDLE] Error calling webhook for email UID ${numericUid}:`, webhookError.message);
                // Don't fail the whole process if webhook fails
              }
            }
          }
        } catch (error) {
          const uidStr = numericUid !== null ? numericUid : (msg.attributes?.uid || 'unknown');
          console.error(`[IDLE] Error processing message UID ${uidStr}:`, error.message);
          // Continue with next message
        }
      }

      // Update sync state
      const highestUid = Math.max(...messages.map(msg => parseInt(msg.attributes.uid)));
      await supabaseAdmin
        .from('email_sync_state')
        .upsert({
          account_id: accountId,
          folder_name: folderName,
          last_uid_synced: highestUid,
          total_server_count: box.messages.total,
          last_sync_at: new Date().toISOString(),
        }, {
          onConflict: 'account_id,folder_name'
        });

      if (newEmailsCount > 0) {
        console.log(`[IDLE] Synced ${newEmailsCount} new emails for ${folderName}`);
        
        // Clear needs_reconnection flag on successful sync
        await supabaseAdmin
          .from('email_accounts')
          .update({
            needs_reconnection: false,
            last_error: null,
            last_successful_sync_at: new Date().toISOString()
          })
          .eq('id', accountId);
        
        // Broadcast to WebSocket
        if (this.wsManager && connectionData.account.user_id) {
          this.wsManager.broadcastToUser(connectionData.account.user_id, {
            type: 'new_email',
            folder: folderName,
            accountId: accountId,
            count: newEmailsCount,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      // ✅ Handle "Connection ended unexpectedly" - stop retrying immediately
      if (error.message?.includes('Connection ended unexpectedly') || 
          error.message?.includes('ended unexpectedly')) {
        console.error(`[IDLE] ❌ Connection ended unexpectedly for ${folderName}. Likely rate limiting. Stopping IDLE monitoring.`);
        await this.stopIdleMonitoring(accountId);
        await supabaseAdmin
          .from('email_accounts')
          .update({
            needs_reconnection: true,
            last_error: `Connection ended unexpectedly - possible rate limiting. Please wait and reconnect.`,
            last_connection_attempt: new Date().toISOString()
          })
          .eq('id', accountId);
        return;
      }
      
      // Handle authentication errors by reconnecting
      if (isConnectionError(error) || error.message?.includes('Not authenticated')) {
        console.warn(`[IDLE] Authentication error in ${folderName}, attempting reconnect...`);
        const reconnected = await this.reconnectAccount(accountId);
        if (!reconnected) {
          // reconnectAccount already handles marking as needs_reconnection if max failures reached
          // Just log here
          console.error(`[IDLE] Failed to reconnect account ${accountId}`);
        }
        // Don't throw - will retry on next polling cycle (if not in cooldown)
        return;
      }
      
      // Handle throttling errors gracefully - don't crash the process
      if (isThrottlingError(error)) {
        console.error(`[IDLE] Throttling error syncing new emails for ${folderName}:`, error.message);
        // Don't throw - just log and continue
        return;
      }
      
      // Handle folder not found errors gracefully
      if (error.message?.includes('does not exist') || 
          error.textCode === 'NONEXISTENT') {
        console.warn(`[IDLE] Folder ${folderName} not found, skipping`);
        return;
      }
      
      console.error(`[IDLE] Error syncing new emails for ${folderName}:`, error.message);
      // Don't throw - prevent process crash
    }
  }

  /**
   * Sync new emails (legacy method name)
   */
  async syncNewEmails(accountId, folderName, lastUid) {
    return this.syncNewEmailsForFolder(accountId, folderName);
  }

  // ============================================
  // FLATTEN FOLDERS
  // ============================================

  /**
   * Flatten folders
   */
  flattenFolders(boxes, parentPath = '') {
    const folders = [];

    for (const [name, box] of Object.entries(boxes)) {
      const fullName = parentPath ? `${parentPath}${box.delimiter}${name}` : name;

      folders.push({
        name: fullName,
        attributes: box.attributes,
        delimiter: box.delimiter,
      });

      if (box.children) {
        folders.push(...this.flattenFolders(box.children, fullName));
      }
    }

    return folders;
  }

  // ============================================
  // GET STATUS
  // ============================================

  /**
   * Get status of all monitored connections
   */
  getStatus() {
    const status = {};

    for (const [accountId, data] of this.activeConnections.entries()) {
      status[accountId] = {
        email: data.account.email,
        monitoring: data.monitoring,
        foldersCount: data.folders.length,
      };
    }

    return status;
  }
}

module.exports = { ImapIdleManager };

