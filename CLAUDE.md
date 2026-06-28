# Claude Working Notes

This project is intentionally simple at the UI layer and more analytical in the TypeScript modules.

## Commands

- `npm test`
- `npm run build`
- `npm run dev`
- `npm run refresh`

## Main Files

- `src/lib/types.ts` owns the data contracts.
- `src/lib/portfolio.ts` parses the Danish portfolio CSV, including real P&L.
- `src/lib/market.ts` is the canonical, tested momentum model; the refresh
  script imports it so the math lives in one place.
- `src/lib/compliance.ts` encodes the EIFO policy (§9.1-9.3) and overrides.
- `src/lib/recommendations.ts` contains the scoring model and action labels.
- `src/lib/dashboard.ts` assembles the portfolio/opportunities model.
- `src/lib/signals.ts` merges optional news and analyst snapshots.
- `src/data/universe.ts` seeds the AI/tech universe (editorial estimates;
  momentum is replaced by measured data on refresh).
- `src/data/complianceOverrides.ts` is the user's manual EIFO knowledge.
- `scripts/refresh-data.mjs` fetches keyless Yahoo prices + optional providers.
- `src/App.tsx` is the sparse three-view dashboard.

## Boundaries

- This is not licensed investment advice.
- Do not add trade execution.
- Do not state that EIFO status is clean without updated EIFO lists.
- Keep recommendations explainable and neutral.
- Prefer tests before changing behavior.
- Distinguish measured data (price, momentum, P&L) from editorial estimates
  (AI exposure, growth, quality, the risk axes). Never relabel one as the other.
- Keep the canonical momentum math in `market.ts`; do not duplicate it.
