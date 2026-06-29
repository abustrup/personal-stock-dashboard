import type { ComplianceStatus, Recommendation, RecommendationAction } from "./types";

/** One company on the theme ladder, carrying only what the chart needs. */
export type ThemePeer = {
  symbol: string;
  name: string;
  /** The model's own 0-100 score. */
  score: number;
  action: RecommendationAction;
  /** True when this is a holding in your book (filled marker), false for an opportunity (hollow). */
  owned: boolean;
  compliance: ComplianceStatus;
  /** True for the company the detail view is currently showing. */
  selected: boolean;
};

/**
 * Where the selected company stands among the names doing the same thing, by the
 * model's own score. A broker shows each line in isolation; this ranks one name
 * against its theme peers and — the point — surfaces the higher-scoring ones you
 * do NOT own. It reuses scores already computed in the dashboard model, so the
 * ladder can never disagree with the rest of the app.
 */
export type PeerComparison = {
  /** The theme used to define the peer set (the selected company's most-populated theme). */
  theme: string;
  /** Every peer sharing `theme`, including the selected company, ranked by score (desc). */
  peers: ThemePeer[];
  /** The selected company's 1-based rank within `peers`. */
  rank: number;
  /** Total names on the ladder (>= 2 when a comparison is shown). */
  count: number;
  /** Names ranked above the selected company that you do not own — the actionable ideas. */
  higherUnowned: ThemePeer[];
};

/**
 * Build the theme-peer ladder for `selectedSymbol` from the ranked recommendation
 * set (`all` = portfolio + opportunities, each company once). Picks the selected
 * company's most-populated theme as the comparison axis so the ladder is as full
 * as the universe allows; ties break toward the company's primary (first) theme.
 * Returns undefined when no theme has at least one other member — there is nothing
 * to compare against, so the card should not render.
 */
export function buildPeerComparison(
  all: Recommendation[],
  selectedSymbol: string,
): PeerComparison | undefined {
  const selected = all.find((rec) => rec.company.symbol === selectedSymbol);
  if (!selected) return undefined;

  const themes = selected.company.themes;
  if (themes.length === 0) return undefined;

  // For each of the selected company's themes, the recommendations that share it.
  // Choose the theme with the most members; break ties by the company's own theme
  // order (primary theme first) so the choice is deterministic and explainable.
  let bestTheme: string | undefined;
  let bestMembers: Recommendation[] = [];
  for (const theme of themes) {
    const members = all.filter((rec) => rec.company.themes.includes(theme));
    if (members.length > bestMembers.length) {
      bestTheme = theme;
      bestMembers = members;
    }
  }

  // Need at least the selected company plus one peer to be worth drawing.
  if (!bestTheme || bestMembers.length < 2) return undefined;

  const peers = bestMembers
    .map<ThemePeer>((rec) => ({
      symbol: rec.company.symbol,
      name: rec.company.name,
      score: rec.score,
      action: rec.action,
      owned: Boolean(rec.holding),
      compliance: rec.compliance.status,
      selected: rec.company.symbol === selectedSymbol,
    }))
    // Highest score first; break ties by name so the order is stable across renders.
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const rank = peers.findIndex((peer) => peer.selected) + 1;
  const selectedScore = peers[rank - 1]?.score ?? 0;
  // Strictly-higher score (not merely ranked above): a name tied on score with a
  // name-tiebreak edge must not be claimed to "score higher". Honesty over drama.
  const higherUnowned = peers.filter(
    (peer) => !peer.owned && !peer.selected && peer.score > selectedScore,
  );

  return { theme: bestTheme, peers, rank, count: peers.length, higherUnowned };
}
