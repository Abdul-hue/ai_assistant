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

    // Verify token with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(access_token);

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
    const COOKIE_OPTIONS_BASE = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    };

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
    
    const responseData = { 
      success: true,
      message: 'Session cookies created',
      user: {
        id: user.id,
        email: user.email,
        role: user.user_metadata?.role || 'user',
        fullName: user.user_metadata?.full_name,
        avatarUrl: user.user_metadata?.avatar_url,
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
    const { email, password, fullName, companyName, phoneNumber } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: 'Missing fields',
        message: 'Email and password are required',
      });
    }

    const metadata = {
      full_name: fullName || '',
      company_name: companyName || '',
      phone_number: phoneNumber || '',
    };

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
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
 * POST /api/auth/logout
 * Clear Supabase session cookies
 * SECURITY: Removes HttpOnly cookies to invalidate session
 */
router.post('/logout', (req, res) => {
  console.log('👋 User logging out');
  
  // Clear both Supabase cookies
  res.clearCookie('sb_access_token', { 
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  
  res.clearCookie('sb_refresh_token', { 
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  
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
