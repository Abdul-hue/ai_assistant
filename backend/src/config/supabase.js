const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY; // Fallback to service key if anon not set
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!SUPABASE_URL) {
  console.error('❌ Missing Supabase environment variables:');
  console.error('   SUPABASE_URL:', SUPABASE_URL ? '✅ Set' : '❌ Missing');
  throw new Error('Supabase URL is required');
}

// ✅ FIX: Trim keys to remove any whitespace
const trimmedServiceKey = SUPABASE_SERVICE_ROLE_KEY?.trim();
const trimmedAnonKey = SUPABASE_ANON_KEY?.trim();

// Custom fetch wrapper with timeout and retry logic
// Node.js 18+ has AbortController built-in
const createFetchWithTimeout = (timeoutMs = 30000) => {
  return async (url, options = {}) => {
    // Check if AbortController is available (Node.js 15+)
    if (typeof AbortController === 'undefined') {
      console.warn('⚠️  AbortController not available, using basic fetch');
      return fetch(url, options);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Retry once on timeout or connection errors
      const isTimeoutError = error.name === 'AbortError' || 
                             error.code === 'UND_ERR_CONNECT_TIMEOUT' || 
                             error.message?.includes('timeout') ||
                             error.message?.includes('fetch failed');
      
      if (isTimeoutError) {
        console.warn(`⚠️  Supabase request timed out or failed (${timeoutMs}ms), retrying once...`);
        console.warn(`   URL: ${url}`);
        console.warn(`   Error: ${error.message || error.code || 'Unknown error'}`);
        
        const retryController = new AbortController();
        const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
        try {
          const retryResponse = await fetch(url, {
            ...options,
            signal: retryController.signal,
          });
          clearTimeout(retryTimeoutId);
          console.log('✅ Supabase retry succeeded');
          return retryResponse;
        } catch (retryError) {
          clearTimeout(retryTimeoutId);
          console.error('❌ Supabase retry also failed:', retryError.message || retryError.code);
          console.error('   This indicates a network connectivity issue with Supabase');
          throw retryError;
        }
      }
      throw error;
    }
  };
};

// Create Supabase admin client (with service role key for server-side operations)
// Add timeout and retry configuration
const supabaseAdmin = createClient(SUPABASE_URL, trimmedServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    fetch: createFetchWithTimeout(30000), // 30 second timeout
    headers: {
      apikey: trimmedServiceKey,
      Authorization: `Bearer ${trimmedServiceKey}`
    }
  }
});

// Create Supabase client for JWT verification (with anon key for token verification)
// This is the client used by auth middleware to verify user tokens
const supabaseAnon = createClient(SUPABASE_URL, trimmedAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  },
  global: {
    fetch: createFetchWithTimeout(30000), // 30 second timeout
    headers: {
      apikey: trimmedAnonKey,
      Authorization: `Bearer ${trimmedAnonKey}`
    }
  }
});

/**
 * Verify Supabase JWT token
 * @param {string} token - Supabase JWT access token
 * @returns {Promise<Object>} - Decoded token payload
 */
async function verifySupabaseToken(token) {
  try {
    if (!token) {
      throw new Error('No token provided');
    }

    // Use Supabase client to verify the token (with timeout)
    let result;
    try {
      result = await Promise.race([
        supabaseAnon.auth.getUser(token),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Supabase connection timeout')), 25000)
        )
      ]);
    } catch (timeoutError) {
      console.error('⚠️  Supabase connection timeout during token verification');
      console.error('   This might be a network connectivity issue');
      throw new Error('Unable to verify token: Supabase connection timeout. Please check your network connection.');
    }
    
    const { data: { user }, error } = result;
    
    if (error) {
      throw new Error(`Token verification failed: ${error.message}`);
    }

    if (!user) {
      throw new Error('Invalid token: No user found');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
      avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture,
      role: user.role || 'authenticated',
      aud: user.aud,
      iss: user.iss,
      sub: user.sub,
    };
  } catch (error) {
    console.error('Supabase token verification error:', error.message);
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

/**
 * Get user from Supabase by ID
 * @param {string} userId - Supabase user ID
 * @returns {Promise<Object>} - User object
 */
async function getUserById(userId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // User not found, create a basic profile
        const { data: newProfile, error: createError } = await supabaseAdmin
          .from('profiles')
          .insert({
            id: userId,
            email: 'unknown@example.com', // This will be updated when we have more info
            full_name: 'Unknown User',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (createError) {
          throw new Error(`Failed to create user profile: ${createError.message}`);
        }

        return newProfile;
      }
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error getting user by ID:', error.message);
    throw error;
  }
}

/**
 * Create or update user profile
 * @param {Object} userData - User data from Supabase auth
 * @returns {Promise<Object>} - User profile
 */
async function createOrUpdateUserProfile(userData) {
  try {
    const { id, email, name, avatar_url } = userData;
    
    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw new Error(`Database error: ${fetchError.message}`);
    }

    if (existingUser) {
      // Update existing user
      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          email: email,
          full_name: name,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to update user: ${updateError.message}`);
      }

      return updatedUser;
    } else {
      // Create new user
      const { data: newUser, error: createError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: id,
          email: email,
          full_name: name,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        throw new Error(`Failed to create user: ${createError.message}`);
      }

      return newUser;
    }
  } catch (error) {
    console.error('Error creating/updating user profile:', error.message);
    throw error;
  }
}

module.exports = {
  supabaseAdmin,
  supabaseAnon,
  verifySupabaseToken,
  getUserById,
  createOrUpdateUserProfile,
};
