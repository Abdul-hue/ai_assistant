# Test Webhook Send Message Script for PowerShell
# Usage: .\test-webhook.ps1 -AgentId "b361a914-18bb-405c-92eb-8afe549ca9e1" -PhoneNumber "923336906200" -Message "Hello, this is a test message!"

param(
    [Parameter(Mandatory=$true)]
    [string]$AgentId,
    
    [Parameter(Mandatory=$true)]
    [string]$PhoneNumber,
    
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$uri = "http://localhost:3001/api/webhooks/send-message"
$body = @{
    agentId = $AgentId
    to = $PhoneNumber
    message = $Message
} | ConvertTo-Json

$headers = @{
    "Content-Type" = "application/json"
    "X-Request-ID" = "test-$(Get-Date -Format 'yyyyMMddHHmmss')"
}

Write-Host "`n🧪 Testing Webhook Send Message Endpoint" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Agent ID: $AgentId"
Write-Host "To: $PhoneNumber"
Write-Host "Message: $Message"
Write-Host "URL: $uri"
Write-Host "==========================================`n" -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body
    
    Write-Host "✅ SUCCESS!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 10)
    
    if ($response.success) {
        Write-Host "`n✅ Message sent successfully!" -ForegroundColor Green
    } else {
        Write-Host "`n❌ FAILED: $($response.error)" -ForegroundColor Red
        if ($response.details) {
            Write-Host "Details: $($response.details)" -ForegroundColor Yellow
        }
        if ($response.action_required) {
            Write-Host "Action Required: $($response.action_required)" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "`n❌ ERROR:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.ErrorDetails.Message) {
        try {
            $errorJson = $_.ErrorDetails.Message | ConvertFrom-Json
            Write-Host "`nError Details:" -ForegroundColor Yellow
            Write-Host ($errorJson | ConvertTo-Json -Depth 10)
        } catch {
            Write-Host $_.ErrorDetails.Message
        }
    }
}

