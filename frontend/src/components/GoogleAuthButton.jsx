import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_URL, GOOGLE_CLIENT_ID } from '../config';

function GoogleAuthButton() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignIn = async (response) => {
    setLoading(true);
    setError('');

    try {
      if (!response.credential) {
        throw new Error('No credential received from Google');
      }

      const verifyResponse = await fetch(`${API_URL}/api/auth/google/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // SECURITY: Send HttpOnly cookies
        body: JSON.stringify({ idToken: response.credential }),
      });

      const data = await verifyResponse.json();

      if (!verifyResponse.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      login(data.token, data.user);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err.message);
      console.error('Sign-in error:', err);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (window.google && window.google.accounts) {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleSignIn,
      });
      const container = document.getElementById('google-sign-in-button');
      if (container) {
        window.google.accounts.id.renderButton(container, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          shape: 'rectangular',
          text: 'continue_with',
          logo_alignment: 'left',
        });
      }
    }
  }, []);

  if (error) {
    return <p style={{ color: 'red' }}>Error: {error}</p>;
  }

  return (
    <div>
      {loading && <p>Signing in...</p>}
      <div id="google-sign-in-button"></div>
    </div>
  );
}

export default GoogleAuthButton;
