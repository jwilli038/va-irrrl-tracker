/**
 * sentiment.js — News sentiment analysis for Fed/mortgage/rate environment
 * Sources:
 *   - Alpha Vantage NEWS_SENTIMENT (25 req/day free, 1 call used here)
 *   - NewsAPI.org (100 req/day free, 24h delay, 1 call used here)
 */
const axios = require('axios');

/**
 * Alpha Vantage: sentiment scores for Federal Reserve topic.
 * Returns aggregate score and top 5 headlines with individual scores.
 */
async function fetchAlphaVantageSentiment() {
  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    console.warn('ALPHA_VANTAGE_API_KEY not set — skipping AV sentiment');
    return null;
  }

  try {
    const res = await axios.get('https://www.alphavantage.co/query', {
      params: {
        function: 'NEWS_SENTIMENT',
        topics: 'FEDERAL_RESERVE',
        sort: 'LATEST',
        limit: 20,
        apikey: process.env.ALPHA_VANTAGE_API_KEY,
      },
      timeout: 12000,
    });

    const articles = res.data?.feed ?? [];
    if (articles.length === 0) return null;

    // Alpha Vantage provides per-article overall_sentiment_score (-1 to +1)
    // Positive = bullish for markets (dovish for rates = good for mortgage borrowers)
    // Negative = bearish for markets (hawkish for rates = bad for borrowers)
    const scored = articles
      .filter(a => a.overall_sentiment_score !== undefined)
      .map(a => ({
        title: a.title,
        source: a.source,
        url: a.url,
        publishedAt: a.time_published,
        score: parseFloat(a.overall_sentiment_score),
        label: a.overall_sentiment_label,
      }));

    if (scored.length === 0) return null;

    const avgScore = scored.reduce((sum, a) => sum + a.score, 0) / scored.length;

    // For rate watchers: negative market sentiment (hawkish) = rates up = bad for refi
    // Interpret: avgScore < -0.1 → Hawkish pressure, > 0.1 → Dovish pressure
    let rateSentimentLabel, rateSentimentDesc;
    if (avgScore > 0.15) {
      rateSentimentLabel = 'Dovish / Rate-Friendly';
      rateSentimentDesc = 'News sentiment suggests easing expectations — favorable for locking a lower rate.';
    } else if (avgScore < -0.15) {
      rateSentimentLabel = 'Hawkish / Rate-Adverse';
      rateSentimentDesc = 'News sentiment suggests tightening expectations — rates may face upward pressure.';
    } else {
      rateSentimentLabel = 'Neutral';
      rateSentimentDesc = 'Mixed signals from recent news — no strong directional bias.';
    }

    return {
      source: 'Alpha Vantage',
      avgScore: parseFloat(avgScore.toFixed(3)),
      rateSentimentLabel,
      rateSentimentDesc,
      topHeadlines: scored.slice(0, 5),
    };
  } catch (err) {
    console.warn('Alpha Vantage sentiment fetch failed (non-fatal):', err.message);
    return null;
  }
}

/**
 * NewsAPI: top headlines about Fed/mortgage/treasury rates.
 * Free tier has 24-hour delay and 100 req/day limit.
 */
async function fetchNewsApiHeadlines() {
  if (!process.env.NEWS_API_KEY) {
    console.warn('NEWS_API_KEY not set — skipping NewsAPI headlines');
    return [];
  }

  try {
    const res = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: '"federal reserve" OR "mortgage rates" OR "treasury rates" OR "interest rates" OR "FOMC"',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 10,
        apiKey: process.env.NEWS_API_KEY,
      },
      timeout: 10000,
    });

    return (res.data?.articles ?? []).slice(0, 5).map(a => ({
      title: a.title,
      source: a.source?.name,
      url: a.url,
      publishedAt: a.publishedAt,
    }));
  } catch (err) {
    console.warn('NewsAPI headlines fetch failed (non-fatal):', err.message);
    return [];
  }
}

/**
 * Main export: combined sentiment data from both sources.
 */
async function fetchSentiment() {
  console.log('Fetching news sentiment...');
  const [avSentiment, newsHeadlines] = await Promise.all([
    fetchAlphaVantageSentiment(),
    fetchNewsApiHeadlines(),
  ]);

  return {
    alphavantage: avSentiment,
    newsHeadlines,
    // Unified summary for the email
    summary: avSentiment
      ? {
          label: avSentiment.rateSentimentLabel,
          description: avSentiment.rateSentimentDesc,
          score: avSentiment.avgScore,
        }
      : { label: 'Unavailable', description: 'Sentiment data not available today.', score: null },
  };
}

module.exports = { fetchSentiment };
