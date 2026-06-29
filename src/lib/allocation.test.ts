import { describe, expect, it } from "vitest";
import { buildBookComposition } from "./allocation";
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

describe("buildBookComposition", () => {
  it("returns an empty composition for an empty portfolio", () => {
    const result = buildBookComposition([]);
    expect(result.slices).toEqual([]);
    expect(result.holdingCount).toBe(0);
    expect(result.themeCount).toBe(0);
    expect(result.totalWeightPct).toBe(0);
    expect(result.topWeightPct).toBe(0);
    expect(result.topTheme).toBeUndefined();
  });

  it("places a single holding in one full slice", () => {
    const result = buildBookComposition([
      rec({ symbol: "NVDA", weight: 100, company: { name: "Nvidia", themes: ["ai-platform"] } }),
    ]);
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0]).toMatchObject({ theme: "ai-platform", weightPct: 100, holdings: 1, topName: "Nvidia" });
    expect(result.topTheme).toBe("ai-platform");
    expect(result.topWeightPct).toBe(100);
  });

  it("counts a multi-theme holding once, under its primary (first) theme", () => {
    const result = buildBookComposition([
      rec({ symbol: "BBB", weight: 40, company: { themes: ["space", "defence"] } }),
    ]);
    expect(result.themeCount).toBe(1);
    expect(result.slices[0].theme).toBe("space");
    // The weight must NOT be double-counted into "defence".
    expect(result.slices.find((s) => s.theme === "defence")).toBeUndefined();
    expect(result.totalWeightPct).toBe(40);
  });

  it("combines holdings that share a primary theme and tracks the dominant name", () => {
    const result = buildBookComposition([
      rec({ symbol: "AMD", weight: 8, company: { name: "AMD", themes: ["ai-platform"] } }),
      rec({ symbol: "NVDA", weight: 22, company: { name: "Nvidia", themes: ["ai-platform"] } }),
    ]);
    const slice = result.slices.find((s) => s.theme === "ai-platform")!;
    expect(slice.holdings).toBe(2);
    expect(slice.weightPct).toBeCloseTo(30);
    expect(slice.topName).toBe("Nvidia"); // larger weight wins
  });

  it("ranks slices by weight desc, breaking ties on theme name", () => {
    const result = buildBookComposition([
      rec({ symbol: "A", weight: 10, company: { themes: ["zeta"] } }),
      rec({ symbol: "B", weight: 30, company: { themes: ["memory"] } }),
      rec({ symbol: "C", weight: 10, company: { themes: ["alpha"] } }),
    ]);
    expect(result.slices.map((s) => s.theme)).toEqual(["memory", "alpha", "zeta"]);
    expect(result.topTheme).toBe("memory");
  });

  it("ignores non-owned recommendations (watch/investigate ideas are not allocation)", () => {
    const result = buildBookComposition([
      rec({ symbol: "OWNED", weight: 60, company: { themes: ["ai-platform"] } }),
      rec({ symbol: "IDEA", company: { themes: ["space"] } }), // no weight => no holding
    ]);
    expect(result.holdingCount).toBe(1);
    expect(result.themeCount).toBe(1);
    expect(result.slices[0].theme).toBe("ai-platform");
  });

  it("falls back to 'uncategorised' for a holding with no themes", () => {
    const result = buildBookComposition([rec({ symbol: "RAW", weight: 50, company: { themes: [] } })]);
    expect(result.slices[0].theme).toBe("uncategorised");
    expect(result.holdingCount).toBe(1);
  });

  it("sums slice weights to the measured total (a partition, never exceeding the book)", () => {
    const result = buildBookComposition([
      rec({ symbol: "A", weight: 25, company: { themes: ["ai-platform", "memory"] } }),
      rec({ symbol: "B", weight: 25, company: { themes: ["memory", "ai-platform"] } }),
      rec({ symbol: "C", weight: 50, company: { themes: ["space"] } }),
    ]);
    const sum = result.slices.reduce((total, s) => total + s.weightPct, 0);
    expect(sum).toBeCloseTo(100);
    expect(result.totalWeightPct).toBeCloseTo(100);
  });
});
