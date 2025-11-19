// SECURITY: Supabase client configured for HttpOnly cookie authentication
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// ✅ Validate environment variables with helpful error messages
if (!SUPABASE_URL) {
  const errorMsg = 'VITE_SUPABASE_URL is required. ' +
    (import.meta.env.DEV 
      ? 'Create a .env file in the frontend/ folder with VITE_SUPABASE_URL=your_url'
      : 'The Docker build must include VITE_SUPABASE_URL as a build argument.');
  console.error('❌ Supabase Configuration Error:', errorMsg);
  throw new Error(errorMsg);
}

if (!SUPABASE_PUBLISHABLE_KEY) {
  const errorMsg = 'VITE_SUPABASE_PUBLISHABLE_KEY is required. ' +
    (import.meta.env.DEV 
      ? 'Create a .env file in the frontend/ folder with VITE_SUPABASE_PUBLISHABLE_KEY=your_key'
      : 'The Docker build must include VITE_SUPABASE_PUBLISHABLE_KEY as a build argument.');
  console.error('❌ Supabase Configuration Error:', errorMsg);
  throw new Error(errorMsg);
}

// SECURITY: Configure Supabase to NOT use localStorage
// Tokens will be stored in HttpOnly cookies via backend
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: undefined,              // ✅ CRITICAL: Disable localStorage completely
    autoRefreshToken: true,          // ✅ Auto-refresh tokens in memory
    persistSession: false,           // ✅ Don't persist to localStorage
    detectSessionInUrl: true,        // ✅ Detect OAuth callbacks in URL
    flowType: 'pkce',               // ✅ Use PKCE flow for enhanced security
  }
});