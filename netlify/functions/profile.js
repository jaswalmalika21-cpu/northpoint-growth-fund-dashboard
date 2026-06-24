// netlify/functions/profile.js
//
// Server-side proxy to Finnhub's company profile endpoint, used to populate
// the per-holding detail view (company description, sector/industry,
// website, market cap, logo). Same key, same never-invent rules as
// quotes.js and history.js.
//
// Endpoint: https://finnhub.io/api/v1/stock/profile2?symbol=TICKER&token=KEY
// This is generally available on Finnhub's free tier, but Finnhub's plan
// terms can change — if every ticker comes back ok:false here, check
// https://finnhub.io/docs/api/company-profile2 and your account's plan page
// before assuming the code is broken.
//
// NOTE: Finnhub returns marketCapitalization in millions of the listed
// currency, per their docs as of this build. Verify that's still accurate
// if the displayed market cap looks off by a factor of 1,000,000.

const FINNHUB_PROFILE_URL = "https://finnhub.io/api/v1/stock/profile2";

async function fetchOneProfile(ticker, apiKey) {
  const url = `${FINNHUB_PROFILE_URL}?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;

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

  // Finnhub returns an empty object {} for an unresolved symbol rather than
  // an HTTP error.
  if (!data || Object.keys(data).length === 0) {
    return { ticker, ok: false, error: "no_profile_data_or_plan_restricted" };
  }

  return {
    ticker,
    ok: true,
    name: data.name ?? null,
    exchange: data.exchange ?? null,
    industry: data.finnhubIndustry ?? null, // Finnhub's own classification, not the same taxonomy as this fund's "sector" field
    country: data.country ?? null,
    currency: data.currency ?? null,
    weburl: data.weburl ?? null,
    logo: data.logo ?? null,
    ipo: data.ipo ?? null,
    marketCapitalizationMillions: data.marketCapitalization ?? null,
    shareOutstandingMillions: data.shareOutstanding ?? null,
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
        profiles: [],
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

  const profiles = await Promise.all(tickers.map((t) => fetchOneProfile(t, apiKey)));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ fetchedAt, profiles }),
  };
};
