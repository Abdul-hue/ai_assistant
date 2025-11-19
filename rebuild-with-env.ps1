# ============================================================================
# Rebuild Docker with Frontend Environment Variables
# This script loads backend/.env and rebuilds the container
# ============================================================================

Write-Host "`n🔧 Rebuilding Docker with Frontend Environment Variables" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# Step 1: Verify backend/.env exists
Write-Host "📋 Step 1: Loading environment variables from backend/.env..." -ForegroundColor Yellow
if (-not (Test-Path "backend\.env")) {
    Write-Host "   ❌ ERROR: backend/.env file not found!" -ForegroundColor Red
    exit 1
}

# Step 2: Load environment variables from backend/.env
$envContent = Get-Content "backend\.env" -Raw
$envLines = $envContent -split "`n"

foreach ($line in $envLines) {
    $line = $line.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line -split "=", 2
        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        
        # Set environment variables for build args
        if ($key -eq "SUPABASE_URL") {
            $env:SUPABASE_URL = $value
            Write-Host "   ✅ Loaded: SUPABASE_URL" -ForegroundColor Green
        }
        if ($key -eq "SUPABASE_ANON_KEY") {
            $env:SUPABASE_ANON_KEY = $value
            Write-Host "   ✅ Loaded: SUPABASE_ANON_KEY" -ForegroundColor Green
        }
    }
}

# Step 3: Verify variables are set
if (-not $env:SUPABASE_URL -or -not $env:SUPABASE_ANON_KEY) {
    Write-Host "   ❌ ERROR: Missing required variables in backend/.env" -ForegroundColor Red
    Write-Host "   Required: SUPABASE_URL, SUPABASE_ANON_KEY" -ForegroundColor Red
    exit 1
}

# Step 4: Stop existing container
Write-Host "`n🛑 Step 2: Stopping existing containers..." -ForegroundColor Yellow
docker-compose down
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Containers stopped" -ForegroundColor Green
}

# Step 5: Rebuild with environment variables
Write-Host "`n🔨 Step 3: Rebuilding container with environment variables..." -ForegroundColor Yellow
docker-compose build --no-cache
if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ Build successful" -ForegroundColor Green

# Step 6: Start container
Write-Host "`n🚀 Step 4: Starting container..." -ForegroundColor Yellow
docker-compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Failed to start container!" -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ Container started" -ForegroundColor Green

# Step 7: Wait and check logs
Write-Host "`n⏳ Step 5: Waiting for container to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

Write-Host "`n📊 Step 6: Container status..." -ForegroundColor Yellow
docker-compose ps

Write-Host "`n📋 Step 7: Recent logs..." -ForegroundColor Yellow
docker-compose logs --tail=20

Write-Host "`n✅ Rebuild complete!" -ForegroundColor Green
Write-Host "`n📝 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Open browser: http://localhost:3001/" -ForegroundColor White
Write-Host "   2. Check console for Supabase errors" -ForegroundColor White
Write-Host "   3. Monitor logs: docker-compose logs -f" -ForegroundColor White
Write-Host "`n"

