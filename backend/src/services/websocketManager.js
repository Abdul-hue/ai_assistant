/**
 * WebSocket Manager
 * Manages WebSocket connections for real-time updates
 */

// ============================================
// WEBSOCKET MANAGER CLASS
// ============================================

class WebSocketManager {
  constructor(io) {
    this.io = io;
    this.userConnections = new Map(); // userId -> Set of socket IDs
    this.setupConnections();
  }

  // ============================================
  // SETUP CONNECTIONS
  // ============================================

  /**
   * Setup Socket.IO connections
   */
  setupConnections() {
    if (!this.io) {
      console.warn('[WS] Socket.IO not available');
      return;
    }

    this.io.on('connection', (socket) => {
      console.log('[WS] New WebSocket connection:', socket.id);

      socket.on('register', (data) => {
        const userId = data?.userId;
        if (userId) {
          this.registerUserConnection(userId, socket.id);
          socket.emit('registered', { success: true });
          console.log(`[WS] Registered user ${userId}, socket ${socket.id}`);
        }
      });

      socket.on('ping', () => {
        socket.emit('pong');
      });

      socket.on('disconnect', () => {
        console.log('[WS] WebSocket disconnected:', socket.id);
        this.removeUserConnection(socket.id);
      });

      socket.on('error', (error) => {
        console.error('[WS] WebSocket error:', error);
      });
    });
  }

  // ============================================
  // REGISTER USER CONNECTION
  // ============================================

  /**
   * Register user connection
   */
  registerUserConnection(userId, socketId) {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId).add(socketId);
  }

  // ============================================
  // REMOVE USER CONNECTION
  // ============================================

  /**
   * Remove user connection
   */
  removeUserConnection(socketId) {
    for (const [userId, socketIds] of this.userConnections.entries()) {
      if (socketIds.has(socketId)) {
        socketIds.delete(socketId);
        if (socketIds.size === 0) {
          this.userConnections.delete(userId);
        }
        console.log(`[WS] Removed connection for user ${userId}`);
        break;
      }
    }
  }

  // ============================================
  // BROADCAST TO USER
  // ============================================

  /**
   * Broadcast to user
   */
  broadcastToUser(userId, message) {
    if (!this.io) {
      console.warn('[WS] Socket.IO not available for broadcast');
      return;
    }

    const socketIds = this.userConnections.get(userId);

    if (!socketIds || socketIds.size === 0) {
      console.log(`[WS] No connections for user ${userId}`);
      return;
    }

    let sent = 0;
    socketIds.forEach((socketId) => {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket && socket.connected) {
        socket.emit('email_update', message);
        sent++;
      }
    });

    console.log(`[WS] Broadcast to user ${userId}: sent to ${sent}/${socketIds.size} connections`);
  }

  // ============================================
  // BROADCAST TO ALL USERS
  // ============================================

  /**
   * Broadcast to all users
   */
  broadcastToAllUsers(message) {
    if (!this.io) {
      console.warn('[WS] Socket.IO not available for broadcast');
      return;
    }

    this.io.emit('email_update', message);
    console.log(`[WS] Broadcast to all users`);
  }

  // ============================================
  // GET STATUS
  // ============================================

  /**
   * Get status
   */
  getStatus() {
    const status = {
      totalUsers: this.userConnections.size,
      totalConnections: 0,
    };

    for (const socketIds of this.userConnections.values()) {
      status.totalConnections += socketIds.size;
    }

    return status;
  }
}

module.exports = { WebSocketManager };

