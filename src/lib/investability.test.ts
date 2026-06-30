import { describe, expect, it } from "vitest";
import {
  assessInvestability,
  collectKnownMarkets,
  DEFAULT_BROKER_SETTINGS,
  fxToDkk,
  investableSymbols,
  isInvestable,
  reachBreakdown,
  reachGap,
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

describe("reachBreakdown", () => {
  const recs = [
    rec(company({ name: "Taiwan Semiconductor", symbol: "TSM", exchange: "NYSE", market: market(432.35, "USD") }), "investigate", 80),
    rec(company({ name: "ASML Holding", symbol: "ASML", market: market(1794.62, "USD") }), "watch", 70),
    rec(company({ name: "SK hynix", symbol: "000660.KS", exchange: "Korea Exchange", market: market(2628000, "KRW") }), "watch", 65),
    rec(company({ name: "Samsung Electronics", symbol: "005930.KS", exchange: "Korea Exchange", market: market(323000, "KRW") }), "watch", 62),
    rec(company({ name: "Advanced Micro Devices", symbol: "AMD", exchange: "NASDAQ" }), "investigate", 60),
  ];

  it("names off-platform ideas grouped under their blocking exchange", () => {
    const { offPlatform } = reachBreakdown(recs, settings);
    expect(offPlatform).toHaveLength(1);
    expect(offPlatform[0].exchange).toBe("Korea Exchange");
    // Names are sorted alphabetically within the group for a stable render.
    expect(offPlatform[0].names.map((n) => n.name)).toEqual(["Samsung Electronics", "SK hynix"]);
  });

  it("names over-budget ideas with the one-share DKK cost, costliest first", () => {
    const { aboveBudget } = reachBreakdown(recs, settings);
    expect(aboveBudget.map((n) => n.symbol)).toEqual(["ASML"]);
    expect(aboveBudget[0].sharePriceDkk).toBeGreaterThan(5000);
    expect(aboveBudget[0].fxApprox).toBe(true);
  });

  it("omits investable and un-priced names — only the unreachable are listed", () => {
    const { offPlatform, aboveBudget } = reachBreakdown(recs, settings);
    const listed = [...offPlatform.flatMap((g) => g.names), ...aboveBudget].map((n) => n.symbol);
    expect(listed).not.toContain("TSM"); // affordable on the NYSE
    expect(listed).not.toContain("AMD"); // tradable, no price yet (unknown, not blocked)
  });

  it("reconciles exactly with the counts from summarizeInvestability", () => {
    const summary = summarizeInvestability(recs, settings);
    const { offPlatform, aboveBudget } = reachBreakdown(recs, settings);
    expect(offPlatform.reduce((n, g) => n + g.names.length, 0)).toBe(summary.offPlatform);
    expect(aboveBudget).toHaveLength(summary.aboveBudget);
  });

  it("lists a name blocked on both gates only under the platform gate, never twice", () => {
    // SK hynix is both Korea-listed and >5,000 DKK a share; the platform gate wins.
    const { offPlatform, aboveBudget } = reachBreakdown(recs, settings);
    expect(offPlatform[0].names.some((n) => n.symbol === "000660.KS")).toBe(true);
    expect(aboveBudget.some((n) => n.symbol === "000660.KS")).toBe(false);
  });

  it("empties out when nothing is off-limits", () => {
    const generous: BrokerSettings = { perTradeBudgetDkk: 1_000_000, untradableExchanges: [] };
    const { offPlatform, aboveBudget } = reachBreakdown(recs, generous);
    expect(offPlatform).toHaveLength(0);
    expect(aboveBudget).toHaveLength(0);
  });
});

describe("defaults", () => {
  it("ships a 5,000 DKK budget and the Korea Exchange off-platform", () => {
    expect(DEFAULT_BROKER_SETTINGS.perTradeBudgetDkk).toBe(5000);
    expect(DEFAULT_BROKER_SETTINGS.untradableExchanges).toContain("Korea Exchange");
  });
});

describe("collectKnownMarkets", () => {
  it("dedupes and sorts the union of every source", () => {
    expect(
      collectKnownMarkets(["NYSE", "NASDAQ", "NYSE", "Oslo Børs", "XETRA", "NASDAQ"]),
    ).toEqual(["NASDAQ", "NYSE", "Oslo Børs", "XETRA"]);
  });

  it("drops editorial non-venues and blanks, case-insensitively", () => {
    expect(
      collectKnownMarkets(["NASDAQ", "Private proxy", "unknown", "Not Sure", "", "  ", "NYSE"]),
    ).toEqual(["NASDAQ", "NYSE"]);
  });

  it("trims surrounding whitespace before comparing and emitting", () => {
    expect(collectKnownMarkets(["  XETRA  ", "XETRA"])).toEqual(["XETRA"]);
  });

  it("surfaces a directory-only market the curated universe never lists", () => {
    // The crux of the gap: a long-tail listing the name-picker can add (Oslo Børs)
    // must become a toggleable market even though no universe name lists there, so
    // the broker gate can finally be told the platform can't trade it.
    const universeExchanges = ["NASDAQ", "NYSE", "Korea Exchange"];
    const directoryExchanges = ["Oslo Børs", "Nasdaq Copenhagen"];
    const markets = collectKnownMarkets([...universeExchanges, ...directoryExchanges]);
    expect(markets).toContain("Oslo Børs");
    expect(markets).toContain("Nasdaq Copenhagen");
  });

  it("keeps an off-platform market that no current name lists on, so it stays untoggleable", () => {
    // A stored untradable market with nothing currently listed there must still
    // appear, or the user couldn't switch it back on.
    expect(collectKnownMarkets(["NASDAQ", "Korea Exchange"])).toContain("Korea Exchange");
  });

  it("returns an empty list when handed nothing usable", () => {
    expect(collectKnownMarkets([])).toEqual([]);
    expect(collectKnownMarkets(["Private proxy", ""])).toEqual([]);
  });
});

describe("reachGap", () => {
  const korea = company({ name: "SK hynix", symbol: "000660.KS", exchange: "Korea Exchange" });
  const tsmc = company({ name: "TSMC", symbol: "TSM", exchange: "NASDAQ" });

  it("measures the conviction the broker gate keeps off the table", () => {
    const gap = reachGap([rec(korea, "investigate", 85), rec(tsmc, "investigate", 75)], settings);
    expect(gap).toBeDefined();
    expect(gap!.topOverall).toMatchObject({ symbol: "000660.KS", score: 85 });
    expect(gap!.topOverallStatus).toBe("not_tradable");
    expect(gap!.topInvestable).toMatchObject({ symbol: "TSM", score: 75 });
    expect(gap!.gap).toBe(10);
  });

  it("measures the gap when a single share overshoots the budget", () => {
    // One ASML share ≈ 2,000 USD ≈ 13,800 DKK, well over the 5,000 budget.
    const asml = company({ name: "ASML", symbol: "ASML", exchange: "NASDAQ", market: market(2000, "USD") });
    const amd = company({ name: "AMD", symbol: "AMD", exchange: "NASDAQ", market: market(100, "USD") });
    const gap = reachGap([rec(asml, "investigate", 80), rec(amd, "investigate", 71)], settings);
    expect(gap!.topOverallStatus).toBe("above_budget");
    expect(gap!.topInvestable).toMatchObject({ symbol: "AMD" });
    expect(gap!.gap).toBe(9);
  });

  it("reports nothing when the field's best idea is itself within reach", () => {
    // Best score is a tradable, affordable name — the constraints cost no conviction at the top.
    expect(reachGap([rec(tsmc, "investigate", 85), rec(korea, "investigate", 70)], settings)).toBeUndefined();
  });

  it("surfaces the state where the best idea is out of reach and nothing else clears the gates", () => {
    const samsung = company({ name: "Samsung", symbol: "005930.KS", exchange: "Korea Exchange" });
    const gap = reachGap([rec(korea, "investigate", 85), rec(samsung, "investigate", 75)], settings);
    expect(gap!.topOverall.score).toBe(85);
    expect(gap!.topInvestable).toBeUndefined();
    expect(gap!.gap).toBe(85); // the whole score is unreachable
  });

  it("never treats an avoid (EIFO-blocked) name as an idea, on either side", () => {
    // A blocked name forced to a high score must be ignored as both the top idea and a
    // reachable one — only real, actionable ideas count toward the gap.
    const blocked = company({ name: "Blocked Co", symbol: "BLK", exchange: "NASDAQ" });
    const gap = reachGap(
      [rec(blocked, "avoid", 90), rec(korea, "investigate", 85), rec(tsmc, "investigate", 75)],
      settings,
    );
    expect(gap!.topOverall.symbol).toBe("000660.KS");
    expect(gap!.topInvestable!.symbol).toBe("TSM");
  });

  it("finds the extremes regardless of input order", () => {
    const gap = reachGap([rec(tsmc, "investigate", 75), rec(korea, "investigate", 85)], settings);
    expect(gap!.topOverall.score).toBe(85);
    expect(gap!.topInvestable!.score).toBe(75);
  });

  it("reports nothing when an equally-scored idea is buyable (access blocked, no conviction lost)", () => {
    // Best idea is off-broker, but a tradable name matches its score — no conviction cost.
    expect(reachGap([rec(korea, "investigate", 75), rec(tsmc, "investigate", 75)], settings)).toBeUndefined();
  });

  it("returns undefined when there are no real ideas", () => {
    expect(reachGap([], settings)).toBeUndefined();
    expect(reachGap([rec(company(), "avoid", 0)], settings)).toBeUndefined();
  });
});
