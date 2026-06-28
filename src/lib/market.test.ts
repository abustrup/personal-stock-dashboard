import { describe, expect, it } from "vitest";
import { deriveMarketMetrics, mergeMarketSnapshot, pctReturn, rangePosition } from "./market";
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
