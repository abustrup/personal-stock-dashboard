import { describe, expect, it } from "vitest";
import {
  deriveFundamentalAxes,
  deriveMarketMetrics,
  mergeMarketSnapshot,
  pctReturn,
  rangePosition,
} from "./market";
import type { Company, MarketSnapshot } from "./types";

const ramp = (from: number, to: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

describe("market metrics", () => {
  it("computes trailing returns and ignores too-short windows", () => {
    const closes = ramp(100, 110, 64); // +10% over the whole ~3m window
    expect(pctReturn(closes, 63)).toBeCloseTo(10, 1);
    expect(pctReturn(closes, 126)).toBeUndefined();
  });

  it("places price within its 52-week range", () => {
    expect(rangePosition(150, 200, 100)).toBeCloseTo(0.5);
    expect(rangePosition(200, 200, 100)).toBe(1);
    expect(rangePosition(100, 100, 100)).toBeUndefined(); // degenerate range
    expect(rangePosition(100, 200, 0)).toBeUndefined(); // bogus zero low
  });

  it("scores a strong uptrend near the top of its range high", () => {
    const strong = deriveMarketMetrics({
      price: 200,
      closes: ramp(100, 200, 130),
      fiftyTwoWeekHigh: 200,
      fiftyTwoWeekLow: 100,
    });
    expect(strong.momentum).toBeGreaterThan(85);

    const weak = deriveMarketMetrics({
      price: 105,
      closes: ramp(200, 105, 130),
      fiftyTwoWeekHigh: 210,
      fiftyTwoWeekLow: 100,
    });
    expect(weak.momentum).toBeLessThan(35);
    expect(weak.momentum).toBeLessThan(strong.momentum);
  });

  it("derives sane fundamental axes for a strong vs a weak company", () => {
    const strong = deriveFundamentalAxes({
      revenueGrowth: 0.85,
      profitMargins: 0.63,
      returnOnEquity: 1.14,
      forwardPE: 15,
      priceToSales: 18,
      totalCash: 53e9,
      totalDebt: 12e9,
      marketCap: 3e12,
      currentRatio: 3.4,
    });
    expect(strong.growth).toBeGreaterThan(85);
    expect(strong.quality).toBeGreaterThan(90);
    expect(strong.balanceSheetRisk).toBeLessThan(45); // net cash → low risk

    const weak = deriveFundamentalAxes({
      revenueGrowth: -0.1,
      profitMargins: 0.02,
      returnOnEquity: 0.03,
      forwardPE: 55,
      priceToSales: 16,
      totalCash: 1e9,
      totalDebt: 12e9,
      marketCap: 5e9,
      currentRatio: 0.8,
    });
    expect(weak.growth).toBeLessThan(40);
    expect(weak.quality).toBeLessThan(30);
    expect(weak.valuationRisk).toBeGreaterThan(70);
    expect(weak.balanceSheetRisk).toBeGreaterThan(70); // net debt + weak liquidity
  });

  it("falls back to neutral axes when fundamentals are missing", () => {
    const axes = deriveFundamentalAxes({});
    for (const v of Object.values(axes)) {
      expect(v).toBeGreaterThanOrEqual(40);
      expect(v).toBeLessThanOrEqual(55);
    }
  });

  it("overrides editorial axes from a snapshot's fundamentals but leaves aiExposure/geo editorial", () => {
    const company = {
      symbol: "NVDA",
      momentum: 50,
      growth: 50,
      quality: 50,
      valuationRisk: 50,
      balanceSheetRisk: 50,
      aiExposure: 97,
      geopoliticalRisk: 42,
    } as Company;
    const snapshot: MarketSnapshot = {
      symbol: "NVDA",
      price: 198,
      currency: "USD",
      momentum: 88,
      asOf: "2026-06-24T00:00:00.000Z",
      fundamentals: {
        growth: 91,
        quality: 95,
        valuationRisk: 40,
        balanceSheetRisk: 12,
      },
    };
    const merged = mergeMarketSnapshot(company, { NVDA: snapshot });
    expect(merged.growth).toBe(91);
    expect(merged.quality).toBe(95);
    expect(merged.balanceSheetRisk).toBe(12);
    expect(merged.aiExposure).toBe(97); // editorial, untouched
    expect(merged.geopoliticalRisk).toBe(42); // editorial, untouched
  });

  it("overrides editorial momentum with the measured value when a snapshot exists", () => {
    const company = { symbol: "NVDA", momentum: 50 } as Company;
    const snapshot: MarketSnapshot = {
      symbol: "NVDA",
      price: 198,
      currency: "USD",
      momentum: 91,
      asOf: "2026-06-24T00:00:00.000Z",
    };

    const merged = mergeMarketSnapshot(company, { NVDA: snapshot });
    expect(merged.momentum).toBe(91);
    expect(merged.market?.price).toBe(198);

    // No snapshot leaves the company untouched.
    expect(mergeMarketSnapshot(company, {}).momentum).toBe(50);
  });
});
