/**
 * WhatsAppConnectionPanel.tsx
 * 
 * Manages WhatsApp connection lifecycle for an agent:
 * - Displays connection status
 * - Real-time QR code via Socket.IO
 * - Manages connect/disconnect operations
 * - Real-time status updates via Socket.IO (no polling)
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
import { useWhatsAppSocket } from '@/hooks/useWhatsAppSocket';
import type { WhatsAppSession } from '@/types/agent.types';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { Smartphone, QrCode, Loader2, AlertCircle, CheckCircle2, XCircle, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import QRCode from 'qrcode';

interface WhatsAppConnectionPanelProps {
  agentId: string;
  whatsappSession: WhatsAppSession | null;
  onConnectionChange: () => void;
  autoConnect?: boolean;
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting';

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

export default function WhatsAppConnectionPanel({ 
  agentId, 
  whatsappSession, 
  onConnectionChange,
  autoConnect = false,
}: WhatsAppConnectionPanelProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [userId, setUserId] = useState<string | null>(null);
  
  const connectMutation = useConnectWhatsApp();
  const disconnectMutation = useDisconnectWhatsApp();
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onConnectionChangeRef = useRef(onConnectionChange);

  // Get user ID on mount
  useEffect(() => {
    const getUserId = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        setUserId(session.user.id);
      }
    };
    getUserId();
  }, []);

  // Use Socket.IO for real-time updates
  const { 
    qrCode: socketQrCode, 
    status: socketStatus, 
    isConnected: socketIsConnected,
    message: socketMessage,
    error: socketError,
    socketConnected,
    reconnect,
    refreshStatus
  } = useWhatsAppSocket(
    connectionState === 'connecting' || connectionState === 'connected' ? agentId : null,
    userId,
    {
      onQRCode: async (qr) => {
        console.log('[WhatsApp] Socket: QR code received');
        const dataUrl = await getQrDataUrl(qr);
        if (dataUrl) {
          setQrDataUrl(dataUrl);
          setError(null);
        }
      },
      onConnected: (phoneNumber) => {
        console.log('[WhatsApp] Socket: Connected!', phoneNumber);
        // Clear countdown and timeout
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        
        setConnectionState('connected');
        setQrDataUrl(null);
        setError(null);
        
        // Show success notification
        toast.success('WhatsApp connected successfully! 🎉', {
          description: phoneNumber ? `Phone: ${phoneNumber}` : 'Your agent is now ready to receive messages',
          duration: 5000,
        });
        
        // Refresh parent data
        onConnectionChangeRef.current();
        
        // Reset to idle after animation
        setTimeout(() => {
          setConnectionState('idle');
        }, 2000);
      },
      onDisconnected: (reason) => {
        console.log('[WhatsApp] Socket: Disconnected', reason);
        if (connectionState === 'connecting') {
          setError(reason || 'Connection lost');
        }
      },
      onReconnected: () => {
        console.log('[WhatsApp] Socket: Reconnected');
        onConnectionChangeRef.current();
      },
      onError: (errorMsg) => {
        console.error('[WhatsApp] Socket: Error', errorMsg);
        setError(errorMsg);
      }
    }
  );

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);
  
  // Use socket connection status, falling back to session data
  const isConnected = socketIsConnected || whatsappSession?.is_active || false;
  
  // Handle countdown timer when connecting
  useEffect(() => {
    if (connectionState !== 'connecting') {
      // Clear timers when not connecting
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    // Start countdown
    setCountdown(60);
    
    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    
    // Timeout after 60 seconds
    timeoutRef.current = setTimeout(() => {
      console.log('[WhatsApp] Connection timeout reached');
      
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      
      setConnectionState('idle');
      setQrDataUrl(null);
      setError('Connection timeout. QR code expired. Please try again.');
      toast.error('Connection timeout - please try again');
    }, 60000);
    
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [connectionState]);
  
  // Update QR data URL when socket provides QR code
  useEffect(() => {
    if (socketQrCode && connectionState === 'connecting') {
      getQrDataUrl(socketQrCode).then(dataUrl => {
        if (dataUrl) {
          setQrDataUrl(dataUrl);
        }
      });
    }
  }, [socketQrCode, connectionState]);
  
  // Handle Connect Button Click
  const handleConnect = async () => {
    console.log('[WhatsApp] Initiating connection for agent:', agentId);
    setError(null);
    setQrDataUrl(null);
    setConnectionState('connecting');
    
    try {
      const result = await connectMutation.mutateAsync(agentId);
      console.log('[WhatsApp] Init result:', JSON.stringify(result, null, 2));
      
      // If QR code returned immediately, set it
      if (result.qrCode) {
        const normalizedQr = await getQrDataUrl(result.qrCode);
        if (normalizedQr) {
          setQrDataUrl(normalizedQr);
        }
      }
      
      // Socket.IO will handle real-time updates from here
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
  
  // Handle manual reconnect
  const handleReconnect = () => {
    console.log('[WhatsApp] Manual reconnect requested');
    reconnect();
    toast.info('Reconnection initiated...');
  };
  
  useEffect(() => {
    if (autoConnect && connectionState === 'idle' && !isConnected) {
      handleConnect();
    }
  }, [autoConnect, connectionState, isConnected]);

  // Determine display QR (from socket or local state)
  const displayQr = qrDataUrl;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              WhatsApp Connection
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              Manage your WhatsApp integration
              {/* Socket connection indicator */}
              {userId && (
                <span className={`inline-flex items-center gap-1 text-xs ${socketConnected ? 'text-green-600' : 'text-gray-400'}`}>
                  {socketConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {socketConnected ? 'Live' : 'Offline'}
                </span>
              )}
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
        {(error || socketError) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error || socketError}</AlertDescription>
          </Alert>
        )}
        
        {/* CONNECTED STATE */}
        {isConnected && connectionState !== 'disconnecting' && connectionState !== 'connected' && (
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
            
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={handleReconnect}
                className="flex-1"
                size="sm"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Reconnect
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => setShowDisconnectDialog(true)}
                className="flex-1"
                disabled={connectionState === 'disconnecting'}
              >
                Disconnect
              </Button>
            </div>
          </div>
        )}
        
        {/* CONNECTING STATE (QR CODE) */}
        {connectionState === 'connecting' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-primary rounded-lg bg-muted/50">
              {displayQr ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <QrCode className="h-6 w-6 text-primary" />
                    {socketConnected && (
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        <Wifi className="h-3 w-3 mr-1" />
                        Real-time
                      </Badge>
                    )}
                  </div>
                  <img 
                    src={displayQr}
                    alt="WhatsApp QR Code"
                    className="w-72 h-72 md:w-96 md:h-96 border-4 border-primary rounded-lg shadow-lg"
                  />
                  <p className="text-sm text-muted-foreground mt-4">
                    QR code expires in <span className="font-bold text-destructive">{countdown}s</span>
                  </p>
                  {socketMessage && socketStatus === 'qr_ready' && (
                    <p className="text-xs text-muted-foreground mt-1">{socketMessage}</p>
                  )}
                </>
              ) : (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <p className="text-sm text-muted-foreground">Generating QR code...</p>
                  <p className="text-xs text-muted-foreground">This may take a few seconds</p>
                  {socketConnected && (
                    <Badge variant="outline" className="mt-2 text-green-600 border-green-600">
                      <Wifi className="h-3 w-3 mr-1" />
                      Waiting for QR...
                    </Badge>
                  )}
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
              <div className="flex items-center gap-2 text-xs text-green-600 mt-3 pt-3 border-t">
                <Wifi className="h-4 w-4" />
                <span>Real-time connection via Socket.IO - instant pairing confirmation!</span>
              </div>
            </div>
            
            <Button 
              variant="outline" 
              onClick={() => {
                setConnectionState('idle');
                setQrDataUrl(null);
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
                🎉 Connection established instantly via real-time socket!
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
