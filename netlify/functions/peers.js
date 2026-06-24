// netlify/functions/peers.js
//
// Server-side proxy to Finnhub's stock-peers endpoint. Used in the
// per-holding detail modal to show which other companies Finnhub classifies
// as peers/competitors. These are NOT holdings in this fund — they're shown
// for context only, and the UI must say so explicitly rather than implying
// they're part of the portfolio.
//
// Endpoint: https://finnhub.io/api/v1/stock/peers?symbol=TICKER&token=KEY
// Generally available on Finnhub's free tier as of this build, but plan
// terms can change — if every ticker comes back ok:false, check
// https://finnhub.io/docs/api/company-peers and your account's plan page
// before assuming the code is broken.

const FINNHUB_PEERS_URL = "https://finnhub.io/api/v1/stock/peers";
const MAX_PEERS = 8;

async function fetchOnePeerSet(ticker, apiKey) {
  const url = `${FINNHUB_PEERS_URL}?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;

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

  // Finnhub's peer list sometimes includes the requested ticker itself —
  // filter that out so the UI never lists a company as its own peer.
  const peers = data
    .map((p) => (typeof p === "string" ? p.toUpperCase() : null))
    .filter((p) => p && p !== ticker)
    .slice(0, MAX_PEERS);

  if (peers.length === 0) {
    return { ticker, ok: true, peers: [], note: `Finnhub returned no peer list for ${ticker}.` };
  }

  return { ticker, ok: true, peers };
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
        peerSets: [],
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

  const peerSets = await Promise.all(tickers.map((t) => fetchOnePeerSet(t, apiKey)));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ fetchedAt, peerSets }),
  };
};
