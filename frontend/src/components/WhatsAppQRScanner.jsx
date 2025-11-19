import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';

function WhatsAppQRScanner({ agentId, onConnected }) {
  const { token } = useAuth();
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState('Initializing...');
  const [loading, setLoading] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState('');

  useEffect(() => {
    if (!token || !agentId) return;

    const initWhatsApp = async () => {
      try {
        await fetch(`${API_URL}/api/whatsapp/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          credentials: 'include', // SECURITY: Send HttpOnly cookies
          body: JSON.stringify({ agentId }),
        });

        const qrResponse = await fetch(`${API_URL}/api/whatsapp/qr`, {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include', // SECURITY: Send HttpOnly cookies
        });

        const qrData = await qrResponse.json();

        if (qrData.qr) {
          setQr(qrData.qr);
          setStatus('Scan QR code with WhatsApp → Linked Devices');
        }
        setLoading(false);
      } catch (error) {
        console.error('WhatsApp init error:', error);
        setStatus('Error initializing WhatsApp');
        setLoading(false);
      }
    };

    initWhatsApp();

    const statusInterval = setInterval(async () => {
      try {
        const statusResponse = await fetch(`${API_URL}/api/whatsapp/status`, {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include', // SECURITY: Send HttpOnly cookies
        });

        const statusData = await statusResponse.json();

        if (statusData.connected) {
          setPhoneNumber(statusData.phoneNumber);
          setStatus(`✅ Connected! Phone: ${statusData.phoneNumber}`);
          if (onConnected) {
            onConnected(statusData.phoneNumber);
          }
          clearInterval(statusInterval);
        }
      } catch (err) {
        console.error('Status check error:', err);
      }
    }, 3000);

    return () => clearInterval(statusInterval);
  }, [token, agentId, onConnected]);

  const handleRegenerate = async () => {
    setLoading(true);
    setQr('');
    setStatus('Regenerating QR code...');

    try {
      const response = await fetch(`${API_URL}/api/whatsapp/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include', // SECURITY: Send HttpOnly cookies
        body: JSON.stringify({ agentId }),
      });

      if (response.ok) {
        const qrResponse = await fetch(`${API_URL}/api/whatsapp/qr`, {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include', // SECURITY: Send HttpOnly cookies
        });

        const qrData = await qrResponse.json();
        if (qrData.qr) {
          setQr(qrData.qr);
          setStatus('New QR code ready - scan now');
        }
      }
    } catch (error) {
      setStatus('Error regenerating QR code');
      console.error('Regenerate error:', error);
    }

    setLoading(false);
  };

  return (
    <div style={{ textAlign: 'center', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
      <h2>WhatsApp Authentication</h2>
      <p style={{ fontSize: '18px', fontWeight: 'bold' }}>{status}</p>

      {loading && <p>Loading...</p>}

      {qr && !phoneNumber && (
        <div>
          <img
            src={qr}
            alt="WhatsApp QR Code"
            style={{
              width: '250px',
              height: '250px',
              border: '2px solid #333',
              marginTop: '20px',
            }}
          />
          <p style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
            Scan with your phone's WhatsApp app → Settings → Linked Devices
          </p>
          <button
            onClick={handleRegenerate}
            disabled={loading}
            style={{
              padding: '10px 20px',
              marginTop: '10px',
              backgroundColor: '#25D366',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Regenerate QR
          </button>
        </div>
      )}

      {phoneNumber && (
        <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#e8f5e9', borderRadius: '4px' }}>
          <p>✅ WhatsApp connected successfully</p>
          <p>Phone: {phoneNumber}</p>
        </div>
      )}
    </div>
  );
}

export default WhatsAppQRScanner;
