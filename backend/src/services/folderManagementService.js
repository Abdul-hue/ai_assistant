/**
 * Folder Management Service
 * Handles folder operations, email counts, and folder metadata
 */

const { supabaseAdmin } = require('../config/supabase');
const { connectToImap } = require('../utils/connectToImap');

// ============================================
// GET ALL FOLDERS WITH METADATA
// ============================================

/**
 * Get all folders for account with metadata
 */
async function getAllFoldersWithMetadata(account) {
  try {
    const connection = await connectToImap(account);
    const boxes = await connection.getBoxes();
    const folders = flattenAndEnrichFolders(boxes);

    // Get sync state for each folder
    const { data: syncStates } = await supabaseAdmin
      .from('email_sync_state')
      .select('*')
      .eq('account_id', account.id);

    const syncStateMap = {};
    syncStates?.forEach(state => {
      syncStateMap[state.folder_name] = state;
    });

    // Merge with sync state
    const enrichedFolders = folders.map(folder => ({
      ...folder,
      syncState: syncStateMap[folder.name] || null,
      emailCount: syncStateMap[folder.name]?.total_server_count || 0,
    }));

    connection.end();
    return enrichedFolders;
  } catch (error) {
    console.error('Error getting folders:', error);
    throw error;
  }
}

// ============================================
// FLATTEN AND ENRICH FOLDER STRUCTURE
// ============================================

/**
 * Flatten and enrich folder structure
 */
function flattenAndEnrichFolders(boxes, parentPath = '', delimiter = '/') {
  const folders = [];

  for (const [name, box] of Object.entries(boxes)) {
    const fullName = parentPath ? `${parentPath}${box.delimiter || delimiter}${name}` : name;
    const displayName = name;

    // Determine folder type from attributes and name
    const attributes = box.attributes || [];
    let folderType = 'custom';

    if (attributes.includes('\\All')) folderType = 'all';
    else if (attributes.includes('\\Archive')) folderType = 'archive';
    else if (attributes.includes('\\Drafts')) folderType = 'drafts';
    else if (attributes.includes('\\Flagged')) folderType = 'starred';
    else if (attributes.includes('\\Junk')) folderType = 'spam';
    else if (attributes.includes('\\Sent')) folderType = 'sent';
    else if (attributes.includes('\\Trash')) folderType = 'trash';
    else if (attributes.includes('\\Important')) folderType = 'important';
    else if (name.toLowerCase() === 'inbox') folderType = 'inbox';

    folders.push({
      name: fullName,
      displayName: displayName,
      type: folderType,
      delimiter: box.delimiter || delimiter,
      attributes: attributes,
      canSelect: !attributes.includes('\\Noselect'),
      children: box.children ? Object.keys(box.children).length : 0,
    });

    // Process children recursively
    if (box.children && Object.keys(box.children).length > 0) {
      folders.push(...flattenAndEnrichFolders(box.children, fullName, box.delimiter || delimiter));
    }
  }

  return folders;
}

// ============================================
// GET EMAIL COUNT BY FOLDER
// ============================================

/**
 * Get email count by folder
 */
async function getEmailCountByFolder(accountId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('emails')
      .select('folder_name')
      .eq('email_account_id', accountId)
      .eq('is_deleted', false);

    if (error) throw error;

    const folderCounts = {};
    data?.forEach(row => {
      const folder = row.folder_name || 'INBOX';
      folderCounts[folder] = (folderCounts[folder] || 0) + 1;
    });

    return folderCounts;
  } catch (error) {
    console.error('Error getting folder counts:', error);
    return {};
  }
}

// ============================================
// GET UNREAD BY FOLDER
// ============================================

/**
 * Get unread count by folder
 */
async function getUnreadByFolder(accountId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('emails')
      .select('folder_name')
      .eq('email_account_id', accountId)
      .eq('is_deleted', false)
      .eq('is_read', false);

    if (error) throw error;

    const folderUnread = {};
    data?.forEach(row => {
      const folder = row.folder_name || 'INBOX';
      folderUnread[folder] = (folderUnread[folder] || 0) + 1;
    });

    return folderUnread;
  } catch (error) {
    console.error('Error getting unread counts:', error);
    return {};
  }
}

// ============================================
// MOVE EMAIL TO FOLDER
// ============================================

/**
 * Move email to different folder
 */
async function moveEmailToFolder(accountId, uid, folderName, targetFolderName) {
  try {
    const { data: account, error: accError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accError) throw accError;

    const connection = await connectToImap(account);

    // Open source folder
    await connection.openBox(folderName, false);

    // Move email
    await connection.move([uid.toString()], targetFolderName);

    // Update in database
    const { error } = await supabaseAdmin
      .from('emails')
      .update({ folder_name: targetFolderName })
      .eq('email_account_id', accountId)
      .eq('uid', uid)
      .eq('folder_name', folderName);

    if (error) throw error;

    connection.end();
    return { success: true };
  } catch (error) {
    console.error('Error moving email:', error);
    throw error;
  }
}

// ============================================
// DELETE EMAIL PERMANENTLY
// ============================================

/**
 * Delete email permanently
 */
async function deleteEmailPermanently(accountId, uid, folderName) {
  try {
    const { data: account, error: accError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accError) throw accError;

    const connection = await connectToImap(account);

    // Open folder
    await connection.openBox(folderName, false);

    // Mark for deletion and expunge
    await connection.deleteMessage([uid.toString()]);
    await connection.expunge();

    // Soft delete in database
    const { error } = await supabaseAdmin
      .from('emails')
      .update({ is_deleted: true })
      .eq('email_account_id', accountId)
      .eq('uid', uid)
      .eq('folder_name', folderName);

    if (error) throw error;

    connection.end();
    return { success: true };
  } catch (error) {
    console.error('Error deleting email:', error);
    throw error;
  }
}

// ============================================
// TOGGLE STAR FLAG
// ============================================

/**
 * Toggle star flag
 */
async function toggleEmailStar(accountId, uid, folderName, shouldStar) {
  try {
    const { data: account, error: accError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accError) throw accError;

    const connection = await connectToImap(account);
    await connection.openBox(folderName, false);

    if (shouldStar) {
      await connection.setFlags([uid.toString()], ['\\Flagged']);
    } else {
      await connection.unsetFlags([uid.toString()], ['\\Flagged']);
    }

    // Update in database
    const { error } = await supabaseAdmin
      .from('emails')
      .update({ is_starred: shouldStar })
      .eq('email_account_id', accountId)
      .eq('uid', uid)
      .eq('folder_name', folderName);

    if (error) throw error;

    connection.end();
    return { success: true };
  } catch (error) {
    console.error('Error toggling star:', error);
    throw error;
  }
}

// ============================================
// TOGGLE READ FLAG
// ============================================

/**
 * Toggle read flag
 */
async function toggleEmailRead(accountId, uid, folderName, shouldRead) {
  try {
    const { data: account, error: accError } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accError) throw accError;

    const connection = await connectToImap(account);
    await connection.openBox(folderName, false);

    if (shouldRead) {
      await connection.setFlags([uid.toString()], ['\\Seen']);
    } else {
      await connection.unsetFlags([uid.toString()], ['\\Seen']);
    }

    // Update in database
    const { error } = await supabaseAdmin
      .from('emails')
      .update({ is_read: shouldRead })
      .eq('email_account_id', accountId)
      .eq('uid', uid)
      .eq('folder_name', folderName);

    if (error) throw error;

    connection.end();
    return { success: true };
  } catch (error) {
    console.error('Error toggling read:', error);
    throw error;
  }
}

module.exports = {
  getAllFoldersWithMetadata,
  getEmailCountByFolder,
  getUnreadByFolder,
  moveEmailToFolder,
  deleteEmailPermanently,
  toggleEmailStar,
  toggleEmailRead,
};

