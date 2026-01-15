import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/config';
import { useAuth } from '@/context/AuthContext';

interface WhatsAppQRScannerProps {
  agentId: string;
  onConnected?: (phoneNumber?: string) => void;
}

interface QRResponse {
  qr?: string;
  status?: 'pending' | 'connected' | 'error';
  connected?: boolean;
  phoneNumber?: string;
}

export function WhatsAppQRScanner({ agentId, onConnected }: WhatsAppQRScannerProps) {
  const { session } = useAuth();
  const [qrCode, setQrCode] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'pending' | 'connected' | 'error'>('pending');
  const [phoneNumber, setPhoneNumber] = useState<string>('');

  useEffect(() => {
    if (!session || !agentId) return;

    const initWhatsApp = async () => {
      try {
        setLoading(true);
        setError(null);

        // Initialize WhatsApp connection
        await fetch(`${API_URL}/api/whatsapp/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          credentials: 'include',
          body: JSON.stringify({ agentId }),
        });

        // Fetch QR code
        const qrResponse = await fetch(`${API_URL}/api/whatsapp/qr`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
          credentials: 'include',
        });

        if (!qrResponse.ok) {
          throw new Error('Failed to get QR code');
        }

        const qrData: QRResponse = await qrResponse.json();

        if (qrData.qr) {
          setQrCode(qrData.qr);
          setStatus('pending');
        } else {
          setError('No QR code received');
          setStatus('error');
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Error initializing WhatsApp';
        console.error('WhatsApp init error:', err);
        setError(errorMessage);
        setStatus('error');
      } finally {
        setLoading(false);
      }
    };

    initWhatsApp();

    // Poll for connection status
    const statusInterval = setInterval(async () => {
      try {
        const statusResponse = await fetch(`${API_URL}/api/whatsapp/status`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
          credentials: 'include',
        });

        if (!statusResponse.ok) {
          return;
        }

        const statusData: QRResponse = await statusResponse.json();

        if (statusData.connected || statusData.status === 'connected') {
          setPhoneNumber(statusData.phoneNumber || '');
          setStatus('connected');
          onConnected?.(statusData.phoneNumber);
          clearInterval(statusInterval);
        }
      } catch (err) {
        console.error('Status check error:', err);
      }
    }, 3000);

    return () => clearInterval(statusInterval);
  }, [session, agentId, onConnected]);

  const handleRegenerate = async () => {
    if (!session) return;

    setLoading(true);
    setQrCode('');
    setError(null);
    setStatus('pending');

    try {
      const response = await fetch(`${API_URL}/api/whatsapp/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ agentId }),
      });

      if (!response.ok) {
        throw new Error('Failed to regenerate QR code');
      }

      const qrResponse = await fetch(`${API_URL}/api/whatsapp/qr`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        credentials: 'include',
      });

      if (!qrResponse.ok) {
        throw new Error('Failed to get QR code');
      }

      const qrData: QRResponse = await qrResponse.json();
      if (qrData.qr) {
        setQrCode(qrData.qr);
        setStatus('pending');
      } else {
        setError('No QR code received');
        setStatus('error');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error regenerating QR code';
      setError(errorMessage);
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin mb-4" aria-hidden="true" />
          <p className="text-sm text-muted-foreground" role="status">
            Loading QR code...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === 'connected') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-green-500">✓ Connected</CardTitle>
          <CardDescription>
            WhatsApp is successfully connected{phoneNumber ? ` to ${phoneNumber}` : ''}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Connection Error</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleRegenerate} aria-label="Retry loading QR code">
            <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect WhatsApp</CardTitle>
        <CardDescription>
          Scan this QR code with WhatsApp to connect your agent
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {qrCode && (
          <QRCodeSVG
            value={qrCode}
            size={256}
            level="H"
            aria-label="WhatsApp connection QR code"
            className="border-4 border-background p-4 rounded-lg"
          />
        )}
        <p className="text-sm text-muted-foreground text-center">
          Open WhatsApp → Settings → Linked Devices → Link a Device
        </p>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleRegenerate}
          aria-label="Refresh QR code"
        >
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
          Refresh QR Code
        </Button>
      </CardContent>
    </Card>
  );
}

export default WhatsAppQRScanner;
