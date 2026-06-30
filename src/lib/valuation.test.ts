import { describe, expect, it } from "vitest";
import { importFxFactor, valuePortfolio } from "./valuation";
import type { Company, Holding, MarketSnapshot, Recommendation } from "./types";

const market = (over: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  symbol: "X",
  price: 100,
  currency: "USD",
  momentum: 50,
  asOf: "2026-01-01",
  ...over,
});

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

const holding = (over: Partial<Holding> & { symbol: string }): Holding => ({
  instrument: over.symbol,
  rawSymbol: over.symbol,
  providerSymbol: over.symbol,
  isin: "",
  issuer: "",
  assetType: "stock",
  currency: "USD",
  quantity: 10,
  currentPrice: 100,
  marketValueDkk: 6900, // implied factor = 6900 / 100 = 69 (= qty 10 × FX 6.9)
  costBasisDkk: 6000,
  portfolioWeight: 100,
  ...over,
});

// A portfolio recommendation carrying an owned holding and (optionally) a live snapshot.
const rec = (
  over: { symbol: string; holding?: Partial<Holding>; market?: Partial<MarketSnapshot> | null },
): Recommendation => ({
  company: company({
    symbol: over.symbol,
    market: over.market === null ? undefined : market({ symbol: over.symbol, ...over.market }),
  }),
  holding: holding({ symbol: over.symbol, ...over.holding }),
  action: "hold",
  conviction: "medium",
  measured: true,
  score: 60,
  headline: "",
  reasoning: [],
  downside: "",
  compliance: { status: "unknown", flags: [], source: "" },
  newsSignal: company({ symbol: "x" }).newsSignal,
  expertSignal: company({ symbol: "x" }).expertSignal,
  freshness: "",
});

describe("importFxFactor", () => {
  it("recovers quantity × FX from the imported DKK value and native price", () => {
    expect(importFxFactor({ marketValueDkk: 6900, currentPrice: 100 })).toBe(69);
  });

  it("is undefined when there is no usable native price", () => {
    expect(importFxFactor({ marketValueDkk: 6900, currentPrice: 0 })).toBeUndefined();
    expect(importFxFactor({ marketValueDkk: 6900, currentPrice: -5 })).toBeUndefined();
  });
});

describe("valuePortfolio", () => {
  it("re-prices a covered holding at the live price via the import-implied FX", () => {
    // factor 69; live price 110 → 110 × 69 = 7590 DKK (was imported at 6900).
    const v = valuePortfolio([rec({ symbol: "AAA", market: { price: 110, previousClose: 108 } })]);
    expect(v.liveValueDkk).toBe(7590);
    expect(v.importedValueDkk).toBe(6900);
    expect(v.liveGainDkk).toBe(1590); // 7590 − 6000 cost basis
    expect(v.liveDayGainDkk).toBe(138); // (110 − 108) × 69
    expect(v.covered).toBe(1);
    expect(v.total).toBe(1);
    expect(v.anyLive).toBe(true);
    expect(v.allLive).toBe(true);
    expect(v.coveredWeightPct).toBe(100);
  });

  it("derives today's gain from dayChangePct when there is no previous close", () => {
    const v = valuePortfolio([rec({ symbol: "AAA", market: { price: 102, dayChangePct: 2, previousClose: undefined } })]);
    // prevClose = 102 / 1.02 = 100 → dayGain = (102 − 100) × 69 = 138
    expect(v.liveDayGainDkk).toBeCloseTo(138, 6);
  });

  it("falls back to the imported value when a holding has no live snapshot", () => {
    const v = valuePortfolio([rec({ symbol: "AAA", market: null, holding: { totalGainDkk: 900, dayGainDkk: 12 } })]);
    expect(v.liveValueDkk).toBe(6900); // imported, unchanged
    expect(v.liveGainDkk).toBe(900); // imported gain
    expect(v.liveDayGainDkk).toBe(12);
    expect(v.covered).toBe(0);
    expect(v.anyLive).toBe(false);
    expect(v.coveredWeightPct).toBe(0);
  });

  it("falls back when the snapshot currency does not match the holding", () => {
    const v = valuePortfolio([rec({ symbol: "AAA", holding: { currency: "USD" }, market: { price: 110, currency: "DKK" } })]);
    expect(v.liveValueDkk).toBe(6900);
    expect(v.covered).toBe(0);
  });

  it("falls back when the import has no usable native price (no divide-by-zero)", () => {
    const v = valuePortfolio([rec({ symbol: "AAA", holding: { currentPrice: 0 }, market: { price: 110 } })]);
    expect(v.liveValueDkk).toBe(6900);
    expect(v.covered).toBe(0);
  });

  it("reports partial coverage honestly across a mixed book", () => {
    const v = valuePortfolio([
      rec({ symbol: "LIVE", market: { price: 110, previousClose: 110 } }), // 7590
      rec({ symbol: "STALE", market: null }), // 6900 imported
    ]);
    expect(v.covered).toBe(1);
    expect(v.total).toBe(2);
    expect(v.anyLive).toBe(true);
    expect(v.allLive).toBe(false);
    expect(v.liveValueDkk).toBe(7590 + 6900);
    expect(v.coveredWeightPct).toBe(50); // 6900 covered of 13800 imported
  });

  it("returns zeros and no coverage for an empty book", () => {
    const v = valuePortfolio([]);
    expect(v).toMatchObject({ liveValueDkk: 0, total: 0, covered: 0, anyLive: false, allLive: false });
  });

  it("ignores opportunity recommendations that carry no holding", () => {
    const opportunity: Recommendation = { ...rec({ symbol: "OPP", market: { price: 110 } }), holding: undefined };
    const v = valuePortfolio([opportunity]);
    expect(v.total).toBe(0);
    expect(v.liveValueDkk).toBe(0);
  });
});
