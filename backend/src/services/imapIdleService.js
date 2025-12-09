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

// ============================================
// IDLE MANAGER CLASS
// ============================================

class ImapIdleManager {
  constructor(wsManager) {
    this.activeConnections = new Map(); // accountId -> {connection, folders, openFolder}
    this.wsManager = wsManager;
    this.monitoringIntervals = new Map();
  }

  // ============================================
  // START IDLE MONITORING
  // ============================================

  /**
   * Start IDLE monitoring for account
   */
  async startIdleMonitoring(account) {
    try {
      if (this.activeConnections.has(account.id)) {
        console.log(`[IDLE] Already monitoring account ${account.email}`);
        return;
      }

      console.log(`[IDLE] Starting IDLE monitoring for ${account.email}`);

      // Connect to IMAP
      const connection = await connectToImap(account);

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

      console.log(`[IDLE] IDLE monitoring started for ${account.email}`);
    } catch (error) {
      console.error(`[IDLE] Error starting monitoring for ${account.email}:`, error.message);
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

      // Close connection
      connectionData.monitoring = false;
      try {
        connectionData.connection.end();
      } catch (e) {
        // Ignore errors when closing
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
          await this.checkForNewEmails(accountId);
        } catch (error) {
          console.error(`[IDLE] Error checking for new emails for account ${accountId}:`, error.message);
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

      // Open folder in read-only mode
      const box = await connection.openBox(folderName, true);
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
      console.error(`[IDLE] Error setting up IDLE for ${folderName}:`, error.message);
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
   * Sync new emails for folder
   */
  async syncNewEmailsForFolder(accountId, folderName) {
    try {
      const connectionData = this.activeConnections.get(accountId);

      if (!connectionData) return;

      const connection = connectionData.connection;

      // Get sync state
      const { data: syncState } = await supabaseAdmin
        .from('email_sync_state')
        .select('*')
        .eq('account_id', accountId)
        .eq('folder_name', folderName)
        .single();

      const lastSyncUid = syncState?.last_uid_synced || 0;

      // Open folder
      const box = await connection.openBox(folderName, false);

      // Build search range for only new messages - match imapEmailSyncService.js format
      let searchCriteria;
      if (lastSyncUid > 0) {
        // Incremental sync: fetch only new UIDs
        searchCriteria = ['UID', `${lastSyncUid + 1}:*`];
      } else {
        // First sync: fetch all
        searchCriteria = ['ALL'];
      }

      // Search for messages with fetch options - imap-simple combines search + fetch
      const fetchOptions = {
        bodies: '',
        struct: true,
        markSeen: false
      };

      const messages = await connection.search(searchCriteria, fetchOptions);

      if (messages.length === 0) {
        return;
      }

      console.log(`[IDLE] Found ${messages.length} new emails in ${folderName}`);

      let newEmailsCount = 0;

      for (const msg of messages) {
        try {
          const all = msg.parts.find(part => part.which === '');
          const uid = msg.attributes.uid;
          const flags = msg.attributes.flags || [];
          const numericUid = parseInt(uid);
          
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
          console.error(`[IDLE] Error processing message UID ${numericUid}:`, error.message);
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
      console.error(`[IDLE] Error syncing new emails for ${folderName}:`, error);
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

