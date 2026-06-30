import type { Company, Fundamentals, MarketSnapshot } from "./types";

export type MarketMetrics = {
  return1m?: number;
  return3m?: number;
  return6m?: number;
  rangePosition?: number;
  momentum: number;
};

// Approximate trading days per window.
const LOOKBACK = { month: 21, quarter: 63, halfYear: 126 } as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Clamp `value` into [min, max]. Defaults to the 0-100 score/percent band. */
export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/** Percent return over `lookback` trading days, or undefined if history is too short. */
export function pctReturn(closes: number[], lookback: number): number | undefined {
  if (closes.length === 0) return undefined;
  const last = closes[closes.length - 1];
  const baseIndex = closes.length - 1 - lookback;
  if (baseIndex < 0) return undefined;
  const base = closes[baseIndex];
  if (!base) return undefined;
  return ((last - base) / base) * 100;
}

/** Position within the 52-week range: 0 at the low, 1 at the high. */
export function rangePosition(
  price: number,
  high: number | undefined,
  low: number | undefined,
): number | undefined {
  // A real 52-week low is strictly positive; reject 0/missing bounds (some
  // providers return low=0) so a bogus range cannot inflate momentum.
  if (high === undefined || low === undefined || low <= 0 || high <= low) return undefined;
  return clamp01((price - low) / (high - low));
}

/**
 * Momentum 0-100 from price action only. Blends where the price sits in its
 * 52-week range (60%) with the 3-month trend (40%, where ±30% spans the band).
 * Transparent and reproducible — no editorial judgement.
 */
export function deriveMarketMetrics(input: {
  price: number;
  closes: number[];
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}): MarketMetrics {
  const closes = input.closes.filter((value) => Number.isFinite(value) && value > 0);
  const return1m = pctReturn(closes, LOOKBACK.month);
  const return3m = pctReturn(closes, LOOKBACK.quarter);
  const return6m = pctReturn(closes, LOOKBACK.halfYear);
  const position = rangePosition(input.price, input.fiftyTwoWeekHigh, input.fiftyTwoWeekLow);

  const trend = clamp01(0.5 + (return3m ?? 0) / 60);
  const pos = position ?? 0.5;
  const momentum = Math.round(100 * (0.6 * pos + 0.4 * trend));

  return { return1m, return3m, return6m, rangePosition: position, momentum };
}

type FundamentalInputs = {
  trailingPE?: number;
  forwardPE?: number;
  priceToSales?: number;
  revenueGrowth?: number;
  earningsGrowth?: number;
  profitMargins?: number;
  returnOnEquity?: number;
  debtToEquity?: number;
  currentRatio?: number;
  totalCash?: number;
  totalDebt?: number;
  marketCap?: number;
};

const num = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Turn reported fundamentals into the same 0-100 axes the editorial seeds use,
 * so scoring stays unchanged but is driven by real data. Thresholds are explicit
 * and documented — judgement-laden but transparent and reproducible.
 */
export function deriveFundamentalAxes(input: FundamentalInputs): {
  growth: number;
  quality: number;
  valuationRisk: number;
  balanceSheetRisk: number;
} {
  // Growth: revenue growth is primary; earnings growth a capped secondary.
  const revScore = num(input.revenueGrowth) ? clamp01(0.4 + input.revenueGrowth * 1.2) : 0.5;
  const earnScore = num(input.earningsGrowth) ? clamp01(0.4 + Math.min(input.earningsGrowth, 1) * 0.8) : revScore;
  const growth = Math.round(100 * (0.7 * revScore + 0.3 * earnScore));

  // Quality: profit margins + return on equity.
  const marginScore = num(input.profitMargins) ? clamp01(input.profitMargins * 2.2) : 0.5;
  const roeScore = num(input.returnOnEquity) ? clamp01(input.returnOnEquity * 1.8) : 0.5;
  const quality = Math.round(100 * (0.55 * marginScore + 0.45 * roeScore));

  // Valuation risk: only positive P/E is meaningful. A negative/zero P/E means
  // no (or negative) earnings — valuation fragility, not "cheap" — so it must not
  // floor to low risk. Prefer a valid forward P/E, else a valid trailing P/E.
  const psRisk = num(input.priceToSales) ? clamp01((input.priceToSales - 1) / 19) : undefined; // 1x → 0, 20x → 1
  const fwd = num(input.forwardPE) && input.forwardPE > 0 ? input.forwardPE : undefined;
  const trl = num(input.trailingPE) && input.trailingPE > 0 ? input.trailingPE : undefined;
  const pe = fwd ?? trl;
  const lossMaking = (num(input.forwardPE) && input.forwardPE <= 0) || (num(input.trailingPE) && input.trailingPE <= 0);
  let peRisk: number;
  if (pe !== undefined) peRisk = clamp01((pe - 8) / 52); // 8x → 0, 60x → 1
  else if (lossMaking) peRisk = 0.85; // negative earnings → elevated valuation risk
  else peRisk = psRisk ?? 0.5; // no earnings data → let price/sales carry it
  const valuationRisk = Math.round(100 * (0.6 * peRisk + 0.4 * (psRisk ?? peRisk)));

  // Balance-sheet risk: net cash vs market cap is the clean signal, anchored at 35
  // for break-even and continuous across the net-cash/net-debt boundary.
  let bsRisk = 45;
  if (num(input.totalCash) && num(input.totalDebt) && num(input.marketCap) && input.marketCap > 0) {
    const netCashRatio = (input.totalCash - input.totalDebt) / input.marketCap;
    bsRisk =
      netCashRatio >= 0
        ? Math.max(20, 35 - Math.min(netCashRatio, 0.8) * 18.75) // net cash: 0 → 35, 0.8 → 20
        : Math.min(95, 35 - netCashRatio * 120); // net debt: 0 → 35, -0.5 → 95
  } else if (num(input.debtToEquity)) {
    bsRisk = 20 + input.debtToEquity * 0.28; // treat as percent: 100% → 48
  }
  if (num(input.currentRatio) && input.currentRatio < 1) bsRisk += (1 - input.currentRatio) * 30;
  const balanceSheetRisk = Math.round(clamp(bsRisk));

  return { growth, quality, valuationRisk, balanceSheetRisk };
}

export type MarketSnapshotMap = Record<string, MarketSnapshot>;

/**
 * Overlay a measured market snapshot onto a company: attach the snapshot and
 * replace the editorial momentum estimate with the measured value so scoring
 * reflects real price action.
 */
export function mergeMarketSnapshot<T extends Company>(company: T, snapshots: MarketSnapshotMap): T {
  const snapshot = snapshots[company.symbol];
  if (!snapshot) return company;
  const merged: T = { ...company, momentum: snapshot.momentum, market: snapshot };
  // Replace the measurable editorial axes with fundamentals-derived ones when
  // available. aiExposure and geopoliticalRisk stay editorial (thesis inputs).
  const f: Fundamentals | undefined = snapshot.fundamentals;
  if (f) {
    merged.growth = f.growth;
    merged.quality = f.quality;
    merged.valuationRisk = f.valuationRisk;
    merged.balanceSheetRisk = f.balanceSheetRisk;
  }
  return merged;
}
