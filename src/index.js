/**
 * index.js — Daily VA IRRRL Rate Pipeline Orchestrator
 *
 * Usage:
 *   node src/index.js              # full run
 *   node src/index.js --dry-run    # fetch data, skip email send
 */
const { fetchRates }    = require('./rates');
const { getFomcRisk } = require('./fomc');
const { fetchSentiment } = require('./sentiment');
const { updateHistory, recommend } = require('./analysis');
const { sendEmail }     = require('./email');
const { format }        = require('date-fns');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.json');

/**
 * Guard against double-runs on the same day (dual DST crons).
 * Stamps the last-run date in history.json.
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

function stampRunDate(history) {
  history.lastRunDate = format(new Date(), 'yyyy-MM-dd');
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

async function run() {
  console.log('=== VA IRRRL Rate Pipeline ===');
  console.log(`Run time: ${new Date().toISOString()}`);
  if (DRY_RUN) console.log('DRY RUN MODE — email will not be sent');

  if (!DRY_RUN && alreadyRanToday()) {
    console.log('Pipeline already ran today. Skipping duplicate run (DST cron guard).');
    process.exit(0);
  }

  try {
    // Step 1: Fetch all data in parallel where possible
    console.log('\n[1/4] Fetching rates...');
    const rates = await fetchRates();
    console.log(`  30yr Treasury: ${rates.dgs30.value}% (${rates.dgs30.bpChange > 0 ? '+' : ''}${rates.dgs30.bpChange} bps)`);
    console.log(`  10yr Treasury: ${rates.dgs10.value}%`);
    console.log(`  2yr Treasury:  ${rates.dgs2.value}%`);
    console.log(`  30yr Mortgage: ${rates.mortgage30.value}%`);

    console.log('\n[2/4] Evaluating Fed risk...');
    const fomcRisk = getFomcRisk();
    console.log(`  Next FOMC: ${fomcRisk.nextMeeting?.label} (${fomcRisk.nextMeeting?.daysAway} days) — Risk: ${fomcRisk.riskLevel}`);

    console.log('\n[3/4] Fetching news sentiment...');
    const sentiment = await fetchSentiment();
    console.log(`  Sentiment: ${sentiment.summary.label}`);

    console.log('\n[4/4] Running analysis...');
    const history = updateHistory(rates);
    const recommendation = recommend({ rates, fomcRisk, sentiment, history });
    console.log(`  Verdict: ${recommendation.verdict} (score: ${recommendation.score})`);
    console.log(`  Reasons:`);
    recommendation.reasons.forEach(r => console.log(`    - ${r}`));

    if (DRY_RUN) {
      console.log('\n--- DRY RUN: saving HTML preview to /tmp/preview.html ---');
      const { buildHtml } = require('./email');
      const { format: fmt } = require('date-fns');
      const html = buildHtml({
        rates, fomcRisk, sentiment, recommendation,
        dateStr: fmt(new Date(), 'EEEE, MMMM d, yyyy'),
      });
      fs.writeFileSync('/tmp/preview.html', html);
      console.log('Preview saved. Open in browser to review.');
    } else {
      console.log('\nSending email...');
      await sendEmail({ rates, fomcRisk, sentiment, recommendation });
      stampRunDate(history);
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
