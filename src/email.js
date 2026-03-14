/**
 * email.js — HTML email template and Gmail SMTP sender
 */
const nodemailer = require('nodemailer');
const { format } = require('date-fns');
const { calcROI, calcROIFromMortgage } = require('./roi');

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
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">VA Loan Close Deadline — April 30, 2026</div>
      <div style="font-size:42px;font-weight:900;color:${urgency};margin:4px 0;line-height:1">${daysLeft}</div>
      <div style="font-size:14px;color:#374151;font-weight:600">days remaining to lock</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// ROI break-even section (two columns)
// ---------------------------------------------------------------------------

function roiSection(rates) {
  if (!rates.vaIrrrEstimate) return '';
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const withCredits    = calcROI(rates.vaIrrrEstimate.high, 1600);
  const withoutCredits = calcROI(rates.vaIrrrEstimate.low,  6000);

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
              <td style="padding:4px 0;font-weight:700;text-align:right">$${fmt(roi.closingCosts)}</td>
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
        With credits = higher rate, lower upfront cost · Without credits = lowest rate, full closing costs · P&amp;I only, escrow unchanged
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// ROI history line chart (SVG, since March 1)
// ---------------------------------------------------------------------------

function roiChartSection(history) {
  if (!history || !history.entries) return '';

  // Build chart data: entries since March 1 with mortgage30 data
  const chartData = history.entries
    .filter(e => e.date >= '2026-03-01' && e.mortgage30 !== null)
    .map(e => {
      const r = calcROIFromMortgage(e.mortgage30);
      return {
        date:           e.date,
        withCredits:    r.withCredits.breakEvenMonths,
        withoutCredits: r.withoutCredits.breakEvenMonths,
      };
    })
    .filter(e => e.withCredits !== null && e.withoutCredits !== null);

  if (chartData.length < 2) {
    // Not enough data yet — show placeholder
    return `
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Break-Even History (Since Mar 1)</h3>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:24px;color:#6b7280;font-size:13px;text-align:center">
      Accumulating data — chart will appear once more weekly mortgage data is available.
    </div>`;
  }

  const W = 560, H = 200;
  const padL = 44, padR = 16, padT = 14, padB = 36;
  const pw = W - padL - padR;
  const ph = H - padT - padB;

  const allVals = chartData.flatMap(d => [d.withCredits, d.withoutCredits]);
  const rawMax  = Math.max(...allVals);
  const maxY    = Math.min(60, Math.ceil(rawMax / 5) * 5 + 5);
  const minY    = 0;
  const n       = chartData.length;

  const xScale  = (i) => padL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const yScale  = (v) => padT + ph - ((Math.min(v, maxY) - minY) / (maxY - minY)) * ph;

  const linePath = (key) =>
    chartData.map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d[key]).toFixed(1)}`).join(' ');

  const dots = (key, color) =>
    chartData.map((d, i) =>
      `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(d[key]).toFixed(1)}" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`
    ).join('');

  // Y-axis ticks every 5 months
  const yTicks = [];
  for (let v = 0; v <= maxY; v += 5) yTicks.push(v);

  const gridLines = yTicks
    .filter(v => v % 10 === 0)
    .map(v => `<line x1="${padL}" y1="${yScale(v).toFixed(1)}" x2="${padL + pw}" y2="${yScale(v).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`)
    .join('');

  const yAxisLabels = yTicks
    .filter(v => v % 10 === 0)
    .map(v => `<text x="${padL - 6}" y="${(yScale(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#9ca3af">${v}</text>`)
    .join('');

  // X-axis: show first, last, and up to 3 middle dates
  const xIdxs = [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1])].filter(i => i < n);
  const xLabels = xIdxs.map(i =>
    `<text x="${xScale(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#9ca3af">${chartData[i].date.slice(5)}</text>`
  ).join('');

  // 20-month target line
  const target20Y = yScale(20).toFixed(1);
  const targetLine = maxY >= 20
    ? `<line x1="${padL}" y1="${target20Y}" x2="${padL + pw}" y2="${target20Y}" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="5,3"/>
       <text x="${padL + pw + 2}" y="${(parseFloat(target20Y) + 4).toFixed(1)}" font-size="9" fill="#fbbf24" font-weight="bold">20mo</text>`
    : '';

  return `
    <h3 style="font-size:14px;font-weight:700;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Break-Even History (Since Mar 1)</h3>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:24px">
      <div style="font-size:11px;color:#6b7280;margin-bottom:6px">
        <span style="display:inline-block;width:16px;height:3px;background:#7c3aed;vertical-align:middle;margin-right:4px;border-radius:2px"></span>With Credits ($1,600) &nbsp;&nbsp;
        <span style="display:inline-block;width:16px;height:3px;background:#0369a1;vertical-align:middle;margin-right:4px;border-radius:2px"></span>Without Credits ($6,000) &nbsp;&nbsp;
        <span style="display:inline-block;width:16px;height:2px;background:#fbbf24;vertical-align:middle;margin-right:4px;border-style:dashed;border-top:2px dashed #fbbf24;height:0"></span>20mo target
      </div>
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
        ${gridLines}
        ${targetLine}
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + ph}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${padL}" y1="${padT + ph}" x2="${padL + pw}" y2="${padT + ph}" stroke="#d1d5db" stroke-width="1"/>
        <path d="${linePath('withCredits')}"    fill="none" stroke="#7c3aed" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath('withoutCredits')}" fill="none" stroke="#0369a1" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots('withCredits',    '#7c3aed')}
        ${dots('withoutCredits', '#0369a1')}
        ${yAxisLabels}
        ${xLabels}
        <text x="8" y="${(padT + ph / 2).toFixed(1)}" text-anchor="middle" font-size="9" fill="#9ca3af" transform="rotate(-90,8,${(padT + ph / 2).toFixed(1)})">Months</text>
      </svg>
    </div>`;
}

// ---------------------------------------------------------------------------
// Full HTML builder
// ---------------------------------------------------------------------------

function buildHtml({ rates, fomcRisk, sentiment, recommendation, economistComment, dateStr, history }) {
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
      <div style="font-size:11px;color:#6b7280;margin-top:4px">Based on Freddie Mac 30yr conventional average (MORTGAGE30US) minus 0.125%–0.375%. Actual VA rates vary by lender.</div>
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
      Current rate: ${withCredits.currentRate}% · Balance: $${fmt(withCredits.loanBalance)} · P&amp;I only, escrow unchanged
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
