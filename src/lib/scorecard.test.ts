import { describe, expect, it } from "vitest";
import { buildBookScorecard, stanceForAction } from "./scorecard";
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

// An OWNED holding fixture: a portfolio recommendation carries a holding with a weight.
const owned = (
  over: Partial<Omit<Recommendation, "company">> & { symbol: string; weight?: number },
): Recommendation => {
  const { symbol, weight, ...rest } = over;
  return {
    company: company({ symbol }),
    holding: { portfolioWeight: weight ?? 10 } as Recommendation["holding"],
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

describe("stanceForAction", () => {
  it("collapses owned verdicts into add / hold / reduce", () => {
    expect(stanceForAction("increase")).toBe("add");
    expect(stanceForAction("hold")).toBe("hold");
    expect(stanceForAction("trim")).toBe("reduce");
    expect(stanceForAction("avoid")).toBe("reduce");
  });
});

describe("buildBookScorecard", () => {
  it("returns undefined for an empty book", () => {
    expect(buildBookScorecard([])).toBeUndefined();
  });

  it("ignores non-owned recommendations (no holding)", () => {
    const opportunityLike = { ...owned({ symbol: "OPP" }), holding: undefined };
    expect(buildBookScorecard([opportunityLike])).toBeUndefined();
  });

  it("weights the score by position size, not equally", () => {
    // A big 80-score position and a small 40-score one: the weighted score must
    // pull toward the big one, well above the simple average of 60.
    const card = buildBookScorecard([
      owned({ symbol: "BIG", score: 80, weight: 90, action: "increase" }),
      owned({ symbol: "SMALL", score: 40, weight: 10, action: "trim" }),
    ])!;
    expect(card.weightedScore).toBe(76); // 0.9*80 + 0.1*40
    expect(card.count).toBe(2);
  });

  it("reads the book's verdict in the same language as a holding's", () => {
    // 56 is the hold cutoff; a book averaging 60 is in hold range.
    const hold = buildBookScorecard([owned({ symbol: "A", score: 60 })])!;
    expect(hold.verdict).toBe("hold");
    // 72+ is increase range.
    const add = buildBookScorecard([owned({ symbol: "A", score: 90, action: "increase" })])!;
    expect(add.verdict).toBe("increase");
  });

  it("reports the distance to the next verdict tier, and omits it at the top", () => {
    const hold = buildBookScorecard([owned({ symbol: "A", score: 60 })])!;
    expect(hold.toNextTier).toEqual({ action: "increase", points: 12 }); // 72 - 60

    const trim = buildBookScorecard([owned({ symbol: "A", score: 50, action: "trim" })])!;
    expect(trim.toNextTier).toEqual({ action: "hold", points: 6 }); // 56 - 50

    const top = buildBookScorecard([owned({ symbol: "A", score: 85, action: "increase" })])!;
    expect(top.toNextTier).toBeUndefined();
  });

  it("splits the book's capital across add / hold / reduce by weight", () => {
    const card = buildBookScorecard([
      owned({ symbol: "ADD", action: "increase", weight: 50 }),
      owned({ symbol: "HOLD", action: "hold", weight: 30 }),
      owned({ symbol: "TRIM", action: "trim", weight: 15 }),
      owned({ symbol: "AVOID", action: "avoid", weight: 5 }),
    ])!;
    expect(card.addWeightPct).toBeCloseTo(50);
    expect(card.holdWeightPct).toBeCloseTo(30);
    expect(card.reduceWeightPct).toBeCloseTo(20); // trim + avoid
    expect(card.stances.map((s) => s.stance)).toEqual(["add", "hold", "reduce"]);
    const reduce = card.stances.find((s) => s.stance === "reduce")!;
    expect(reduce.holdings).toBe(2);
    // Weighted shares partition the whole book.
    const total = card.stances.reduce((sum, s) => sum + s.weightPct, 0);
    expect(total).toBeCloseTo(100);
  });

  it("falls back to equal weighting when no position has a weight", () => {
    const card = buildBookScorecard([
      owned({ symbol: "A", score: 80, weight: 0, action: "increase" }),
      owned({ symbol: "B", score: 40, weight: 0, action: "trim" }),
    ])!;
    expect(card.weightedScore).toBe(60); // equal weights → simple average
    expect(card.addWeightPct).toBeCloseTo(50);
    expect(card.reduceWeightPct).toBeCloseTo(50);
  });

  it("identifies the book's best and worst holdings by score", () => {
    const card = buildBookScorecard([
      owned({ symbol: "MID", score: 60 }),
      owned({ symbol: "TOP", score: 88, action: "increase" }),
      owned({ symbol: "LOW", score: 35, action: "avoid" }),
    ])!;
    expect(card.best.company.symbol).toBe("TOP");
    expect(card.worst.company.symbol).toBe("LOW");
  });

  it("reports the weighted share of the book backed by measured data", () => {
    const card = buildBookScorecard([
      owned({ symbol: "LIVE", measured: true, weight: 70 }),
      owned({ symbol: "SEED", measured: false, weight: 30 }),
    ])!;
    expect(card.measuredShare).toBeCloseTo(0.7);
  });
});
