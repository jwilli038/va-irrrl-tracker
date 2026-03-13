/**
 * email.js — HTML email template and Gmail SMTP sender
 */
const nodemailer = require('nodemailer');
const { format } = require('date-fns');
const { calcROI } = require('./roi');

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

function roiSection(rates) {
  if (!rates.vaIrrrEstimate) return '';
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // With credits: lower upfront cost ($1,600) but higher rate (lender credits offset closing costs)
  const withCredits    = calcROI(rates.vaIrrrEstimate.high, 1600);
  // Without credits: full closing costs ($4,337) but lowest available rate
  const withoutCredits = calcROI(rates.vaIrrrEstimate.low,  4337);

  function scenarioCol(roi, label, accentColor) {
    const savingsColor = roi.monthlySavings > 0 ? '#16a34a' : '#dc2626';
    const savingsSign  = roi.monthlySavings > 0 ? '−' : '+';
    const absSavings   = Math.abs(roi.monthlySavings);
    const breakEven    = roi.breakEvenMonths
      ? `<strong style="color:#1e40af">${roi.breakEvenMonths} mo (${roi.breakEvenYears} yrs)</strong>`
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
              <td style="padding:4px 0;color:#6b7280;font-weight:600">Break-Even</td>
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

function buildHtml({ rates, fomcRisk, sentiment, recommendation, economistComment, dateStr }) {
  const { curveShape } = require('./fomc');
  const curve = curveShape(rates.spreads.twoThirty);

  // Headline stats bar
  const headlineItems = [
    { label: '2yr Treasury', value: rateCell(rates.dgs2.value), badge: bpBadge(rates.dgs2.bpChange) },
    { label: '10yr Treasury', value: rateCell(rates.dgs10.value), badge: bpBadge(rates.dgs10.bpChange) },
    { label: '30yr Treasury', value: rateCell(rates.dgs30.value), badge: bpBadge(rates.dgs30.bpChange) },
    { label: '30yr Mortgage', value: rateCell(rates.mortgage30.value), badge: '' },
  ];

  const statsCells = headlineItems.map(item => `
    <td style="padding:12px 16px;border-right:1px solid #e5e7eb;text-align:center">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">${item.label}</div>
      <div style="font-size:22px;font-weight:700;color:#111827;margin:4px 0">${item.value}</div>
      <div style="font-size:12px">${item.badge}</div>
    </td>`).join('');

  // VA IRRRL estimate row
  const vaEst = rates.vaIrrrEstimate
    ? `<strong>${rates.vaIrrrEstimate.low.toFixed(3)}% – ${rates.vaIrrrEstimate.high.toFixed(3)}%</strong>`
    : '—';

  // Headlines list
  const allHeadlines = [
    ...(sentiment.alphavantage?.topHeadlines ?? []).map(h => ({ ...h, tag: 'AV' })),
    ...(sentiment.newsHeadlines ?? []).map(h => ({ ...h, tag: 'News' })),
  ].slice(0, 6);

  const headlineRows = allHeadlines.map(h =>
    `<li style="margin-bottom:8px"><a href="${h.url || '#'}" style="color:#1d4ed8;text-decoration:none">${h.title}</a>
     <span style="font-size:11px;color:#9ca3af;margin-left:6px">${h.source || h.tag}</span></li>`
  ).join('');

  // Recommendation reasons
  const reasonsList = recommendation.reasons.map(r =>
    `<li style="margin-bottom:6px">${r}</li>`
  ).join('');

  // Stats row
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

    <!-- 60-day rate table -->
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

async function sendEmail({ rates, fomcRisk, sentiment, recommendation, economistComment }) {
  const dateStr = format(new Date(), 'EEEE, MMMM d, yyyy');
  const subject = `VA IRRRL Watch ${format(new Date(), 'M/d')} | 30yr: ${rates.dgs30.value?.toFixed(3) ?? '?'}% | ${recommendation.verdict}`;

  const html = buildHtml({ rates, fomcRisk, sentiment, recommendation, economistComment, dateStr });

  // Jeff + Amy get emails every weekday
  const dailyRecipients = (process.env.RECIPIENT_EMAILS || '')
    .split(',').map(e => e.trim()).filter(Boolean);

  // Evan + Alec get emails on Tuesdays (2) and Thursdays (4) only
  const dayOfWeek = new Date().getDay();
  const isTueThu = dayOfWeek === 2 || dayOfWeek === 4;
  const ttRecipients = isTueThu
    ? (process.env.RECIPIENT_EMAILS_TT || '').split(',').map(e => e.trim()).filter(Boolean)
    : [];

  const recipients = [...dailyRecipients, ...ttRecipients];
  console.log(`  Recipients today (day ${dayOfWeek}): ${recipients.join(', ')}`);

  if (recipients.length === 0) {
    console.warn('No RECIPIENT_EMAILS configured — skipping email send.');
    return;
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('Gmail credentials not set — skipping email send. HTML preview saved to /tmp/preview.html');
    require('fs').writeFileSync('/tmp/preview.html', html);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const result = await transporter.sendMail({
    from: `VA IRRRL Watch <${process.env.GMAIL_USER}>`,
    to: recipients.join(', '),
    subject,
    html,
  });

  console.log('Email sent:', result.messageId, '→', recipients.join(', '));
}

module.exports = { sendEmail, buildHtml };
