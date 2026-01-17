# Kill all processes using port 3001
$port = 3001

Write-Host "Checking for processes on port $port..." -ForegroundColor Yellow

try {
    # Get all process IDs using the port
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    
    if ($connections) {
        $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        
        Write-Host "Found $($processIds.Count) process(es) using port $port" -ForegroundColor Cyan
        
        foreach ($processId in $processIds) {
            try {
                $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if ($process) {
                    Write-Host "Killing process: $($process.ProcessName) (PID: $processId)" -ForegroundColor Red
                    Stop-Process -Id $processId -Force -ErrorAction Stop
                    Write-Host "Process $processId killed successfully" -ForegroundColor Green
                }
            }
            catch {
                Write-Host "Failed to kill process $processId : $_" -ForegroundColor Yellow
            }
        }
        
        # Wait a moment for ports to be released
        Start-Sleep -Milliseconds 500
        
        # Verify port is now free
        $stillInUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($stillInUse) {
            Write-Host "Warning: Port $port may still be in use" -ForegroundColor Yellow
        } else {
            Write-Host "Port $port is now free" -ForegroundColor Green
        }
    }
    else {
        Write-Host "No processes found using port $port" -ForegroundColor Green
    }
}
catch {
    Write-Host "Error checking port: $_" -ForegroundColor Red
    exit 1
}

Write-Host "Done!" -ForegroundColor Cyan
