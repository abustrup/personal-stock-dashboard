import type { Recommendation } from "./types";

/** One primary-theme slice of the book: its combined weight, holdings and lead name. */
export type ThemeSlice = {
  /** The theme that defines this slice (each holding's primary/first theme). */
  theme: string;
  /** Combined portfolio weight (percent number) of holdings whose primary theme is this, e.g. 24.3. */
  weightPct: number;
  /** Number of owned holdings counted into this slice. */
  holdings: number;
  /** The single largest holding (by weight) in this slice — the dominant contributor. */
  topName: string;
};

/**
 * What the book is actually betting on, synthesised from the imported positions.
 * A broker shows a flat list of lines; this rolls them up into the themes the money
 * sits in. Each holding is counted EXACTLY ONCE, under its primary (first) theme, so
 * the slices form an honest partition that sums to ~100% — distinct from theme
 * EXPOSURE (lib/opportunities.ts), which counts a multi-theme name's full weight under
 * every theme and so deliberately exceeds 100%. The weights are measured (from the
 * broker import); the theme taxonomy is an editorial classification.
 */
export type BookComposition = {
  /** Primary-theme slices, ranked by weight desc, ties broken by theme name. Sum ≈ 100. */
  slices: ThemeSlice[];
  /** Number of distinct primary themes in the book. */
  themeCount: number;
  /** Number of owned holdings counted. */
  holdingCount: number;
  /** Combined weight of all counted holdings (percent number) — the partition's total. */
  totalWeightPct: number;
  /** The dominant slice's share (percent number), 0 when the book is empty. */
  topWeightPct: number;
  /** The dominant theme, undefined when the book is empty. */
  topTheme?: string;
};

type SliceAccumulator = {
  theme: string;
  weightPct: number;
  holdings: number;
  topName: string;
  topWeight: number;
};

/**
 * Roll the owned portfolio up into a primary-theme partition. Only positions you
 * actually hold count (watch/investigate ideas are not allocation); a holding with no
 * themes falls back to "uncategorised" so it is still represented, never dropped. The
 * dominant name within each slice is the largest holding by weight, with the theme name
 * as a stable tiebreak so the rollup is deterministic across renders.
 */
export function buildBookComposition(portfolio: Recommendation[]): BookComposition {
  const owned = portfolio.filter((rec) => rec.holding);
  const byTheme = new Map<string, SliceAccumulator>();
  let totalWeightPct = 0;

  for (const rec of owned) {
    const weight = rec.holding?.portfolioWeight ?? 0;
    totalWeightPct += weight;
    const theme = rec.company.themes[0] ?? "uncategorised";
    const entry =
      byTheme.get(theme) ?? { theme, weightPct: 0, holdings: 0, topName: rec.company.name, topWeight: -Infinity };
    entry.weightPct += weight;
    entry.holdings += 1;
    if (weight > entry.topWeight) {
      entry.topWeight = weight;
      entry.topName = rec.company.name;
    }
    byTheme.set(theme, entry);
  }

  const slices: ThemeSlice[] = [...byTheme.values()]
    .map(({ theme, weightPct, holdings, topName }) => ({ theme, weightPct, holdings, topName }))
    .sort((a, b) => b.weightPct - a.weightPct || a.theme.localeCompare(b.theme));

  return {
    slices,
    themeCount: slices.length,
    holdingCount: owned.length,
    totalWeightPct,
    topWeightPct: slices[0]?.weightPct ?? 0,
    topTheme: slices[0]?.theme,
  };
}
