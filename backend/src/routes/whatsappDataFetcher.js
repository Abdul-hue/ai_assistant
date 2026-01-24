/**
 * API Route for WhatsApp Data Fetcher
 * 
 * Provides endpoints to fetch contacts and groups via QR authentication
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { fetchWhatsAppData, fetchWhatsAppDataWithRetry } = require('../services/whatsappDataFetcher');

const router = express.Router();

/**
 * POST /api/whatsapp-data/fetch/:agentId
 * 
 * Fetch contacts and groups for an agent via QR authentication
 * 
 * Request body (optional):
 * {
 *   "waitForGroups": 5000,  // Milliseconds to wait after connection
 *   "disconnectOnComplete": false,  // Whether to disconnect after fetch
 *   "maxRetries": 3  // Maximum retry attempts
 * }
 * 
 * Response:
 * {
 *   "contacts": [
 *     { "jid": "string", "name": "string | null" }
 *   ],
 *   "groups": [
 *     { "jid": "string", "name": "string" }
 *   ],
 *   "qrCode": "string"  // Only on first request (if QR needed)
 * }
 */
router.post('/fetch/:agentId', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    const { waitForGroups = 5000, disconnectOnComplete = false, maxRetries = 3 } = req.body;
    
    // Verify agent belongs to user
    const { supabaseAdmin } = require('../config/supabase');
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();
    
    if (agentError || !agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Store QR code for response
    let qrCode = null;
    
    // Fetch data with QR callback
    const data = await fetchWhatsAppDataWithRetry(
      agentId,
      {
        waitForGroups,
        disconnectOnComplete,
      },
      (qr) => {
        // Store QR code when generated
        qrCode = qr;
      },
      maxRetries
    );
    
    // Return data with QR code if available
    res.json({
      ...data,
      qrCode: qrCode, // Will be null if already connected
    });
    
  } catch (error) {
    console.error('[DATA-FETCHER-ROUTE] Error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch WhatsApp data',
      details: error.message 
    });
  }
});

/**
 * GET /api/whatsapp-data/status/:agentId
 * 
 * Check if agent is already connected (has valid auth state)
 * 
 * Response:
 * {
 *   "connected": boolean,
 *   "hasAuthState": boolean
 * }
 */
router.get('/status/:agentId', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    
    // Verify agent belongs to user
    const { supabaseAdmin } = require('../config/supabase');
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();
    
    if (agentError || !agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Check if auth state exists
    const fs = require('fs');
    const path = require('path');
    const authPath = path.join(process.cwd(), 'auth', agentId);
    const credsPath = path.join(authPath, 'creds.json');
    
    const hasAuthState = fs.existsSync(credsPath);
    
    res.json({
      connected: false, // Can't determine without initializing socket
      hasAuthState: hasAuthState,
    });
    
  } catch (error) {
    console.error('[DATA-FETCHER-ROUTE] Status check error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
