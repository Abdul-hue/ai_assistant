# Frontend Server Startup Script
# Automatically detects Node.js from PATH, NVM, or common locations

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting Frontend Server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Try to find Node.js
$nodePath = $null
$nodeVersion = $null

# Method 1: Check if node is in PATH (works with NVM)
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        $nodePath = "node"
        Write-Host "✅ Found Node.js in PATH: $nodeVersion" -ForegroundColor Green
    }
} catch {
    # Node not in PATH, continue to other methods
}

# Method 2: Check NVM symlink location
if (-not $nodePath) {
    $nvmPaths = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe"
    )
    
    foreach ($path in $nvmPaths) {
        if (Test-Path $path) {
            try {
                $version = & $path --version
                $nodePath = $path
                $nodeVersion = $version
                Write-Host "✅ Found Node.js at: $path" -ForegroundColor Green
                Write-Host "   Version: $version" -ForegroundColor Gray
                break
            } catch {
                continue
            }
        }
    }
}

# Method 3: Check nvm4w location (fallback)
if (-not $nodePath) {
    $nvm4wPath = "C:\nvm4w\nodejs\node.exe"
    if (Test-Path $nvm4wPath) {
        try {
            $version = & $nvm4wPath --version
            $nodePath = $nvm4wPath
            $nodeVersion = $version
            Write-Host "✅ Found Node.js at: $nvm4wPath" -ForegroundColor Green
            Write-Host "   Version: $version" -ForegroundColor Gray
        } catch {
            # Continue to error
        }
    }
}

# If still not found, show error
if (-not $nodePath) {
    Write-Host "❌ Node.js not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Node.js or use NVM:" -ForegroundColor Yellow
    Write-Host "  1. Install NVM: https://github.com/coreybutler/nvm-windows/releases" -ForegroundColor White
    Write-Host "  2. Then run: nvm install 18.19.1" -ForegroundColor White
    Write-Host "  3. Then run: nvm use 18.19.1" -ForegroundColor White
    Write-Host ""
    Write-Host "Or download Node.js directly:" -ForegroundColor Yellow
    Write-Host "  https://nodejs.org/dist/v18.19.1/node-v18.19.1-x64.msi" -ForegroundColor White
    Write-Host ""
    exit 1
}

# Check if we're in the right directory
if (-not (Test-Path "frontend\node_modules\vite")) {
    if (Test-Path "node_modules\vite") {
        # Already in frontend directory
        $frontendDir = "."
    } else {
        # Need to navigate to frontend
        $frontendDir = "frontend"
    }
} else {
    $frontendDir = "frontend"
}

Write-Host ""
Write-Host "Server Configuration:" -ForegroundColor Yellow
Write-Host "  Node.js: $nodeVersion" -ForegroundColor Gray
Write-Host "  Port: 5173" -ForegroundColor Gray
Write-Host "  Directory: $frontendDir" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

Set-Location $frontendDir

# Use direct path to vite.js to avoid shell script issues
if ($nodePath -eq "node") {
    & node node_modules\vite\bin\vite.js
} else {
    & $nodePath node_modules\vite\bin\vite.js
}

