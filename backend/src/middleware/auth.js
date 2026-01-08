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
      // Don't log this as an error - it's normal when user is not logged in
      return res.status(401).json({ 
        error: "No token",
        message: "Authentication required. Please log in."
      });
    }

    // Verify token with Supabase (using anon client with proper headers)
    const { data, error } = await supabaseAnon.auth.getUser(token);

    if (error) {
      // Check if it's a session/expiration error
      const isSessionError = error.message?.toLowerCase().includes('session') || 
                            error.message?.toLowerCase().includes('expired') ||
                            error.message?.toLowerCase().includes('invalid');
      
      if (isSessionError) {
        // Session expired or invalid - clear cookies silently
        res.clearCookie('sb_access_token');
        res.clearCookie('sb_refresh_token');
        return res.status(401).json({ 
          error: "Session expired",
          message: "Your session has expired. Please log in again."
        });
      }
      
      // Other token validation errors
      console.error('❌ Token validation failed:', error.message);
      res.clearCookie('sb_access_token');
      res.clearCookie('sb_refresh_token');
      return res.status(401).json({ 
        error: "Invalid token",
        message: "Authentication failed. Please log in again."
      });
    }

    if (!data?.user) {
      // Clear cookies if user not found
      res.clearCookie('sb_access_token');
      res.clearCookie('sb_refresh_token');
      return res.status(401).json({ 
        error: "Invalid token",
        message: "User not found. Please log in again."
      });
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
