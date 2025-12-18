/**
 * IMAP Connection Utility
 * Creates a node-imap compatible connection using imap-simple
 * This ensures all IMAP operations use the same connection method
 */

const imaps = require('imap-simple');
const { decryptPassword } = require('./encryption');

/**
 * Connect to IMAP server
 * @param {Object} account - Email account object from database
 * @returns {Promise<Object>} - node-imap compatible connection
 */
async function connectToImap(account) {
  try {
    const password = decryptPassword(account.imap_password);

    const config = {
      imap: {
        user: account.imap_username || account.email,
        password,
        host: account.imap_host,
        port: account.imap_port || 993,
        tls: account.use_ssl !== false,
        authTimeout: 10000,
        connTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
      }
    };

    return await imaps.connect(config);
  } catch (err) {
    console.error('IMAP Connection Error:', err);
    throw new Error('Failed to connect to IMAP: ' + err.message);
  }
}

/**
 * Validate IMAP connection with credentials
 * Used for testing connections before saving accounts
 * @param {Object} config - Connection config with email, password, host, port, useSsl
 * @returns {Promise<boolean>} - True if connection successful
 */
async function validateImap({ email, password, host, port, useSsl }) {
  // ✅ FIX: Trim password to remove any accidental spaces
  const trimmedPassword = (password || '').trim();
  
  if (!trimmedPassword) {
    throw new Error('Password is required');
  }
  
  // ✅ FIX: Detect Gmail and use appropriate settings
  const isGmail = host?.includes('gmail.com') || email?.includes('@gmail.com');
  
  const config = {
    imap: {
      user: email,
      password: trimmedPassword, // ✅ Use trimmed password
      host,
      port: port || 993,
      tls: useSsl !== false,
      tlsOptions: { 
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2' // ✅ Require TLS 1.2+ for Gmail
      },
      authTimeout: isGmail ? 20000 : 15000, // ✅ Longer timeout for Gmail
      connTimeout: isGmail ? 30000 : 20000, // ✅ Longer timeout for Gmail
      // ✅ Add keepalive for Gmail to prevent premature disconnection
      keepalive: isGmail ? {
        interval: 10000,
        idleInterval: 300000,
        forceNoop: true
      } : true
    }
  };

  let connection = null;
  let lastError = null;
  
  // ✅ FIX: Retry logic for Gmail (sometimes needs a retry)
  const maxRetries = isGmail ? 2 : 1;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[VALIDATE IMAP] Retry attempt ${attempt + 1}/${maxRetries} for ${email}...`);
        // Wait before retry (Gmail may rate limit)
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
      
      console.log(`[VALIDATE IMAP] Testing connection to ${host}:${port || 993} for ${email}`);
      console.log(`[VALIDATE IMAP] Password length: ${trimmedPassword.length} characters`);
      
      // ✅ FIX: Add connection event listeners for better debugging
      connection = await new Promise((resolve, reject) => {
        const connPromise = imaps.connect(config);
        
        connPromise.then(conn => {
          // Set up event listeners for debugging
          if (conn && conn.imap) {
            conn.imap.on('error', (err) => {
              console.error(`[VALIDATE IMAP] Connection error event:`, err.message);
            });
            
            conn.imap.on('end', () => {
              console.log(`[VALIDATE IMAP] Connection ended event`);
            });
            
            conn.imap.on('close', () => {
              console.log(`[VALIDATE IMAP] Connection closed event`);
            });
          }
          
          resolve(conn);
        }).catch(reject);
      });
      
      console.log(`[VALIDATE IMAP] ✅ Connection successful`);
      
      // Try to open INBOX to verify full connection works
      try {
        await connection.openBox('INBOX');
        console.log(`[VALIDATE IMAP] ✅ INBOX opened successfully`);
      } catch (openError) {
        console.warn(`[VALIDATE IMAP] ⚠️  Could not open INBOX:`, openError.message);
        // Still consider it valid if connection was established
      }
      
      if (connection) {
        try {
          await connection.end();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      return true;
    } catch (error) {
      lastError = error;
      console.error(`[VALIDATE IMAP] ❌ Validation failed (attempt ${attempt + 1}/${maxRetries}):`, error.message);
      
      // If it's a connection ended error and we have retries left, try again
      if (attempt < maxRetries - 1 && 
          (error.message?.includes('Connection ended unexpectedly') || 
           error.message?.includes('connection closed'))) {
        if (connection) {
          try {
            await connection.end();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        connection = null;
        continue; // Retry
      }
      
      // If not retryable or out of retries, break
      break;
    }
  }
  
  // If we get here, all retries failed
  const error = lastError;
  
  // Provide more helpful error message
  let errorMessage = error.message;
  let suggestion = null;
  
  if (error.message?.includes('Connection ended unexpectedly') || error.message?.includes('connection closed')) {
      if (isGmail) {
        errorMessage = 'Gmail rejected the connection. Possible causes:';
        suggestion = `1) ✅ Verify IMAP is enabled in Gmail:
   - Go to https://mail.google.com/mail/u/0/#settings/general
   - Scroll to "Forwarding and POP/IMAP"
   - Make sure "Enable IMAP" is checked
   - Click "Save Changes"

2) ✅ Make sure you're using an App Password (16 characters, no spaces):
   - App Password format: xxxx xxxx xxxx xxxx (16 characters total)
   - Enter it WITHOUT spaces: xxxxxxxxxxxxxxxx
   - Must be created for "Mail" application

3) ✅ Verify 2-Step Verification is enabled:
   - Go to https://myaccount.google.com/security
   - Under "Signing in to Google", verify 2-Step Verification is ON
   - If not enabled, enable it first, then create App Password

4) ✅ Check if Gmail is rate limiting:
   - Wait 5-10 minutes if you've made multiple connection attempts
   - Gmail may temporarily block rapid connection attempts

5) ✅ Try generating a NEW App Password:
   - Go to https://myaccount.google.com/apppasswords
   - Delete any existing "Mail" app passwords
   - Create a new one for "Mail"
   - Copy the 16-character password immediately (it's only shown once)

6) ✅ Verify your email address:
   - Make sure you're using the correct Gmail address
   - Check for typos in the email field

7) ✅ Check Gmail account status:
   - Make sure your Gmail account is active and not suspended
   - Try logging into Gmail web interface to verify account is working`;
    } else {
      errorMessage = 'Connection closed unexpectedly. This usually means invalid credentials. Please verify your email and app password.';
      suggestion = 'Please check: 1) Your email address is correct, 2) Your app password is correct (no spaces), 3) IMAP is enabled in your email settings';
    }
  } else if (error.message?.includes('authentication') || error.message?.includes('credentials') || error.message?.includes('LOGIN') || error.message?.includes('AUTHENTICATIONFAILED')) {
    if (isGmail) {
      errorMessage = 'Gmail authentication failed. Gmail requires an App Password, not your regular account password.';
      suggestion = 'To create a Gmail App Password: 1) Enable 2-Step Verification in your Google Account, 2) Go to Security → App passwords, 3) Create a new app password for "Mail", 4) Use that 16-character password here (without spaces).';
    } else {
      errorMessage = 'Authentication failed. Please check your email and password.';
    }
  } else if (error.message?.includes('ECONNREFUSED')) {
    errorMessage = 'Connection refused. Please check the IMAP host and port.';
  } else if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timeout')) {
    errorMessage = 'Connection timeout. Please check your network connection.';
  }
  
  if (connection) {
    try {
      await connection.end();
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  
  // Create a new error with the improved message
  const improvedError = new Error(errorMessage);
  improvedError.originalError = error;
  improvedError.suggestion = suggestion;
  improvedError.isGmail = isGmail;
  throw improvedError;
}

module.exports = { connectToImap, validateImap };

