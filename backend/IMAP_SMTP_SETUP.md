# IMAP/SMTP Email Integration Setup Guide

This guide explains how to use the IMAP/SMTP email integration feature, which allows users to connect email accounts using IMAP and SMTP protocols (not just OAuth).

## Overview

The IMAP/SMTP integration supports:
- ✅ Multiple email providers (Gmail, Outlook, Yahoo, iCloud, custom)
- ✅ Auto-detection of server settings for common providers
- ✅ Secure password encryption
- ✅ Email reading, sending, deleting, and folder management
- ✅ Works alongside existing Gmail OAuth integration

## Architecture

```
Frontend (React)
    ↓ API calls
Backend (Node.js/Express)
    ↓ IMAP/SMTP
Email Servers (Gmail, Outlook, Yahoo, etc.)
```

## Setup

### 1. Install Dependencies

Dependencies are already installed:
- `imap-simple` - IMAP client
- `nodemailer` - SMTP client
- `mailparser` - Email parsing

### 2. Database Migration

Run the migration to add IMAP/SMTP columns:

```bash
cd backend
npm run migrate
```

Or manually run:
```sql
-- See backend/migrations/008_add_imap_smtp_support.sql
```

### 3. Environment Variables

Add to your `.env` file:

```env
# Encryption key for storing passwords securely
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your_32_character_hex_encryption_key_here
```

## API Endpoints

### Connect Email Account

**POST** `/api/imap-smtp/connect`

Connect and save an IMAP/SMTP email account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "provider": "gmail", // Optional: gmail, outlook, yahoo, custom
  "imapHost": "imap.gmail.com", // Optional if auto-detect works
  "imapPort": 993,
  "smtpHost": "smtp.gmail.com", // Optional if auto-detect works
  "smtpPort": 587,
  "imapUsername": "user@example.com", // Optional: defaults to email
  "imapPassword": "your-password",
  "smtpUsername": "user@example.com", // Optional: defaults to email
  "smtpPassword": "your-password",
  "useSsl": true,
  "useTls": true,
  "autoDetect": true // Auto-detect provider settings
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email account connected successfully",
  "account": {
    "id": "uuid",
    "email": "user@example.com",
    "provider": "gmail",
    "imapTest": { "success": true, "mailbox": {...} },
    "smtpTest": { "success": true }
  }
}
```

### Auto-Detect Provider Settings

**GET** `/api/imap-smtp/detect/:email`

Auto-detect IMAP/SMTP settings for an email address.

**Example:**
```
GET /api/imap-smtp/detect/user@gmail.com
```

**Response:**
```json
{
  "success": true,
  "settings": {
    "imap": { "host": "imap.gmail.com", "port": 993, "ssl": true },
    "smtp": { "host": "smtp.gmail.com", "port": 587, "tls": true },
    "note": "Gmail requires OAuth2 or App Password..."
  }
}
```

### Get All Accounts

**GET** `/api/imap-smtp/accounts`

Get all IMAP/SMTP accounts for the authenticated user.

**Response:**
```json
{
  "success": true,
  "accounts": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "provider": "gmail",
      "imap_host": "imap.gmail.com",
      "smtp_host": "smtp.gmail.com",
      "auth_method": "password",
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Fetch Emails

**GET** `/api/imap-smtp/emails/:accountId?folder=INBOX&limit=50`

Fetch emails from an IMAP account.

**Query Parameters:**
- `folder` - Mailbox folder (default: "INBOX")
- `limit` - Maximum number of emails (default: 50)

**Response:**
```json
{
  "success": true,
  "emails": [
    {
      "id": "imap-accountId-uid",
      "uid": 123,
      "from": "sender@example.com",
      "fromEmail": "sender@example.com",
      "to": "user@example.com",
      "subject": "Email Subject",
      "body": "Plain text body",
      "bodyHtml": "<html>...</html>",
      "date": "2024-01-01T00:00:00Z",
      "isRead": false,
      "attachments": [],
      "folder": "INBOX"
    }
  ],
  "count": 10
}
```

### Send Email

**POST** `/api/imap-smtp/send`

Send an email via SMTP.

**Request Body:**
```json
{
  "accountId": "uuid",
  "to": "recipient@example.com",
  "subject": "Email Subject",
  "body": "Plain text body",
  "html": "<html>...</html>", // Optional
  "attachments": [] // Optional
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "<message-id>",
  "response": "250 OK"
}
```

### Get Folders

**GET** `/api/imap-smtp/folders/:accountId`

Get all folders from an IMAP account.

**Response:**
```json
{
  "success": true,
  "folders": [
    {
      "name": "INBOX",
      "delimiter": "/",
      "attributes": [],
      "children": 0
    },
    {
      "name": "Sent",
      "delimiter": "/",
      "attributes": [],
      "children": 0
    }
  ]
}
```

### Delete Email

**DELETE** `/api/imap-smtp/emails/:accountId/:uid?folder=INBOX`

Delete an email via IMAP.

**Response:**
```json
{
  "success": true,
  "message": "Email deleted successfully"
}
```

### Move Email

**POST** `/api/imap-smtp/emails/:accountId/:uid/move`

Move an email to a different folder.

**Request Body:**
```json
{
  "fromFolder": "INBOX",
  "toFolder": "Archive"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email moved successfully"
}
```

### Disconnect Account

**DELETE** `/api/imap-smtp/accounts/:accountId`

Disconnect an email account.

**Response:**
```json
{
  "success": true,
  "message": "Email account disconnected successfully"
}
```

## Supported Email Providers

### Gmail
- **IMAP:** `imap.gmail.com:993` (SSL)
- **SMTP:** `smtp.gmail.com:587` (TLS)
- **Note:** Requires OAuth2 or App Password (password login may not work)

### Outlook/Hotmail/Live
- **IMAP:** `outlook.office365.com:993` (SSL)
- **SMTP:** `smtp.office365.com:587` (TLS)
- **Note:** Office365 accounts may require OAuth2

### Yahoo
- **IMAP:** `imap.mail.yahoo.com:993` (SSL)
- **SMTP:** `smtp.mail.yahoo.com:587` (TLS)
- **Note:** Requires App Password if 2FA is enabled

### iCloud
- **IMAP:** `imap.mail.me.com:993` (SSL)
- **SMTP:** `smtp.mail.me.com:587` (TLS)
- **Note:** Requires App-Specific Password

### Custom Providers
You can connect any email provider by providing IMAP/SMTP settings manually.

## Security

### Password Encryption
- Passwords are encrypted using AES-256-CBC before storage
- Encryption key is stored in `ENCRYPTION_KEY` environment variable
- Never commit the encryption key to version control

### Authentication
- All endpoints require authentication via `authMiddleware`
- Users can only access their own email accounts
- Account ownership is verified on every request

## Error Handling

Common errors and solutions:

1. **IMAP connection failed**
   - Check IMAP host, port, and credentials
   - Verify SSL/TLS settings
   - For Gmail, use App Password instead of regular password

2. **SMTP connection failed**
   - Check SMTP host, port, and credentials
   - Verify TLS settings
   - Some providers require authentication on port 587

3. **Authentication failed**
   - Verify username and password
   - Check if provider requires OAuth2 or App Password
   - Ensure 2FA is disabled or App Password is used

## Frontend Integration

Example React code to connect an email account:

```typescript
const connectEmailAccount = async (email: string, password: string) => {
  try {
    // Auto-detect settings first
    const detectRes = await fetch(`/api/imap-smtp/detect/${email}`);
    const { settings } = await detectRes.json();
    
    // Connect account
    const res = await fetch('/api/imap-smtp/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        imapPassword: password,
        smtpPassword: password,
        autoDetect: true,
        // Use detected settings or provide manually
        ...(settings && {
          imapHost: settings.imap.host,
          imapPort: settings.imap.port,
          smtpHost: settings.smtp.host,
          smtpPort: settings.smtp.port,
        })
      })
    });
    
    const data = await res.json();
    if (data.success) {
      console.log('Account connected:', data.account);
    }
  } catch (error) {
    console.error('Failed to connect:', error);
  }
};
```

## Testing

Test IMAP/SMTP connection:

```bash
# Test connection
curl -X POST http://localhost:3001/api/imap-smtp/connect \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "email": "test@example.com",
    "imapPassword": "password",
    "smtpPassword": "password",
    "autoDetect": true
  }'
```

## Notes

- IMAP/SMTP integration works alongside Gmail OAuth integration
- Users can have multiple email accounts (both OAuth and IMAP/SMTP)
- Passwords are encrypted at rest
- Email fetching is done on-demand (no background sync yet)
- Consider implementing background sync job for automatic email fetching

