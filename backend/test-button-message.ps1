# PowerShell script to test WhatsApp button messages
# Usage: .\test-button-message.ps1 <agentId> <phoneNumber>

param(
    [string]$AgentId = "b361a914-18bb-405c-92eb-8afe549ca9e1",
    [string]$PhoneNumber = "923336906200"
)

$port = if ($env:PORT) { $env:PORT } else { 3001 }
$host = if ($env:HOST) { $env:HOST } else { "localhost" }
$url = "http://${host}:${port}/api/webhooks/send-message"

$buttonMessage = @{
    text = "👋 Welcome! Please choose an option:"
    buttons = @(
        @{ id = "option_1"; text = "Option 1" }
        @{ id = "option_2"; text = "Option 2" }
        @{ id = "option_3"; text = "Option 3" }
    )
}

$body = @{
    agentId = $AgentId
    to = $PhoneNumber
    message = $buttonMessage
} | ConvertTo-Json -Depth 10

Write-Host "`n🧪 Testing WhatsApp Button Message" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Agent ID: $AgentId"
Write-Host "To: $PhoneNumber"
Write-Host "Message Text: $($buttonMessage.text)"
Write-Host "Buttons: $($buttonMessage.buttons.Count) button(s)"
for ($i = 0; $i -lt $buttonMessage.buttons.Count; $i++) {
    $btn = $buttonMessage.buttons[$i]
    Write-Host "  $($i + 1). [$($btn.id)] $($btn.text)"
}
Write-Host "URL: $url"
Write-Host "==========================================`n" -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json" -Headers @{
        "X-Request-ID" = "test-button-$(Get-Date -Format 'yyyyMMddHHmmss')"
    }
    
    Write-Host "✅ SUCCESS: Button message sent successfully!" -ForegroundColor Green
    Write-Host "`nResponse:" -ForegroundColor Yellow
    $response | ConvertTo-Json -Depth 10
    
    Write-Host "`n📱 Check WhatsApp to see the buttons" -ForegroundColor Cyan
    Write-Host "🔘 When user clicks a button, your webhook will receive buttonResponse data" -ForegroundColor Cyan
} catch {
    Write-Host "`n❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    Write-Host "`nMake sure the backend server is running on port $port" -ForegroundColor Yellow
}

