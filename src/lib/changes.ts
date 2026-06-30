import type { Recommendation, RecommendationAction } from "./types";

// What moved since the LAST data refresh you saw. Every other view in the
// dashboard is a snapshot of "now"; this is the one axis nothing else covers —
// TIME. We keep a small baseline of the model's own outputs (its verdict, its
// score, and the measured momentum/price behind them) stamped with the data's
// asOf, then diff the current refresh against the last one the reader actually
// had in front of them. The result is a synthesis a static broker dashboard
// can't give: not today's % on one ticker, but "across your whole field, here
// is what the model now reads differently than last time you looked."
//
// Honesty boundary (load-bearing): momentum and price deltas are MEASURED market
// facts; a verdict flip is the MODEL's call (a blend of measured + editorial).
// The two carry different `measured` flags and must never be relabeled.

export type ChangeKind = "verdict" | "momentum" | "price";

export type Change = {
  symbol: string;
  name: string;
  /** True when the name is in the owned book (vs. an opportunity you don't hold). */
  owned: boolean;
  kind: ChangeKind;
  /** True for market-measured deltas (momentum, price); false for the model's verdict. */
  measured: boolean;
  direction: "up" | "down";
  /** Ranking weight — larger is more material. Not shown to the reader. */
  weight: number;
  // Verdict change payload.
  fromAction?: RecommendationAction;
  toAction?: RecommendationAction;
  // Momentum change payload (0-100 measured momentum).
  fromMomentum?: number;
  toMomentum?: number;
  // Price change payload — percent move since the baseline price, e.g. 6.2 / -3.1.
  pricePct?: number;
};

/** One name's model outputs at a point in time — the unit we persist and diff. */
export type ModelSnapshotEntry = {
  action: RecommendationAction;
  score: number;
  /** Measured momentum 0-100, present only when the name had market data. */
  momentum?: number;
  /** Measured price in the name's native currency, present only with market data. */
  price?: number;
  owned: boolean;
};

export type ModelSnapshot = {
  /** The data `generatedAt`/asOf this snapshot was taken from. */
  asOf: string;
  entries: Record<string, ModelSnapshotEntry>;
};

export type ChangeDigest = {
  /** False on a first-ever look (nothing to diff against yet). */
  hasBaseline: boolean;
  /** The asOf of the data the reader last saw — what we are diffing against. */
  baselineAsOf?: string;
  changes: Change[];
};

export type DiffOptions = {
  /** Minimum absolute momentum move (points) to surface. */
  momentumThreshold?: number;
  /** Minimum absolute price move (percent) to surface. */
  priceThreshold?: number;
  /** Cap on how many changes the digest carries (most material first). */
  maxChanges?: number;
};

const DEFAULTS: Required<DiffOptions> = {
  momentumThreshold: 4,
  priceThreshold: 3,
  maxChanges: 6,
};

// How bullish each verdict is, so a flip has a direction (and a magnitude for
// ranking). Owned and non-owned ladders share the scale: a downgrade is always
// "down", whichever vocabulary the name uses.
const ACTION_RANK: Record<RecommendationAction, number> = {
  increase: 2,
  investigate: 2,
  hold: 1,
  watch: 1,
  trim: -1,
  avoid: -2,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function measuredMomentum(rec: Recommendation): number | undefined {
  const value = rec.company.market?.momentum;
  return isFiniteNumber(value) ? value : undefined;
}

function measuredPrice(rec: Recommendation): number | undefined {
  const value = rec.company.market?.price;
  return isFiniteNumber(value) && value > 0 ? value : undefined;
}

// Capture the model's current outputs for every name, keyed by symbol. Only the
// fields the diff needs are stored, so the persisted baseline stays tiny.
export function snapshotModel(recommendations: Recommendation[], asOf: string): ModelSnapshot {
  const entries: Record<string, ModelSnapshotEntry> = {};
  for (const rec of recommendations) {
    entries[rec.company.symbol] = {
      action: rec.action,
      score: rec.score,
      momentum: measuredMomentum(rec),
      price: measuredPrice(rec),
      owned: Boolean(rec.holding),
    };
  }
  return { asOf, entries };
}

// The single most material change for one name since the baseline, or undefined
// when nothing crossed a threshold. We keep ONE change per name (the strongest)
// so the digest reads as a list of distinct names, not the same ticker repeated
// — a verdict flip already implies the momentum/price move underneath it.
function changeForName(
  prev: ModelSnapshotEntry,
  rec: Recommendation,
  opts: Required<DiffOptions>,
): Change | undefined {
  const symbol = rec.company.symbol;
  const name = rec.company.name;
  const owned = Boolean(rec.holding);
  const candidates: Change[] = [];

  if (prev.action !== rec.action) {
    const up = ACTION_RANK[rec.action] >= ACTION_RANK[prev.action];
    candidates.push({
      symbol,
      name,
      owned,
      kind: "verdict",
      measured: false,
      direction: up ? "up" : "down",
      // Verdicts outrank momentum/price moves: a changed call is the most
      // decision-relevant thing that can happen between refreshes.
      weight: 1000 + Math.abs(ACTION_RANK[rec.action] - ACTION_RANK[prev.action]),
      fromAction: prev.action,
      toAction: rec.action,
    });
  }

  const nowMomentum = measuredMomentum(rec);
  if (isFiniteNumber(prev.momentum) && isFiniteNumber(nowMomentum)) {
    const delta = nowMomentum - prev.momentum;
    if (Math.abs(delta) >= opts.momentumThreshold) {
      candidates.push({
        symbol,
        name,
        owned,
        kind: "momentum",
        measured: true,
        direction: delta >= 0 ? "up" : "down",
        weight: 100 + Math.abs(delta),
        fromMomentum: prev.momentum,
        toMomentum: nowMomentum,
      });
    }
  }

  const nowPrice = measuredPrice(rec);
  if (isFiniteNumber(prev.price) && prev.price > 0 && isFiniteNumber(nowPrice)) {
    const pct = ((nowPrice - prev.price) / prev.price) * 100;
    if (Math.abs(pct) >= opts.priceThreshold) {
      candidates.push({
        symbol,
        name,
        owned,
        kind: "price",
        measured: true,
        direction: pct >= 0 ? "up" : "down",
        weight: 100 + Math.abs(pct),
        pricePct: pct,
      });
    }
  }

  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) => b.weight - a.weight)[0];
}

// Diff the current model against a stored baseline. With no baseline (first
// look) the digest is empty and `hasBaseline` is false, so the UI shows a
// "tracking from now" note rather than a misleading "nothing changed".
export function diffModel(
  baseline: ModelSnapshot | undefined,
  recommendations: Recommendation[],
  options: DiffOptions = {},
): ChangeDigest {
  const opts = { ...DEFAULTS, ...options };
  if (!baseline) {
    return { hasBaseline: false, changes: [] };
  }
  const changes: Change[] = [];
  for (const rec of recommendations) {
    const prev = baseline.entries[rec.company.symbol];
    if (!prev) continue; // a brand-new name has no prior to diff against
    const change = changeForName(prev, rec, opts);
    if (change) changes.push(change);
  }
  changes.sort((a, b) => b.weight - a.weight);
  return {
    hasBaseline: true,
    baselineAsOf: baseline.asOf,
    changes: changes.slice(0, opts.maxChanges),
  };
}
