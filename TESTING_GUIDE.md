# Testing Interactive Chat Buttons Locally

## Quick Test Guide

### Prerequisites
1. Backend server running on `http://localhost:3001` (or your configured port)
2. Agent ID: `b361a914-18bb-405c-92eb-8afe549ca9e1`
3. Phone number: `923336906200`
4. Agent must be connected to WhatsApp

---

## Method 1: Using cURL (Command Line)

### Test the Webhook Endpoint

```bash
curl -X POST http://localhost:3001/api/webhooks/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
    "to": "923336906200",
    "message": "👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
  }'
```

### Expected Response (Success)
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

## Method 2: Using Postman

### Setup
1. **Method:** POST
2. **URL:** `http://localhost:3001/api/webhooks/send-message`
3. **Headers:**
   - `Content-Type: application/json`

4. **Body (raw JSON):**
```json
{
  "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
  "to": "923336906200",
  "message": "👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
}
```

### Send Request
Click "Send" and check:
- Status: `200 OK`
- Response body shows `success: true`

---

## Method 3: Using JavaScript/Fetch (Browser Console)

Open browser console on your frontend (http://localhost:5173) and run:

```javascript
fetch('http://localhost:3001/api/webhooks/send-message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    agentId: 'b361a914-18bb-405c-92eb-8afe549ca9e1',
    to: '923336906200',
    message: '👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*'
  })
})
  .then(res => res.json())
  .then(data => console.log('Response:', data))
  .catch(err => console.error('Error:', err));
```

---

## Method 4: Using PowerShell (Windows)

```powershell
$body = @{
    agentId = "b361a914-18bb-405c-92eb-8afe549ca9e1"
    to = "923336906200"
    message = "👋 Welcome!`n`n*1️⃣ Option 1*`n*2️⃣ Option 2*`n*3️⃣ Option 3*"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3001/api/webhooks/send-message" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
```

---

## Verification Steps

### Step 1: Check Backend Logs
Look for these log messages:
```
[WEBHOOK-SEND-MESSAGE][...] ✅ Message sent successfully
[WEBHOOK-SEND-MESSAGE][...] ✅ Agent response stored in database for dashboard display (with button support)
```

### Step 2: Check Database
Query the `message_log` table:

```sql
SELECT 
  id,
  message_id,
  agent_id,
  message,
  message_text,
  source,
  sender_type,
  is_from_me,
  created_at
FROM message_log
WHERE agent_id = 'b361a914-18bb-405c-92eb-8afe549ca9e1'
  AND source = 'dashboard'
  AND sender_type = 'agent'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected Result:**
- `source` = `'dashboard'`
- `sender_type` = `'agent'`
- `message` contains the button text
- `is_from_me` = `false`

### Step 3: Check Dashboard UI
1. Open dashboard: `http://localhost:5173`
2. Navigate to the agent chat
3. Look for the message with buttons
4. Verify buttons are rendered below the message
5. Click a button and verify it sends as a new message

---

## Troubleshooting

### Error: "Agent not found"
- Verify agent ID is correct
- Check agent exists in database:
  ```sql
  SELECT id, agent_name FROM agents WHERE id = 'b361a914-18bb-405c-92eb-8afe549ca9e1';
  ```

### Error: "WhatsApp connection lost"
- Agent must be connected to WhatsApp
- Check agent status in dashboard
- Reconnect agent if needed

### Error: "Invalid phone number"
- Phone number must be at least 10 digits
- Format: digits only (no spaces, dashes, etc.)
- Example: `923336906200` ✅ (not `+92 333 6906200` ❌)

### Message Not Appearing in Dashboard
1. **Check database:**
   ```sql
   SELECT * FROM message_log 
   WHERE agent_id = 'b361a914-18bb-405c-92eb-8afe549ca9e1'
   ORDER BY created_at DESC LIMIT 1;
   ```

2. **Verify fields:**
   - `source` = `'dashboard'` ✅
   - `sender_type` = `'agent'` ✅
   - `message` is not null ✅

3. **Refresh dashboard:**
   - Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
   - Check browser console for errors

### Buttons Not Rendering
1. **Check message format:**
   - Must have numbered options: `*1️⃣ Option*` or `*1. Option*`
   - Must be from dashboard agent: `source: 'dashboard'` and `sender_type: 'agent'`

2. **Check browser console:**
   - Open DevTools (F12)
   - Look for errors in Console tab
   - Check if `parseMessageButtons` is working

3. **Verify message structure:**
   ```javascript
   // In browser console on dashboard page
   // Check if buttons are parsed
   import { parseMessageButtons } from '@/utils/messageButtonParser';
   const buttons = parseMessageButtons("*1️⃣ Option 1*\n*2️⃣ Option 2*");
   console.log('Parsed buttons:', buttons);
   ```

---

## Test Message Variations

### Test 1: Basic Buttons
```json
{
  "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
  "to": "923336906200",
  "message": "*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
}
```

### Test 2: With Welcome Text
```json
{
  "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
  "to": "923336906200",
  "message": "👋 Welcome!\n\nPlease select:\n\n*1️⃣ Send Message*\n*2️⃣ Schedule Meeting*\n*3️⃣ View Meetings*"
}
```

### Test 3: With Period Format
```json
{
  "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
  "to": "923336906200",
  "message": "Choose an option:\n\n*1. Option One*\n*2. Option Two*\n*3. Option Three*"
}
```

### Test 4: Maximum Buttons (6)
```json
{
  "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
  "to": "923336906200",
  "message": "Menu:\n\n*1️⃣ One*\n*2️⃣ Two*\n*3️⃣ Three*\n*4️⃣ Four*\n*5️⃣ Five*\n*6️⃣ Six*"
}
```

---

## Quick Test Script

Save as `test-webhook.sh`:

```bash
#!/bin/bash

AGENT_ID="b361a914-18bb-405c-92eb-8afe549ca9e1"
PHONE="923336906200"
MESSAGE="👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
URL="http://localhost:3001/api/webhooks/send-message"

echo "Testing webhook endpoint..."
echo "Agent ID: $AGENT_ID"
echo "Phone: $PHONE"
echo ""

curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"agentId\": \"$AGENT_ID\",
    \"to\": \"$PHONE\",
    \"message\": \"$MESSAGE\"
  }" \
  | jq '.'

echo ""
echo "✅ Test complete! Check dashboard for message with buttons."
```

Run:
```bash
chmod +x test-webhook.sh
./test-webhook.sh
```

---

## Expected Results

### ✅ Success Indicators:
1. **API Response:** `200 OK` with `success: true`
2. **Backend Logs:** Message sent and stored in database
3. **Database:** New row in `message_log` with correct fields
4. **Dashboard:** Message appears with clickable buttons
5. **Button Click:** Sends button text as new message

### ❌ Failure Indicators:
- API returns error (check error message)
- No database entry (check logs for insert error)
- Message appears but no buttons (check message format)
- Buttons appear but don't work (check browser console)

---

## Next Steps After Testing

1. **If successful:**
   - Integrate with your n8n workflow
   - Use the same message format in n8n
   - Test end-to-end flow

2. **If buttons don't appear:**
   - Check message format matches parser requirements
   - Verify `source` and `sender_type` in database
   - Check browser console for errors

3. **If buttons don't work:**
   - Verify `onButtonClick` handler is connected
   - Check message sending endpoint
   - Verify agent is connected

---

## Support

If you encounter issues:
1. Check backend logs for errors
2. Check database for message entry
3. Check browser console for frontend errors
4. Verify agent is connected to WhatsApp
5. Verify message format matches parser requirements

