/**
 * rates.js — Fetch treasury yields and mortgage rates
 * Primary source: FRED API
 * Backup/supplement: US Treasury XML API (no key needed)
 */
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { subDays, format } = require('date-fns');

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

async function fredFetch(seriesId, daysBack = 90) {
  const startDate = format(subDays(new Date(), daysBack), 'yyyy-MM-dd');
  const res = await axios.get(FRED_BASE, {
    params: {
      series_id: seriesId,
      api_key: process.env.FRED_API_KEY,
      file_type: 'json',
      observation_start: startDate,
      sort_order: 'desc',
      limit: daysBack,
    },
    timeout: 10000,
  });
  // Filter out missing values (FRED uses '.' for holidays/weekends)
  return res.data.observations.filter(o => o.value !== '.').map(o => ({
    date: o.date,
    value: parseFloat(o.value),
  }));
}

/**
 * Fetch full daily yield curve from US Treasury XML API (no key required).
 * Returns the most recent available entry with all maturities.
 */
async function fetchTreasuryCurve() {
  const year = new Date().getFullYear();
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });
    const parsed = parser.parse(res.data);

    // Navigate OData XML structure to get entries
    const feed = parsed?.feed?.entry;
    const entries = Array.isArray(feed) ? feed : feed ? [feed] : [];

    if (entries.length === 0) return null;

    // Get the most recent entry (last in list)
    const latest = entries[entries.length - 1];
    const props = latest?.content?.['m:properties'] || latest?.content?.properties;
    if (!props) return null;

    const get = (key) => {
      const val = props[`d:${key}`] ?? props[key];
      return val !== undefined && val !== '' ? parseFloat(val) : null;
    };

    return {
      date: props['d:NEW_DATE'] ?? props['NEW_DATE'],
      bc_1month:  get('BC_1MONTH'),
      bc_3month:  get('BC_3MONTH'),
      bc_6month:  get('BC_6MONTH'),
      bc_1year:   get('BC_1YEAR'),
      bc_2year:   get('BC_2YEAR'),
      bc_5year:   get('BC_5YEAR'),
      bc_10year:  get('BC_10YEAR'),
      bc_20year:  get('BC_20YEAR'),
      bc_30year:  get('BC_30YEAR'),
    };
  } catch (err) {
    console.warn('Treasury XML API fetch failed (non-fatal):', err.message);
    return null;
  }
}

/**
 * Main export: fetch all rate data needed for the pipeline.
 * Returns the most recent values plus historical arrays.
 */
async function fetchRates() {
  console.log('Fetching rates from FRED...');

  const [dgs30History, dgs10History, dgs2History, mortgageHistory, treasuryCurve] = await Promise.all([
    fredFetch('DGS30', 90),
    fredFetch('DGS10', 90),
    fredFetch('DGS2', 90),
    fredFetch('MORTGAGE30US', 70), // weekly, need ~10 weeks of buffer
    fetchTreasuryCurve(),
  ]);

  const latest = (arr) => arr[0] ?? null;
  const prev   = (arr) => arr[1] ?? null;

  const dgs30Now  = latest(dgs30History);
  const dgs30Prev = prev(dgs30History);
  const dgs10Now  = latest(dgs10History);
  const dgs2Now   = latest(dgs2History);
  const mortgage30Now = latest(mortgageHistory);

  // Daily change in basis points (1 bp = 0.01%)
  const bpChange = (now, prevVal) =>
    now && prevVal ? Math.round((now.value - prevVal.value) * 100) : null;

  // Compute average DGS30→MORTGAGE30 spread from history dates where both exist.
  // This lets us estimate the mortgage rate from the daily-updating DGS30.
  const spreadSamples = [];
  for (const m of mortgageHistory) {
    const dgs = dgs30History.find(d => d.date === m.date);
    if (dgs) spreadSamples.push(m.value - dgs.value);
  }
  const avgSpread = spreadSamples.length > 0
    ? parseFloat((spreadSamples.reduce((a, b) => a + b, 0) / spreadSamples.length).toFixed(3))
    : 1.75; // conservative fallback if no overlap data

  // Implied daily mortgage rate: DGS30 + avg spread (updates every trading day)
  const impliedMortgage = dgs30Now
    ? parseFloat((dgs30Now.value + avgSpread).toFixed(3))
    : null;

  // Use DGS30-implied rate as primary so ROI updates daily.
  // PMMS is kept for reference display only.
  const effectiveMortgage = impliedMortgage ?? mortgage30Now?.value ?? null;

  return {
    date: dgs30Now?.date ?? format(new Date(), 'yyyy-MM-dd'),
    dgs30: {
      value: dgs30Now?.value ?? null,
      prevValue: dgs30Prev?.value ?? null,
      bpChange: bpChange(dgs30Now, dgs30Prev),
      history: dgs30History,
    },
    dgs10: {
      value: dgs10Now?.value ?? null,
      bpChange: bpChange(dgs10Now, prev(dgs10History)),
      history: dgs10History,
    },
    dgs2: {
      value: dgs2Now?.value ?? null,
      bpChange: bpChange(dgs2Now, prev(dgs2History)),
      history: dgs2History,
    },
    mortgage30: {
      value: mortgage30Now?.value ?? null,
      history: mortgageHistory,
    },
    // VA IRRRL estimate — DGS30-based so it responds to daily Treasury moves.
    // avgSpread and impliedMortgage included for transparency in the email.
    vaIrrrEstimate: effectiveMortgage
      ? {
          low:            parseFloat((effectiveMortgage - 0.375).toFixed(3)),
          high:           parseFloat((effectiveMortgage - 0.125).toFixed(3)),
          basis:          impliedMortgage ? 'DGS30' : 'PMMS',
          impliedMortgage,
          avgSpread,
        }
      : null,
    treasuryCurve,
    // Yield curve spreads
    spreads: {
      twoThirty: dgs30Now && dgs2Now
        ? parseFloat((dgs30Now.value - dgs2Now.value).toFixed(2))
        : null,
      tenThirty: dgs30Now && dgs10Now
        ? parseFloat((dgs30Now.value - dgs10Now.value).toFixed(2))
        : null,
    },
  };
}

module.exports = { fetchRates };
