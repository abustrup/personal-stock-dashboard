import type { Recommendation } from "./types";

/** One theme grouping of the opportunities you don't own, with your own exposure. */
export type OpportunityGroup = {
  /** The theme that defines this group (an opportunity's primary/first theme). */
  theme: string;
  /** Opportunities whose primary theme is this one, ranked by model score (desc). */
  opportunities: Recommendation[];
  /** The best (highest) model score among this group's opportunities. */
  bestScore: number;
  /** How many of YOUR holdings are tagged with this theme. */
  ownedCount: number;
  /** Combined portfolio weight (percent number) of those holdings, e.g. 24.3. */
  ownedWeightPct: number;
  /** True when you hold nothing tagged with this theme — a blind spot in your book. */
  isGap: boolean;
};

/**
 * The Opportunities overview: the standout idea, then the opportunity set grouped
 * by theme and weighed against your OWN portfolio exposure. The synthesis a broker
 * dashboard can't give — it only ever shows what you already hold, never where your
 * book has no exposure. Reuses the scores/actions already computed in the dashboard
 * model, so the overview can never disagree with the rest of the app.
 */
export type OpportunityOverview = {
  /** The single best idea you don't own (top non-avoid opportunity), if any. */
  standout?: Recommendation;
  /** Your portfolio exposure to the standout's primary theme — context for the hero. */
  standoutExposure?: StandoutExposure;
  /** Opportunities grouped by their primary theme, gap themes surfaced first. */
  groups: OpportunityGroup[];
  /** Total number of opportunities in the overview. */
  total: number;
  /** How many opportunities sit in themes you own nothing in (blind spots). */
  gapCount: number;
  /** Number of distinct themes represented. */
  themeCount: number;
  /**
   * How many higher-scoring ideas were passed over because you can't act on them
   * (off your broker's markets, or a single share is over budget) before reaching
   * the standout. 0 when the top idea is itself investable or no gate was applied.
   */
  standoutSkipped: number;
};

/** Owned exposure to a single theme: how many holdings and their combined weight. */
type ThemeExposure = { ownedCount: number; ownedWeightPct: number };

/** Your portfolio's exposure to one theme, with the gap flag — context for a hero idea. */
export type StandoutExposure = { theme: string; ownedCount: number; ownedWeightPct: number; isGap: boolean };

/**
 * Your owned exposure to a single theme: how many holdings carry it and their
 * combined portfolio weight, plus whether it's a gap (you own none). Only positions
 * you actually hold count; a holding with the theme contributes its full weight.
 * The one source of truth both the overview's standout context and the front-page
 * next-buy card read from, so the two can never disagree about a theme's exposure.
 */
export function themeExposure(portfolio: Recommendation[], theme: string): StandoutExposure {
  let ownedCount = 0;
  let ownedWeightPct = 0;
  for (const rec of portfolio) {
    if (!rec.holding) continue;
    if (rec.company.themes.includes(theme)) {
      ownedCount += 1;
      ownedWeightPct += rec.holding.portfolioWeight ?? 0;
    }
  }
  return { theme, ownedCount, ownedWeightPct, isGap: ownedCount === 0 };
}

/** The best idea to act on, plus how many higher-scoring ideas were passed over. */
export type StandoutPick = {
  /**
   * The single best idea to lead with: the highest-scoring non-avoid opportunity
   * that clears the investability gate. Falls back to the top non-avoid idea when
   * none clears the gate (or no gate is supplied), so there is always a pick when
   * any non-avoid idea exists. Undefined only when every idea is an avoid.
   */
  standout?: Recommendation;
  /**
   * How many higher-scoring non-avoid ideas were skipped because they're off-limits
   * (off-platform or over budget) before reaching `standout`. 0 when the top idea is
   * itself investable, when it's the off-limits fallback, or when no gate was applied.
   */
  standoutSkipped: number;
};

/**
 * Pick the standout idea to lead with — always one the user can actually act on
 * when an investability gate is supplied. Scans the pre-ranked opportunities for
 * the first non-avoid name that clears the gate; if a higher-scoring name is off
 * your broker's markets or a single share is over budget, it's passed over and
 * counted, so the UI can say so honestly. Without a gate this is simply the top
 * non-avoid idea. Shared by the Opportunities overview and the front-page rail so
 * the "top opportunity" the dashboard leads with is the same everywhere — and is
 * never a name the user can't buy.
 */
export function pickActionableStandout(
  opportunities: Recommendation[],
  investableSymbols?: Set<string>,
): StandoutPick {
  const candidates = opportunities.filter((rec) => rec.action !== "avoid");
  const firstInvestable = investableSymbols
    ? candidates.findIndex((rec) => investableSymbols.has(rec.company.symbol))
    : candidates.length > 0
      ? 0
      : -1;
  const standout = firstInvestable >= 0 ? candidates[firstInvestable] : candidates[0];
  const standoutSkipped = firstInvestable > 0 ? firstInvestable : 0;
  return { standout, standoutSkipped };
}

/**
 * Map every theme any owned holding is tagged with to the count of holdings and
 * their combined portfolio weight. Only positions you actually hold count toward
 * exposure (watch/investigate ideas are not exposure), and a holding contributes
 * its full weight to each of its themes — themes overlap, so these do not sum to
 * 100%. The taxonomy is editorial; the weights are measured (from the broker import).
 */
function ownedThemeExposure(portfolio: Recommendation[]): Map<string, ThemeExposure> {
  const exposure = new Map<string, ThemeExposure>();
  for (const rec of portfolio) {
    if (!rec.holding) continue;
    const weight = rec.holding.portfolioWeight ?? 0;
    for (const theme of rec.company.themes) {
      const entry = exposure.get(theme) ?? { ownedCount: 0, ownedWeightPct: 0 };
      entry.ownedCount += 1;
      entry.ownedWeightPct += weight;
      exposure.set(theme, entry);
    }
  }
  return exposure;
}

/**
 * Build the Opportunities overview from the ranked recommendation set. Each
 * opportunity is grouped once under its primary (first) theme so a name appears
 * exactly once. Groups are ordered to surface blind spots: themes you own nothing
 * in come first (highest best-score first), then themes you already hold (again by
 * best score). Within a group, opportunities are ranked by score, ties broken by
 * name so the order is stable across renders.
 */
export function buildOpportunityOverview(
  portfolio: Recommendation[],
  opportunities: Recommendation[],
  investableSymbols?: Set<string>,
): OpportunityOverview {
  const exposure = ownedThemeExposure(portfolio);
  const exposureFor = (theme: string): ThemeExposure =>
    exposure.get(theme) ?? { ownedCount: 0, ownedWeightPct: 0 };

  const byTheme = new Map<string, Recommendation[]>();
  for (const rec of opportunities) {
    const theme = rec.company.themes[0] ?? "uncategorised";
    const list = byTheme.get(theme) ?? [];
    list.push(rec);
    byTheme.set(theme, list);
  }

  const groups: OpportunityGroup[] = [...byTheme.entries()].map(([theme, recs]) => {
    const ranked = [...recs].sort(
      (a, b) => b.score - a.score || a.company.name.localeCompare(b.company.name),
    );
    const { ownedCount, ownedWeightPct } = exposureFor(theme);
    return {
      theme,
      opportunities: ranked,
      bestScore: ranked[0]?.score ?? 0,
      ownedCount,
      ownedWeightPct,
      isGap: ownedCount === 0,
    };
  });

  // Blind spots first (gap before owned), then strongest idea first within each
  // tier; the theme name is the final, stable tiebreak.
  groups.sort(
    (a, b) =>
      Number(b.isGap) - Number(a.isGap) ||
      b.bestScore - a.bestScore ||
      a.theme.localeCompare(b.theme),
  );

  // Lead with the best idea you can actually act on — the shared picker skips
  // higher-scoring names that are off-platform or over budget so the hero is never
  // an idea the user can't buy, and records how many were passed so the UI can say
  // so honestly. The same picker feeds the front-page rail, so the two agree.
  const { standout, standoutSkipped } = pickActionableStandout(opportunities, investableSymbols);
  const standoutTheme = standout?.company.themes[0];
  // Reuse the exposure map built above rather than re-scanning the whole book for
  // one theme; exposureFor and themeExposure compute the identical numbers.
  let standoutExposure: StandoutExposure | undefined;
  if (standoutTheme) {
    const { ownedCount, ownedWeightPct } = exposureFor(standoutTheme);
    standoutExposure = { theme: standoutTheme, ownedCount, ownedWeightPct, isGap: ownedCount === 0 };
  }

  const gapCount = groups.filter((g) => g.isGap).reduce((sum, g) => sum + g.opportunities.length, 0);

  return {
    standout,
    standoutExposure,
    groups,
    total: opportunities.length,
    gapCount,
    themeCount: groups.length,
    standoutSkipped,
  };
}
