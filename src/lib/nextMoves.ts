import type { Company, Recommendation } from "./types";
import { isInvestable, type Investability } from "./investability";
import { planPosition, type PositionPlan } from "./positionPlan";
import { themeExposure, type StandoutExposure } from "./opportunities";

/**
 * The deploy queue: after the single standout idea, the *next* best ideas you can
 * concretely act on — each already sized to your per-trade slot. The Opportunities
 * overview already leads with one standout (with a whole-share buy plan) and lists
 * everything grouped by theme, but those grouped rows never tell you how many shares
 * your slot buys or whether you can act on the name at all. This turns the top of the
 * ranked field into a short, ordered shortlist of concrete moves: name, model score,
 * the whole-share buy plan, and whether it opens new ground or doubles a tilt.
 *
 * It is deliberately the synthesis a broker can't give: ranked by the model's own
 * score, gated to what YOUR broker can trade at YOUR budget, and sized to whole
 * shares — not a flat "top movers" list. Every input is reused from the dashboard
 * model and the same tested investability/sizing/exposure helpers the standout and
 * detail view use, so the queue can never disagree with the rest of the app.
 */
export type NextMove = {
  /** The idea, with the model's own score, action and compliance. */
  rec: Recommendation;
  /** A concrete whole-share buy plan sized to the per-trade slot. Always "fits". */
  plan: PositionPlan;
  /** Your portfolio's exposure to its primary theme (gap vs. tilt), or undefined when untyped. */
  exposure?: StandoutExposure;
  /**
   * 1-based rank among the ideas you can CONCRETELY buy now (priced and sized to a
   * whole share), in the model's score order. The standout consumes rank 1 only when
   * it is itself buyable-sized — so the queue usually reads 2, 3, …; when the standout
   * has no live price yet it can't be bought sized, so it isn't counted and the queue
   * honestly starts at 1. Either way the number is the idea's standing among the
   * names you can actually act on, not a bare list position.
   */
  rank: number;
};

export type BuildNextMovesOptions = {
  /** How many moves to list (after any exclusion). Defaults to 3. */
  limit?: number;
  /** A symbol to leave out of the list (the standout, already shown as the hero). */
  excludeSymbol?: string;
};

const DEFAULT_LIMIT = 3;

/**
 * Build the sized deploy queue from the pre-ranked opportunity set. An idea joins
 * the queue only when it is genuinely actionable: not an `avoid`, on a market your
 * broker trades and within budget (`isInvestable`), and with a known price that
 * sizes to at least one whole share inside the slot (`planPosition` → "fits"). An
 * un-priced name is left out rather than shown unsized — the honest default, the
 * same one the standout's buy plan uses.
 *
 * `investabilityFor` is the SAME resolver the rest of the dashboard reads, so the
 * gate here matches the standout, the reach panel and the badges exactly. Ranking
 * follows the input order (the model's score order); the standout is counted toward
 * the rank so the listed moves read 2, 3, … beneath it, then excluded from the list.
 */
export function buildNextMoves(
  opportunities: Recommendation[],
  investabilityFor: (company: Company) => Investability,
  portfolio: Recommendation[],
  bookValueDkk: number,
  options: BuildNextMovesOptions = {},
): NextMove[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const excludeSymbol = options.excludeSymbol;
  if (limit <= 0) return [];

  const moves: NextMove[] = [];
  let rank = 0;

  for (const rec of opportunities) {
    if (rec.action === "avoid") continue;
    const inv = investabilityFor(rec.company);
    if (!isInvestable(inv)) continue;
    const plan = planPosition(inv, bookValueDkk);
    if (!plan || plan.status !== "fits") continue;

    // Counted toward the actionable rank whether or not it is listed, so the
    // standout (rank 1, when it is itself buyable-sized) and the queue numbers stay
    // consistent. An un-priced standout never reaches here, so the queue then starts
    // at 1 — honestly the best name you can actually buy.
    rank += 1;
    if (rec.company.symbol === excludeSymbol) continue;

    const theme = rec.company.themes[0];
    const exposure = theme ? themeExposure(portfolio, theme) : undefined;
    moves.push({ rec, plan, exposure, rank });
    if (moves.length >= limit) break;
  }

  return moves;
}
