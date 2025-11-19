# Rebuild Docker with Frontend Supabase Variables
Write-Host "Setting environment variables from backend/.env..." -ForegroundColor Yellow

# Load variables from backend/.env
$env:SUPABASE_URL = "https://dieozzsqexhptpfwrhxk.supabase.co"
$env:SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZW96enNxZXhocHRwZndyaHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5MjM5MTIsImV4cCI6MjA3NjQ5OTkxMn0.u_bJIYqBIlAJU9_GeAApI3Rnf6TPhtIuN68yyJbFLgU"

Write-Host "Rebuilding container..." -ForegroundColor Yellow
docker-compose build --no-cache

Write-Host "Starting container..." -ForegroundColor Yellow
docker-compose up -d

Write-Host "Done! Check http://localhost:3001/" -ForegroundColor Green

