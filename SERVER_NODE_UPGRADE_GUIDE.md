# 🚀 Server Node.js Upgrade Guide
## Upgrading from Node v18.19.1 to Node v20

---

## Method 1: Using NVM (Node Version Manager) - **RECOMMENDED**

### Step 1: Check Current Version
```bash
node --version
# Should show: v18.19.1
```

### Step 2: Install NVM (if not already installed)
```bash
# Download and install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reload shell configuration
source ~/.bashrc
# OR if using zsh:
source ~/.zshrc

# Verify nvm is installed
nvm --version
```

### Step 3: Install Node.js 20 LTS
```bash
# Install Node 20 LTS (latest stable)
nvm install 20

# Or install specific version
nvm install 20.18.0

# Set Node 20 as default
nvm alias default 20

# Verify installation
node --version
# Should show: v20.x.x

npm --version
```

### Step 4: Update PM2 to Use New Node Version
```bash
# Stop current PM2 process
pm2 stop pa-agent-backend

# Delete old process
pm2 delete pa-agent-backend

# Kill PM2 daemon (to restart with new Node version)
pm2 kill

# Restart PM2 with new Node version
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Verify PM2 is using correct Node version
pm2 info pa-agent-backend | grep node
```

### Step 5: Verify Everything Works
```bash
# Check Node version in PM2
pm2 logs pa-agent-backend --lines 20

# Check for deprecation warnings (should be gone)
# Look for: "Node.js 18 and below are deprecated" - should NOT appear

# Monitor application
pm2 monit
```

---

## Method 2: Using NodeSource Repository (Alternative)

### Step 1: Remove Old Node.js
```bash
# Remove old Node.js (if installed via apt)
sudo apt-get remove nodejs npm

# Clean up
sudo apt-get autoremove
```

### Step 2: Install Node.js 20 from NodeSource
```bash
# Add NodeSource repository for Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js 20
sudo apt-get install -y nodejs

# Verify installation
node --version
# Should show: v20.x.x

npm --version
```

### Step 3: Update PM2
```bash
# Stop and restart PM2
pm2 stop pa-agent-backend
pm2 delete pa-agent-backend
pm2 kill

# Restart with new Node version
pm2 start ecosystem.config.js
pm2 save
```

---

## Method 3: Using Binary Installation (If above methods don't work)

### Step 1: Download Node.js 20 Binary
```bash
# Go to home directory
cd ~

# Download Node.js 20 LTS binary (Linux x64)
wget https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz

# Extract
tar -xf node-v20.18.0-linux-x64.tar.xz

# Move to /usr/local
sudo mv node-v20.18.0-linux-x64 /usr/local/node-v20

# Create symlinks
sudo ln -sf /usr/local/node-v20/bin/node /usr/local/bin/node
sudo ln -sf /usr/local/node-v20/bin/npm /usr/local/bin/npm
sudo ln -sf /usr/local/node-v20/bin/npx /usr/local/bin/npx

# Verify
node --version
npm --version
```

---

## Post-Upgrade Checklist

- [ ] Node version is v20.x.x
- [ ] npm version is updated
- [ ] PM2 restarted with new Node version
- [ ] Application starts without errors
- [ ] No deprecation warnings in logs
- [ ] All services working correctly
- [ ] PM2 configuration saved

---

## Troubleshooting

### Issue: PM2 still using old Node version
```bash
# Solution: Kill PM2 and restart
pm2 kill
pm2 start ecosystem.config.js
pm2 save
```

### Issue: npm packages need reinstalling
```bash
# Reinstall dependencies
cd /root/pagent/backend
rm -rf node_modules package-lock.json
npm install
```

### Issue: Permission errors
```bash
# Fix npm permissions (if needed)
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules
```

### Issue: PATH not updated
```bash
# Add to ~/.bashrc or ~/.zshrc
export PATH="/usr/local/bin:$PATH"
source ~/.bashrc
```

---

## Rollback Plan (If Something Goes Wrong)

If you need to rollback to Node 18:

```bash
# Using NVM
nvm install 18.19.1
nvm use 18.19.1
nvm alias default 18.19.1

# Restart PM2
pm2 kill
pm2 start ecosystem.config.js
pm2 save
```

---

## Expected Results After Upgrade

✅ **Before (Node 18.19.1):**
```
⚠️  Node.js 18 and below are deprecated and will no longer be supported
```

✅ **After (Node 20+):**
```
✅ No deprecation warnings
✅ Better performance
✅ Full compatibility with all dependencies
```

