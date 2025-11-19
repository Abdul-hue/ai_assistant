const { supabaseAdmin } = require('../config/supabase');

/**
 * Authentication middleware
 * SECURITY: Reads Supabase tokens from HttpOnly cookies
 * Priority: Cookie > Authorization header for enhanced security
 */
const authMiddleware = async (req, res, next) => {
  try {
    let token = null;

    // Priority 1: Read from HttpOnly cookie (secure)
    if (req.cookies?.sb_access_token) {
      token = req.cookies.sb_access_token;
      console.log('🔐 Supabase token from cookie (secure)');
    }
    // Priority 2: Fallback to Authorization header (for API clients)
    else if (req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.replace('Bearer ', '');
        console.log('🔓 Supabase token from header (fallback)');
      }
    }

    if (!token) {
      console.warn('⚠️  No Supabase token found');
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'No access token found in cookies or headers'
      });
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      console.error('❌ Token validation failed:', error?.message);
      
      // Clear invalid cookies
      res.clearCookie('sb_access_token');
      res.clearCookie('sb_refresh_token');
      
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        message: error?.message || 'Authentication failed'
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.user_metadata?.role || 'user',
      fullName: user.user_metadata?.full_name,
      avatarUrl: user.user_metadata?.avatar_url,
    };

    console.log('✅ Supabase user authenticated:', user.email);
    next();
  } catch (error) {
    console.error('❌ Auth middleware error:', error);
    return res.status(500).json({ 
      error: 'Authentication error',
      message: 'Internal server error'
    });
  }
};

module.exports = { authMiddleware };
