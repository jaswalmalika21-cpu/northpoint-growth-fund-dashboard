# Northpoint Growth Fund — Investment Dashboard

Live dashboard for the Northpoint Growth Fund (AFM 241 Assignment 2): Overview, Holdings, Allocation, and Mandate
tabs, built as a static frontend (`public/`) plus three Netlify serverless functions
(`netlify/functions/quotes.js`, `history.js`, and `profile.js`) that proxy live quotes, historical daily candles,
and company profile data from Finnhub.

Also includes: a disclaimer modal (shown every time the Overview tab is clicked, requiring "I Accept") with a
condensed version in the footer of every tab; a clickable per-holding detail view (price, day's/52-week range,
market cap, company profile, historical chart with 5D/1M/3M/6M/1Y range buttons); a compare tool restricted to
this fund's other holdings; and Overview-tab widgets for today's movers, sector exposure, and a mandate
concentration/risk snapshot.

## Architecture

```
Browser (public/index.html)
   |
   |  fetch("/.netlify/functions/quotes?tickers=...")     -> current price, day change, day's high/low/open
   |  fetch("/.netlify/functions/history?tickers=...")    -> ~370 days of daily closes/highs/lows
   |  fetch("/.netlify/functions/profile?tickers=...")    -> company profile (industry, market cap, website, etc.)
   v
Netlify Functions (netlify/functions/quotes.js, history.js, profile.js)
   |
   |  read process.env.FINNHUB_KEY (server-side only)
   v
Finnhub quote API / candle API / company-profile API
```

The browser never calls Finnhub directly and never receives the API key. If a ticker's quote, history, or profile
fails to fetch, it's flagged (`DATA FETCH FAILED` in the table, "no history" on its sparkline/detail chart, an
explicit note on the Portfolio Value chart and in the detail modal's company-profile section) rather than showing
an invented number. The detail modal's 52-week high/low is computed directly from the same ~370-day history
candles already fetched for the chart — no separate "52-week" API call, and no invented figure.

**Known caveats on historical/profile data:** Finnhub's free-tier key has, at various points, restricted the
`/stock/candle` endpoint (sparklines, Portfolio Value chart, detail-view chart, compare chart) and the
`/stock/profile2` endpoint (company profile, market cap) to paid plans, returning a 403 or an empty object. The
code handles both gracefully — it shows "no history" / "profile data is not available right now" rather than
crashing — but if every ticker shows this, check your plan at finnhub.io before assuming the code is broken.

## Required environment variable

`FINNHUB_KEY` — set in Netlify under **Project configuration → Environment variables**, scoped to **Functions**.
Used by all three functions. Never committed to this repo; `.gitignore` excludes `.env`.

## Local development

No build step. To preview the static frontend only (without live functions):

```bash
cd public && python3 -m http.server 8000
```

To run with the function locally, use the Netlify CLI:

```bash
npm install -g netlify-cli
netlify dev
```

(`netlify dev` reads `FINNHUB_KEY` from a local `.env` file if you create one — never commit it.)

## Updating cost basis

`public/data/holdings.json` holds shares and cost basis per holding. Cost basis is currently provisional (set to
the live price on 2026-06-23). Update the `costBasis` fields to the actual June 26, 2026 close once that date has
passed, and update `costBasisAsOf` accordingly.
