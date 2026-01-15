# Install Node.js v18.19.1 and Run Servers

## Step 1: Install Node.js v18.19.1

**Option A: Using the downloaded MSI (requires Admin)**
1. Open PowerShell as Administrator
2. Run:
   ```powershell
   msiexec /i "C:\Users\SAMCLI~1\AppData\Local\Temp\node-v18.19.1-x64.msi" /quiet /norestart
   ```
3. Or double-click the MSI file: `C:\Users\SAMCLI~1\AppData\Local\Temp\node-v18.19.1-x64.msi`

**Option B: Download fresh**
1. Download from: https://nodejs.org/dist/v18.19.1/node-v18.19.1-x64.msi
2. Run the installer as Administrator

**Option C: Using nvm-windows (if installed)**
```powershell
nvm install 18.19.1
nvm use 18.19.1
```

## Step 2: Verify Installation

```powershell
node --version
# Should show: v18.19.1
```

## Step 3: Run Servers

**Backend:**
```powershell
cd backend
node app.js
```

**Frontend (in a new terminal):**
```powershell
cd frontend
npm run dev
```

Or use the provided scripts:
- `backend/start-node18.ps1`
- `frontend/start-node18.ps1`

