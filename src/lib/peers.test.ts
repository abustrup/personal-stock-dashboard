import { describe, expect, it } from "vitest";
import { buildPeerComparison } from "./peers";
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
  over: Partial<Omit<Recommendation, "company">> & { symbol: string; owned?: boolean; company?: Partial<Company> },
): Recommendation => {
  const { symbol, owned, company: companyOver, ...rest } = over;
  return {
    company: company({ symbol, ...companyOver }),
    holding: owned ? ({ portfolioWeight: 10 } as Recommendation["holding"]) : undefined,
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

describe("buildPeerComparison", () => {
  it("ranks theme peers by score, descending, including the selected company", () => {
    const all = [
      rec({ symbol: "AAA", score: 80 }),
      rec({ symbol: "BBB", score: 66, owned: true }),
      rec({ symbol: "CCC", score: 50 }),
    ];
    const result = buildPeerComparison(all, "BBB");
    expect(result).toBeDefined();
    expect(result!.theme).toBe("ai-platform");
    expect(result!.peers.map((p) => p.symbol)).toEqual(["AAA", "BBB", "CCC"]);
    expect(result!.count).toBe(3);
    expect(result!.rank).toBe(2);
    expect(result!.peers.find((p) => p.symbol === "BBB")!.selected).toBe(true);
    expect(result!.peers.find((p) => p.symbol === "BBB")!.owned).toBe(true);
  });

  it("surfaces only the higher-scoring names you do not own", () => {
    const all = [
      rec({ symbol: "OWN_TOP", score: 90, owned: true }), // higher but owned → not an idea
      rec({ symbol: "OPP_TOP", score: 85 }), // higher and unowned → an idea
      rec({ symbol: "ME", score: 60, owned: true }),
      rec({ symbol: "OPP_LOW", score: 40 }), // lower → not surfaced
    ];
    const result = buildPeerComparison(all, "ME");
    expect(result!.rank).toBe(3);
    expect(result!.higherUnowned.map((p) => p.symbol)).toEqual(["OPP_TOP"]);
  });

  it("does not call an equal-score peer 'higher' (strict score comparison)", () => {
    // AAA and ME share the top score; AAA only sorts above ME via the name tiebreak.
    const all = [
      rec({ symbol: "AAA", score: 60 }),
      rec({ symbol: "ME", score: 60, owned: true }),
      rec({ symbol: "LOW", score: 40 }),
    ];
    const result = buildPeerComparison(all, "ME");
    // ME is ranked 2nd on the ladder, but no peer STRICTLY outscores it.
    expect(result!.rank).toBe(2);
    expect(result!.higherUnowned).toEqual([]);
  });

  it("picks the most-populated shared theme as the comparison axis", () => {
    // BIG theme has 3 members; SMALL theme has only the selected company.
    const all = [
      rec({ symbol: "SEL", score: 70, company: { themes: ["small", "big"] } }),
      rec({ symbol: "P1", score: 60, company: { themes: ["big"] } }),
      rec({ symbol: "P2", score: 50, company: { themes: ["big"] } }),
    ];
    const result = buildPeerComparison(all, "SEL");
    expect(result!.theme).toBe("big");
    expect(result!.count).toBe(3);
  });

  it("breaks score ties by name so the order is stable", () => {
    const all = [
      rec({ symbol: "ZZZ", score: 60 }),
      rec({ symbol: "AAA", score: 60 }),
      rec({ symbol: "MID", score: 60, owned: true }),
    ];
    const result = buildPeerComparison(all, "MID");
    expect(result!.peers.map((p) => p.symbol)).toEqual(["AAA", "MID", "ZZZ"]);
  });

  it("returns undefined when the company has no peer in any of its themes", () => {
    const all = [
      rec({ symbol: "ALONE", score: 70, company: { themes: ["unique"] } }),
      rec({ symbol: "OTHER", score: 60, company: { themes: ["different"] } }),
    ];
    expect(buildPeerComparison(all, "ALONE")).toBeUndefined();
  });

  it("returns undefined for an unknown symbol or a themeless company", () => {
    const all = [rec({ symbol: "AAA", score: 70 }), rec({ symbol: "BBB", score: 60 })];
    expect(buildPeerComparison(all, "MISSING")).toBeUndefined();
    expect(buildPeerComparison([rec({ symbol: "NT", company: { themes: [] } })], "NT")).toBeUndefined();
  });
});
