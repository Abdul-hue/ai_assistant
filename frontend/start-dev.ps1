# Frontend Development Server Startup Script
# Uses full path to node.exe to avoid permission issues

$nodePath = "C:\nvm4w\nodejs\node.exe"
$npmPath = "C:\nvm4w\nodejs\npm.cmd"

if (Test-Path $nodePath) {
    Write-Host "Starting frontend dev server..." -ForegroundColor Green
    # Add node to PATH for this session
    $env:PATH = "C:\nvm4w\nodejs;$env:PATH"
    # Use npm to run vite (handles Windows properly)
    & $npmPath run dev
} else {
    Write-Host "Node.js not found at $nodePath" -ForegroundColor Red
    Write-Host "Please update the path in this script" -ForegroundColor Yellow
}

