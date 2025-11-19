const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase environment variables:');
  console.error('   SUPABASE_URL:', SUPABASE_URL ? '✅ Set' : '❌ Missing');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');
  console.error('   SUPABASE_JWT_SECRET:', SUPABASE_JWT_SECRET ? '✅ Set' : '❌ Missing');
  throw new Error('Supabase configuration is incomplete');
}

// Debug environment variables
console.log('🔍 Supabase Configuration Debug:');
console.log('   Supabase URL:', SUPABASE_URL);
console.log('   Using Service Role Key:', SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + '...');
console.log('   Key type:', SUPABASE_SERVICE_ROLE_KEY?.startsWith('eyJ') ? 'JWT (service_role)' : 'ANON KEY (wrong!)');
console.log('   Key length:', SUPABASE_SERVICE_ROLE_KEY?.length);
console.log('   Key has leading/trailing spaces:', SUPABASE_SERVICE_ROLE_KEY?.trim() !== SUPABASE_SERVICE_ROLE_KEY);
console.log('   Key ends with newline:', SUPABASE_SERVICE_ROLE_KEY?.endsWith('\n') || SUPABASE_SERVICE_ROLE_KEY?.endsWith('\r'));

// ✅ FIX: Trim the service role key to remove any whitespace
const trimmedServiceKey = SUPABASE_SERVICE_ROLE_KEY?.trim();

// Create Supabase admin client (with service role key for server-side operations)
const supabaseAdmin = createClient(SUPABASE_URL, trimmedServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Create Supabase client for JWT verification (with service role key for server-side)
const supabaseAnon = createClient(SUPABASE_URL, trimmedServiceKey);

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

    // Use Supabase client to verify the token
    const { data: { user }, error } = await supabaseAnon.auth.getUser(token);
    
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
