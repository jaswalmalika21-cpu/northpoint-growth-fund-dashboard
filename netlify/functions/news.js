// netlify/functions/news.js
//
// Server-side proxy to Finnhub's company-news endpoint. Used to show recent
// headlines per holding (and an aggregated feed across all holdings on the
// Overview tab) without exposing the API key to the browser.
//
// Endpoint: https://finnhub.io/api/v1/company-news?symbol=TICKER&from=YYYY-MM-DD&to=YYYY-MM-DD&token=KEY
// This endpoint is NOT restricted on Finnhub's free tier as of this build
// (unlike /stock/candle) — but Finnhub's plan terms can change, so if every
// ticker comes back ok:false here, check https://finnhub.io/docs/api/company-news
// and your account's plan page before assuming the code is broken.
//
// We request the last 14 days by default and return only the most recent
// few articles per ticker (sorted newest first) to keep the payload small —
// never inventing a headline, summary, or date that Finnhub didn't return.

const FINNHUB_NEWS_URL = "https://finnhub.io/api/v1/company-news";
const MAX_ARTICLES_PER_TICKER = 6;
const DEFAULT_LOOKBACK_DAYS = 14;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchOneNews(ticker, from, to, apiKey) {
  const url = `${FINNHUB_NEWS_URL}?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}&token=${apiKey}`;

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
    // Not necessarily an error — could just mean no news in this window.
    return { ticker, ok: true, articles: [], note: `No news found for ${ticker} in the requested date range.` };
  }

  const articles = [...data]
    .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
    .slice(0, MAX_ARTICLES_PER_TICKER)
    .map((a) => ({
      headline: a.headline ?? null,
      summary: a.summary ?? null,
      source: a.source ?? null,
      url: a.url ?? null,
      datetime: typeof a.datetime === "number" ? a.datetime * 1000 : null, // Finnhub gives unix seconds; convert to ms for JS Date
      image: a.image || null,
    }));

  return { ticker, ok: true, articles };
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
        news: [],
      }),
    };
  }

  const params = event.queryStringParameters || {};
  const tickersParam = params.tickers;
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

  const now = new Date();
  const lookbackDays = params.days ? parseInt(params.days, 10) : DEFAULT_LOOKBACK_DAYS;
  const from = isoDate(new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000));
  const to = isoDate(now);

  const news = await Promise.all(tickers.map((t) => fetchOneNews(t, from, to, apiKey)));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ fetchedAt, from, to, news }),
  };
};
