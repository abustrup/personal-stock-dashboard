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

  return {
    company,
    holding,
    action,
    conviction: convictionFor(company, score),
    score,
    reasoning: buildReasoning(company, score, compliance.status),
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

function calculateScore(company: Company, complianceStatus: ComplianceStatus): number {
  const newsScore = company.newsSignal.sentiment;
  const expertScore = directionScore(company.expertSignal.direction);
  const compliancePenalty = compliancePenaltyByStatus[complianceStatus];

  return clamp(
    company.aiExposure * 0.2 +
      company.growth * 0.16 +
      company.momentum * 0.14 +
      company.quality * 0.12 +
      newsScore * 0.1 +
      expertScore * 0.08 -
      company.valuationRisk * 0.1 -
      company.balanceSheetRisk * 0.05 -
      company.geopoliticalRisk * 0.05 -
      compliancePenalty +
      26,
  );
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

function convictionFor(company: Company, score: number): "high" | "medium" | "low" {
  const liveInputs = [company.newsSignal.freshness, company.expertSignal.freshness].filter((x) => x === "live").length;
  if (liveInputs >= 1 && score >= 70) return "high";
  if (score >= 52) return "medium";
  return "low";
}

function buildReasoning(company: Company, score: number, complianceStatus: string): string[] {
  const reasons = [
    `Score ${score}/100 with medium-high-risk weighting.`,
    `${company.aiExposure}/100 AI exposure and ${company.momentum}/100 momentum.`,
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
