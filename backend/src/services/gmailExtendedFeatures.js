const { google } = require('googleapis');

/**
 * EXTENDED OAUTH SCOPES
 * Add these to your backend initialization
 * 
 * IMPORTANT: gmail.metadata is NOT included because it's too restrictive.
 * gmail.readonly already provides all metadata access PLUS the ability to
 * search with 'q' parameter and read full email bodies.
 */
const EXTENDED_GMAIL_SCOPES = [
  // Read & Display (gmail.readonly includes metadata + search capabilities)
  'https://www.googleapis.com/auth/gmail.readonly',      // View emails, search with 'q', get full bodies
  'https://www.googleapis.com/auth/gmail.labels',        // Manage labels
  
  // Compose & Send
  'https://www.googleapis.com/auth/gmail.compose',       // Create drafts
  'https://www.googleapis.com/auth/gmail.send',          // Send emails
  
  // Modify
  'https://www.googleapis.com/auth/gmail.modify',        // Archive, delete, move, star
  
  // Settings
  'https://www.googleapis.com/auth/gmail.settings.basic', // Change settings
  
  // User Info
  'https://www.googleapis.com/auth/userinfo.email',      // Get email address
  'https://www.googleapis.com/auth/userinfo.profile',    // Get profile info
];

/**
 * Get Gmail Auth URL with Extended Scopes
 */
function getExtendedAuthUrl(oauth2Client) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: EXTENDED_GMAIL_SCOPES,
    prompt: 'consent',
  });
}

/**
 * Archive Email
 */
async function archiveEmail(oauth2Client, messageId) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['INBOX']
      }
    });
    console.log(`✅ Archived email: ${messageId}`);
    return { success: true, message: 'Email archived' };
  } catch (error) {
    console.error('❌ Archive error:', error.message);
    throw error;
  }
}

/**
 * Delete Email (Move to Trash)
 */
async function deleteEmail(oauth2Client, messageId) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    await gmail.users.messages.trash({
      userId: 'me',
      id: messageId
    });
    console.log(`✅ Deleted email: ${messageId}`);
    return { success: true, message: 'Email moved to trash' };
  } catch (error) {
    console.error('❌ Delete error:', error.message);
    throw error;
  }
}

/**
 * Star/Flag Email
 */
async function starEmail(oauth2Client, messageId, star = true) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const labelIds = star ? ['STARRED'] : [];
    const removeLabelIds = star ? [] : ['STARRED'];
    
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: labelIds,
        removeLabelIds: removeLabelIds
      }
    });
    console.log(`${star ? '⭐' : '☆'} Toggled star: ${messageId}`);
    return { success: true, starred: star };
  } catch (error) {
    console.error('❌ Star error:', error.message);
    throw error;
  }
}

/**
 * Mark as Read/Unread
 */
async function markAsRead(oauth2Client, messageId, isRead = true) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: isRead ? [] : ['UNREAD'],
        removeLabelIds: isRead ? ['UNREAD'] : []
      }
    });
    console.log(`${isRead ? '✓' : '○'} Mark as ${isRead ? 'read' : 'unread'}: ${messageId}`);
    return { success: true, isRead };
  } catch (error) {
    console.error('❌ Mark error:', error.message);
    throw error;
  }
}

/**
 * Move to Label
 */
async function moveToLabel(oauth2Client, messageId, labelId, removeFromInbox = false) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const removeLabelIds = removeFromInbox ? ['INBOX'] : [];
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
        removeLabelIds: removeLabelIds
      }
    });
    console.log(`📁 Moved to label: ${messageId}`);
    return { success: true, message: 'Email moved' };
  } catch (error) {
    console.error('❌ Move error:', error.message);
    throw error;
  }
}

/**
 * Get All Labels
 */
async function getLabels(oauth2Client) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const response = await gmail.users.labels.list({ userId: 'me' });
    
    const labels = response.data.labels || [];
    console.log(`📁 Retrieved ${labels.length} labels`);
    
    return labels;
  } catch (error) {
    console.error('❌ Labels error:', error.message);
    throw error;
  }
}

/**
 * Send Email
 */
async function sendEmail(oauth2Client, to, subject, body, isHtml = false) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Create email message
    const message = [
      `From: me`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/${isHtml ? 'html' : 'plain'}; charset="UTF-8"`,
      'MIME-Version: 1.0',
      '',
      body
    ].join('\n');

    // Encode to base64
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    console.log(`✉️ Sent email to: ${to}`);
    return { success: true, messageId: response.data.id };
  } catch (error) {
    console.error('❌ Send error:', error.message);
    throw error;
  }
}

/**
 * Reply to Email
 */
async function replyEmail(oauth2Client, messageId, replyBody, isHtml = false) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Get original message
    const original = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const headers = original.data.payload.headers;
    const from = headers.find(h => h.name === 'From')?.value || 'me';
    const to = headers.find(h => h.name === 'To')?.value || '';
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    
    // Create reply
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    
    const message = [
      `From: me`,
      `To: ${to}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: <${messageId}>`,
      `References: <${messageId}>`,
      `Content-Type: text/${isHtml ? 'html' : 'plain'}; charset="UTF-8"`,
      'MIME-Version: 1.0',
      '',
      replyBody
    ].join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: original.data.threadId
      }
    });

    console.log(`↩️ Replied to email: ${messageId}`);
    return { success: true, messageId: response.data.id };
  } catch (error) {
    console.error('❌ Reply error:', error.message);
    throw error;
  }
}

/**
 * Get Attachments from Email
 */
async function getAttachments(oauth2Client, messageId) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const attachments = [];
    const parts = message.data.payload?.parts || [];
    
    const traverse = (parts) => {
      if (!parts) return;
      for (const part of parts) {
        if (part.filename && part.body?.attachmentId) {
          attachments.push({
            id: part.body.attachmentId,
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size
          });
        }
        if (part.parts) {
          traverse(part.parts);
        }
      }
    };
    
    traverse(parts);
    
    console.log(`📎 Found ${attachments.length} attachments`);
    return attachments;
  } catch (error) {
    console.error('❌ Attachments error:', error.message);
    throw error;
  }
}

/**
 * Download Attachment
 */
async function downloadAttachment(oauth2Client, messageId, attachmentId) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const attachment = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: messageId,
      id: attachmentId
    });

    console.log(`⬇️ Downloaded attachment: ${attachmentId}`);
    return attachment.data;
  } catch (error) {
    console.error('❌ Download error:', error.message);
    throw error;
  }
}

module.exports = {
  EXTENDED_GMAIL_SCOPES,
  getExtendedAuthUrl,
  archiveEmail,
  deleteEmail,
  starEmail,
  markAsRead,
  moveToLabel,
  getLabels,
  sendEmail,
  replyEmail,
  getAttachments,
  downloadAttachment,
};

