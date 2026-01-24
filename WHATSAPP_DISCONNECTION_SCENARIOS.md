# WhatsApp Connection Disconnection Scenarios & Resolution Guide

## 📋 Overview

This document outlines common scenarios where WhatsApp connections may disconnect automatically and provides comprehensive resolution strategies for each case.

---

## 🔴 Common Disconnection Scenarios

### 1. **Network Connectivity Issues**

**Scenario:**
- User's internet connection drops temporarily
- Network switch (WiFi to mobile data or vice versa)
- ISP connection interruption
- VPN disconnection

**Detection:**
```javascript
// Baileys fires connection.update with:
{
  connection: 'close',
  lastDisconnect: {
    error: {
      output: { statusCode: 408 }, // Timeout
      message: 'Connection timeout' or 'ECONNRESET'
    }
  }
}
```

**Symptoms:**
- Connection status changes to `disconnected`
- No messages can be sent/received
- Health check fails
- Socket.IO emits `whatsapp:disconnected` event

**Resolution:**
✅ **Automatic (Built-in):**
- Baileys automatically attempts reconnection with exponential backoff
- Credentials are preserved (no QR scan needed)
- Reconnection happens after 2-5 seconds
- Max 10 retry attempts with increasing delays

**Manual Steps (if auto-reconnect fails):**
1. Check internet connectivity
2. Wait 30-60 seconds for automatic reconnection
3. If still disconnected, check backend logs for error details
4. Restart the backend service if network is stable but connection persists

---

### 2. **WhatsApp Server-Side Disconnection**

**Scenario:**
- WhatsApp servers temporarily unavailable
- Server maintenance
- Rate limiting due to too many requests
- Server overload

**Detection:**
```javascript
{
  connection: 'close',
  lastDisconnect: {
    error: {
      output: { statusCode: 500 }, // Server error
      message: 'Internal server error'
    }
  }
}
```

**Symptoms:**
- Multiple agents disconnect simultaneously
- Error 500, 503, or 502 in logs
- Connection closes without network issues

**Resolution:**
✅ **Automatic:**
- System retries with exponential backoff (2s, 4s, 8s, 16s...)
- Max 10 attempts for 500 errors
- Max 20 attempts for 408 timeout errors
- Credentials preserved throughout

**Manual Steps:**
1. Check WhatsApp status page (if available)
2. Wait for server recovery (usually 5-15 minutes)
3. Monitor backend logs for reconnection success
4. If persistent, check for rate limiting (reduce message frequency)

---

### 3. **Session Expired / Logged Out**

**Scenario:**
- User logged out from WhatsApp on another device
- Session expired due to inactivity (rare with Baileys)
- WhatsApp security detected suspicious activity
- Account banned or restricted

**Detection:**
```javascript
{
  connection: 'close',
  lastDisconnect: {
    error: {
      output: { statusCode: DisconnectReason.loggedOut }, // 401
      message: 'Logged out'
    }
  }
}
```

**Symptoms:**
- Status code 401 (logged out)
- Credentials become invalid
- Cannot reconnect automatically
- Requires new QR scan

**Resolution:**
❌ **Cannot Auto-Recover:**
- Credentials are cleared automatically
- User must scan QR code again
- Session marked as `disconnected` in database

**Manual Steps:**
1. Check if user logged out from another device
2. Verify account is not banned/restricted
3. Generate new QR code via frontend
4. User scans QR code to re-authenticate
5. Connection restored after successful pairing

---

### 4. **Multi-Device Conflict**

**Scenario:**
- WhatsApp account connected on multiple devices simultaneously
- Another instance of the same agent running
- Session conflict detected by WhatsApp

**Detection:**
```javascript
{
  connection: 'close',
  lastDisconnect: {
    error: {
      output: { statusCode: DisconnectReason.multideviceMismatch }, // 409
      message: 'Multi-device mismatch'
    }
  }
}
```

**Symptoms:**
- Status code 409 (conflict)
- Connection closes immediately after opening
- Error message mentions "multidevice" or "conflict"
- Session marked as `conflict` in database

**Resolution:**
⚠️ **Requires Manual Intervention:**
1. **Check for duplicate instances:**
   ```bash
   # Check if multiple backend processes are running
   ps aux | grep node
   ```

2. **Verify only one agent instance:**
   - Check database: `SELECT * FROM whatsapp_sessions WHERE agent_id = '...'`
   - Ensure only one `is_active = true` record

3. **Clear conflict state:**
   - Update session status to `disconnected`
   - Clear credentials
   - Generate new QR code

4. **Prevent future conflicts:**
   - Ensure only one backend instance per agent
   - Use instance locking mechanism (already implemented)
   - Check for concurrent initialization

---

### 5. **QR Code Expired / Pairing Timeout**

**Scenario:**
- User didn't scan QR code within 3 minutes
- QR code expired before scanning
- Connection closed during pairing process

**Detection:**
```javascript
{
  connection: 'close',
  lastDisconnect: {
    error: {
      output: { statusCode: 408 }, // Timeout
      message: 'QR code expired'
    }
  }
}
```

**Symptoms:**
- QR code shown but not scanned
- Connection closes after 3 minutes
- Status remains `qr_pending` or changes to `disconnected`

**Resolution:**
✅ **Automatic:**
- System detects QR expiration
- Automatically generates new QR code
- Frontend updates QR display
- User can scan new QR code

**Manual Steps:**
1. Wait for automatic QR refresh (happens every 3 minutes)
2. If QR doesn't refresh, manually trigger:
   ```javascript
   // Frontend: Call reconnect endpoint
   POST /api/whatsapp/reconnect/:agentId
   ```
3. Ensure user scans QR within 3 minutes

---

### 6. **Stream Error After Pairing (Error 515)**

**Scenario:**
- Normal behavior after QR code pairing
- Stream needs restart after authentication
- Expected disconnect after successful pairing

**Detection:**
```javascript
{
  connection: 'close',
  lastDisconnect: {
    error: {
      output: { statusCode: 515 }, // Stream error
      message: 'Stream errored'
    }
  }
}
```

**Symptoms:**
- Occurs immediately after QR scan
- Connection closes but credentials are saved
- Status changes to `reconnecting_after_pairing`

**Resolution:**
✅ **Fully Automatic:**
- System recognizes this as expected behavior
- Auto-reconnects after 2 seconds
- Uses saved credentials (no new QR needed)
- Connection restored automatically
- Status changes to `connected`

**No Action Required:**
- This is normal and expected
- System handles it automatically
- User sees connection restored within 2-5 seconds

---

### 7. **Bad MAC / Encryption Error**

**Scenario:**
- Session key corruption
- Encryption key mismatch
- Credential desync between client and server

**Detection:**
```javascript
{
  connection: 'close',
  lastDisconnect: {
    error: {
      output: { statusCode: DisconnectReason.badSession }, // 500
      message: 'Bad MAC' or 'Session key mismatch'
    }
  }
}
```

**Symptoms:**
- Status code 500 with "Bad MAC" error
- Cannot reconnect with existing credentials
- Connection fails immediately after opening

**Resolution:**
❌ **Requires Credential Reset:**
1. System automatically clears corrupted credentials
2. Session marked as `error` in database
3. User must scan new QR code

**Manual Steps:**
1. Verify credentials are cleared:
   ```sql
   SELECT status FROM whatsapp_sessions WHERE agent_id = '...';
   -- Should be 'error' or 'disconnected'
   ```

2. Generate new QR code
3. User scans QR to re-authenticate
4. New credentials are saved

---

### 8. **Rate Limiting / Too Many Requests**

**Scenario:**
- Sending messages too frequently
- Too many API calls in short time
- WhatsApp rate limiting kicks in

**Detection:**
```javascript
{
  connection: 'close',
  lastDisconnect: {
    error: {
      output: { statusCode: 429 }, // Too many requests
      message: 'Rate limit exceeded'
    }
  }
}
```

**Symptoms:**
- Status code 429
- Connection closes after sending many messages
- Error mentions "rate limit" or "too many requests"

**Resolution:**
✅ **Automatic with Backoff:**
- System waits before reconnecting (exponential backoff)
- Credentials preserved
- Reconnection after delay (5-30 seconds)

**Prevention:**
1. **Implement message throttling:**
   ```javascript
   // Limit to 20 messages per minute per agent
   const MESSAGE_RATE_LIMIT = 20; // per minute
   ```

2. **Add delays between bulk operations:**
   ```javascript
   // Wait 1 second between batches
   await new Promise(resolve => setTimeout(resolve, 1000));
   ```

3. **Monitor message frequency:**
   - Track messages per minute
   - Alert when approaching limits
   - Auto-throttle if needed

---

### 9. **Database Connection Loss**

**Scenario:**
- Supabase/PostgreSQL connection drops
- Database timeout
- Network issue between backend and database

**Detection:**
- Backend logs show database errors
- Session status updates fail
- Health checks fail to update database

**Symptoms:**
- Connection appears active but status not updating
- Database query errors in logs
- `whatsapp_sessions` table not updating

**Resolution:**
⚠️ **Requires Database Recovery:**
1. **Check database connectivity:**
   ```bash
   # Test Supabase connection
   curl https://YOUR_PROJECT.supabase.co/rest/v1/
   ```

2. **Verify database credentials:**
   - Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   - Ensure environment variables are set

3. **Restart backend service:**
   ```bash
   # After database is accessible
   npm restart
   ```

4. **Reconnect agents:**
   - System will attempt to reconnect all active agents
   - Status will sync with database

---

### 10. **Server Restart / Crash**

**Scenario:**
- Backend server restarts
- Process crashes
- Deployment/update causes restart

**Detection:**
- All active sessions disconnect
- Backend logs show restart
- All agents show `disconnected` status

**Symptoms:**
- All WhatsApp connections lost simultaneously
- Backend service unavailable
- Health checks fail

**Resolution:**
✅ **Automatic on Restart:**
- System attempts to restore all active sessions on startup
- Uses saved credentials to reconnect
- No QR scan needed if credentials are valid

**Manual Steps (if auto-restore fails):**
1. **Check backend logs:**
   ```bash
   # Look for reconnection attempts
   grep "reconnect" backend/logs/app.log
   ```

2. **Verify credentials exist:**
   ```bash
   # Check auth directories
   ls -la backend/auth/agents/
   ```

3. **Manually trigger reconnection:**
   ```javascript
   // API endpoint
   POST /api/whatsapp/reconnect/:agentId
   ```

4. **If credentials missing:**
   - Generate new QR codes
   - Users scan to re-authenticate

---

## 🔍 Detection Mechanisms

### 1. **Connection Update Event (Primary)**
```javascript
sock.ev.on('connection.update', async (update) => {
  if (update.connection === 'close') {
    // Disconnection detected immediately
    const statusCode = update.lastDisconnect?.error?.output?.statusCode;
    // Handle based on status code
  }
});
```

### 2. **Health Check Monitor**
```javascript
// Runs every 60 seconds
// Checks if socket is still alive
// Detects silent disconnections
```

### 3. **Database Status Tracking**
```javascript
// Updates whatsapp_sessions table
// Tracks disconnected_at timestamp
// Monitors status changes
```

### 4. **Socket.IO Events**
```javascript
// Frontend receives real-time updates
io.on('whatsapp:disconnected', (data) => {
  // Update UI immediately
});
```

---

## 🛠️ Resolution Strategies by Priority

### **Priority 1: Automatic Recovery (No Action Required)**
- ✅ Network connectivity issues (auto-reconnect)
- ✅ Server errors 500/503 (auto-retry)
- ✅ Stream error 515 (auto-reconnect after pairing)
- ✅ Rate limiting 429 (auto-backoff)
- ✅ Server restart (auto-restore sessions)

### **Priority 2: Automatic with Monitoring**
- ⚠️ QR code expiration (auto-refresh, but monitor)
- ⚠️ Database connection loss (auto-retry, but verify)

### **Priority 3: Manual Intervention Required**
- ❌ Logged out (401) - Requires new QR scan
- ❌ Multi-device conflict (409) - Requires conflict resolution
- ❌ Bad MAC error - Requires credential reset

---

## 📊 Monitoring & Alerts

### **Key Metrics to Monitor:**
1. **Disconnection Rate:**
   - Track disconnections per hour
   - Alert if > 10% of agents disconnect

2. **Reconnection Success Rate:**
   - Track successful auto-reconnections
   - Alert if < 80% success rate

3. **Average Reconnection Time:**
   - Monitor time to reconnect
   - Alert if > 60 seconds

4. **Error Code Distribution:**
   - Track frequency of each error code
   - Alert on unusual patterns

### **Alert Thresholds:**
```javascript
// Example alert configuration
const ALERT_THRESHOLDS = {
  disconnectionRate: 0.10,      // 10% of agents
  reconnectionFailure: 0.20,    // 20% failure rate
  avgReconnectTime: 60000,      // 60 seconds
  error429Frequency: 5          // 5 per hour
};
```

---

## 🔧 Troubleshooting Checklist

When a disconnection occurs, follow this checklist:

### **Step 1: Identify the Error**
- [ ] Check backend logs for error code
- [ ] Identify status code from `lastDisconnect`
- [ ] Note error message

### **Step 2: Check Error Category**
- [ ] **Auto-recoverable?** (408, 500, 503, 515, 429)
  - Wait for automatic reconnection
  - Monitor logs for success
- [ ] **Requires QR scan?** (401, 500 Bad MAC)
  - Generate new QR code
  - User scans to re-authenticate
- [ ] **Conflict?** (409)
  - Check for duplicate instances
  - Resolve conflict
  - Clear and restart

### **Step 3: Verify System Health**
- [ ] Check internet connectivity
- [ ] Verify database connection
- [ ] Check backend service status
- [ ] Review recent deployments

### **Step 4: Monitor Recovery**
- [ ] Watch logs for reconnection attempts
- [ ] Verify status changes to `connected`
- [ ] Test sending/receiving messages
- [ ] Confirm Socket.IO events fire

### **Step 5: Document & Learn**
- [ ] Record error code and resolution
- [ ] Update runbook if new pattern
- [ ] Adjust thresholds if needed

---

## 🚀 Best Practices

### **1. Implement Exponential Backoff**
```javascript
const delays = [2000, 4000, 8000, 16000, 32000]; // 2s, 4s, 8s, 16s, 32s
```

### **2. Preserve Credentials**
- Never delete credentials on temporary disconnects
- Only clear on logged out (401) or bad session (500 Bad MAC)
- Keep credentials for up to 30 minutes after disconnect

### **3. Health Monitoring**
- Implement health checks every 60 seconds
- Track connection state in database
- Emit real-time events to frontend

### **4. Rate Limiting Prevention**
- Limit messages to 20 per minute per agent
- Add delays between bulk operations
- Monitor and throttle automatically

### **5. Graceful Degradation**
- Queue messages during disconnection
- Retry failed messages on reconnect
- Notify users of temporary unavailability

### **6. Logging & Observability**
- Log all disconnection events with context
- Track reconnection success rates
- Monitor error patterns over time

---

## 📝 Example Resolution Flow

### **Scenario: Network Disconnection**

```
1. User's WiFi drops
   ↓
2. Baileys detects connection.close
   ↓
3. System logs: "Connection closed: 408 - Connection timeout"
   ↓
4. Status updated to 'disconnected' in database
   ↓
5. Socket.IO emits 'whatsapp:disconnected' to frontend
   ↓
6. Frontend shows "Disconnected" status
   ↓
7. Auto-reconnection triggered (2 second delay)
   ↓
8. System attempts reconnect with saved credentials
   ↓
9. Connection restored (WiFi reconnected)
   ↓
10. Status updated to 'connected'
    ↓
11. Socket.IO emits 'whatsapp:connected' to frontend
    ↓
12. Frontend shows "Connected" status
    ↓
13. Queued messages sent automatically
```

---

## 🔗 Related Documentation

- `BAILEYS_CONNECTION_MANAGEMENT.md` - Detailed connection management
- `WHATSAPP_SYNC_MECHANISM.md` - Contact/group sync behavior
- Backend logs: `backend/logs/` directory
- Database schema: `supabase/migrations/`

---

## 📞 Support

If disconnections persist after following this guide:

1. **Collect Information:**
   - Error codes from logs
   - Timestamp of disconnection
   - Agent ID
   - Recent system changes

2. **Check System Status:**
   - Backend service health
   - Database connectivity
   - Network connectivity
   - WhatsApp service status

3. **Review Logs:**
   ```bash
   # Recent disconnection events
   grep "Connection closed" backend/logs/app.log | tail -20
   
   # Reconnection attempts
   grep "reconnect" backend/logs/app.log | tail -20
   ```

4. **Escalate if Needed:**
   - Check for known issues
   - Review recent deployments
   - Contact system administrator

---

**Last Updated:** 2025-01-XX  
**Version:** 1.0
