const { execSync } = require('child_process');
const PORT = process.env.PORT || 3001;

try {
  if (process.platform === 'win32') {
    // Windows: Use PowerShell to find and kill process on port
    const command = `powershell -Command "$conns = Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue; if ($conns) { $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -ne 0 -and $_ -gt 0 }; if ($pids) { $pids | ForEach-Object { Write-Output \"Killing process $_\"; Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } } }"`;
    execSync(command, { encoding: 'utf8', stdio: 'inherit' });
    console.log(`✅ Server process on port ${PORT} killed (if any)`);
  } else {
    // Linux/Mac: Use lsof and kill
    try {
      const pids = execSync(`lsof -ti:${PORT}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      if (pids.length > 0) {
        pids.forEach(pid => {
          console.log(`Killing process ${pid}`);
          execSync(`kill -9 ${pid}`, { stdio: 'inherit' });
        });
        console.log(`✅ Server process on port ${PORT} killed`);
      } else {
        console.log(`ℹ️  No process found on port ${PORT}`);
      }
    } catch (e) {
      console.log(`ℹ️  No process found on port ${PORT}`);
    }
  }
} catch (error) {
  console.log(`ℹ️  No process found on port ${PORT} or already stopped`);
}
