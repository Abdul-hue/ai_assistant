# Simple WhatsApp Validation Test
# Quick test for the specific numbers provided

$endpoint = "http://localhost:3001/api/webhooks/send-message"
$body = @{
    agentId = "b361a914-18bb-405c-92eb-8afe549ca9e1"
    to = "923047001463"
    message = "Test message - WhatsApp validation test"
} | ConvertTo-Json

Write-Host "Testing WhatsApp validation..." -ForegroundColor Cyan
Write-Host "Agent: b361a914-18bb-405c-92eb-8afe549ca9e1" -ForegroundColor Gray
Write-Host "From: 923336906200" -ForegroundColor Gray
Write-Host "To: 923047001463" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method POST `
        -Headers @{"Content-Type" = "application/json"} `
        -Body $body
    
    if ($response.success) {
        Write-Host "✅ SUCCESS!" -ForegroundColor Green
        Write-Host "Message sent successfully" -ForegroundColor Green
        Write-Host "Message ID: $($response.data.messageId)" -ForegroundColor Gray
    } else {
        Write-Host "❌ FAILED: $($response.error)" -ForegroundColor Red
        Write-Host "Details: $($response.details)" -ForegroundColor Yellow
    }
} catch {
    $errorObj = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($errorObj) {
        Write-Host "❌ ERROR: $($errorObj.error)" -ForegroundColor Red
        Write-Host "Details: $($errorObj.details)" -ForegroundColor Yellow
        
        if ($errorObj.error -eq "NUMBER_NOT_ON_WHATSAPP") {
            Write-Host "" -ForegroundColor Yellow
            Write-Host "⚠️  Validation Result: Number 923047001463 is NOT on WhatsApp" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ Request failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

