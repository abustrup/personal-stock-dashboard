# Priorities

Owner-edited steering for the **autonomous self-improvement routine** — which
*improvements to the dashboard* to build next. The routine reads this fresh every
run, picks the top unbuilt item in **Now**, and (only) appends to **Done**. The
owner owns **Now** / **Next** / **Parked**.

> Scope: this is about *product/feature work on the app*. It is **not** the
> company-intake queue — names to add to the investable universe go through the
> GitHub-issues queue (see `#19`), not here.

## Now (ranked — the routine picks the top item it hasn't already shipped)

Foundation-first: get the app coherent and the core decision sharp before adding
more surface area. Items lower down assume the ones above them are settled.

- [ ] **Consolidate the overlapping "where does this sit vs the field" lenses.**
      The app now says this in ~four places — the Decision Map board, Compare, the
      theme-peers ladder in Company detail, and the front-page theme band. Pick the
      strongest, fold or cut the rest, and leave a leaner information architecture.
      _Why long-term:_ every future feature compounds on the IA; stop the bloat
      first. This is a **consolidate** run — shipping *less* (a removed/merged view)
      is a win, not a loss. Don't add a new view to "fix" overlap.
- [ ] **Make the front page resolve to one decisive "what do I do now."**
      Synthesise score + EIFO + investability + per-trade budget + what-changed into a
      single prioritised, sized action list ("Buy ~5k of X · Trim Y · Watch Z — and
      the one-line why"), with everything else as drill-down. The answer a broker will
      never give. _Deepen_ the existing leads / deploy-queue — do not build a parallel
      feature beside them.
- [ ] **Make freshness & provenance legible everywhere.**
      One consistent treatment of "as of <date>", measured-vs-editorial, and
      stale/missing data across every view, with graceful degradation when a refresh
      fails (never a broken or silently-stale number). _Why long-term:_ trust is the
      product; the honesty discipline has to scale with the app.
- [ ] **Keep EIFO compliance durable as the data ages.**
      Surface when the policy / §9.3 negative list was last reviewed (dated), keep the
      "never claim a company is clean" honesty as lists go stale, and make the manual
      override path auditable. Standing safety priority — strengthen only, never weaken.
- [ ] **Harden the keyless data path.**
      Make `scripts/refresh-data.mjs` resilient to Yahoo hiccups, partial failures and
      rate limits (retries, per-symbol fallback, clear logging) so one bad fetch can't
      poison the dashboard. Backend robustness; tested; stays keyless.

## Next (nice-to-have, unranked)
- Standing perf budget — keep the JS bundle in check (~90 kB gzip and growing); flag regressions.
- Accessibility sweep — keyboard/focus + screen-reader pass across every view; honour reduced-motion.
- Mobile-first polish for the views actually checked on a phone.
- Model-score history per name (how a name's score moved since you started watching it) — a true "Saxo can't show this", once enough refresh snapshots exist.

## Parked / won't do (the routine must not build these)
- Trade execution, broker login, or order placement — hard product boundary.
- Any new paid or keyed data dependency (keyless Yahoo + optional key-gated providers only).
- Real-time / intraday streaming — out of scope for a daily-refresh personal tool.

## Done (routine appends with PR#; owner's original asks already shipped)
- [x] Add-a-company watchlist, scored by the unbiased model — `#13`, `#26`, `#30`
- [x] Broker tradability + per-trade budget gate (Saxo Investor; Korea/SK hynix
      untradable; ASML single share over the ~5k DKK/trade budget) — `#12`, `#28`, `#29`
- [x] Sized buy-plan / deploy queue measured in your own per-trade buys — `#14`, `#20`, `#22`
- [x] Front page + Opportunities overview leads (verdict on the whole book, an
      idea you can actually act on, what changed since last refresh) — `#15`, `#16`, `#18`, `#21`, `#25`
