/**
 * Folder Management Routes
 * Handles folder operations, email counts, and folder metadata
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const {
  getAllFoldersWithMetadata,
  getEmailCountByFolder,
  getUnreadByFolder,
  moveEmailToFolder,
  deleteEmailPermanently,
  toggleEmailStar,
  toggleEmailRead,
} = require('../services/folderManagementService');

const router = express.Router();

/**
 * GET /api/folders/folders/:accountId
 * Get all folders with metadata
 */
router.get('/folders/:accountId', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;

    // Verify account belongs to user
    const { data: account, error: accError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    // Get folders with metadata
    const folders = await getAllFoldersWithMetadata(account);

    // Get counts
    const emailCounts = await getEmailCountByFolder(accountId);
    const unreadCounts = await getUnreadByFolder(accountId);

    // Enrich with counts
    const enrichedFolders = folders.map(folder => ({
      ...folder,
      totalEmails: emailCounts[folder.name] || 0,
      unreadCount: unreadCounts[folder.name] || 0,
    }));

    res.json({
      success: true,
      data: enrichedFolders,
    });
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/folders/folder-stats/:accountId
 * Get email counts for all folders
 */
router.get('/folder-stats/:accountId', authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const emailCounts = await getEmailCountByFolder(accountId);
    const unreadCounts = await getUnreadByFolder(accountId);

    res.json({
      success: true,
      data: {
        emailCounts,
        unreadCounts,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/folders/move-email
 * Move email to folder
 */
router.post('/move-email', authMiddleware, async (req, res) => {
  try {
    const { accountId, uid, fromFolder, toFolder } = req.body;

    if (!accountId || !uid || !fromFolder || !toFolder) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const result = await moveEmailToFolder(accountId, uid, fromFolder, toFolder);

    // Broadcast via WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_moved', { accountId, uid, fromFolder, toFolder });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/folders/delete-email
 * Delete email
 */
router.post('/delete-email', authMiddleware, async (req, res) => {
  try {
    const { accountId, uid, folder } = req.body;

    if (!accountId || !uid || !folder) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const result = await deleteEmailPermanently(accountId, uid, folder);

    // Broadcast via WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_deleted', { accountId, uid, folder });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/folders/toggle-star
 * Toggle star
 */
router.post('/toggle-star', authMiddleware, async (req, res) => {
  try {
    const { accountId, uid, folder, shouldStar } = req.body;

    if (!accountId || !uid || !folder || shouldStar === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const result = await toggleEmailStar(accountId, uid, folder, shouldStar);

    // Broadcast via WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_flag_update', { accountId, uid, folder, isStarred: shouldStar });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/folders/toggle-read
 * Toggle read
 */
router.post('/toggle-read', authMiddleware, async (req, res) => {
  try {
    const { accountId, uid, folder, shouldRead } = req.body;

    if (!accountId || !uid || !folder || shouldRead === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify account belongs to user
    const { data: account, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const result = await toggleEmailRead(accountId, uid, folder, shouldRead);

    // Broadcast via WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('email_flag_update', { accountId, uid, folder, isRead: shouldRead });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;

