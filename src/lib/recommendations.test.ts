import { describe, expect, it } from "vitest";
import { recommendCompany } from "./recommendations";

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
