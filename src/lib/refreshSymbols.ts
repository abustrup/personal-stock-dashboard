/**
 * The single list of symbols the market-data refresh should price.
 *
 * For a long time this was just "the curated universe", which left a gap behind
 * the watchlist picker: a user can TYPE a name from the bundled directory
 * (`companyDirectory.ts`) and add it as their own idea, but the automatic refresh
 * never fetched that name — so it kept the neutral placeholder score and the only
 * way to score it on real momentum was to run `npm run refresh -- <SYMBOL>` by
 * hand. The owner's standing ask was the opposite: enter a name and have the next
 * routine score it, no extra step.
 *
 * Pre-pricing the whole pickable set closes that gap. Every name the picker can
 * offer is fetched on the same daily refresh as the universe, so the moment a user
 * adds one it already carries measured momentum/fundamentals (via
 * `mergeMarketSnapshot`, keyed on the symbol) instead of a guess. It stays honest:
 * the directory still carries identity only; a name earns measured data exactly
 * when — and because — its real Yahoo snapshot is fetched, never before.
 *
 * Kept pure and data-injected so the refresh script and the tests agree on one
 * definition of "what to price", with no duplicated filtering.
 */

/** The minimum a universe entry needs to be considered for pricing. */
type PriceableCompany = { symbol: string; assetType: string };

/** The minimum a directory entry needs to contribute a symbol. */
type PriceableDirectoryEntry = { symbol: string };

/**
 * The deduped, ordered list of Yahoo symbols to refresh: every non-private
 * universe name first (private/unlisted names like a SpaceX proxy are skipped —
 * their proxy ticker can collide with an unrelated public symbol and be
 * mispriced), then every directory name the picker can add. Order is stable
 * (universe order, then directory order) and duplicates are dropped, so a symbol
 * that appears in both sets is fetched once.
 */
export function collectRefreshSymbols(
  universe: readonly PriceableCompany[],
  directory: readonly PriceableDirectoryEntry[],
): string[] {
  const ordered: string[] = [
    ...universe.filter((company) => company.assetType !== "private").map((company) => company.symbol),
    ...directory.map((entry) => entry.symbol),
  ];

  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const raw of ordered) {
    const symbol = raw?.trim();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols;
}
