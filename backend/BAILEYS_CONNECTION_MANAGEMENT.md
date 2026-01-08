# Baileys WhatsApp Connection Management Guide

## 📊 Connection Duration & Maintenance

### How Long Connections Are Maintained

**The connection is maintained indefinitely** as long as:
- ✅ Keepalive packets are sent successfully
- ✅ No disconnection errors occur
- ✅ Network connectivity is stable
- ✅ Credentials remain valid

### Keepalive Mechanism

```javascript
keepAliveIntervalMs: 10000  // Send keepalive every 10 seconds
```

**What this means:**
- Baileys sends a keepalive packet to WhatsApp servers **every 10 seconds**
- This prevents WhatsApp from timing out the connection
- WhatsApp's timeout is typically **15-30 seconds** without activity
- Our 10-second interval ensures we're well within the safe zone

### Connection Monitor

A connection monitor runs **every 15 seconds** to check:

1. **WebSocket State Check** (every 15s)
   - Verifies WebSocket is in `OPEN` state (state = 1)
   - If not open → triggers reconnection after 2 consecutive failures

2. **Pong Response Check** (every 15s)
   - Monitors last pong response from server
   - If no pong in **60 seconds** → triggers reconnection after 3 consecutive failures
   - Sends manual ping to test connection if pong is missing

3. **Activity Check** (every 15s)
   - If inactive for **3 minutes** → sends health check ping
   - Tests connection health without disconnecting

4. **Network Connectivity Test** (every 2 minutes)
   - Tests if `https://web.whatsapp.com` is reachable
   - Doesn't disconnect on failure (network might recover)

---

## 🔌 Disconnection Reasons & How They Happen

### 1. **Error 401 - Unauthorized** ❌ FATAL
**What it means:** Authentication failed or session invalidated

**Causes:**
- Session opened on another device
- Phone number removed from WhatsApp
- Credentials corrupted or expired
- Manual logout from phone

**What happens:**
- Session marked as `conflict` in database
- Credentials cleared (local files + database)
- Requires new QR scan to reconnect
- **5-minute cooldown** before allowing reconnection

**Code:**
```javascript
if (statusCode === 401) {
  // Clear session and credentials
  // Mark as conflict
  // Require new QR scan
}
```

---

### 2. **Error 440 - Stream Conflict** ❌ FATAL
**What it means:** Session was opened elsewhere (another device/app)

**Causes:**
- WhatsApp Web opened on another browser/device
- QR code scanned again on different device
- Multiple instances trying to use same credentials

**What happens:**
- Session marked as `conflict`
- Connection stopped immediately
- Requires manual reconnection
- **No auto-reconnect** (prevents conflicts)

**Code:**
```javascript
if (statusCode === 440) {
  session.connectionState = 'conflict';
  // Stop monitoring
  // Don't auto-reconnect
}
```

---

### 3. **Error 405 - Connection Failure** ⚠️ RECOVERABLE
**What it means:** Connection failed before QR generation

**Causes:**
- Network/firewall blocking WhatsApp servers
- Invalid auth state preventing QR generation
- WhatsApp servers temporarily unavailable

**What happens:**
- Auth directory deleted
- Cleared from active sessions
- User can retry immediately (no cooldown)
- Will generate fresh QR on retry

---

### 4. **Error 428 - Connection Lost** ✅ AUTO-RECOVERABLE
**What it means:** Temporary network issue (recoverable)

**Causes:**
- Network interruption
- Temporary connectivity loss
- Server-side connection reset

**What happens:**
- **Auto-reconnects** with exponential backoff
- Credentials preserved
- Retry delays: 5s → 10s → 20s → 40s → 60s (max)
- Connection restored automatically

**Code:**
```javascript
if (statusCode === 428) {
  // Auto-reconnect with backoff
  // Credentials preserved
  // Exponential backoff: 5s, 10s, 20s, 40s, 60s
}
```

---

### 5. **Error 515 - Stream Errored** ✅ AUTO-RECOVERABLE
**What it means:** Stream error (EXPECTED after QR pairing)

**Causes:**
- Normal after QR code pairing
- Stream needs restart after authentication

**What happens:**
- **Auto-restarts** after 2 seconds
- Uses saved credentials (no new QR needed)
- Connection restored automatically

---

### 6. **Error 500/503 - Server Errors** ✅ AUTO-RECOVERABLE
**What it means:** WhatsApp server issues (temporary)

**Causes:**
- WhatsApp server overload
- Temporary server maintenance
- Rate limiting

**What happens:**
- **Auto-retries** with exponential backoff
- Credentials preserved
- Max 10 retries (500) or 20 retries (408 timeout)
- Connection restored when servers recover

---

### 7. **Network Errors** ✅ AUTO-RECOVERABLE
**What it means:** Local network issues

**Causes:**
- `ECONNRESET` - Connection reset by peer
- `ETIMEDOUT` - Connection timeout
- `ENOTFOUND` - DNS resolution failure
- Internet connectivity loss

**What happens:**
- Connection monitor detects dead connection
- **Auto-reconnects** after 3-5 seconds
- Credentials preserved
- Retries until network recovers

---

### 8. **Manual Disconnect** 🛑 USER-INITIATED
**What it means:** User explicitly disconnected

**Causes:**
- User clicked "Disconnect" button
- `disconnectWhatsApp()` called

**What happens:**
- Session marked as `disconnected` in database
- All credentials cleared
- Connection monitor stopped
- **No auto-reconnect** (user must manually reconnect)
- **No cooldown** - can reconnect immediately

---

### 9. **Bad MAC Error** ❌ FATAL
**What it means:** Session key corruption/desync

**Causes:**
- Encryption key mismatch
- Session state corruption
- Credential desync

**What happens:**
- Credentials cleared
- Requires new QR scan
- Session marked as error

---

## 🔍 How Disconnections Are Detected

### 1. **Connection Update Event**
```javascript
sock.ev.on('connection.update', async (update) => {
  if (update.connection === 'close') {
    // Disconnection detected
    const statusCode = update.lastDisconnect?.error?.output?.statusCode;
    // Handle based on status code
  }
});
```

**Triggers:**
- Immediate detection when WhatsApp closes connection
- Provides status code and error reason
- Most reliable detection method

---

### 2. **Connection Monitor Checks** (Every 15 seconds)

**Check 1: WebSocket State**
```javascript
if (socketReadyState !== 1) { // 1 = OPEN
  // WebSocket closed
  consecutiveFailures++;
  if (consecutiveFailures >= 2) {
    // Trigger reconnection
  }
}
```

**Check 2: Pong Response**
```javascript
if (timeSinceLastPong > 60000) { // 60 seconds
  // No pong response
  consecutiveFailures++;
  if (consecutiveFailures >= 3) {
    // Trigger reconnection
  }
}
```

**Check 3: Activity Check**
```javascript
if (timeSinceLastActivity > 180000) { // 3 minutes
  // Send health check ping
  await sock.ws?.ping?.();
}
```

**Check 4: Network Connectivity**
```javascript
// Every 2 minutes
https.get('https://web.whatsapp.com', (res) => {
  // Network is reachable
});
```

---

### 3. **WebSocket Events**

**Ping/Pong Monitoring:**
```javascript
sock.ws.on('pong', () => {
  lastPong = Date.now();
  consecutiveFailures = 0;
});
```

**WebSocket Close:**
```javascript
sock.ws.on('close', () => {
  // Connection closed
  // Trigger reconnection
});
```

---

## 🔄 Auto-Reconnection Behavior

### Recoverable Errors (Auto-Reconnect)
- ✅ **428** - Connection Lost (exponential backoff)
- ✅ **515** - Stream Errored (2s delay)
- ✅ **500/503** - Server Errors (exponential backoff)
- ✅ **408** - Timeout (exponential backoff, max 20 retries)
- ✅ Network errors (3-5s delay)

### Fatal Errors (Manual Reconnect Required)
- ❌ **401** - Unauthorized (requires new QR)
- ❌ **440** - Stream Conflict (requires manual fix)
- ❌ **405** - Connection Failure (user retry)
- ❌ Bad MAC Error (requires new QR)
- ❌ Manual disconnect (user-initiated)

---

## ⏱️ Timeouts & Intervals

| Component | Interval | Purpose |
|-----------|----------|---------|
| **Keepalive** | 10 seconds | Prevent WhatsApp timeout |
| **Connection Monitor** | 15 seconds | Health checks |
| **Pong Timeout** | 60 seconds | Detect dead connection |
| **Activity Check** | 3 minutes | Test inactive connections |
| **Network Test** | 2 minutes | Verify WhatsApp reachability |
| **QR Timeout** | 3 minutes | QR code validity |
| **Connection Timeout** | 120 seconds | Initial connection timeout |
| **Query Timeout** | 120 seconds | Operation timeout |

---

## 📈 Connection Health Indicators

### Healthy Connection ✅
- WebSocket state = `OPEN` (1)
- Pong received within last 60 seconds
- Recent activity (messages sent/received)
- Connection monitor running
- No consecutive failures

### Unhealthy Connection ⚠️
- WebSocket state ≠ `OPEN`
- No pong in > 60 seconds
- Consecutive failures >= 2
- Network unreachable

### Dead Connection ❌
- WebSocket closed
- No pong in > 60 seconds
- 3+ consecutive failures
- Status code 401/440

---

## 🛡️ Protection Mechanisms

### 1. **Exponential Backoff**
Prevents overwhelming servers with reconnection attempts:
```
Attempt 1: 5 seconds
Attempt 2: 10 seconds
Attempt 3: 20 seconds
Attempt 4: 40 seconds
Attempt 5: 60 seconds (max)
```

### 2. **Cooldown Periods**
- **401 errors**: 5-minute cooldown before allowing reconnection
- **Manual disconnect**: No cooldown (immediate reconnect allowed)

### 3. **Failure Tracking**
- Tracks consecutive failures
- Stops after max failures reached
- Prevents endless retry loops

### 4. **Credential Validation**
- Validates credentials before using
- Rejects stale/corrupted credentials
- Prevents using invalid sessions

---

## 📝 Summary

### Connection Duration
- **Maintained indefinitely** with 10-second keepalive
- **No automatic expiration** (only disconnects on errors)

### Disconnection Causes
1. **Fatal**: 401, 440, Bad MAC → Requires manual reconnection
2. **Recoverable**: 428, 515, 500, 503, Network errors → Auto-reconnects
3. **User-initiated**: Manual disconnect → No auto-reconnect

### Detection Methods
1. **Connection update events** (immediate)
2. **Connection monitor** (every 15 seconds)
3. **WebSocket events** (ping/pong/close)

### Auto-Reconnect
- ✅ Enabled for recoverable errors
- ❌ Disabled for fatal errors
- Uses exponential backoff to prevent spam

---

## 🔧 Configuration

Current settings in `baileysService.js`:
```javascript
keepAliveIntervalMs: 10000,      // 10 seconds
defaultQueryTimeoutMs: 120000,    // 2 minutes
connectTimeoutMs: 120000,         // 2 minutes
qrTimeout: 180000,                // 3 minutes
```

Connection monitor interval: **15 seconds**
Pong timeout: **60 seconds**

