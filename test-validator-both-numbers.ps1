# WhatsApp Validator Test - Both Numbers
# Tests validation for sending from 923336906200 to 923336906200 (same number)
# Also tests sending from 923336906200 to 923047001463 (different number)

param(
    [string]$BackendUrl = "http://localhost:3001",
    [string]$AgentId = "b361a914-18bb-405c-92eb-8afe549ca9e1",
    [string]$FromNumber = "923336906200",
    [string]$ToNumber1 = "923336906200",  # Same number
    [string]$ToNumber2 = "923047001463",  # Different number
    [string]$Message = "Test message - Validator test"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "WhatsApp Validator Test - Both Numbers" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if backend is running
Write-Host "Checking backend server..." -ForegroundColor Yellow
try {
    $testResponse = Invoke-WebRequest -Uri "$BackendUrl/api/webhooks/send-message/test" -Method GET -TimeoutSec 3 -ErrorAction Stop
    Write-Host "✅ Backend server is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Backend server is not running on $BackendUrl" -ForegroundColor Red
    Write-Host "Please start the backend server first:" -ForegroundColor Yellow
    Write-Host "  cd backend" -ForegroundColor White
    Write-Host "  node app.js" -ForegroundColor White
    exit 1
}

$endpoint = "$BackendUrl/api/webhooks/send-message"
$headers = @{
    "Content-Type" = "application/json"
}

# Test 1: Same Number (923336906200 to 923336906200)
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test 1: Same Number (Self)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "From: $FromNumber" -ForegroundColor Gray
Write-Host "To: $ToNumber1 (same number)" -ForegroundColor Gray
Write-Host ""

$body1 = @{
    agentId = $AgentId
    to = $ToNumber1
    message = "$Message - Same number test"
} | ConvertTo-Json

try {
    Write-Host "Sending message..." -ForegroundColor Yellow
    $response1 = Invoke-RestMethod -Uri $endpoint -Method POST -Headers $headers -Body $body1 -ErrorAction Stop
    
    if ($response1.success) {
        Write-Host "✅ SUCCESS: Message sent successfully!" -ForegroundColor Green
        Write-Host "   Message ID: $($response1.data.messageId)" -ForegroundColor Gray
        Write-Host "   ✅ Validation passed: Number $ToNumber1 is on WhatsApp" -ForegroundColor Green
    } else {
        Write-Host "❌ FAILED: $($response1.error)" -ForegroundColor Red
        Write-Host "   Details: $($response1.details)" -ForegroundColor Yellow
    }
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($errorResponse) {
        Write-Host "❌ ERROR: $($errorResponse.error)" -ForegroundColor Red
        Write-Host "   Details: $($errorResponse.details)" -ForegroundColor Yellow
        
        if ($errorResponse.error -eq "NUMBER_NOT_ON_WHATSAPP") {
            Write-Host "   ⚠️  Validation: Number $ToNumber1 is NOT on WhatsApp" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ REQUEST FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Start-Sleep -Seconds 2

# Test 2: Different Number (923336906200 to 923047001463)
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test 2: Different Number" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "From: $FromNumber" -ForegroundColor Gray
Write-Host "To: $ToNumber2 (different number)" -ForegroundColor Gray
Write-Host ""

$body2 = @{
    agentId = $AgentId
    to = $ToNumber2
    message = "$Message - Different number test"
} | ConvertTo-Json

try {
    Write-Host "Sending message..." -ForegroundColor Yellow
    $response2 = Invoke-RestMethod -Uri $endpoint -Method POST -Headers $headers -Body $body2 -ErrorAction Stop
    
    if ($response2.success) {
        Write-Host "✅ SUCCESS: Message sent successfully!" -ForegroundColor Green
        Write-Host "   Message ID: $($response2.data.messageId)" -ForegroundColor Gray
        Write-Host "   ✅ Validation passed: Number $ToNumber2 is on WhatsApp" -ForegroundColor Green
    } else {
        Write-Host "❌ FAILED: $($response2.error)" -ForegroundColor Red
        Write-Host "   Details: $($response2.details)" -ForegroundColor Yellow
    }
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($errorResponse) {
        Write-Host "❌ ERROR: $($errorResponse.error)" -ForegroundColor Red
        Write-Host "   Details: $($errorResponse.details)" -ForegroundColor Yellow
        
        if ($errorResponse.error -eq "NUMBER_NOT_ON_WHATSAPP") {
            Write-Host "   ⚠️  Validation: Number $ToNumber2 is NOT on WhatsApp" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ REQUEST FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Validator tested both scenarios:" -ForegroundColor Green
Write-Host "   1. Same number: $FromNumber → $ToNumber1" -ForegroundColor Gray
Write-Host "   2. Different number: $FromNumber → $ToNumber2" -ForegroundColor Gray
Write-Host ""
Write-Host "The validation feature:" -ForegroundColor Yellow
Write-Host "  - Checks if recipient number is on WhatsApp" -ForegroundColor Gray
Write-Host "  - Prevents sending to invalid numbers" -ForegroundColor Gray
Write-Host "  - Returns clear error messages" -ForegroundColor Gray
Write-Host ""

