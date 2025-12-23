# Outlook Implementation - Quick Reference

## Where to Find Outlook Code

### 1. Provider Detection (Lines 25-47 in imapSmtpService.js)

```javascript
'outlook.com': {
  provider: 'outlook',
  imap: { host: 'outlook.office365.com', port: 993, ssl: true },
  smtp: { host: 'smtp-mail.outlook.com', port: 587, tls: true },
  note: 'For Outlook.com: Use your regular password...'
},
'hotmail.com': {
  provider: 'outlook',
  imap: { host: 'outlook.office365.com', port: 993, ssl: true },
  smtp: { host: 'smtp-mail.outlook.com', port: 587, tls: true },
  ...
},
'live.com': { ... },
'msn.com': { ... }
```

### 2. Helper Functions (Lines 74-148 in imapSmtpService.js)

```javascript
// Line 77
function isOutlookAccount(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  const outlookDomains = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'];
  return outlookDomains.includes(domain) || domain?.includes('onmicrosoft.com');
}

// Line 87
function isMicrosoft365Account(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain?.includes('onmicrosoft.com') || 
         (!['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain) && 
          domain?.includes('office365.com'));
}

// Line 98
function getOutlookAuthError(error) {
  // Returns Outlook-specific error messages with troubleshooting steps
}
```

### 3. IMAP Connection Test (Lines 160-193 in imapSmtpService.js)

```javascript
// Line 162
const isOutlook = isOutlookAccount(config.username || config.email) || 
                  config.host?.includes('office365.com') || 
                  config.host?.includes('outlook');

// Line 163
const authTimeout = isGmail ? 20000 : (isOutlook ? 30000 : 15000);
const connTimeout = isGmail ? 30000 : (isOutlook ? 30000 : 20000);

// Line 191
keepalive: (isGmail || isOutlook) ? {
  interval: 10000,
  idleInterval: isOutlook ? 120000 : 300000, // 2 min for Outlook
  forceNoop: true
} : false
```

### 4. SMTP Connection Test (Lines 349-404 in imapSmtpService.js)

```javascript
// Line 349
const isOutlook = isOutlookAccount(config.username || config.email) || 
                  config.host?.includes('outlook') || 
                  config.host?.includes('office365');

// Line 352-355
let smtpHost = config.host;
if (isOutlook && !smtpHost) {
  smtpHost = isM365 ? 'smtp.office365.com' : 'smtp-mail.outlook.com';
}

// Line 362
requireTLS: isOutlook ? true : undefined,

// Line 369-370
tls: {
  minVersion: isOutlook ? 'TLSv1.2' : undefined,
  servername: isOutlook ? (smtpHost || config.host) : undefined
}
```

### 5. Send Email Function (Lines 1064-1091 in imapSmtpService.js)

```javascript
// Line 1065
const isOutlook = isOutlookAccount(account.email) || account.provider === 'outlook';

// Line 1070-1071
if (isOutlook && !smtpHost) {
  smtpHost = isM365 ? 'smtp.office365.com' : 'smtp-mail.outlook.com';
}

// Line 1079
requireTLS: isOutlook ? true : undefined,
```

### 6. Folder Handling (Lines 1199-1284 in imapSmtpService.js)

```javascript
// Line 1200
const isOutlook = isOutlookAccount(account.email) || account.provider === 'outlook';

// Line 1208-1221
function normalizeOutlookFolderName(name) {
  if (!isOutlook) return name;
  const normalizations = {
    'Sent Items': 'Sent',
    'Deleted Items': 'Trash',
    'Junk Email': 'Spam',
    'Drafts': 'Drafts',
    'Archive': 'Archive',
  };
  return normalizations[name] || name;
}
```

### 7. Connection Pool (imapConnectionPool.js)

```javascript
// Line 20-25
this.providerMaxConnections = {
  'gmail': 5,
  'outlook': 10, // Outlook allows more concurrent connections
  'custom': 5
};

// Line 30-33
getMaxConnections(accountId) {
  const provider = this.accountProviders.get(accountId) || 'custom';
  return this.providerMaxConnections[provider] || this.defaultMaxConnections;
}
```

### 8. API Routes (imapSmtp.js)

```javascript
// Line 112
const finalProvider = provider || detectedSettings?.provider || 'custom';

// Line 175-179
} else if (imapTest.isOutlook || finalProvider === 'outlook' || 
           email?.match(/@(outlook|hotmail|live|msn)\.com/)) {
  response.suggestion = imapTest.suggestion || detectedSettings?.note || '...';
  response.helpUrl = imapTest.helpUrl || 'https://support.microsoft.com/...';
  response.isOutlook = true;
}
```

### 9. Frontend (imapSmtpApi.ts)

```typescript
// Line 95-125
export const getProviderGuidance = (provider: string): ProviderGuidance | null => {
  if (provider === 'outlook') {
    return {
      title: 'Outlook/Microsoft 365 Setup',
      steps: [
        'Use your full email address as username',
        'If 2FA is enabled, create an App Password',
        'Enable IMAP in Outlook settings',
        'For Microsoft 365: Check with IT if needed',
      ],
      links: {
        settings: 'https://outlook.live.com/mail/0/options/mail/accounts',
        appPassword: 'https://account.microsoft.com/security',
        help: 'https://support.microsoft.com/...',
      },
    };
  }
  ...
}
```

## How to Test

1. **Try connecting an Outlook account:**
   - Use email: `test@outlook.com` or `test@hotmail.com`
   - The system will auto-detect it as Outlook
   - Check the console logs for "Outlook" mentions

2. **Check the database:**
   ```sql
   SELECT email, provider FROM email_accounts WHERE provider = 'outlook';
   ```

3. **Test API endpoint:**
   ```bash
   GET /api/imap-smtp/detect/test@outlook.com
   ```
   Should return:
   ```json
   {
     "success": true,
     "settings": {
       "provider": "outlook",
       "imap": { "host": "outlook.office365.com", ... },
       "smtp": { "host": "smtp-mail.outlook.com", ... }
     }
   }
   ```

## Verification Commands

### Check if Outlook functions exist:
```bash
# In PowerShell
Select-String -Path "backend/src/services/imapSmtpService.js" -Pattern "isOutlookAccount|getOutlookAuthError"
```

### Count Outlook references:
```bash
Select-String -Path "backend/src/services/imapSmtpService.js" -Pattern "outlook" -CaseSensitive:$false | Measure-Object
```

## Summary

All Outlook implementation is in these files:
- ✅ `backend/src/services/imapSmtpService.js` - Main service with Outlook functions
- ✅ `backend/src/utils/imapConnectionPool.js` - Connection pool with Outlook limits
- ✅ `backend/src/utils/imapRetry.js` - Retry logic with Outlook throttling
- ✅ `backend/src/routes/imapSmtp.js` - API routes with Outlook handling
- ✅ `frontend/src/lib/imapSmtpApi.ts` - Frontend API with Outlook guidance

The code is there and ready to use! Try connecting an Outlook account to see it in action.

