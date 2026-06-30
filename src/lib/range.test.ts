import { describe, expect, it } from "vitest";
import { rangeBand, rangeLabel, rangePositionOf, readRange } from "./range";
import type { MarketSnapshot } from "./types";

function market(partial: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    symbol: "TST",
    price: 100,
    currency: "USD",
    momentum: 50,
    asOf: "2026-06-30",
    ...partial,
  };
}

describe("rangePositionOf", () => {
  it("prefers the canonical rangePosition when present", () => {
    expect(rangePositionOf(market({ rangePosition: 0.42 }))).toBe(0.42);
  });

  it("derives the position from price and the 52-week high/low", () => {
    const pos = rangePositionOf(
      market({ price: 130, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 }),
    );
    expect(pos).toBeCloseTo(0.3, 5);
  });

  it("prefers rangePosition even when high/low are also present", () => {
    const pos = rangePositionOf(
      market({ rangePosition: 0.9, price: 110, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 }),
    );
    expect(pos).toBe(0.9);
  });

  it("clamps a derived position into [0,1]", () => {
    expect(rangePositionOf(market({ price: 260, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 }))).toBe(1);
    expect(rangePositionOf(market({ price: 80, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 }))).toBe(0);
  });

  it("clamps an out-of-range canonical position", () => {
    expect(rangePositionOf(market({ rangePosition: 1.4 }))).toBe(1);
    expect(rangePositionOf(market({ rangePosition: -0.2 }))).toBe(0);
  });

  it("returns undefined without a usable range (editorial-only name)", () => {
    expect(rangePositionOf(undefined)).toBeUndefined();
    expect(rangePositionOf(market({}))).toBeUndefined();
    // A degenerate range (high == low) has no position to read.
    expect(rangePositionOf(market({ price: 100, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 100 }))).toBeUndefined();
  });

  it("ignores non-finite inputs", () => {
    expect(rangePositionOf(market({ rangePosition: NaN, price: 130, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 }))).toBeCloseTo(0.3, 5);
    expect(rangePositionOf(market({ price: NaN, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 }))).toBeUndefined();
  });
});

describe("rangeBand", () => {
  it("classifies the five bands at the canonical thresholds", () => {
    expect(rangeBand(0.9)).toBe("near-high");
    expect(rangeBand(0.85)).toBe("near-high");
    expect(rangeBand(0.7)).toBe("upper");
    expect(rangeBand(0.6)).toBe("upper");
    expect(rangeBand(0.5)).toBe("mid");
    expect(rangeBand(0.4)).toBe("lower");
    expect(rangeBand(0.2)).toBe("lower");
    expect(rangeBand(0.15)).toBe("near-low");
    expect(rangeBand(0.05)).toBe("near-low");
  });
});

describe("rangeLabel", () => {
  it("matches the historical plain-words labels", () => {
    expect(rangeLabel(0.9)).toBe("near 52w high");
    expect(rangeLabel(0.7)).toBe("upper 52w range");
    expect(rangeLabel(0.5)).toBe("mid 52w range");
    expect(rangeLabel(0.3)).toBe("lower 52w range");
    expect(rangeLabel(0.1)).toBe("near 52w low");
  });

  it("returns undefined for no position", () => {
    expect(rangeLabel(undefined)).toBeUndefined();
  });
});

describe("readRange", () => {
  it("returns the full read with measured numbers", () => {
    const read = readRange(
      market({ price: 130, currency: "EUR", fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 }),
    );
    expect(read).toEqual({
      position: 0.3,
      band: "lower",
      label: "lower 52w range",
      shortLabel: "lower",
      pctAboveLow: 30,
      low: 100,
      high: 200,
      price: 130,
      currency: "EUR",
    });
  });

  it("omits the measured bounds when the snapshot lacks them", () => {
    // A canonical position with no 52-week high/low: report the position but never
    // fabricate the bounds (they stay undefined so no caller invents a range).
    const read = readRange(market({ rangePosition: 0.3, price: 130, currency: "EUR" }));
    expect(read?.position).toBe(0.3);
    expect(read?.low).toBeUndefined();
    expect(read?.high).toBeUndefined();
    expect(read?.price).toBe(130);
  });

  it("returns undefined for an editorial-only name", () => {
    expect(readRange(market({}))).toBeUndefined();
    expect(readRange(undefined)).toBeUndefined();
  });
});
