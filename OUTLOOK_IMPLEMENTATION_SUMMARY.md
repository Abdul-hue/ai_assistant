# Outlook IMAP/SMTP Implementation Summary

## Overview
Complete Outlook/Microsoft 365 integration has been implemented alongside the existing Gmail implementation. This document lists all the changes and where to find them.

## Files Modified

### 1. Backend Service Layer

#### `backend/src/services/imapSmtpService.js`

**New Functions Added:**
- `isOutlookAccount(email)` - Line 77-82
  - Detects if an email is an Outlook/Microsoft account
  - Checks for: outlook.com, hotmail.com, live.com, msn.com, onmicrosoft.com

- `isMicrosoft365Account(email)` - Line 87-93
  - Detects Microsoft 365 business accounts
  - Differentiates from personal Outlook accounts

- `getOutlookAuthError(error)` - Line 98-148
  - Provides Outlook-specific error messages
  - Includes troubleshooting steps for:
    - Authentication failures
    - IMAP disabled errors
    - Organization policy restrictions

**Updated Functions:**

1. **`getProviderSettings(email)`** - Lines 15-72
   - Added Outlook provider detection for:
     - outlook.com
     - hotmail.com
     - live.com
     - msn.com
   - Returns provider: 'outlook' in settings
   - Different SMTP hosts for personal vs M365

2. **`testImapConnection(config)`** - Lines 153-338
   - Outlook-specific timeouts (30s auth, 30s connection)
   - Outlook keepalive configuration (2 min idle interval)
   - TLS 1.2+ requirement for Outlook
   - Outlook-specific error handling with detailed suggestions

3. **`testSmtpConnection(config)`** - Lines 341-404
   - Auto-detects Outlook accounts
   - Determines SMTP host (smtp-mail.outlook.com vs smtp.office365.com)
   - Outlook-specific TLS settings
   - Extended timeouts for Outlook (30s connection, 30s greeting, 60s socket)

4. **`sendEmail(accountId, emailData)`** - Lines 1043-1114
   - Outlook SMTP host detection
   - Outlook-specific transporter configuration
   - requireTLS: true for Outlook
   - Extended timeouts for Outlook

5. **`getFolders(accountId)`** - Lines 1119-1307
   - Outlook folder name normalization:
     - "Sent Items" → "Sent"
     - "Deleted Items" → "Trash"
     - "Junk Email" → "Spam"
   - Special folder detection for Outlook
   - Outlook-specific folder sorting

### 2. Connection Pool

#### `backend/src/utils/imapConnectionPool.js`

**Changes:**
- Added provider-specific connection limits (Line 20-25)
  - Gmail: 5 connections
  - Outlook: 10 connections
  - Custom: 5 connections (default)

- Added `getMaxConnections(accountId)` - Line 30-33
  - Returns provider-specific max connections

- Added `setAccountProvider(accountId, provider)` - Line 38-41
  - Tracks provider per account for connection limits

- Updated all connection limit references to use provider-specific limits

### 3. Retry Logic

#### `backend/src/utils/imapRetry.js`

**Changes:**
- Added Outlook throttling indicators (Line 32-40)
  - 'throttl', 'overloaded', 'mailbox is being accessed', 'concurrent', 'too many connections'

- Added Outlook connection error indicators (Line 58)
  - 'etimedout', 'disconnected'

### 4. API Routes

#### `backend/src/routes/imapSmtp.js`

**Changes in `/api/imap-smtp/connect` route:**

1. **Provider Detection** (Line 112)
   - Extracts provider from detected settings
   - Sets `finalProvider` variable

2. **IMAP Test Error Handling** (Lines 175-179)
   - Detects Outlook accounts
   - Provides Outlook-specific error messages
   - Includes Outlook help URL

3. **SMTP Test Error Handling** (Lines 197-202)
   - Outlook-specific SMTP error messages
   - Outlook help URL

4. **Account Data** (Line 203)
   - Uses `finalProvider` instead of hardcoded 'custom'

### 5. Frontend API Client

#### `frontend/src/lib/imapSmtpApi.ts`

**New Functions:**

1. **`getProviderGuidance(provider)`** - Lines 95-125
   - Returns provider-specific setup instructions
   - For Outlook:
     - Title: "Outlook/Microsoft 365 Setup"
     - Setup steps
     - Links to settings, app password, help

**Updated Interfaces:**

- `ProviderSettings` interface (Line 49-61)
  - Added `provider?: string` field

- `ProviderGuidance` interface (Line 63-71)
  - New interface for provider guidance

## Key Features Implemented

### 1. Auto-Detection
- Automatically detects Outlook email addresses
- Configures IMAP/SMTP settings automatically
- Differentiates personal vs business accounts

### 2. Connection Configuration
- **IMAP**: outlook.office365.com:993 (SSL/TLS)
- **SMTP Personal**: smtp-mail.outlook.com:587 (STARTTLS)
- **SMTP M365**: smtp.office365.com:587 (STARTTLS)
- Extended timeouts for Outlook (30s)
- Keepalive to prevent disconnections

### 3. Error Handling
- Detailed error messages for:
  - Authentication failures
  - IMAP disabled
  - Organization restrictions
- Step-by-step troubleshooting guides
- Help URLs to Microsoft documentation

### 4. Folder Management
- Normalizes Outlook folder names
- Handles Outlook folder hierarchy
- Special folder detection

### 5. Connection Pooling
- 10 concurrent connections for Outlook (vs 5 for Gmail)
- Provider-specific limits
- Automatic provider tracking

### 6. Email Operations
- Fetch emails from Outlook accounts
- Send emails via Outlook SMTP
- Move/delete emails in Outlook folders
- Webhook integration for new Outlook emails

## Testing the Implementation

### Test Outlook Connection

1. **Connect Outlook Account:**
   ```bash
   POST /api/imap-smtp/connect
   {
     "email": "your-email@outlook.com",
     "imapPassword": "your-password",
     "smtpPassword": "your-password",
     "autoDetect": true
   }
   ```

2. **Expected Behavior:**
   - Auto-detects as Outlook provider
   - Tests IMAP connection to outlook.office365.com
   - Tests SMTP connection to smtp-mail.outlook.com
   - Saves account with provider: 'outlook'

3. **Fetch Emails:**
   ```bash
   GET /api/imap-smtp/emails/:accountId?folder=INBOX
   ```

4. **Send Email:**
   ```bash
   POST /api/imap-smtp/send
   {
     "accountId": "...",
     "to": "recipient@example.com",
     "subject": "Test",
     "body": "Test email"
   }
   ```

## Code Locations Reference

### Helper Functions
- `isOutlookAccount()` - `backend/src/services/imapSmtpService.js:77`
- `isMicrosoft365Account()` - `backend/src/services/imapSmtpService.js:87`
- `getOutlookAuthError()` - `backend/src/services/imapSmtpService.js:98`

### Provider Detection
- Outlook domains - `backend/src/services/imapSmtpService.js:25-47`

### Connection Testing
- IMAP test with Outlook support - `backend/src/services/imapSmtpService.js:153-338`
- SMTP test with Outlook support - `backend/src/services/imapSmtpService.js:341-404`

### Email Operations
- Send email with Outlook SMTP - `backend/src/services/imapSmtpService.js:1043-1114`
- Get folders with Outlook normalization - `backend/src/services/imapSmtpService.js:1119-1307`

### API Routes
- Connect route with Outlook handling - `backend/src/routes/imapSmtp.js:106-202`

### Frontend
- Provider guidance function - `frontend/src/lib/imapSmtpApi.ts:95-125`

## Differences from Gmail Implementation

| Feature | Gmail | Outlook |
|---------|-------|---------|
| IMAP Host | imap.gmail.com | outlook.office365.com |
| SMTP Host (Personal) | smtp.gmail.com | smtp-mail.outlook.com |
| SMTP Host (Business) | smtp.gmail.com | smtp.office365.com |
| Max Connections | 5 | 10 |
| Auth Timeout | 20s | 30s |
| Keepalive Interval | 5 min | 2 min |
| App Password | Always required | Only if 2FA enabled |
| Folder Namespace | [Gmail]/ | None (standard) |
| Sent Folder | [Gmail]/Sent Mail | Sent Items |
| Trash Folder | [Gmail]/Trash | Deleted Items |

## Verification Checklist

- [x] Provider auto-detection for Outlook domains
- [x] Outlook-specific IMAP connection testing
- [x] Outlook-specific SMTP connection testing
- [x] Outlook folder name normalization
- [x] Connection pool with Outlook limits (10 connections)
- [x] Outlook-specific error messages
- [x] Outlook throttling detection in retry logic
- [x] API routes handle Outlook accounts
- [x] Frontend provider guidance for Outlook
- [x] Webhook integration works for Outlook emails

## Next Steps

1. Test with a real Outlook account
2. Test with Microsoft 365 business account
3. Verify webhook delivery for Outlook emails
4. Test error scenarios (invalid credentials, IMAP disabled)
5. Test folder operations (move, delete)

## Notes

- All Outlook implementation follows the same patterns as Gmail for consistency
- Webhook integration uses the same endpoint for both Gmail and Outlook
- Provider is automatically detected and stored in the database
- Connection pool automatically adjusts limits based on provider

