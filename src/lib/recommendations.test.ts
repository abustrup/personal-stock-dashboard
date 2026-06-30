import { describe, expect, it } from "vitest";
import { provenanceLabel, recommendCompany, scoreContributions } from "./recommendations";
import type { Company } from "./types";

const baseCompany = {
  name: "NVIDIA Corp.",
  symbol: "NVDA",
  region: "US",
  exchange: "NASDAQ",
  assetType: "stock" as const,
  themes: ["ai-infrastructure", "accelerated-compute"],
  aiExposure: 97,
  growth: 89,
  momentum: 83,
  quality: 82,
  valuationRisk: 75,
  balanceSheetRisk: 18,
  geopoliticalRisk: 42,
  newsSignal: {
    sentiment: 72,
    direction: "positive" as const,
    summary: "AI infrastructure demand remains strong.",
    freshness: "seed" as const,
    sources: ["seed"],
  },
  expertSignal: {
    direction: "positive" as const,
    summary: "Analyst trend proxy is constructive.",
    freshness: "seed" as const,
    sources: ["seed"],
  },
};

describe("recommendCompany", () => {
  it("uses holding labels for owned positions", () => {
    const result = recommendCompany(baseCompany, { owned: true, weight: 13.3 });

    expect(["increase", "hold", "trim", "avoid"]).toContain(result.action);
    expect(result.downside).toMatch(/valuation|demand|margin|competition/i);
    expect(result.newsSignal.summary).toContain("AI infrastructure");
  });

  it("uses discovery labels for non-owned names", () => {
    const result = recommendCompany({ ...baseCompany, symbol: "ASML", name: "ASML Holding" });

    expect(["investigate", "watch", "avoid"]).toContain(result.action);
    expect(result.reasoning.length).toBeGreaterThan(2);
  });

  it("forces avoid when compliance blocks the company", () => {
    const result = recommendCompany({
      ...baseCompany,
      name: "Siemens Energy AG",
      symbol: "ENR.DE",
      themes: ["energy-infrastructure"],
    });

    expect(result.action).toBe("avoid");
    expect(result.compliance.status).toBe("blocked");
  });
});

describe("scoreContributions", () => {
  // The contributions are the single source of truth for the scoring weights:
  // summing them, adding the base and clamping must reproduce the score exactly.
  it("sums (with base + clamp) back to the recommended score", () => {
    const SCORE_BASE = 26;
    const result = recommendCompany(baseCompany);
    const raw = scoreContributions(baseCompany, result.compliance.status).reduce((sum, c) => sum + c.points, 0);
    const reconstructed = Math.round(Math.max(0, Math.min(100, raw + SCORE_BASE)));
    expect(reconstructed).toBe(result.score);
  });

  it("signs each factor by whether it lifts or drags the score", () => {
    const contributions = scoreContributions(baseCompany, "unknown");
    const byLabel = new Map(contributions.map((c) => [c.label, c]));
    // Upside drivers push the score up; risk axes push it down.
    expect(byLabel.get("AI exposure")!.points).toBeGreaterThan(0);
    expect(byLabel.get("Growth")!.points).toBeGreaterThan(0);
    expect(byLabel.get("Valuation risk")!.points).toBeLessThan(0);
    expect(byLabel.get("Balance-sheet risk")!.points).toBeLessThan(0);
    // The §9.x compliance haircut is always a drag (or zero), never a lift.
    expect(byLabel.get("Compliance")!.points).toBeLessThanOrEqual(0);
  });

  it("labels provenance honestly: measured only when the data is real", () => {
    // Editorial-only company (no market snapshot, seed signals).
    const editorial = scoreContributions(baseCompany, "unknown");
    const provenanceOf = (label: string) => editorial.find((c) => c.label === label)!.provenance;
    expect(provenanceOf("AI exposure")).toBe("editorial"); // always editorial
    expect(provenanceOf("Geopolitical risk")).toBe("editorial"); // always editorial
    expect(provenanceOf("Compliance")).toBe("policy"); // policy-driven
    expect(provenanceOf("Momentum")).toBe("editorial"); // no price snapshot yet
    expect(provenanceOf("Growth")).toBe("editorial"); // no fundamentals yet

    // With a measured price snapshot and fundamentals, those axes become measured;
    // AI exposure and geopolitical risk stay editorial — never relabelled.
    const measuredCompany: Company = {
      ...baseCompany,
      market: {
        symbol: "NVDA",
        price: 198,
        currency: "USD",
        momentum: 61,
        asOf: "2026-06-28T00:00:00.000Z",
        fundamentals: {
          growth: 80,
          quality: 78,
          valuationRisk: 70,
          balanceSheetRisk: 20,
        },
      },
    };
    const measured = scoreContributions(measuredCompany, "unknown");
    const mProvenanceOf = (label: string) => measured.find((c) => c.label === label)!.provenance;
    expect(mProvenanceOf("Momentum")).toBe("measured");
    expect(mProvenanceOf("Growth")).toBe("measured");
    expect(mProvenanceOf("Quality")).toBe("measured");
    expect(mProvenanceOf("Valuation risk")).toBe("measured");
    expect(mProvenanceOf("AI exposure")).toBe("editorial");
    expect(mProvenanceOf("Geopolitical risk")).toBe("editorial");
  });
});

describe("provenanceLabel", () => {
  const pricedNoFundamentals: Company = {
    ...baseCompany,
    market: {
      symbol: "NVDA",
      price: 198,
      currency: "USD",
      momentum: 61,
      asOf: "2026-06-28T00:00:00.000Z",
    },
  };
  const pricedWithFundamentals: Company = {
    ...pricedNoFundamentals,
    market: {
      ...pricedNoFundamentals.market!,
      fundamentals: { growth: 80, quality: 78, valuationRisk: 70, balanceSheetRisk: 20 },
    },
  };

  it("calls a name 'data-backed' only once fundamentals are measured", () => {
    expect(provenanceLabel(recommendCompany(pricedWithFundamentals))).toBe("data-backed");
  });

  it("calls a priced-but-no-fundamentals name 'price-backed', NOT 'data-backed'", () => {
    // The header must not claim more provenance than the driver bars show: with a
    // live price but no fundamentals, Growth/Quality/Valuation/Balance-sheet are
    // still editorial, so the score is only partly measured.
    const label = provenanceLabel(recommendCompany(pricedNoFundamentals));
    expect(label).toBe("price-backed");
    expect(label).not.toBe("data-backed");
  });

  it("calls an editorial-only name (no market snapshot) 'editorial only'", () => {
    expect(provenanceLabel(recommendCompany(baseCompany))).toBe("editorial only");
  });
});
