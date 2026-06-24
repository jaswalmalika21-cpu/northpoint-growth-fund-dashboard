// netlify/functions/metrics.js
//
// Server-side proxy to Finnhub's "basic financials" endpoint. This exists as
// a FALLBACK data source for two things that are currently broken on this
// deployment because /stock/candle appears to be plan-restricted:
//
//   1. A real 52-week high/low snapshot (Finnhub computes this separately
//      from candle history, and it is sometimes available on plans that
//      don't include full historical candles).
//   2. A handful of fundamentals (P/E, margins, ROE, growth) that could
//      power a bar/radar "fundamentals snapshot" chart as a substitute for
//      a price-history chart, if candle data stays unavailable.
//
// Endpoint: https://finnhub.io/api/v1/stock/metric?symbol=TICKER&metric=all&token=KEY
//
// IMPORTANT — field-name uncertainty: the exact field names Finnhub returns
// inside the "metric" object (e.g. "52WeekHigh", "peNormalizedAnnual",
// "netProfitMarginTTM", "roeTTM") are NOT 100% certain from memory and have
// changed/varied across Finnhub's docs versions. This function does NOT
// assume any specific field exists. It tries a short list of plausible
// candidate keys for each value, takes the first one that is a finite
// number, and otherwise reports that field as unavailable. It never
// invents or estimates a number — verify the exact current field names at
// https://finnhub.io/docs/api/company-basic-financials before trusting any
// single field name in code or in a report.

const FINNHUB_METRIC_URL = "https://finnhub.io/api/v1/stock/metric";

// For each logical value we want, list candidate Finnhub field names in
// rough order of how likely they are to be correct, based on Finnhub's
// publicly documented metric names as of this build. Because this list is
// built from memory, it should be treated as a best-effort guess, not a
// verified spec.
const FIELD_CANDIDATES = {
  week52High: ["52WeekHigh"],
  week52Low: ["52WeekLow"],
  peTTM: ["peNormalizedAnnual", "peTTM", "peExclExtraTTM", "peBasicExclExtraTTM"],
  netMarginTTM: ["netProfitMarginTTM", "netProfitMarginAnnual"],
  roeTTM: ["roeTTM", "roeRfy"],
  roaTTM: ["roaTTM", "roaRfy"],
  revenueGrowthTTM: ["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"],
  epsGrowthTTM: ["epsGrowthTTMYoy", "epsGrowthQuarterlyYoy"],
  debtToEquity: ["totalDebtToEquityAnnual", "totalDebtToEquityQuarterly"],
  grossMarginTTM: ["grossMarginTTM", "grossMarginAnnual"],
};

function firstFiniteValue(metricObj, candidateKeys) {
  if (!metricObj) return null;
  for (const key of candidateKeys) {
    const v = metricObj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

async function fetchOneMetric(ticker, apiKey) {
  const url = `${FINNHUB_METRIC_URL}?symbol=${encodeURIComponent(ticker)}&metric=all&token=${apiKey}`;

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

  const metric = data && data.metric;
  if (!metric || typeof metric !== "object" || Object.keys(metric).length === 0) {
    return { ticker, ok: false, error: "no_metric_data_or_plan_restricted" };
  }

  const values = {};
  const fieldsFound = {};
  for (const [logicalName, candidates] of Object.entries(FIELD_CANDIDATES)) {
    const v = firstFiniteValue(metric, candidates);
    values[logicalName] = v; // null if none of the candidate keys resolved to a finite number
    fieldsFound[logicalName] = v !== null;
  }

  return {
    ticker,
    ok: true,
    values,
    fieldsFound, // lets the UI show "data not available" per-field instead of guessing
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
        metrics: [],
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

  const metrics = await Promise.all(tickers.map((t) => fetchOneMetric(t, apiKey)));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ fetchedAt, metrics }),
  };
};
