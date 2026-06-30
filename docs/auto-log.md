# Assessment journal

The routine's memory and its evolving read of the product. Read at the **start** of every
run; a fresh entry is appended at the **end** of every run (including ship-nothing runs).
This is how the routine's judgement compounds instead of restarting each time.

Each entry is the routine's own honest assessment — **not** a changelog:
- **Assessment** — using the live app, where does it fall short of the `CHARTER.md` right
  now? The biggest gaps; what's weak, confusing, redundant, or untrustworthy.
- **Move** — the single highest-leverage thing chosen this run and why it beat the
  runner-up (or why the best move was to ship nothing).
- **Result** — shipped (PR#) / declined (+ reason).

## Standing "don't retry" (with reason)
- **NAV-spark trailing-12-month annotation is DONE** (see run #2) — the hero sparkline now
  reports `summarizeTrend(series).changePct`, not the all-time `totalReturnPct`. Don't redo.
- **Concurrency hazard — sibling runs can share ONE working copy.** Run #2 observed a sibling
  run operating in the *same* checkout (not an isolated worktree): it switched branches,
  committed, and pushed while this run was mid-flight, and its `git add -A` swept this run's
  *staged* edits into the sibling's commit (`23ba5b4`, mislabeled "docs:"). Lesson for future
  runs: do NOT `git add -A`/stage in the shared checkout while idle; stage only at the instant
  of commit, or isolate in a `git worktree` from the start. Verify your change landed under the
  *intended* commit, not a sibling's.

## Runs (most recent first)

### 2026-06-30 — honest NAV-spark trailing-return annotation (self-directed run #2)
- **Assessment:** Drove the live app against the Charter (trust first). Run #35 already
  hardened the front-page book-read, so trust is strong; the single most disappointing thing
  left was a subtle but real provenance mismatch in the NAV hero sparkline. It plots
  `buildPortfolioSeries` — a **trailing-12-month** measured price trajectory of the current
  book (axis JUL '25 → JUN '26) — yet annotated the line with `model.totalReturnPct`, the
  **all-time** gain ÷ cost basis. Two different metrics over two different windows, the
  all-time one mislabeled onto a trailing-year chart (and already shown verbatim in the NAV
  deltas + source line beside it). Same family of bug as #35: a number presented as something
  it isn't. Runner-up was simplifying the front page by removing one of the two bottom "your
  book" bands (PositionSlots / BookComposition) — declined: the journal cautions against
  treating distinct lenses as redundant, and removing a tested, owner-valued feature is a
  lower-confidence win than fixing a trust defect.
- **Move:** deepen/polish (trust-first). `NavSpark` now annotates the line with
  `summarizeTrend(series).changePct` — the plotted series' own first→last move, drawn from the
  SAME cleaned series `buildPriceChart` plots, so the badge can never disagree with the line.
  Badge omitted in demo mode (no fetched history → no honest trailing move to state). No
  information lost (all-time return retained in the NAV deltas + source line); no new
  dependency; bundle unchanged (322.83 kB). +1 pinning test (a +10%-proportional history makes
  the FX-weighted series move exactly +10.00% independent of weights). Independent skeptical
  reviewer verdict: **SHIP** (badge mathematically pinned to the line; nothing lost; demo-mode
  omission correct; no other regression). Live preview confirmed the demo badge moved from a
  mislabeled +12.42% to the honest +32.60% trailing-year move, with +12.42% total still in the
  deltas.
- **Result:** shipped to `main` — but via an unusual path: a concurrent **sibling run sharing
  this working copy** committed this run's staged `App.tsx` + `App.test.tsx` into its own
  commit `23ba5b4` and pushed it (so the fix + test are live on `main`, 297 tests green, build
  clean, auto-deploys), rather than through this run's own PR. Verified `origin/main` carries
  the exact intended change with no extra diff. See the new Standing "don't retry" note above.

### 2026-06-30 — honest book-read + de-dupe (self-directed run #1)
- **Assessment:** An independent 4-lens panel judged the live app against the Charter
  (trust first). The strongest finding was a real honesty defect, not clutter: the
  front-page book-read caption rounded a "has-a-price-snapshot" flag up to "measured
  market data behind its score", burying the always-editorial AI-exposure (0.20 weight,
  the largest) and geopolitics axes — and contradicting the Company-detail / Compare
  provenance labels. The front page also stacked four synthesis bands, the top one a
  restatement of the ranked ledger beneath it. NOTE for future runs: the cross-tab
  "vs the field" lenses (Map / Compare / theme-peers) turned out genuinely DISTINCT on
  inspection — do not consolidate them as if redundant.
- **Move:** simplify. Split the conflated measuredShare into honest momentum/fundamentals
  sub-shares; rewrote the caption to name what's measured and that AI exposure + geopolitics
  are editorial for every name; folded the scorecard band into a strip atop the ledger and
  dropped only the Carries/Drags cards (= ledger rows 1 & 6, the table is ranked by score).
  Trust (#1) + coherence (#3) in one move; −45 lines; zero capability lost.
- **Result:** shipped — #35 (independent reviewer verdict: SHIP, no regressions).

### 2026-06-30 — seed assessment
- **Assessment:** After ~30 runs the app is broad and capable but shows feature-accretion
  strain. "Where does this name sit vs the field?" is expressed in ~four places — the
  Decision Map board, Compare, the theme-peers ladder in Company detail, and the
  front-page theme band — likely redundant. The front page *informs* but doesn't yet
  *resolve* to one decisive, sized action. Freshness and measured-vs-editorial provenance
  are handled per-view rather than uniformly. Judged against the Charter's trust-first
  value, the weakest areas are coherence (too many overlapping lenses) and a single,
  legible provenance/freshness treatment.
- **Move:** none — this run seeds the Charter + journal so future runs self-direct rather
  than consume a task list.
- **Result:** shipped `CHARTER.md` + this journal (docs-only).

### before this journal — prior work (compressed from git, do not rebuild)
Decision map → four-zone board; "Portfolio Ledger" re-skin; add-a-company watchlist;
broker + per-trade-budget investability gate; sized buy-plan / deploy queue; front-page
leads + "what changed since refresh"; head-to-head Compare; theme-peer ranking;
risk/reward map; price-path, 52-week range and score-contribution charts; theme-grouped
opportunities. See `git log` for PR numbers.
