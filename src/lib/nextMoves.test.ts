import { describe, expect, it } from "vitest";
import { buildNextMoves } from "./nextMoves";
import { assessInvestability, DEFAULT_BROKER_SETTINGS, type BrokerSettings } from "./investability";
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

// A measured market snapshot in DKK (FX 1), so one share costs exactly `price` DKK.
const market = (price: number, over: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  symbol: "x",
  price,
  currency: "DKK",
  momentum: 50,
  asOf: "2026-01-01",
  ...over,
});

const rec = (
  over: Partial<Omit<Recommendation, "company">> & {
    symbol: string;
    weight?: number;
    company?: Partial<Company>;
  },
): Recommendation => {
  const { symbol, weight, company: companyOver, ...rest } = over;
  return {
    company: company({ symbol, ...companyOver }),
    holding: weight !== undefined ? ({ portfolioWeight: weight } as Recommendation["holding"]) : undefined,
    action: "investigate",
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
    ...rest,
  };
};

const investabilityFor = (settings: BrokerSettings) => (c: Company) => assessInvestability(c, settings);

describe("buildNextMoves", () => {
  it("lists the next sized, actionable ideas after the standout in score order", () => {
    // All priced in DKK and affordable at the default 5,000 slot.
    const opportunities = [
      rec({ symbol: "AAA", score: 90, company: { market: market(1000) } }),
      rec({ symbol: "BBB", score: 80, company: { market: market(1000) } }),
      rec({ symbol: "CCC", score: 70, company: { market: market(1000) } }),
    ];
    const moves = buildNextMoves(opportunities, investabilityFor(DEFAULT_BROKER_SETTINGS), [], 50000, {
      excludeSymbol: "AAA",
    });
    expect(moves.map((m) => m.rec.company.symbol)).toEqual(["BBB", "CCC"]);
    // Ranks continue past the excluded standout (AAA = 1), so the queue reads 2, 3.
    expect(moves.map((m) => m.rank)).toEqual([2, 3]);
    expect(moves[0].plan.status).toBe("fits");
    expect(moves[0].plan.shares).toBe(5); // 5,000 / 1,000
  });

  it("excludes avoids, off-platform and over-budget names — only what you can act on", () => {
    const settings: BrokerSettings = { perTradeBudgetDkk: 5000, untradableExchanges: ["Korea Exchange"] };
    const opportunities = [
      rec({ symbol: "AVOID", score: 95, action: "avoid", company: { market: market(1000) } }),
      rec({ symbol: "KOREA", score: 92, company: { exchange: "Korea Exchange", market: market(800) } }),
      rec({ symbol: "PRICEY", score: 88, company: { market: market(12000) } }), // 1 share > 5,000
      rec({ symbol: "GOOD", score: 70, company: { market: market(900) } }),
    ];
    const moves = buildNextMoves(opportunities, investabilityFor(settings), [], 40000);
    expect(moves.map((m) => m.rec.company.symbol)).toEqual(["GOOD"]);
    expect(moves[0].rank).toBe(1); // nothing actionable ranked ahead of it
  });

  it("leaves out un-priced names rather than showing them unsized", () => {
    const opportunities = [
      rec({ symbol: "PRICED", score: 80, company: { market: market(1000) } }),
      rec({ symbol: "NOPRICE", score: 90 }), // no market snapshot → unknown, no plan
    ];
    const moves = buildNextMoves(opportunities, investabilityFor(DEFAULT_BROKER_SETTINGS), [], 50000);
    expect(moves.map((m) => m.rec.company.symbol)).toEqual(["PRICED"]);
  });

  it("tags each move with gap vs. tilt from your own theme exposure", () => {
    const portfolio = [rec({ symbol: "OWN", weight: 18, company: { themes: ["ai-platform"] } })];
    const opportunities = [
      rec({ symbol: "TILT", score: 80, company: { themes: ["ai-platform"], market: market(1000) } }),
      rec({ symbol: "GAP", score: 70, company: { themes: ["robotics"], market: market(1000) } }),
    ];
    const moves = buildNextMoves(opportunities, investabilityFor(DEFAULT_BROKER_SETTINGS), portfolio, 50000);
    const tilt = moves.find((m) => m.rec.company.symbol === "TILT")!;
    const gap = moves.find((m) => m.rec.company.symbol === "GAP")!;
    expect(tilt.exposure).toMatchObject({ isGap: false, ownedCount: 1, ownedWeightPct: 18 });
    expect(gap.exposure).toMatchObject({ isGap: true, theme: "robotics" });
  });

  it("starts the queue at 1 when the excluded standout has no live price to size", () => {
    // The hero standout can be an un-priced top idea (investable, but no buy plan).
    // It can't be bought sized, so it isn't counted — the queue honestly reads 1, 2.
    const opportunities = [
      rec({ symbol: "TOP", score: 95 }), // un-priced standout
      rec({ symbol: "BUY1", score: 80, company: { market: market(1000) } }),
      rec({ symbol: "BUY2", score: 70, company: { market: market(1000) } }),
    ];
    const moves = buildNextMoves(opportunities, investabilityFor(DEFAULT_BROKER_SETTINGS), [], 50000, {
      excludeSymbol: "TOP",
    });
    expect(moves.map((m) => m.rec.company.symbol)).toEqual(["BUY1", "BUY2"]);
    expect(moves.map((m) => m.rank)).toEqual([1, 2]);
  });

  it("respects the limit and excludes the standout", () => {
    const opportunities = Array.from({ length: 6 }, (_, i) =>
      rec({ symbol: `S${i}`, score: 90 - i, company: { market: market(1000) } }),
    );
    const moves = buildNextMoves(opportunities, investabilityFor(DEFAULT_BROKER_SETTINGS), [], 50000, {
      excludeSymbol: "S0",
      limit: 2,
    });
    expect(moves.map((m) => m.rec.company.symbol)).toEqual(["S1", "S2"]);
    expect(moves).toHaveLength(2);
  });

  it("returns nothing when no idea is concretely actionable", () => {
    const opportunities = [rec({ symbol: "NOPRICE", score: 90 })];
    expect(buildNextMoves(opportunities, investabilityFor(DEFAULT_BROKER_SETTINGS), [], 50000)).toEqual([]);
    // A zero/negative limit short-circuits to empty.
    const priced = [rec({ symbol: "P", score: 80, company: { market: market(1000) } })];
    expect(buildNextMoves(priced, investabilityFor(DEFAULT_BROKER_SETTINGS), [], 50000, { limit: 0 })).toEqual([]);
  });
});
