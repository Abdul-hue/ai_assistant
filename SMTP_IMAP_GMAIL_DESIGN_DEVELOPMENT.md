# SMTP & IMAP Implementation for Gmail - Design & Development Documentation

## Overview

This document outlines the design and development approach for implementing SMTP and IMAP email integration specifically for Gmail accounts. The implementation enables users to connect their Gmail accounts using App Passwords (not OAuth) to read and send emails.

## Table of Contents

1. Architecture Overview
2. Design Decisions
3. Gmail-Specific Requirements
4. Database Schema Design
5. Security Implementation
6. Connection Management
7. Service Layer Implementation
8. API Endpoints Design
9. Error Handling Strategy
10. Frontend Integration
11. Development Steps

## 1. Architecture Overview

### System Components

- **Backend Service Layer**: Core IMAP/SMTP operations
- **API Routes**: RESTful endpoints for frontend communication
- **Connection Pool**: Manages IMAP connections efficiently
- **Encryption Utility**: Secures password storage
- **Retry Mechanism**: Handles transient failures
- **Database**: Stores account configurations and emails

### Technology Stack

- **IMAP Client**: `imap-simple` library (wrapper around node-imap)
- **SMTP Client**: `nodemailer` library
- **Email Parsing**: `mailparser` for parsing email content
- **Database**: PostgreSQL (via Supabase)
- **Encryption**: Node.js `crypto` module (AES-256-CBC)

## 2. Design Decisions

### 2.1 Provider Auto-Detection

- **Decision**: Implement automatic detection of email provider settings based on email domain
- **Rationale**: Reduces user configuration burden, especially for common providers like Gmail
- **Implementation**: Domain-based lookup table with pre-configured server settings

### 2.2 Password Encryption

- **Decision**: Encrypt passwords before storing in database using AES-256-CBC
- **Rationale**: Security best practice - never store plaintext passwords
- **Implementation**: Environment-based encryption key, IV per encryption

### 2.3 Connection Pooling

- **Decision**: Implement connection pooling for IMAP connections
- **Rationale**: 
  - Gmail limits concurrent connections (typically 5-10)
  - Reduces connection overhead
  - Improves performance for multiple operations
- **Implementation**: LRU-based pool with max 5 connections per account

### 2.4 Retry Strategy

- **Decision**: Exponential backoff with jitter for retries
- **Rationale**: 
  - Gmail has rate limiting
  - Transient network errors are common
  - Prevents overwhelming the server
- **Implementation**: Different retry strategies for throttling vs connection errors

### 2.5 Stateless SMTP

- **Decision**: Create new SMTP connection per email send
- **Rationale**: 
  - SMTP is inherently stateless
  - Simpler error handling
  - No need for connection management overhead

## 3. Gmail-Specific Requirements

### 3.1 Authentication Requirements

- **App Password Required**: Gmail requires App Passwords (not regular passwords) for IMAP/SMTP access
- **2-Step Verification**: Must be enabled before creating App Password
- **IMAP Enablement**: IMAP must be explicitly enabled in Gmail settings

### 3.2 Server Configuration

- **IMAP Server**: `imap.gmail.com`
- **IMAP Port**: 993 (SSL/TLS)
- **SMTP Server**: `smtp.gmail.com`
- **SMTP Port**: 587 (STARTTLS) or 465 (SSL)
- **Security**: TLS 1.2+ required

### 3.3 Connection Settings

- **Keepalive**: Required to prevent premature disconnection
- **Timeouts**: Extended timeouts (20-30s) due to Gmail's response times
- **TLS Options**: Minimum TLS version 1.2 enforced

### 3.4 Rate Limiting

- **Connection Limits**: Max 5-10 concurrent connections per account
- **Throttling**: Gmail may throttle rapid connection attempts
- **Error Detection**: Specific error messages indicate throttling

### 3.5 Folder Structure

- **Gmail Folders**: Uses `[Gmail]` namespace with nested folders
- **Special Folders**: Sent Mail, Drafts, Spam, Trash, All Mail
- **Folder Detection**: Must handle Gmail's folder hierarchy correctly

## 4. Database Schema Design

### 4.1 Email Accounts Table Extensions

The `email_accounts` table is extended with IMAP/SMTP columns:

**IMAP Configuration:**

- `imap_host`: IMAP server hostname (e.g., 'imap.gmail.com')
- `imap_port`: IMAP server port (default: 993)
- `imap_username`: Username for IMAP (usually email address)
- `imap_password`: Encrypted password for IMAP
- `use_ssl`: Boolean flag for SSL/TLS

**SMTP Configuration:**

- `smtp_host`: SMTP server hostname (e.g., 'smtp.gmail.com')
- `smtp_port`: SMTP server port (default: 587)
- `smtp_username`: Username for SMTP (usually email address)
- `smtp_password`: Encrypted password for SMTP
- `use_tls`: Boolean flag for TLS

**Authentication:**

- `auth_method`: Type of authentication ('password', 'app_password', 'oauth2')
- `provider`: Email provider identifier ('gmail', 'outlook', 'custom', etc.)

### 4.2 Indexes

- Index on `(provider, auth_method)` for efficient queries
- Index on `user_id` for user account lookups
- Index on `email` for email-based lookups

## 5. Security Implementation

### 5.1 Password Encryption Flow

**Encryption Process:**

1. User provides plaintext password during account setup
2. System generates random IV (16 bytes)
3. Password encrypted using AES-256-CBC with encryption key from environment
4. Encrypted format: `iv:encryptedData` (hex encoded)
5. Stored in database as encrypted string

**Decryption Process:**

1. Retrieve encrypted password from database
2. Split into IV and encrypted data
3. Decrypt using same encryption key
4. Use decrypted password in-memory only
5. Never log or expose plaintext password

### 5.2 Encryption Key Management

- **Source**: Environment variable `ENCRYPTION_KEY`
- **Format**: 64 hex characters (32 bytes)
- **Generation**: Cryptographically secure random bytes
- **Storage**: Never committed to code repository

### 5.3 TLS/SSL Configuration

- **IMAP**: TLS enabled by default, port 993
- **SMTP**: STARTTLS on port 587, SSL on port 465
- **Certificate Validation**: Disabled for flexibility (can be enabled for production)
- **Minimum TLS Version**: 1.2 for Gmail

## 6. Connection Management

### 6.1 IMAP Connection Pool

**Pool Structure:**

- Map of account IDs to connection arrays
- Maximum 5 connections per account
- Connection timestamps for stale detection
- Pending request queue when at limit

**Connection Lifecycle:**

1. **Request Connection**: Check pool for available connection
2. **Reuse or Create**: Reuse if available and alive, else create new
3. **Queue if Full**: Queue request if at connection limit
4. **Use Connection**: Perform IMAP operations
5. **Release**: Return to pool for reuse (or remove if error)

**Stale Connection Cleanup:**

- Connections older than 30 minutes are removed
- Dead/destroyed connections are cleaned up
- Cleanup happens before new connection requests

### 6.2 Connection Health Checks

- Check socket state (not destroyed)
- Verify connection state (not logged out)
- Validate socket is not closed
- Reconnect if connection is unhealthy

### 6.3 SMTP Connection Management

- **Stateless**: New connection per email send
- **Verification**: Test connection before sending
- **Cleanup**: Automatic cleanup after send

## 7. Service Layer Implementation

### 7.1 Provider Auto-Detection Service

**Function**: `getProviderSettings(email)`

- Extracts domain from email address
- Looks up provider in predefined settings table
- Returns server configuration or null
- Includes helpful notes about authentication requirements

**Gmail Settings:**

- IMAP: `imap.gmail.com:993` with SSL
- SMTP: `smtp.gmail.com:587` with TLS
- Note about App Password requirement

### 7.2 IMAP Connection Testing

**Function**: `testImapConnection(config)`

- Validates credentials before saving account
- Opens INBOX to verify connection works
- Retrieves mailbox information (message counts)
- Provides detailed error messages for Gmail
- Includes troubleshooting steps in error responses

**Gmail-Specific Enhancements:**

- Extended timeouts (20-30s)
- Keepalive configuration
- TLS 1.2+ requirement
- Detailed error messages with step-by-step troubleshooting

### 7.3 SMTP Connection Testing

**Function**: `testSmtpConnection(config)`

- Creates Nodemailer transporter
- Verifies connection using `transporter.verify()`
- Returns success/failure with error details

### 7.4 Email Fetching Service

**Function**: `fetchEmails(accountId, folder, limit, options)`

- Retrieves account from database
- Decrypts password
- Gets connection from pool
- Opens specified folder
- Searches for emails (by UID or date)
- Fetches email content
- Parses emails using mailparser
- Saves to database
- Returns parsed email list

**Optimizations:**

- Headers-only mode for faster loading
- UID-based incremental fetching
- Connection pooling for efficiency
- Retry logic for transient failures

### 7.5 Email Sending Service

**Function**: `sendEmail(accountId, emailData)`

- Retrieves account from database
- Decrypts SMTP password
- Creates Nodemailer transporter
- Configures email (to, subject, body, attachments)
- Sends email
- Returns message ID

### 7.6 Folder Management Service

**Function**: `getFolders(accountId)`

- Connects to IMAP
- Retrieves folder list
- Flattens nested folder structure
- Filters out non-selectable folders
- Returns folder list with metadata

**Gmail Folder Handling:**

- Handles `[Gmail]` namespace
- Processes nested folder structure
- Filters by `\Noselect` attribute
- Sorts folders (INBOX first, then alphabetically)

## 8. API Endpoints Design

### 8.1 Account Management Endpoints

**POST `/api/imap-smtp/connect`**

- Purpose: Connect and save IMAP/SMTP account
- Process:
  1. Validate email and credentials
  2. Auto-detect provider settings (if enabled)
  3. Test IMAP connection (parallel with SMTP)
  4. Test SMTP connection (parallel with IMAP)
  5. Encrypt passwords
  6. Save/update account in database
- Response: Account details with connection test results

**GET `/api/imap-smtp/accounts`**

- Purpose: List all user's IMAP/SMTP accounts
- Returns: Array of account objects (passwords excluded)

**DELETE `/api/imap-smtp/accounts/:accountId`**

- Purpose: Disconnect email account
- Process: Sets `is_active: false`, stops monitoring

### 8.2 Email Operations Endpoints

**GET `/api/imap-smtp/emails/:accountId`**

- Purpose: Fetch emails from IMAP account
- Query Parameters: `folder`, `limit`
- Returns: Array of email objects

**GET `/api/imap-smtp/emails-quick/:accountId`**

- Purpose: Fast database-first email loading
- Process: Returns emails from database, triggers background sync if needed
- Returns: Array of emails with sync status

**POST `/api/imap-smtp/send`**

- Purpose: Send email via SMTP
- Body: `accountId`, `to`, `subject`, `body`, `html`, `attachments`
- Returns: Message ID on success

**GET `/api/imap-smtp/folders/:accountId`**

- Purpose: Get list of IMAP folders
- Returns: Array of folder objects

**DELETE `/api/imap-smtp/emails/:accountId/:uid`**

- Purpose: Delete email via IMAP
- Query Parameters: `folder`
- Returns: Success status

**POST `/api/imap-smtp/emails/:accountId/:uid/move`**

- Purpose: Move email to different folder
- Body: `fromFolder`, `toFolder`
- Returns: Success status

### 8.3 Utility Endpoints

**GET `/api/imap-smtp/detect/:email`**

- Purpose: Auto-detect provider settings
- Returns: Provider settings object

## 9. Error Handling Strategy

### 9.1 Error Classification

**Throttling Errors:**

- Detected by keywords: `[THROTTLED]`, `rate limit`, `quota exceeded`
- Strategy: Exponential backoff with 2x multiplier
- Max Retries: 5
- Delays: 3s base, up to 60s max

**Connection Errors:**

- Detected by keywords: `connection`, `timeout`, `socket`, `network`
- Strategy: Reconnection with validation
- Max Retries: 3
- Delays: 2s base, up to 30s max

**Authentication Errors:**

- Detected by keywords: `authentication`, `credentials`, `LOGIN`, `AUTHENTICATIONFAILED`
- Strategy: No retry (permanent failure)
- Response: Detailed error message with troubleshooting steps

### 9.2 Gmail-Specific Error Messages

**Connection Rejected:**

- Provides step-by-step troubleshooting guide
- Links to Gmail settings pages
- Explains App Password creation process
- Includes IMAP enablement instructions

**Authentication Failed:**

- Explains App Password requirement
- Provides link to App Password creation
- Notes about 2-Step Verification requirement

### 9.3 Retry Implementation

**Basic Retry (`retryWithBackoff`):**

- Exponential backoff with jitter (0-20% random)
- Custom retry condition function
- Retry callbacks for logging
- Throttling detection with 2x delay multiplier

**Reconnection Retry (`retryWithReconnect`):**

- Recreates connection on connection errors
- Closes old connection before retry
- Handles "Not authenticated" errors specifically

## 10. Frontend Integration

### 10.1 API Client Functions

**Account Management:**

- `connectImapSmtpAccount()`: Connect new account
- `getImapSmtpAccounts()`: List user accounts
- `disconnectImapSmtpAccount()`: Disconnect account
- `detectProviderSettings()`: Auto-detect settings

**Email Operations:**

- `fetchImapSmtpEmails()`: Fetch emails (uses quick endpoint)
- `sendImapSmtpEmail()`: Send email
- `getImapSmtpFolders()`: Get folder list
- `deleteImapSmtpEmail()`: Delete email
- `moveImapSmtpEmail()`: Move email

### 10.2 UI Components

**Connection Form:**

- Email input with auto-detection
- Provider selection (auto or manual)
- IMAP/SMTP configuration fields
- Password inputs (with App Password guidance for Gmail)
- Connection test button
- Error display with troubleshooting steps

**Email Interface:**

- Folder sidebar with Gmail folders
- Email list with pagination
- Email composer with attachment support
- Email actions (delete, move, mark read)

## 11. Development Steps

### Phase 1: Database Setup

1. Create migration file for IMAP/SMTP columns
2. Add indexes for performance
3. Test migration on development database

### Phase 2: Security Implementation

1. Create encryption utility module
2. Generate encryption key script
3. Implement encrypt/decrypt functions
4. Test encryption/decryption flow
5. Add environment variable validation

### Phase 3: Provider Auto-Detection

1. Create provider settings lookup table
2. Implement `getProviderSettings()` function
3. Add Gmail-specific settings and notes
4. Test with various email domains

### Phase 4: IMAP Service Implementation

1. Implement `testImapConnection()` with Gmail-specific handling
2. Implement `fetchEmails()` with connection pooling
3. Implement `getFolders()` with Gmail folder handling
4. Implement `deleteEmail()` and `moveEmail()`
5. Add retry logic for all operations

### Phase 5: SMTP Service Implementation

1. Implement `testSmtpConnection()`
2. Implement `sendEmail()` with attachment support
3. Add error handling for SMTP operations

### Phase 6: Connection Pool Implementation

1. Create connection pool module
2. Implement connection lifecycle management
3. Add stale connection cleanup
4. Implement connection health checks
5. Add connection pool statistics

### Phase 7: Retry Mechanism Implementation

1. Create retry utility module
2. Implement exponential backoff
3. Add throttling detection
4. Implement reconnection logic
5. Add retry callbacks and logging

### Phase 8: API Routes Implementation

1. Create IMAP/SMTP router
2. Implement account management endpoints
3. Implement email operation endpoints
4. Add authentication middleware
5. Add error handling middleware
6. Integrate with Express app

### Phase 9: Frontend Integration

1. Create API client functions
2. Build connection form component
3. Build email interface components
4. Add error handling and user feedback
5. Implement real-time updates (if using WebSocket)

### Phase 10: Testing & Optimization

1. Test Gmail connection with App Password
2. Test error scenarios (invalid credentials, rate limiting)
3. Test connection pooling under load
4. Optimize email fetching performance
5. Test folder handling for Gmail structure
6. Performance testing and optimization

### Phase 11: Documentation & Deployment

1. Document API endpoints
2. Create user guide for Gmail setup
3. Document troubleshooting steps
4. Deploy to staging environment
5. Production deployment

## Key Implementation Details

### Gmail App Password Setup Flow

1. User enables 2-Step Verification in Google Account
2. User navigates to App Passwords section
3. User creates new App Password for "Mail"
4. User copies 16-character password (without spaces)
5. User enters password in connection form
6. System validates and stores encrypted password

### Connection Test Flow

1. System detects Gmail from email domain
2. Applies Gmail-specific connection settings
3. Tests IMAP connection with extended timeouts
4. Tests SMTP connection in parallel
5. Returns detailed error messages if failed
6. Saves account if both tests succeed

### Email Fetching Flow

1. Check database for cached emails
2. Get connection from pool
3. Open IMAP folder
4. Search for new emails (UID > last synced)
5. Fetch email content
6. Parse emails using mailparser
7. Save to database
8. Return email list to frontend

### Error Recovery Flow

1. Detect error type (throttling, connection, auth)
2. Apply appropriate retry strategy
3. Log error details
4. Return user-friendly error message
5. Provide troubleshooting steps for Gmail

## Conclusion

This implementation provides a robust, secure, and user-friendly way to integrate Gmail accounts via IMAP/SMTP. The design emphasizes security (encrypted passwords), reliability (retry mechanisms, connection pooling), and user experience (auto-detection, detailed error messages). The Gmail-specific handling ensures smooth integration with Google's email infrastructure while providing helpful guidance for users setting up App Passwords.

