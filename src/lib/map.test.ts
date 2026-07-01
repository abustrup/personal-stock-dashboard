import { describe, expect, it } from "vitest";
import {
  buildMapPoints,
  quadrantOf,
  riskIndex,
  toMapPoint,
  type MapPoint,
} from "./map";
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

const point = (over: Partial<MapPoint>): MapPoint => ({
  symbol: "X",
  name: "X",
  score: 60,
  risk: 40,
  owned: false,
  weightPct: 0,
  action: "watch",
  compliance: "unknown",
  measured: true,
  quadrant: "strong-steady",
  ...over,
});

describe("riskIndex", () => {
  it("is the unweighted mean of the three risk axes, rounded", () => {
    expect(riskIndex({ valuationRisk: 60, balanceSheetRisk: 30, geopoliticalRisk: 30 })).toBe(40);
    expect(riskIndex({ valuationRisk: 80, balanceSheetRisk: 70, geopoliticalRisk: 90 })).toBe(80);
  });

  it("clamps out-of-range inputs into 0–100", () => {
    expect(riskIndex({ valuationRisk: 200, balanceSheetRisk: 200, geopoliticalRisk: 200 })).toBe(100);
    expect(riskIndex({ valuationRisk: -50, balanceSheetRisk: 0, geopoliticalRisk: 0 })).toBe(0);
  });
});

describe("quadrantOf", () => {
  it("splits the plane at the score/risk midlines", () => {
    expect(quadrantOf(70, 30)).toBe("strong-steady");
    expect(quadrantOf(70, 70)).toBe("strong-risky");
    expect(quadrantOf(30, 30)).toBe("low-priority");
    expect(quadrantOf(30, 70)).toBe("avoid-zone");
  });

  it("treats the midline itself as the stronger/riskier side", () => {
    expect(quadrantOf(50, 50)).toBe("strong-risky");
    expect(quadrantOf(49, 49)).toBe("low-priority");
  });
});

describe("toMapPoint", () => {
  it("marks owned holdings and carries their weight", () => {
    const p = toMapPoint(rec({ symbol: "AAA", score: 75, weight: 18, action: "increase" }));
    expect(p.owned).toBe(true);
    expect(p.weightPct).toBe(18);
    expect(p.score).toBe(75);
    expect(p.risk).toBe(riskIndex(company({ symbol: "AAA" })));
    expect(p.quadrant).toBe("strong-steady");
  });

  it("marks non-owned opportunities with zero weight", () => {
    const p = toMapPoint(rec({ symbol: "OPP", score: 80 }));
    expect(p.owned).toBe(false);
    expect(p.weightPct).toBe(0);
  });
});

describe("buildMapPoints", () => {
  it("includes every holding plus the supplied opportunities", () => {
    const points = buildMapPoints(
      [rec({ symbol: "AAA", weight: 30 }), rec({ symbol: "BBB", weight: 20 })],
      [rec({ symbol: "OPP" })],
    );
    expect(points).toHaveLength(3);
    expect(points.filter((p) => p.owned)).toHaveLength(2);
  });
});
