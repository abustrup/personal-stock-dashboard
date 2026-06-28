import { describe, expect, it } from "vitest";
import { buildHoldingContexts, buildInsights } from "./insights";
import type { Company, Recommendation } from "./types";

const company = (over: Partial<Company> & { symbol: string }): Company => ({
  name: over.symbol,
  region: "US",
  exchange: "NASDAQ",
  assetType: "stock",
  themes: ["ai-infrastructure"],
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

const rec = (
  over: Partial<Omit<Recommendation, "company">> & { symbol: string; weight?: number; company?: Partial<Company> },
): Recommendation => {
  const { symbol, weight, company: companyOver, ...rest } = over;
  return {
    company: company({ symbol, ...companyOver }),
    holding: weight !== undefined ? ({ portfolioWeight: weight } as Recommendation["holding"]) : undefined,
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
    ...rest,
  };
};

describe("buildInsights", () => {
  it("surfaces holdings to act on, compliance flags, an opportunity, and the tilt", () => {
    const portfolio = [
      rec({ symbol: "AAA", action: "increase", weight: 40, company: { themes: ["ai-infrastructure"] } }),
      rec({ symbol: "BBB", action: "trim", score: 45, weight: 35, company: { themes: ["ai-infrastructure"] } }),
      rec({
        symbol: "CCC",
        action: "avoid",
        score: 20,
        weight: 25,
        compliance: { status: "blocked", flags: ["x"], source: "" },
        company: { themes: ["energy"] },
      }),
    ];
    const opportunities = [
      rec({ symbol: "OPP", action: "investigate", score: 80 }),
      rec({ symbol: "BAD", action: "avoid", score: 10 }),
    ];

    const insights = buildInsights(portfolio, opportunities);

    expect(insights.needsAttention.count).toBe(2);
    expect(insights.needsAttention.top?.action).toBe("avoid"); // avoid ranks ahead of trim
    expect(insights.compliance.count).toBe(1);
    expect(insights.compliance.top?.company.symbol).toBe("CCC");
    expect(insights.topOpportunity?.company.symbol).toBe("OPP");
    expect(insights.tilt?.theme).toBe("ai-infrastructure"); // 75% of weight
    expect(insights.topRisk?.recommendation.company.symbol).toBe("CCC"); // blocked → highest
    // AAA is 40% of the book → single-name concentration crosses the threshold.
    expect(insights.concentration?.top.company.symbol).toBe("AAA");
    expect(insights.concentration?.weightPct).toBe(40);
    expect(insights.concentration?.concentrated).toBe(true);
  });

  it("flags concentration on the top three even when no single name is large", () => {
    const portfolio = [
      rec({ symbol: "AAA", weight: 24 }),
      rec({ symbol: "BBB", weight: 22 }),
      rec({ symbol: "CCC", weight: 18 }),
      rec({ symbol: "DDD", weight: 18 }),
      rec({ symbol: "EEE", weight: 18 }),
    ];

    const insights = buildInsights(portfolio, []);

    expect(insights.concentration?.top.company.symbol).toBe("AAA"); // largest position
    expect(insights.concentration?.weightPct).toBe(24); // below the single-name threshold
    expect(insights.concentration?.topThreeWeightPct).toBe(64); // 24 + 22 + 18
    expect(insights.concentration?.concentrated).toBe(true); // top three ≥ 60%
  });

  it("reports a diversified book as not concentrated", () => {
    const portfolio = [
      rec({ symbol: "AAA", weight: 18 }),
      rec({ symbol: "BBB", weight: 17 }),
      rec({ symbol: "CCC", weight: 17 }),
      rec({ symbol: "DDD", weight: 16 }),
      rec({ symbol: "EEE", weight: 16 }),
      rec({ symbol: "FFF", weight: 16 }),
    ];

    const insights = buildInsights(portfolio, []);

    expect(insights.concentration?.topThreeWeightPct).toBe(52); // 18 + 17 + 17
    expect(insights.concentration?.concentrated).toBe(false);
  });

  it("handles an empty portfolio without throwing", () => {
    const insights = buildInsights([], []);
    expect(insights.needsAttention.count).toBe(0);
    expect(insights.tilt).toBeUndefined();
    expect(insights.topOpportunity).toBeUndefined();
    expect(insights.concentration).toBeUndefined();
    expect(insights.holdingContexts.size).toBe(0);
  });
});

describe("buildHoldingContexts", () => {
  it("ranks each owned holding by size and by risk within the book", () => {
    const portfolio = [
      // Biggest position, but the lowest-risk axes → not the riskiest.
      rec({ symbol: "BIG", weight: 40, company: { valuationRisk: 30, balanceSheetRisk: 10, geopoliticalRisk: 20 } }),
      // Mid-size, mid-risk.
      rec({ symbol: "MID", weight: 35, company: { valuationRisk: 55, balanceSheetRisk: 20, geopoliticalRisk: 40 } }),
      // Smallest position, but the riskiest book member.
      rec({ symbol: "SMALL", weight: 25, company: { valuationRisk: 82, balanceSheetRisk: 28, geopoliticalRisk: 60 } }),
    ];

    const contexts = buildHoldingContexts(portfolio);

    expect(contexts.size).toBe(3);
    expect(contexts.get("BIG")).toMatchObject({ count: 3, sizeRank: 1, riskRank: 3, weightPct: 40 });
    expect(contexts.get("MID")).toMatchObject({ sizeRank: 2, riskRank: 2 });
    // Smallest by weight yet riskiest by axes — the cross-portfolio tension a broker never surfaces.
    expect(contexts.get("SMALL")).toMatchObject({ sizeRank: 3, riskRank: 1 });
    expect(contexts.get("SMALL")?.riskFactor).toBe("valuation risk");
  });

  it("names the dominant risk axis and lets compliance dominate", () => {
    const portfolio = [
      rec({ symbol: "GEO", weight: 50, company: { valuationRisk: 30, balanceSheetRisk: 20, geopoliticalRisk: 70 } }),
      rec({
        symbol: "BLOCKED",
        weight: 50,
        company: { valuationRisk: 30, balanceSheetRisk: 20, geopoliticalRisk: 20 },
        compliance: { status: "blocked", flags: ["x"], source: "" },
      }),
    ];

    const contexts = buildHoldingContexts(portfolio);

    expect(contexts.get("GEO")?.riskFactor).toBe("geopolitical risk");
    // Compliance block dominates the risk-axis comparison.
    expect(contexts.get("BLOCKED")?.riskFactor).toBe("EIFO compliance");
    expect(contexts.get("BLOCKED")?.riskRank).toBe(1);
  });

  it("excludes non-owned recommendations and handles a single holding", () => {
    const portfolio = [
      rec({ symbol: "OWNED", weight: 100 }),
      rec({ symbol: "WATCH" }), // no holding → not part of the book
    ];

    const contexts = buildHoldingContexts(portfolio);

    expect(contexts.size).toBe(1);
    expect(contexts.get("OWNED")).toMatchObject({ count: 1, sizeRank: 1, riskRank: 1 });
    expect(contexts.has("WATCH")).toBe(false);
  });
});
