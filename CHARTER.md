# Charter

The durable north star for the **autonomous self-improvement routine**. The routine
reads this fresh every run and decides **for itself** what most advances it. This is
**not a task list** — there is nothing here to "complete". Edit it when the vision
changes; don't use it to assign work.

## Purpose
A personal pre-decision instrument for a ~40k DKK AI/tech book. The owner opens it to
answer one question: *"What, if anything, should I do — and what would my broker never
tell me?"* Decision support, never financial advice.

## What "great" looks like
- In one calm glance, a trustworthy, compliance-aware, **sized** read on the one or two
  highest-leverage moves — and "do nothing" is a valid, well-stated answer.
- Every number is honestly sourced: measured data (price, momentum, fundamentals, P&L)
  is never dressed up as editorial estimate (AI exposure, geopolitical risk), and
  uncertainty is shown, not hidden.
- The app is **coherent and calm** — a few strong, well-connected surfaces, not a pile
  of features.
- It routinely tells the owner things Saxo can't: model conviction, EIFO posture,
  opportunities not owned, whole-book synthesis, what changed since last time.

## Values — the order to optimise when they genuinely conflict
1. **Trust & honesty.** Never fake certainty; provenance and compliance integrity come
   before everything. If a change trades honesty for polish or a slicker-looking
   decision, don't make it.
2. **Decisiveness & clarity.** Resolve toward a clear, sized action; a dashboard that
   doesn't help the owner *act* is failing at its job.
3. **Restraint & coherence.** Fewer, stronger surfaces; simplify or remove before adding.
4. **Beats-the-broker edge.** Maximise the insight Saxo can't give.
5. **Craft & beauty.** Sparse, editorial, considered.

> Velocity of new features is **not** a value. A run that simplifies, deepens trust, or
> ships nothing can be the best run of the week.

## Taste
Sparse and editorial; one typeface; calm hierarchy; no chartjunk. A chart must say
something Saxo's own chart doesn't — annotate it with the model's score, signals or
compliance so it earns its place.

## Guardrails — never cross (canonical detail in AGENTS.md / CLAUDE.md)
- **EIFO compliance is a safety boundary:** never weaken §9.3 negative-list blocking or
  the "never claim a company is clean" honesty; strengthen only.
- **Privacy:** public repo — no secrets/keys, no real broker or personal data; sample
  data stays clearly fictional.
- **Data:** keyless Yahoo (+ optional key-gated providers) only; never add a new
  paid/keyed dependency; the canonical momentum/fundamentals math stays in
  `src/lib/market.ts`.
- **No** trade execution, broker login, or order placement.

## How the routine uses this (not a backlog)
Each run: use the live app, judge it honestly against this Charter, name the single
biggest gap, and justify the highest-leverage move — add / deepen / simplify / remove /
polish / or do nothing — then build it and record the assessment in
`docs/auto-log.md`. The owner sets the vision here; the routine does the thinking.
