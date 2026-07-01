import { type Investability, DKK } from "./investability";

/**
 * The step a broker's "top movers" never takes: turning "you can afford this" into
 * a concrete buy plan tuned to how THIS person actually buys. The owner deploys a
 * fixed per-trade slot (~5,000 DKK, about a tenth of a ~40,000 DKK book) and can
 * only buy whole shares — so the useful facts are how many whole shares that slot
 * buys, the DKK it really ties up (whole-share rounding leaves a remainder), and
 * what fraction of the current book that one position becomes.
 *
 * Everything here is derived from already-assessed investability: the share price
 * (measured, approximate FX for non-DKK) and the user-declared budget. It never
 * touches the model score or P&L — it only sizes a position the user could open.
 */
export type PositionPlan = {
  /** "fits": at least one whole share fits the slot. "over": one share already exceeds it. */
  status: "fits" | "over";
  /** Whole shares the per-trade budget buys — ≥1 when it fits, 0 when one share is already over. */
  shares: number;
  /** Approx DKK the position ties up: fits → shares × price; over → the price of a single share. */
  costDkk: number;
  /** Per-share price in DKK the plan was sized from (approximate for non-DKK listings). */
  sharePriceDkk: number;
  /** The per-trade budget (the slot) this was sized against. */
  budgetDkk: number;
  /** Fraction of the slot the whole-share cost uses, 0–1 — below 1 when rounding leaves a remainder. */
  budgetUse: number;
  /** How many slots a single share costs (cost ÷ budget) — ≥1 only in the "over" case. */
  slotMultiple: number;
  /** This position as a fraction of the current book, 0–1; undefined when the book value is unknown. */
  bookFraction?: number;
  /** True when the share price relied on an approximate FX conversion (not DKK-native). */
  fxApprox: boolean;
};

/**
 * Size a position from an investability assessment and the current book value.
 * Returns undefined when no honest plan can be drawn — a market the broker can't
 * trade (you can't open a position at all) or a name with no known share price yet
 * (un-refreshed). An unknown price is left unplanned rather than guessed.
 */
export function planPosition(inv: Investability, bookValueDkk: number): PositionPlan | undefined {
  if (!inv.tradable) return undefined;
  const sharePriceDkk = inv.sharePriceDkk;
  if (sharePriceDkk === undefined || sharePriceDkk <= 0) return undefined;

  const budgetDkk = inv.budgetDkk;
  const book = bookValueDkk > 0 ? bookValueDkk : undefined;
  const shares = budgetDkk > 0 ? Math.floor(budgetDkk / sharePriceDkk) : 0;

  if (shares >= 1) {
    const costDkk = shares * sharePriceDkk;
    return {
      status: "fits",
      shares,
      costDkk,
      sharePriceDkk,
      budgetDkk,
      budgetUse: Math.min(1, costDkk / budgetDkk),
      slotMultiple: costDkk / budgetDkk,
      bookFraction: book ? costDkk / book : undefined,
      fxApprox: inv.fxApprox,
    };
  }

  // One share already overshoots the slot — the position can't be sized down.
  return {
    status: "over",
    shares: 0,
    costDkk: sharePriceDkk,
    sharePriceDkk,
    budgetDkk,
    budgetUse: 1,
    slotMultiple: budgetDkk > 0 ? sharePriceDkk / budgetDkk : Infinity,
    bookFraction: book ? sharePriceDkk / book : undefined,
    fxApprox: inv.fxApprox,
  };
}

/** Round a 0–1 fraction to a percent, never showing a non-zero share as a bare "0%". */
export function bookPctLabel(fraction: number | undefined): string | undefined {
  if (fraction === undefined) return undefined;
  const pct = fraction * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

/** A short, prominent figure for the buy plan — "≈ 4 shares · DKK 4,800". */
export function planHeadline(plan: PositionPlan): string {
  if (plan.status === "over") {
    return `1 share ≈ DKK ${DKK.format(plan.costDkk)}${plan.fxApprox ? " (approx)" : ""}`;
  }
  const unit = plan.shares === 1 ? "share" : "shares";
  return `≈ ${DKK.format(plan.shares)} ${unit} · DKK ${DKK.format(plan.costDkk)}${plan.fxApprox ? " (approx)" : ""}`;
}

/** One plain-language line for the front-page card, detail view and tooltips. */
export function describePlan(plan: PositionPlan): string {
  const ofBook = bookPctLabel(plan.bookFraction);
  if (plan.status === "over") {
    const multiple = plan.slotMultiple >= 10 ? "over 10" : plan.slotMultiple.toFixed(1);
    const tail = ofBook ? ` — about ${ofBook} of your book` : "";
    return `One share ≈ DKK ${DKK.format(plan.costDkk)}${plan.fxApprox ? " (approx)" : ""}, ${multiple}× your DKK ${DKK.format(plan.budgetDkk)} slot${tail}. The smallest position already overshoots your sizing.`;
  }
  const unit = plan.shares === 1 ? "share" : "shares";
  const leftover = plan.budgetDkk - plan.costDkk;
  const remainder =
    leftover >= 1 ? ` leaving DKK ${DKK.format(leftover)} of the slot unused` : " using the slot almost exactly";
  const tail = ofBook ? `, about ${ofBook} of your current book` : "";
  return `≈ ${DKK.format(plan.shares)} ${unit} for DKK ${DKK.format(plan.costDkk)}${plan.fxApprox ? " (approx)" : ""}${tail} —${remainder}.`;
}
