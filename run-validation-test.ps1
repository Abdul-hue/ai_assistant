# Complete Test Runner - Starts backend if needed and runs validation test

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "WhatsApp Validation Test Runner" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if backend is running
Write-Host "Checking if backend server is running..." -ForegroundColor Yellow
$backendRunning = $false
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/webhooks/send-message/test" -Method GET -TimeoutSec 3 -ErrorAction Stop
    $backendRunning = $true
    Write-Host "✅ Backend server is already running" -ForegroundColor Green
} catch {
    Write-Host "❌ Backend server is not running" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please start the backend server in a separate terminal:" -ForegroundColor Yellow
    Write-Host "  1. Open a new PowerShell window" -ForegroundColor White
    Write-Host "  2. cd backend" -ForegroundColor White
    Write-Host "  3. node app.js" -ForegroundColor White
    Write-Host "     OR: .\start-node18.ps1 (if Node 18.19.1 is installed)" -ForegroundColor White
    Write-Host ""
    Write-Host "Then press any key to continue with the test..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

Write-Host ""
Write-Host "Running validation test..." -ForegroundColor Cyan
Write-Host ""

# Run the test
powershell -ExecutionPolicy Bypass -File ".\test-whatsapp-validation-simple.ps1"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

