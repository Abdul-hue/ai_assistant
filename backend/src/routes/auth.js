const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// 🔧 FIX: In-memory cache for idempotency keys
const recentIdempotencyKeys = new Map();

/**
 * POST /api/auth/session
 * Convert Supabase OAuth tokens to HttpOnly cookies
 * SECURITY: This prevents XSS attacks by moving tokens from localStorage to secure cookies
 * IDEMPOTENCY: Handles duplicate requests gracefully
 */
router.post('/session', async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'];

    // 🔧 FIX: Check if we've already processed this exact request
    if (idempotencyKey && recentIdempotencyKeys.has(idempotencyKey)) {
      console.log('⏭️  Duplicate request detected (idempotency), returning cached response');
      return res.json(recentIdempotencyKeys.get(idempotencyKey));
    }

    if (!access_token) {
      return res.status(400).json({ 
        error: 'Access token required',
        message: 'Supabase access_token is required in request body' 
      });
    }

    // Verify token with Supabase (with timeout handling)
    let user, error;
    try {
      const result = await Promise.race([
        supabaseAdmin.auth.getUser(access_token),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Supabase connection timeout')), 25000)
        )
      ]);
      user = result.data?.user;
      error = result.error;
    } catch (timeoutError) {
      console.error('❌ Supabase connection timeout:', timeoutError.message);
      console.error('⚠️  This might be a network connectivity issue. Check:');
      console.error('   1. Internet connection');
      console.error('   2. Firewall settings');
      console.error('   3. Supabase URL is correct:', process.env.SUPABASE_URL);
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Unable to connect to Supabase. Please check your network connection.',
        retryable: true
      });
    }

    if (error || !user) {
      console.error('❌ Token verification failed:', error?.message);
      console.error('❌ Error details:', JSON.stringify(error, null, 2));
      console.error('❌ Token preview:', access_token?.substring(0, 50) + '...');
      return res.status(401).json({ 
        error: 'Invalid token',
        message: error?.message || 'Token verification failed'
      });
    }

    // Set HttpOnly cookies for both access and refresh tokens
    const isProduction = process.env.NODE_ENV === 'production';
    const COOKIE_OPTIONS_BASE = {
      httpOnly: true,
      secure: isProduction, // true only in production (HTTPS required)
      sameSite: 'lax', // Changed from 'strict' to 'lax' for same-domain setup
      path: '/',
    };

    // DEBUG: Log cookie configuration
    console.log('🍪 Setting cookies with config:', {
      httpOnly: COOKIE_OPTIONS_BASE.httpOnly,
      secure: COOKIE_OPTIONS_BASE.secure,
      sameSite: COOKIE_OPTIONS_BASE.sameSite,
      environment: process.env.NODE_ENV,
      isProduction: isProduction,
    });

    res.cookie('sb_access_token', access_token, {
      ...COOKIE_OPTIONS_BASE,
      maxAge: 60 * 60 * 1000, // 1 hour
    });

    if (refresh_token) {
      res.cookie('sb_refresh_token', refresh_token, {
        ...COOKIE_OPTIONS_BASE,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });
    }

    console.log('✅ Supabase session cookies set for:', user.email);
    
    // DEBUG: Log response headers (temporary - remove in production later)
    const setCookieHeaders = res.getHeader('Set-Cookie');
    if (setCookieHeaders) {
      console.log('📤 Set-Cookie headers:', Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]);
    }
    
    const responseData = { 
      success: true,
      message: 'Session cookies created',
      user: {
        id: user.id,
        email: user.email,
        role: user.user_metadata?.role || 'user',
        fullName: user.user_metadata?.full_name,
        avatarUrl: user.user_metadata?.avatar_url,
      },
      // DEBUG: Include cookie config in response (remove in production later)
      debug: isProduction ? undefined : {
        cookieConfig: {
          httpOnly: COOKIE_OPTIONS_BASE.httpOnly,
          secure: COOKIE_OPTIONS_BASE.secure,
          sameSite: COOKIE_OPTIONS_BASE.sameSite,
          path: COOKIE_OPTIONS_BASE.path,
        },
        environment: process.env.NODE_ENV,
        isProduction: isProduction
      }
    };

    // 🔧 FIX: Cache response for 10 seconds to handle any stragglers
    if (idempotencyKey) {
      recentIdempotencyKeys.set(idempotencyKey, responseData);
      setTimeout(() => {
        recentIdempotencyKeys.delete(idempotencyKey);
      }, 10000); // 10 seconds
    }

    res.json(responseData);
  } catch (error) {
    console.error('❌ Session creation error:', error);
    res.status(500).json({ 
      error: 'Failed to create session',
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/email-signup
 * Create Supabase user via service role and auto-confirm email
 */
router.post('/email-signup', async (req, res) => {
  try {
    const { email, password, fullName, companyName, phoneNumber, country } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: 'Missing fields',
        message: 'Email and password are required',
      });
    }

    if (!country) {
      return res.status(400).json({
        error: 'Missing fields',
        message: 'Country is required',
      });
    }

    const metadata = {
      full_name: fullName || '',
      company_name: companyName || '',
      phone_number: phoneNumber || '',
      country: country || '',
    };

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,  // ⚠️ TEMPORARY: Email verification disabled for testing
      user_metadata: metadata,
    });

    if (error) {
      const isDuplicate = error.message?.toLowerCase().includes('user already registered');
      const status = isDuplicate ? 409 : 400;
      return res.status(status).json({
        error: 'Signup failed',
        message: error.message || 'Unable to create account',
      });
    }

    console.log('✅ Email signup completed for:', email);
    return res.json({
      success: true,
      user: {
        id: data.user?.id,
        email: data.user?.email,
      },
    });
  } catch (error) {
    console.error('❌ Email signup error:', error);
    return res.status(500).json({
      error: 'Signup failed',
      message: 'Internal server error',
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user info (protected route)
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    console.log('📋 Fetching user info for:', req.user.email);

    res.json({ 
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        avatar_url: req.user.avatar_url,
        role: req.user.role,
        profile: req.user.profile
      }
    });
  } catch (error) {
    console.error('❌ Error fetching user:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch user',
      message: 'Database error occurred'
    });
  }
});

/**
 * GET /api/auth/session-token
 * Get current session tokens from cookies (for Supabase client restoration)
 * SECURITY: Returns tokens from HttpOnly cookies so frontend can restore Supabase client session
 */
router.get('/session-token', authMiddleware, async (req, res) => {
  try {
    // Get tokens from cookies
    const accessToken = req.cookies?.sb_access_token;
    const refreshToken = req.cookies?.sb_refresh_token;

    if (!accessToken) {
      return res.status(401).json({ 
        error: 'No session token found',
        message: 'No access token in cookies'
      });
    }

    // Verify token is still valid
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);

    if (error || !user) {
      console.error('❌ Token validation failed:', error?.message);
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        message: error?.message || 'Token validation failed'
      });
    }

    console.log('✅ Session token retrieved for:', user.email);

    res.json({ 
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken || null,
      expires_at: null, // Supabase will handle expiration
    });
  } catch (error) {
    console.error('❌ Error fetching session token:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch session token',
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/logout
 * Clear Supabase session cookies
 * SECURITY: Removes HttpOnly cookies to invalidate session
 */
router.post('/logout', (req, res) => {
  console.log('👋 User logging out');
  
  // Clear both Supabase cookies (must match original cookie settings)
  const isProduction = process.env.NODE_ENV === 'production';
  const clearCookieOptions = {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' // Changed from 'strict' to 'lax' to match cookie setting
  };
  
  res.clearCookie('sb_access_token', clearCookieOptions);
  res.clearCookie('sb_refresh_token', clearCookieOptions);
  
  res.json({ 
    success: true, 
    message: 'Session cookies cleared' 
  });
});

/**
 * GET /api/auth/test
 * Test endpoint to verify auth routes are working
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Auth routes are working with Supabase',
    timestamp: new Date().toISOString(),
    env: {
      supabaseUrl: process.env.SUPABASE_URL ? 'Set' : 'Missing',
      supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'Missing',
      databaseUrl: process.env.DATABASE_URL ? 'Set' : 'Missing',
    }
  });
});

module.exports = router;
