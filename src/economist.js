/**
 * economist.js — AI-powered economic commentary using Claude
 * Generates a concise fixed-income economist analysis of today's rate environment.
 * Requires ANTHROPIC_API_KEY secret in GitHub.
 */
const Anthropic = require('@anthropic-ai/sdk');

async function getEconomistCommentary({ rates, fomcRisk, sentiment, recommendation }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set — skipping economist commentary');
    return null;
  }

  const client = new Anthropic();

  const dataBlock = `
Current Rate Environment (${rates.date}):
- 30yr Treasury (DGS30): ${rates.dgs30.value}% (${rates.dgs30.bpChange > 0 ? '+' : ''}${rates.dgs30.bpChange} bps today)
- 10yr Treasury (DGS10): ${rates.dgs10.value}%
- 2yr Treasury (DGS2):   ${rates.dgs2.value}%
- 30yr Mortgage (Freddie Mac PMMS): ${rates.mortgage30.value}%
- Estimated VA IRRRL range: ${rates.vaIrrrEstimate ? `${rates.vaIrrrEstimate.low}% – ${rates.vaIrrrEstimate.high}%` : 'unavailable'}

Yield Curve:
- 2s30s spread: ${rates.spreads.twoThirty}% (${rates.spreads.twoThirty < 0 ? 'INVERTED' : rates.spreads.twoThirty < 0.5 ? 'flat' : 'normal/steep'})
- 10s30s spread: ${rates.spreads.tenThirty}%

Trend Analysis:
- 5-day trend: ${recommendation.stats?.trend ?? 'unknown'}
- 7-day avg DGS30: ${recommendation.stats?.avg7 ?? 'N/A'}%
- 30-day avg DGS30: ${recommendation.stats?.avg30 ?? 'N/A'}%
- 60-day avg DGS30: ${recommendation.stats?.avg60 ?? 'N/A'}%
- 30-day low/high: ${recommendation.stats?.min30 ?? 'N/A'}% / ${recommendation.stats?.max30 ?? 'N/A'}%

Fed Risk:
- Next FOMC: ${fomcRisk.nextMeeting?.label ?? 'Unknown'} (${fomcRisk.nextMeeting?.daysAway ?? '?'} days away)
- Risk level: ${fomcRisk.riskLevel}
- ${fomcRisk.riskReason}
${fomcRisk.inFedBlackout ? '- Currently in Fed communication blackout period' : ''}

Market Sentiment: ${sentiment.summary?.label ?? 'Neutral'}
Pipeline Recommendation: ${recommendation.verdict}
`.trim();

  const prompt = `You are a senior fixed-income economist advising a US military veteran on the optimal time to lock a VA IRRRL (Interest Rate Reduction Refinance Loan) — a VA mortgage refinance.

Given the following rate data, provide a 4-5 sentence economic assessment. Focus on:
1. What's driving the current rate level and near-term direction
2. Key risks (Fed policy, inflation, economic data) that could move rates in the next 60 days
3. A clear, plain-English conclusion on whether conditions favor locking now or waiting

Be direct and practical. No disclaimers. No bullet points — flowing prose only.

${dataBlock}`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0]?.text ?? null;
    console.log('  Economist commentary generated.');
    return text;
  } catch (err) {
    console.warn('Economist commentary failed (non-fatal):', err.message);
    return null;
  }
}

module.exports = { getEconomistCommentary };
