// netlify/functions/td-history.js
//
// Server-side proxy to Twelve Data's /time_series endpoint. This REPLACES
// history.js (Finnhub /stock/candle) as the data source for real
// price-history line charts, because the Finnhub key used on this project
// returns an HTTP 403 on /stock/candle on its current (free) plan — see the
// comments in history.js and README.md for that diagnosis. history.js is
// left in the repo but is not called by the frontend anymore.
//
// Endpoint docs (read directly, not from memory, on 2026-06-24):
//   https://twelvedata.com/docs#time-series
// Endpoint: https://api.twelvedata.com/time_series
// Params used here: symbol, interval=1day, outputsize, apikey.
//
// IMPORTANT — verified response shape from the docs above:
//   Success: { meta: {...}, values: [ { datetime, open, high, low, close,
//     volume }, ... ], status: "ok" }. The "values" array is sorted
//   DESCENDING by time (most recent first), and every OHLCV field is a
//   STRING, not a number — both handled explicitly below.
//   Error: { code, message, status: "error" }.
//
// IMPORTANT — credit/rate-limit uncertainty (flagging honestly): Twelve
// Data's own docs state time_series costs "1 API credit per symbol" but the
// docs page only says "check your dashboard" for the actual per-plan
// rate/credit limits — it does not state a specific free-tier number on the
// page that was fetched for this build. To stay well under any reasonable
// free-tier per-minute limit, this function fetches tickers SEQUENTIALLY
// with a short delay between requests rather than firing them all at once
// like the Finnhub-backed functions do. If you see "error" entries for
// every ticker, check https://twelvedata.com/pricing and your own
// dashboard's usage/limits page before assuming this code is broken.

const TD_TIME_SERIES_URL = "https://api.twelvedata.com/time_series";
const STAGGER_MS = 600; // spacing between sequential requests, see note above

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOneHistory(ticker, apiKey, outputsize) {
  const url = `${TD_TIME_SERIES_URL}?symbol=${encodeURIComponent(ticker)}&interval=1day&outputsize=${outputsize}&apikey=${apiKey}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ticker, ok: false, error: `network_error: ${err.message}` };
  }

  if (!res.ok) {
    let bodyText = "";
    try { bodyText = await res.text(); } catch (_) {}
    return { ticker, ok: false, error: `http_error_${res.status}${bodyText ? `: ${bodyText.slice(0, 160)}` : ""}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { ticker, ok: false, error: "invalid_json_from_twelvedata" };
  }

  if (!data || data.status === "error") {
    const msg = (data && data.message) || "unknown_twelvedata_error";
    return { ticker, ok: false, error: `twelvedata_error${data && data.code ? `_${data.code}` : ""}: ${msg}` };
  }

  if (!Array.isArray(data.values) || data.values.length === 0) {
    return { ticker, ok: false, error: "no_time_series_values_returned" };
  }

  // Twelve Data returns values descending by time (most recent first) and
  // every field as a string — reverse to ascending and parseFloat each
  // numeric field so this matches the shape the frontend already expects
  // from history.js (closes/highs/lows ascending, times in unix seconds).
  const ascending = data.values.slice().reverse();

  const closes = [];
  const highs = [];
  const lows = [];
  const times = [];
  for (const row of ascending) {
    const close = parseFloat(row.close);
    const high = parseFloat(row.high);
    const low = parseFloat(row.low);
    const t = Date.parse(`${row.datetime}T00:00:00Z`) / 1000;
    if (!Number.isFinite(close) || !Number.isFinite(t)) continue; // skip malformed rows rather than inventing a value
    closes.push(close);
    highs.push(Number.isFinite(high) ? high : close);
    lows.push(Number.isFinite(low) ? low : close);
    times.push(t);
  }

  if (closes.length === 0) {
    return { ticker, ok: false, error: "all_rows_malformed_after_parsing" };
  }

  return { ticker, ok: true, closes, highs, lows, times };
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  const apiKey = process.env.TWELVEDATA_KEY;
  const fetchedAt = new Date().toISOString();

  if (!apiKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        fetchedAt,
        error: "TWELVEDATA_KEY is not configured on the server. Add it in Netlify under Project configuration -> Environment variables, then redeploy.",
        series: [],
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

  const daysParam = (event.queryStringParameters && event.queryStringParameters.days) || "370";
  const days = Math.max(5, Math.min(5000, parseInt(daysParam, 10) || 370));

  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  // Sequential, staggered requests (see STAGGER_MS note above) instead of
  // Promise.all, to avoid bursting past an unconfirmed free-tier per-minute
  // request cap when this fund has 7 holdings.
  const series = [];
  for (let i = 0; i < tickers.length; i++) {
    if (i > 0) await sleep(STAGGER_MS);
    series.push(await fetchOneHistory(tickers[i], apiKey, days));
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ fetchedAt, series }),
  };
};
