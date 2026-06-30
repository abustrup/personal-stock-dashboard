# Watchlist → universe integration routine

Turns a name you flagged in the dashboard into a fully scored, curated company —
researched, added to `src/data/universe.ts`, market-refreshed, and shipped via a
pull request. Runs daily; you only ever tap "Submit" on a prefilled issue.

## How a name enters the queue

The dashboard's **Watch your own ideas** box keeps names in browser
`localStorage` only — a routine can't see them. So the box also offers a
**"Send to integration queue"** link that opens a *prefilled* GitHub issue using
the [`integrate` issue form](../../.github/ISSUE_TEMPLATE/integrate.yml). Filing
it (one tap on GitHub) is what puts the name in the repo, with no client secret.

Open issues labeled **`integrate`** are the work queue. You can also file one by
hand from the repo's *Issues → New issue → Integrate a watchlist company*.

## What the daily routine does

For each open issue labeled `integrate` (skip ones already labeled
`integrate:done` or `integrate:needs-info`):

1. **Parse** the company name, broker ticker, region and notes from the issue body.
2. **Normalize the symbol** to the Yahoo form the refresh script expects
   (see table below). If it can't be resolved confidently, comment on the issue
   asking for the exact symbol, add `integrate:needs-info`, and move on.
3. **Skip if already present** — if the normalized symbol is already in
   `universe.ts`, comment "already integrated", label `integrate:done`, close.
4. **Research** the company and write a `Company` entry in `src/data/universe.ts`:
   - Measured-vs-editorial discipline is non-negotiable (see `CLAUDE.md`). The
     0–100 axes here (`aiExposure`, `growth`, `quality`, `valuationRisk`,
     `balanceSheetRisk`, `geopoliticalRisk`) are **editorial estimates** — set
     them as reasoned judgments, never presented as measured. `momentum` is a
     seed placeholder; the refresh replaces it with measured data.
   - Fill `name`, `symbol` (normalized), `region`, `exchange`, `assetType`,
     `themes` (reuse existing theme tags where they fit), and neutral
     `newsSignal`/`expertSignal` placeholders with `freshness: "seed"`.
   - Keep estimates conservative and defensible; cite reasoning in the PR body.
5. **Refresh** just this symbol: `npm run refresh -- <SYMBOL>`. This fetches
   measured price/momentum/fundamentals into `public/data/live-signals.json`.
   (The morning deploy refresh covers it thereafter.) A provider gap is not a
   blocker — the name keeps its editorial momentum, flagged in the PR.
6. **Validate**: `npm test` and `npm run build` must pass.
7. **Open a PR** from a branch like `integrate/<symbol>`: summarize the editorial
   estimates and their basis, link the issue with `Closes #<n>`, label
   `integrate`. CI (`ci.yml`) re-runs test + build on the PR.
   - Default: leave the PR for one-tap human merge.
   - Optional (if enabled): auto-merge when CI is green.
8. **Mark done**: label the issue `integrate:done`. Closing happens on merge via
   `Closes #<n>`.

If anything fails, comment the error on the issue and label `integrate:needs-info`
rather than opening a broken PR.

## Symbol normalization

Broker / human form → Yahoo symbol used by `scripts/refresh-data.mjs`:

| Input                 | Yahoo symbol | Notes |
|-----------------------|--------------|-------|
| `HKG: 2513`, `2513`   | `2513.HK`    | Hong Kong Exchange |
| `NASDAQ: TSLA`, `TSLA`| `TSLA`       | US listings have no suffix |
| `NYSE: KO`            | `KO`         | US |
| `ETR: SAP`, `FRA: SAP`| `SAP.DE`     | Xetra / Frankfurt |
| `LON: ARM`            | `ARM.L`      | London |
| `TPE: 2330`, `TWSE`   | `2330.TW`    | Taiwan |
| `KRX: 005930`         | `005930.KS`  | Korea (KOSPI) |
| `STO: NDA-SE`         | `NDA-SE.ST`  | Stockholm |
| `CPH: NOVO-B`         | `NOVO-B.CO`  | Copenhagen |

When unsure, verify the symbol resolves on Yahoo before committing (a 1-day
chart fetch returning a price is enough), and record the resolved symbol in the
issue and PR.

## Labels

- `integrate` — queued (the trigger).
- `integrate:done` — integrated (PR opened/merged).
- `integrate:needs-info` — couldn't resolve; waiting on the filer.

## Why a PR, not a direct push

A new universe entry carries editorial judgment and a live data fetch that can
fail. A CI-gated PR keeps a human checkpoint on the judgment while everything
mechanical (test, build, refresh) is automated — and `main` auto-deploys to
Pages on merge, so "publishing" is still one tap.
