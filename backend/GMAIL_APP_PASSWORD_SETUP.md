# Gmail App Password Setup Guide

## Why Gmail Requires App Passwords

Gmail no longer allows regular account passwords for IMAP/SMTP access. You must use either:
1. **OAuth2** (not yet implemented in this app)
2. **App Password** (recommended for now)

## How to Create a Gmail App Password

### Step 1: Enable 2-Step Verification

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Under "Signing in to Google", click **2-Step Verification**
3. Follow the prompts to enable 2-Step Verification (if not already enabled)

### Step 2: Create an App Password

1. Go back to [Google Account Security](https://myaccount.google.com/security)
2. Under "Signing in to Google", click **App passwords**
   - If you don't see this option, make sure 2-Step Verification is enabled
3. Select **Mail** as the app
4. Select **Other (Custom name)** as the device
5. Enter a name like "PA Agent Email Client"
6. Click **Generate**
7. **Copy the 16-character password** (it will look like: `abcd efgh ijkl mnop`)

### Step 3: Use the App Password

When connecting your Gmail account in this app:
- **Email**: Your Gmail address (e.g., `yourname@gmail.com`)
- **IMAP Password**: The 16-character App Password (remove spaces: `abcdefghijklmnop`)
- **SMTP Password**: The same 16-character App Password

**Important**: 
- Do NOT use your regular Gmail password
- The App Password is 16 characters with no spaces
- You can create multiple App Passwords for different devices/apps
- If you lose the password, you'll need to create a new one

## Troubleshooting

### Error: "Connection ended unexpectedly"
- **Cause**: Using regular password instead of App Password
- **Solution**: Create and use an App Password (see steps above)

### Error: "Authentication failed"
- **Cause**: Invalid App Password or 2-Step Verification not enabled
- **Solution**: 
  1. Verify 2-Step Verification is enabled
  2. Create a new App Password
  3. Make sure you're using the full 16-character password (no spaces)

### Error: "App passwords" option not visible
- **Cause**: 2-Step Verification is not enabled
- **Solution**: Enable 2-Step Verification first (see Step 1)

## Security Notes

- App Passwords are more secure than regular passwords
- Each App Password is unique and can be revoked independently
- If you suspect an App Password is compromised, revoke it and create a new one
- App Passwords bypass 2-Step Verification for that specific app only

## Additional Resources

- [Google Support: App Passwords](https://support.google.com/accounts/answer/185833)
- [Google Account Security](https://myaccount.google.com/security)

