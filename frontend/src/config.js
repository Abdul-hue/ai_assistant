// Frontend Configuration
const API_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : ''); // Use relative URLs in production (same domain)

// Google OAuth Client ID for Gmail integration
// Use the same Client ID as backend for Gmail OAuth
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 
  '699573195201-n5sfj8j4t4pvnir82ehn5q24u6n8nuu6.apps.googleusercontent.com';

export { API_URL, GOOGLE_CLIENT_ID };
