/**
 * IMAP Connection Pool Manager
 * Limits concurrent connections per account and manages connection lifecycle
 */

class ImapConnectionPool {
  constructor() {
    // Map: accountId -> array of active connections (max 5 per account)
    this.connections = new Map();
    // Map: accountId -> connection creation timestamps
    this.connectionTimestamps = new Map();
    // Map: accountId -> pending connection requests
    this.pendingRequests = new Map();
    // Max connections per account
    this.maxConnectionsPerAccount = 5;
    // Connection timeout (30 minutes)
    this.connectionTimeout = 30 * 60 * 1000;
  }

  /**
   * Get or create a connection for an account
   * @param {string} accountId - Account ID
   * @param {Function} createConnection - Async function that creates a new connection
   * @returns {Promise<Object>} - IMAP connection
   */
  async getConnection(accountId, createConnection) {
    // Clean up stale connections
    this.cleanupStaleConnections(accountId);

    const accountConnections = this.connections.get(accountId) || [];

    // If we have available connections, reuse one
    if (accountConnections.length > 0) {
      const connection = accountConnections[0];
      // Check if connection is still alive
      if (this.isConnectionAlive(connection)) {
        // Move to end (LRU)
        accountConnections.shift();
        accountConnections.push(connection);
        return connection;
      } else {
        // Remove dead connection
        this.removeConnection(accountId, connection);
      }
    }

    // If we're at max connections, wait for one to become available
    if (accountConnections.length >= this.maxConnectionsPerAccount) {
      return await this.waitForAvailableConnection(accountId, createConnection);
    }

    // Create new connection
    try {
      const connection = await createConnection();
      this.addConnection(accountId, connection);
      return connection;
    } catch (error) {
      console.error(`[POOL] Error creating connection for account ${accountId}:`, error.message);
      throw error;
    }
  }

  /**
   * Add connection to pool
   */
  addConnection(accountId, connection) {
    if (!this.connections.has(accountId)) {
      this.connections.set(accountId, []);
      this.connectionTimestamps.set(accountId, []);
    }

    const accountConnections = this.connections.get(accountId);
    const timestamps = this.connectionTimestamps.get(accountId);

    accountConnections.push(connection);
    timestamps.push(Date.now());

    console.log(`[POOL] Added connection for account ${accountId} (${accountConnections.length}/${this.maxConnectionsPerAccount})`);
  }

  /**
   * Remove connection from pool
   */
  removeConnection(accountId, connection) {
    const accountConnections = this.connections.get(accountId) || [];
    const timestamps = this.connectionTimestamps.get(accountId) || [];

    const index = accountConnections.indexOf(connection);
    if (index !== -1) {
      accountConnections.splice(index, 1);
      timestamps.splice(index, 1);
      console.log(`[POOL] Removed connection for account ${accountId} (${accountConnections.length}/${this.maxConnectionsPerAccount})`);
    }

    // Clean up connection
    try {
      if (connection && typeof connection.end === 'function') {
        connection.end();
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Check if connection is still alive
   */
  isConnectionAlive(connection) {
    if (!connection) return false;
    
    // Check if connection has been closed
    if (connection._socket && connection._socket.destroyed) {
      return false;
    }

    // Check if connection state indicates it's closed
    if (connection.state === 'logout' || connection.state === 'disconnected') {
      return false;
    }

    return true;
  }

  /**
   * Clean up stale connections (older than timeout)
   */
  cleanupStaleConnections(accountId) {
    const accountConnections = this.connections.get(accountId) || [];
    const timestamps = this.connectionTimestamps.get(accountId) || [];
    const now = Date.now();

    for (let i = accountConnections.length - 1; i >= 0; i--) {
      const connection = accountConnections[i];
      const timestamp = timestamps[i];

      // Remove if stale or dead
      if (now - timestamp > this.connectionTimeout || !this.isConnectionAlive(connection)) {
        this.removeConnection(accountId, connection);
      }
    }
  }

  /**
   * Wait for an available connection slot
   */
  async waitForAvailableConnection(accountId, createConnection) {
    return new Promise((resolve, reject) => {
      if (!this.pendingRequests.has(accountId)) {
        this.pendingRequests.set(accountId, []);
      }

      const pending = this.pendingRequests.get(accountId);
      pending.push({ resolve, reject, createConnection });

      // Try to get connection immediately
      this.processPendingRequests(accountId);

      // Timeout after 30 seconds
      setTimeout(() => {
        const index = pending.findIndex(p => p.resolve === resolve);
        if (index !== -1) {
          pending.splice(index, 1);
          reject(new Error('Timeout waiting for available connection'));
        }
      }, 30000);
    });
  }

  /**
   * Process pending connection requests
   */
  async processPendingRequests(accountId) {
    const pending = this.pendingRequests.get(accountId) || [];
    if (pending.length === 0) return;

    this.cleanupStaleConnections(accountId);
    const accountConnections = this.connections.get(accountId) || [];

    // Process requests while we have capacity
    while (pending.length > 0 && accountConnections.length < this.maxConnectionsPerAccount) {
      const request = pending.shift();
      
      try {
        const connection = await request.createConnection();
        this.addConnection(accountId, connection);
        request.resolve(connection);
      } catch (error) {
        request.reject(error);
      }
    }
  }

  /**
   * Release connection back to pool (or remove if needed)
   */
  releaseConnection(accountId, connection, remove = false) {
    if (remove) {
      this.removeConnection(accountId, connection);
    } else {
      // Connection stays in pool for reuse
      // Process any pending requests
      this.processPendingRequests(accountId);
    }
  }

  /**
   * Close all connections for an account
   */
  closeAccountConnections(accountId) {
    const accountConnections = this.connections.get(accountId) || [];
    
    for (const connection of accountConnections) {
      try {
        if (connection && typeof connection.end === 'function') {
          connection.end();
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    this.connections.delete(accountId);
    this.connectionTimestamps.delete(accountId);
    this.pendingRequests.delete(accountId);

    console.log(`[POOL] Closed all connections for account ${accountId}`);
  }

  /**
   * Get connection stats
   */
  getStats() {
    const stats = {};
    
    for (const [accountId, connections] of this.connections.entries()) {
      stats[accountId] = {
        activeConnections: connections.length,
        maxConnections: this.maxConnectionsPerAccount,
        pendingRequests: (this.pendingRequests.get(accountId) || []).length
      };
    }

    return stats;
  }

  /**
   * Close all connections (cleanup)
   */
  closeAll() {
    for (const accountId of this.connections.keys()) {
      this.closeAccountConnections(accountId);
    }
  }
}

// Singleton instance
const connectionPool = new ImapConnectionPool();

// Cleanup on process exit
process.on('SIGTERM', () => {
  connectionPool.closeAll();
});

process.on('SIGINT', () => {
  connectionPool.closeAll();
});

module.exports = connectionPool;

