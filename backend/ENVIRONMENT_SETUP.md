# Environment Variables Setup

## Overview
The enhanced Baileys message handler requires several environment variables to be configured. This document explains where and how to set them up.

## New Environment Variables Added

The following environment variables were added for the enhanced message handler:

### 1. Webhook Environment Configuration
```bash
# Controls which webhook URL to use
WEBHOOK_ENV=production  # or 'test'
```

### 2. Custom Webhook URL (Optional)
```bash
# Override default webhook URL
N8N_WEBHOOK_URL=https://your-custom-webhook-url.com/webhook
```

### 3. Webhook Timeout Configuration
```bash
# Webhook timeout in milliseconds (default: 30000)
N8N_WEBHOOK_TIMEOUT=30000
```

### 4. Webhook Retry Configuration
```bash
# Maximum retry attempts (default: 3)
WEBHOOK_RETRY_MAX_ATTEMPTS=3

# Initial retry delay in milliseconds (default: 2000)
WEBHOOK_RETRY_INITIAL_DELAY=2000
```

## Where to Add Environment Variables

### Option 1: Local Development (.env file)
Create a `.env` file in the `backend/` directory:

```bash
# Copy the example file
cp env.example .env

# Edit the .env file with your values
nano .env
```

### Option 2: Railway Deployment
Add environment variables in your Railway dashboard:
1. Go to your Railway project
2. Click on "Variables" tab
3. Add the new environment variables

### Option 3: Vercel Deployment
Add environment variables in your Vercel dashboard:
1. Go to your Vercel project
2. Click on "Settings" → "Environment Variables"
3. Add the new environment variables

### Option 4: System Environment Variables
Set them in your system environment:

**Windows (PowerShell):**
```powershell
$env:WEBHOOK_ENV="production"
$env:N8N_WEBHOOK_TIMEOUT="30000"
```

**Linux/macOS (Bash):**
```bash
export WEBHOOK_ENV=production
export N8N_WEBHOOK_TIMEOUT=30000
```

## Webhook URL Configuration

### Test Environment
When `WEBHOOK_ENV=test`, the system uses:
```
https://nsolbpo.app.n8n.cloud/webhook-test/whatsapp-webhook
```

### Production Environment
When `WEBHOOK_ENV=production` (default), the system uses:
```
https://nsolbpo.app.n8n.cloud/webhook/whatsapp-webhook
```

### Custom Webhook URL
If you set `N8N_WEBHOOK_URL`, it will override the environment-based selection:
```
N8N_WEBHOOK_URL=https://your-custom-webhook.com/webhook
```

## Verification

To verify your environment variables are working:

1. **Check server startup logs** - The server will display webhook configuration on startup
2. **Test webhook** - Send a test message to trigger the webhook
3. **Check logs** - Look for webhook success/failure messages in the console

## Example Configuration

### For Development/Testing:
```bash
WEBHOOK_ENV=test
N8N_WEBHOOK_TIMEOUT=10000
WEBHOOK_RETRY_MAX_ATTEMPTS=2
```

### For Production:
```bash
WEBHOOK_ENV=production
N8N_WEBHOOK_TIMEOUT=30000
WEBHOOK_RETRY_MAX_ATTEMPTS=3
```

## Troubleshooting

### Common Issues:

1. **Webhook not triggering**: Check if `WEBHOOK_ENV` is set correctly
2. **Timeout errors**: Increase `N8N_WEBHOOK_TIMEOUT` value
3. **Retry failures**: Adjust `WEBHOOK_RETRY_MAX_ATTEMPTS` and `WEBHOOK_RETRY_INITIAL_DELAY`

### Debug Mode:
Set `ENABLE_DEBUG_LOGS=true` to see detailed webhook logs.

## Security Notes

- Never commit `.env` files to version control
- Use strong, unique values for production
- Regularly rotate sensitive keys
- Monitor webhook logs for suspicious activity
