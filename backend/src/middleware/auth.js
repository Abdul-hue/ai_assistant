const { supabaseAnon } = require('../config/supabase');

/**
 * Authentication middleware
 * SECURITY: Reads Supabase tokens from HttpOnly cookies
 * Priority: Cookie > Authorization header for enhanced security
 * 
 * FIXED: Uses supabaseAnon (configured with proper headers) for token verification
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Get token from cookie (priority) or Authorization header
    const token = req.cookies?.sb_access_token || 
                  (req.headers.authorization?.startsWith('Bearer ') 
                    ? req.headers.authorization.replace('Bearer ', '') 
                    : null);

    if (!token) {
      return res.status(401).json({ error: "No token" });
    }

    // Verify token with Supabase (using anon client with proper headers)
    const { data, error } = await supabaseAnon.auth.getUser(token);

    if (error) {
      console.error('❌ Token validation failed:', error.message);
      // Clear invalid cookies
      res.clearCookie('sb_access_token');
      res.clearCookie('sb_refresh_token');
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!data?.user) {
      console.error('❌ Token validation failed: No user found');
      return res.status(401).json({ error: "Invalid token" });
    }

    // Attach user to request
    req.user = {
      id: data.user.id,
      email: data.user.email,
      role: data.user.user_metadata?.role || 'user',
      fullName: data.user.user_metadata?.full_name,
      avatarUrl: data.user.user_metadata?.avatar_url,
    };

    console.log('✅ Supabase user authenticated:', data.user.email);
    next();
  } catch (error) {
    console.error('❌ Auth middleware error:', error.message || error);
    return res.status(500).json({ error: "Auth failure" });
  }
};

module.exports = { authMiddleware };
