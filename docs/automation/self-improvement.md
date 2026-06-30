# Self-improvement routine

The autonomous loop that keeps improving this dashboard. It runs **on its own** on a
schedule — a fresh session each time — reads the durable north star, decides for itself
what most advances it, ships one coherent improvement, and records what it did so the
next run builds on it. No human is in the loop; "ship nothing" is a valid run.

This file **is** the routine. The scheduled job's only prompt is "read and follow
`docs/automation/self-improvement.md`". Edit this file to change how the routine works;
edit [`CHARTER.md`](../../CHARTER.md) to change what it's aiming for.

## What this routine is for

Ship **one** genuinely-useful improvement to the dashboard's **visual quality** or
**decision-support value** per run, prove it is strictly better with no regression, and
only then merge it to `main` (which auto-deploys to GitHub Pages). One *coherent* change
per run — a larger diff is welcome when it is well-structured, fully tested and survives
adversarial review, but never an unfocused dump or a destabilising rewrite of a working
subsystem. **Shipping nothing is a valid, good outcome** when no change clears the
"strictly better, no regression" bar — a regressing feature is worse than no change.
Velocity of new features is **not** a goal; a *simplify*, *remove*, or *polish* run can
be the best run.

## The Charter decides; this routine executes

[`CHARTER.md`](../../CHARTER.md) is the durable north star — purpose, what "great" looks
like, the value order, and the guardrails. **Read it fresh every run** and decide *for
yourself* what most advances it. It is not a task list; there is nothing to "complete".

When values conflict, follow the Charter's order: **(1) trust & honesty → (2) decisiveness
& clarity → (3) restraint & coherence → (4) beats-the-broker edge → (5) craft & beauty.**

## Guardrails (a violation means "makes it worse" — never ship one)

- **EIFO compliance is a safety boundary.** Never weaken the §9.3 negative-list blocking,
  the §9.1/§9.2 rules, the manual overrides (`src/data/complianceOverrides.ts`), or the
  "never claim a company is clean" honesty. You may *improve* it.
- **Data honesty.** Keep MEASURED data (price, momentum, fundamentals, day-change, P&L)
  clearly distinct from EDITORIAL estimates (AI exposure, geopolitical risk). Never
  relabel one as the other. Canonical momentum/fundamentals math lives in
  `src/lib/market.ts` — never duplicate it.
- **Privacy.** Public repo. Never commit secrets, API keys, or real personal/broker data.
  Sample data (`sample/…`, `src/data/portfolioSeed.ts`) stays clearly fictional.
- **No trade execution.** This is decision support, not a broker. Charts/data must use the
  existing keyless path or a clearly-labelled external embed/link — never add a paid/keyed
  dependency or commit a key.
- Keep the UI sparse and calm; keep the backend explicit, tested and auditable.

## One run, step by step

1. **Set up.** `cd` to the repo. `git fetch origin && git checkout main && git pull
   --ff-only`. `npm install` if `node_modules` is missing (Node 22.18+). Delete any
   stale local `auto/*` branches whose PRs are already merged/closed.
2. **Read fresh.** `CHARTER.md`, this file, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
   `README.md`, and **`docs/auto-log.md`** (your own past runs — don't repeat them, build
   on them; the log also carries notes from past runs, e.g. which surfaces are genuinely
   distinct and must not be "consolidated").
3. **Assess the LIVE app, not your memory.** Run the dev server and actually look at the
   rendered views (and/or the deployed site). Judge the product honestly against the
   Charter. Then pick the **single highest-leverage move**. Favour an independent check
   over your first instinct — a short panel of distinct lenses (trust, coherence,
   decisiveness, a skeptical cold-read) catches your own anchoring.
4. **Implement** on a branch `auto/<short-kebab-slug>`. For any visual/UI work, **first**
   invoke the `/frontend-design:frontend-design` skill to set deliberate aesthetic
   direction, then build to it and match the existing design language and tokens. Keep the
   diff coherent and focused. Add or extend tests for any behaviour change; match the code
   style. Prefer keyless/existing data sources.
5. **Verify.** Run `npm test` and `npm run build`. Iterate until **both** pass. If you
   cannot, abandon: `git checkout main`, delete the branch, ship nothing.
6. **Adversarial review.** Spawn a **separate** skeptical reviewer (the Task/Agent tool or
   a review workflow) so the critique is independent of the implementer. It reads the full
   diff and tries hard to find ANY way the change makes the product worse — visual quality,
   correctness, performance, accessibility, bundle size, data-honesty, EIFO safety,
   privacy, test coverage, the Charter. Scope/ambition is **not** a defect. If anything is
   worse, or you are not confident it is a clear net improvement: **DECLINE** (ship
   nothing), or reduce the diff to the clearly-good part and re-verify + re-review. Ship
   only on a "strictly better, no regression" verdict.
7. **Ship** (only if review passed). Commit (end the message with
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`). Push the branch. Open a PR
   to `main` whose body states the improvement and the reviewer's verdict (end the body
   with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). `main` is
   protected: PR + a passing `test` check + linear history. **`main` may have moved while
   you worked (other runs land in parallel) — `git fetch` and rebase before merging.** Wait
   for `test` to pass, then **squash-merge** and delete the branch (auto-deploys to Pages).
   Use `gh` if available, else the GitHub REST API with the local git credential
   (`printf 'protocol=https\nhost=github.com\n\n' | git credential fill`). Never
   force-push, never bypass CI, never weaken branch protection. Always leave `main` green
   and deployable; never delete or weaken tests to make a change pass.
8. **Reflect.** Append a dated entry to `docs/auto-log.md` — the assessment, the move and
   why, and the result (PR # or "shipped nothing, because…") — in the **same PR**, so the
   next run starts where this one ended. Carry forward any insight a future run should
   know (e.g. "these two views look redundant but are not").

## Output

End the run with a one-paragraph summary: what you proposed, the reviewer's verdict, and
whether you shipped (with the PR/commit) or shipped nothing and why. If you shipped,
confirm the deploy workflow was triggered.
