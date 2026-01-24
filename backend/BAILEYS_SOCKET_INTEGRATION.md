# Baileys Socket Integration for Media Processing

## Overview

The media processing system needs access to Baileys socket instances to download media files from WhatsApp. This document explains how to integrate the socket manager with your existing `baileysService.js`.

## Required Changes to baileysService.js

Add these exports at the end of `backend/src/services/baileysService.js`:

```javascript
/**
 * Get session for an agent (for media processing)
 * @param {string} agentId - Agent ID
 * @returns {Object|null} Session object with socket property
 */
function getSessionForAgent(agentId) {
  return activeSessions.get(agentId);
}

/**
 * Get all active agent IDs
 * @returns {Array<string>} List of agent IDs with active sessions
 */
function getActiveAgentIds() {
  return Array.from(activeSessions.keys());
}

// Add to module.exports at the end of the file:
module.exports = {
  // ... existing exports ...
  getSessionForAgent,
  getActiveAgentIds
};
```

## Location in baileysService.js

Find the existing `module.exports` statement (usually near the end of the file) and add:

```javascript
module.exports = {
  // ... all existing exports ...
  getSessionForAgent,
  getActiveAgentIds
};
```

## How It Works

1. **Media Worker** calls `getSocket(agentId)` from `socketManager.js`
2. **Socket Manager** calls `baileysService.getSessionForAgent(agentId)`
3. **Baileys Service** returns the session object from `activeSessions` Map
4. **Socket Manager** extracts `session.socket` and returns it
5. **Media Worker** uses the socket to download media files

## Testing

After adding the exports, test that sockets are accessible:

```javascript
// In a test script or console:
const socketManager = require('./src/utils/socketManager');
const socket = socketManager.getSocket('your-agent-id');
console.log('Socket found:', socket !== null);
```

## Alternative: Direct Access (Not Recommended)

If you prefer not to modify baileysService.js, you can modify `socketManager.js` to access `activeSessions` directly, but this is less maintainable:

```javascript
// In socketManager.js - NOT RECOMMENDED
function getSocket(agentId) {
  // Access internal activeSessions - requires knowledge of internal structure
  const baileysService = require('../services/baileysService');
  // This won't work unless activeSessions is exported
}
```

## Verification

After integration, verify:

1. ✅ `getSessionForAgent()` is exported from baileysService
2. ✅ `socketManager.getSocket()` returns socket instances
3. ✅ Media processing can download files from WhatsApp
4. ✅ Queue jobs complete successfully

## Troubleshooting

### "Socket not found" errors

1. Check that `getSessionForAgent()` is exported
2. Verify agent has active session: `baileysService.getActiveAgentIds()`
3. Check logs for socket connection status
4. Ensure agent is connected before processing media

### Circular dependency warnings

If you see circular dependency warnings:
- Ensure `socketManager.js` requires `baileysService.js` lazily (inside function)
- Don't require `socketManager` in `baileysService.js`
