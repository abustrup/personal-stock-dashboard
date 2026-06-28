# Contributing (humans and agents)

This repo is built to be worked on by several agents at once (e.g. Claude and
Codex) plus you. The rules below keep that parallel work from colliding.

## One worktree per agent

Never let two agents edit the same working copy at the same time. Give each
agent its own git worktree and branch:

```bash
git worktree add ../psd-<topic> -b feature/<topic>
# work in ../psd-<topic>, then open a PR back to main
```

When the branch is merged, remove the worktree:

```bash
git worktree remove ../psd-<topic>
```

## Running several dev servers at once

- `npm run dev` — Vite picks the **next free port** automatically (5173, then
  5174, …), so multiple agents can each run their own preview with no clash.
- `npm start` (port 5173) and `npm run preview` (port 4173) use **fixed** ports —
  one at a time only. Use `npm run dev` for parallel work.

## Before opening a PR

```bash
npm test          # unit tests
npm run build     # typecheck + production build
```

CI runs the same checks on every pull request; keep `main` green.

## Branches and merges

- Branch from `main`; name branches `feature/…`, `fix/…` or `chore/…`.
- Small, focused PRs. Rebase or merge reviewed commits — never hand-copy edits
  between worktrees, and never copy secrets between them.
- `main` deploys to GitHub Pages automatically.

## Data and privacy

- This is a **public** repo. `sample/portfolio-sample.csv` and the seed are
  **fictional demo data**. Never commit a real broker export or real positions —
  `.gitignore` blocks `*Positioner*.csv`, `*private*.csv` and `/data/`.
- Keep API keys out of the client. Market data is keyless; news/analyst keys are
  read only by `scripts/refresh-data.mjs` from the environment.
- Separate **measured** data (price, momentum, P&L) from **editorial** estimates
  in both code and UI. Never relabel one as the other.
