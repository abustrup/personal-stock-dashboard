import { describe, expect, it } from "vitest";
import { buildOpportunityOverview, pickActionableStandout, themeExposure } from "./opportunities";
import type { Company, Recommendation } from "./types";

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
    action: "watch",
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

describe("buildOpportunityOverview", () => {
  it("groups opportunities by their primary theme and ranks them by score", () => {
    const opportunities = [
      rec({ symbol: "AAA", score: 70, company: { themes: ["space"] } }),
      rec({ symbol: "BBB", score: 90, company: { themes: ["space", "defence"] } }),
      rec({ symbol: "CCC", score: 50, company: { themes: ["memory"] } }),
    ];
    const result = buildOpportunityOverview([], opportunities);
    const space = result.groups.find((g) => g.theme === "space")!;
    expect(space.opportunities.map((o) => o.company.symbol)).toEqual(["BBB", "AAA"]);
    expect(space.bestScore).toBe(90);
    expect(result.total).toBe(3);
    expect(result.themeCount).toBe(2);
  });

  it("computes your owned exposure per theme from holding weights", () => {
    const portfolio = [
      rec({ symbol: "OWN1", weight: 14, company: { themes: ["ai-platform", "cloud"] } }),
      rec({ symbol: "OWN2", weight: 10, company: { themes: ["ai-platform"] } }),
    ];
    const opportunities = [rec({ symbol: "OPP", score: 80, company: { themes: ["ai-platform"] } })];
    const result = buildOpportunityOverview(portfolio, opportunities);
    const group = result.groups.find((g) => g.theme === "ai-platform")!;
    expect(group.ownedCount).toBe(2);
    expect(group.ownedWeightPct).toBeCloseTo(24);
    expect(group.isGap).toBe(false);
  });

  it("flags a theme you hold nothing in as a gap (blind spot)", () => {
    const portfolio = [rec({ symbol: "OWN", weight: 20, company: { themes: ["ai-platform"] } })];
    const opportunities = [rec({ symbol: "OPP", score: 80, company: { themes: ["space"] } })];
    const result = buildOpportunityOverview(portfolio, opportunities);
    const space = result.groups.find((g) => g.theme === "space")!;
    expect(space.isGap).toBe(true);
    expect(space.ownedCount).toBe(0);
    expect(space.ownedWeightPct).toBe(0);
  });

  it("orders gap themes before themes you already hold, strongest idea first", () => {
    const portfolio = [rec({ symbol: "OWN", weight: 20, company: { themes: ["owned-theme"] } })];
    const opportunities = [
      rec({ symbol: "OWNED_STRONG", score: 95, company: { themes: ["owned-theme"] } }),
      rec({ symbol: "GAP_WEAK", score: 55, company: { themes: ["gap-weak"] } }),
      rec({ symbol: "GAP_STRONG", score: 88, company: { themes: ["gap-strong"] } }),
    ];
    const result = buildOpportunityOverview(portfolio, opportunities);
    // Both gap themes come before the owned theme, even though the owned theme has
    // the single highest-scoring idea — blind spots are surfaced first.
    expect(result.groups.map((g) => g.theme)).toEqual(["gap-strong", "gap-weak", "owned-theme"]);
    expect(result.gapCount).toBe(2);
  });

  it("picks the standout as the top non-avoid idea and resolves its theme exposure", () => {
    const portfolio = [rec({ symbol: "OWN", weight: 30, company: { themes: ["ai-platform"] } })];
    const opportunities = [
      rec({ symbol: "AVOID_TOP", action: "avoid", score: 99, company: { themes: ["space"] } }),
      rec({ symbol: "BEST", action: "investigate", score: 84, company: { themes: ["ai-platform"] } }),
      rec({ symbol: "OTHER", action: "watch", score: 60, company: { themes: ["memory"] } }),
    ];
    const result = buildOpportunityOverview(portfolio, opportunities);
    // The avoid name is never the standout even though it scores highest.
    expect(result.standout?.company.symbol).toBe("BEST");
    expect(result.standoutExposure?.theme).toBe("ai-platform");
    expect(result.standoutExposure?.ownedCount).toBe(1);
    expect(result.standoutExposure?.isGap).toBe(false);
  });

  it("skips higher-scoring off-limits ideas to lead with one you can act on", () => {
    const opportunities = [
      rec({ symbol: "OFF1", action: "investigate", score: 95, company: { themes: ["memory"] } }),
      rec({ symbol: "OFF2", action: "investigate", score: 90, company: { themes: ["space"] } }),
      rec({ symbol: "BUYABLE", action: "investigate", score: 82, company: { themes: ["ai-platform"] } }),
    ];
    // Only BUYABLE clears the broker/budget gates.
    const result = buildOpportunityOverview([], opportunities, new Set(["BUYABLE"]));
    expect(result.standout?.company.symbol).toBe("BUYABLE");
    // The two higher-scoring names were passed over because they're off-limits.
    expect(result.standoutSkipped).toBe(2);
  });

  it("keeps the top idea as standout when it is itself investable", () => {
    const opportunities = [
      rec({ symbol: "TOP", action: "investigate", score: 95, company: { themes: ["memory"] } }),
      rec({ symbol: "NEXT", action: "investigate", score: 80, company: { themes: ["space"] } }),
    ];
    const result = buildOpportunityOverview([], opportunities, new Set(["TOP", "NEXT"]));
    expect(result.standout?.company.symbol).toBe("TOP");
    expect(result.standoutSkipped).toBe(0);
  });

  it("falls back to the top idea when nothing is investable, without skipping silently", () => {
    const opportunities = [
      rec({ symbol: "OFF1", action: "investigate", score: 95, company: { themes: ["memory"] } }),
      rec({ symbol: "OFF2", action: "investigate", score: 80, company: { themes: ["space"] } }),
    ];
    const result = buildOpportunityOverview([], opportunities, new Set());
    // No investable idea exists, so the hero falls back to the best overall...
    expect(result.standout?.company.symbol).toBe("OFF1");
    // ...and standoutSkipped stays 0 (the fallback isn't "skipping" to a buyable one).
    expect(result.standoutSkipped).toBe(0);
  });

  it("handles an empty opportunity set without inventing groups", () => {
    const result = buildOpportunityOverview([rec({ symbol: "OWN", weight: 50 })], []);
    expect(result.groups).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.gapCount).toBe(0);
    expect(result.standout).toBeUndefined();
    expect(result.standoutExposure).toBeUndefined();
  });
});

describe("pickActionableStandout", () => {
  it("leads with the top non-avoid idea when no investability gate is supplied", () => {
    const opportunities = [
      rec({ symbol: "AVOID", action: "avoid", score: 99 }),
      rec({ symbol: "TOP", action: "investigate", score: 88 }),
      rec({ symbol: "NEXT", action: "watch", score: 70 }),
    ];
    const { standout, standoutSkipped } = pickActionableStandout(opportunities);
    expect(standout?.company.symbol).toBe("TOP");
    expect(standoutSkipped).toBe(0);
  });

  it("skips higher-scoring off-limits names and counts how many were passed", () => {
    const opportunities = [
      rec({ symbol: "OFF1", action: "investigate", score: 95 }),
      rec({ symbol: "OFF2", action: "investigate", score: 90 }),
      rec({ symbol: "BUYABLE", action: "investigate", score: 82 }),
    ];
    const { standout, standoutSkipped } = pickActionableStandout(opportunities, new Set(["BUYABLE"]));
    expect(standout?.company.symbol).toBe("BUYABLE");
    expect(standoutSkipped).toBe(2);
  });

  it("keeps the top idea and reports zero skipped when it is itself investable", () => {
    const opportunities = [
      rec({ symbol: "TOP", action: "investigate", score: 95 }),
      rec({ symbol: "NEXT", action: "investigate", score: 80 }),
    ];
    const { standout, standoutSkipped } = pickActionableStandout(opportunities, new Set(["TOP", "NEXT"]));
    expect(standout?.company.symbol).toBe("TOP");
    expect(standoutSkipped).toBe(0);
  });

  it("falls back to the best idea when none is investable, without a phantom skip count", () => {
    const opportunities = [
      rec({ symbol: "OFF1", action: "investigate", score: 95 }),
      rec({ symbol: "OFF2", action: "investigate", score: 80 }),
    ];
    const { standout, standoutSkipped } = pickActionableStandout(opportunities, new Set());
    expect(standout?.company.symbol).toBe("OFF1");
    expect(standoutSkipped).toBe(0);
  });

  it("returns no standout when every idea is an avoid", () => {
    const opportunities = [rec({ symbol: "A", action: "avoid", score: 90 }), rec({ symbol: "B", action: "avoid", score: 80 })];
    const { standout, standoutSkipped } = pickActionableStandout(opportunities, new Set(["A", "B"]));
    expect(standout).toBeUndefined();
    expect(standoutSkipped).toBe(0);
  });
});

describe("themeExposure", () => {
  it("sums owned holdings and weight for a theme, ignoring non-owned ideas", () => {
    const portfolio = [
      rec({ symbol: "OWN1", weight: 14, company: { themes: ["ai-platform", "cloud"] } }),
      rec({ symbol: "OWN2", weight: 10, company: { themes: ["ai-platform"] } }),
      rec({ symbol: "IDEA", company: { themes: ["ai-platform"] } }), // no weight → not a holding
    ];
    const exposure = themeExposure(portfolio, "ai-platform");
    expect(exposure.ownedCount).toBe(2);
    expect(exposure.ownedWeightPct).toBeCloseTo(24);
    expect(exposure.isGap).toBe(false);
    expect(exposure.theme).toBe("ai-platform");
  });

  it("reports a gap for a theme you hold nothing in", () => {
    const portfolio = [rec({ symbol: "OWN", weight: 20, company: { themes: ["ai-platform"] } })];
    const exposure = themeExposure(portfolio, "space");
    expect(exposure.isGap).toBe(true);
    expect(exposure.ownedCount).toBe(0);
    expect(exposure.ownedWeightPct).toBe(0);
  });
});
