/**
 * WhatsAppConnectionPanel.tsx
 * 
 * Manages WhatsApp connection lifecycle for an agent:
 * - Displays connection status
 * - Handles QR code generation and polling
 * - Manages connect/disconnect operations
 * - Real-time status updates via polling
 * 
 * @param agentId - Agent UUID
 * @param whatsappSession - Current WhatsApp session data (if exists)
 * @param onConnectionChange - Callback to refresh parent data after connection changes
 */

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from '@/components/ui/alert-dialog';
import { useConnectWhatsApp, useDisconnectWhatsApp } from '@/hooks';
import type { WhatsAppSession } from '@/types/agent.types';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { Smartphone, QrCode, Loader2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import QRCode from 'qrcode';

interface WhatsAppConnectionPanelProps {
  agentId: string;
  whatsappSession: WhatsAppSession | null;
  onConnectionChange: () => void;
  autoConnect?: boolean;
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting';

import { API_URL } from '@/config';

async function getQrDataUrl(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith('data:image')) return value;
  try {
    return await QRCode.toDataURL(value, { margin: 1 });
  } catch (error) {
    console.error('[WhatsApp] Failed to convert QR string to data URL', error);
    return null;
  }
}

/**
 * Get Supabase auth token for API requests
 */
async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch (error) {
    console.error('Failed to get auth token:', error);
    return null;
  }
}

export default function WhatsAppConnectionPanel({ 
  agentId, 
  whatsappSession, 
  onConnectionChange,
  autoConnect = false,
}: WhatsAppConnectionPanelProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [countdown, setCountdown] = useState(60);
  
  const connectMutation = useConnectWhatsApp();
  const disconnectMutation = useDisconnectWhatsApp();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onConnectionChangeRef = useRef(onConnectionChange);

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);
  
  const isConnected = whatsappSession?.is_active || false;
  
  // QR Code Polling Effect
  useEffect(() => {
    if (connectionState !== 'connecting') {
      return;
    }

    if (pollIntervalRef.current) {
      console.log('[WhatsApp] Poll already active, skipping duplicate start');
      return;
    }

      console.log('[WhatsApp] Starting QR code polling for agent:', agentId);
      
      // Reset countdown
      setCountdown(60);
      
      // Start countdown timer
    countdownIntervalRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) return 0;
          return prev - 1;
        });
      }, 1000);
      
      // Start polling for connection status
    pollIntervalRef.current = setInterval(async () => {
        try {
          // Get auth token for request
          const token = await getAuthToken();
          
          const headers: Record<string, string> = {};
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          
          const response = await fetch(`${API_URL}/api/agents/${agentId}/whatsapp-status`, {
            credentials: 'include', // SECURITY: Send HttpOnly cookies
            headers,
          });
          
          if (!response.ok) {
            console.error('[WhatsApp] Status check failed:', response.status);
            return; // Don't stop polling, just log error
          }
          
          const statusData = await response.json();
          console.log('[WhatsApp] Status update:', JSON.stringify(statusData, null, 2));
          
          // Update QR code if available
          if (statusData.qr_code) {
            console.log('[WhatsApp] QR code received, displaying...');
            const normalizedQr = await getQrDataUrl(statusData.qr_code);
            if (normalizedQr) {
              setQrCode(normalizedQr);
              setError(null);
            } else {
              console.warn('[WhatsApp] Unable to render QR code (conversion failed)');
            }
          }
          
          // ✅ CRITICAL FIX: Only consider connected when ALL conditions are met
          // - Must have is_active === true (not just status field)
          // - Must have phone_number (actual connection established)
          // - Status should be 'connected' or 'authenticated'
          // 
          // PROBLEM: Old logic used OR which treated historical data as active connection
          // SOLUTION: Use AND to require active connection with phone number
          const isActuallyConnected = (
            statusData.is_active === true &&
            statusData.phone_number &&
            (statusData.status === 'connected' || statusData.status === 'authenticated')
          );
          
          const isWaitingForScan = (
            statusData.qr_code &&
            statusData.status === 'qr_pending'
          );
          
          console.log('[WhatsApp] Connection check:', {
            is_active: statusData.is_active,
            status: statusData.status,
            phone_number: statusData.phone_number,
            has_qr: !!statusData.qr_code,
            isActuallyConnected,
            isWaitingForScan
          });
          
          if (isActuallyConnected) {
            console.log('[WhatsApp] ✅ CONNECTION DETECTED! Stopping polling...');
            
            // Stop all intervals and timeouts IMMEDIATELY
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            console.log('[WhatsApp] Cleared poll interval');
          }
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
            console.log('[WhatsApp] Cleared countdown interval');
          }
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
            console.log('[WhatsApp] Cleared timeout');
          }
            
            // Update state
            setConnectionState('connected');
            setQrCode(null);
            setError(null);
            
            // Show success notification with phone number
            toast.success('WhatsApp connected successfully! 🎉', {
              description: statusData.phone_number ? `Phone: ${statusData.phone_number}` : 'Your agent is now ready to receive messages',
              duration: 5000,
            });
            
            // Refresh parent data to show updated connection
            console.log('[WhatsApp] Triggering data refresh...');
          onConnectionChangeRef.current();
            
            // Reset to idle after showing success animation for 2 seconds
            setTimeout(() => {
              console.log('[WhatsApp] Resetting to idle state');
              setConnectionState('idle');
            }, 2000);
          }
        } catch (err) {
          console.error('[WhatsApp] Polling error:', err);
          // Don't stop polling on individual errors
        }
      }, 3000); // Poll every 3 seconds
      
    // Timeout after 60 seconds
    timeoutRef.current = setTimeout(() => {
      console.log('[WhatsApp] Connection timeout reached');
      
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      
      setConnectionState('idle');
      setQrCode(null);
      setError('Connection timeout. QR code expired. Please try again.');
      toast.error('Connection timeout - please try again');
    }, 60000);
    
    return () => {
      if (pollIntervalRef.current) {
        console.log('[WhatsApp] Cleaning up polling interval');
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [connectionState, agentId]);
  
  // Handle Connect Button Click
  const handleConnect = async () => {
    console.log('[WhatsApp] Initiating connection for agent:', agentId);
    setError(null);
    setConnectionState('connecting');
    
    try {
      const result = await connectMutation.mutateAsync(agentId);
      console.log('[WhatsApp] Init result:', JSON.stringify(result, null, 2));
      console.log('[WhatsApp] Init result.success:', result.success);
      console.log('[WhatsApp] Init result.qrCode:', result.qrCode ? 'HAS QR' : 'NO QR');
      console.log('[WhatsApp] Init result.error:', result.error);
      
      // If QR code returned immediately, set it
      if (result.qrCode) {
        const normalizedQr = await getQrDataUrl(result.qrCode);
        if (normalizedQr) {
          setQrCode(normalizedQr);
        }
      }
      
      // Polling will handle the rest
    } catch (err: any) {
      console.error('[WhatsApp] Connection failed:', err);
      setConnectionState('idle');
      setError(err.message || 'Failed to initialize connection. Please try again.');
      toast.error('Connection failed');
    }
  };
  
  // Handle Disconnect Button Click
  const handleDisconnect = async () => {
    console.log('[WhatsApp] Disconnecting agent:', agentId);
    setShowDisconnectDialog(false);
    setConnectionState('disconnecting');
    setError(null);
    
    try {
      await disconnectMutation.mutateAsync(agentId);
      setConnectionState('idle');
      toast.success('WhatsApp disconnected successfully');
      onConnectionChange();
    } catch (err: any) {
      console.error('[WhatsApp] Disconnect failed:', err);
      setConnectionState('idle');
      setError(err.message || 'Failed to disconnect. Please try again.');
      toast.error('Disconnect failed');
    }
  };
  
  useEffect(() => {
    if (autoConnect && connectionState === 'idle' && !isConnected) {
      handleConnect();
    }
  }, [autoConnect, connectionState, isConnected]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              WhatsApp Connection
            </CardTitle>
            <CardDescription>
              Manage your WhatsApp integration
            </CardDescription>
          </div>
          {/* Status Badge */}
          <Badge 
            variant={isConnected ? 'default' : 'secondary'}
            className={isConnected ? 'bg-green-500 hover:bg-green-600' : ''}
          >
            {isConnected ? (
              <><CheckCircle2 className="h-3 w-3 mr-1" /> Connected</>
            ) : (
              <><XCircle className="h-3 w-3 mr-1" /> Disconnected</>
            )}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {/* CONNECTED STATE */}
        {isConnected && connectionState !== 'disconnecting' && (
          <div className="space-y-4">
            <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                <div className="flex-1">
                  <p className="font-semibold text-green-900 dark:text-green-100">
                    WhatsApp Connected
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Phone: {whatsappSession?.phone_number || 'Unknown'}
                  </p>
                  {whatsappSession?.last_connected && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Connected {formatDistanceToNow(new Date(whatsappSession.last_connected), { addSuffix: true })}
                    </p>
                  )}
                </div>
              </div>
            </div>
            
            <Button 
              variant="destructive" 
              onClick={() => setShowDisconnectDialog(true)}
              className="w-full"
              disabled={connectionState === 'disconnecting'}
            >
              Disconnect WhatsApp
            </Button>
          </div>
        )}
        
        {/* CONNECTING STATE (QR CODE) */}
        {connectionState === 'connecting' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-primary rounded-lg bg-muted/50">
              {qrCode ? (
                <>
                  <QrCode className="h-8 w-8 text-primary mb-4" />
                  <img 
                    src={qrCode}
                    alt="WhatsApp QR Code"
                    className="w-72 h-72 md:w-96 md:h-96 border-4 border-primary rounded-lg shadow-lg"
                  />
                  <p className="text-sm text-muted-foreground mt-4">
                    QR code expires in <span className="font-bold text-destructive">{countdown}s</span>
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <p className="text-sm text-muted-foreground">Generating QR code...</p>
                  <p className="text-xs text-muted-foreground">This may take a few seconds</p>
                </>
              )}
            </div>
            
            {/* Instructions */}
            <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
              <p className="font-semibold">📱 How to connect WhatsApp:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Open <strong>WhatsApp</strong> on your phone</li>
                <li>Tap <strong>Menu (⋮)</strong> or go to <strong>Settings</strong></li>
                <li>Tap <strong>"Linked Devices"</strong></li>
                <li>Tap <strong>"Link a Device"</strong></li>
                <li>Point your camera at the QR code above</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                💡 <strong>Tip:</strong> Keep this window open until your phone scans the code
              </p>
            </div>
            
            <Button 
              variant="outline" 
              onClick={() => {
                setConnectionState('idle');
                setQrCode(null);
                setError(null);
              }}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        )}
        
        {/* DISCONNECTING STATE */}
        {connectionState === 'disconnecting' && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Disconnecting WhatsApp...</p>
          </div>
        )}
        
        {/* DISCONNECTED STATE */}
        {!isConnected && connectionState === 'idle' && (
          <div className="space-y-4">
            <div className="p-6 bg-muted border rounded-lg text-center">
              <Smartphone className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">
                No WhatsApp connection active
              </p>
              <p className="text-xs text-muted-foreground">
                Connect your WhatsApp to start receiving and sending messages through this agent
              </p>
            </div>
            
            <Button 
              onClick={handleConnect}
              disabled={connectMutation.isPending}
              className="w-full"
              size="lg"
            >
              {connectMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Initializing...</>
              ) : (
                <><QrCode className="mr-2 h-4 w-4" /> Connect WhatsApp</>
              )}
            </Button>
          </div>
        )}
        
        {/* SUCCESS STATE - Animated success display with prominence */}
        {connectionState === 'connected' && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="relative">
              <CheckCircle2 className="h-24 w-24 text-green-500 animate-bounce" />
              <div className="absolute inset-0 h-24 w-24 bg-green-500/20 rounded-full animate-ping" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-3xl font-bold text-green-600 dark:text-green-400">
                Connected Successfully!
              </h3>
              <p className="text-lg text-muted-foreground">
                Your WhatsApp is now active and ready to receive messages
              </p>
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                🎉 Connection established!
              </p>
            </div>
          </div>
        )}
      </CardContent>
      
      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop message processing for this agent. You can reconnect anytime by scanning the QR code again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDisconnect} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

