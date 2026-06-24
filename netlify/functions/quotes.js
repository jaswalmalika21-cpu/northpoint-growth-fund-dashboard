// netlify/functions/quotes.js
//
// Server-side proxy to the Finnhub quote endpoint. This is the ONLY place
// in this project that talks to Finnhub. The browser never sees the API key.
//
// Reads the key from the FINNHUB_KEY environment variable ONLY:
//   - never hard-coded here
//   - never logged or echoed back in any response
//   - never accepted as a query param / request body field
//
// Set FINNHUB_KEY in Netlify: Project configuration -> Environment variables
// (scope it to "Functions"), then trigger a redeploy.
//
// Endpoint used: https://finnhub.io/api/v1/quote?symbol=TICKER&token=KEY
// This matches Finnhub's free-tier quote endpoint as of this build. If quotes
// stop working after Finnhub changes their API, check https://finnhub.io/docs/api
// for the current spec before assuming this code is wrong.

const FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote";

async function fetchOneQuote(ticker, apiKey) {
  const url = `${FINNHUB_QUOTE_URL}?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ticker, ok: false, error: `network_error: ${err.message}` };
  }

  if (!res.ok) {
    return { ticker, ok: false, error: `http_error_${res.status}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { ticker, ok: false, error: "invalid_json_from_finnhub" };
  }

  // Finnhub returns all-zero/blank fields for an unresolved symbol rather
  // than an HTTP error, so check for that explicitly instead of trusting a 200.
  const fields = [data?.c, data?.d, data?.dp, data?.pc];
  const looksEmpty = !data || fields.every((v) => v === 0 || v === null || v === undefined);
  if (looksEmpty) {
    return { ticker, ok: false, error: "symbol_not_resolved_or_no_data" };
  }

  return {
    ticker,
    ok: true,
    c: data.c, // current price
    d: data.d, // change
    dp: data.dp, // percent change
    pc: data.pc, // previous close
    h: data.h, // today's high
    l: data.l, // today's low
    o: data.o, // today's open
    t: data.t, // quote timestamp (unix seconds)
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
    // Explicit error state — never fall back to a guessed or cached price.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        fetchedAt,
        error: "FINNHUB_KEY is not configured on the server. Add it in Netlify under Project configuration -> Environment variables, then redeploy.",
        quotes: [],
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

  const quotes = await Promise.all(tickers.map((t) => fetchOneQuote(t, apiKey)));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ fetchedAt, quotes }),
  };
};
