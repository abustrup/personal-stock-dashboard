// Live portfolio valuation, computed client-side from measured prices.
//
// The imported portfolio carries the broker's DKK figures frozen at import time
// (Holding.marketValueDkk). This module re-prices the book from the live market
// snapshots the refresh routine fetches, so the headline NAV tracks the market
// instead of the import.
//
// FX is import-implied, not live: marketValueDkk already equals
// quantity x currentPrice x (FX at import), so dividing by the import's native
// price recovers quantity x FX. Multiplying a fresh native price by that factor
// gives the live DKK value, converted at the import's FX — good enough intraday
// (FX barely moves vs. price); a live FX feed is a later phase. A holding with no
// live snapshot, a currency mismatch, or no usable import price falls back to its
// imported value and is reported as not-covered, so the number is never faked.

import type { Recommendation } from "./types";

export type LiveValuation = {
  /** Headline DKK value: covered holdings at the live price, the rest at their imported value. */
  liveValueDkk: number;
  /** Sum of the imported marketValueDkk — the reference the live value is measured against. */
  importedValueDkk: number;
  /** All-time gain in DKK (covered: live value − cost basis; uncovered: imported gain). */
  liveGainDkk: number;
  /** All-time return %, gain over cost basis. */
  liveReturnPct: number;
  /** Today's gain in DKK (covered: from the previous close; uncovered: imported day gain). */
  liveDayGainDkk: number;
  /** Today's % move on the book value (gain over yesterday's value). */
  liveDayPct: number;
  /** Holdings priced from a live snapshot. */
  covered: number;
  /** Total holdings in the book. */
  total: number;
  /** Covered holdings as a percent of imported book value. */
  coveredWeightPct: number;
  /** True when at least one holding is live — the headline may be called live. */
  anyLive: boolean;
  /** True when every holding is live. */
  allLive: boolean;
};

/**
 * The DKK-per-native-price factor implied by the import (≈ quantity × FX). Returns
 * undefined when the import lacks a usable native price to divide by, so the caller
 * falls back rather than dividing by zero.
 */
export function importFxFactor(holding: { marketValueDkk: number; currentPrice: number }): number | undefined {
  if (!(holding.currentPrice > 0)) return undefined;
  const factor = holding.marketValueDkk / holding.currentPrice;
  return Number.isFinite(factor) && factor > 0 ? factor : undefined;
}

/**
 * The DKK cost basis for a holding: the broker's own costBasisDkk when present,
 * else reconstructed from the imported value minus its all-time gain. Defined once
 * so the per-row ledger TOTAL (liveHoldingReturnPct) and the headline NAV
 * (valuePortfolio) can never diverge on how a basis is derived.
 */
function costBasisOf(holding: { marketValueDkk: number; costBasisDkk?: number; totalGainDkk?: number }): number {
  return holding.costBasisDkk ?? holding.marketValueDkk - (holding.totalGainDkk ?? 0);
}

/**
 * Is this holding re-priced from a live snapshot? The single predicate the headline
 * NAV and any per-row "live" treatment must share: a usable snapshot price in the
 * holding's own currency, with an import-implied FX factor to convert it. Exported so
 * the ledger row decides "show the live day-change" with the EXACT same test the
 * headline uses to fold a holding into liveDayPct — they can't drift and silently
 * re-open a row-vs-headline source split.
 */
export function isHoldingLive(
  holding: { currency: string; marketValueDkk: number; currentPrice: number },
  market: { price: number; currency: string } | undefined,
): boolean {
  return (
    market !== undefined &&
    market.price > 0 &&
    market.currency === holding.currency &&
    importFxFactor(holding) !== undefined
  );
}

/**
 * The live all-time return % for a single holding, re-priced from its market
 * snapshot — or undefined when the holding is not live, so the caller falls back to
 * the broker's frozen figure. Uses the EXACT cost basis valuePortfolio sums
 * (costBasisDkk, else marketValueDkk − totalGainDkk) and the SAME isHoldingLive gate,
 * so the ledger TOTAL column and the headline liveReturnPct reconcile by construction:
 * the cost-basis-weighted mean of these per-row returns IS the headline's live return.
 * Returns undefined on a non-positive basis so a degenerate import can't produce a
 * wild percentage — the row falls back to the broker's own totalReturnPct instead.
 */
export function liveHoldingReturnPct(
  holding: {
    currency: string;
    marketValueDkk: number;
    currentPrice: number;
    costBasisDkk?: number;
    totalGainDkk?: number;
  },
  market: { price: number; currency: string } | undefined,
): number | undefined {
  if (!isHoldingLive(holding, market) || market === undefined) return undefined;
  const factor = importFxFactor(holding);
  if (factor === undefined) return undefined;
  const basis = costBasisOf(holding);
  if (!(basis > 0)) return undefined;
  const value = market.price * factor;
  return ((value - basis) / basis) * 100;
}

/**
 * Re-price a portfolio from live market snapshots. Pure: takes the dashboard's
 * portfolio recommendations (each carrying its holding + enriched company.market)
 * and returns the live headline figures plus an honest coverage report.
 */
export function valuePortfolio(portfolio: Recommendation[]): LiveValuation {
  let liveValueDkk = 0;
  let importedValueDkk = 0;
  let costBasisDkk = 0;
  let liveGainDkk = 0;
  let liveDayGainDkk = 0;
  let coveredValueDkk = 0;
  let covered = 0;
  let total = 0;

  for (const rec of portfolio) {
    const holding = rec.holding;
    if (!holding) continue;
    total += 1;
    importedValueDkk += holding.marketValueDkk;
    const basis = costBasisOf(holding);
    costBasisDkk += basis;

    const market = rec.company.market;
    const factor = importFxFactor(holding);
    const isLive = isHoldingLive(holding, market);

    if (isLive && market && factor !== undefined) {
      const value = market.price * factor;
      const prevClose =
        market.previousClose !== undefined && market.previousClose > 0
          ? market.previousClose
          : market.dayChangePct !== undefined
            ? market.price / (1 + market.dayChangePct / 100)
            : undefined;
      liveValueDkk += value;
      liveGainDkk += value - basis;
      liveDayGainDkk += prevClose !== undefined ? (market.price - prevClose) * factor : 0;
      coveredValueDkk += holding.marketValueDkk;
      covered += 1;
    } else {
      liveValueDkk += holding.marketValueDkk;
      liveGainDkk += holding.totalGainDkk ?? holding.marketValueDkk - basis;
      liveDayGainDkk += holding.dayGainDkk ?? 0;
    }
  }

  const liveReturnPct = costBasisDkk > 0 ? (liveGainDkk / costBasisDkk) * 100 : 0;
  const prevValue = liveValueDkk - liveDayGainDkk;
  const liveDayPct = prevValue > 0 ? (liveDayGainDkk / prevValue) * 100 : 0;
  const coveredWeightPct = importedValueDkk > 0 ? (coveredValueDkk / importedValueDkk) * 100 : 0;

  return {
    liveValueDkk,
    importedValueDkk,
    liveGainDkk,
    liveReturnPct,
    liveDayGainDkk,
    liveDayPct,
    covered,
    total,
    coveredWeightPct,
    anyLive: covered > 0,
    allLive: total > 0 && covered === total,
  };
}
