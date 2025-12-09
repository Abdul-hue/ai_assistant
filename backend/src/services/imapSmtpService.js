const imaps = require('imap-simple');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const { supabaseAdmin } = require('../config/supabase');
const { decryptPassword } = require('../utils/encryption');

// Note: decryptPassword is imported from ../utils/encryption.js (line 5)

// Note: encryptPassword is available from ../utils/encryption.js (used in routes)

/**
 * Auto-detect IMAP/SMTP settings for common providers
 */
function getProviderSettings(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  
  const providers = {
    'gmail.com': {
      imap: { host: 'imap.gmail.com', port: 993, ssl: true },
      smtp: { host: 'smtp.gmail.com', port: 587, tls: true },
      note: 'Gmail requires OAuth2 or App Password. Password login may not work.'
    },
    'outlook.com': {
      imap: { host: 'outlook.office365.com', port: 993, ssl: true },
      smtp: { host: 'smtp.office365.com', port: 587, tls: true },
      note: 'Outlook may require OAuth2 for Office365 accounts.'
    },
    'hotmail.com': {
      imap: { host: 'outlook.office365.com', port: 993, ssl: true },
      smtp: { host: 'smtp.office365.com', port: 587, tls: true },
      note: 'Hotmail uses Outlook servers.'
    },
    'live.com': {
      imap: { host: 'outlook.office365.com', port: 993, ssl: true },
      smtp: { host: 'smtp.office365.com', port: 587, tls: true },
      note: 'Live.com uses Outlook servers.'
    },
    'yahoo.com': {
      imap: { host: 'imap.mail.yahoo.com', port: 993, ssl: true },
      smtp: { host: 'smtp.mail.yahoo.com', port: 587, tls: true },
      note: 'Yahoo requires App Password if 2FA is enabled.'
    },
    'ymail.com': {
      imap: { host: 'imap.mail.yahoo.com', port: 993, ssl: true },
      smtp: { host: 'smtp.mail.yahoo.com', port: 587, tls: true },
      note: 'Yahoo requires App Password if 2FA is enabled.'
    },
    'icloud.com': {
      imap: { host: 'imap.mail.me.com', port: 993, ssl: true },
      smtp: { host: 'smtp.mail.me.com', port: 587, tls: true },
      note: 'iCloud requires App-Specific Password.'
    },
    'me.com': {
      imap: { host: 'imap.mail.me.com', port: 993, ssl: true },
      smtp: { host: 'smtp.mail.me.com', port: 587, tls: true },
      note: 'iCloud requires App-Specific Password.'
    }
  };
  
  return providers[domain] || null;
}

/**
 * Test IMAP connection
 */
async function testImapConnection(config) {
  const { validateImap } = require('../utils/connectToImap');
  let connection = null;
  try {
    // First validate the connection using the centralized validation
    await validateImap({
      email: config.username,
      password: config.password,
      host: config.host,
      port: config.port || 993,
      useSsl: config.useTls !== false
    });
    
    // Reconnect to get mailbox info for better feedback
    connection = await imaps.connect({
      imap: {
        user: config.username,
        password: config.password,
        host: config.host,
        port: config.port || 993,
        tls: config.useTls !== false,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
        connTimeout: 10000
      }
    });
    
    // Try to open INBOX - this verifies the connection works
    await connection.openBox('INBOX');
    
    // Try to get mailbox info if available
    let mailboxInfo = {
      name: 'INBOX',
      totalMessages: 0,
      unreadMessages: 0
    };
    
    try {
      // Check if connection.mailbox exists after openBox
      if (connection.mailbox) {
        mailboxInfo = {
          name: connection.mailbox.name || 'INBOX',
          totalMessages: connection.mailbox.messages?.total || 0,
          unreadMessages: connection.mailbox.messages?.new || 0
        };
      }
      
      // Also try to get folder list
      const boxes = await connection.getBoxes();
      mailboxInfo.totalFolders = Object.keys(boxes).length;
    } catch (mailboxError) {
      // If we can't read mailbox info, that's okay - connection still works
      console.log('Could not read mailbox info:', mailboxError.message);
    }
    
    const result = {
      success: true,
      message: 'IMAP connection successful',
      mailbox: mailboxInfo
    };
    
    connection.end();
    return result;
  } catch (error) {
    if (connection) {
      try {
        connection.end();
      } catch (endError) {
        // Ignore errors when closing connection
      }
    }
    return {
      success: false,
      error: error.message,
      details: error.toString()
    };
  }
}

/**
 * Test SMTP connection
 */
async function testSmtpConnection(config) {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.useSsl === true && config.port === 465,
      auth: {
        user: config.username,
        pass: config.password
      },
      tls: {
        rejectUnauthorized: false // Allow self-signed certificates
      }
    });
    
    await transporter.verify();
    
    return {
      success: true,
      message: 'SMTP connection successful'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.toString()
    };
  }
}

/**
 * Fetch emails from IMAP
 */
async function fetchEmails(accountId, folder = 'INBOX', limit = 50) {

  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
    if (!account.imap_host || !account.imap_username) {
      throw new Error('IMAP settings not configured for this account');
    }
    
    // Decrypt password
    const password = decryptPassword(account.imap_password);
    
    // Connect to IMAP
    const connection = await imaps.connect({
      imap: {
        user: account.imap_username,
        password: password,
        host: account.imap_host,
        port: account.imap_port || 993,
        tls: account.use_ssl !== false,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      }
    });
    
    // Open mailbox
    await connection.openBox(folder);
    
    // Fetch messages - get all messages, not just UNSEEN
    // This ensures we sync all emails to Supabase
    const messages = await connection.search(['ALL'], { 
      bodies: '', 
      struct: true 
    });
    
    // Limit results
    const limitedMessages = messages.slice(0, 3000);
    
    // Parse emails
    const emails = [];
    for (const message of limitedMessages) {
      try {
        const all = message.parts.find(part => part.which === '');
        const id = message.attributes.uid;
        const idHeader = 'Imap-Id: ' + id + '\r\n';
        
        const parsed = await simpleParser(idHeader + all.body);
        
        // Get accurate date from email - use parsed.date which is the actual email date
        let emailDate = parsed.date;
        if (!emailDate || !(emailDate instanceof Date) || isNaN(emailDate.getTime())) {
          // Fallback to current date if date is invalid
          emailDate = new Date();
        }
        
        emails.push({
          id: `imap-${accountId}-${id}`,
          uid: id,
          from: parsed.from?.text || parsed.from?.value?.[0]?.address || 'Unknown',
          fromEmail: parsed.from?.value?.[0]?.address || parsed.from?.text || '',
          to: parsed.to?.text || parsed.to?.value?.[0]?.address || '',
          subject: parsed.subject || '(No subject)',
          body: parsed.text || '',
          bodyHtml: parsed.html || '',
          date: emailDate.toISOString(), // Store as ISO string for accurate time
          timestamp: emailDate.getTime(), // Store timestamp for sorting
          isRead: message.attributes.flags?.includes('\\Seen') || false,
          attachments: parsed.attachments?.map(att => ({
            filename: att.filename,
            contentType: att.contentType,
            size: att.size
          })) || [],
          folder: folder
        });
      } catch (parseError) {
        console.error('Error parsing email:', parseError);
        // Continue with next email
      }
    }
    
    // Sort emails by date (newest first) - using timestamp for accurate sorting
    emails.sort((a, b) => {
      const timeA = a.timestamp || new Date(a.date).getTime();
      const timeB = b.timestamp || new Date(b.date).getTime();
      return timeB - timeA; // Descending order (newest first)
    });
    
    connection.end();
    
    return {
      success: true,
      emails: emails,
      count: emails.length
    };
  } catch (error) {
    console.error('Error fetching emails:', error);
    return {
      success: false,
      error: error.message,
      emails: []
    };
  }
}

/**
 * Send email via SMTP
 */
async function sendEmail(accountId, { to, subject, body, html, attachments = [] }) {
  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
    if (!account.smtp_host || !account.smtp_username) {
      throw new Error('SMTP settings not configured for this account');
    }
    
    // Decrypt password
    const password = decryptPassword(account.smtp_password);
    
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port || 587,
      secure: account.use_ssl === true && account.smtp_port === 465,
      auth: {
        user: account.smtp_username,
        pass: password
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    // Send email
    const info = await transporter.sendMail({
      from: account.email || account.smtp_username,
      to: to,
      subject: subject,
      text: body,
      html: html || body,
      attachments: attachments
    });
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response
    };
  } catch (error) {
    console.error('Error sending email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get folders from IMAP
 */
async function getFolders(accountId) {
  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
    if (!account.imap_host || !account.imap_username) {
      throw new Error('IMAP settings not configured for this account');
    }
    
    // Decrypt password
    const password = decryptPassword(account.imap_password);
    
    // Connect to IMAP
    const connection = await imaps.connect({
      imap: {
        user: account.imap_username,
        password: password,
        host: account.imap_host,
        port: account.imap_port || 993,
        tls: account.use_ssl !== false,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      }
    });
    
    // Get all mailboxes
    const boxes = await connection.getBoxes();
    
    // Flatten folder structure and filter out system folders
    const folders = [];
    const systemFolders = ['[Gmail]', 'INBOX']; // Base system folders
    
    function flattenBoxes(boxes, prefix = '') {
      for (const [name, box] of Object.entries(boxes)) {
        const fullName = prefix ? `${prefix}${box.delimiter}${name}` : name;
        
        // Skip if it's just a system folder container (has children but we want the actual folders)
        if (box.children && Object.keys(box.children).length > 0) {
          // Recursively process children
          flattenBoxes(box.children, fullName);
        } else {
          // This is an actual folder we can use
          folders.push({
            name: fullName,
            delimiter: box.delimiter,
            attributes: box.attributes,
            children: Object.keys(box.children || {}).length
          });
        }
      }
    }
    
    flattenBoxes(boxes);
    
    // Sort folders: INBOX first, then alphabetically
    folders.sort((a, b) => {
      if (a.name.toUpperCase() === 'INBOX') return -1;
      if (b.name.toUpperCase() === 'INBOX') return 1;
      return a.name.localeCompare(b.name);
    });
    
    connection.end();
    
    return {
      success: true,
      folders: folders
    };
  } catch (error) {
    console.error('Error getting folders:', error);
    return {
      success: false,
      error: error.message,
      folders: []
    };
  }
}

/**
 * Delete email via IMAP
 */
async function deleteEmail(accountId, uid, folder = 'INBOX') {
  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
    // Decrypt password
    const password = decryptPassword(account.imap_password);
    
    // Connect to IMAP
    const connection = await imaps.connect({
      imap: {
        user: account.imap_username,
        password: password,
        host: account.imap_host,
        port: account.imap_port || 993,
        tls: account.use_ssl !== false,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      }
    });
    
    // Open mailbox
    await connection.openBox(folder);
    
    // Delete message
    await connection.deleteMessage(uid);
    
    // Expunge to permanently delete
    await connection.expunge();
    
    connection.end();
    
    return {
      success: true,
      message: 'Email deleted successfully'
    };
  } catch (error) {
    console.error('Error deleting email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Move email to folder
 */
async function moveEmail(accountId, uid, fromFolder, toFolder) {
  try {
    // Get account from database
    const { data: account, error } = await supabaseAdmin
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('is_active', true)
      .single();
    
    if (error || !account) {
      throw new Error('Email account not found');
    }
    
    // Decrypt password
    const password = decryptPassword(account.imap_password);
    
    // Connect to IMAP
    const connection = await imaps.connect({
      imap: {
        user: account.imap_username,
        password: password,
        host: account.imap_host,
        port: account.imap_port || 993,
        tls: account.use_ssl !== false,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      }
    });
    
    // Open source mailbox
    await connection.openBox(fromFolder);
    
    // Move message
    await connection.move(uid, toFolder);
    
    connection.end();
    
    return {
      success: true,
      message: 'Email moved successfully'
    };
  } catch (error) {
    console.error('Error moving email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  getProviderSettings,
  testImapConnection,
  testSmtpConnection,
  fetchEmails,
  sendEmail,
  getFolders,
  deleteEmail,
  moveEmail
};

