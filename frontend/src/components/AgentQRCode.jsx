import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import QRCode from 'qrcode';
import { useToast } from '@/hooks/use-toast';

const POLL_INTERVAL_MS = 4000;
const BACKOFF_DELAYS = [5000, 10000, 20000];

async function normalizeQrCode(value) {
  if (!value) return null;
  if (value.startsWith('data:image')) return value;
  try {
    return await QRCode.toDataURL(value, { margin: 1 });
  } catch (error) {
    console.error('Failed to convert QR code string to data URL', error);
    return null;
  }
}

export default function AgentQRCode({ agentId }) {
  const { toast } = useToast();
  const [qrCode, setQrCode] = useState(null);
  const [status, setStatus] = useState('loading'); // Start with loading state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [phoneNumber, setPhoneNumber] = useState(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(null);
  const [qrCodeTimestamp, setQrCodeTimestamp] = useState(null);
  const [qrCountdownSeconds, setQrCountdownSeconds] = useState(0);
  const pollingIntervalRef = useRef(null);
  const pollInFlightRef = useRef(false);
  const backoffIndexRef = useRef(0);
  const pollingEnabledRef = useRef(false);
  const lastQrStringRef = useRef(null);
  const previousStatusRef = useRef(null); // Track previous status to detect connection

  const clearIntervalRef = useCallback((ref) => {
    if (ref.current) {
      clearInterval(ref.current);
      ref.current = null;
    }
  }, []);

  const stopAllPolling = useCallback(() => {
    clearIntervalRef(pollingIntervalRef);
    pollingIntervalRef.current = null;
    pollInFlightRef.current = false;
    backoffIndexRef.current = 0;
    pollingEnabledRef.current = false;
  }, [clearIntervalRef]);

  console.log('AgentQRCode - Received agentId:', agentId);

  useEffect(() => {
    if (cooldownSeconds === null) {
      return undefined;
    }

    if (cooldownSeconds <= 0) {
      setCooldownSeconds(null);
      setStatusMessage('');
      if (status === 'cooldown') {
        setStatus('disconnected');
      }
      return undefined;
    }

    const timer = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev === null) {
          return prev;
        }
        if (prev <= 1) {
          clearInterval(timer);
          if (status === 'cooldown') {
            setStatus('disconnected');
            setStatusMessage('');
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownSeconds, status]);

  // Auto-initialize WhatsApp when component mounts
  useEffect(() => {
    if (agentId) {
      console.log('AgentQRCode - Auto-initializing WhatsApp on mount, agentId:', agentId);
      // Check current status first, then initialize if needed
      const initializeIfNeeded = async () => {
        try {
          const statusResult = await checkStatus();
          if (statusResult === 'stop') {
            console.log('Agent already connected; skipping auto initialization.');
          } else {
            setTimeout(() => {
              initializeWhatsApp();
            }, 1000);
          }
        } catch (error) {
          console.error('Error checking status on mount:', error);
          // If checkStatus fails, try to initialize anyway
          setTimeout(() => {
            initializeWhatsApp();
          }, 1000);
        }
      };
      
      initializeIfNeeded();
    }
  }, [agentId]); // Remove status and startPolling from dependencies to prevent infinite loops

  useEffect(() => {
    if (!qrCodeTimestamp || status !== 'qr_pending') {
      setQrCountdownSeconds(0);
      return undefined;
    }

    const updateCountdown = () => {
      const elapsed = Date.now() - qrCodeTimestamp;
      const remaining = Math.max(0, 60 - Math.floor(elapsed / 1000));
      setQrCountdownSeconds(remaining);
      if (remaining <= 0) {
        console.log('⏰ [QR EXPIRED] 60 seconds elapsed, clearing QR');
        setQrCode(null);
        setQrCodeTimestamp(null);
        setStatus('disconnected');
        lastQrStringRef.current = null;
        setStatusMessage('QR code expired. Please generate a new one.');
        return false;
      }
      return true;
    };

    updateCountdown();
    const timer = setInterval(() => {
      if (!updateCountdown()) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [qrCodeTimestamp, status]);

  // Helper function to get auth token
  const getAuthToken = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token;
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  };

  // Initialize WhatsApp connection
  const initializeWhatsApp = async () => {
    console.log('AgentQRCode - initializeWhatsApp called with agentId:', agentId);
    setLoading(true);
    setError(null);
    setStatusMessage('Connecting to WhatsApp...');
    setStatus('connecting');
    
    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      console.log('AgentQRCode - Making request to:', `/api/agents/${agentId}/init-whatsapp`);
      console.log('AgentQRCode - Request details:', {
        agentId: agentId,
        token: token ? 'Bearer [REDACTED]' : 'MISSING'
      });
      
      const response = await fetch(`/api/agents/${agentId}/init-whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include', // SECURITY: Send HttpOnly cookies
        body: JSON.stringify({ 
          agentId: agentId  // Include in body for redundancy
        })
      });

      if (response.status === 202 || response.status === 429) {
        const info = await response.json();
        console.log('WhatsApp init informational response:', info);

        if (response.status === 202) {
          setStatus('connecting');
          setStatusMessage(info.message || 'Connection already in progress. Waiting…');
        } else if (response.status === 429) {
          setStatus('cooldown');
          const retryMs = info.retryAfter || 5000;
          setCooldownSeconds(Math.ceil(retryMs / 1000));
          setStatusMessage(info.message || 'Please wait before retrying.');
        }

        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('WhatsApp init response:', data);

      setCooldownSeconds(null);
      setStatusMessage('');

      if (data.qrCode || data.qr) {
        console.log('QR code received in frontend:', !!data.qrCode || !!data.qr);
        const rawQr = data.qrCode || data.qr;
        const newQrCode = await normalizeQrCode(rawQr);
        if (newQrCode) {
          lastQrStringRef.current = rawQr;
          setQrCode(newQrCode);
          setQrCodeTimestamp(Date.now());
          setStatus('qr_pending');
          console.log('✅ [QR TIMESTAMP] QR code set at:', new Date().toISOString());
        } else {
          setError('Failed to render QR code. Please try again.');
        }
        startPolling();
      } else if (data.status === 'authenticated') {
        const wasNotAuthenticated = previousStatusRef.current !== 'authenticated' && previousStatusRef.current !== 'connected';
        setStatus('authenticated');
        setPhoneNumber(data.phoneNumber);
        setStatusMessage('');
        
        // Show success popup when authenticated (only once)
        if (wasNotAuthenticated) {
          // Use setTimeout to ensure state has updated
          setTimeout(() => {
            toast({
              title: "✅ WhatsApp Connected Successfully!",
              description: `Your agent is now connected to WhatsApp${data.phoneNumber ? ` (${data.phoneNumber})` : ''}. You can start receiving messages!`,
              duration: 5000,
            });
          }, 100);
        }
      } else {
        setStatus('initializing');
        setStatusMessage('Initializing WhatsApp connection...');
        // Start polling to wait for QR code
        setTimeout(() => {
          startPolling();
        }, 2000);
      }
    } catch (err) {
      console.error('Error initializing WhatsApp:', err);
      setStatus('disconnected');
      setStatusMessage('');
      setCooldownSeconds(null);
      if (err?.message?.toLowerCase().includes('conflict')) {
        setError('Session conflict detected. Please unlink existing WhatsApp Web sessions and try again.');
      } else if (err.message) {
        setError(err.message);
      } else {
        setError('Network error. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Check WhatsApp status
  const checkStatus = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        console.error('No authentication token available');
        setError('Authentication required. Please refresh and sign in again.');
        stopAllPolling();
        return 'stop';
      }

      const response = await fetch(`/api/agents/${agentId}/whatsapp-status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      if (response.status === 429) {
        console.warn('WhatsApp status polling rate limited');
        setStatusMessage('WhatsApp is rate limiting requests. Retrying shortly…');
        setError('We are reconnecting to WhatsApp. Please wait a moment.');
        return 'backoff';
      }

      if (!response.ok) {
        console.error('Status check failed:', response.status, response.statusText);
        setError('Unable to reach WhatsApp status service. Please try again.');
        return 'stop';
      }

      const text = await response.text();
      if (!text) {
        console.error('Empty response from server');
        return 'stop';
      }

      const data = JSON.parse(text);
      console.log('Status check response:', data);

      const qrExpired = qrCodeTimestamp && (Date.now() - qrCodeTimestamp > 60000);
      if (qrExpired) {
        console.log('⏰ [QR EXPIRED] QR code is older than 60 seconds');
      }

      if (data.status === 'connected' || data.status === 'authenticated') {
        const wasNotConnected = previousStatusRef.current !== 'connected' && previousStatusRef.current !== 'authenticated';
        setStatus('connected');
        setPhoneNumber(data.phone_number);
        setQrCode(null);
        setQrCodeTimestamp(null);
        lastQrStringRef.current = null;
        setStatusMessage('');
        setCooldownSeconds(null);
        setError(null);
        stopAllPolling();
        console.log('WhatsApp connection confirmed; polling halted.');
        
        // Show success popup when connection is established (only once)
        if (wasNotConnected) {
          // Use setTimeout to ensure state has updated
          setTimeout(() => {
            toast({
              title: "✅ WhatsApp Connected Successfully!",
              description: `Your agent is now connected to WhatsApp${data.phone_number ? ` (${data.phone_number})` : ''}. You can start receiving messages!`,
              duration: 5000,
            });
          }, 100);
        }
        
        return 'stop';
      } else if (data.status === 'conflict') {
        setStatus('disconnected');
        setQrCode(null);
        setQrCodeTimestamp(null);
        lastQrStringRef.current = null;
        setStatusMessage('');
        setError(data.message || 'WhatsApp reported a session conflict. Please unlink other devices and try again.');
        stopAllPolling();
        return 'stop';
      } else if (data.status === 'qr_pending') {
        setStatus('qr_pending');
        setError(null);

        if (data.qr_code) {
          const rawQr = data.qr_code;
          const normalizedQr = (!qrExpired && rawQr === lastQrStringRef.current)
            ? qrCode
            : await normalizeQrCode(rawQr);
          if (!qrCode || rawQr !== lastQrStringRef.current || qrExpired) {
            if (normalizedQr) {
              console.log('🔄 [QR UPDATE] Updating QR code from status check');
              lastQrStringRef.current = rawQr;
              setQrCode(normalizedQr);
              setQrCodeTimestamp(Date.now());
            } else {
              console.warn('Unable to update QR code (conversion failed)');
            }
          } else {
            console.log('⏭️ [QR KEEP] Keeping current QR code (still valid)');
          }
        } else if (qrCode && !qrExpired) {
          console.log('⏭️ [QR KEEP] Keeping existing QR code (not expired)');
        } else if (qrExpired) {
          console.log('❌ [QR CLEAR] QR code expired, clearing');
          setQrCode(null);
          setQrCodeTimestamp(null);
          setStatusMessage('QR code expired. Please generate a new one.');
        }

        setStatusMessage('Ready to scan. Open WhatsApp → Linked Devices to scan the QR.');
        return 'continue';
      } else if (data.status === 'initializing') {
        setStatus('initializing');
        setStatusMessage('Initializing WhatsApp connection...');
        setError(null);

        if (qrCode && !qrExpired) {
          console.log('⏭️ [QR KEEP] Keeping QR during initialization');
        }
        return 'continue';
      } else {
        setStatus('disconnected');
        lastQrStringRef.current = null;
        setStatusMessage('');

        if (qrExpired) {
          console.log('❌ [QR CLEAR] Clearing expired QR code');
          setQrCode(null);
          setQrCodeTimestamp(null);
          lastQrStringRef.current = null;
        } else if (qrCode) {
          console.log('⏭️ [QR KEEP] Keeping QR code (status disconnected but QR not expired)');
        }
        stopAllPolling();
        return 'stop';
      }
    } catch (err) {
      console.error('Error checking status:', err);
      if (qrCode && qrCodeTimestamp && (Date.now() - qrCodeTimestamp <= 60000)) {
        console.log('⏭️ [QR KEEP] Error occurred but keeping valid QR code');
      }
      setStatus('disconnected');
      setError('Network error while checking WhatsApp status. Retrying soon…');
      return 'backoff';
    }
  }, [agentId, stopAllPolling, qrCode, qrCodeTimestamp]);

  const runPoll = useCallback(async () => {
    if (pollInFlightRef.current || !pollingEnabledRef.current) {
      return;
    }

    pollInFlightRef.current = true;
    const result = await checkStatus();
    pollInFlightRef.current = false;

    if (!pollingEnabledRef.current || result === 'stop') {
      clearIntervalRef(pollingIntervalRef);
      pollingIntervalRef.current = null;
      return;
    }

    let delay = POLL_INTERVAL_MS;

    if (result === 'backoff') {
      const idx = Math.min(backoffIndexRef.current, BACKOFF_DELAYS.length - 1);
      delay = BACKOFF_DELAYS[idx];
      backoffIndexRef.current = idx + 1;
    } else {
      backoffIndexRef.current = 0;
    }

    clearIntervalRef(pollingIntervalRef);
    pollingIntervalRef.current = setTimeout(runPoll, delay);
  }, [checkStatus, clearIntervalRef]);

  // Poll for authentication status
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current || pollInFlightRef.current) {
      console.log('Polling already active for agent:', agentId);
      return;
    }

    pollingEnabledRef.current = true;
    backoffIndexRef.current = 0;
    runPoll();
  }, [agentId, runPoll]);

  // Update previousStatusRef when status changes
  useEffect(() => {
    previousStatusRef.current = status;
  }, [status]);

  // Check status on mount
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    return () => {
      stopAllPolling();
    };
  }, [stopAllPolling]);

  // Disconnect WhatsApp
  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect WhatsApp?')) return;

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      const response = await fetch(`/api/agents/${agentId}/disconnect-whatsapp`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include' // SECURITY: Send HttpOnly cookies
      });

      const data = await response.json();
      
      if (data.success) {
        setStatus('disconnected');
        setQrCode(null);
        setQrCodeTimestamp(null);
        setPhoneNumber(null);
      }
    } catch (err) {
      console.error('Error disconnecting:', err);
      setError('Failed to disconnect');
    }
  };

  return (
    <div className="whatsapp-qr-container p-6 glass-card rounded-lg shadow-glow border-white/10">
      <h2 className="text-2xl font-bold mb-4 text-white">WhatsApp Connection</h2>

      {/* Loading State */}
      {status === 'loading' && (
        <div className="text-center">
          <p className="mb-4 text-white">🔄 Loading WhatsApp connection...</p>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        </div>
      )}

      {/* Disconnected State */}
      {status === 'disconnected' && (
        <div>
          <p className="mb-4 text-white">Connect your agent to WhatsApp</p>
          <button 
            onClick={initializeWhatsApp} 
            disabled={loading || status === 'connecting' || status === 'cooldown'}
            className="bg-gradient-primary hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] text-white font-bold py-2 px-4 rounded-lg transition-all duration-300 disabled:opacity-50"
          >
            {loading || status === 'connecting' ? 'Connecting...' : 'Connect WhatsApp'}
          </button>
          {statusMessage && (
            <p className="mt-2 text-sm text-gray-300">{statusMessage}</p>
          )}
          {status === 'cooldown' && cooldownSeconds !== null && (
            <p className="mt-1 text-xs text-gray-400">Retry available in {cooldownSeconds}s</p>
          )}
        </div>
      )}

      {/* Initializing State */}
      {status === 'initializing' && (
        <div>
          <p className="mb-4 text-white">⏳ Initializing WhatsApp connection...</p>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}

      {status === 'connecting' && (
        <div>
          <p className="mb-4 text-white">🔄 Connecting to WhatsApp...</p>
          <p className="text-sm text-gray-300">{statusMessage || 'Please wait while we prepare the session.'}</p>
          <div className="mt-2 animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        </div>
      )}

      {status === 'cooldown' && (
        <div>
          <p className="mb-2 text-yellow-400 font-semibold">⚠️ Please wait before retrying</p>
          <p className="text-sm text-gray-300">{statusMessage}</p>
          {cooldownSeconds !== null && (
            <p className="mt-1 text-xs text-gray-400">Retry available in {cooldownSeconds}s</p>
          )}
          <button
            onClick={initializeWhatsApp}
            disabled={cooldownSeconds !== null && cooldownSeconds > 0}
            className="mt-4 bg-muted hover:bg-muted/80 text-white font-bold py-2 px-4 rounded-lg transition-all duration-300 disabled:opacity-50"
          >
            Retry Now
          </button>
        </div>
      )}

      {/* QR Code State */}
      {status === 'qr_pending' && qrCode && (
        <div className="qr-code-display text-center">
          <div className="flex justify-center mb-4">
            <img 
              src={qrCode} 
              alt="WhatsApp QR Code" 
              className="qr-code-image border border-white/20 rounded-lg bg-white p-2"
            />
          </div>
          <p className="text-sm text-gray-400 mb-4">
            ⏱️ Waiting for scan...
            {qrCountdownSeconds > 0 ? ` (${qrCountdownSeconds}s remaining)` : ''}
          </p>
        </div>
      )}

      {/* Authenticated State */}
      {status === 'authenticated' && (
        <div className="connection-success text-center">
          <h3 className="text-xl font-semibold text-success mb-2">✅ WhatsApp Connected</h3>
          <p className="mb-2 text-white">Phone Number: <strong className="text-primary">{phoneNumber}</strong></p>
          <p className="text-success mb-4">Your agent is ready to receive messages!</p>
          <button 
            onClick={handleDisconnect} 
            className="bg-destructive hover:bg-destructive/90 text-white font-bold py-2 px-4 rounded-lg transition-all duration-300"
          >
            Disconnect WhatsApp
          </button>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="alert alert-error bg-destructive/20 border border-destructive/50 text-destructive px-4 py-3 rounded-lg mb-4">
          <p className="text-white">❌ {error}</p>
          <button 
            onClick={() => setError(null)}
            className="mt-2 bg-destructive hover:bg-destructive/90 text-white font-bold py-1 px-2 rounded text-sm transition-all duration-300"
          >
            Dismiss
          </button>
        </div>
      )}

    </div>
  );
}
