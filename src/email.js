/**
 * email.js — HTML email template and Gmail SMTP sender
 */
const nodemailer = require('nodemailer');
const { format } = require('date-fns');
const { calcROI, calcROIFromMortgage, CLOSING_WITH_CREDITS, CLOSING_WITHOUT_CREDITS } = require('./roi');

// ---------------------------------------------------------------------------
// Utility badges / formatters
// ---------------------------------------------------------------------------

function bpBadge(bp) {
  if (bp === null || bp === undefined) return '<span style="color:#6b7280">—</span>';
  const sign = bp > 0 ? '+' : '';
  const color = bp > 0 ? '#dc2626' : bp < 0 ? '#16a34a' : '#6b7280';
  return `<span style="color:${color};font-weight:600">${sign}${bp} bps</span>`;
}

function rateCell(value) {
  return value !== null ? `${value.toFixed(3)}%` : '—';
}

function riskBadge(level) {
  const map = {
    HIGH:     { bg: '#fee2e2', color: '#991b1b', text: '🔴 HIGH' },
    ELEVATED: { bg: '#fef3c7', color: '#92400e', text: '🟡 ELEVATED' },
    LOW:      { bg: '#dcfce7', color: '#166534', text: '🟢 LOW' },
  };
  const s = map[level] || map.LOW;
  return `<span style="background:${s.bg};color:${s.color};padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px">${s.text}</span>`;
}

function sentimentBadge(label) {
  if (!label || label === 'Unavailable') return '<span style="color:#6b7280">Unavailable</span>';
  if (label.includes('Hawkish'))  return `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px">📈 ${label}</span>`;
  if (label.includes('Dovish'))   return `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px">📉 ${label}</span>`;
  return `<span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px">➡️ ${label}</span>`;
}

function verdictBanner(verdict, color) {
  const icons = { 'LOCK NOW': '🔒', 'WAIT': '⏳', 'MONITOR': '👀' };
  return `
    <div style="background:${color};color:#fff;text-align:center;padding:18px;border-radius:8px;margin-bottom:24px">
      <div style="font-size:28px;font-weight:900;letter-spacing:2px">${icons[verdict] || ''} ${verdict}</div>
      <div style="font-size:13px;margin-top:4px;opacity:0.9">VA IRRRL Rate Recommendation</div>
    </div>`;
}

function weeklyTable(snapshots) {
  if (!snapshots || snapshots.length === 0) return '<p style="color:#6b7280">Not enough history yet.</p>';
  const rows = snapshots.map(s => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">${s.date}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${s.dgs30 !== null ? s.dgs30.toFixed(3) + '%' : '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${s.dgs10 !== null ? s.dgs10.toFixed(3) + '%' : '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${s.mortgage30 !== null ? s.mortgage30.toFixed(3) + '%' : '—'}</td>
    </tr>`).join('');
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f3f4f6">
          <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d1d5db">Date</th>
          <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #d1d5db">30yr Treasury</th>
          <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #d1d5db">10yr Treasury</th>
          <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #d1d5db">30yr Mortgage</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------------------------------------------------------------------------
// Greeting / intro section
// ---------------------------------------------------------------------------

function greetingSection(recommendation) {
  const verdict  = recommendation.verdict;
  const reason   = recommendation.reasons?.[0] ?? 'conditions do not yet favor locking.';
  const iconMap  = { 'LOCK NOW': '🔒', 'WAIT': '⏳', 'MONITOR': '👀' };
  const icon     = iconMap[verdict] || '';
  const colorMap = { 'LOCK NOW': '#166534', 'WAIT': '#92400e', 'MONITOR': '#1e40af' };
  const color    = colorMap[verdict] || '#374151';

  return `
    <div style="background:#f8fafc;border-left:4px solid #1e3a5f;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px;font-size:14px;color:#374151;line-height:1.7">
      <strong>Greetings,</strong><br>
      These reports are sent every <strong>Tuesday and Thursday</strong>. Alerts will be sent separately if break-even ROIs drop into the teens (under 20 months).<br><br>
      <strong>Today's recommendation: <span style="color:${color}">${icon} ${verdict}</span></strong> — ${reason}
    </div>`;
}

// ---------------------------------------------------------------------------
// Countdown section
// ---------------------------------------------------------------------------

function countdownSection() {
  const deadline  = new Date('2026-04-30T23:59:59');
  const now       = new Date();
  const msLeft    = deadline - now;
  const daysLeft  = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  const urgency   = daysLeft <= 14 ? '#dc2626' : daysLeft <= 30 ? '#d97706' : '#1e40af';
  const bg        = daysLeft <= 14 ? '#fee2e2' : daysLeft <= 30 ? '#fef3c7' : '#eff6ff';
  const border    = daysLeft <= 14 ? '#fca5a5' : daysLeft <= 30 ? '#fde68a' : '#bfdbfe';

  return `
    <div style="background:${bg};border:2px solid ${border};border-radius:8px;padding:14px 18px;margin-bottom:24px;text-align:center">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">April 30, 2026</div>
      <div style="font-size:42px;font-weight:900;color:${urgency};margin:4px 0;line-height:1">${daysLeft}</div>
      <div style="font-size:14px;color:#374151;font-weight:600">days until eligible for refi</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// ROI break-even section (two columns)
// ---------------------------------------------------------------------------

function roiSection(rates) {
  if (!rates.vaIrrrEstimate) return '';
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // With credits:    VA rate high + $1,600 lender cost + $4,300 VA fee = $5,900
  // Without credits: VA rate low  + $3,600 lender cost + $4,300 VA fee = $7,900
  const withCredits    = calcROI(rates.vaIrrrEstimate.high, CLOSING_WITH_CREDITS);
  const withoutCredits = calcROI(rates.vaIrrrEstimate.low,  CLOSING_WITHOUT_CREDITS);

  function scenarioCol(roi, label, accentColor) {
    const savingsColor = roi.monthlySavings > 0 ? '#16a34a' : '#dc2626';
    const savingsSign  = roi.monthlySavings > 0 ? '−' : '+';
    const absSavings   = Math.abs(roi.monthlySavings);
    const beColor      = roi.breakEvenMonths && roi.breakEvenMonths <= 20 ? '#16a34a' : '#1e40af';
    const breakEven    = roi.breakEvenMonths
      ? `<strong style="color:${beColor};font-size:18px">${roi.breakEvenMonths} mo</strong>`
      : `<span style="color:#dc2626">N/A</span>`;

    return `
      <td style="padding:0;vertical-align:top;width:50%">
        <div style="border:2px solid ${accentColor};border-radius:8px;padding:14px;margin:0 4px">
          <div style="font-size:12px;font-weight:700;color:${accentColor};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;text-align:center">${label}</div>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr>
              <td style="padding:4px 0;color:#6b7280">Closing Costs</td>
              <td style="padding:4px 0;font-weight:700;text-align:right;font-size:15px">$${fmt(roi.closingCosts)}</td>
            </tr>
            <tr>
              <td style="padding:0 0 4px;color:#9ca3af;font-size:11px" colspan="2">${roi.closingCosts === CLOSING_WITH_CREDITS ? '$1,600 lender + $4,300 VA fee' : '$3,600 lender + $4,300 VA fee'}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280">New Rate</td>
              <td style="padding:4px 0;font-weight:700;text-align:right;color:${accentColor}">${roi.newRate.toFixed(3)}%</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280">New P&amp;I</td>
              <td style="padding:4px 0;font-weight:700;text-align:right">$${fmt(roi.newPI)}/mo</td>
            </tr>
            <tr style="border-top:1px solid #e5e7eb">
              <td style="padding:6px 0;color:#6b7280;font-weight:600">Monthly Savings</td>
              <td style="padding:6px 0;font-weight:700;text-align:right;font-size:15px;color:${savingsColor}">${savingsSign}$${fmt(absSavings)}/mo</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;font-weight:700">Break-Even</td>
              <td style="padding:4px 0;text-align:right">${breakEven}</td>
            </tr>
          </table>
        </div>
      </td>`;
  }

  return `
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Refinance ROI — Break-Even Analysis</h3>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:24px">
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
        <tr>
          <td style="padding:3px 8px;color:#6b7280">Current Loan Balance</td>
          <td style="padding:3px 8px;font-weight:600">$${fmt(withCredits.loanBalance)}</td>
          <td style="padding:3px 8px;color:#6b7280">Remaining Term</td>
          <td style="padding:3px 8px;font-weight:600">${Math.floor(withCredits.remainingMonths / 12)} yrs ${withCredits.remainingMonths % 12} mo</td>
        </tr>
        <tr>
          <td style="padding:3px 8px;color:#6b7280">Current Rate</td>
          <td style="padding:3px 8px;font-weight:600">${withCredits.currentRate.toFixed(3)}%</td>
          <td style="padding:3px 8px;color:#6b7280">Current P&amp;I</td>
          <td style="padding:3px 8px;font-weight:600">$${fmt(withCredits.currentPI)}/mo</td>
        </tr>
      </table>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          ${scenarioCol(withCredits,    '✦ With Lender Credits',    '#7c3aed')}
          ${scenarioCol(withoutCredits, '✦ Without Lender Credits', '#0369a1')}
        </tr>
      </table>
      <div style="font-size:11px;color:#9ca3af;margin-top:10px;text-align:center">
        With credits = higher rate, lower upfront cost · Without credits = lowest rate, full closing costs · P&amp;I only, escrow unchanged<br>
        Rate basis: <strong>${rates.vaIrrrEstimate?.basis ?? 'PMMS'}</strong> · ${rates.vaIrrrEstimate?.basis === 'DGS30' ? `DGS30 ${rates.dgs30.value?.toFixed(3)}% + ${rates.vaIrrrEstimate.avgSpread?.toFixed(3)}% avg spread = implied ${rates.vaIrrrEstimate.impliedMortgage?.toFixed(3)}% mortgage (updates daily)` : `Freddie Mac PMMS ${rates.mortgage30.value?.toFixed(3)}% (updates weekly)`}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// ROI history line chart — rendered as PNG via QuickChart.io (email-safe)
// ---------------------------------------------------------------------------

function roiChartSection(history) {
  if (!history || !history.entries) return '';

  // Compute average mortgage30-DGS30 spread from entries that have both
  const spreadSamples = history.entries.filter(e => e.dgs30 !== null && e.mortgage30 !== null);
  const avgSpread = spreadSamples.length > 0
    ? spreadSamples.reduce((s, e) => s + (e.mortgage30 - e.dgs30), 0) / spreadSamples.length
    : 1.30;

  // All weekdays Mar 1 → May 1 — populate actual data where available, null otherwise
  const allDays = [];
  const cur = new Date('2026-03-01T12:00:00Z');
  const end = new Date('2026-05-01T12:00:00Z');
  while (cur <= end) {
    if (cur.getUTCDay() !== 0 && cur.getUTCDay() !== 6) {
      allDays.push(cur.toISOString().slice(0, 10));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Build lookup from history
  const lookup = new Map();
  for (const e of history.entries) {
    if (e.date >= '2026-03-01' && e.dgs30 !== null) {
      const m30 = e.mortgage30 !== null
        ? e.mortgage30
        : parseFloat((e.dgs30 + avgSpread).toFixed(3));
      const r = calcROIFromMortgage(m30);
      if (r.withCredits.breakEvenMonths !== null) {
        lookup.set(e.date, {
          wc:  r.withCredits.breakEvenMonths,
          woc: r.withoutCredits.breakEvenMonths,
        });
      }
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const labels = allDays.map(d => {
    // Only label the 1st of each month
    return d.slice(8) === '01' ? d.slice(5, 10).replace('-', '/') : '';
  });

  const wcData  = allDays.map(d => lookup.has(d) ? lookup.get(d).wc  : null);
  const wocData = allDays.map(d => lookup.has(d) ? lookup.get(d).woc : null);

  const hasData = wcData.some(v => v !== null);
  if (!hasData) {
    return `
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Break-Even Trend (Mar 1 – May 1)</h3>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:24px;color:#6b7280;font-size:13px;text-align:center">
      No rate data since March 1 yet — check back after next pipeline run.
    </div>`;
  }

  // Build Chart.js 2 config for QuickChart
  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'With Credits ($5,900)',
          data: wcData,
          borderColor: '#7c3aed',
          pointBackgroundColor: '#7c3aed',
          fill: false,
          spanGaps: false,
          tension: 0.3,
          pointRadius: 3,
          borderWidth: 2,
        },
        {
          label: 'Without Credits ($7,900)',
          data: wocData,
          borderColor: '#0369a1',
          pointBackgroundColor: '#0369a1',
          fill: false,
          spanGaps: false,
          tension: 0.3,
          pointRadius: 3,
          borderWidth: 2,
        },
      ],
    },
    options: {
      legend: { position: 'top', labels: { fontSize: 11, boxWidth: 16 } },
      scales: {
        yAxes: [{
          ticks: { min: 0, stepSize: 10, fontSize: 10 },
          scaleLabel: { display: true, labelString: 'Break-Even (months)', fontSize: 10 },
          gridLines: { color: '#e5e7eb' },
        }],
        xAxes: [{
          ticks: { fontSize: 10, autoSkip: false },
          gridLines: { display: false },
        }],
      },
      annotation: {
        annotations: [{
          type: 'line',
          mode: 'horizontal',
          scaleID: 'y-axis-0',
          value: 20,
          borderColor: '#f59e0b',
          borderWidth: 2,
          borderDash: [6, 3],
          label: {
            enabled: true,
            content: '20mo target',
            backgroundColor: 'rgba(245,158,11,0.85)',
            fontSize: 10,
            position: 'right',
          },
        }],
      },
    },
  };

  const chartUrl = `https://quickchart.io/chart?w=520&h=220&bkg=white&c=${encodeURIComponent(JSON.stringify(cfg))}`;

  // Fallback table showing latest values
  const lastEntry = allDays.slice().reverse().find(d => lookup.has(d));
  const lastVals  = lastEntry ? lookup.get(lastEntry) : null;

  return `
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Break-Even Trend (Mar 1 – May 1)</h3>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:24px">
      <img src="${chartUrl}" width="520" height="220" alt="Break-even trend chart${lastVals ? ': With Credits ' + lastVals.wc + 'mo, Without Credits ' + lastVals.woc + 'mo' : ''}" style="display:block;max-width:100%;border-radius:4px">
      <div style="font-size:11px;color:#9ca3af;margin-top:6px;text-align:center">
        Dashed line = 20-month target · Points plotted for each trading day · Actual PMMS rate used when available, DGS30 estimate otherwise
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Full HTML builder
// ---------------------------------------------------------------------------

function buildHtml({ rates, fomcRisk, sentiment, recommendation, economistComment, dateStr, history, withCreditsBE, withoutCreditsBE }) {
  const { curveShape } = require('./fomc');
  const curve = curveShape(rates.spreads.twoThirty);

  const headlineItems = [
    { label: '2yr Treasury',  value: rateCell(rates.dgs2.value),      badge: bpBadge(rates.dgs2.bpChange) },
    { label: '10yr Treasury', value: rateCell(rates.dgs10.value),     badge: bpBadge(rates.dgs10.bpChange) },
    { label: '30yr Treasury', value: rateCell(rates.dgs30.value),     badge: bpBadge(rates.dgs30.bpChange) },
    { label: '30yr Mortgage', value: rateCell(rates.mortgage30.value), badge: '' },
  ];

  const statsCells = headlineItems.map(item => `
    <td style="padding:12px 16px;border-right:1px solid #e5e7eb;text-align:center">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">${item.label}</div>
      <div style="font-size:22px;font-weight:700;color:#111827;margin:4px 0">${item.value}</div>
      <div style="font-size:12px">${item.badge}</div>
    </td>`).join('');

  const vaEst = rates.vaIrrrEstimate
    ? `<strong>${rates.vaIrrrEstimate.low.toFixed(3)}% – ${rates.vaIrrrEstimate.high.toFixed(3)}%</strong>`
    : '—';

  const allHeadlines = [
    ...(sentiment.alphavantage?.topHeadlines ?? []).map(h => ({ ...h, tag: 'AV' })),
    ...(sentiment.newsHeadlines ?? []).map(h => ({ ...h, tag: 'News' })),
  ].slice(0, 6);

  const headlineRows = allHeadlines.map(h =>
    `<li style="margin-bottom:8px"><a href="${h.url || '#'}" style="color:#1d4ed8;text-decoration:none">${h.title}</a>
     <span style="font-size:11px;color:#9ca3af;margin-left:6px">${h.source || h.tag}</span></li>`
  ).join('');

  const reasonsList = recommendation.reasons.map(r =>
    `<li style="margin-bottom:6px">${r}</li>`
  ).join('');

  const stats = recommendation.stats || {};
  const statsRow = `
    <table style="width:100%;font-size:13px;border-collapse:collapse">
      <tr>
        <td style="padding:4px 8px;color:#6b7280">7-day avg</td><td style="padding:4px 8px;font-weight:600">${stats.avg7 ? stats.avg7 + '%' : '—'}</td>
        <td style="padding:4px 8px;color:#6b7280">30-day avg</td><td style="padding:4px 8px;font-weight:600">${stats.avg30 ? stats.avg30 + '%' : '—'}</td>
        <td style="padding:4px 8px;color:#6b7280">60-day avg</td><td style="padding:4px 8px;font-weight:600">${stats.avg60 ? stats.avg60 + '%' : '—'}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;color:#6b7280">30-day low</td><td style="padding:4px 8px;font-weight:600;color:#16a34a">${stats.min30 ? stats.min30 + '%' : '—'}</td>
        <td style="padding:4px 8px;color:#6b7280">30-day high</td><td style="padding:4px 8px;font-weight:600;color:#dc2626">${stats.max30 ? stats.max30 + '%' : '—'}</td>
        <td style="padding:4px 8px;color:#6b7280">5-day trend</td><td style="padding:4px 8px;font-weight:600">${stats.trend || '—'}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;color:#6b7280">90-day low</td><td style="padding:4px 8px;font-weight:600;color:#16a34a">${stats.min90 ? stats.min90 + '%' : '—'}</td>
        <td style="padding:4px 8px;color:#6b7280">90-day high</td><td style="padding:4px 8px;font-weight:600;color:#dc2626">${stats.max90 ? stats.max90 + '%' : '—'}</td>
        <td style="padding:4px 8px;color:#6b7280"></td><td></td>
      </tr>
    </table>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:0">
<div style="max-width:700px;margin:0 auto;background:#fff;border:1px solid #e5e7eb">

  <!-- Header -->
  <div style="background:#1e3a5f;color:#fff;padding:20px 24px">
    <div style="font-size:20px;font-weight:700">VA IRRRL Rate Watch</div>
    <div style="font-size:13px;opacity:0.8;margin-top:2px">${dateStr} · Daily Pipeline Report</div>
  </div>

  <div style="padding:24px">

    <!-- Verdict banner -->
    ${verdictBanner(recommendation.verdict, recommendation.color)}

    <!-- Greeting -->
    ${greetingSection(recommendation)}

    <!-- Countdown -->
    ${countdownSection()}

    <!-- Rate stats bar -->
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Current Rates</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px">
      <tr>${statsCells}</tr>
    </table>

    <!-- VA IRRRL estimate -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 18px;margin-bottom:24px">
      <div style="font-size:12px;color:#1e40af;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">Estimated VA IRRRL Rate Range</div>
      <div style="font-size:24px;color:#1e3a8a;margin-top:4px">${vaEst}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px">
        ${rates.vaIrrrEstimate?.basis === 'DGS30'
          ? `Derived from 30yr Treasury (DGS30 ${rates.dgs30.value?.toFixed(3)}%) + ${rates.vaIrrrEstimate.avgSpread?.toFixed(3)}% avg spread → implied ${rates.vaIrrrEstimate.impliedMortgage?.toFixed(3)}% mortgage, minus 0.125%–0.375%. Updates daily with Treasury moves.`
          : `Based on Freddie Mac PMMS (${rates.mortgage30.value?.toFixed(3)}%) minus 0.125%–0.375%. Updates weekly.`}
        Actual VA rates vary by lender.
      </div>
    </div>

    <!-- ROI break-even -->
    ${roiSection(rates)}

    <!-- ROI history chart -->
    ${roiChartSection(history)}

    <!-- Rate history table -->
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Rate History (Weekly Snapshots)</h3>
    <div style="margin-bottom:24px">${weeklyTable(recommendation.weeklySnapshot)}</div>

    <!-- Trend stats -->
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Trend Analysis</h3>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:24px">${statsRow}</div>

    <!-- Yield curve -->
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Yield Curve</h3>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;margin-bottom:24px">
      <div style="display:flex;gap:24px;flex-wrap:wrap">
        <div><span style="color:#6b7280;font-size:12px">2s30s Spread</span><br><strong>${rates.spreads.twoThirty !== null ? rates.spreads.twoThirty.toFixed(2) + '%' : '—'}</strong></div>
        <div><span style="color:#6b7280;font-size:12px">10s30s Spread</span><br><strong>${rates.spreads.tenThirty !== null ? rates.spreads.tenThirty.toFixed(2) + '%' : '—'}</strong></div>
        <div><span style="color:#6b7280;font-size:12px">Curve Shape</span><br><strong>${curve.label}</strong></div>
      </div>
      <div style="font-size:12px;color:#6b7280;margin-top:8px">${curve.description}</div>
    </div>

    <!-- Fed risk -->
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Fed Risk Assessment</h3>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;margin-bottom:24px">
      <div style="margin-bottom:8px">Risk Level: ${riskBadge(fomcRisk.riskLevel)}${fomcRisk.inFedBlackout ? ' &nbsp;<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:12px">FED BLACKOUT PERIOD</span>' : ''}</div>
      <div style="font-size:13px;color:#374151;margin-bottom:10px">${fomcRisk.riskReason}</div>
      ${fomcRisk.nextMeeting ? `
      <table style="font-size:13px;border-collapse:collapse">
        <tr><td style="color:#6b7280;padding-right:16px">Next FOMC:</td><td><strong>${fomcRisk.nextMeeting.label}</strong> (${fomcRisk.nextMeeting.date}) — ${fomcRisk.nextMeeting.daysAway} days away</td></tr>
        ${fomcRisk.followingMeeting ? `<tr><td style="color:#6b7280;padding-right:16px">Following:</td><td>${fomcRisk.followingMeeting.label} (${fomcRisk.followingMeeting.date})</td></tr>` : ''}
      </table>` : ''}
    </div>

    <!-- News sentiment -->
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Market Sentiment</h3>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;margin-bottom:24px">
      <div style="margin-bottom:8px">Overall: ${sentimentBadge(sentiment.summary.label)}</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:12px">${sentiment.summary.description}</div>
      ${allHeadlines.length > 0 ? `<ul style="margin:0;padding-left:18px;font-size:13px">${headlineRows}</ul>` : '<p style="color:#6b7280;font-size:13px">No headlines fetched today.</p>'}
    </div>

    <!-- Recommendation -->
    <div style="border:2px solid ${recommendation.color};border-radius:8px;padding:18px;margin-bottom:24px">
      <div style="font-size:16px;font-weight:700;color:${recommendation.color};margin-bottom:10px">Why ${recommendation.verdict}?</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.7">${reasonsList}</ul>
    </div>

    <!-- AI Economist Commentary -->
    ${economistComment ? `
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">AI Economic Analysis</h3>
    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:16px 18px;margin-bottom:24px">
      <div style="font-size:11px;color:#7c3aed;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">🤖 Claude AI · Senior Fixed-Income Economist</div>
      <div style="font-size:13px;color:#374151;line-height:1.8">${economistComment}</div>
    </div>` : ''}

  </div>

  <!-- Footer -->
  <div style="background:#f3f4f6;padding:14px 24px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb">
    VA IRRRL Rate Watch · Automated daily pipeline · Data: FRED, US Treasury, Alpha Vantage, NewsAPI<br>
    <em>This is not financial advice. Always consult a VA-approved lender before making refinancing decisions.</em>
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Alert email (urgent, sent separately when deadline near + ROI < 20 months)
// ---------------------------------------------------------------------------

function buildAlertHtml({ withCredits, withoutCredits, daysToDeadline, dateStr }) {
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const wcBe  = withCredits.breakEvenMonths;
  const wocBe = withoutCredits.breakEvenMonths;

  const row = (label, roi, accentColor) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600">${label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb">$${fmt(roi.closingCosts)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:${accentColor}">${roi.newRate.toFixed(3)}%</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#16a34a;font-weight:700">−$${fmt(Math.abs(roi.monthlySavings))}/mo</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:700;font-size:16px;color:#1e40af">${roi.breakEvenMonths} mo</td>
    </tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:0">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb">
  <div style="background:#dc2626;color:#fff;padding:20px 24px;text-align:center">
    <div style="font-size:24px;font-weight:900">🚨 VA IRRRL LOCK ALERT</div>
    <div style="font-size:14px;margin-top:4px;opacity:0.9">${dateStr} · Break-even under 20 months</div>
  </div>
  <div style="padding:24px">
    <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:14px 18px;margin-bottom:20px;text-align:center">
      <div style="font-size:13px;color:#991b1b;font-weight:600">CLOSE DEADLINE</div>
      <div style="font-size:36px;font-weight:900;color:#dc2626;line-height:1">${daysToDeadline}</div>
      <div style="font-size:14px;color:#991b1b;font-weight:600">days until April 30, 2026</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
      <thead>
        <tr style="background:#f3f4f6">
          <th style="padding:8px 14px;text-align:left">Scenario</th>
          <th style="padding:8px 14px;text-align:left">Closing Cost</th>
          <th style="padding:8px 14px;text-align:left">New Rate</th>
          <th style="padding:8px 14px;text-align:left">Mo. Savings</th>
          <th style="padding:8px 14px;text-align:left">Break-Even</th>
        </tr>
      </thead>
      <tbody>
        ${row('With Credits',    withCredits,    '#7c3aed')}
        ${row('Without Credits', withoutCredits, '#0369a1')}
      </tbody>
    </table>
    <div style="font-size:12px;color:#6b7280;font-style:italic">
      Current rate: ${withCredits.currentRate}% · Balance: $${fmt(withCredits.loanBalance)} · With credits = $1,600+$4,300 VA fee · Without = $3,600+$4,300 VA fee · P&amp;I only
    </div>
  </div>
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Transport helper (shared)
// ---------------------------------------------------------------------------

function makeTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

function getRecipients() {
  const daily  = (process.env.RECIPIENT_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  const dow    = new Date().getDay();
  const tueThu = dow === 2 || dow === 4
    ? (process.env.RECIPIENT_EMAILS_TT || '').split(',').map(e => e.trim()).filter(Boolean)
    : [];
  return [...daily, ...tueThu];
}

// ---------------------------------------------------------------------------
// sendEmail — main daily email
// Returns true if email was sent, false if skipped (no creds / no recipients)
// Throws on SMTP failure.
// ---------------------------------------------------------------------------

async function sendEmail({ rates, fomcRisk, sentiment, recommendation, economistComment, history }) {
  const dateStr    = format(new Date(), 'EEEE, MMMM d, yyyy');
  const subject    = `VA IRRRL Watch ${format(new Date(), 'M/d')} | 30yr: ${rates.dgs30.value?.toFixed(3) ?? '?'}% | ${recommendation.verdict}`;
  const html       = buildHtml({ rates, fomcRisk, sentiment, recommendation, economistComment, dateStr, history });
  const recipients = getRecipients();

  console.log(`  Day of week: ${new Date().getDay()} | Recipients: ${recipients.length > 0 ? recipients.join(', ') : 'NONE'}`);

  if (recipients.length === 0) {
    console.error('  ⚠ RECIPIENT_EMAILS not configured — email skipped.');
    return false;
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error('  ⚠ GMAIL_USER or GMAIL_APP_PASSWORD not set — email skipped.');
    // Save HTML for debugging
    require('fs').writeFileSync('/tmp/preview.html', html);
    return false;
  }

  console.log(`  Sending to: ${recipients.join(', ')}`);
  const result = await makeTransporter().sendMail({
    from: `VA IRRRL Watch <${process.env.GMAIL_USER}>`,
    to:   recipients.join(', '),
    subject,
    html,
  });
  console.log(`  ✓ Email sent: ${result.messageId}`);
  return true;
}

// ---------------------------------------------------------------------------
// sendAlertEmail — urgent deadline + ROI alert
// ---------------------------------------------------------------------------

async function sendAlertEmail({ withCredits, withoutCredits, daysToDeadline }) {
  const dateStr    = format(new Date(), 'EEEE, MMMM d, yyyy');
  const subject    = `🚨 VA IRRRL ALERT ${format(new Date(), 'M/d')} | Break-Even ${Math.min(withCredits.breakEvenMonths, withoutCredits.breakEvenMonths)}mo | ${daysToDeadline} days left`;
  const html       = buildAlertHtml({ withCredits, withoutCredits, daysToDeadline, dateStr });
  const daily      = (process.env.RECIPIENT_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

  if (daily.length === 0 || !process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('  Alert email skipped — missing credentials or recipients.');
    return false;
  }

  console.log(`  Sending ALERT to: ${daily.join(', ')}`);
  const result = await makeTransporter().sendMail({
    from: `VA IRRRL Watch <${process.env.GMAIL_USER}>`,
    to:   daily.join(', '),
    subject,
    html,
  });
  console.log(`  ✓ Alert sent: ${result.messageId}`);
  return true;
}

module.exports = { sendEmail, sendAlertEmail, buildHtml };
