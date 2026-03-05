# VA IRRRL Rate Tracker — One-time setup script
# Run this in PowerShell as Administrator:
#   Right-click PowerShell → "Run as Administrator"
#   cd C:\Users\jwill\va-irrrl-tracker
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\setup.ps1

$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot

Write-Host "`n=== VA IRRRL Rate Tracker Setup ===" -ForegroundColor Cyan

# ── 1. Install Node.js via winget ──────────────────────────────────────────
Write-Host "`n[1/5] Checking Node.js..." -ForegroundColor Yellow
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "  Node.js already installed: $(node --version)" -ForegroundColor Green
} else {
    Write-Host "  Installing Node.js LTS via winget..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "  Node.js installed: $(node --version)" -ForegroundColor Green
}

# ── 2. Install Git ─────────────────────────────────────────────────────────
Write-Host "`n[2/5] Checking Git..." -ForegroundColor Yellow
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "  Git already installed: $(git --version)" -ForegroundColor Green
} else {
    Write-Host "  Installing Git via winget..." -ForegroundColor Yellow
    winget install --id Git.Git --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "  Git installed: $(git --version)" -ForegroundColor Green
}

# ── 3. Install GitHub CLI ──────────────────────────────────────────────────
Write-Host "`n[3/5] Checking GitHub CLI..." -ForegroundColor Yellow
if (Get-Command gh -ErrorAction SilentlyContinue) {
    Write-Host "  GitHub CLI already installed: $(gh --version | Select-Object -First 1)" -ForegroundColor Green
} else {
    Write-Host "  Installing GitHub CLI via winget..." -ForegroundColor Yellow
    winget install --id GitHub.cli --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "  GitHub CLI installed." -ForegroundColor Green
}

# ── 4. Install npm dependencies ────────────────────────────────────────────
Write-Host "`n[4/5] Installing npm dependencies..." -ForegroundColor Yellow
Set-Location $projectDir
npm install
Write-Host "  npm install complete." -ForegroundColor Green

# ── 5. Initialize git repo ─────────────────────────────────────────────────
Write-Host "`n[5/5] Initializing git repository..." -ForegroundColor Yellow
if (Test-Path "$projectDir\.git") {
    Write-Host "  Git already initialized." -ForegroundColor Green
} else {
    git init
    git add .
    git commit -m "Initial commit: VA IRRRL rate tracker pipeline"
    Write-Host "  Git repo initialized with initial commit." -ForegroundColor Green
}

Write-Host "`n=== Setup complete! ===" -ForegroundColor Cyan
Write-Host @"

NEXT STEPS (need your accounts):

1. Get free API keys (all take < 2 min each):
   - FRED:           https://fredaccount.stlouisfed.org/apikeys
   - Alpha Vantage:  https://www.alphavantage.co/support/#api-key
   - NewsAPI:        https://newsapi.org/register
   - Mailgun:        https://signup.mailgun.com (free, no credit card)

2. Run the GitHub setup script to create the repo and add secrets:
   .\setup-github.ps1

"@ -ForegroundColor White
