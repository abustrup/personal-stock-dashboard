import { OWNED_SCORE_THRESHOLDS, ownedActionForScore } from "./recommendations";
import type { Recommendation, RecommendationAction } from "./types";

// The model's verdict on your WHOLE book — the synthesis a broker's holdings screen
// never draws. It scores each holding the same way the ledger does, then rolls those
// verdicts up by how much money actually sits behind each one. Two distinct readings:
//   • the position-weighted score (the dial), read in the SAME verdict language the
//     per-holding action uses — so "your book is in hold range" means exactly what a
//     single holding's "hold" means; the thresholds come from recommendations.ts, so
//     the book dial and the row verdicts can never disagree.
//   • the capital split by stance (add / hold / reduce) — what share of YOUR money the
//     model would add to, sit on, or pull back. A broker shows the per-line weights; it
//     never editorialises them into a forward verdict on the book.
// Pure rollup of the existing tested model: no new data, nothing measured-vs-editorial
// to relabel. The honesty caveat the score already carries is surfaced as measuredShare.

/** The three forward stances an owned verdict collapses into for the capital split. */
export type Stance = "add" | "hold" | "reduce";

/** One stance's slice of the book: how many holdings, and what share of its weight. */
export type StanceSlice = {
  stance: Stance;
  /** Number of owned holdings whose verdict falls in this stance. */
  holdings: number;
  /** Share of the book's weight in this stance, as a percent number (e.g. 18.4). */
  weightPct: number;
};

/** Which owned action maps to which capital stance. */
export function stanceForAction(action: RecommendationAction): Stance {
  if (action === "increase") return "add";
  if (action === "hold") return "hold";
  return "reduce"; // trim, avoid (owned holdings never carry the non-owned actions)
}

export type BookScorecard = {
  /** Number of owned holdings the verdict is rolled up from. */
  count: number;
  /** Position-weighted average model score, 0-100 (rounded). */
  weightedScore: number;
  /** The verdict the weighted score maps to, in the model's own owned-action language. */
  verdict: RecommendationAction;
  /** Distance to the next-higher verdict tier; absent once the book is already in "increase". */
  toNextTier?: { action: RecommendationAction; points: number };
  /** Always three slices (add, hold, reduce) in that order; weightPct sums to ~100. */
  stances: StanceSlice[];
  /** Share of the book's weight the model would add to / hold / reduce (percent numbers). */
  addWeightPct: number;
  holdWeightPct: number;
  reduceWeightPct: number;
  /** Highest- and lowest-scoring owned holdings — the book's anchor and its drag. */
  best: Recommendation;
  worst: Recommendation;
  /**
   * Fraction (0-1) of the book's weight whose score rests on MEASURED data (a live
   * price snapshot or live signal) rather than editorial estimates. The honesty
   * caveat the dial number carries — high when a refresh has run, low in demo mode.
   */
  measuredShare: number;
  /**
   * Share (0-1) of the book's weight whose MOMENTUM input is measured (a live price
   * snapshot exists) rather than an editorial momentum estimate.
   */
  momentumMeasuredShare: number;
  /**
   * Share (0-1) of the book's weight whose FUNDAMENTALS (growth / quality / valuation /
   * balance-sheet) were fetched rather than editorial. Kept distinct from momentum
   * because the two are sourced independently — and AI exposure and geopolitical risk
   * are editorial for EVERY name regardless, so neither share is ever a claim that a
   * whole score is measured.
   */
  fundamentalsMeasuredShare: number;
};

const STANCE_ORDER: Stance[] = ["add", "hold", "reduce"];

/**
 * Roll the owned book up into a single model verdict. Returns undefined when no
 * holding carries a position, so the front page can omit the band rather than draw
 * an empty dial. Weights are the imported portfolio weights; if those are all absent
 * or zero (a degenerate import) every holding counts equally, so the rollup never
 * silently collapses to a single name.
 */
export function buildBookScorecard(portfolio: Recommendation[]): BookScorecard | undefined {
  const owned = portfolio.filter((rec) => rec.holding);
  if (owned.length === 0) return undefined;

  // Each holding's weight basis: its portfolio weight, falling back to equal weight
  // for the whole book if no positive weight is present at all.
  const rawWeights = owned.map((rec) => Math.max(rec.holding?.portfolioWeight ?? 0, 0));
  const rawTotal = rawWeights.reduce((sum, w) => sum + w, 0);
  const weights = rawTotal > 0 ? rawWeights : owned.map(() => 1);
  const totalWeight = rawTotal > 0 ? rawTotal : owned.length;

  const weightedScore = Math.round(
    owned.reduce((sum, rec, i) => sum + rec.score * weights[i], 0) / totalWeight,
  );
  const verdict = ownedActionForScore(weightedScore);

  const stanceWeight: Record<Stance, number> = { add: 0, hold: 0, reduce: 0 };
  const stanceCount: Record<Stance, number> = { add: 0, hold: 0, reduce: 0 };
  let measuredWeight = 0;
  let momentumWeight = 0;
  let fundamentalsWeight = 0;
  owned.forEach((rec, i) => {
    const stance = stanceForAction(rec.action);
    stanceWeight[stance] += weights[i];
    stanceCount[stance] += 1;
    if (rec.measured) measuredWeight += weights[i];
    if (rec.company.market) momentumWeight += weights[i];
    if (rec.company.market?.fundamentals) fundamentalsWeight += weights[i];
  });

  const stances: StanceSlice[] = STANCE_ORDER.map((stance) => ({
    stance,
    holdings: stanceCount[stance],
    weightPct: (stanceWeight[stance] / totalWeight) * 100,
  }));

  const byScore = [...owned].sort((a, b) => b.score - a.score);

  return {
    count: owned.length,
    weightedScore,
    verdict,
    toNextTier: nextTier(weightedScore),
    stances,
    addWeightPct: (stanceWeight.add / totalWeight) * 100,
    holdWeightPct: (stanceWeight.hold / totalWeight) * 100,
    reduceWeightPct: (stanceWeight.reduce / totalWeight) * 100,
    best: byScore[0],
    worst: byScore[byScore.length - 1],
    measuredShare: measuredWeight / totalWeight,
    momentumMeasuredShare: momentumWeight / totalWeight,
    fundamentalsMeasuredShare: fundamentalsWeight / totalWeight,
  };
}

// The next verdict tier up from a score and how many points away it sits — the
// "how close is the book to a better verdict" read. Undefined once the score is
// already in the top (increase) tier. Uses the exact same cutoffs the per-holding
// verdict uses, so the distance is honest.
function nextTier(score: number): BookScorecard["toNextTier"] {
  if (score >= OWNED_SCORE_THRESHOLDS.increase) return undefined;
  const target = score >= OWNED_SCORE_THRESHOLDS.hold ? OWNED_SCORE_THRESHOLDS.increase : score >= OWNED_SCORE_THRESHOLDS.trim ? OWNED_SCORE_THRESHOLDS.hold : OWNED_SCORE_THRESHOLDS.trim;
  return { action: ownedActionForScore(target), points: target - score };
}
