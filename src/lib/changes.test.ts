import { describe, expect, it } from "vitest";
import { diffModel, snapshotModel, type ModelSnapshot } from "./changes";
import type { Company, MarketSnapshot, Recommendation } from "./types";

const company = (over: Partial<Company> & { symbol: string }): Company => ({
  name: over.symbol,
  region: "US",
  exchange: "NASDAQ",
  assetType: "stock",
  themes: ["ai-platform"],
  aiExposure: 50,
  growth: 50,
  momentum: 50,
  quality: 50,
  valuationRisk: 50,
  balanceSheetRisk: 30,
  geopoliticalRisk: 30,
  newsSignal: { sentiment: 50, direction: "neutral", summary: "", freshness: "seed", sources: [] },
  expertSignal: { direction: "neutral", summary: "", freshness: "seed", sources: [] },
  ...over,
});

const market = (over: Partial<MarketSnapshot> & { momentum: number; price: number }): MarketSnapshot => ({
  symbol: "x",
  currency: "USD",
  asOf: "2026-06-30",
  ...over,
});

const rec = (
  over: Partial<Omit<Recommendation, "company">> & {
    symbol: string;
    owned?: boolean;
    momentum?: number;
    price?: number;
    companyOver?: Partial<Company>;
  },
): Recommendation => {
  const { symbol, owned, momentum, price, companyOver, ...rest } = over;
  const hasMarket = momentum !== undefined || price !== undefined;
  return {
    company: company({
      symbol,
      ...companyOver,
      market: hasMarket
        ? market({ symbol, momentum: momentum ?? 50, price: price ?? 100 })
        : undefined,
    }),
    holding: owned ? ({ portfolioWeight: 5 } as Recommendation["holding"]) : undefined,
    action: "hold",
    conviction: "medium",
    measured: hasMarket,
    score: 60,
    headline: "",
    reasoning: [],
    downside: "",
    compliance: { status: "unknown", flags: [], source: "" },
    newsSignal: company({ symbol }).newsSignal,
    expertSignal: company({ symbol }).expertSignal,
    freshness: "",
    ...rest,
  };
};

describe("snapshotModel", () => {
  it("captures action, score, measured momentum/price and owned per symbol", () => {
    const snap = snapshotModel(
      [rec({ symbol: "AAA", owned: true, action: "increase", score: 80, momentum: 70, price: 120 })],
      "2026-06-30",
    );
    expect(snap.asOf).toBe("2026-06-30");
    expect(snap.entries.AAA).toEqual({
      action: "increase",
      score: 80,
      momentum: 70,
      price: 120,
      owned: true,
    });
  });

  it("omits momentum/price for an editorial-only name (no market data)", () => {
    const snap = snapshotModel([rec({ symbol: "BBB" })], "2026-06-30");
    expect(snap.entries.BBB.momentum).toBeUndefined();
    expect(snap.entries.BBB.price).toBeUndefined();
  });
});

describe("diffModel", () => {
  it("reports no baseline on a first look", () => {
    const digest = diffModel(undefined, [rec({ symbol: "AAA", momentum: 60 })]);
    expect(digest.hasBaseline).toBe(false);
    expect(digest.changes).toEqual([]);
  });

  it("surfaces a verdict flip and marks it model (not measured)", () => {
    const base = snapshotModel([rec({ symbol: "AAA", action: "hold", momentum: 60 })], "T1");
    const digest = diffModel(base, [rec({ symbol: "AAA", action: "trim", momentum: 60 })]);
    expect(digest.hasBaseline).toBe(true);
    expect(digest.baselineAsOf).toBe("T1");
    expect(digest.changes).toHaveLength(1);
    const change = digest.changes[0];
    expect(change.kind).toBe("verdict");
    expect(change.measured).toBe(false);
    expect(change.direction).toBe("down");
    expect(change.fromAction).toBe("hold");
    expect(change.toAction).toBe("trim");
  });

  it("treats a verdict upgrade as up", () => {
    const base = snapshotModel([rec({ symbol: "AAA", action: "trim", momentum: 60 })], "T1");
    const digest = diffModel(base, [rec({ symbol: "AAA", action: "increase", momentum: 60 })]);
    expect(digest.changes[0].direction).toBe("up");
  });

  it("surfaces a measured momentum move past the threshold and labels it measured", () => {
    const base = snapshotModel([rec({ symbol: "AAA", momentum: 50 })], "T1");
    const digest = diffModel(base, [rec({ symbol: "AAA", momentum: 58 })]);
    expect(digest.changes[0].kind).toBe("momentum");
    expect(digest.changes[0].measured).toBe(true);
    expect(digest.changes[0].fromMomentum).toBe(50);
    expect(digest.changes[0].toMomentum).toBe(58);
  });

  it("ignores a momentum wiggle below the threshold", () => {
    const base = snapshotModel([rec({ symbol: "AAA", momentum: 50 })], "T1");
    const digest = diffModel(base, [rec({ symbol: "AAA", momentum: 52 })]);
    expect(digest.changes).toEqual([]);
  });

  it("computes a measured price move as a percent and respects the threshold", () => {
    const base = snapshotModel([rec({ symbol: "AAA", price: 100, momentum: 50 })], "T1");
    const up = diffModel(base, [rec({ symbol: "AAA", price: 106, momentum: 50 })]);
    expect(up.changes[0].kind).toBe("price");
    expect(up.changes[0].pricePct).toBeCloseTo(6, 5);
    expect(up.changes[0].direction).toBe("up");

    const flat = diffModel(base, [rec({ symbol: "AAA", price: 101, momentum: 50 })]);
    expect(flat.changes).toEqual([]);
  });

  it("keeps only the single most material change per name (verdict wins)", () => {
    const base = snapshotModel([rec({ symbol: "AAA", action: "hold", momentum: 50, price: 100 })], "T1");
    // Same name: a verdict flip AND a big price move — only the verdict shows.
    const digest = diffModel(base, [rec({ symbol: "AAA", action: "trim", momentum: 40, price: 80 })]);
    expect(digest.changes).toHaveLength(1);
    expect(digest.changes[0].kind).toBe("verdict");
  });

  it("ranks verdict flips above raw momentum/price moves across names", () => {
    const base = snapshotModel(
      [
        rec({ symbol: "AAA", action: "hold", momentum: 50 }),
        rec({ symbol: "BBB", momentum: 50, price: 100 }),
      ],
      "T1",
    );
    const digest = diffModel(base, [
      rec({ symbol: "AAA", action: "trim", momentum: 50 }),
      rec({ symbol: "BBB", momentum: 50, price: 130 }), // a huge +30% move
    ]);
    expect(digest.changes[0].symbol).toBe("AAA");
    expect(digest.changes[0].kind).toBe("verdict");
    expect(digest.changes[1].symbol).toBe("BBB");
  });

  it("skips names that have no prior entry to diff against", () => {
    const base = snapshotModel([rec({ symbol: "AAA", momentum: 50 })], "T1");
    const digest = diffModel(base, [rec({ symbol: "ZZZ", action: "trim", momentum: 90 })]);
    expect(digest.changes).toEqual([]);
  });

  it("caps the digest at maxChanges, keeping the most material", () => {
    const symbols = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const base = snapshotModel(
      symbols.map((s) => rec({ symbol: s, momentum: 50, price: 100 })),
      "T1",
    );
    // Each name moves price by an increasing amount; the biggest movers should win.
    const now = symbols.map((s, i) => rec({ symbol: s, momentum: 50, price: 100 + (i + 1) * 4 }));
    const digest = diffModel(base, now, { maxChanges: 3 });
    expect(digest.changes).toHaveLength(3);
    expect(digest.changes.map((c) => c.symbol)).toEqual(["H", "G", "F"]);
  });

  it("does not flag an editorial-only name with no measured deltas", () => {
    const base: ModelSnapshot = { asOf: "T1", entries: { AAA: { action: "hold", score: 60, owned: false } } };
    const digest = diffModel(base, [rec({ symbol: "AAA" })]); // still editorial, same verdict
    expect(digest.changes).toEqual([]);
  });
});
