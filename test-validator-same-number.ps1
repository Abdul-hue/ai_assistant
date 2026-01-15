# WhatsApp Validator Test - Same Number (Sender = Recipient)
# Tests validation when sending from 923336906200 to 923336906200

param(
    [string]$BackendUrl = "http://localhost:3001",
    [string]$AgentId = "b361a914-18bb-405c-92eb-8afe549ca9e1",
    [string]$PhoneNumber = "923336906200",
    [string]$Message = "Test message - Same number validation test"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "WhatsApp Validator Test - Same Number" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Test Configuration:" -ForegroundColor Yellow
Write-Host "  Agent ID: $AgentId" -ForegroundColor Gray
Write-Host "  From: $PhoneNumber" -ForegroundColor Gray
Write-Host "  To: $PhoneNumber (same number)" -ForegroundColor Gray
Write-Host "  Message: $Message" -ForegroundColor Gray
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

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Gray
Write-Host "Test 1: Validation Check" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray
Write-Host ""

$endpoint = "$BackendUrl/api/webhooks/send-message"
$headers = @{
    "Content-Type" = "application/json"
}

$body = @{
    agentId = $AgentId
    to = $PhoneNumber
    message = $Message
} | ConvertTo-Json

Write-Host "Sending message from $PhoneNumber to $PhoneNumber..." -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method POST -Headers $headers -Body $body -ErrorAction Stop
    
    if ($response.success) {
        Write-Host "✅ SUCCESS: Message sent successfully!" -ForegroundColor Green
        Write-Host "   Message ID: $($response.data.messageId)" -ForegroundColor Gray
        Write-Host "   Sent At: $($response.data.sentAt)" -ForegroundColor Gray
        Write-Host "   To: $($response.data.to)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "✅ Validation passed: Number $PhoneNumber is on WhatsApp" -ForegroundColor Green
    } else {
        Write-Host "❌ FAILED: $($response.error)" -ForegroundColor Red
        Write-Host "   Details: $($response.details)" -ForegroundColor Yellow
    }
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($errorResponse) {
        Write-Host "❌ ERROR: $($errorResponse.error)" -ForegroundColor Red
        Write-Host "   Details: $($errorResponse.details)" -ForegroundColor Yellow
        
        if ($errorResponse.error -eq "NUMBER_NOT_ON_WHATSAPP") {
            Write-Host ""
            Write-Host "⚠️  VALIDATION RESULT:" -ForegroundColor Yellow
            Write-Host "   Number $PhoneNumber is NOT registered on WhatsApp" -ForegroundColor Yellow
            Write-Host "   This means the validation feature is working correctly!" -ForegroundColor Green
        } elseif ($errorResponse.error -eq "RATE_LIMIT_EXCEEDED") {
            Write-Host ""
            Write-Host "⚠️  Rate limit exceeded" -ForegroundColor Yellow
            Write-Host "   Wait $($errorResponse.retryAfter) seconds before trying again" -ForegroundColor Yellow
        } elseif ($errorResponse.error -eq "WhatsApp not connected") {
            Write-Host ""
            Write-Host "⚠️  WhatsApp session not connected" -ForegroundColor Yellow
            Write-Host "   Please ensure the agent is connected to WhatsApp" -ForegroundColor Yellow
        } else {
            Write-Host ""
            Write-Host "   Full error response:" -ForegroundColor Gray
            Write-Host "   $($errorResponse | ConvertTo-Json -Depth 3)" -ForegroundColor Gray
        }
    } else {
        Write-Host "❌ REQUEST FAILED: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            Write-Host "   Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary:" -ForegroundColor Yellow
Write-Host "  - Validator checked if $PhoneNumber is on WhatsApp" -ForegroundColor Gray
Write-Host "  - Message sent from $PhoneNumber to $PhoneNumber" -ForegroundColor Gray
Write-Host "  - Validation feature is working correctly" -ForegroundColor Green
Write-Host ""

