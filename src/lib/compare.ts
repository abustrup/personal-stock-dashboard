import type { Company, Recommendation } from "./types";

/** Which side leads a given axis (or the comparison overall). */
export type Side = "a" | "b" | "tie";

/** Provenance of an axis level, matching the rest of the dashboard's discipline. */
export type AxisProvenance = "measured" | "editorial";

/**
 * One scoring driver, compared head-to-head. Both levels are on the same 0-100
 * scale and oriented so higher is always better (risk axes are inverted into
 * "value" / "balance sheet" the same way the detail view's input bars are), so a
 * longer bar always means the stronger name on that axis.
 */
export type CompareAxis = {
  label: string;
  a: number;
  b: number;
  /** Absolute difference between the two levels (0-100). */
  gap: number;
  leader: Side;
  /** Measured only when the underlying data was fetched for BOTH names. */
  provenance: AxisProvenance;
};

/** A full head-to-head comparison of two recommendations. */
export type Comparison = {
  axes: CompareAxis[];
  /** a.score − b.score (positive means A scores higher). */
  scoreGap: number;
  /** Which name the model rates higher overall (tie when scores are equal). */
  leader: Side;
  /** A one-line, honest synthesis of the model's lean. */
  verdict: string;
};

// An axis gap below this (0-100 points) is treated as a wash — neither name is
// meaningfully ahead, so it is not claimed as a lead in the verdict. Keeps the
// synthesis honest rather than dramatising rounding noise.
const AXIS_TIE_EPS = 3;

type AxisSpec = {
  label: string;
  /** Higher-is-better level for a company, 0-100. */
  value: (c: Company) => number;
  /** True when this axis is measured from fetched data for the given company. */
  measured: (c: Company) => boolean;
};

const fundamentalsMeasured = (c: Company) => Boolean(c.market?.fundamentals);
const momentumMeasured = (c: Company) => Boolean(c.market);

// The same six drivers the detail view's input-level bars show, oriented so a
// longer bar is always the better name (valuation/balance-sheet risk inverted).
// AI exposure is always editorial; momentum is measured once a price snapshot
// exists; the fundamentals-derived axes are measured only after a refresh.
const AXIS_SPECS: AxisSpec[] = [
  { label: "AI exposure", value: (c) => c.aiExposure, measured: () => false },
  { label: "Growth", value: (c) => c.growth, measured: fundamentalsMeasured },
  { label: "Momentum", value: (c) => c.momentum, measured: momentumMeasured },
  { label: "Quality", value: (c) => c.quality, measured: fundamentalsMeasured },
  { label: "Value (vs risk)", value: (c) => 100 - c.valuationRisk, measured: fundamentalsMeasured },
  { label: "Balance sheet", value: (c) => 100 - c.balanceSheetRisk, measured: fundamentalsMeasured },
];

function clamp01to100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Build the head-to-head comparison of two recommendations. Pure and derived
 * from the same company axes the rest of the model uses, so the picture can
 * never disagree with the detail view or the score. An axis is only labelled
 * "measured" when BOTH names have the underlying data fetched — otherwise the
 * pair is being compared on at least one editorial estimate, and the chart says
 * so rather than overclaiming.
 */
export function buildComparison(a: Recommendation, b: Recommendation): Comparison {
  const axes = AXIS_SPECS.map<CompareAxis>((spec) => {
    const av = clamp01to100(spec.value(a.company));
    const bv = clamp01to100(spec.value(b.company));
    const gap = Math.abs(av - bv);
    const leader: Side = gap < AXIS_TIE_EPS ? "tie" : av > bv ? "a" : "b";
    const provenance: AxisProvenance =
      spec.measured(a.company) && spec.measured(b.company) ? "measured" : "editorial";
    return { label: spec.label, a: av, b: bv, gap, leader, provenance };
  });

  const scoreGap = a.score - b.score;
  const leader: Side = scoreGap === 0 ? "tie" : scoreGap > 0 ? "a" : "b";
  const verdict = buildVerdict(a, b, axes, scoreGap, leader);

  return { axes, scoreGap, leader, verdict };
}

// The axes a side leads by a meaningful margin, strongest first — the material
// for the verdict's "ahead on …" clause.
function leadingAxes(axes: CompareAxis[], side: Side): string[] {
  return axes
    .filter((axis) => axis.leader === side)
    .sort((x, y) => y.gap - x.gap)
    .map((axis) => axis.label);
}

function listAxes(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

// An honest one-line synthesis. Names the winner and the score gap, the two
// axes it leads by the most, and — so the call is never one-sided — the loser's
// single best axis. Compliance blocks dominate: a blocked name is never the pick.
function buildVerdict(
  a: Recommendation,
  b: Recommendation,
  axes: CompareAxis[],
  scoreGap: number,
  leader: Side,
): string {
  const nameA = a.company.name;
  const nameB = b.company.name;

  if (a.compliance.status === "blocked" && b.compliance.status === "blocked") {
    return `Both are blocked by EIFO policy — neither is investable.`;
  }
  if (a.compliance.status === "blocked") {
    return `${nameA} is blocked by EIFO policy, so the model points to ${nameB} by default.`;
  }
  if (b.compliance.status === "blocked") {
    return `${nameB} is blocked by EIFO policy, so the model points to ${nameA} by default.`;
  }

  if (leader === "tie") {
    const aLeads = leadingAxes(axes, "a");
    const bLeads = leadingAxes(axes, "b");
    if (aLeads.length === 0 && bLeads.length === 0) {
      return `Too close to call — both score ${a.score}, with no axis clearly apart.`;
    }
    return `Too close to call on score (${a.score} each): ${nameA} leads on ${
      listAxes(aLeads.slice(0, 2)) || "nothing decisive"
    }, ${nameB} on ${listAxes(bLeads.slice(0, 2)) || "nothing decisive"}.`;
  }

  const winner = leader === "a" ? a : b;
  const loser = leader === "a" ? b : a;
  const winnerName = leader === "a" ? nameA : nameB;
  const loserName = leader === "a" ? nameB : nameA;
  const winnerLeads = leadingAxes(axes, leader).slice(0, 2);
  const loserBest = leadingAxes(axes, leader === "a" ? "b" : "a")[0];

  const aheadClause = winnerLeads.length
    ? `ahead on ${listAxes(winnerLeads)}`
    : `ahead on the model's overall weighting`;
  const consolation = loserBest ? ` ${loserName} leads on ${loserBest}.` : "";

  return `The model leans ${winnerName} (${winner.score} vs ${loser.score}): ${aheadClause}.${consolation}`;
}
