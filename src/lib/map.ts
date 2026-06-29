import type { ComplianceStatus, Recommendation, RecommendationAction } from "./types";

/**
 * The "decision map" projects every name onto one plane: the model's score (x,
 * reward) against a composite risk index (y). This is the synthesis a broker
 * dashboard cannot draw — your holdings *and* the names you do not own on the
 * same risk/reward plane, each annotated with the model's own action.
 *
 * Everything here is pure and unit-tested so the picture can never drift from
 * the numbers behind it. The risk index is a plain mean of the model's three
 * risk axes (no new estimate is invented); provenance discipline is kept by the
 * component, which labels owned vs not-owned and measured vs editorial.
 */

/** The four decision regions of the plane, split at the score/risk midlines. */
export type MapQuadrant = "strong-steady" | "strong-risky" | "low-priority" | "avoid-zone";

export type MapPoint = {
  symbol: string;
  name: string;
  /** Model score, 0–100 (x axis). */
  score: number;
  /** Composite risk index, 0–100 (y axis). */
  risk: number;
  /** True when this name is in the user's book (filled marker, sized by weight). */
  owned: boolean;
  /** Portfolio weight as a percent number; 0 for non-owned opportunities. */
  weightPct: number;
  action: RecommendationAction;
  compliance: ComplianceStatus;
  /** True when backed by measured market data (not editorial-only). */
  measured: boolean;
  quadrant: MapQuadrant;
};

/** Where the plane is divided into quadrants (the neutral midpoint of each axis). */
export const SCORE_MIDLINE = 50;
export const RISK_MIDLINE = 50;

/**
 * Composite risk index, 0–100: the unweighted mean of the model's valuation,
 * balance-sheet and geopolitical risk axes. A plain average keeps it honest and
 * explainable — it invents no new number, it just summarises the three axes the
 * score already penalises. Compliance is shown separately (it forces the action,
 * not a point on this axis), so it is deliberately excluded here.
 */
export function riskIndex(company: {
  valuationRisk: number;
  balanceSheetRisk: number;
  geopoliticalRisk: number;
}): number {
  const mean = (company.valuationRisk + company.balanceSheetRisk + company.geopoliticalRisk) / 3;
  return Math.round(clamp(mean, 0, 100));
}

export function quadrantOf(
  score: number,
  risk: number,
  scoreMid: number = SCORE_MIDLINE,
  riskMid: number = RISK_MIDLINE,
): MapQuadrant {
  const strong = score >= scoreMid;
  const risky = risk >= riskMid;
  if (strong && !risky) return "strong-steady";
  if (strong && risky) return "strong-risky";
  if (!strong && !risky) return "low-priority";
  return "avoid-zone";
}

export const QUADRANT_LABELS: Record<MapQuadrant, string> = {
  "strong-steady": "Strong & steady",
  "strong-risky": "Strong but risky",
  "low-priority": "Low priority",
  "avoid-zone": "Avoid zone",
};

export function toMapPoint(recommendation: Recommendation): MapPoint {
  const score = recommendation.score;
  const risk = riskIndex(recommendation.company);
  return {
    symbol: recommendation.company.symbol,
    name: recommendation.company.name,
    score,
    risk,
    owned: Boolean(recommendation.holding),
    weightPct: recommendation.holding?.portfolioWeight ?? 0,
    action: recommendation.action,
    compliance: recommendation.compliance.status,
    measured: recommendation.measured,
    quadrant: quadrantOf(score, risk),
  };
}

/**
 * Build the points for the plane: every owned holding, plus the supplied
 * opportunities. Capping/ordering of opportunities is the caller's job (and is
 * surfaced in the UI), so this stays a pure projection of whatever it is given.
 */
export function buildMapPoints(
  portfolio: Recommendation[],
  opportunities: Recommendation[],
): MapPoint[] {
  return [...portfolio.map(toMapPoint), ...opportunities.map(toMapPoint)];
}

export type PlaneDims = {
  width: number;
  height: number;
  /** Inner padding so markers near the edges are not clipped. */
  padX: number;
  padY: number;
};

/**
 * Project a (score, risk) pair to pixel coordinates inside the plane. Score runs
 * left→right (higher is better, on the right); risk runs bottom→top (higher risk
 * sits higher up, matching the "danger is up" reading of the quadrant labels).
 */
export function projectPoint(
  score: number,
  risk: number,
  dims: PlaneDims,
): { x: number; y: number } {
  const innerW = dims.width - dims.padX * 2;
  const innerH = dims.height - dims.padY * 2;
  const x = dims.padX + (clamp(score, 0, 100) / 100) * innerW;
  const y = dims.padY + (1 - clamp(risk, 0, 100) / 100) * innerH;
  return { x, y };
}

export type RadiusScale = {
  /** Smallest marker radius (also the fixed radius for non-owned opportunities). */
  minR: number;
  /** Largest marker radius (the heaviest owned position). */
  maxR: number;
  /** The largest owned weight in the book, used to normalise marker sizes. */
  maxWeight: number;
};

/**
 * Marker radius. Owned holdings scale by portfolio weight between minR and maxR
 * (bigger = larger position); non-owned opportunities use the fixed minR so the
 * eye reads them as a uniform field of candidates rather than weighted holdings.
 */
export function markerRadius(point: MapPoint, scale: RadiusScale): number {
  if (!point.owned || scale.maxWeight <= 0) return scale.minR;
  const t = clamp(point.weightPct / scale.maxWeight, 0, 1);
  return scale.minR + t * (scale.maxR - scale.minR);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
