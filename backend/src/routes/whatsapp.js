const express = require('express');
const { 
  connectToWhatsApp, 
  getSessionStatus, 
  getQRCode, 
  sendMessage, 
  disconnectWhatsApp 
} = require('../services/whatsappService');
const { authMiddleware } = require('../middleware/auth');
const pool = require('../database');

const router = express.Router();

// POST /api/whatsapp/connect
router.post('/connect', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.body;
    const userId = req.user.id;

    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID required' });
    }

    // Verify agent belongs to user
    const agentResult = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized - agent not found' });
    }

    // Create or update WhatsApp session
    await pool.query(
      `INSERT INTO whatsapp_sessions (user_id, agent_id, is_active)
       VALUES ($1, $2, true)`,
      [userId, agentId]
    );

    // Connect to WhatsApp
    await connectToWhatsApp(userId, agentId);

    res.json({ success: true, message: 'WhatsApp connection initiated - scan QR code' });
  } catch (error) {
    console.error('Connect error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/whatsapp/qr
router.get('/qr', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const qrCode = await getQRCode(userId);

    if (!qrCode) {
      return res.status(400).json({ error: 'QR code not yet generated - please wait' });
    }

    res.json({ qr: qrCode, status: 'success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/whatsapp/status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const status = await getSessionStatus(userId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/whatsapp/send
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    const userId = req.user.id;

    if (!phoneNumber || !message) {
      return res.status(400).json({ error: 'Phone number and message required' });
    }

    await sendMessage(userId, phoneNumber, message);
    res.json({ success: true, message: 'Message sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    await disconnectWhatsApp(userId);
    res.json({ success: true, message: 'WhatsApp disconnected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
