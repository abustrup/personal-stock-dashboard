import { describe, expect, it } from "vitest";
import { buildInsights } from "./insights";
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
  });

  it("handles an empty portfolio without throwing", () => {
    const insights = buildInsights([], []);
    expect(insights.needsAttention.count).toBe(0);
    expect(insights.tilt).toBeUndefined();
    expect(insights.topOpportunity).toBeUndefined();
  });
});
