# ============================================
# Git Update Agent - Automated Workflow Script
# ============================================
# This script automates the process of committing and pushing changes
# to a new branch called 'update_agent'
# ============================================

Write-Host "`n🚀 Starting Git Update Agent Workflow...`n" -ForegroundColor Cyan

# Step 1: Check repository status
Write-Host "📋 Step 1: Checking repository status..." -ForegroundColor Yellow
Write-Host "==========================================`n" -ForegroundColor Gray
git status
Write-Host "`n"

# Step 2: Stage all changes
Write-Host "➕ Step 2: Staging all changes..." -ForegroundColor Yellow
git add .
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ All changes staged successfully`n" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to stage changes" -ForegroundColor Red
    exit 1
}

# Step 3: Prompt for commit message
Write-Host "📝 Step 3: Commit message" -ForegroundColor Yellow
$commitMessage = Read-Host "Enter commit message (press Enter for default: 'update agent')"
if ([string]::IsNullOrWhiteSpace($commitMessage)) {
    $commitMessage = "update agent"
    Write-Host "Using default message: '$commitMessage'" -ForegroundColor Gray
}

# Create the commit
Write-Host "`n💾 Creating commit..." -ForegroundColor Yellow
git commit -m "$commitMessage"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Commit created successfully`n" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to create commit (maybe no changes to commit?)" -ForegroundColor Red
    exit 1
}

# Step 4: Create and switch to new branch
Write-Host "🌿 Step 4: Creating and switching to branch 'update_agent'..." -ForegroundColor Yellow

# Check if branch already exists
$branchExists = git branch --list update_agent
if ($branchExists) {
    Write-Host "⚠️  Branch 'update_agent' already exists. Switching to it..." -ForegroundColor Yellow
    git checkout update_agent
} else {
    git checkout -b update_agent
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Successfully switched to branch 'update_agent'`n" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to create/switch branch" -ForegroundColor Red
    exit 1
}

# Step 5: Push to remote repository
Write-Host "🚀 Step 5: Pushing to remote repository..." -ForegroundColor Yellow
$remoteUrl = "https://github.com/abdul-hue/pa-agent.git"

# Check if remote 'origin' exists and set it
$currentRemote = git remote get-url origin 2>$null
if ($currentRemote -ne $remoteUrl) {
    Write-Host "🔧 Setting remote URL to: $remoteUrl" -ForegroundColor Gray
    git remote set-url origin $remoteUrl 2>$null
    if ($LASTEXITCODE -ne 0) {
        # Remote doesn't exist, add it
        git remote add origin $remoteUrl
    }
}

# Push the branch to remote
Write-Host "📤 Pushing branch 'update_agent' to GitHub..." -ForegroundColor Cyan
git push -u origin update_agent

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Successfully pushed to remote repository!`n" -ForegroundColor Green
} else {
    Write-Host "`n⚠️  Push failed. You may need to authenticate or check your credentials.`n" -ForegroundColor Yellow
}

# Step 6: Display verification information
Write-Host "`n════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "           VERIFICATION INFO            " -ForegroundColor Cyan
Write-Host "════════════════════════════════════════`n" -ForegroundColor Cyan

Write-Host "📌 Current Branch:" -ForegroundColor Yellow
git branch --show-current
Write-Host ""

Write-Host "📜 Last 3 Commits:" -ForegroundColor Yellow
git log -3 --oneline --decorate --color=always
Write-Host ""

Write-Host "🌐 Remote URL:" -ForegroundColor Yellow
git remote get-url origin
Write-Host ""

Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🎉 Workflow completed successfully!" -ForegroundColor Green
Write-Host "════════════════════════════════════════`n" -ForegroundColor Cyan

# Display GitHub PR link suggestion
$repoUrl = "https://github.com/abdul-hue/pa-agent"
Write-Host "💡 Next Steps:" -ForegroundColor Cyan
Write-Host "   • View your branch: $repoUrl/tree/update_agent" -ForegroundColor White
Write-Host "   • Create Pull Request: $repoUrl/compare/update_agent" -ForegroundColor White
Write-Host ""

