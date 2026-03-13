/**
 * analysis.js — Rate trend analysis and VA IRRRL lock recommendation engine
 */
const { subDays, format } = require('date-fns');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.json');
const MAX_HISTORY_DAYS = 90;

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not load history.json:', e.message);
  }
  return { entries: [] };
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Bootstrap history from FRED arrays by merging on date.
 * Used on first run so we immediately have 90 days of data.
 */
function bootstrapFromFred(rates) {
  const dgs10Map    = new Map((rates.dgs10.history    ?? []).map(e => [e.date, e.value]));
  const dgs2Map     = new Map((rates.dgs2.history     ?? []).map(e => [e.date, e.value]));
  const mortgageMap = new Map((rates.mortgage30.history ?? []).map(e => [e.date, e.value]));

  return (rates.dgs30.history ?? []).map(e => ({
    date:      e.date,
    dgs30:     e.value,
    dgs10:     dgs10Map.get(e.date) ?? null,
    dgs2:      dgs2Map.get(e.date)  ?? null,
    mortgage30: mortgageMap.get(e.date) ?? null,
  })).filter(e => e.dgs30 !== null);
}

/**
 * Append today's rates to history and trim to MAX_HISTORY_DAYS.
 * Bootstraps from FRED data if history is sparse (first run).
 */
function updateHistory(rates) {
  const history = loadHistory();
  const today   = rates.date;

  // Bootstrap from FRED on first run (< 10 entries means we're just starting)
  if (history.entries.length < 10) {
    console.log('  Bootstrapping 90-day history from FRED data...');
    history.entries = bootstrapFromFred(rates);
  }

  // Remove any existing entry for today (idempotent)
  history.entries = history.entries.filter(e => e.date !== today);

  history.entries.push({
    date:      today,
    dgs30:     rates.dgs30.value,
    dgs10:     rates.dgs10.value,
    dgs2:      rates.dgs2.value,
    mortgage30: rates.mortgage30.value,
  });

  // Sort ascending by date, trim to 90 days
  history.entries.sort((a, b) => a.date.localeCompare(b.date));
  const cutoff = format(subDays(new Date(), MAX_HISTORY_DAYS), 'yyyy-MM-dd');
  history.entries = history.entries.filter(e => e.date >= cutoff);

  saveHistory(history);
  return history;
}

/**
 * Compute average DGS30 over the last N calendar days from history.
 */
function avgOver(entries, days) {
  const cutoff = format(subDays(new Date(), days), 'yyyy-MM-dd');
  const subset = entries.filter(e => e.date >= cutoff && e.dgs30 !== null);
  if (subset.length === 0) return null;
  return parseFloat((subset.reduce((s, e) => s + e.dgs30, 0) / subset.length).toFixed(3));
}

/**
 * Linear slope of last N entries (positive = rising, negative = falling).
 * Returns slope in % per day.
 */
function slope(entries, n) {
  const recent = entries.slice(-n).filter(e => e.dgs30 !== null);
  if (recent.length < 2) return 0;
  const first = recent[0].dgs30;
  const last  = recent[recent.length - 1].dgs30;
  return (last - first) / (recent.length - 1);
}

/**
 * Trend label based on slope and magnitude.
 */
function trendLabel(slopePerDay) {
  const bpPerDay = slopePerDay * 100;
  if (bpPerDay > 1.5)  return { label: 'Rising ↑',          arrow: '↑', direction: 'up' };
  if (bpPerDay > 0.3)  return { label: 'Slightly Rising ↗',  arrow: '↗', direction: 'up' };
  if (bpPerDay < -1.5) return { label: 'Falling ↓',          arrow: '↓', direction: 'down' };
  if (bpPerDay < -0.3) return { label: 'Slightly Falling ↘', arrow: '↘', direction: 'down' };
  return { label: 'Flat →', arrow: '→', direction: 'flat' };
}

/**
 * Weekly rate table: up to 8 evenly-spaced snapshots from history.
 * Fixed: samples by index step, no infinite loop, no duplicate entries.
 */
function weeklySnapshot(entries) {
  const valid = entries.filter(e => e.dgs30 !== null);
  if (valid.length === 0) return [];

  if (valid.length <= 8) return valid;

  // Pick up to 8 evenly-spaced indices across the full history
  const step = Math.floor(valid.length / 8);
  const samples = [];
  for (let i = 0; i < valid.length && samples.length < 7; i += step) {
    samples.push(valid[i]);
  }
  // Always include the most recent entry
  if (samples[samples.length - 1]?.date !== valid[valid.length - 1].date) {
    samples.push(valid[valid.length - 1]);
  }
  return samples;
}

/**
 * Main recommendation engine.
 */
function recommend({ rates, fomcRisk, sentiment, history }) {
  const entries = history.entries;
  const current = rates.dgs30.value;
  if (current === null) {
    return {
      verdict: 'MONITOR',
      color: '#f59e0b',
      reasons: ['Unable to fetch current rate data — check FRED API key.'],
    };
  }

  const s     = slope(entries, 5);
  const trend = trendLabel(s);
  const avg7  = avgOver(entries, 7);
  const avg30 = avgOver(entries, 30);
  const avg60 = avgOver(entries, 60);

  // 30-day and 90-day low/high
  const validEntries = entries.filter(e => e.dgs30 !== null);
  const last30 = validEntries.slice(-30);
  const last90 = validEntries.slice(-90);
  const min30  = last30.length ? Math.min(...last30.map(e => e.dgs30)) : null;
  const max30  = last30.length ? Math.max(...last30.map(e => e.dgs30)) : null;
  const min90  = last90.length ? Math.min(...last90.map(e => e.dgs30)) : null;
  const max90  = last90.length ? Math.max(...last90.map(e => e.dgs30)) : null;
  const pctFromLow = min30 ? ((current - min30) / min30) * 100 : null;

  const sentimentDir = sentiment?.summary?.label ?? 'Neutral';
  const fomcLevel    = fomcRisk?.riskLevel ?? 'LOW';

  const reasons = [];
  let score = 0;

  // Trend factor
  if (trend.direction === 'up') {
    score += 2;
    reasons.push(`Rates trending ${trend.label.toLowerCase()} — locking sooner may be advantageous.`);
  } else if (trend.direction === 'down') {
    score -= 2;
    reasons.push(`Rates trending ${trend.label.toLowerCase()} — further improvement possible.`);
  } else {
    reasons.push('Rate trend is flat — no strong directional signal.');
  }

  // Distance from recent low
  if (pctFromLow !== null) {
    if (pctFromLow <= 0.5) {
      score += 3;
      reasons.push(`30yr treasury is at or near its 30-day low (${current.toFixed(3)}% vs low of ${min30.toFixed(3)}%) — favorable entry point.`);
    } else if (pctFromLow >= 2.0) {
      score -= 1;
      reasons.push(`Rate is ${pctFromLow.toFixed(1)}% above its 30-day low (${min30.toFixed(3)}%) — may be worth waiting for a pullback.`);
    }
  }

  // FOMC risk factor
  if (fomcLevel === 'HIGH') {
    score += 2;
    reasons.push(`Fed meeting is imminent (${fomcRisk.nextMeeting.daysAway} days) — high volatility risk. Locking now avoids rate spike exposure.`);
  } else if (fomcLevel === 'ELEVATED') {
    score += 1;
    reasons.push(`Fed meeting in ${fomcRisk.nextMeeting.daysAway} days — elevated uncertainty ahead.`);
  }

  // Sentiment factor
  if (sentimentDir.includes('Hawkish')) {
    score += 1;
    reasons.push('News sentiment is hawkish — market expectations lean toward rate increases.');
  } else if (sentimentDir.includes('Dovish')) {
    score -= 1;
    reasons.push('News sentiment is dovish — market expectations lean toward rate cuts or stability.');
  }

  let verdict, color;
  if (score >= 4) {
    verdict = 'LOCK NOW';
    color   = '#dc2626';
  } else if (score <= -2) {
    verdict = 'WAIT';
    color   = '#16a34a';
  } else {
    verdict = 'MONITOR';
    color   = '#d97706';
  }

  return {
    verdict,
    color,
    score,
    reasons: reasons.slice(0, 3),
    stats: { current, avg7, avg30, avg60, min30, max30, min90, max90, trend: trend.label, trendArrow: trend.arrow },
    weeklySnapshot: weeklySnapshot(entries),
  };
}

module.exports = { updateHistory, recommend, loadHistory };
