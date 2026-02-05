// Frontend Configuration
/**
 * Normalize API URL to prevent double slashes
 * Removes trailing slashes to ensure proper URL concatenation
 * @param {string|undefined} url - The API URL to normalize
 * @returns {string} Normalized API URL without trailing slashes
 */
function normalizeApiUrl(url) {
  if (!url) {
    // In production, use relative URLs (same domain)
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
      return '';
    }
    // In development, default to localhost
    return 'http://localhost:3001';
  }
  
  // Remove trailing slashes to prevent double slashes when concatenating
  return url.replace(/\/+$/, '');
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);

// Google OAuth Client ID for Gmail integration
// Use the same Client ID as backend for Gmail OAuth
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 
  '699573195201-n5sfj8j4t4pvnir82ehn5q24u6n8nuu6.apps.googleusercontent.com';

/**
 * Helper function to build API URLs safely
 * Ensures proper URL construction without double slashes
 * @param {string} endpoint - API endpoint (should start with /)
 * @returns {string} Complete API URL
 */
export function buildApiUrl(endpoint) {
  // Ensure endpoint starts with /
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  
  if (!API_URL) {
    // Relative URL (production same-domain)
    return normalizedEndpoint;
  }
  
  // Absolute URL - API_URL already has no trailing slash
  return `${API_URL}${normalizedEndpoint}`;
}

export { API_URL, GOOGLE_CLIENT_ID };
