# Quick Start Guide - Run Frontend & Backend

## Simple Commands to Run Servers

### Option 1: Use the Startup Scripts (Recommended)

**Start Backend:**
```powershell
.\start-backend.ps1
```

**Start Frontend (in another terminal):**
```powershell
.\start-frontend.ps1
```

**Start Both at Once:**
```powershell
.\start-both.ps1
```

---

### Option 2: Manual Commands

**If you have Node.js in PATH (via NVM or direct install):**

**Backend:**
```powershell
cd backend
node app.js
```

**Frontend:**
```powershell
cd frontend
npm run dev
```

---

### Option 3: Using NVM (If Installed)

**First, switch to Node 18.19.1:**
```powershell
nvm use 18.19.1
```

**Then start servers:**
```powershell
# Backend
cd backend
node app.js

# Frontend (in another terminal)
cd frontend
npm run dev
```

---

## Troubleshooting

### "Node.js not found" Error

**Solution 1: Install NVM for Windows**
1. Download: https://github.com/coreybutler/nvm-windows/releases
2. Install `nvm-setup.exe` as Administrator
3. Run:
   ```powershell
   nvm install 18.19.1
   nvm use 18.19.1
   ```

**Solution 2: Install Node.js Directly**
1. Download: https://nodejs.org/dist/v18.19.1/node-v18.19.1-x64.msi
2. Run installer as Administrator
3. Restart PowerShell

### Permission Errors (EPERM)

The startup scripts automatically handle this by finding Node.js in different locations. If you still get errors:

1. **Use the startup scripts** (they handle paths automatically)
2. **Or run PowerShell as Administrator**

### Port Already in Use

**Backend (port 3001):**
```powershell
# Find what's using port 3001
Get-NetTCPConnection -LocalPort 3001

# Kill the process (replace PID with actual process ID)
Stop-Process -Id <PID> -Force
```

**Frontend (port 5173):**
```powershell
# Find what's using port 5173
Get-NetTCPConnection -LocalPort 5173

# Kill the process
Stop-Process -Id <PID> -Force
```

---

## Verify Everything Works

1. **Check Node version:**
   ```powershell
   node --version
   # Should show: v18.19.1 (or at least v18.x.x)
   ```

2. **Backend should show:**
   ```
   🚀 Backend Server Started Successfully
   📍 Port: 3001
   ```

3. **Frontend should show:**
   ```
   VITE v5.x.x  ready in xxx ms
   ➜  Local:   http://localhost:5173/
   ```

4. **Access:**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001

---

## Recommended Workflow

1. **Open two PowerShell terminals**

2. **Terminal 1 - Backend:**
   ```powershell
   cd "C:\Users\Sam Cliff\Downloads\pa-agent"
   .\start-backend.ps1
   ```

3. **Terminal 2 - Frontend:**
   ```powershell
   cd "C:\Users\Sam Cliff\Downloads\pa-agent"
   .\start-frontend.ps1
   ```

4. **Or use the combined script:**
   ```powershell
   .\start-both.ps1
   ```
   (Opens both in separate windows)

---

## Notes

- The startup scripts automatically detect Node.js from:
  - PATH (if using NVM)
  - Program Files (NVM symlink)
  - nvm4w location (fallback)
- They show the Node.js version being used
- They handle directory navigation automatically
- No need to manually set paths

