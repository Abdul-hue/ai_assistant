# ============================================================================
# Docker Rebuild Script for ConnectBot AI
# This script rebuilds the Docker container with the fixed configuration
# ============================================================================

Write-Host "`n🔧 Docker Rebuild Script for ConnectBot AI" -ForegroundColor Cyan
Write-Host "==========================================`n" -ForegroundColor Cyan

# Step 1: Verify backend/.env exists
Write-Host "📋 Step 1: Verifying backend/.env file..." -ForegroundColor Yellow
if (Test-Path "backend\.env") {
    Write-Host "   ✅ backend/.env file found" -ForegroundColor Green
} else {
    Write-Host "   ❌ ERROR: backend/.env file not found!" -ForegroundColor Red
    Write-Host "   Please create backend/.env with all required variables" -ForegroundColor Red
    exit 1
}

# Step 2: Stop and remove old container
Write-Host "`n🛑 Step 2: Stopping existing containers..." -ForegroundColor Yellow
docker-compose down
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Containers stopped" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  No existing containers to stop (this is OK)" -ForegroundColor Yellow
}

# Step 3: Optional - Remove old image (uncomment if needed)
# Write-Host "`n🗑️  Step 3: Removing old image..." -ForegroundColor Yellow
# docker rmi connectbot-ai-main-connectbot-ai -f
# Write-Host "   ✅ Old image removed" -ForegroundColor Green

# Step 4: Rebuild with new configuration
Write-Host "`n🔨 Step 4: Rebuilding container with new configuration..." -ForegroundColor Yellow
docker-compose build --no-cache
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Build successful" -ForegroundColor Green
} else {
    Write-Host "   ❌ Build failed!" -ForegroundColor Red
    exit 1
}

# Step 5: Start container
Write-Host "`n🚀 Step 5: Starting container..." -ForegroundColor Yellow
docker-compose up -d
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Container started" -ForegroundColor Green
} else {
    Write-Host "   ❌ Failed to start container!" -ForegroundColor Red
    exit 1
}

# Step 6: Wait for container to be ready
Write-Host "`n⏳ Step 6: Waiting for container to be ready (10 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Step 7: Check container status
Write-Host "`n📊 Step 7: Checking container status..." -ForegroundColor Yellow
docker-compose ps

# Step 8: Show logs
Write-Host "`n📋 Step 8: Recent logs (last 20 lines)..." -ForegroundColor Yellow
docker-compose logs --tail=20

Write-Host "`n✅ Rebuild complete!" -ForegroundColor Green
Write-Host "`n📝 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Monitor logs: docker-compose logs -f" -ForegroundColor White
Write-Host "   2. Check health: curl http://localhost:3001/api/health" -ForegroundColor White
Write-Host "   3. Verify environment variables in logs" -ForegroundColor White
Write-Host "`n"

