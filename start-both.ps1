# Start Both Servers Script
# Opens two PowerShell windows - one for backend, one for frontend

$nodePath = "C:\nvm4w\nodejs\node.exe"
$projectRoot = $PSScriptRoot

if (-not (Test-Path $nodePath)) {
    Write-Host "❌ Node.js not found at: $nodePath" -ForegroundColor Red
    Write-Host "Please update the nodePath variable in this script" -ForegroundColor Yellow
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting Both Servers" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Start Backend in new window
Write-Host "Starting backend server in new window..." -ForegroundColor Yellow
$backendScript = @"
`$nodePath = '$nodePath'
Set-Location '$projectRoot\backend'
Write-Host 'Backend Server Starting...' -ForegroundColor Green
Write-Host 'Port: 3001' -ForegroundColor Gray
Write-Host 'Press Ctrl+C to stop' -ForegroundColor Yellow
Write-Host ''
& `$nodePath app.js
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendScript

Start-Sleep -Seconds 2

# Start Frontend in new window
Write-Host "Starting frontend server in new window..." -ForegroundColor Yellow
$frontendScript = @"
`$nodePath = '$nodePath'
Set-Location '$projectRoot\frontend'
Write-Host 'Frontend Server Starting...' -ForegroundColor Green
Write-Host 'Port: 5173' -ForegroundColor Gray
Write-Host 'Press Ctrl+C to stop' -ForegroundColor Yellow
Write-Host ''
& `$nodePath node_modules\vite\bin\vite.js
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendScript

Write-Host ""
Write-Host "✅ Both servers are starting in separate windows" -ForegroundColor Green
Write-Host ""
Write-Host "Backend: http://localhost:3001" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "Close the windows or press Ctrl+C in each to stop the servers" -ForegroundColor Yellow



