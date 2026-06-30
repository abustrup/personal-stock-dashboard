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
- **Concurrency hazard #2 — a sibling's setup can DELETE your in-flight `auto/*` branch + worktree.**
  Run #3 created worktree `.claude/worktrees/auto-assess` on `auto/assess-run3`; minutes later a
  sibling run (`auto/assess-run4`) ran the routine's step-1 "delete stale local `auto/*` branches"
  and removed run #3's worktree AND branch out from under it (nothing was lost — edits hadn't been
  written yet). Lessons that worked: (a) isolate the worktree OUTSIDE `.claude/worktrees/`
  (run #3 used `~/Documents/psd-honest-provenance`), which siblings don't sweep; (b) commit and
  **push to origin early** so the work survives any local clobber; (c) the step-1 cleanup should
  only delete `auto/*` branches whose PR is merged/closed — never bare in-flight ones.
- **Subagent / reviewer wrong-tree hazard.** Run #7's decision panel had one lens (with filesystem
  access) confidently declare the topbar freshness-chip defect a *phantom* — because it inspected
  the divergent **`maintenance/dedup-deadcode-robustness`** branch (where `App.tsx` is ~697 lines
  and the topbar has no chip), not `main` (3,654-line `App.tsx`, chip present at App.tsx:476-502,
  the deployed tree). Lesson: when delegating verification to a subagent, anchor it to the exact
  worktree path + `git rev-parse HEAD`, and treat any "it's not in the code" claim as a tree-mismatch
  until reconciled against `main`'s real `HEAD`. The panel still paid off — it forced the wrong-tree
  catch and a deploy-source check (`.github/workflows/deploy.yml` fires on `branches: [main]`).

## Runs (most recent first)

### 2026-06-30 — mobile topbar clip fix (self-directed run #7)
- **Assessment:** Drove the LIVE app end-to-end across all five surfaces (own worktree, fresh
  `npm run refresh` = 41/41 priced + the preview MCP bound, as in runs #4/#6, to the *main*
  checkout's ~31h-stale snapshot — so I saw both the fresh and the demoted-freshness states). The
  app is mature and honest: Portfolio (re-priced NAV, honest "Snapshot prices" caption from run #6,
  weighted book read + capital-by-verdict + measured/editorial provenance line), Opportunities
  (budget/EIFO-aware), Map (score×risk zones), Compare (per-axis provenance + MODEL'S PICK), and
  Company (run #3's "Data-Backed"/"Price-Backed"/"Editorial only" header) all remain genuinely
  distinct and strong — don't consolidate. After runs #1–6 systematically hardened
  trust/provenance/freshness, I found **NO remaining visible trust defect on desktop** this run.
  The single clear, currently-visible defect was the one run #6 explicitly deferred to "a focused
  topbar-layout run": at ≤375px the topbar **"Import CSV" primary action clips ~25px off the right
  edge**. Root cause: at ≤620px `.topbar` stacks to a column (less horizontal room) but its child
  `.topbar-actions` flex row stayed `flex-wrap: nowrap` with two `white-space:nowrap` children (the
  freshness chip + the Import button), so they overran the width and the button clipped. It's a
  craft (#5) defect that, on the *public, phone-viewable* Pages demo, also dents clarity (#2): the
  app's only primary action is half-readable at the moment a first-time visitor forms a trust
  judgment. A 4-lens decision panel (run to counter my own anchoring) returned **3× A (do the fix),
  1× C (ship-nothing)** — but the lone dissent was inspecting the *wrong branch* (see the new
  standing hazard above); once reconciled against `main`'s real HEAD + the deploy source, the fix
  is the right move. Runner-ups declined: B (hunt a deeper trust defect) — would risk inventing
  severity where the evidence shows none; D (App.tsx-monolith refactor) — perennially declined,
  internal-only, coherence #3 < trust #1, destabilising.
- **Move:** polish (clarity/craft). Invoked `/frontend-design` first to set deliberate direction:
  keep existing tokens + one typeface, no new vocabulary, the best version of this fix is *invisible*
  (resist a heavy full-width button). Let `.topbar-actions` **wrap** inside the existing ≤620px block
  (`flex-wrap: wrap; justify-content: space-between; gap: 10px 14px`): on phones wide enough the
  provenance chip anchors the leading edge and the action sits opposite it (verified at 540px), and
  the button drops to a tidy left-aligned line beneath the chip on the narrowest screens (verified at
  375px: button right edge 154 vs the prior clipping 380). Desktop is untouched (rule scoped to
  ≤620px; verified unchanged at 1280px). Pure CSS — JS bundle flat at 325.16 kB; the freshness chip
  has no `text-overflow`/`max-width` so wrapping *widens* its room and never truncates the
  provenance text (no trust regression). Added `src/styles.responsive.test.ts` — a source-assertion
  guard (jsdom has no layout engine to test responsive overflow behaviourally) that fails if the wrap
  rule is dropped, proven non-vacuous by the reviewer reverting it. 321 tests + build green.
- **Result:** independent skeptical reviewer verdict **SHIP** (strictly better, no regression; it
  read the real files, verified the three-item chip+Reset+Import case left-aligns tidily, confirmed
  the guard test fails on revert, and confirmed no provenance truncation; no blocking nits). Shipped
  — _pending PR # + CI; appended on merge._
  *Carry-forward:* the topbar mobile layout is now clean across 375/540/620/desktop; the freshness
  vocabulary (header chip, NAV caption, "since last refresh" band) still could share one age string
  if a future run unifies it (noted since run #6). The remaining standing decline is the App.tsx
  monolith refactor — still internal-only, still not worth the destabilisation.

### 2026-06-30 — stale-snapshot NAV caption honesty (self-directed run #6)
- **Assessment:** Drove the LIVE app end-to-end across all five surfaces (own worktree;
  the preview MCP bound — as in run #4 — to the *main* shared checkout, which carried a
  ~29-hour-old snapshot, so I assessed the real stale-data state rather than a fresh one).
  The app is mature and honest: Portfolio (sized verdict + EIFO posture + book synthesis),
  Opportunities (budget/EIFO-aware buy plans, nothing silently dropped), Map (score×risk
  zones with stated risk-index method), Compare (per-axis MEASURED/EDITORIAL provenance),
  and Company (weighted score pulls, reasoning, "status cannot be called clean") all remain
  genuinely distinct and strong — don't consolidate. Judged trust-first, the single most
  disappointing thing was a **same-screen self-contradiction on the headline NAV**: run #5
  correctly demoted the header chip from "LIVE · YHOO" to "YHOO · 29 JUN 14:14 · 29 HOURS
  OLD" (muted dot) when the snapshot ages past 12h — but the NAV hero caption two lines
  below still asserted **"Live prices · all 6 holdings"** unconditionally. So over a stale
  snapshot the screen said "29 HOURS OLD" and "Live prices" at once — the exact §1 overclaim
  run #5 fixed in the header, left unfixed on the one number the app opens with (and the
  precise same-screen-contradiction class run #3 treated as tipping-point-worthy). Runner-up
  considered: ship-nothing (the app is strong) — but this is a real, currently-visible
  honesty inconsistency on the headline figure, so it clears the bar. The App.tsx-monolith
  refactor was again declined (internal-only, coherence #3 < trust #1, destabilising). Minor
  carry-forward noted below: the topbar "Import CSV" button clips off the right edge at 375px.
- **Move:** deepen/polish (trust-first). Threaded the already-computed `isStale`
  (App.tsx:236, the same value driving the header chip) into `NavHero` and swapped the
  caption's leading label: fresh → "Live prices" (unchanged); stale → **"Snapshot prices"**
  — same grammatical slot, drops the currency claim, still credits the measured Yahoo
  snapshot (never relabelled "editorial"; stale measured data is still measured). The header
  chip already names the snapshot's timestamp + age, so the caption deliberately does NOT
  restate the age (restraint, no duplication). Pure presentational — no scoring/valuation
  math touched, bundle flat (325.16 kB). Extended run #5's stale-snapshot App test to assert
  the caption now reads "Snapshot prices ·" and never "Live prices" in that state. 320 tests
  + build green. *Verification note:* the preview MCP was bound to the main checkout (binding
  hazard, run #4), and my worktree's own snapshot was fresh, so neither live server exercises
  the stale branch — the authoritative proof is the rendered-DOM integration test (real `App`,
  3-day-old snapshot, asserts the flip), plus the live pre-change screenshots showing the
  contradiction. Same approach run #4 used under the identical constraint.
- **Result:** _pending reviewer verdict + CI; PR # appended on merge._
  *Carry-forward:* (1) "Snapshot prices" parallels the header's demotion and reads calm in
  the muted `.nav-prov` slot; if a future run unifies freshness vocabulary, the header chip,
  this caption, and the "since last refresh" band could share one age string. (2) Mobile
  (375px): the topbar "Import CSV" button overflows the right edge — a real but minor craft
  (#5) issue, intentionally left for a focused topbar-layout run rather than bundled here.

### 2026-06-30 — freshness-honest data stamp (self-directed run #5)
- **Assessment:** Drove the LIVE app end-to-end (own worktree dev server, with a real
  `npm run refresh` so I assessed the owner's *measured* view, not demo) across all five
  surfaces — Portfolio, Opportunities, Map, Compare, Detail. The app is mature and honest;
  runs #1–#4 already hardened front-page provenance and put the headline NAV on live prices,
  and the cross-tab lenses remain genuinely distinct (don't consolidate). Judged trust-first,
  the single most disappointing thing was the header **freshness chip**: it was binary — *any*
  loaded market snapshot → confident green **"LIVE · YHOO · <time>"**; otherwise "EDITORIAL".
  No staleness check. The owner is the primary user and runs locally: refresh once, open the
  app days later, and the chip still asserts green "LIVE" over a 3-day-old snapshot. The
  timestamp was shown but the word "LIVE" actively *claims* currency — the Charter's §1 case
  (show uncertainty, don't hide it), and the exact "freshness handled non-uniformly" gap the
  seed assessment named and no run had touched. (Adjacent to run #4's P4 "staleness & coverage
  UX" roadmap item, but distinct: that is about per-holding market-closed valuation; this is
  the data-source freshness stamp.) Runner-up considered: breaking up the 3,628-line `App.tsx`
  monolith — declined as internal-only (coherence #3 < trust #1) and a destabilising rewrite of
  a working subsystem, against the routine's guardrails.
- **Move:** deepen/polish (trust-first). New pure, tested `src/lib/freshness.ts`
  (`describeMarketFreshness(iso, now)` + `FRESH_WINDOW_MS = 12h`, clock injected so time
  logic is deterministic). The chip now: ≤12h → "LIVE · YHOO · <time>" (unchanged); >12h →
  **"YHOO · <time> · <N HOURS/DAYS OLD>"** with the existing muted `.stale` styling (grey,
  non-pulsing dot) — drops the "LIVE" claim, names the age, and **stays credited to Yahoo as
  measured, never relabelled "EDITORIAL"** (stale measured data is still measured). aria-label
  varies per state. +8 unit tests (boundaries at 12h/48h, clock-skew clamp, "1 DAYS" grammar
  avoided, invalid/missing timestamp) + 1 App-level stale-render test. 7 existing App tests had
  hardcoded `generatedAt: "2026-06-28…"` fixtures switched to `new Date().toISOString()` — now
  *required*, since with the age check a hardcoded past date would flake stale (dropping "LIVE")
  whenever CI runs >12h later; the swap keeps them deterministically live and was not
  load-bearing for any date/digest assertion. Tests green; build clean (+~0.6 kB for the new
  module). Live-verified: an aged snapshot rendered "YHOO · 27 JUN 15:00 · 3 DAYS OLD" with the
  demoted grey dot, while every measured number still rendered from the snapshot.
- **Result:** independent skeptical reviewer verdict **SHIP** (strictly better, no regression;
  ran its own green `npm test` + `npm run build`). Shipped — #41.
  *Carry-forward:* the 12h window can label a legitimately-current weekend/overnight snapshot
  "stale" (Fri-16:00 refresh viewed Sat-10:00 = 18h). Judged non-blocking — production refreshes
  hourly so it never fires there, and naming the age is still strictly more honest than a silent
  green "LIVE". A future run *could* make the window market-hours-aware if it ever bites, but
  don't add that complexity speculatively.

### 2026-06-30 — live headline NAV (self-directed run #4, owner-requested)
- **Assessment:** Owner asked for the portfolio value to track live prices. The headline NAV
  (and its deltas) was the static imported CSV figure (`sum(holding.marketValueDkk)`) — never
  re-priced, even though the refresh now runs hourly (#36) and the topbar says "LIVE · YHOO".
  The one number that opens the app was the one number not living: a usefulness + trust gap.
- **Move:** add, client-side and tested. New `src/lib/valuation.ts` re-prices each holding at
  its live price via the **import-implied FX factor** (`marketValueDkk / currentPrice`, which
  already folds in qty × FX — the same trick the sparkline used, now shared via `importFxFactor`).
  Headline NAV/today/all-time go live when any holding is priced, with an honest coverage caption
  ("Live prices · N/M holdings (X% of book) · the rest at your imported value"); uncovered
  holdings (no snapshot / currency mismatch / no usable import price) fall back to the imported
  value and are counted, never faked. FX is import-implied, labelled as such (NOT a live feed).
  Source line relabelled "as imported". `dashboard.ts` / `changes.ts` / `market.ts` / EIFO
  untouched. 10 new valuation unit tests; NAV test updated to assert the live caption and that
  the hero flips off the imported +12.42%. 307 tests + build green. Independent adversarial
  reviewer: **SHIP** (no must-fix, no regressions, honesty pass). Interactive preview was blocked
  (the MCP preview binds to a sibling worktree on another branch + a held port), so verification
  leaned on the rendered-DOM integration test.
- **Next phases (standing roadmap — "live value" as a routine, not a one-off; future runs continue):**
  - **P2 real FX feed:** `scripts/refresh-data.mjs` fetches `<CUR>DKK=X` (USD/EUR/HKD/KRW/SEK…)
    via the keyless Yahoo chart endpoint; add `fxRates` + `fxAsOf` to `live-signals.json`.
    `valuation.ts` then prefers live FX → import-implied → editorial `fxToDkk` (investability.ts),
    with FX provenance labelled.
  - **P3 live P&L + per-row live values:** ledger Total/Today columns + weights recomputed live
    vs `costBasisDkk`, each with provenance.
  - **P4 staleness & coverage UX:** market-closed / stale states; a nudge to add an unpriced
    holding to the universe/directory so it gets priced; refresh-failure fallback labelling.
- **Result:** shipped — #40 (squash-merged; auto-deploys). The hourly refresh keeps it current
  with no manual action.

### 2026-06-30 — honest score-header provenance label (self-directed run #3)
- **Assessment:** Drove the live app across all five views with **real** Yahoo data (`npm run
  refresh`, 41/41 priced). The product is mature and honest: provenance labels are dynamic and
  correct (MEASURED price/momentum/fundamentals vs EDITORIAL ai-exposure/geopolitics vs POLICY
  compliance flip with data presence across Portfolio/Company/Compare), the front page resolves
  to sized actions ("buy ~1 share TSM", "trim Tesla"), and two numbers I chased as suspicious
  (TSM "DKK 3,175 ≈ 1 share"; holdings "TODAY" not moving on refresh) both turned out **correct**
  (TSM ADR is genuinely ~$460; "TODAY" is the broker CSV's `% 1D afk.` position day-return, a
  legitimate measured-broker figure distinct from Yahoo's security day-change — overriding it
  would wrongly relabel broker data). My own first read cleared the app as honest. An independent
  skeptical assessor (run to counter that anchoring) found the real defect: the **detail/standout
  header printed `measured ? "data-backed" : "editorial"`**, but `measured` (recommendations.ts)
  flips true on a live *price* alone, while fundamentals (growth/quality/valuation/balance-sheet,
  ~33% of the weight) come from a **separately-failing** Yahoo endpoint. So in the reachable
  "priced-but-no-fundamentals" state the *same screen* contradicted itself — header "data-backed"
  while the DriverBars stamped 4 of 5 fundamental axes "editorial". A value-#1 (trust) overclaim.
- **Move:** deepen/polish (trust-first). Added `provenanceLabel(rec)` as the single source of
  truth, mirroring the bars' own `market?.fundamentals` / `market` checks: **"data-backed"** only
  with fundamentals, **"price-backed"** when only a live price is in, **"editorial only"**
  otherwise. Both header call sites now use it, so the header can never claim more provenance than
  the breakdown beneath it. Pure presentational — no scoring math, no factor relabeling, bundle
  flat (322.88 kB). +4 `provenanceLabel` tests (all tiers incl. the rare live-signal/no-price
  state, which deliberately under-claims "editorial only" — undercounting is the safe error);
  corrected a `watchlist` test that conflated "measured" with "data-backed". Runner-up was
  ship-nothing (a serious contender — the app is strong); the same-screen self-contradiction is
  what tipped it over the bar. **Verified in the browser** by simulating the degraded state
  (stripped GOOGL's fundamentals): the Alphabet detail header changed `Data-Backed → Price-Backed`
  and now agrees with its bars; the front-page caption independently read "fundamentals for 78%".
  Independent adversarial reviewer verdict: **SHIP — strictly better, no regression** (confirmed
  the state-c change is a strictly-more-honest under-claim, not a regression; its one
  non-blocking ask — a test for that state — was added before merge).
- **Result:** shipped — **#38** (squash `127be3e`); Pages deploy triggered. Note for next runs:
  "price-backed" is a new one-word label; it reads cleanly in the `[conviction] · [provenance]`
  slot beside the existing "data-backed", but if a future run touches that header, consider whether
  the vocabulary deserves a one-line legend.

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
