# VA IRRRL Rate Tracker — GitHub repo + secrets setup
# Run AFTER setup.ps1 and after you have your API keys.
#
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\setup-github.ps1

$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot

Write-Host "`n=== GitHub Repo + Secrets Setup ===" -ForegroundColor Cyan

# ── Authenticate with GitHub CLI ───────────────────────────────────────────
Write-Host "`n[1/4] Logging into GitHub..." -ForegroundColor Yellow
$loginStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Opening GitHub login (browser will open)..." -ForegroundColor Yellow
    gh auth login --web --git-protocol https
} else {
    Write-Host "  Already logged in." -ForegroundColor Green
}

# ── Create public GitHub repo ──────────────────────────────────────────────
Write-Host "`n[2/4] Creating GitHub repository..." -ForegroundColor Yellow
$repoName = "va-irrrl-tracker"
$existingRepo = gh repo view $repoName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Repo '$repoName' already exists — skipping creation." -ForegroundColor Green
} else {
    gh repo create $repoName --public --description "Daily VA IRRRL rate monitoring pipeline" --source . --remote origin --push
    Write-Host "  Repo created and code pushed!" -ForegroundColor Green
}

# Push if remote already existed but wasn't pushed
$remoteExists = git remote get-url origin 2>&1
if ($LASTEXITCODE -ne 0) {
    $ghUser = gh api user --jq .login
    git remote add origin "https://github.com/$ghUser/$repoName.git"
}
git push -u origin main 2>&1 | Out-Null
Write-Host "  Code pushed to GitHub." -ForegroundColor Green

# ── Collect API keys from user ─────────────────────────────────────────────
Write-Host "`n[3/4] Enter your API keys (paste and press Enter):" -ForegroundColor Yellow
Write-Host "  Get them from the URLs in README.md if you haven't yet.`n"

$fredKey   = Read-Host "  FRED API key           (https://fredaccount.stlouisfed.org/apikeys)"
$avKey     = Read-Host "  Alpha Vantage key      (https://www.alphavantage.co/support/#api-key)"
$newsKey   = Read-Host "  NewsAPI key            (https://newsapi.org/register)"
$mgKey     = Read-Host "  Mailgun API key        (mailgun.com → Account → API Keys)"
$mgDomain  = Read-Host "  Mailgun domain         (e.g. mg.yourdomain.com or sandbox-xxx.mailgun.org)"
$emails    = Read-Host "  Recipient emails       (comma-separated, e.g. you@gmail.com,friend@gmail.com)"

# ── Set GitHub secrets ─────────────────────────────────────────────────────
Write-Host "`n[4/4] Setting GitHub secrets..." -ForegroundColor Yellow

$secrets = @{
    "FRED_API_KEY"          = $fredKey
    "ALPHA_VANTAGE_API_KEY" = $avKey
    "NEWS_API_KEY"          = $newsKey
    "MAILGUN_API_KEY"       = $mgKey
    "MAILGUN_DOMAIN"        = $mgDomain
    "RECIPIENT_EMAILS"      = $emails
}

foreach ($name in $secrets.Keys) {
    $value = $secrets[$name]
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "  Skipped $name (empty)" -ForegroundColor DarkGray
        continue
    }
    $value | gh secret set $name --repo "$repoName"
    Write-Host "  Set secret: $name" -ForegroundColor Green
}

Write-Host "`n=== All done! ===" -ForegroundColor Cyan
Write-Host @"

Your pipeline is live! To trigger a test run right now:
  gh workflow run daily-pipeline.yml

Or go to: https://github.com/$(gh api user --jq .login)/$repoName/actions
Click 'VA IRRRL Daily Rate Pipeline' → 'Run workflow'

The pipeline will also run automatically at ~4pm ET on weekdays.
"@ -ForegroundColor White
