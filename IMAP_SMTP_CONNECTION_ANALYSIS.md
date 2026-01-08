# IMAP/SMTP Account Connections - Detailed Analysis

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Components](#architecture-components)
3. [IMAP Connection Management](#imap-connection-management)
4. [SMTP Connection Management](#smtp-connection-management)
5. [Connection Pool System](#connection-pool-system)
6. [Error Handling & Retry Logic](#error-handling--retry-logic)
7. [Security & Encryption](#security--encryption)
8. [Provider Auto-Detection](#provider-auto-detection)
9. [Real-time Monitoring (IDLE)](#real-time-monitoring-idle)
10. [Database Schema](#database-schema)
11. [API Endpoints](#api-endpoints)
12. [Connection Lifecycle](#connection-lifecycle)
13. [Performance Considerations](#performance-considerations)
14. [Known Issues & Limitations](#known-issues--limitations)

---

## System Overview

The application implements a comprehensive IMAP/SMTP email account connection system that supports:
- **Multiple email providers** (Gmail, Outlook, Yahoo, iCloud, custom)
- **Connection pooling** for efficient resource management
- **Automatic retry** with exponential backoff for transient errors
- **Real-time email monitoring** via IDLE and polling
- **Encrypted password storage** in the database
- **Provider auto-detection** based on email domain

---

## Architecture Components

### Core Files Structure

```
backend/src/
├── routes/
│   ├── imapSmtp.js          # API routes for IMAP/SMTP operations
│   └── fetchNewMail.js       # Fetch new unread emails route
├── services/
│   ├── imapSmtpService.js    # Core IMAP/SMTP operations
│   ├── imapEmailSyncService.js # Email synchronization service
│   └── imapIdleService.js    # Real-time email monitoring (IDLE)
├── utils/
│   ├── imapConnectionPool.js # Connection pooling management
│   ├── imapRetry.js          # Retry logic with exponential backoff
│   └── connectToImap.js      # IMAP connection utility
└── config/
    └── supabase.js           # Database configuration
```

### Key Technologies
- **imap-simple**: IMAP client library (wrapper around node-imap)
- **nodemailer**: SMTP email sending library
- **mailparser**: Email parsing utility
- **Supabase**: PostgreSQL database with encryption utilities

---

## IMAP Connection Management

### Connection Configuration

IMAP connections are established using the following configuration structure:

```javascript
{
  imap: {
    user: account.imap_username || account.email,
    password: <decrypted_password>,
    host: account.imap_host,              // e.g., 'imap.gmail.com'
    port: account.imap_port || 993,       // Default: 993 (SSL)
    tls: account.use_ssl !== false,       // Default: true
    tlsOptions: { rejectUnauthorized: false }, // Allow self-signed certs
    authTimeout: 10000,                   // 10 seconds
    connTimeout: 10000                    // 10 seconds
  }
}
```

### Connection Flow

1. **Account Retrieval**: Fetch account from database
2. **Password Decryption**: Decrypt stored password using encryption utility
3. **Connection Creation**: Use `imap-simple` to establish connection
4. **Retry Mechanism**: Wrap connection in retry logic for transient failures
5. **Connection Pooling**: Manage via connection pool to limit concurrent connections

### Connection Creation Points

#### 1. Direct Connection (imapSmtpService.js)
```javascript
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
```

#### 2. Pooled Connection (fetchNewMail.js)
```javascript
connection = await connectionPool.getConnection(
  account.id,
  async () => {
    return await retryWithBackoff(
      async () => {
        return await imaps.connect({...});
      },
      retryOptions
    );
  }
);
```

#### 3. IDLE Connection (imapIdleService.js)
- Uses `connectToImap()` utility
- Maintains persistent connections for real-time monitoring
- Implements reconnection logic for session expiration

---

## SMTP Connection Management

### Connection Configuration

SMTP connections use Nodemailer with the following configuration:

```javascript
const transporter = nodemailer.createTransport({
  host: account.smtp_host,                // e.g., 'smtp.gmail.com'
  port: account.smtp_port || 587,         // Default: 587 (TLS)
  secure: account.use_ssl === true && account.smtp_port === 465, // SSL for port 465
  auth: {
    user: account.smtp_username,
    pass: <decrypted_password>
  },
  tls: {
    rejectUnauthorized: false             // Allow self-signed certificates
  }
});
```

### SMTP Connection Characteristics

- **No Connection Pooling**: SMTP connections are created per-request
- **Stateless**: Each email send creates a new connection
- **Port-based Security**:
  - Port 465: Uses SSL/TLS (`secure: true`)
  - Port 587: Uses STARTTLS (`secure: false`, `tls: true`)
- **Connection Verification**: Uses `transporter.verify()` to test connections

### SMTP Operations

1. **Connection Test** (`testSmtpConnection`)
   - Validates credentials and server connectivity
   - Called during account setup

2. **Send Email** (`sendEmail`)
   - Creates new transporter per request
   - Sends email with attachments support
   - Returns message ID on success

---

## Connection Pool System

### Purpose
- **Limit Concurrent Connections**: Max 5 connections per account
- **Resource Management**: Reuse connections to reduce overhead
- **Prevent Server Overload**: Respect IMAP server connection limits
- **LRU Eviction**: Least recently used connections are reused

### Implementation (`imapConnectionPool.js`)

#### Key Properties
```javascript
{
  connections: Map<accountId, Connection[]>,      // Active connections per account
  connectionTimestamps: Map<accountId, number[]>, // Creation timestamps
  pendingRequests: Map<accountId, Request[]>,     // Queued connection requests
  maxConnectionsPerAccount: 5,                    // Max concurrent connections
  connectionTimeout: 30 * 60 * 1000              // 30 minutes
}
```

#### Connection Lifecycle in Pool

1. **Get Connection** (`getConnection`)
   ```
   - Clean up stale connections (>30 min old)
   - Check for available connection in pool
   - Reuse if connection is alive
   - Create new if under limit
   - Queue request if at limit
   ```

2. **Connection Validation** (`isConnectionAlive`)
   ```javascript
   - Check socket.destroyed
   - Check connection.state (logout/disconnected)
   - Verify socket is not closed
   ```

3. **Release Connection** (`releaseConnection`)
   ```
   - Keep in pool for reuse (default)
   - Remove from pool if flagged (on error)
   - Process pending requests if capacity available
   ```

4. **Stale Connection Cleanup**
   ```
   - Remove connections older than 30 minutes
   - Remove dead/destroyed connections
   - Update connection lists and timestamps
   ```

#### Pool Statistics
- Track active connections per account
- Monitor pending requests
- Log connection pool status

---

## Error Handling & Retry Logic

### Error Classification (`imapRetry.js`)

#### 1. Throttling Errors
Detected by keywords: `[THROTTLED]`, `rate limit`, `quota exceeded`, `system error`

**Behavior**:
- Exponential backoff with longer delays (2x multiplier)
- Max retries: 5
- Base delay: 3000ms, Max delay: 60000ms

#### 2. Connection Errors
Detected by keywords: `connection`, `timeout`, `socket`, `network`, `authentication`

**Behavior**:
- Triggers reconnection attempts
- Validates connection state before retry
- Max retries: 3
- Base delay: 2000ms

#### 3. Non-Retryable Errors
- Invalid credentials (permanent auth failure)
- Folder not found (NONEXISTENT mailbox)
- Unknown errors (default: don't retry)

### Retry Mechanisms

#### 1. Basic Retry (`retryWithBackoff`)
```javascript
retryWithBackoff(
  async () => operation(),
  {
    maxRetries: 5,
    baseDelay: 2000,
    maxDelay: 60000,
    operationName: 'Operation name'
  }
)
```

**Features**:
- Exponential backoff with jitter (0-20% random)
- Custom retry condition (`shouldRetry`)
- Retry callbacks (`onRetry`)
- Throttling detection (2x delay multiplier)

#### 2. Reconnection Retry (`retryWithReconnect`)
- Recreates connection on connection errors
- Closes old connection before retry
- Specifically handles "Not authenticated" errors

### Error Handling in Operations

#### IMAP Operations with Retry
- **Connection**: 3 retries, 2-30s delay
- **Open Mailbox**: 3 retries, 2-30s delay
- **Search Messages**: 5 retries, 3-60s delay (more retries for throttling)
- **Fetch Messages**: 5 retries, 3-60s delay

#### Error Response Format
```javascript
{
  success: false,
  error: "Error message",
  details: "Full error details",
  throttled: true/false,  // If throttling detected
  isAuthError: true/false // If authentication failure
}
```

---

## Security & Encryption

### Password Storage

#### Encryption Process
1. **On Account Setup**:
   ```javascript
   const encryptedPassword = encryptPassword(plainPassword);
   // Store in database: imap_password, smtp_password
   ```

2. **On Connection**:
   ```javascript
   const password = decryptPassword(account.imap_password);
   // Use decrypted password for connection
   ```

#### Encryption Implementation
- Uses encryption utility from `../utils/encryption`
- Passwords stored as encrypted strings in database
- Decryption happens in-memory only
- No plaintext passwords in logs or responses

### TLS/SSL Configuration

#### IMAP
- **Default**: TLS enabled (`tls: true`)
- **Port**: 993 (SSL) or 143 (STARTTLS)
- **Certificate Validation**: Disabled (`rejectUnauthorized: false`) for flexibility

#### SMTP
- **Port 465**: SSL/TLS (`secure: true`)
- **Port 587**: STARTTLS (`secure: false`, `tls: true`)
- **Certificate Validation**: Disabled for flexibility

### Authentication Methods

Database field: `auth_method`
- `'password'`: Standard username/password
- `'oauth2'`: OAuth2 authentication (not yet implemented for IMAP/SMTP)
- `'app_password'`: App-specific password (Gmail, Yahoo, iCloud)

---

## Provider Auto-Detection

### Supported Providers (`getProviderSettings`)

| Provider | IMAP Host | IMAP Port | SMTP Host | SMTP Port | Notes |
|----------|-----------|-----------|-----------|-----------|-------|
| Gmail | imap.gmail.com | 993 | smtp.gmail.com | 587 | Requires OAuth2 or App Password |
| Outlook | outlook.office365.com | 993 | smtp.office365.com | 587 | May require OAuth2 |
| Yahoo | imap.mail.yahoo.com | 993 | smtp.mail.yahoo.com | 587 | Requires App Password if 2FA |
| iCloud | imap.mail.me.com | 993 | smtp.mail.me.com | 587 | Requires App-Specific Password |

### Auto-Detection Logic

```javascript
function getProviderSettings(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  // Returns provider-specific settings or null
}
```

**Usage**:
- Called during account setup if `autoDetect: true`
- Falls back to manual configuration if detection fails
- Provides helpful notes about authentication requirements

---

## Real-time Monitoring (IDLE)

### IDLE Service Architecture

The `ImapIdleService` provides real-time email monitoring using a hybrid approach:

#### 1. Polling-based Monitoring
- Checks for new emails every 30 seconds
- Monitors primary folders: INBOX, Sent, Drafts
- Reliable fallback when IDLE not supported

#### 2. IDLE Protocol (when supported)
- Uses IMAP IDLE for instant notifications
- Listens for `mail`, `update`, `expunge` events
- Broadcasts via WebSocket to connected clients

### Connection Management in IDLE

#### Active Connection Tracking
```javascript
activeConnections: Map<accountId, {
  connection: IMAPConnection,
  account: AccountObject,
  folders: Folder[],
  monitoring: boolean
}>
```

#### Reconnection Logic
- **Detection**: Checks connection state before operations
- **Triggers**: "Not authenticated" errors, socket closed, state = logout
- **Process**: Close old connection → Fetch fresh account data → Create new connection
- **Retry**: 3 attempts with exponential backoff

#### Connection Health Checks
```javascript
isConnectionAuthenticated(connection) {
  // Check socket state
  // Check connection._destroyed
  // Check connection.state (not 'logout'/'disconnected')
}
```

### Monitoring Flow

1. **Start Monitoring** (`startIdleMonitoring`)
   ```
   - Connect to IMAP
   - Get folder list
   - Store connection in activeConnections
   - Start polling interval
   - Setup IDLE listeners (if supported)
   ```

2. **Check for New Emails** (`checkForNewEmails`)
   ```
   - Validate connection
   - Open folder
   - Search for messages with UID > last_synced
   - Parse and save new emails
   - Update sync state
   - Broadcast via WebSocket
   ```

3. **Handle Session Expiration**
   ```
   - Detect authentication errors
   - Trigger reconnection
   - Resume monitoring after reconnect
   ```

---

## Database Schema

### `email_accounts` Table

```sql
CREATE TABLE email_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  provider VARCHAR(50),              -- 'gmail', 'outlook', 'yahoo', 'custom'
  
  -- OAuth columns (for Gmail OAuth)
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  
  -- IMAP configuration
  imap_host TEXT,
  imap_port INTEGER,
  imap_username TEXT,
  imap_password TEXT,                -- ENCRYPTED
  use_ssl BOOLEAN DEFAULT true,
  
  -- SMTP configuration
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_username TEXT,
  smtp_password TEXT,                -- ENCRYPTED
  use_tls BOOLEAN DEFAULT true,
  
  -- Authentication
  auth_method VARCHAR(50) DEFAULT 'password',
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  initial_sync_completed BOOLEAN DEFAULT false,
  webhook_enabled_at TIMESTAMP,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  
  UNIQUE(user_id, email, provider)
);
```

### Indexes
- `idx_email_accounts_user_id` - Fast user account lookup
- `idx_email_accounts_email` - Email address lookup
- `idx_email_accounts_provider_auth` - Provider/auth method queries
- `idx_email_accounts_is_active` - Filter active accounts

### Related Tables

#### `emails`
Stores individual email messages:
- Links to `email_account_id`
- Tracks UID, folder, flags (read/starred)
- Stores email content (subject, body, attachments)

#### `email_sync_state`
Tracks synchronization state:
- `last_uid_synced` per account/folder
- `total_server_count`
- `last_sync_at`

---

## API Endpoints

### Account Management

#### `POST /api/imap-smtp/connect`
**Purpose**: Connect and save IMAP/SMTP account

**Request Body**:
```json
{
  "email": "user@example.com",
  "provider": "custom",
  "imapHost": "imap.example.com",
  "imapPort": 993,
  "smtpHost": "smtp.example.com",
  "smtpPort": 587,
  "imapUsername": "user@example.com",
  "imapPassword": "password",
  "smtpUsername": "user@example.com",
  "smtpPassword": "password",
  "useSsl": true,
  "useTls": true,
  "autoDetect": true
}
```

**Process**:
1. Auto-detect provider settings (if enabled)
2. Test IMAP connection
3. Test SMTP connection
4. Encrypt passwords
5. Save/update account in database

**Response**:
```json
{
  "success": true,
  "message": "Email account connected successfully",
  "account": {
    "id": "uuid",
    "email": "user@example.com",
    "provider": "custom",
    "imapTest": {...},
    "smtpTest": {...}
  }
}
```

#### `GET /api/imap-smtp/accounts`
**Purpose**: List all IMAP/SMTP accounts for user

#### `DELETE /api/imap-smtp/accounts/:accountId`
**Purpose**: Disconnect email account (sets `is_active: false`)

### Email Operations

#### `GET /api/imap-smtp/emails/:accountId`
**Purpose**: Fetch emails from IMAP account

**Query Parameters**:
- `folder`: Mailbox folder (default: 'INBOX')
- `limit`: Max emails to fetch (default: 50)

**Uses**: Connection pool + retry logic

#### `POST /api/imap-smtp/send`
**Purpose**: Send email via SMTP

**Request Body**:
```json
{
  "accountId": "uuid",
  "to": "recipient@example.com",
  "subject": "Subject",
  "body": "Text body",
  "html": "<p>HTML body</p>",
  "attachments": []
}
```

#### `GET /api/imap-smtp/folders/:accountId`
**Purpose**: Get list of IMAP folders

#### `DELETE /api/imap-smtp/emails/:accountId/:uid`
**Purpose**: Delete email via IMAP

#### `POST /api/imap-smtp/emails/:accountId/:uid/move`
**Purpose**: Move email to different folder

### New Unread Emails

#### `GET /api/fetch-new-mail/:accountId`
**Purpose**: Fetch only new unread emails (UID > last fetched)

**Features**:
- Tracks last fetched UID per account/folder
- Only returns new unseen emails
- Sends webhook notifications for new emails
- Marks initial sync as completed

#### `GET /api/fetch-new-mail`
**Purpose**: Fetch new unread emails from all user accounts

### Utility Endpoints

#### `GET /api/imap-smtp/detect/:email`
**Purpose**: Auto-detect provider settings for email

---

## Connection Lifecycle

### IMAP Connection Lifecycle

```
1. Account Setup
   ├── User provides credentials
   ├── Auto-detect provider settings
   ├── Test IMAP connection
   ├── Encrypt passwords
   └── Save to database

2. Connection Request
   ├── Check connection pool
   ├── Reuse existing (if available)
   ├── Create new (if under limit)
   └── Queue request (if at limit)

3. Connection Usage
   ├── Open mailbox
   ├── Search/fetch emails
   ├── Parse email content
   └── Save to database

4. Connection Release
   ├── Keep in pool (for reuse)
   └── Or remove (on error)

5. Connection Cleanup
   ├── Remove stale (>30 min)
   ├── Remove dead connections
   └── Process pending requests
```

### SMTP Connection Lifecycle

```
1. Email Send Request
   ├── Fetch account from database
   ├── Decrypt password
   └── Create transporter

2. Connection & Send
   ├── Verify connection
   ├── Send email
   └── Return message ID

3. Connection Cleanup
   └── Connection closed automatically
```

### IDLE Connection Lifecycle

```
1. Start Monitoring
   ├── Connect to IMAP
   ├── Get folders
   └── Store in activeConnections

2. Polling Loop (every 30s)
   ├── Check connection health
   ├── Reconnect if needed
   ├── Check for new emails
   └── Broadcast updates

3. Event Listeners
   ├── 'mail' → New email
   ├── 'update' → Flag changes
   └── 'expunge' → Email deleted

4. Reconnection
   ├── Detect auth error
   ├── Close old connection
   ├── Create new connection
   └── Resume monitoring

5. Stop Monitoring
   ├── Clear interval
   ├── Close connection
   └── Remove from activeConnections
```

---

## Performance Considerations

### Connection Pool Benefits
- **Reduced Overhead**: Reuse connections instead of creating new ones
- **Server Limits**: Respect IMAP server connection limits (typically 5-10)
- **Resource Efficiency**: Lower memory and network usage

### Retry Strategy Impact
- **Throttling**: Longer delays prevent rate limit exhaustion
- **Exponential Backoff**: Spreads out retry attempts
- **Jitter**: Prevents thundering herd problem

### Database Query Optimization
- **Indexed Lookups**: Fast account retrieval by user_id
- **Selective Queries**: Only fetch needed fields
- **Connection Pooling**: Database connections are pooled separately

### Caching Opportunities
- **Folder Lists**: Could be cached (currently fetched per request)
- **Account Settings**: Frequently accessed, could cache
- **Sync State**: Already stored in database for fast lookup

### Scalability Concerns
- **IDLE Connections**: One persistent connection per account
- **Pool Limits**: Max 5 connections per account may be limiting for high traffic
- **Polling Interval**: 30 seconds may be too frequent for many accounts

---

## Known Issues & Limitations

### Current Limitations

1. **No OAuth2 Support for IMAP/SMTP**
   - Only password-based authentication
   - Gmail requires App Password (not OAuth2)

2. **SMTP Connection Pooling**
   - SMTP connections created per-request
   - No connection reuse for SMTP

3. **IDLE Protocol Support**
   - Limited IDLE support (uses polling fallback)
   - `imap-simple` has limited IDLE capabilities

4. **Certificate Validation**
   - `rejectUnauthorized: false` for flexibility
   - Security risk if server certificates are invalid

5. **Error Recovery**
   - Some connection errors may require manual intervention
   - No automatic account re-activation on credential updates

6. **Connection Timeout**
   - 30-minute timeout may be too long for some servers
   - No configurable timeout per account

### Potential Improvements

1. **OAuth2 Integration**
   - Implement OAuth2 flow for Gmail/Outlook
   - Token refresh mechanism

2. **SMTP Connection Pooling**
   - Implement SMTP connection pool
   - Reuse connections for multiple sends

3. **Enhanced IDLE Support**
   - Better IDLE protocol implementation
   - More efficient real-time monitoring

4. **Certificate Management**
   - Configurable certificate validation
   - CA bundle support

5. **Connection Health Monitoring**
   - Periodic health checks
   - Automatic reconnection on failure
   - Connection metrics/monitoring

6. **Rate Limiting**
   - Per-account rate limiting
   - Adaptive retry delays based on server responses

---

## Conclusion

The IMAP/SMTP connection system is well-architected with:
- ✅ Robust error handling and retry logic
- ✅ Connection pooling for efficiency
- ✅ Secure password storage
- ✅ Provider auto-detection
- ✅ Real-time monitoring capabilities
- ✅ Comprehensive API endpoints

Areas for enhancement:
- OAuth2 support
- SMTP connection pooling
- Enhanced IDLE protocol support
- Better certificate validation
- Advanced monitoring and metrics

---

## Related Files Reference

- `backend/src/utils/imapConnectionPool.js` - Connection pool implementation
- `backend/src/utils/imapRetry.js` - Retry and error handling
- `backend/src/services/imapSmtpService.js` - Core IMAP/SMTP operations
- `backend/src/services/imapIdleService.js` - Real-time monitoring
- `backend/src/routes/imapSmtp.js` - API routes
- `backend/src/routes/fetchNewMail.js` - New email fetching
- `backend/src/utils/connectToImap.js` - IMAP connection utility

---

*Last Updated: Analysis based on current codebase*
*Document Version: 1.0*

