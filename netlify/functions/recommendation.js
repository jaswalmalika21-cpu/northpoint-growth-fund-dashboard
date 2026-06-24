// netlify/functions/recommendation.js
//
// Server-side proxy to Finnhub's recommendation-trends endpoint. Used to
// show how many analysts rate each holding Strong Buy / Buy / Hold / Sell /
// Strong Sell, by period — a real third-party signal we can chart without
// needing the blocked /stock/candle endpoint.
//
// Endpoint: https://finnhub.io/api/v1/stock/recommendation?symbol=TICKER&token=KEY
// Generally available on Finnhub's free tier as of this build, but plan
// terms (and the exact field names below) can change — if every ticker
// comes back ok:false, or the counts look wrong, check
// https://finnhub.io/docs/api/recommendation-trends before assuming the
// code is broken. This function does not compute or invent a consensus
// rating itself — it passes through Finnhub's own per-period counts.

const FINNHUB_RECOMMENDATION_URL = "https://finnhub.io/api/v1/stock/recommendation";
const MAX_PERIODS = 6;

async function fetchOneRecommendation(ticker, apiKey) {
  const url = `${FINNHUB_RECOMMENDATION_URL}?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ticker, ok: false, error: `network_error: ${err.message}` };
  }

  if (!res.ok) {
    let bodyText = "";
    try { bodyText = await res.text(); } catch (_) {}
    return { ticker, ok: false, error: `http_error_${res.status}${bodyText ? `: ${bodyText.slice(0, 120)}` : ""}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { ticker, ok: false, error: "invalid_json_from_finnhub" };
  }

  if (!Array.isArray(data)) {
    return { ticker, ok: false, error: "unexpected_response_shape_from_finnhub" };
  }

  if (data.length === 0) {
    return { ticker, ok: true, periods: [], note: `Finnhub returned no recommendation-trend data for ${ticker}.` };
  }

  // Finnhub returns periods newest-first already, per their docs as of this
  // build — sorted defensively here too in case that ordering ever changes.
  const periods = [...data]
    .sort((a, b) => new Date(b.period) - new Date(a.period))
    .slice(0, MAX_PERIODS)
    .map((p) => ({
      period: p.period ?? null,
      strongBuy: typeof p.strongBuy === "number" ? p.strongBuy : null,
      buy: typeof p.buy === "number" ? p.buy : null,
      hold: typeof p.hold === "number" ? p.hold : null,
      sell: typeof p.sell === "number" ? p.sell : null,
      strongSell: typeof p.strongSell === "number" ? p.strongSell : null,
    }));

  return { ticker, ok: true, periods };
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  const apiKey = process.env.FINNHUB_KEY;
  const fetchedAt = new Date().toISOString();

  if (!apiKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        fetchedAt,
        error: "FINNHUB_KEY is not configured on the server. Add it in Netlify under Project configuration -> Environment variables, then redeploy.",
        recommendations: [],
      }),
    };
  }

  const tickersParam = event.queryStringParameters && event.queryStringParameters.tickers;
  if (!tickersParam) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ fetchedAt, error: "Missing required 'tickers' query parameter (comma-separated)." }),
    };
  }

  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const recommendations = await Promise.all(tickers.map((t) => fetchOneRecommendation(t, apiKey)));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ fetchedAt, recommendations }),
  };
};
