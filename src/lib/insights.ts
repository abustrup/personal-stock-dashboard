import type { Recommendation } from "./types";

export type PortfolioInsights = {
  /** Owned holdings the model flags to trim or avoid — what to act on. */
  needsAttention: { count: number; top?: Recommendation };
  /** Owned holdings with any EIFO compliance flag (blocked/restricted/overlap). */
  compliance: { count: number; top?: Recommendation };
  /** Best name you do NOT own — a broker dashboard only shows what you hold. */
  topOpportunity?: Recommendation;
  /** Where the portfolio is concentrated by theme (weight-weighted). */
  tilt?: { theme: string; weightPct: number; holdings: number };
  /**
   * Single-position concentration — a synthesis a broker shows the inputs for
   * (per-line weights) but never editorialises into a portfolio-level risk.
   */
  concentration?: {
    /** The single largest holding by portfolio weight. */
    top: Recommendation;
    /** Its share of the portfolio, as a percent number (e.g. 24.3). */
    weightPct: number;
    /** Combined share of the three largest holdings, as a percent number. */
    topThreeWeightPct: number;
    /** True when concentration crosses a commonly-cited risk threshold. */
    concentrated: boolean;
  };
  /** The single riskiest holding, by the model's risk axes + compliance. */
  topRisk?: { recommendation: Recommendation; riskScore: number };
  /**
   * Per-holding standing *within your own book* — size rank, risk rank and the
   * dominant risk axis. A broker shows the inputs (per-line weight) but never
   * ranks one position against another or synthesises which is riskiest.
   */
  holdingContexts: Map<string, HoldingContext>;
};

/**
 * The risk axes a holding's risk standing can be attributed to. Kept as a
 * single shared source of truth so the producer (`dominantRiskFactor`) and any
 * consumer (e.g. the detail view's provenance label) cannot drift apart.
 */
export const RISK_FACTORS = {
  compliance: "EIFO compliance",
  valuation: "valuation risk",
  balanceSheet: "balance-sheet risk",
  geopolitical: "geopolitical risk",
} as const;

export type RiskFactor = (typeof RISK_FACTORS)[keyof typeof RISK_FACTORS];

/** Where a single holding sits relative to the rest of the portfolio. */
export type HoldingContext = {
  symbol: string;
  /** Number of owned holdings in the book. */
  count: number;
  /** 1 = largest position by portfolio weight. */
  sizeRank: number;
  /** This holding's share of the portfolio, as a percent number. */
  weightPct: number;
  /** 1 = riskiest by the model's risk axes + compliance. */
  riskRank: number;
  /** The single largest risk axis driving this holding's risk standing. */
  riskFactor: RiskFactor;
};

// Commonly-cited single-name and top-holdings concentration thresholds. A book
// is flagged when either the largest position dominates or the three largest
// together make up most of it — both are risks a broker dashboard won't synthesise.
const SINGLE_NAME_CONCENTRATION_PCT = 25;
const TOP_THREE_CONCENTRATION_PCT = 60;

function riskScore(rec: Recommendation): number {
  const c = rec.company;
  const complianceWeight = rec.compliance.status === "blocked" ? 120 : rec.compliance.status === "restricted" ? 40 : 0;
  return c.valuationRisk + c.balanceSheetRisk + c.geopoliticalRisk + complianceWeight;
}

const ACTION_RANK: Record<string, number> = { avoid: 0, trim: 1, watch: 2, hold: 3, investigate: 4, increase: 5 };

export function buildInsights(portfolio: Recommendation[], opportunities: Recommendation[]): PortfolioInsights {
  const attention = portfolio
    .filter((r) => r.action === "trim" || r.action === "avoid")
    .sort((a, b) => (ACTION_RANK[a.action] ?? 9) - (ACTION_RANK[b.action] ?? 9) || a.score - b.score);

  const flagged = portfolio
    .filter((r) => r.compliance.status !== "unknown")
    .sort((a, b) => riskScore(b) - riskScore(a));

  const opportunity = opportunities.find((r) => r.action !== "avoid");

  const topRisk = portfolio
    .map((recommendation) => ({ recommendation, riskScore: riskScore(recommendation) }))
    .sort((a, b) => b.riskScore - a.riskScore)[0];

  return {
    needsAttention: { count: attention.length, top: attention[0] },
    compliance: { count: flagged.length, top: flagged[0] },
    topOpportunity: opportunity,
    tilt: dominantTilt(portfolio),
    concentration: positionConcentration(portfolio),
    topRisk,
    holdingContexts: buildHoldingContexts(portfolio),
  };
}

// The dominant risk axis behind a holding's risk standing. Compliance dominates
// when present (a block/restriction outweighs any axis); otherwise it is the
// single largest of the valuation, balance-sheet and geopolitical axes.
function dominantRiskFactor(rec: Recommendation): RiskFactor {
  if (rec.compliance.status === "blocked" || rec.compliance.status === "restricted") {
    return RISK_FACTORS.compliance;
  }
  const axes: Array<[number, RiskFactor]> = [
    [rec.company.valuationRisk, RISK_FACTORS.valuation],
    [rec.company.balanceSheetRisk, RISK_FACTORS.balanceSheet],
    [rec.company.geopoliticalRisk, RISK_FACTORS.geopolitical],
  ];
  return axes.sort((a, b) => b[0] - a[0])[0][1];
}

/**
 * Rank every owned holding against the rest of the book by size and by risk.
 * Non-owned recommendations (watch/investigate ideas) are excluded — this is
 * about the portfolio you actually hold. Keyed by company symbol.
 */
export function buildHoldingContexts(portfolio: Recommendation[]): Map<string, HoldingContext> {
  const owned = portfolio.filter((rec) => rec.holding);
  const bySize = [...owned].sort((a, b) => (b.holding?.portfolioWeight ?? 0) - (a.holding?.portfolioWeight ?? 0));
  const byRisk = [...owned].sort((a, b) => riskScore(b) - riskScore(a));
  const sizeRank = new Map(bySize.map((rec, index) => [rec.company.symbol, index + 1]));
  const riskRank = new Map(byRisk.map((rec, index) => [rec.company.symbol, index + 1]));

  const contexts = new Map<string, HoldingContext>();
  for (const rec of owned) {
    contexts.set(rec.company.symbol, {
      symbol: rec.company.symbol,
      count: owned.length,
      sizeRank: sizeRank.get(rec.company.symbol) ?? owned.length,
      weightPct: rec.holding?.portfolioWeight ?? 0,
      riskRank: riskRank.get(rec.company.symbol) ?? owned.length,
      riskFactor: dominantRiskFactor(rec),
    });
  }
  return contexts;
}

function positionConcentration(portfolio: Recommendation[]): PortfolioInsights["concentration"] {
  const weighted = portfolio
    .map((recommendation) => ({ recommendation, weight: recommendation.holding?.portfolioWeight ?? 0 }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  if (weighted.length === 0) return undefined;

  const weightPct = weighted[0].weight;
  const topThreeWeightPct = weighted.slice(0, 3).reduce((sum, entry) => sum + entry.weight, 0);
  const concentrated =
    weightPct >= SINGLE_NAME_CONCENTRATION_PCT || topThreeWeightPct >= TOP_THREE_CONCENTRATION_PCT;

  return { top: weighted[0].recommendation, weightPct, topThreeWeightPct, concentrated };
}

function dominantTilt(portfolio: Recommendation[]): PortfolioInsights["tilt"] {
  const byTheme = new Map<string, { weight: number; holdings: number }>();
  let totalWeight = 0;
  for (const rec of portfolio) {
    const weight = rec.holding?.portfolioWeight ?? 0;
    totalWeight += weight;
    for (const theme of rec.company.themes) {
      const entry = byTheme.get(theme) ?? { weight: 0, holdings: 0 };
      entry.weight += weight;
      entry.holdings += 1;
      byTheme.set(theme, entry);
    }
  }
  if (byTheme.size === 0 || totalWeight === 0) return undefined;
  const [theme, entry] = [...byTheme.entries()].sort((a, b) => b[1].weight - a[1].weight)[0];
  return { theme, weightPct: (entry.weight / totalWeight) * 100, holdings: entry.holdings };
}
