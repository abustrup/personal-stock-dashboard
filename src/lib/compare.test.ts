import { describe, expect, it } from "vitest";
import { buildComparison } from "./compare";
import type { Company, Recommendation } from "./types";

function company(overrides: Partial<Company> = {}): Company {
  return {
    name: "Test Co",
    symbol: "TST",
    region: "US",
    exchange: "NASDAQ",
    assetType: "stock",
    themes: ["ai-platform"],
    aiExposure: 50,
    growth: 50,
    momentum: 50,
    quality: 50,
    valuationRisk: 50,
    balanceSheetRisk: 50,
    geopoliticalRisk: 50,
    newsSignal: { sentiment: 50, direction: "neutral", summary: "", freshness: "seed", sources: [] },
    expertSignal: { direction: "neutral", summary: "", freshness: "seed", sources: [] },
    ...overrides,
  };
}

function rec(overrides: Partial<Recommendation> = {}, companyOverrides: Partial<Company> = {}): Recommendation {
  return {
    company: company(companyOverrides),
    action: "hold",
    conviction: "medium",
    measured: false,
    score: 50,
    headline: "",
    reasoning: [],
    downside: "",
    compliance: { status: "unknown", flags: [], source: "test" },
    newsSignal: company(companyOverrides).newsSignal,
    expertSignal: company(companyOverrides).expertSignal,
    freshness: "seed",
    ...overrides,
  };
}

describe("buildComparison", () => {
  it("compares the six driver axes, higher-is-better with risk inverted", () => {
    const a = rec({}, { growth: 80, valuationRisk: 20, balanceSheetRisk: 10 });
    const b = rec({}, { growth: 40, valuationRisk: 70, balanceSheetRisk: 60 });
    const { axes } = buildComparison(a, b);

    const labels = axes.map((x) => x.label);
    expect(labels).toEqual([
      "AI exposure",
      "Growth",
      "Momentum",
      "Quality",
      "Value (vs risk)",
      "Balance sheet",
    ]);

    const value = axes.find((x) => x.label === "Value (vs risk)")!;
    // valuationRisk 20 -> value 80 for A; 70 -> 30 for B. Higher is better => A leads.
    expect(value.a).toBe(80);
    expect(value.b).toBe(30);
    expect(value.leader).toBe("a");
  });

  it("treats a sub-threshold axis gap as a tie", () => {
    const a = rec({}, { quality: 51 });
    const b = rec({}, { quality: 50 });
    const quality = buildComparison(a, b).axes.find((x) => x.label === "Quality")!;
    expect(quality.gap).toBe(1);
    expect(quality.leader).toBe("tie");
  });

  it("marks an axis measured only when BOTH names have the data", () => {
    const market = {
      symbol: "X",
      price: 1,
      currency: "USD",
      momentum: 60,
      asOf: "2026-01-01T00:00:00Z",
    };
    const withMomentum = rec({}, { market: { ...market } });
    const withoutMomentum = rec({});
    const onlyOne = buildComparison(withMomentum, withoutMomentum);
    expect(onlyOne.axes.find((x) => x.label === "Momentum")!.provenance).toBe("editorial");

    const both = buildComparison(withMomentum, rec({}, { market: { ...market, symbol: "Y" } }));
    expect(both.axes.find((x) => x.label === "Momentum")!.provenance).toBe("measured");
    // AI exposure is always editorial regardless of fetched data.
    expect(both.axes.find((x) => x.label === "AI exposure")!.provenance).toBe("editorial");
  });

  it("names the higher-scoring side and the gap in the verdict", () => {
    const a = rec({ score: 71, company: company({ name: "Alpha", growth: 85, momentum: 80 }) });
    const b = rec({ score: 58, company: company({ name: "Beta", growth: 40, momentum: 45 }) });
    const { leader, scoreGap, verdict } = buildComparison(a, b);
    expect(leader).toBe("a");
    expect(scoreGap).toBe(13);
    expect(verdict).toMatch(/leans Alpha \(71 vs 58\)/);
    expect(verdict).toMatch(/ahead on/i);
  });

  it("gives the loser its due — names the axis it still leads", () => {
    const a = rec({ score: 70, company: company({ name: "Alpha", growth: 85, quality: 30 }) });
    const b = rec({ score: 55, company: company({ name: "Beta", growth: 40, quality: 90 }) });
    const { verdict } = buildComparison(a, b);
    expect(verdict).toMatch(/Beta leads on Quality/);
  });

  it("never picks a blocked name, even if it scores higher", () => {
    const blocked = rec({
      score: 0,
      compliance: { status: "blocked", flags: ["§9.3"], source: "policy" },
      company: company({ name: "Vestas" }),
    });
    const clean = rec({ score: 44, company: company({ name: "Nvidia" }) });
    const { verdict } = buildComparison(blocked, clean);
    expect(verdict).toMatch(/Vestas is blocked by EIFO policy/);
    expect(verdict).toMatch(/points to Nvidia/);
  });

  it("calls an equal score a tie and splits the axes honestly", () => {
    const a = rec({ score: 60, company: company({ name: "Alpha", growth: 85 }) });
    const b = rec({ score: 60, company: company({ name: "Beta", quality: 90 }) });
    const { leader, verdict } = buildComparison(a, b);
    expect(leader).toBe("tie");
    expect(verdict).toMatch(/Too close to call/);
    expect(verdict).toMatch(/Alpha leads on Growth/);
    expect(verdict).toMatch(/Beta on Quality/);
  });
});
