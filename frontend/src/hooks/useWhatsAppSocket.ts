/**
 * Real-time WhatsApp Socket.IO Hook
 * 
 * Provides real-time updates for WhatsApp connection status, QR codes,
 * and connection events using Socket.IO.
 * 
 * Use this alongside useConnectWhatsApp/useDisconnectWhatsApp for full functionality.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { API_URL } from '@/config';

// Types for WhatsApp Socket events
interface WhatsAppQREvent {
  agentId: string;
  qr: string;
  attempt?: number;
  timestamp: string;
}

interface WhatsAppStatusEvent {
  agentId: string;
  agentName?: string;
  status: string;
  isActive: boolean;
  phoneNumber: string | null;
  hasQRCode: boolean;
  lastHeartbeat: string | null;
  message?: string;
  timestamp: string;
}

interface WhatsAppConnectedEvent {
  agentId: string;
  status: string;
  phoneNumber?: string;
  message: string;
  timestamp: string;
}

interface WhatsAppDisconnectedEvent {
  agentId: string;
  statusCode?: number;
  reason?: string;
  timestamp: string;
}

interface WhatsAppReconnectedEvent {
  agentId: string;
  message: string;
  attempts: number;
  timestamp: string;
}

interface WhatsAppReconnectionFailedEvent {
  agentId: string;
  agentName: string;
  reason: string;
  attempts: number;
  message: string;
  action: string;
  timestamp: string;
}

interface WhatsAppErrorEvent {
  message: string;
  agentId?: string;
  error?: string;
}

export interface WhatsAppSocketState {
  qrCode: string | null;
  status: 'initializing' | 'qr_ready' | 'pairing' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';
  message: string;
  isConnected: boolean;
  phoneNumber: string | null;
  error: string | null;
  socketConnected: boolean;
  lastUpdate: string | null;
}

interface UseWhatsAppSocketOptions {
  onQRCode?: (qr: string) => void;
  onConnected?: (phoneNumber: string | null) => void;
  onDisconnected?: (reason: string | null) => void;
  onReconnected?: () => void;
  onError?: (error: string) => void;
}

/**
 * useWhatsAppSocket - Real-time WhatsApp connection management
 * 
 * @param agentId - The agent ID to monitor
 * @param userId - The user ID for authentication
 * @param options - Optional callbacks for events
 * @returns WhatsApp socket state and control functions
 * 
 * @example
 * ```tsx
 * const { qrCode, status, isConnected, reconnect } = useWhatsAppSocket(agentId, userId);
 * 
 * return (
 *   <div>
 *     {qrCode && <QRCode value={qrCode} />}
 *     <span>Status: {status}</span>
 *     {!isConnected && <button onClick={reconnect}>Reconnect</button>}
 *   </div>
 * );
 * ```
 */
export function useWhatsAppSocket(
  agentId: string | null,
  userId: string | null,
  options: UseWhatsAppSocketOptions = {}
) {
  const [state, setState] = useState<WhatsAppSocketState>({
    qrCode: null,
    status: 'initializing',
    message: 'Initializing connection...',
    isConnected: false,
    phoneNumber: null,
    error: null,
    socketConnected: false,
    lastUpdate: null
  });
  
  const socketRef = useRef<Socket | null>(null);
  // Store options in a ref to avoid re-creating the socket on every render
  const optionsRef = useRef(options);
  optionsRef.current = options;
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Connect to Socket.IO
  useEffect(() => {
    if (!agentId || !userId) {
      // Don't set error state - this is often a transient condition while data loads
      // Just return early and wait for valid params
      console.log('[WhatsApp Socket] Waiting for agentId and userId...', { agentId: !!agentId, userId: !!userId });
      return;
    }
    
    console.log('[WhatsApp Socket] Connecting...', { agentId: agentId.substring(0, 8), userId: userId.substring(0, 8) });
    
    // Create socket connection
    const socket = io(API_URL, {
      query: { userId },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000
    });
    
    socketRef.current = socket;
    
    // Connection established
    socket.on('connect', () => {
      console.log('[WhatsApp Socket] Socket.IO connected');
      setState(prev => ({
        ...prev,
        socketConnected: true,
        message: 'Connected to server...'
      }));
      
      // Subscribe to WhatsApp events for this agent
      socket.emit('whatsapp:subscribe', agentId);
    });
    
    // Connection lost
    socket.on('disconnect', (reason) => {
      console.log('[WhatsApp Socket] Socket.IO disconnected:', reason);
      setState(prev => ({
        ...prev,
        socketConnected: false,
        message: 'Connection lost, reconnecting...'
      }));
    });
    
    // QR Code received
    socket.on('whatsapp:qr', (data: WhatsAppQREvent) => {
      if (data.agentId === agentId) {
        console.log('[WhatsApp Socket] QR code received, attempt:', data.attempt);
        setState(prev => ({
          ...prev,
          qrCode: data.qr,
          status: 'qr_ready',
          message: `Scan this QR code with your WhatsApp mobile app (attempt ${data.attempt || 1})`,
          isConnected: false,
          error: null,
          lastUpdate: data.timestamp
        }));
        
        optionsRef.current.onQRCode?.(data.qr);
      }
    });
    
    // Status update
    socket.on('whatsapp:status', (data: WhatsAppStatusEvent) => {
      if (data.agentId === agentId) {
        console.log('[WhatsApp Socket] Status update:', data.status);
        
        const statusMap: Record<string, WhatsAppSocketState['status']> = {
          'connected': 'connected',
          'disconnected': 'disconnected',
          'qr_pending': 'qr_ready',
          'initializing': 'initializing',
          'reconnecting': 'reconnecting',
          'error': 'error',
          'pairing': 'pairing',
          'connecting': 'connecting'
        };
        
        setState(prev => ({
          ...prev,
          status: statusMap[data.status] || 'disconnected',
          isConnected: data.isActive,
          phoneNumber: data.phoneNumber,
          message: data.message || `Status: ${data.status}`,
          qrCode: data.hasQRCode ? prev.qrCode : null,
          lastUpdate: data.timestamp
        }));
      }
    });
    
    // Connection successful
    socket.on('whatsapp:connected', (data: WhatsAppConnectedEvent) => {
      if (data.agentId === agentId) {
        console.log('[WhatsApp Socket] ✅ Connected successfully!');
        
        setState({
          qrCode: null,
          status: 'connected',
          message: '✅ Connected successfully!',
          isConnected: true,
          phoneNumber: data.phoneNumber || null,
          error: null,
          socketConnected: true,
          lastUpdate: data.timestamp
        });
        
        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['agent-details', agentId] });
        queryClient.invalidateQueries({ queryKey: ['agents'] });
        
        toast({
          title: 'WhatsApp Connected',
          description: data.message || 'WhatsApp connected successfully!',
        });
        
        optionsRef.current.onConnected?.(data.phoneNumber || null);
      }
    });
    
    // Disconnected
    socket.on('whatsapp:disconnected', (data: WhatsAppDisconnectedEvent) => {
      if (data.agentId === agentId) {
        console.log('[WhatsApp Socket] ❌ Disconnected:', data.reason);
        
        setState(prev => ({
          ...prev,
          qrCode: null,
          status: 'disconnected',
          message: data.reason || 'Connection lost',
          isConnected: false,
          lastUpdate: data.timestamp
        }));
        
        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['agent-details', agentId] });
        
        optionsRef.current.onDisconnected?.(data.reason || null);
      }
    });
    
    // Reconnected after disconnection
    socket.on('whatsapp:reconnected', (data: WhatsAppReconnectedEvent) => {
      if (data.agentId === agentId) {
        console.log('[WhatsApp Socket] ✅ Reconnected after', data.attempts, 'attempts');
        
        toast({
          title: 'Connection Restored',
          description: data.message || 'WhatsApp connection restored!',
        });
        
        setState(prev => ({
          ...prev,
          status: 'connected',
          isConnected: true,
          message: 'Connection restored',
          lastUpdate: data.timestamp
        }));
        
        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['agent-details', agentId] });
        
        optionsRef.current.onReconnected?.();
      }
    });
    
    // Session logged out
    socket.on('whatsapp:logged-out', (data: { agentId: string; message: string; timestamp: string }) => {
      if (data.agentId === agentId) {
        console.log('[WhatsApp Socket] ⚠️ Session logged out');
        
        setState({
          qrCode: null,
          status: 'disconnected',
          message: 'Session logged out. Please reconnect.',
          isConnected: false,
          phoneNumber: null,
          error: 'logged_out',
          socketConnected: true,
          lastUpdate: data.timestamp
        });
        
        toast({
          title: 'Session Logged Out',
          description: data.message || 'WhatsApp session logged out. Please reconnect.',
          variant: 'destructive',
        });
      }
    });
    
    // Reconnection failed
    socket.on('whatsapp:reconnection-failed', (data: WhatsAppReconnectionFailedEvent) => {
      if (data.agentId === agentId) {
        console.error('[WhatsApp Socket] ❌ Reconnection failed after', data.attempts, 'attempts');
        
        setState(prev => ({
          ...prev,
          status: 'error',
          message: data.message || `Reconnection failed after ${data.attempts} attempts`,
          error: data.reason,
          lastUpdate: data.timestamp
        }));
        
        toast({
          title: 'Connection Failed',
          description: data.message,
          variant: 'destructive',
        });
        
        optionsRef.current.onError?.(data.message);
      }
    });
    
    // Error handling
    socket.on('whatsapp:error', (data: WhatsAppErrorEvent) => {
      console.error('[WhatsApp Socket] Error:', data.message);
      setState(prev => ({
        ...prev,
        status: 'error',
        message: data.message,
        error: data.message
      }));
      
      optionsRef.current.onError?.(data.message);
    });
    
    // Cleanup
    return () => {
      console.log('[WhatsApp Socket] Cleaning up socket connection');
      if (socketRef.current) {
        socketRef.current.emit('whatsapp:unsubscribe', agentId);
        socketRef.current.off('connect');
        socketRef.current.off('disconnect');
        socketRef.current.off('whatsapp:qr');
        socketRef.current.off('whatsapp:status');
        socketRef.current.off('whatsapp:connected');
        socketRef.current.off('whatsapp:disconnected');
        socketRef.current.off('whatsapp:reconnected');
        socketRef.current.off('whatsapp:logged-out');
        socketRef.current.off('whatsapp:reconnection-failed');
        socketRef.current.off('whatsapp:error');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [agentId, userId, queryClient, toast]); // Note: options is stored in ref to avoid infinite loops
  
  // Manual reconnect function
  const reconnect = useCallback(async () => {
    if (!agentId) return;
    
    setState(prev => ({
      ...prev,
      status: 'reconnecting',
      message: 'Reconnecting...',
      error: null
    }));
    
    // Emit reconnect request via socket
    if (socketRef.current?.connected) {
      socketRef.current.emit('whatsapp:reconnect', agentId);
    } else {
      // Fallback to API call
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data: { session } } = await supabase.auth.getSession();
        
        const response = await fetch(`${API_URL}/api/whatsapp/agents/${agentId}/reconnect`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token && { 'Authorization': `Bearer ${session.access_token}` })
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to trigger reconnection');
        }
        
        toast({
          title: 'Reconnection Initiated',
          description: 'WhatsApp reconnection in progress...',
        });
      } catch (error) {
        console.error('[WhatsApp Socket] Manual reconnect failed:', error);
        toast({
          title: 'Reconnection Failed',
          description: 'Failed to initiate reconnection',
          variant: 'destructive',
        });
      }
    }
  }, [agentId, toast]);
  
  // Refresh status
  const refreshStatus = useCallback(() => {
    if (socketRef.current?.connected && agentId) {
      socketRef.current.emit('whatsapp:subscribe', agentId);
    }
  }, [agentId]);
  
  return {
    ...state,
    reconnect,
    refreshStatus,
    socket: socketRef.current
  };
}

export default useWhatsAppSocket;

