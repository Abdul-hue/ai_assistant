# Gmail Real-Time Ingestion Setup Guide

This guide explains how the real-time Gmail email ingestion system works using Google Pub/Sub push notifications.

## Architecture Overview

```
Gmail (new email arrives)
    ↓ push notification
Google Pub/Sub Topic
    ↓ webhook push
Backend Server (/api/gmail/webhook)
    ↓ fetch from Gmail API
    ↓ save instantly
Supabase (emails table)
    ↓ only when page loads/refreshes
Frontend fetches emails
```

## Key Principles

1. **Real-time Backend**: Backend receives emails instantly via Pub/Sub push notifications
2. **Instant Supabase Save**: Emails are saved to Supabase immediately when received
3. **Manual Frontend Refresh**: Frontend only fetches emails on page load/refresh (NO Supabase realtime subscriptions)

## Setup Steps

### 1. Enable Gmail API + Pub/Sub in Google Cloud

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable **Gmail API**
3. Enable **Cloud Pub/Sub API**
4. Create a Pub/Sub topic:
   ```bash
   gcloud pubsub topics create gmail-notifications
   ```

### 2. Configure Gmail Watch

The backend automatically sets up Gmail watch when a user connects their Gmail account via OAuth.

**What happens:**
- User completes Gmail OAuth
- Backend calls `gmail.users.watch()` with your Pub/Sub topic
- Gmail starts sending notifications to Pub/Sub when mailbox changes

**Environment Variables Required:**
```env
GOOGLE_PROJECT_ID=your-project-id
GMAIL_TOPIC=projects/your-project-id/topics/gmail-notifications
```

### 3. Configure Pub/Sub Push Subscription

Create a push subscription that sends notifications to your backend:

```bash
gcloud pubsub subscriptions create gmail-notifications-sub \
  --topic=gmail-notifications \
  --push-endpoint=https://your-backend-url.com/api/gmail/webhook \
  --push-auth-service-account=your-service-account@your-project.iam.gserviceaccount.com
```

**For Local Development:**
Use ngrok to expose your local server:
```bash
ngrok http 3001
# Use https://abc123.ngrok.io/api/gmail/webhook as the push endpoint
```

### 4. Backend Webhook Handler

The webhook endpoint is already implemented at `POST /api/gmail/webhook`.

**What it does:**
1. Receives Pub/Sub push notification
2. Acknowledges immediately (required by Pub/Sub)
3. Extracts `emailAddress` and `historyId` from message
4. Fetches user's auth tokens from Supabase
5. Calls `handleGmailNotification()` which:
   - Fetches new emails from Gmail API
   - Saves each email immediately to Supabase
   - Optionally broadcasts via WebSocket (if frontend connected)

### 5. Supabase Email Storage

Emails are saved to the `emails` table with this structure:

```sql
CREATE TABLE emails (
  id UUID PRIMARY KEY,
  email_account_id UUID REFERENCES email_accounts(id),
  provider_message_id TEXT NOT NULL, -- Gmail message ID
  thread_id TEXT,
  sender_email TEXT,
  sender_name TEXT,
  recipient_email TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  is_read BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email_account_id, provider_message_id)
);
```

### 6. Frontend Email Fetching

**IMPORTANT**: Frontend does NOT use Supabase realtime subscriptions.

Instead, frontend fetches emails only when:
- Page loads
- User clicks refresh button
- User navigates to Gmail page

**Frontend Code Pattern:**
```typescript
// On page load/refresh
const { data } = await supabase
  .from("emails")
  .select("*")
  .eq("email_account_id", accountId)
  .order("received_at", { ascending: false })
  .limit(50);
```

## Flow Diagram

### Real-Time Ingestion (Backend)

```
1. New email arrives in Gmail
   ↓
2. Gmail sends notification to Pub/Sub topic
   ↓
3. Pub/Sub pushes to /api/gmail/webhook
   ↓
4. Backend acknowledges (200 OK)
   ↓
5. Backend fetches email from Gmail API
   ↓
6. Backend saves to Supabase immediately
   ↓
7. Email is now in database (ready for frontend)
```

### Frontend Display (Manual Refresh)

```
1. User opens Gmail page
   ↓
2. Frontend fetches from Supabase
   ↓
3. Display emails
   ↓
4. User clicks refresh
   ↓
5. Frontend fetches again from Supabase
   ↓
6. Shows new emails (that were saved by backend)
```

## Testing

### Test Pub/Sub Webhook

1. Send yourself an email from another account
2. Check backend logs for:
   ```
   📬 Gmail Pub/Sub push notification received
   📧 Processing notification for your-email@gmail.com
   ✅ Fetched: [email subject]
   💾 Saved to Supabase with messageId: [id]
   ```

3. Check Supabase `emails` table - should see new email immediately

4. Refresh frontend - new email should appear

### Verify Gmail Watch is Active

Check backend logs when user connects Gmail:
```
✅ Gmail watch started: { historyId: '...', expiration: '...' }
```

Watch expires after 7 days and needs to be renewed.

## Troubleshooting

### Emails not arriving in backend

1. **Check Pub/Sub subscription is active:**
   ```bash
   gcloud pubsub subscriptions describe gmail-notifications-sub
   ```

2. **Check webhook endpoint is accessible:**
   - Must be HTTPS (not HTTP)
   - Must return 200 OK within 10 seconds
   - Must be publicly accessible

3. **Check Gmail watch is active:**
   - Look for "Gmail watch started" in logs
   - Watch expires after 7 days

### Emails saved but not showing in frontend

1. **Check Supabase query:**
   - Verify `email_account_id` matches
   - Check `received_at` ordering
   - Verify limit is sufficient

2. **Check frontend refresh:**
   - Frontend only fetches on page load/refresh
   - Click refresh button to see new emails

### Pub/Sub notifications not received

1. **Check topic exists:**
   ```bash
   gcloud pubsub topics list
   ```

2. **Check subscription exists:**
   ```bash
   gcloud pubsub subscriptions list
   ```

3. **Check push endpoint URL:**
   - Must match exactly what's in subscription
   - Must be HTTPS
   - Must be publicly accessible

## Environment Variables

```env
# Required for Gmail Watch
GOOGLE_PROJECT_ID=your-project-id
GMAIL_TOPIC=projects/your-project-id/topics/gmail-notifications

# Gmail OAuth (already configured)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback

# Backend URL (for Pub/Sub push endpoint)
BACKEND_URL=https://your-backend-url.com
```

## Benefits of This Architecture

✅ **Instant Backend Ingestion**: Emails arrive in backend within seconds
✅ **Reliable Storage**: Supabase is single source of truth
✅ **Simple Frontend**: No complex realtime subscriptions
✅ **Efficient**: No polling, no wasted API calls
✅ **Scalable**: Pub/Sub handles high volume automatically

## Next Steps

1. Set up Google Cloud Pub/Sub topic and subscription
2. Configure environment variables
3. Test by sending yourself an email
4. Verify emails appear in Supabase immediately
5. Verify frontend shows emails on refresh

