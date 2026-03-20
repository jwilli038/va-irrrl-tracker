/**
 * index.js — Daily VA IRRRL Rate Pipeline Orchestrator
 *
 * Usage:
 *   node src/index.js              # full run
 *   node src/index.js --dry-run    # fetch data, skip email send
 *   node src/index.js --force      # bypass same-day dedup guard
 */
const { fetchRates }             = require('./rates');
const { getFomcRisk }            = require('./fomc');
const { fetchSentiment }         = require('./sentiment');
const { updateHistory, recommend } = require('./analysis');
const { sendEmail, sendAlertEmail } = require('./email');
const { getEconomistCommentary } = require('./economist');
const { calcROI, CLOSING_WITH_CREDITS, CLOSING_WITHOUT_CREDITS } = require('./roi');
const { format }                 = require('date-fns');
const fs   = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.json');

// April 30, 2026 EDT — loan close deadline
const DEADLINE = new Date('2026-04-30T23:59:59-04:00');

function daysUntilDeadline() {
  return Math.max(0, Math.ceil((DEADLINE - new Date()) / (1000 * 60 * 60 * 24)));
}

/**
 * Guard against double-runs on the same day (dual DST crons).
 */
function alreadyRanToday() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    const today = format(new Date(), 'yyyy-MM-dd');
    return data.lastRunDate === today;
  } catch {
    return false;
  }
}

/**
 * Persist run metadata to history.json.
 * Only called after a successful email send.
 */
function stampRunDate(history, extra = {}) {
  history.lastRunDate = format(new Date(), 'yyyy-MM-dd');
  Object.assign(history, extra);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

async function run() {
  console.log('=== VA IRRRL Rate Pipeline ===');
  console.log(`Run time: ${new Date().toISOString()}`);
  if (DRY_RUN) console.log('DRY RUN MODE — email will not be sent');
  if (FORCE)   console.log('FORCE MODE — bypassing same-day guard');

  if (!DRY_RUN && !FORCE && alreadyRanToday()) {
    console.log('Pipeline already ran today. Skipping duplicate run (DST cron guard).');
    process.exit(0);
  }

  try {
    console.log('\n[1/5] Fetching rates...');
    const rates = await fetchRates();
    console.log(`  30yr Treasury: ${rates.dgs30.value}% (${rates.dgs30.bpChange > 0 ? '+' : ''}${rates.dgs30.bpChange} bps)`);
    console.log(`  10yr Treasury: ${rates.dgs10.value}%`);
    console.log(`  2yr Treasury:  ${rates.dgs2.value}%`);
    console.log(`  30yr Mortgage: ${rates.mortgage30.value}%`);

    console.log('\n[2/5] Evaluating Fed risk...');
    const fomcRisk = getFomcRisk();
    console.log(`  Next FOMC: ${fomcRisk.nextMeeting?.label} (${fomcRisk.nextMeeting?.daysAway} days) — Risk: ${fomcRisk.riskLevel}`);

    console.log('\n[3/5] Fetching news sentiment...');
    const sentiment = await fetchSentiment();
    console.log(`  Sentiment: ${sentiment.summary.label}`);

    console.log('\n[4/5] Running analysis...');
    const history = updateHistory(rates);
    const recommendation = recommend({ rates, fomcRisk, sentiment, history });
    console.log(`  Verdict: ${recommendation.verdict} (score: ${recommendation.score})`);

    console.log('\n[5/5] Getting AI economist commentary...');
    const economistComment = await getEconomistCommentary({ rates, fomcRisk, sentiment, recommendation });

    // -----------------------------------------------------------------------
    // Alert check: within 30 days of deadline AND break-even <= 20 months
    // -----------------------------------------------------------------------
    const daysLeft  = daysUntilDeadline();
    const todayStr  = format(new Date(), 'yyyy-MM-dd');
    console.log(`\n  Days until April 30 deadline: ${daysLeft}`);

    let alertFired = false;
    if (!DRY_RUN && rates.vaIrrrEstimate) {
      const withCredits    = calcROI(rates.vaIrrrEstimate.high, CLOSING_WITH_CREDITS);
      const withoutCredits = calcROI(rates.vaIrrrEstimate.low,  CLOSING_WITHOUT_CREDITS);
      // Alert whenever either scenario's break-even drops into the teens (< 20 months)
      const roiAlert = (withCredits.breakEvenMonths !== null && withCredits.breakEvenMonths < 20) ||
                       (withoutCredits.breakEvenMonths !== null && withoutCredits.breakEvenMonths < 20);

      const lastAlert = history.lastAlertDate;
      if (roiAlert && lastAlert !== todayStr) {
        console.log(`  🚨 ALERT: break-even <= 20 months within deadline window — sending alert email...`);
        await sendAlertEmail({ withCredits, withoutCredits, daysToDeadline: daysLeft });
        alertFired = true;
        history.lastAlertDate = todayStr;
      } else if (roiAlert) {
        console.log(`  Alert condition met but already sent today (lastAlertDate: ${lastAlert}).`);
      }
    }

    // -----------------------------------------------------------------------
    // Send main daily email
    // -----------------------------------------------------------------------
    if (DRY_RUN) {
      console.log('\n--- DRY RUN: saving HTML preview to /tmp/preview.html ---');
      const { buildHtml } = require('./email');
      const html = buildHtml({
        rates, fomcRisk, sentiment, recommendation, economistComment,
        dateStr: format(new Date(), 'EEEE, MMMM d, yyyy'),
        history,
      });
      fs.writeFileSync('/tmp/preview.html', html);
      console.log('Preview saved.');
    } else {
      console.log('\nSending daily email...');
      const sent = await sendEmail({ rates, fomcRisk, sentiment, recommendation, economistComment, history });
      if (sent || alertFired) {
        stampRunDate(history, alertFired ? { lastAlertDate: todayStr } : {});
      } else {
        console.error('  ⚠ No email was sent this run — check GMAIL_USER, GMAIL_APP_PASSWORD, RECIPIENT_EMAILS secrets.');
        // Still stamp so the dual-cron guard works, but log clearly
        stampRunDate(history);
        process.exit(1);  // mark run as failed so GH Actions shows error
      }
    }

    console.log('\nPipeline complete.');
    process.exit(0);
  } catch (err) {
    console.error('\nPipeline error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

run();
