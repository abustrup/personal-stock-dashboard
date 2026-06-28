# Project Instructions

Build this as a local decision-support dashboard, not financial advice.

## Run

- Install: `npm install`
- Develop: `npm run dev` (auto-picks a free port — safe for several agents at once)
- Launch (fixed port, opens browser): `npm start`
- Test: `npm test`
- Build: `npm run build`
- Optional signal refresh: `npm run refresh`

## Multiple agents

- One agent per git worktree/branch; never edit the same working copy concurrently. See `CONTRIBUTING.md`.
- Use `npm run dev` for parallel previews (`npm start`/`npm run preview` use fixed ports — one at a time).
- Open small PRs to `main`; CI must stay green. `main` auto-deploys to GitHub Pages.

## Privacy (public repo)

- This repository is public. Demo data only — never commit a real broker export or real positions (`.gitignore` blocks `*Positioner*.csv`, `*private*.csv`, `/data/`).

## Product Rules

- Keep the front end sparse and high-level.
- Keep the backend logic explicit, testable and auditable.
- Portfolio input is a local CSV matching the Danish broker export shape.
- Existing holdings use `increase`, `hold`, `trim`, `avoid`.
- Non-owned names use `investigate`, `watch`, `avoid`.
- Every recommendation must include action, conviction, reasoning, downside, news signal, expert signal, freshness and compliance status.

## Compliance Rules

- Use only the provided EIFO policy PDF as the policy source unless the user provides newer data.
- Hard block the §9.3 permanent negative list: FLSmidth, NKT, Per Aarsleff Holding, Siemens Energy and Vestas.
- Hard block anything the user marks as an EIFO investment (§9.1); mark loans/guarantees as `restricted` with the 6-month-hold and no-derivatives notes (§9.2).
- Flag possible EIFO overlap for Danish/Nordic domicile or mandate themes — as a soft nudge, never a claim.
- Never claim a company is clean without current EIFO investment, loan or guarantee data.
- Do not add broker login, trading execution or order placement.

## Data Rules

- Market prices and momentum come from keyless Yahoo Finance by default — no API key required.
- News and analyst providers (Alpha Vantage, Finnhub) are optional and key-gated.
- Never put API keys in client code.
- `scripts/refresh-data.mjs` may write `public/data/live-signals.json`, which is ignored by git.
- Keep the canonical momentum math in `src/lib/market.ts`; the refresh script imports it (do not duplicate).
- Distinguish measured data (price, momentum, P&L) from editorial estimates (AI exposure, growth, quality, risk axes).
- Missing provider data should lower confidence or fall back to seeded signals, not break the dashboard.
