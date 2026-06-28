import type { Company, MarketSnapshot } from "./types";

export type MarketMetrics = {
  return1m?: number;
  return3m?: number;
  return6m?: number;
  rangePosition?: number;
  momentum: number;
};

// Approximate trading days per window.
const LOOKBACK = { month: 21, quarter: 63, halfYear: 126 } as const;

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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

export type MarketSnapshotMap = Record<string, MarketSnapshot>;

/**
 * Overlay a measured market snapshot onto a company: attach the snapshot and
 * replace the editorial momentum estimate with the measured value so scoring
 * reflects real price action.
 */
export function mergeMarketSnapshot<T extends Company>(company: T, snapshots: MarketSnapshotMap): T {
  const snapshot = snapshots[company.symbol];
  if (!snapshot) return company;
  return { ...company, momentum: snapshot.momentum, market: snapshot };
}
