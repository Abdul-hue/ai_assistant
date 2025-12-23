# IMAP Email Sync Authentication Failures - Fix Implementation

## Problem Description

IMAP email synchronization was failing with "Not authenticated" errors when trying to open folders:

```
[RETRY] Opening folder [Gmail]/Spam failed after 3 retries: Not authenticated
[RETRY] Opening folder [Gmail]/Important failed after 3 retries: Not authenticated
[RETRY] Opening folder [Gmail]/Sent Mail failed after 3 retries: Not authenticated
```

## Root Causes Identified

1. **IMAP Connection Expired** - Connections were being reused after they became stale/expired
2. **No Connection Health Check** - System didn't verify authentication before folder operations
3. **No Auto-Reconnection** - Lost connections weren't automatically reconnected
4. **Connection Pool Not Checking Auth State** - Pool only checked basic connection state, not authentication

## Fixes Implemented

### 1. Added Connection Health Check Function
**Location:** `backend/src/services/imapEmailSyncService.js`

**Function:** `isConnectionHealthy(connection)`
- Checks if connection is in `authenticated` state
- Performs lightweight operation (`getBoxes()`) to verify authentication
- Detects authentication errors and returns `false` if connection is not authenticated

### 2. Implemented Auto-Reconnection
**Location:** `backend/src/services/imapEmailSyncService.js`

**Function:** `ensureHealthyConnection(accountId, account)`
- Checks if existing connection is healthy
- Automatically reconnects if connection is unhealthy
- Uses connection pool to manage connections
- Verifies new connection is authenticated before returning

### 3. Enhanced syncFolder Function
**Location:** `backend/src/services/imapEmailSyncService.js`

**Changes:**
- Added `account` parameter to function signature
- Calls `ensureHealthyConnection()` before folder operations
- Re-verifies connection health before each retry
- Handles authentication errors by reconnecting
- Clears connection and marks account for reconnection on auth failures

### 4. Enhanced Connection Pool
**Location:** `backend/src/utils/imapConnectionPool.js`

**Changes:**
- Updated `isConnectionAlive()` to check IMAP authentication state
- Added `isConnectionHealthy()` async function for deeper health checks
- Verifies connection state is `authenticated` before considering it alive

### 5. Added Authentication Error Handling
**Location:** `backend/src/services/imapEmailSyncService.js`

**Changes:**
- Detects "Not authenticated" errors in multiple places:
  - `syncFolder()` - when opening folders
  - `syncFolder()` - when searching messages
  - `syncAccountFolders()` - when syncing account
  - `syncAllImapAccounts()` - when connecting
- Automatically clears connections on auth errors
- Marks accounts as `needs_reconnection` in database
- Logs authentication failures for debugging

### 6. Added Periodic Connection Cleanup
**Location:** `backend/src/services/imapEmailSyncService.js`

**Function:** `startConnectionCleanup()`
- Runs every 5 minutes
- Checks connection health for all active accounts
- Logs connection statistics
- Helps identify stale connections

## Key Implementation Details

### Connection Health Check
```javascript
async function isConnectionHealthy(connection) {
  // Check IMAP state
  if (connection.imap.state !== 'authenticated') {
    return false;
  }
  
  // Verify with lightweight operation
  await connection.getBoxes();
  return true;
}
```

### Auto-Reconnection
```javascript
async function ensureHealthyConnection(accountId, account) {
  // Get connection from pool
  let connection = await connectionPool.getConnection(...);
  
  // Check health
  if (!(await isConnectionHealthy(connection))) {
    // Close old connection
    connectionPool.closeAccountConnections(accountId);
    
    // Create new connection
    connection = await connectionPool.getConnection(...);
    
    // Verify new connection
    if (!(await isConnectionHealthy(connection))) {
      throw new Error('New IMAP connection is not authenticated');
    }
  }
  
  return connection;
}
```

### Error Handling in syncFolder
```javascript
// Before opening folder
connection = await ensureHealthyConnection(accountId, account);

// In retry logic
const box = await retryWithBackoff(async () => {
  // Re-verify connection health before each retry
  if (!(await isConnectionHealthy(connection))) {
    connection = await ensureHealthyConnection(accountId, account);
  }
  
  try {
    return await connection.openBox(folderName, false);
  } catch (error) {
    // Handle authentication errors
    if (error.message?.includes('Not authenticated')) {
      connection = await ensureHealthyConnection(accountId, account);
      return await connection.openBox(folderName, false);
    }
    throw error;
  }
});
```

## Expected Behavior After Fix

### Before Fix:
- ❌ "Not authenticated" errors when opening folders
- ❌ Failed retries without reconnection
- ❌ Sync stops working after connection expires
- ❌ No automatic recovery

### After Fix:
- ✅ Auto-detects authentication issues
- ✅ Automatically reconnects when needed
- ✅ Verifies connection health before operations
- ✅ Handles authentication errors gracefully
- ✅ Marks accounts for reconnection on persistent failures
- ✅ All folders sync successfully

## Testing Checklist

- [x] IMAP connections establish successfully
- [x] Connection health checks work correctly
- [x] Expired connections are auto-reconnected
- [x] All Gmail folders sync without "Not authenticated" errors
- [x] Connection health checks run before operations
- [x] Authentication errors trigger reconnection
- [x] Accounts are marked for reconnection on persistent failures
- [x] Periodic cleanup task runs correctly

## Files Modified

1. **backend/src/services/imapEmailSyncService.js**
   - Added `isConnectionHealthy()` function
   - Added `ensureHealthyConnection()` function
   - Enhanced `syncFolder()` with health checks
   - Added authentication error handling throughout
   - Added periodic connection cleanup task

2. **backend/src/utils/imapConnectionPool.js**
   - Enhanced `isConnectionAlive()` to check auth state
   - Added `isConnectionHealthy()` async function

## Configuration

- **Connection Health Check Interval:** 5 minutes
- **Retry Attempts:** 3 retries with exponential backoff
- **Connection Timeout:** 30 minutes (existing)

## Notes

- The fix maintains backward compatibility with existing code
- Connection pool continues to manage connection lifecycle
- Health checks are lightweight and don't impact performance significantly
- Authentication errors are logged for debugging
- Accounts are automatically marked for reconnection on persistent failures

