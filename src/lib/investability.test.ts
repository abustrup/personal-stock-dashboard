import { describe, expect, it } from "vitest";
import {
  assessInvestability,
  DEFAULT_BROKER_SETTINGS,
  fxToDkk,
  investableSymbols,
  isInvestable,
  summarizeInvestability,
  type BrokerSettings,
} from "./investability";
import type { Company, MarketSnapshot, Recommendation } from "./types";

const market = (price: number, currency: string): MarketSnapshot => ({
  symbol: "X",
  price,
  currency,
  momentum: 50,
  asOf: "2026-06-28T00:00:00.000Z",
});

const company = (over: Partial<Company> = {}): Company => ({
  name: over.name ?? "Test Co",
  symbol: over.symbol ?? "TST",
  region: over.region ?? "US",
  exchange: over.exchange ?? "NASDAQ",
  assetType: "stock",
  themes: over.themes ?? ["ai-platform"],
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

const rec = (c: Company, action: Recommendation["action"] = "watch", score = 60): Recommendation => ({
  company: c,
  action,
  conviction: "medium",
  measured: false,
  score,
  headline: "",
  reasoning: [],
  downside: "",
  compliance: { status: "unknown", flags: [], source: "test" },
  newsSignal: c.newsSignal,
  expertSignal: c.expertSignal,
  freshness: "seed",
});

const settings: BrokerSettings = { perTradeBudgetDkk: 5000, untradableExchanges: ["Korea Exchange"] };

describe("FX conversion", () => {
  it("knows the currencies the live feed actually returns", () => {
    for (const currency of ["USD", "KRW", "HKD", "EUR", "DKK"]) {
      expect(fxToDkk(currency)).toBeGreaterThan(0);
    }
  });

  it("is case-insensitive and undefined for unknown currencies", () => {
    expect(fxToDkk("usd")).toBe(fxToDkk("USD"));
    expect(fxToDkk("ZZZ")).toBeUndefined();
    expect(fxToDkk(undefined)).toBeUndefined();
  });
});

describe("assessInvestability", () => {
  it("flags a Korea Exchange listing as off-platform regardless of price", () => {
    // Samsung-like: cheap per share, but the market isn't on the broker.
    const inv = assessInvestability(
      company({ symbol: "005930.KS", exchange: "Korea Exchange", market: market(323000, "KRW") }),
      settings,
    );
    expect(inv.status).toBe("not_tradable");
    expect(inv.tradable).toBe(false);
    expect(inv.reason).toMatch(/off saxo/i);
    expect(isInvestable(inv)).toBe(false);
  });

  it("flags an above-budget name where a single share overshoots the budget", () => {
    // ASML-like: ~1,800 USD a share ≈ 12,000+ DKK, well over a 5,000 DKK budget.
    const inv = assessInvestability(company({ symbol: "ASML", market: market(1794.62, "USD") }), settings);
    expect(inv.status).toBe("above_budget");
    expect(inv.tradable).toBe(true);
    expect(inv.affordable).toBe(false);
    expect(inv.sharePriceDkk).toBeGreaterThan(5000);
    expect(inv.fxApprox).toBe(true);
    expect(isInvestable(inv)).toBe(false);
  });

  it("passes a tradable, affordable name", () => {
    // TSM-like: ~430 USD ≈ 3,000 DKK a share, on the NYSE.
    const inv = assessInvestability(company({ symbol: "TSM", exchange: "NYSE", market: market(432.35, "USD") }), settings);
    expect(inv.status).toBe("ok");
    expect(inv.affordable).toBe(true);
    expect(isInvestable(inv)).toBe(true);
    expect(inv.note).toMatch(/fits/i);
  });

  it("treats a tradable name with no price as unknown, not unaffordable", () => {
    const inv = assessInvestability(company({ symbol: "AMD", exchange: "NASDAQ" }), settings);
    expect(inv.status).toBe("unknown");
    expect(inv.affordable).toBeUndefined();
    // Absence of a price must not hide the idea.
    expect(isInvestable(inv)).toBe(true);
  });

  it("puts the platform gate ahead of the budget gate when both fail", () => {
    // SK hynix-like: Korean market AND >2.6m KRW (~13,000 DKK) a share.
    const inv = assessInvestability(
      company({ symbol: "000660.KS", exchange: "Korea Exchange", market: market(2628000, "KRW") }),
      settings,
    );
    expect(inv.status).toBe("not_tradable");
    // Affordability is still computed for context, even though tradability decides.
    expect(inv.affordable).toBe(false);
  });

  it("respects a user-raised budget — what was over budget becomes affordable", () => {
    const generous: BrokerSettings = { perTradeBudgetDkk: 20000, untradableExchanges: [] };
    const inv = assessInvestability(company({ symbol: "ASML", market: market(1794.62, "USD") }), generous);
    expect(inv.status).toBe("ok");
    expect(inv.affordable).toBe(true);
  });

  it("does not mark a DKK-native price as an approximate conversion", () => {
    const inv = assessInvestability(company({ market: market(450, "DKK") }), settings);
    expect(inv.fxApprox).toBe(false);
    expect(inv.status).toBe("ok");
  });

  it("can't size a price in an unknown currency — unknown, and no false 'approx' flag", () => {
    const inv = assessInvestability(company({ market: market(100, "ZZZ") }), settings);
    expect(inv.status).toBe("unknown");
    expect(inv.sharePriceDkk).toBeUndefined();
    // No conversion happened, so it must not claim an approximate one.
    expect(inv.fxApprox).toBe(false);
  });
});

describe("summarizeInvestability", () => {
  const recs = [
    rec(company({ symbol: "TSM", exchange: "NYSE", market: market(432.35, "USD") }), "investigate", 80),
    rec(company({ symbol: "ASML", market: market(1794.62, "USD") }), "watch", 70),
    rec(company({ symbol: "000660.KS", exchange: "Korea Exchange", market: market(2628000, "KRW") }), "watch", 65),
    rec(company({ symbol: "AMD", exchange: "NASDAQ" }), "investigate", 60),
  ];

  it("counts off-platform, above-budget and investable ideas", () => {
    const summary = summarizeInvestability(recs, settings);
    expect(summary.total).toBe(4);
    expect(summary.offPlatform).toBe(1); // SK hynix
    expect(summary.aboveBudget).toBe(1); // ASML
    expect(summary.investable).toBe(2); // TSM + AMD
  });

  it("names the best investable idea from a pre-ranked list", () => {
    const summary = summarizeInvestability(recs, settings);
    expect(summary.topInvestable?.company.symbol).toBe("TSM");
  });

  it("derives the investable symbol set used to pick a buyable standout", () => {
    const set = investableSymbols(recs, settings);
    expect(set.has("TSM")).toBe(true);
    expect(set.has("AMD")).toBe(true);
    expect(set.has("ASML")).toBe(false);
    expect(set.has("000660.KS")).toBe(false);
  });
});

describe("defaults", () => {
  it("ships a 5,000 DKK budget and the Korea Exchange off-platform", () => {
    expect(DEFAULT_BROKER_SETTINGS.perTradeBudgetDkk).toBe(5000);
    expect(DEFAULT_BROKER_SETTINGS.untradableExchanges).toContain("Korea Exchange");
  });
});
