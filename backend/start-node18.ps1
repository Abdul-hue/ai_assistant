# Backend Startup Script for Node.js v18.19.1
# This script will find and use Node.js v18.19.1 if installed

$nodePaths = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "C:\Program Files\nodejs\node.exe",
    "C:\nvm4w\nodejs-v18.19.1\node-v18.19.1-win-x64\node.exe"
)

$nodePath = $null
foreach ($path in $nodePaths) {
    if (Test-Path $path) {
        $version = & $path --version
        if ($version -match "v18\.19\.1") {
            $nodePath = $path
            Write-Host "Found Node.js v18.19.1 at: $path" -ForegroundColor Green
            break
        }
    }
}

# Also try checking PATH
if (-not $nodePath) {
    try {
        $version = node --version
        if ($version -match "v18\.19\.1") {
            $nodePath = "node"
            Write-Host "Using Node.js v18.19.1 from PATH" -ForegroundColor Green
        }
    } catch {
        # Node not in PATH
    }
}

if ($nodePath) {
    Write-Host "Starting backend with Node.js v18.19.1..." -ForegroundColor Cyan
    & $nodePath app.js
} else {
    Write-Host "Node.js v18.19.1 not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Node.js v18.19.1:" -ForegroundColor Yellow
    Write-Host "1. Download: https://nodejs.org/dist/v18.19.1/node-v18.19.1-x64.msi" -ForegroundColor White
    Write-Host "2. Run installer as Administrator" -ForegroundColor White
    Write-Host "3. Or use: nvm install 18.19.1" -ForegroundColor White
    Write-Host ""
    Write-Host "See INSTALL_NODE18.md for detailed instructions" -ForegroundColor Cyan
}

