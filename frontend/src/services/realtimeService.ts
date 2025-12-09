/**
 * Real-Time Email Service
 * Manages WebSocket connections for real-time email updates
 */

import { supabase } from '@/integrations/supabase/client';
import { io, Socket } from 'socket.io-client';
import { API_URL } from '@/config';

export class RealtimeEmailService {
  private socket: Socket | null = null;
  private userId: string | null = null;
  private listeners: Map<string, Function[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.setupListeners();
  }

  /**
   * Connect to WebSocket server
   */
  async connect(userId: string) {
    if (this.socket?.connected) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      try {
        // Get WebSocket URL from API URL
        const wsUrl = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');
        
        this.socket = io(wsUrl, {
          transports: ['websocket'],
          withCredentials: true,
        });

        this.userId = userId;

        this.socket.on('connect', () => {
          console.log('[REALTIME] WebSocket connected');
          this.reconnectAttempts = 0;
          
          // Register user
          this.socket?.emit('register', {
            userId: userId,
          });
          
          resolve();
        });

        this.socket.on('registered', (data) => {
          console.log('[REALTIME] Registered with server:', data);
        });

        this.socket.on('email_update', (message) => {
          this.handleMessage(message);
        });

        this.socket.on('disconnect', () => {
          console.log('[REALTIME] WebSocket disconnected');
          this.reconnect();
        });

        this.socket.on('connect_error', (error) => {
          console.error('[REALTIME] WebSocket connection error:', error);
          reject(error);
        });

        this.socket.on('error', (error) => {
          console.error('[REALTIME] WebSocket error:', error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Reconnect to WebSocket
   */
  private reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.userId) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      console.log(`[REALTIME] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

      this.reconnectTimeout = setTimeout(() => {
        if (this.userId) {
          this.connect(this.userId).catch((err) => {
            console.error('[REALTIME] Reconnection failed:', err);
          });
        }
      }, delay);
    }
  }

  /**
   * Send message to server
   */
  private send(message: any) {
    if (this.socket?.connected) {
      this.socket.emit('message', message);
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: any) {
    console.log('[REALTIME] Received message:', message);

    // Emit to listeners
    const callbacks = this.listeners.get(message.type) || [];
    callbacks.forEach((cb) => cb(message));

    // Also dispatch custom events for global listeners
    window.dispatchEvent(new CustomEvent('email_update', { detail: message }));
  }

  /**
   * Setup default listeners
   */
  private setupListeners() {
    // Listen for new emails
    this.on('new_email', (message) => {
      console.log('[REALTIME] New email notification:', message);
      window.dispatchEvent(new CustomEvent('newEmail', { detail: message }));
    });

    // Listen for flag updates
    this.on('email_flag_update', (message) => {
      console.log('[REALTIME] Email flag update:', message);
      window.dispatchEvent(new CustomEvent('emailFlagUpdate', { detail: message }));
    });

    // Listen for email deletion
    this.on('email_deleted', (message) => {
      console.log('[REALTIME] Email deleted:', message);
      window.dispatchEvent(new CustomEvent('emailDeleted', { detail: message }));
    });

    // Listen for email moved
    this.on('email_moved', (message) => {
      console.log('[REALTIME] Email moved:', message);
      window.dispatchEvent(new CustomEvent('emailMoved', { detail: message }));
    });
  }

  /**
   * Add event listener
   */
  on(eventType: string, callback: Function) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)?.push(callback);
  }

  /**
   * Remove event listener
   */
  off(eventType: string, callback: Function) {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Ping server
   */
  ping() {
    if (this.socket?.connected) {
      this.socket.emit('ping');
    }
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

// Singleton instance
export const realtimeService = new RealtimeEmailService();

