# Quick Local Test Guide

## Backend URL
- **Base URL:** `http://localhost:3001`
- **Endpoint:** `/api/webhooks/send-message`
- **Full URL:** `http://localhost:3001/api/webhooks/send-message`

---

## Method 1: cURL (Easiest)

### Windows (PowerShell/CMD)
```bash
curl -X POST http://localhost:3001/api/webhooks/send-message -H "Content-Type: application/json" -d "{\"agentId\": \"b361a914-18bb-405c-92eb-8afe549ca9e1\", \"to\": \"923336906200\", \"message\": \"👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*\"}"
```

### Linux/Mac
```bash
curl -X POST http://localhost:3001/api/webhooks/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
    "to": "923336906200",
    "message": "👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
  }'
```

---

## Method 2: PowerShell Script

Save as `test-webhook.ps1`:

```powershell
$body = @{
    agentId = "b361a914-18bb-405c-92eb-8afe549ca9e1"
    to = "923336906200"
    message = "👋 Welcome!`n`n*1️⃣ Option 1*`n*2️⃣ Option 2*`n*3️⃣ Option 3*"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://localhost:3001/api/webhooks/send-message" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body

Write-Host "Response:" -ForegroundColor Green
$response | ConvertTo-Json -Depth 10
```

Run:
```powershell
.\test-webhook.ps1
```

---

## Method 3: Node.js Test Script

Save as `test-webhook.js` in `backend/` folder:

```javascript
const http = require('http');

const data = JSON.stringify({
  agentId: 'b361a914-18bb-405c-92eb-8afe549ca9e1',
  to: '923336906200',
  message: '👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*'
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/webhooks/send-message',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', JSON.parse(responseData));
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
```

Run:
```bash
cd backend
node test-webhook.js
```

---

## Method 4: Postman

1. **Method:** POST
2. **URL:** `http://localhost:3001/api/webhooks/send-message`
3. **Headers:**
   - Key: `Content-Type`
   - Value: `application/json`
4. **Body (raw JSON):**
```json
{
  "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
  "to": "923336906200",
  "message": "👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
}
```

---

## Expected Response

### Success (200 OK)
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
    "to": "923336906200",
    "sentAt": "2025-01-17T10:30:00.000Z"
  }
}
```

### Check Backend Logs
You should see:
```
[WEBHOOK-SEND-MESSAGE][...] ✅ Message sent successfully
[WEBHOOK-SEND-MESSAGE][...] ✅ Agent response stored in database for dashboard display (with button support)
```

---

## Verify in Dashboard

1. Open: `http://localhost:5173`
2. Navigate to agent chat
3. Look for the message with 3 buttons
4. Click a button to test

---

## Troubleshooting

### Error: "Agent not found"
- Verify agent ID exists in database
- Check agent is active

### Error: "WhatsApp connection lost"
- Agent must be connected to WhatsApp
- Check agent status in dashboard

### Message not appearing
- Check database: `SELECT * FROM message_log WHERE agent_id = 'b361a914-18bb-405c-92eb-8afe549ca9e1' ORDER BY created_at DESC LIMIT 1;`
- Verify `source = 'dashboard'` and `sender_type = 'agent'`
- Refresh dashboard (Ctrl+Shift+R)

