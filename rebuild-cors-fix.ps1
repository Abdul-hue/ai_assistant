# Rebuild Docker Container with CORS Fix
Write-Host "`nRebuilding Docker Container with CORS Fix" -ForegroundColor Cyan
Write-Host "==========================================`n" -ForegroundColor Cyan

# Step 1: Set environment variables
Write-Host "Step 1: Setting environment variables..." -ForegroundColor Yellow
$env:SUPABASE_URL = "https://dieozzsqexhptpfwrhxk.supabase.co"
$env:SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZW96enNxZXhocHRwZndyaHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5MjM5MTIsImV4cCI6MjA3NjQ5OTkxMn0.u_bJIYqBIlAJU9_GeAApI3Rnf6TPhtIuN68yyJbFLgU"
Write-Host "   Environment variables set" -ForegroundColor Green

# Step 2: Stop existing container
Write-Host "`nStep 2: Stopping existing containers..." -ForegroundColor Yellow
docker-compose down 2>&1 | Out-Null
Write-Host "   Containers stopped" -ForegroundColor Green

# Step 3: Rebuild
Write-Host "`nStep 3: Rebuilding container (this may take 5-10 minutes)..." -ForegroundColor Yellow
docker-compose build --no-cache
if ($LASTEXITCODE -ne 0) {
    Write-Host "   Build failed!" -ForegroundColor Red
    Write-Host "`nTroubleshooting:" -ForegroundColor Yellow
    Write-Host "   1. Make sure Docker Desktop is running" -ForegroundColor White
    Write-Host "   2. Try running PowerShell as Administrator" -ForegroundColor White
    Write-Host "   3. Restart Docker Desktop if needed" -ForegroundColor White
    exit 1
}
Write-Host "   Build successful" -ForegroundColor Green

# Step 4: Start container
Write-Host "`nStep 4: Starting container..." -ForegroundColor Yellow
docker-compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "   Failed to start container!" -ForegroundColor Red
    exit 1
}
Write-Host "   Container started" -ForegroundColor Green

# Step 5: Wait for startup
Write-Host "`nStep 5: Waiting for container to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Step 6: Check status
Write-Host "`nStep 6: Checking container status..." -ForegroundColor Yellow
docker-compose ps

# Step 7: Test frontend
Write-Host "`nStep 7: Testing frontend..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/" -UseBasicParsing -TimeoutSec 5
    Write-Host "   Frontend is accessible (Status: $($response.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "   Could not test frontend: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Step 8: Show logs
Write-Host "`nStep 8: Recent logs..." -ForegroundColor Yellow
docker-compose logs --tail=15

Write-Host "`nRebuild complete!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "   1. Open browser: http://localhost:3001/" -ForegroundColor White
Write-Host "   2. Check browser console (F12) for any errors" -ForegroundColor White
Write-Host "   3. Should NOT see Origin header required error" -ForegroundColor White
Write-Host "   4. Monitor logs: docker-compose logs -f" -ForegroundColor White
Write-Host "`n"
