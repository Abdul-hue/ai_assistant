const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { google } = require('googleapis');
const gmailFeatures = require('../services/gmailExtendedFeatures');
const { getValidAccessToken } = require('./gmail');

const router = express.Router();

/**
 * Helper: Create Gmail client from user ID
 */
async function createGmailClient(userId) {
  try {
    const accessToken = await getValidAccessToken(userId, 'gmail');
    
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ access_token: accessToken });
    return oauth2Client;
  } catch (error) {
    throw new Error(`Failed to create Gmail client: ${error.message}`);
  }
}

/**
 * Archive Email
 * POST /api/emails/:messageId/archive
 */
router.post('/:messageId/archive', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const oauth2Client = await createGmailClient(req.user.id);
    const result = await gmailFeatures.archiveEmail(oauth2Client, messageId);
    
    // Broadcast to WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_archived', { messageId });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Archive error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete Email
 * POST /api/emails/:messageId/delete
 */
router.post('/:messageId/delete', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const oauth2Client = await createGmailClient(req.user.id);
    const result = await gmailFeatures.deleteEmail(oauth2Client, messageId);
    
    // Broadcast to WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_deleted', { messageId });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Star Email
 * POST /api/emails/:messageId/star
 */
router.post('/:messageId/star', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { star } = req.body;
    const oauth2Client = await createGmailClient(req.user.id);
    const result = await gmailFeatures.starEmail(oauth2Client, messageId, star !== false);
    
    // Broadcast to WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_starred', { messageId, starred: result.starred });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Star error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Mark as Read/Unread
 * POST /api/emails/:messageId/read
 */
router.post('/:messageId/read', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { isRead } = req.body;
    const oauth2Client = await createGmailClient(req.user.id);
    const result = await gmailFeatures.markAsRead(oauth2Client, messageId, isRead !== false);
    
    res.json(result);
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Move to Label
 * POST /api/emails/:messageId/label
 */
router.post('/:messageId/label', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { labelId, removeFromInbox } = req.body;
    const oauth2Client = await createGmailClient(req.user.id);
    const result = await gmailFeatures.moveToLabel(oauth2Client, messageId, labelId, removeFromInbox);
    
    res.json(result);
  } catch (error) {
    console.error('Move label error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get All Labels
 * GET /api/labels
 */
router.get('/labels', authMiddleware, async (req, res) => {
  try {
    const oauth2Client = await createGmailClient(req.user.id);
    const labels = await gmailFeatures.getLabels(oauth2Client);
    res.json({ labels });
  } catch (error) {
    console.error('Get labels error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send Email
 * POST /api/emails/send
 */
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { to, subject, body, isHtml } = req.body;
    
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const oauth2Client = await createGmailClient(req.user.id);
    const result = await gmailFeatures.sendEmail(oauth2Client, to, subject, body, isHtml);
    
    res.json(result);
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Reply to Email
 * POST /api/emails/:messageId/reply
 */
router.post('/:messageId/reply', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { replyBody, isHtml } = req.body;
    
    if (!replyBody) {
      return res.status(400).json({ error: 'Reply body is required' });
    }

    const oauth2Client = await createGmailClient(req.user.id);
    const result = await gmailFeatures.replyEmail(oauth2Client, messageId, replyBody, isHtml);
    
    res.json(result);
  } catch (error) {
    console.error('Reply error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get Attachments
 * GET /api/emails/:messageId/attachments
 */
router.get('/:messageId/attachments', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const oauth2Client = await createGmailClient(req.user.id);
    const attachments = await gmailFeatures.getAttachments(oauth2Client, messageId);
    res.json({ attachments });
  } catch (error) {
    console.error('Get attachments error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Download Attachment
 * GET /api/emails/:messageId/attachments/:attachmentId/download
 */
router.get('/:messageId/attachments/:attachmentId/download', authMiddleware, async (req, res) => {
  try {
    const { messageId, attachmentId } = req.params;
    const oauth2Client = await createGmailClient(req.user.id);
    const attachment = await gmailFeatures.downloadAttachment(oauth2Client, messageId, attachmentId);
    
    // Decode and send
    const data = Buffer.from(attachment.data, 'base64');
    
    // Get filename from attachment info
    const attachments = await gmailFeatures.getAttachments(oauth2Client, messageId);
    const attInfo = attachments.find(a => a.id === attachmentId);
    const filename = attInfo?.filename || 'attachment';
    
    res.setHeader('Content-Type', attInfo?.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(data);
  } catch (error) {
    console.error('Download attachment error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

