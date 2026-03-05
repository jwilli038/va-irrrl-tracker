/**
 * fomc.js — FOMC meeting calendar and Fed risk assessment
 *
 * Meeting dates are published by the Fed ~1 year in advance.
 * Update FOMC_MEETINGS each January with the new year's schedule.
 * Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 */
const { differenceInCalendarDays, parseISO, isAfter, isBefore, addDays } = require('date-fns');

// FOMC meeting end dates (day the policy statement is released, 2:00pm ET)
// Update this list each January.
const FOMC_MEETINGS = [
  // 2026
  { end: '2026-01-29', label: 'January 2026' },
  { end: '2026-03-19', label: 'March 2026' },
  { end: '2026-05-07', label: 'May 2026' },
  { end: '2026-06-18', label: 'June 2026' },
  { end: '2026-07-30', label: 'July 2026' },
  { end: '2026-09-17', label: 'September 2026' },
  { end: '2026-11-05', label: 'November 2026' },
  { end: '2026-12-17', label: 'December 2026' },
];

// Yield curve shape interpretation based on 2s30s spread
function curveShape(spread) {
  if (spread === null) return { label: 'Unknown', description: 'Insufficient data' };
  if (spread < -0.25) return { label: 'Inverted', description: 'Short rates above long rates — historically signals recession risk and Fed easing ahead' };
  if (spread < 0.25)  return { label: 'Flat', description: 'Curve is flat — market uncertain about growth/rate direction' };
  if (spread < 1.0)   return { label: 'Normal', description: 'Slightly positive slope — healthy but cautious market' };
  return { label: 'Steep', description: 'Wide spread — market pricing in future rate hikes or strong growth expectations' };
}

function getFomcRisk(today = new Date()) {
  // Find upcoming meetings (on or after today)
  const upcoming = FOMC_MEETINGS
    .map(m => ({ ...m, date: parseISO(m.end) }))
    .filter(m => isAfter(m.date, today) || m.end === today.toISOString().slice(0, 10))
    .sort((a, b) => a.date - b.date);

  if (upcoming.length === 0) {
    return {
      nextMeeting: null,
      daysUntilNext: null,
      followingMeeting: null,
      riskLevel: 'LOW',
      riskReason: 'No upcoming FOMC meetings found — update fomc.js for next year.',
    };
  }

  const next = upcoming[0];
  const daysUntil = differenceInCalendarDays(next.date, today);
  const following = upcoming[1] ?? null;

  let riskLevel, riskReason;
  if (daysUntil <= 14) {
    riskLevel = 'HIGH';
    riskReason = `FOMC meeting in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} — rate decision imminent. Significant rate volatility possible.`;
  } else if (daysUntil <= 30) {
    riskLevel = 'ELEVATED';
    riskReason = `FOMC meeting in ${daysUntil} days — pre-meeting rate speculation may increase volatility.`;
  } else {
    riskLevel = 'LOW';
    riskReason = `Next FOMC meeting is ${daysUntil} days away. Low near-term Fed policy risk.`;
  }

  // Blackout period: Fed officials don't speak 10 days before meeting
  const blackoutStart = addDays(next.date, -10);
  const inBlackout = isAfter(today, blackoutStart) && isBefore(today, next.date);

  return {
    nextMeeting: { date: next.end, label: next.label, daysAway: daysUntil },
    followingMeeting: following ? { date: following.end, label: following.label } : null,
    riskLevel,
    riskReason,
    inFedBlackout: inBlackout,
  };
}

module.exports = { getFomcRisk, curveShape };
