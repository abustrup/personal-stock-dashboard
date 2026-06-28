# Personal Stock Dashboard

Local decision-support dashboard for a medium-high-risk AI and tech portfolio.
Decision support, not licensed financial advice.

## What It Does

- Imports your Danish broker CSV and shows real position P&L (cost basis,
  total/!day return, weight) straight from the export.
- Pulls **real market data with no API keys** (prices, 52-week range and a
  measured momentum score) so rankings reflect the market, not hand-typed guesses.
- Scores holdings and curated global AI/tech opportunities, with action labels,
  conviction, reasoning, a downside case and data freshness.
- Flags EIFO compliance risk using only your policy PDF, and never claims a
  company is "clean".

## Run (no terminal)

Double-click **`Open Dashboard.command`** in Finder. It installs dependencies the
first time, refreshes prices, and opens the dashboard in your browser. Leave the
small window open while you use it; close it when you are done.

(First-ever launch may show a macOS security prompt: right-click the file →
**Open** → **Open**, just once.)

## Run (terminal, optional)

```bash
npm install
npm start        # refreshes nothing, opens the dashboard on :5173
npm run refresh  # pull the latest prices/momentum
npm test         # unit tests
npm run build    # typecheck + production build
```

## Market Data Refresh

The dashboard works offline on seed data, but for live prices and momentum run:

```bash
npm run refresh
```

This fetches keyless Yahoo Finance data (US, EU and Asian listings) for the whole
universe and writes `public/data/live-signals.json`, which the browser reads at
load time. Requires Node 22.6+ (the refresh imports the shared TypeScript
momentum model via native type stripping). The header shows whether the data on
screen is live or editorial-only.

### Optional news and analyst signals

News sentiment and analyst trends are optional and only run when keys are set:

```bash
export ALPHAVANTAGE_API_KEY=...   # news sentiment
export FINNHUB_API_KEY=...        # analyst recommendation trends
npm run refresh
```

Missing keys lower confidence and fall back to seed signals — they never break
the dashboard.

## Portfolio CSV

Built around the broker export in `sample/portfolio-sample.csv`. The importer
reads rows that have both `Symbol` and `ISIN`, skips broker summary rows like
`Aktier (6)`, and maps Danish fields (`Antal`, `Aktuel kurs`,
`Markedsværdi (DKK)`, `% Total afkast`, `% af portefølje`, …), handling the
UTF-8 BOM and comma decimals.

## Compliance (EIFO)

The model reflects the November 2024 policy:

- **Hard block** — the §9.3 permanent negative list (FLSmidth, NKT,
  Per Aarsleff Holding, Siemens Energy, Vestas), plus anything you mark as an
  EIFO **investment** (§9.1).
- **Restricted** — anything you mark as an EIFO **loan/guarantee** (§9.2):
  tradeable, but no sale within 6 months and no speculative derivatives.
- **Possible overlap** — a soft heuristic flag (Danish/Nordic domicile or
  EIFO-mandate themes). Worth checking against the monthly list.
- **Unknown** — the default. The app cannot see EIFO's investment/loan lists,
  so nothing is ever called "clean".

Record what you personally know in `src/data/complianceOverrides.ts`.
