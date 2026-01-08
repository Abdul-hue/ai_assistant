# Webhook: `https://auto.nsolbpo.com/webhook/pa-email`

## Overview

This webhook receives notifications when **new unread emails** are detected from IMAP/SMTP email accounts. The webhook is triggered automatically by the system when new emails arrive.

## Webhook Setup

### Configuration

The webhook URL is hardcoded in `backend/src/routes/fetchNewMail.js`:

```javascript
const WEBHOOK_URL = 'https://auto.nsolbpo.com/webhook/pa-email';
```

**Note:** There's also an alternative webhook system in `backend/src/utils/emailWebhook.js` that uses environment variables:
- `EXTERNAL_WEBHOOK_URL` (priority)
- `EMAIL_WEBHOOK_URL` (fallback)

However, the main webhook at `/api/fetch-new-mail` uses the hardcoded URL above.

### When is the Webhook Triggered?

The webhook is called in **two scenarios**:

1. **Scheduled Job (Every 15 minutes)**
   - Runs automatically via `fetchNewUnreadEmailsForAllAccounts()` in `app.js`
   - Checks all active IMAP/SMTP accounts for new unread emails
   - Only sends webhook for emails that **don't exist** in the database (by UID)

2. **Manual API Call**
   - `GET /api/fetch-new-mail/:accountId` - Fetch new emails for specific account
   - `GET /api/fetch-new-mail` - Fetch new emails for all user's accounts

### Trigger Conditions

The webhook is **ONLY** sent when:
- ✅ Email is **new** (UID doesn't exist in database)
- ✅ Email is **unread** (UNSEEN flag)
- ✅ Email is successfully **saved** to Supabase database
- ✅ Email UID is **greater** than the last fetched UID for that account

The webhook is **NOT** sent when:
- ❌ Email already exists in database (duplicate UID)
- ❌ Email is read (already seen)
- ❌ Email save to database fails
- ❌ Email is an update to existing email

## Webhook Payload Structure

### Request Method
- **Method:** `POST`
- **Content-Type:** `application/json`
- **Timeout:** 10 seconds

### Payload Format

```json
{
  "event": "new_unseen_email",
  "timestamp": "2025-01-09T12:34:56.789Z",
  "account_id": "902bc346-bde8-4a0b-ae3e-c09e3e6239b7",
  "user_id": "user-uuid-here",
  "email": {
    "id": "email-database-id-or-null",
    "uid": 12345,
    "subject": "Email Subject Here",
    "sender_name": "John Doe",
    "sender_email": "john@example.com",
    "recipient_email": "recipient@example.com",
    "body_text": "Plain text email body...",
    "body_html": "<html>HTML email body...</html>",
    "received_at": "2025-01-09T12:30:00.000Z",
    "folder_name": "INBOX",
    "is_read": false,
    "is_starred": false,
    "attachments_count": 2,
    "attachments_meta": [
      {
        "filename": "document.pdf",
        "contentType": "application/pdf",
        "size": 102400,
        "cid": null
      },
      {
        "filename": "image.jpg",
        "contentType": "image/jpeg",
        "size": 51200,
        "cid": "image123"
      }
    ]
  }
}
```

### Payload Fields Explained

#### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Always `"new_unseen_email"` |
| `timestamp` | string (ISO 8601) | When the webhook was sent |
| `account_id` | string (UUID) | The email account ID from `email_accounts` table |
| `user_id` | string (UUID) | The user ID who owns the email account |

#### Email Object Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | string \| null | Database email ID (may be null) | `"email-uuid"` |
| `uid` | number | IMAP UID (unique identifier) | `12345` |
| `subject` | string | Email subject line | `"Meeting Tomorrow"` |
| `sender_name` | string | Sender's display name | `"John Doe"` |
| `sender_email` | string | Sender's email address | `"john@example.com"` |
| `recipient_email` | string | Recipient's email address | `"recipient@example.com"` |
| `body_text` | string | Plain text email body | `"Hello, this is the email..."` |
| `body_html` | string | HTML email body (if available) | `"<html><body>...</body></html>"` |
| `received_at` | string (ISO 8601) | When email was received | `"2025-01-09T12:30:00.000Z"` |
| `folder_name` | string | IMAP folder name | `"INBOX"` |
| `is_read` | boolean | Whether email is read | `false` |
| `is_starred` | boolean | Whether email is starred | `false` |
| `attachments_count` | number | Number of attachments | `2` |
| `attachments_meta` | array | Attachment metadata array | See below |

#### Attachment Metadata Structure

Each attachment in `attachments_meta` has:

```json
{
  "filename": "document.pdf",
  "contentType": "application/pdf",
  "size": 102400,
  "cid": null  // Content-ID for inline images, null for regular attachments
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filename` | string | Attachment filename |
| `contentType` | string | MIME type (e.g., `"application/pdf"`) |
| `size` | number | File size in bytes |
| `cid` | string \| null | Content-ID for inline images, null otherwise |

## Example Webhook Request

### cURL Example

```bash
curl -X POST https://auto.nsolbpo.com/webhook/pa-email \
  -H "Content-Type: application/json" \
  -d '{
    "event": "new_unseen_email",
    "timestamp": "2025-01-09T12:34:56.789Z",
    "account_id": "902bc346-bde8-4a0b-ae3e-c09e3e6239b7",
    "user_id": "user-uuid-here",
    "email": {
      "id": null,
      "uid": 12345,
      "subject": "New Job Application",
      "sender_name": "Jane Smith",
      "sender_email": "jane@example.com",
      "recipient_email": "hr@company.com",
      "body_text": "Dear Hiring Manager,\n\nI am writing to apply...",
      "body_html": "<html><body><p>Dear Hiring Manager,</p><p>I am writing to apply...</p></body></html>",
      "received_at": "2025-01-09T12:30:00.000Z",
      "folder_name": "INBOX",
      "is_read": false,
      "is_starred": false,
      "attachments_count": 1,
      "attachments_meta": [
        {
          "filename": "resume.pdf",
          "contentType": "application/pdf",
          "size": 245760,
          "cid": null
        }
      ]
    }
  }'
```

## Webhook Response

The webhook expects a standard HTTP response. The system logs:

- **Success:** `[WEBHOOK] ✅ Successfully sent new unseen email UID {uid} to webhook`
- **Failure:** `[WEBHOOK] ❌ Failed to send email UID {uid} to webhook: {error} (Status: {statusCode})`

## Error Handling

- **Timeout:** 10 seconds
- **Retry:** No automatic retry (webhook failures are logged but don't block email processing)
- **Failure Impact:** Webhook failures don't prevent emails from being saved to database

## Code Locations

### Main Webhook Implementation
- **File:** `backend/src/routes/fetchNewMail.js`
- **Function:** `sendEmailToWebhook()`
- **Line:** ~126-170

### Alternative Webhook (for IDLE service)
- **File:** `backend/src/utils/emailWebhook.js`
- **Function:** `callEmailWebhook()`
- **Note:** Uses environment variables instead of hardcoded URL

### Trigger Points
1. **Scheduled Job:** `backend/app.js` - `fetchNewUnreadEmailsForAllAccounts()` (every 15 minutes)
2. **IDLE Service:** `backend/src/services/imapIdleService.js` - Real-time email detection
3. **Sync Service:** `backend/src/services/imapEmailSyncService.js` - During folder sync

## Testing the Webhook

You can test the webhook by:

1. **Sending a test email** to a monitored account
2. **Waiting up to 15 minutes** for scheduled check, OR
3. **Manually triggering** via API:
   ```bash
   GET /api/fetch-new-mail/:accountId
   ```

## Important Notes

1. **Deduplication:** Emails are deduplicated by UID - same email won't trigger webhook twice
2. **Only Unread:** Only unread (UNSEEN) emails trigger the webhook
3. **Database First:** Email is saved to Supabase **before** webhook is sent
4. **No Retry:** Failed webhooks are logged but not retried automatically
5. **Timeout:** Webhook has 10-second timeout - slow webhooks will fail

