# Northpoint Growth Fund — Investment Dashboard

Live dashboard for the Northpoint Growth Fund (AFM 241 Assignment 2): Overview, Holdings, Allocation, and Mandate
tabs, built as a static frontend (`public/`) plus one Netlify serverless function (`netlify/functions/quotes.js`)
that proxies live quotes from Finnhub.

## Architecture

```
Browser (public/index.html)
   |
   |  fetch("/.netlify/functions/quotes?tickers=...")
   v
Netlify Function (netlify/functions/quotes.js)
   |
   |  reads process.env.FINNHUB_KEY (server-side only)
   v
Finnhub quote API
```

The browser never calls Finnhub directly and never receives the API key. If a ticker's quote fails to fetch, that
row is flagged `DATA FETCH FAILED` rather than showing an invented number.

## Required environment variable

`FINNHUB_KEY` — set in Netlify under **Project configuration → Environment variables**, scoped to **Functions**.
Never committed to this repo; `.gitignore` excludes `.env`.

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
