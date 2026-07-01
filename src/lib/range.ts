import { clamp01 } from "./market";
import { isFiniteNumber } from "./number";
import type { MarketSnapshot } from "./types";

// Where a name's latest price sits inside its measured 52-week range. This is
// MEASURED data (price + the trailing-year high/low from the market provider),
// never an editorial estimate — it is the broker-beating context a flat price
// list can't show at a glance: a high-scoring idea near its 52-week LOW is
// basing/turning, while one near its HIGH is extended. The canonical position is
// `market.rangePosition` from the refresh; we recompute from price + high/low
// only as a fallback so the math has a single source of truth (market.ts).

export type RangeBand = "near-low" | "lower" | "mid" | "upper" | "near-high";

export type RangeRead = {
  /** 0 = at the 52-week low, 1 = at the 52-week high. */
  position: number;
  band: RangeBand;
  /** Plain-words long label, e.g. "near 52w high". */
  label: string;
  /** Compact label for a dense cell, e.g. "near high". */
  shortLabel: string;
  /** Percent of the 52-week range the price sits above the low (0 at low, 100 at high). */
  pctAboveLow: number;
  /** The measured bounds — present only when the snapshot actually carries them, so a
   *  caller never describes a fabricated range. */
  low?: number;
  high?: number;
  price: number;
  currency: string;
};

// The 52-week position 0..1, preferring the canonical `rangePosition` and falling
// back to deriving it from price and the 52-week high/low. Undefined when there is
// no measured range to read (an editorial-only name), so callers omit rather than
// guess.
export function rangePositionOf(market?: MarketSnapshot): number | undefined {
  if (!market) return undefined;
  if (isFiniteNumber(market.rangePosition)) return clamp01(market.rangePosition);
  const { price, fiftyTwoWeekHigh: high, fiftyTwoWeekLow: low } = market;
  if (isFiniteNumber(price) && isFiniteNumber(high) && isFiniteNumber(low) && high > low) {
    return clamp01((price - low) / (high - low));
  }
  return undefined;
}

// The canonical band thresholds, shared by every range read in the app so the
// long label, the short label and any colouring never drift apart.
export function rangeBand(position: number): RangeBand {
  if (position >= 0.85) return "near-high";
  if (position <= 0.15) return "near-low";
  if (position >= 0.6) return "upper";
  if (position <= 0.4) return "lower";
  return "mid";
}

const LONG_LABELS: Record<RangeBand, string> = {
  "near-high": "near 52w high",
  upper: "upper 52w range",
  mid: "mid 52w range",
  lower: "lower 52w range",
  "near-low": "near 52w low",
};

const SHORT_LABELS: Record<RangeBand, string> = {
  "near-high": "near high",
  upper: "upper",
  mid: "mid",
  lower: "lower",
  "near-low": "near low",
};

// The plain-words 52-week label used across the dashboard. Undefined input yields
// undefined so a caption simply omits it rather than guessing.
export function rangeLabel(position: number | undefined): string | undefined {
  if (position === undefined) return undefined;
  return LONG_LABELS[rangeBand(position)];
}

// A full read for the range cell: position, band, both labels, and the measured
// numbers behind it (for an exact, screen-reader-friendly description). Undefined
// when the name carries no measured 52-week range.
export function readRange(market?: MarketSnapshot): RangeRead | undefined {
  const position = rangePositionOf(market);
  if (position === undefined || !market) return undefined;
  const band = rangeBand(position);
  return {
    position,
    band,
    label: LONG_LABELS[band],
    shortLabel: SHORT_LABELS[band],
    pctAboveLow: position * 100,
    low: isFiniteNumber(market.fiftyTwoWeekLow) ? market.fiftyTwoWeekLow : undefined,
    high: isFiniteNumber(market.fiftyTwoWeekHigh) ? market.fiftyTwoWeekHigh : undefined,
    price: market.price,
    currency: market.currency,
  };
}
