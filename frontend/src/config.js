// Frontend Configuration
const API_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : ''); // Use relative URLs in production (same domain)

const GOOGLE_CLIENT_ID = '494556024053-c1mgtgp8v8q305t0fkfp733d63lrefb5.apps.googleusercontent.com';

export { API_URL, GOOGLE_CLIENT_ID };
