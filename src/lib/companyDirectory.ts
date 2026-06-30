/**
 * A small, bundled directory of well-known global AI/tech names so a user can add an
 * idea to their watchlist by TYPING ITS NAME, instead of having to already know its
 * exact Yahoo ticker and listing exchange. The "Watch your own ideas" form takes a
 * name, a ticker and a market; the ticker is the hard part — "Novo Nordisk" is
 * `NOVO-B.CO`, "STMicroelectronics" is `STMPA.PA` — knowledge a broker's search box
 * has but this form did not. This is the offline lookup that closes that gap.
 *
 * Two things make it genuinely useful, both tied to the owner's standing asks:
 *  1. It removes the "what's the ticker?" friction for the long tail of names that
 *     aren't already in the curated universe (the universe's names are filtered out
 *     at search time, so every suggestion is one you can actually add and score).
 *  2. It fills in the listing EXCHANGE, which is what the broker tradability gate
 *     keys on. Before, a hand-added name defaulted to "Not sure" and the gate stayed
 *     blind; now a picked name carries its real market, so an off-broker listing is
 *     flagged at entry — the "don't surface what I can't buy" guard, applied earlier.
 *
 * What this directory is and isn't:
 *  - It carries IDENTITY only — display name, the Yahoo-style symbol that keys live
 *    data, and the listing exchange. It deliberately carries NO price, score, or
 *    estimate: a name picked from here still scores on the same neutral model and
 *    only earns measured momentum/fundamentals after a refresh. Baking a price in
 *    would go stale and read as measured data it isn't.
 *  - It is curated and finite, not a live search API — no network, no key, no CORS.
 *
 * Exchange strings match `Company.exchange` exactly so the broker tradability gate
 * (`investability.ts`) and the existing market dropdown reconcile with these.
 */
export type DirectoryEntry = {
  /** Display name, as it should appear and be stored. */
  name: string;
  /** Yahoo-style ticker — the key to live data (e.g. `NOVO-B.CO`, `IFX.DE`). */
  symbol: string;
  /** Listing exchange, matched against the broker's untradable list. */
  exchange: string;
  /** Extra search terms (short names, common spellings) that should also match. */
  aliases?: string[];
};

/**
 * The curated set. Deliberately scoped to notable AI/tech/semiconductor names that
 * are NOT already in the seeded universe — adding one of those is a no-op the form
 * rejects, so listing them here would only show dead suggestions. Symbols and
 * exchanges are the canonical Yahoo values, so the standard refresh pre-prices the
 * whole set (see `refreshSymbols.ts`) and the tradability gate keys on the right
 * market — a name the user picks is scored on measured data the moment it is added.
 */
export const COMPANY_DIRECTORY: DirectoryEntry[] = [
  // — US software / platforms / AI —
  { name: "Oracle", symbol: "ORCL", exchange: "NYSE" },
  { name: "Salesforce", symbol: "CRM", exchange: "NYSE" },
  { name: "ServiceNow", symbol: "NOW", exchange: "NYSE" },
  { name: "Snowflake", symbol: "SNOW", exchange: "NYSE" },
  { name: "Adobe", symbol: "ADBE", exchange: "NASDAQ" },
  { name: "CrowdStrike", symbol: "CRWD", exchange: "NASDAQ", aliases: ["crowdstrike"] },
  { name: "Dell Technologies", symbol: "DELL", exchange: "NYSE", aliases: ["dell"] },
  // — US semiconductors & AI hardware —
  { name: "Qualcomm", symbol: "QCOM", exchange: "NASDAQ" },
  { name: "Intel", symbol: "INTC", exchange: "NASDAQ" },
  { name: "Micron Technology", symbol: "MU", exchange: "NASDAQ", aliases: ["micron"] },
  { name: "Marvell Technology", symbol: "MRVL", exchange: "NASDAQ", aliases: ["marvell"] },
  // — European semis & industrials (tradable, but worth the broker check) —
  { name: "Infineon Technologies", symbol: "IFX.DE", exchange: "XETRA", aliases: ["infineon"] },
  { name: "SAP", symbol: "SAP.DE", exchange: "XETRA" },
  { name: "STMicroelectronics", symbol: "STMPA.PA", exchange: "Euronext Paris", aliases: ["stmicro", "st micro"] },
  { name: "Schneider Electric", symbol: "SU.PA", exchange: "Euronext Paris", aliases: ["schneider"] },
  { name: "BE Semiconductor (Besi)", symbol: "BESI.AS", exchange: "Euronext Amsterdam", aliases: ["besi", "be semiconductor"] },
  { name: "Nordic Semiconductor", symbol: "NOD.OL", exchange: "Oslo Bors", aliases: ["nordic semiconductor"] },
  // — Danish / Nordic names a local owner is likely to type —
  { name: "Novo Nordisk", symbol: "NOVO-B.CO", exchange: "Nasdaq Copenhagen", aliases: ["novo", "novo nordisk"] },
  { name: "Genmab", symbol: "GMAB.CO", exchange: "Nasdaq Copenhagen" },
  { name: "Vestas Wind Systems", symbol: "VWS.CO", exchange: "Nasdaq Copenhagen", aliases: ["vestas"] },
  { name: "Ørsted", symbol: "ORSTED.CO", exchange: "Nasdaq Copenhagen", aliases: ["orsted", "oersted"] },
  { name: "Netcompany Group", symbol: "NETC.CO", exchange: "Nasdaq Copenhagen", aliases: ["netcompany"] },
];

/** Lower-cased, trimmed — the normal form both the query and the haystack are matched in. */
function norm(value: string): string {
  return value.trim().toLowerCase();
}

/** How well a single entry matches a normalized query, or 0 for no match. Higher is better. */
function scoreEntry(entry: DirectoryEntry, q: string): number {
  const name = norm(entry.name);
  const symbol = norm(entry.symbol);
  const aliases = entry.aliases ?? [];

  // Exact ticker match is the strongest possible signal — the user knows precisely what they want.
  if (symbol === q) return 100;
  // Symbol prefix (typing the ticker) ranks above name matches.
  if (symbol.startsWith(q)) return 90;
  // Name starts with the query — the common case for typing a company name.
  if (name.startsWith(q)) return 80;
  // An alias starts with the query (e.g. "novo" → Novo Nordisk, "besi" → BE Semiconductor).
  if (aliases.some((alias) => norm(alias).startsWith(q))) return 70;
  // The query appears somewhere inside the name (e.g. "semi" → Nordic Semiconductor).
  if (name.includes(q)) return 50;
  // Last resort: the query appears inside an alias.
  if (aliases.some((alias) => norm(alias).includes(q))) return 40;
  return 0;
}

export type SearchOptions = {
  /** Symbols to omit (already owned, in the curated universe, or already watched) so every suggestion is addable. */
  exclude?: ReadonlySet<string>;
  /** Maximum suggestions to return. Defaults to 6 to match the dropdown's height budget. */
  limit?: number;
};

/**
 * Rank the directory against a typed query. Pure and deterministic: matches are
 * scored by how directly they hit (exact ticker → symbol prefix → name prefix →
 * alias → substring), then ties break alphabetically by name so the list is stable
 * keystroke to keystroke. An empty query returns nothing (the dropdown stays closed
 * until the user types). Excluded symbols are dropped BEFORE the limit so a hidden
 * duplicate never costs a visible suggestion its slot.
 */
export function searchDirectory(query: string, options: SearchOptions = {}): DirectoryEntry[] {
  const q = norm(query);
  if (!q) return [];
  const exclude = options.exclude;
  const limit = options.limit ?? 6;

  const ranked: Array<{ entry: DirectoryEntry; score: number }> = [];
  for (const entry of COMPANY_DIRECTORY) {
    if (exclude?.has(entry.symbol.toUpperCase())) continue;
    const score = scoreEntry(entry, q);
    if (score > 0) ranked.push({ entry, score });
  }

  ranked.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return ranked.slice(0, limit).map((item) => item.entry);
}
