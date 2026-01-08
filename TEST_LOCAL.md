# 🧪 Test Webhook Locally - Quick Start

## Your Test Payload
```json
{
  "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
  "to": "923336906200",
  "message": "👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
}
```

---

## ✅ Easiest Method: Use Existing Test Script

### Option 1: Node.js Script (Recommended)

1. **Navigate to backend folder:**
   ```bash
   cd backend
   ```

2. **Run the test script:**
   ```bash
   node test-webhook-send.js
   ```

   This will use your exact payload automatically!

3. **Or with custom values:**
   ```bash
   node test-webhook-send.js b361a914-18bb-405c-92eb-8afe549ca9e1 923336906200 "👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
   ```

### Option 2: PowerShell Script (Windows)

1. **Run from backend folder:**
   ```powershell
   cd backend
   .\test-webhook.ps1 -AgentId "b361a914-18bb-405c-92eb-8afe549ca9e1" -PhoneNumber "923336906200" -Message "👋 Welcome!`n`n*1️⃣ Option 1*`n*2️⃣ Option 2*`n*3️⃣ Option 3*"
   ```

---

## 🔧 Manual Testing Methods

### Method 1: cURL (Any OS)

**Windows (PowerShell):**
```powershell
curl.exe -X POST http://localhost:3001/api/webhooks/send-message -H "Content-Type: application/json" -d '{\"agentId\": \"b361a914-18bb-405c-92eb-8afe549ca9e1\", \"to\": \"923336906200\", \"message\": \"👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*\"}'
```

**Linux/Mac:**
```bash
curl -X POST http://localhost:3001/api/webhooks/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "b361a914-18bb-405c-92eb-8afe549ca9e1",
    "to": "923336906200",
    "message": "👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*"
  }'
```

### Method 2: Postman

1. **Method:** `POST`
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

### Method 3: Browser Console

Open browser console on `http://localhost:5173` and run:

```javascript
fetch('http://localhost:3001/api/webhooks/send-message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: 'b361a914-18bb-405c-92eb-8afe549ca9e1',
    to: '923336906200',
    message: '👋 Welcome!\n\n*1️⃣ Option 1*\n*2️⃣ Option 2*\n*3️⃣ Option 3*'
  })
})
  .then(r => r.json())
  .then(d => console.log('✅ Success:', d))
  .catch(e => console.error('❌ Error:', e));
```

---

## ✅ Expected Results

### 1. API Response (200 OK)
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

### 2. Backend Logs
Look for these messages in your backend terminal:
```
[WEBHOOK-SEND-MESSAGE][...] ✅ Message sent successfully
[WEBHOOK-SEND-MESSAGE][...] ✅ Agent response stored in database for dashboard display (with button support)
```

### 3. Database Check
The message should be stored in `message_log` table with:
- `source` = `'dashboard'`
- `sender_type` = `'agent'`
- `message` = your button text

### 4. Dashboard Display
1. Open: `http://localhost:5173`
2. Navigate to agent chat
3. You should see:
   - Message: "👋 Welcome!"
   - 3 clickable buttons below:
     - `1️⃣ Option 1`
     - `2️⃣ Option 2`
     - `3️⃣ Option 3`

---

## 🔍 Verification Steps

### Step 1: Check Backend is Running
```bash
# Should see server listening on port 3001
# Look for: "🚀 Backend Server Started Successfully"
```

### Step 2: Check Agent is Connected
- Agent must be connected to WhatsApp
- Check agent status in dashboard

### Step 3: Run Test
```bash
cd backend
node test-webhook-send.js
```

### Step 4: Check Dashboard
- Open `http://localhost:5173`
- Navigate to agent chat
- Look for message with buttons

### Step 5: Test Button Click
- Click a button (e.g., "1️⃣ Option 1")
- Button text should be sent as new message
- Check backend logs for new message

---

## ❌ Troubleshooting

### Error: "Cannot connect"
- **Fix:** Make sure backend is running on port 3001
- **Check:** `http://localhost:3001` should respond

### Error: "Agent not found"
- **Fix:** Verify agent ID is correct
- **Check:** Agent exists in database

### Error: "WhatsApp connection lost"
- **Fix:** Agent must be connected to WhatsApp
- **Check:** Connect agent in dashboard first

### Message not appearing in dashboard
1. **Check database:**
   ```sql
   SELECT * FROM message_log 
   WHERE agent_id = 'b361a914-18bb-405c-92eb-8afe549ca9e1'
   ORDER BY created_at DESC LIMIT 1;
   ```

2. **Verify fields:**
   - `source` = `'dashboard'` ✅
   - `sender_type` = `'agent'` ✅

3. **Refresh dashboard:**
   - Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)

### Buttons not showing
- **Check:** Message format must have `*1️⃣ Option*` pattern
- **Check:** Browser console for errors
- **Verify:** Message has `source: 'dashboard'` and `sender_type: 'agent'`

---

## 🎯 Quick Test Command

**Copy and paste this in your terminal (from backend folder):**

```bash
node test-webhook-send.js
```

That's it! The script uses your exact payload by default.

---

## 📝 Next Steps

1. ✅ Test locally using the script above
2. ✅ Verify message appears in dashboard with buttons
3. ✅ Click a button and verify it sends as new message
4. ✅ Integrate with your n8n workflow using the same format

