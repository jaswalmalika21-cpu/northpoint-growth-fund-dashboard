// netlify/functions/history.js
//
// Server-side proxy to Finnhub's daily candle endpoint, used for sparklines
// and the "illustrative portfolio value over time" chart. Same key, same
// never-invent rules as quotes.js: every failure returns an explicit
// { ok: false, error } object instead of a guessed series.
//
// IMPORTANT CAVEAT (flagging this honestly rather than asserting it works):
// Finnhub's free-tier API key has, at various points, restricted the
// /stock/candle endpoint for US equities to paid plans, returning a 403.
// This code handles that case explicitly (treats it as ok:false with the
// real error message passed through) rather than crashing or faking data.
// If every ticker comes back ok:false with a 403-style message, that means
// your Finnhub plan doesn't include historical candles — check
// https://finnhub.io/docs/api/stock-candles and your account's plan page to
// confirm before assuming the code is broken.
//
// Endpoint: https://finnhub.io/api/v1/stock/candle?symbol=TICKER&resolution=D&from=...&to=...&token=KEY

const FINNHUB_CANDLE_URL = "https://finnhub.io/api/v1/stock/candle";

async function fetchOneHistory(ticker, apiKey, fromUnix, toUnix) {
  const url = `${FINNHUB_CANDLE_URL}?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${fromUnix}&to=${toUnix}&token=${apiKey}`;

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

  if (!data || data.s !== "ok" || !Array.isArray(data.c) || data.c.length === 0) {
    return { ticker, ok: false, error: `no_candle_data (status field: ${data && data.s})` };
  }

  return {
    ticker,
    ok: true,
    closes: data.c,
    highs: data.h,
    lows: data.l,
    times: data.t,
  };
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

  // Default widened to ~370 days so one fetch covers sparklines, the
  // portfolio-value chart, per-holding chart range buttons (5D..1Y), and a
  // real (not invented) 52-week high/low computed from these same candles.
  const daysParam = (event.queryStringParameters && event.queryStringParameters.days) || "370";
  const days = Math.max(5, Math.min(400, parseInt(daysParam, 10) || 370));

  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - days * 24 * 60 * 60;

  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const series = await Promise.all(tickers.map((t) => fetchOneHistory(t, apiKey, fromSec, nowSec)));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ fetchedAt, series }),
  };
};
