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
  /** The single riskiest holding, by the model's risk axes + compliance. */
  topRisk?: { recommendation: Recommendation; riskScore: number };
};

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
    topRisk,
  };
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
