# VA IRRRL Rate Tracker

Daily pipeline that monitors 30-year treasury and mortgage rates, assesses Fed risk, and emails a recommendation to lock or wait on your VA IRRRL refinance.

**Runs:** Weekdays at ~4pm ET via GitHub Actions (free)
**Emails:** HTML report with rates, trend, yield curve, FOMC risk, news sentiment, and a LOCK NOW / WAIT / MONITOR verdict

---

## Setup (One-Time)

### 1. Install Node.js
Download and install from https://nodejs.org (LTS version, 20.x or newer)

### 2. Create a GitHub Repo
Create a **public** repo named `va-irrrl-tracker` at https://github.com/new

### 3. Get Free API Keys

| Service | Sign-up URL | Notes |
|---------|-------------|-------|
| **FRED** | https://fredaccount.stlouisfed.org/apikeys | Free, no expiration |
| **Alpha Vantage** | https://www.alphavantage.co/support/#api-key | Free (25 req/day) |
| **NewsAPI** | https://newsapi.org/register | Free (100 req/day) |
| **Mailgun** | https://signup.mailgun.com | Free (100 emails/day, no card) |

For Mailgun: after signing up, add a sending domain (or use the sandbox domain for testing).

### 4. Add GitHub Secrets
In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value |
|-------------|-------|
| `FRED_API_KEY` | Your FRED API key |
| `ALPHA_VANTAGE_API_KEY` | Your Alpha Vantage key |
| `NEWS_API_KEY` | Your NewsAPI key |
| `MAILGUN_API_KEY` | Your Mailgun API key |
| `MAILGUN_DOMAIN` | Your Mailgun domain (e.g. `mg.yourdomain.com`) |
| `RECIPIENT_EMAILS` | Comma-separated emails: `you@gmail.com,friend@gmail.com` |

### 5. Push the Code

```bash
cd va-irrrl-tracker
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/va-irrrl-tracker.git
git push -u origin main
```

### 6. Test It Manually
In GitHub: **Actions → VA IRRRL Daily Rate Pipeline → Run workflow**

Check the Actions log to confirm it runs successfully and you receive an email.

---

## Local Development

```bash
npm install

# Dry run (fetches real data, saves HTML preview, no email sent)
FRED_API_KEY=xxx NEWS_API_KEY=xxx ALPHA_VANTAGE_API_KEY=xxx node src/index.js --dry-run

# On Windows (PowerShell):
$env:FRED_API_KEY="xxx"; $env:NEWS_API_KEY="xxx"; node src/index.js --dry-run
```

The `--dry-run` flag saves the email HTML to `/tmp/preview.html` so you can open it in a browser.

---

## How It Works

```
src/
├── index.js      Orchestrator — runs all modules, deduplicates dual DST crons
├── rates.js      FRED API: DGS30, DGS10, DGS2, MORTGAGE30US
├── fomc.js       FOMC meeting dates, countdown, risk level (HIGH/ELEVATED/LOW)
├── sentiment.js  Alpha Vantage NEWS_SENTIMENT + NewsAPI headlines
├── analysis.js   Trend calculation, 7/30/60-day averages, recommendation engine
└── email.js      HTML email template + Mailgun sender
data/
└── history.json  Rolling 90-day rate log (auto-committed by GitHub Actions)
```

### Recommendation Logic
| Signal | Effect |
|--------|--------|
| Rates at 30-day low | Strong LOCK signal |
| Rates trending up (5-day) | LOCK signal |
| FOMC meeting within 14 days | LOCK signal (volatility risk) |
| Rates trending down | WAIT signal |
| Dovish news sentiment | WAIT signal |
| Mixed signals | MONITOR |

---

## Annual Maintenance

**Every January:** Update the FOMC meeting dates in [src/fomc.js](src/fomc.js).
The Fed publishes the full year's schedule ~12 months in advance at:
https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm

---

## Data Sources
- **30yr Treasury (DGS30)**: FRED — St. Louis Federal Reserve
- **30yr Mortgage (MORTGAGE30US)**: Freddie Mac PMMS via FRED (weekly)
- **News Sentiment**: Alpha Vantage (Federal Reserve topic)
- **Headlines**: NewsAPI.org
- **FOMC Dates**: Hardcoded from federalreserve.gov calendar
