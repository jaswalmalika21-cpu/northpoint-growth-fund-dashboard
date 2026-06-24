# Northpoint Growth Fund — Investment Dashboard

Live dashboard for the Northpoint Growth Fund (AFM 241 Assignment 2): Overview, Holdings, Allocation, and Mandate
tabs, built as a static frontend (`public/`) plus eight Netlify serverless functions in `netlify/functions/`:
`quotes.js`, `td-history.js`, `history.js` (unused legacy, see below), `profile.js`, `metrics.js`, `news.js`,
`peers.js`, and `recommendation.js`. Seven of these proxy live data from Finnhub; `td-history.js` proxies Twelve
Data.

Also includes: a disclaimer modal (shown every time the Overview tab is clicked, requiring "I Accept") with a
condensed version in the footer of every tab; a clickable per-holding detail view (real price-history line chart,
day's/52-week range, market cap, fundamentals, company profile, recent news, peers, and analyst recommendation
trends); a compare tool restricted to this fund's other holdings, with both a rebased price-history line chart and
a fundamentals bar chart; and Overview-tab widgets for today's movers, an aggregated news feed, sector exposure,
and a mandate concentration/risk snapshot.

## Two data providers, and why

Finnhub's free-tier key used for this project returns an HTTP 403 (`"You don't have access to this resource."`)
on `/stock/candle` (historical daily OHLC) — confirmed by calling the deployed `history` function directly in a
browser. This is a documented Finnhub free-tier restriction (see Finnhub's own docs/issue tracker if you want to
verify that yourself; plan terms can change, so don't take this as a permanent guarantee).

Rather than ship broken price-history line charts, this dashboard now pulls daily price history from **Twelve
Data** instead (`td-history.js`, calling `https://api.twelvedata.com/time_series`), and keeps Finnhub for
everything else:

- **Live quotes, company profile, peers, news, analyst recommendation trends** — Finnhub (`quotes.js`, `profile.js`,
  `peers.js`, `news.js`, `recommendation.js`). All unrestricted on this Finnhub plan as of this build.
- **52-week range and fundamentals (margins, ROE, ROA, growth, P/E, debt/equity)** — Finnhub's `/stock/metric`
  (`metrics.js`), also unrestricted on this plan. Still shown as its own "Fundamentals" section/chart alongside
  the price-history line chart, not in place of it.
- **Daily price history (line charts + sparklines)** — Twelve Data's `/time_series` endpoint (`td-history.js`),
  used at: the Spotlight card, the per-holding detail modal, the holdings-compare tool (as a rebased % line
  chart), and a small 1-month sparkline on each ticker-strip chip. Each of these has a range toggle (1M/3M/6M/1Y/
  Max) that slices the *same* fetched data client-side — switching ranges does not trigger another API call or
  spend another Twelve Data credit.
- `history.js` (the old Finnhub `/stock/candle` proxy) is left in the repo, unused, in case a future Finnhub plan
  on this key restores candle access — nothing currently calls it.

Every chart still follows the same rule as the rest of the project: if a provider doesn't return a field or a
ticker's history, the UI says so explicitly ("not available", "no data", "trend n/a", a missing line/bar) rather
than guessing or inventing a number.

**Honesty note on Twelve Data specifics, since these were verified from Twelve Data's own docs rather than memory,
but not exhaustively:** the `time_series` endpoint costs "1 API credit per symbol" per Twelve Data's own
parameter docs, but the docs page fetched for this build did not state a specific free-tier requests-per-minute or
credits-per-day number — it just says "check your dashboard." Because this fund has 7 holdings and that limit was
unconfirmed, `td-history.js` fetches tickers **sequentially with a short delay between requests** rather than all
at once, as a conservative precaution against an unknown rate cap. If the price charts work for some holdings but
not others (or stop working partway through a session), check your Twelve Data dashboard's usage page and
https://twelvedata.com/pricing for your plan's actual current limits before assuming the code is broken.

## Architecture

```
Browser (public/index.html)
   |
   |  fetch("/.netlify/functions/quotes?tickers=...")          -> current price, day change, day's high/low/open
   |  fetch("/.netlify/functions/td-history?tickers=...")      -> real daily OHLC price history (line charts)
   |  fetch("/.netlify/functions/profile?tickers=...")         -> company profile (industry, market cap, etc.)
   |  fetch("/.netlify/functions/metrics?tickers=...")         -> 52-week range + fundamentals (P/E, margins, growth)
   |  fetch("/.netlify/functions/news?tickers=...&days=14")    -> recent company news per ticker
   |  fetch("/.netlify/functions/peers?tickers=...")           -> Finnhub-classified peer/competitor lists
   |  fetch("/.netlify/functions/recommendation?tickers=...")  -> analyst recommendation trend counts by period
   v
Netlify Functions (netlify/functions/*.js)
   |
   |  read process.env.FINNHUB_KEY and process.env.TWELVEDATA_KEY (server-side only)
   v
Finnhub quote / profile / basic-financials / company-news / peers / recommendation-trends APIs
Twelve Data time_series API
```

The browser never calls Finnhub or Twelve Data directly and never receives either API key. Quotes and daily price
history are refetched on every "Refresh data" click (price history is unlikely to change within a session, but
refetching is cheap and keeps things simple); company profile, fundamentals/metrics, peers, and recommendation
trends are fetched once per page load since they change rarely (or only quarterly). If any of these fail for a
ticker, the dashboard flags it explicitly (`DATA FETCH FAILED` in the table, "not available" / "no data" / "trend
n/a" in the detail view and ticker strip, an explicit note on each chart) rather than showing an invented number.

**Known caveats:** Finnhub's free-tier key used for this project returns a 403 on `/stock/candle` for every ticker
— see above; that's why `td-history.js` exists. `/stock/metric`, `/stock/profile2`, `/company-news`, `/stock/peers`,
and `/stock/recommendation` have all worked on this Finnhub plan as of this build, but the exact field names
inside `/stock/metric`'s response are not 100% verified from memory (see the comments in `metrics.js`) — if a
fundamentals number looks wrong, check finnhub.io/docs/api/company-basic-financials before assuming the code is
broken. Twelve Data's exact free-tier rate/credit limits were not confirmed from its docs page beyond the
per-symbol credit cost noted above — check twelvedata.com/pricing. Both providers' plan terms and field names can
change over time regardless of what this build observed.

## Required environment variables

- `FINNHUB_KEY` — used by `quotes.js`, `profile.js`, `metrics.js`, `news.js`, `peers.js`, `recommendation.js`, and
  the unused legacy `history.js`.
- `TWELVEDATA_KEY` — used by `td-history.js` only. Sign up at twelvedata.com to get a free-tier key.

Set both in Netlify under **Project configuration → Environment variables**, scoped to **Functions**. Never
committed to this repo; `.gitignore` excludes `.env`.

## Local development

No build step. To preview the static frontend only (without live functions):

```bash
cd public && python3 -m http.server 8000
```

To run with the functions locally, use the Netlify CLI:

```bash
npm install -g netlify-cli
netlify dev
```

(`netlify dev` reads `FINNHUB_KEY` and `TWELVEDATA_KEY` from a local `.env` file if you create one — never commit
it.)

## Updating cost basis

`public/data/holdings.json` holds shares and cost basis per holding. Cost basis is currently provisional (set to
the live price on 2026-06-23). Update the `costBasis` fields to the actual June 26, 2026 close once that date has
passed, and update `costBasisAsOf` accordingly.
