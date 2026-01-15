# WhatsApp Number Validation Testing Script
# Tests the validation feature before sending messages

param(
    [string]$BackendUrl = "http://localhost:3001",
    [string]$AgentId = "b361a914-18bb-405c-92eb-8afe549ca9e1",
    [string]$FromNumber = "923336906200",
    [string]$ToNumber = "923047001463",
    [string]$Message = "Test message from validation script"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "WhatsApp Validation Test Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test Configuration
$endpoint = "$BackendUrl/api/webhooks/send-message"
$headers = @{
    "Content-Type" = "application/json"
}

# Test 1: Valid WhatsApp Number
Write-Host "Test 1: Valid WhatsApp Number" -ForegroundColor Yellow
Write-Host "  From: $FromNumber" -ForegroundColor Gray
Write-Host "  To: $ToNumber" -ForegroundColor Gray
Write-Host "  Agent: $AgentId" -ForegroundColor Gray
Write-Host ""

$body = @{
    agentId = $AgentId
    to = $ToNumber
    message = $Message
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method POST -Headers $headers -Body $body -ErrorAction Stop
    
    if ($response.success) {
        Write-Host "✅ SUCCESS: Message sent successfully!" -ForegroundColor Green
        Write-Host "   Message ID: $($response.data.messageId)" -ForegroundColor Gray
        Write-Host "   Sent At: $($response.data.sentAt)" -ForegroundColor Gray
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
            Write-Host "   ⚠️  Validation detected: Number is not on WhatsApp" -ForegroundColor Yellow
        } elseif ($errorResponse.error -eq "RATE_LIMIT_EXCEEDED") {
            Write-Host "   ⚠️  Rate limit exceeded. Wait $($errorResponse.retryAfter) seconds" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ REQUEST FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Gray
Write-Host ""

# Test 2: Invalid/Non-WhatsApp Number
Write-Host "Test 2: Invalid Number (should fail validation)" -ForegroundColor Yellow
Write-Host "  To: 1234567890 (fake number)" -ForegroundColor Gray
Write-Host ""

$invalidBody = @{
    agentId = $AgentId
    to = "1234567890"
    message = "This should fail validation"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method POST -Headers $headers -Body $invalidBody -ErrorAction Stop
    Write-Host "⚠️  Unexpected: Request succeeded (should have failed)" -ForegroundColor Yellow
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($errorResponse) {
        if ($errorResponse.error -eq "NUMBER_NOT_ON_WHATSAPP") {
            Write-Host "✅ VALIDATION WORKING: Number correctly rejected" -ForegroundColor Green
            Write-Host "   Error: $($errorResponse.error)" -ForegroundColor Gray
            Write-Host "   Details: $($errorResponse.details)" -ForegroundColor Gray
        } else {
            Write-Host "❌ ERROR: $($errorResponse.error)" -ForegroundColor Red
            Write-Host "   Details: $($errorResponse.details)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ REQUEST FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To run with custom parameters:" -ForegroundColor Gray
Write-Host "  .\test-whatsapp-validation.ps1 -ToNumber `"923047001463`" -Message `"Custom message`"" -ForegroundColor White
Write-Host ""

