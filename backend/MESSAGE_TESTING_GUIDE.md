# Message Handler Testing Guide

## Overview
This guide shows you how to test the enhanced Baileys message handler and verify that messages are being sent to the API correctly.

## 🧪 Testing Methods

### Method 1: Automated Test Script
Run the comprehensive test script:

```bash
# Basic test (no actual webhook)
node test-message-flow.js

# Test with actual webhook (be careful in production!)
node test-message-flow.js --test-webhook
```

### Method 2: Manual Testing with Real WhatsApp
1. **Start the backend server:**
   ```bash
   npm start
   ```

2. **Connect a WhatsApp agent:**
   - Go to your frontend dashboard
   - Create or select an agent
   - Click "Connect WhatsApp"
   - Scan the QR code with your phone

3. **Send test messages:**
   - Send text messages to the connected number
   - Send images, videos, or other media
   - Send messages in groups (if connected to a group)

4. **Monitor the logs:**
   Look for these log messages in your server console:

   ```
   [BAILEYS] 📨 Received 1 message(s) for agent {agentId}
   [BAILEYS] 📨 Processing message from {phone} to agent {agentId}
   [BAILEYS] ✅ Message stored in database for agent {agentId}
   [N8N] 🔗 Triggering webhook for agent {agentId}
   [N8N] ✅ Webhook triggered successfully for agent {agentId}
   ```

### Method 3: Database Verification
Check if messages are being stored in the database:

```sql
-- Check recent messages
SELECT * FROM chat_messages 
ORDER BY created_at DESC 
LIMIT 10;

-- Check webhook logs
SELECT * FROM n8n_webhook_logs 
ORDER BY created_at DESC 
LIMIT 10;
```

### Method 4: Webhook Testing
Test the webhook endpoint directly:

```bash
# Test webhook with curl
curl -X POST https://nsolbpo.app.n8n.cloud/webhook-test/whatsapp-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "test-123",
    "message": "Test message",
    "senderPhone": "1234567890",
    "messageType": "text"
  }'
```

## 🔍 What to Look For

### ✅ Success Indicators

1. **Server Logs Show:**
   ```
   [BAILEYS] 📨 Received X message(s) for agent {agentId}
   [BAILEYS] ✅ Message stored in database for agent {agentId}
   [N8N] ✅ Webhook triggered successfully for agent {agentId}
   ```

2. **Database Contains:**
   - New rows in `chat_messages` table
   - New rows in `n8n_webhook_logs` table with status 200

3. **N8N Dashboard Shows:**
   - New webhook executions
   - Successful webhook deliveries

### ❌ Failure Indicators

1. **Server Logs Show:**
   ```
   [BAILEYS] ❌ Failed to save message to database
   [N8N] ❌ Failed to trigger webhook for agent {agentId}
   [N8N] 💥 All 3 attempts failed for agent {agentId}
   ```

2. **Database Issues:**
   - No new rows in `chat_messages`
   - `n8n_webhook_logs` shows error status codes

3. **N8N Issues:**
   - No webhook executions received
   - Webhook executions show errors

## 🛠️ Troubleshooting

### Common Issues and Solutions

#### 1. Messages Not Being Received
**Symptoms:** No logs showing message reception
**Solutions:**
- Check if WhatsApp is properly connected (QR code scanned)
- Verify agent is active in database
- Check Baileys connection status

#### 2. Database Errors
**Symptoms:** `❌ Failed to save message to database`
**Solutions:**
- Check database connection
- Verify Supabase credentials
- Check table permissions

#### 3. Webhook Failures
**Symptoms:** `❌ Failed to trigger webhook`
**Solutions:**
- Check webhook URL is correct
- Verify network connectivity
- Check n8n webhook is active
- Review webhook timeout settings

#### 4. Environment Issues
**Symptoms:** Configuration errors
**Solutions:**
- Verify `.env` file has correct values
- Check `WEBHOOK_ENV` setting
- Ensure all required environment variables are set

## 📊 Monitoring and Debugging

### Real-time Monitoring
```bash
# Monitor server logs in real-time
tail -f logs/app.log

# Or if using PM2
pm2 logs your-app-name
```

### Database Monitoring
```sql
-- Monitor message flow
SELECT 
  agent_id,
  from_number,
  message_text,
  created_at,
  direction
FROM chat_messages 
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Monitor webhook success rate
SELECT 
  response_status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at)))) as avg_interval_seconds
FROM n8n_webhook_logs 
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY response_status;
```

### Performance Metrics
```sql
-- Check message processing speed
SELECT 
  agent_id,
  COUNT(*) as message_count,
  AVG(EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at)))) as avg_processing_time
FROM chat_messages 
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY agent_id;
```

## 🎯 Test Scenarios

### Scenario 1: Basic Text Message
1. Send: "Hello, this is a test message"
2. Expected: Message stored, webhook triggered
3. Verify: Database entry, webhook log

### Scenario 2: Media Message
1. Send: Image with caption "Check this out"
2. Expected: Media type detected, caption extracted
3. Verify: `hasMedia: true`, `mediaType: 'image'`

### Scenario 3: Group Message
1. Send: Message in a WhatsApp group
2. Expected: `isGroup: true` in context
3. Verify: Group JID in conversation ID

### Scenario 4: High Volume
1. Send: Multiple messages rapidly
2. Expected: All messages processed
3. Verify: No message loss, proper ordering

## 🔧 Configuration Testing

### Test Different Environments
```bash
# Test environment
WEBHOOK_ENV=test node test-message-flow.js --test-webhook

# Production environment  
WEBHOOK_ENV=production node test-message-flow.js --test-webhook
```

### Test Webhook URLs
```bash
# Test with custom webhook
N8N_WEBHOOK_URL=https://your-custom-webhook.com/webhook node test-message-flow.js --test-webhook
```

## 📈 Performance Testing

### Load Testing
```bash
# Send multiple test messages
for i in {1..10}; do
  node test-message-flow.js --test-webhook
  sleep 1
done
```

### Stress Testing
Monitor server performance during high message volume:
- CPU usage
- Memory usage
- Database connection pool
- Webhook response times

## 🚨 Alerting and Monitoring

### Set up Alerts for:
- Webhook failure rate > 10%
- Message processing delay > 30 seconds
- Database connection errors
- High error rate in logs

### Monitoring Tools:
- Server logs with structured logging
- Database query performance
- Webhook response times
- N8N execution success rates

## 📝 Test Checklist

- [ ] Environment variables configured
- [ ] Backend server running
- [ ] WhatsApp agent connected
- [ ] Test message sent
- [ ] Message received in logs
- [ ] Message stored in database
- [ ] Webhook triggered successfully
- [ ] N8N received webhook
- [ ] Response time acceptable
- [ ] Error handling working

## 🎉 Success Criteria

Your message handler is working correctly when:
1. ✅ Messages are received and logged
2. ✅ Messages are stored in database
3. ✅ Webhooks are triggered successfully
4. ✅ N8N receives and processes webhooks
5. ✅ Error handling works for edge cases
6. ✅ Performance is acceptable under load
