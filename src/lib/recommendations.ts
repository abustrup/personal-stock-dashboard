import { evaluateCompliance, type ComplianceOverrides } from "./compliance";
import { dataFreshness } from "./signals";
import type {
  Company,
  ComplianceStatus,
  Holding,
  Recommendation,
  RecommendationAction,
  SignalDirection,
} from "./types";

export type HoldingContext = {
  owned?: boolean;
  weight?: number;
};

export function recommendCompany(
  company: Company,
  holdingContext?: HoldingContext | Holding,
  overrides?: ComplianceOverrides,
): Recommendation {
  const compliance = evaluateCompliance(company, overrides);
  const owned = Boolean(holdingContext && ("owned" in holdingContext ? holdingContext.owned : true));
  const holding = holdingContext && "rawSymbol" in holdingContext ? holdingContext : undefined;
  const score = compliance.status === "blocked" ? 0 : Math.round(calculateScore(company, compliance.status));
  const action = compliance.status === "blocked" ? "avoid" : actionForScore(score, owned);
  const momentumMeasured = Boolean(company.market);
  const measured =
    momentumMeasured ||
    company.newsSignal.freshness === "live" ||
    company.expertSignal.freshness === "live";

  return {
    company,
    holding,
    action,
    conviction: convictionFor(score, measured, Boolean(company.market?.fundamentals)),
    measured,
    score,
    headline: buildHeadline(company, compliance.status),
    reasoning: buildReasoning(company, score, compliance.status, momentumMeasured, Boolean(company.market?.fundamentals)),
    downside: downsideFor(company),
    compliance,
    newsSignal: company.newsSignal,
    expertSignal: company.expertSignal,
    freshness: dataFreshness(company.newsSignal, company.expertSignal),
  };
}

export function rankRecommendations(recommendations: Recommendation[]): Recommendation[] {
  return [...recommendations].sort((a, b) => {
    if (a.action === "avoid" && b.action !== "avoid") return 1;
    if (a.action !== "avoid" && b.action === "avoid") return -1;
    return b.score - a.score;
  });
}

const compliancePenaltyByStatus: Record<ComplianceStatus, number> = {
  blocked: 0, // never reaches scoring; forced to avoid upstream
  possible_overlap: 9,
  restricted: 6,
  unknown: 4,
};

/** The constant base every score starts from before factor contributions. */
const SCORE_BASE = 26;

/** How each factor's weighted pull on the score was sourced. */
export type ContributionProvenance = "measured" | "editorial" | "policy";

/** One factor's signed, weighted contribution to the 0-100 score. */
export type ScoreContribution = {
  label: string;
  /** Signed weighted points pushed onto the score (before the base + clamp). */
  points: number;
  provenance: ContributionProvenance;
};

/**
 * The per-factor weighted contributions behind a company's score. This is the
 * single source of truth for the scoring weights: `calculateScore` sums these
 * (plus the base, then clamps), and the UI explains the score from the same
 * numbers — so the explanation can never drift from the math. Provenance follows
 * the same measured/editorial discipline as the rest of the dashboard: momentum
 * is measured once a price snapshot exists; growth/quality/valuation/balance-sheet
 * are measured only when fundamentals were fetched; AI exposure and geopolitical
 * risk are always editorial; compliance is policy-driven; a news/expert signal is
 * measured only when its own feed is live.
 */
export function scoreContributions(
  company: Company,
  complianceStatus: ComplianceStatus,
): ScoreContribution[] {
  const fundamentals: ContributionProvenance = company.market?.fundamentals ? "measured" : "editorial";
  const momentum: ContributionProvenance = company.market ? "measured" : "editorial";
  const news: ContributionProvenance = company.newsSignal.freshness === "live" ? "measured" : "editorial";
  const expert: ContributionProvenance = company.expertSignal.freshness === "live" ? "measured" : "editorial";

  return [
    { label: "AI exposure", points: company.aiExposure * 0.2, provenance: "editorial" },
    { label: "Growth", points: company.growth * 0.16, provenance: fundamentals },
    { label: "Momentum", points: company.momentum * 0.14, provenance: momentum },
    { label: "Quality", points: company.quality * 0.12, provenance: fundamentals },
    { label: "News signal", points: company.newsSignal.sentiment * 0.1, provenance: news },
    { label: "Expert view", points: directionScore(company.expertSignal.direction) * 0.08, provenance: expert },
    { label: "Valuation risk", points: -company.valuationRisk * 0.1, provenance: fundamentals },
    { label: "Balance-sheet risk", points: -company.balanceSheetRisk * 0.05, provenance: fundamentals },
    { label: "Geopolitical risk", points: -company.geopoliticalRisk * 0.05, provenance: "editorial" },
    { label: "Compliance", points: -compliancePenaltyByStatus[complianceStatus], provenance: "policy" },
  ];
}

function calculateScore(company: Company, complianceStatus: ComplianceStatus): number {
  const total = scoreContributions(company, complianceStatus).reduce((sum, c) => sum + c.points, 0);
  return clamp(total + SCORE_BASE);
}

function actionForScore(score: number, owned: boolean): RecommendationAction {
  if (owned) {
    if (score >= 72) return "increase";
    if (score >= 56) return "hold";
    if (score >= 42) return "trim";
    return "avoid";
  }

  if (score >= 66) return "investigate";
  if (score >= 46) return "watch";
  return "avoid";
}

// Conviction reflects how much *real* evidence backs the score. "high" requires
// measured fundamentals (the strongest evidence); a momentum-only snapshot caps
// at "medium"; editorial-only names cap at "medium" and only when strong.
function convictionFor(
  score: number,
  measured: boolean,
  fundamentalsMeasured: boolean,
): "high" | "medium" | "low" {
  if (measured) {
    if (fundamentalsMeasured && score >= 70) return "high";
    if (score >= 50) return "medium";
    return "low";
  }
  return score >= 62 ? "medium" : "low";
}

// A short, decision-useful "why" — the kind of synthesis a broker dashboard
// does not give you. Compliance overrides; otherwise the two strongest drivers.
function buildHeadline(company: Company, complianceStatus: ComplianceStatus): string {
  if (complianceStatus === "blocked") return "Blocked by EIFO policy — do not trade.";
  if (complianceStatus === "restricted") return "Tradeable, but EIFO 6-month hold and no derivatives apply.";

  const drivers: string[] = [];
  if (complianceStatus === "possible_overlap") drivers.push("possible EIFO overlap");
  if (company.momentum >= 70) drivers.push("strong momentum");
  else if (company.momentum <= 35) drivers.push("weak momentum");
  if (company.growth >= 75) drivers.push("high growth");
  if (company.quality >= 80) drivers.push("durable quality");
  else if (company.quality <= 30) drivers.push("thin profitability");
  if (company.valuationRisk >= 75) drivers.push("stretched valuation");
  else if (company.valuationRisk <= 30) drivers.push("undemanding valuation");
  if (company.balanceSheetRisk >= 70) drivers.push("leveraged balance sheet");
  if (company.geopoliticalRisk >= 70) drivers.push("elevated geopolitical risk");

  if (drivers.length === 0) return "Balanced risk and reward; no single signal dominates.";
  const text = drivers.slice(0, 2).join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function buildReasoning(
  company: Company,
  score: number,
  complianceStatus: string,
  momentumMeasured: boolean,
  fundamentalsMeasured: boolean,
): string[] {
  const momentumLabel = momentumMeasured ? "measured from price" : "editorial estimate";
  const fundLabel = fundamentalsMeasured ? "measured from fundamentals" : "editorial estimate";
  const measuredParts = [momentumMeasured && "price action", fundamentalsMeasured && "fundamentals"].filter(Boolean);
  const head = measuredParts.length
    ? `${measuredParts.join(" and ")} ${measuredParts.length > 1 ? "are" : "is"} measured; news, expert view, AI exposure and geopolitical risk are editorial.`
    : "every axis here is an editorial estimate.";
  const reasons = [
    `Score ${score}/100, medium-high-risk weighting. ${head.charAt(0).toUpperCase()}${head.slice(1)}`,
    `Momentum ${company.momentum}/100 (${momentumLabel}).`,
    `Growth ${company.growth}/100, quality ${company.quality}/100, valuation risk ${company.valuationRisk}/100, balance-sheet risk ${company.balanceSheetRisk}/100 (${fundLabel}).`,
    `AI exposure (editorial) ${company.aiExposure}/100.`,
    `News signal is ${company.newsSignal.direction}: ${company.newsSignal.summary}`,
    `Expert signal is ${company.expertSignal.direction}: ${company.expertSignal.summary}`,
  ];

  if (company.valuationRisk >= 70) {
    reasons.push(`Valuation risk is elevated at ${company.valuationRisk}/100.`);
  }

  if (company.geopoliticalRisk >= 65) {
    reasons.push(`Geopolitical risk is material at ${company.geopoliticalRisk}/100.`);
  }

  if (complianceStatus !== "unknown") {
    reasons.push(`Compliance status: ${complianceStatus}.`);
  }

  return reasons;
}

function downsideFor(company: Company): string {
  const risks = [];
  if (company.valuationRisk >= 65) risks.push("valuation multiple compression");
  if (company.geopoliticalRisk >= 60) risks.push("geopolitical or regulatory shock");
  if (company.balanceSheetRisk >= 50) risks.push("balance sheet pressure");
  risks.push("AI demand slows, margins compress, or competition catches up");
  return `Downside case: ${risks.join("; ")}.`;
}

function directionScore(direction: SignalDirection): number {
  if (direction === "positive") return 72;
  if (direction === "negative") return 28;
  return 50;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
