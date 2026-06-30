# Auto-improvement log

Cross-run memory for the autonomous self-improvement routine. Read at the **start**
of every run and updated at the **end** of every run (including ship-nothing runs).

- **Shipped** — don't rebuild it.
- **Declined (don't retry)** — a reason it wasn't worth it; do not re-propose unless
  the reason no longer holds.
- **Next candidates** — the routine's own ranked backlog (distinct from the
  owner-set `PRIORITIES.md`). Re-rank as things ship.

## Shipped (most recent first)
- 2026-06 — Knowledge Atlas Technology (Zhipu AI, 2513.HK) added to the universe — `#31`
- 2026-06 — Decision map redesigned as a four-zone decision board — `82ad144`
- 2026-06 — Watchlist: add a company by name, pre-priced, scored unbiased — `#13`, `#26`, `#30`
- 2026-06 — Broker tradability + per-trade budget gate, surfaced in conviction — `#12`, `#28`, `#29`
- 2026-06 — Sized buy-plan / deploy queue in your own per-trade buys — `#14`, `#20`, `#22`
- 2026-06 — Front page: whole-book verdict, act-on-able lead idea, "what changed" — `#15`, `#16`, `#18`, `#21`, `#25`
- 2026-06 — "The Portfolio Ledger" re-skin (Schibsted Grotesk, cool palette) — `ea1969b`
- 2026-06 — Deep-dive link out to a full external chart — `#27`
- 2026-06 — 52-week range position on the opportunities ledger — `#23`
- 2026-06 — Head-to-head Compare view — `#10`
- 2026-06 — Theme-peer ranking + risk/reward map + price-path + score-contribution charts — `#6`, `#7`, `#8`, `#9`
- 2026-06 — Opportunities as a theme-grouped blind-spot map — `#11`

## Declined (don't retry — with reason)
- _none yet_

## Next candidates (routine's own backlog — ranked, editable)
1. **Consolidation audit.** The app is now broad (Portfolio, Opportunities, Map,
   Compare, detail, watchlist, broker gate, allocation, "what changed", theme band).
   Look for overlap/redundancy and simplify before adding more surface area.
2. **Decision-board depth.** Optional per-name risk pip / sort control on the new
   four-zone board; honest empty-zone treatment for a real (lopsided) book.
3. **A11y + perf pass.** Keyboard/focus + screen-reader audit across views; check the
   JS bundle (~90 kB gzip) for easy wins.
