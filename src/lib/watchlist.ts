import type { Company } from "./types";

/**
 * A name the user typed in themselves — an idea they want the dashboard to score,
 * even though it isn't in the curated universe. The point is to run YOUR own ideas
 * through the SAME unbiased model the rest of the app uses (the model score, EIFO
 * compliance, and the broker/budget investability gates), rather than trusting a
 * gut feeling. A broker can show you a name's price; it can't tell you how that
 * name sits against your personal risk model and your compliance constraints.
 *
 * Honesty matters here: a user-added name starts with NEUTRAL editorial axes, not
 * a flattering guess, so its first score is deliberately middling and clearly
 * provisional. The symbol is the key to enrichment — `npm run refresh -- <SYMBOL>`
 * fetches real momentum and fundamentals from Yahoo, and from then on the name is
 * scored on measured data like any curated name.
 */
export type WatchEntry = {
  /** The company's display name, as the user typed it. */
  name: string;
  /** Ticker symbol (Yahoo-style, e.g. TSLA, ASML.AS) — the key to live data. */
  symbol: string;
  /** Listing exchange, so the broker tradability gate applies. Optional. */
  exchange?: string;
  /** When the user added it (ISO) — used for a stable, newest-first order. */
  addedAt: string;
};

const KEY = "psd.watchlist.v1";

/** Normalise a typed symbol: trimmed and upper-cased, the form Yahoo expects. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Build the neutral Company a watch entry scores as. Every editorial axis sits at
 * the midpoint (50) so the model neither favours nor penalises the name on a guess
 * — the first score is honestly "we don't know enough yet". Once a refresh writes a
 * market snapshot for this symbol, `mergeMarketSnapshot` replaces momentum and the
 * fundamentals-derived axes with measured data, exactly as it does for the curated
 * universe. The `userAdded` flag is metadata for the UI badge; it never touches the
 * score. The signals are explicitly `missing`/neutral and say so in plain language.
 */
export function watchEntryToCompany(entry: WatchEntry): Company {
  const exchange = entry.exchange?.trim();
  return {
    name: entry.name,
    symbol: entry.symbol,
    region: "Unknown",
    exchange: exchange && exchange.length > 0 ? exchange : "Unknown",
    assetType: "stock",
    themes: ["watchlist"],
    userAdded: true,
    aiExposure: 50,
    growth: 50,
    momentum: 50,
    quality: 50,
    valuationRisk: 50,
    balanceSheetRisk: 50,
    geopoliticalRisk: 50,
    newsSignal: {
      sentiment: 50,
      direction: "neutral",
      summary:
        "Added by you — not yet researched. The score is a neutral placeholder until live data is fetched for this symbol.",
      freshness: "missing",
      sources: [],
    },
    expertSignal: {
      direction: "neutral",
      summary: `No research yet. Run “npm run refresh -- ${entry.symbol}” to score it on measured momentum and fundamentals.`,
      freshness: "missing",
      sources: [],
    },
  };
}

/** Map a whole watchlist to the neutral companies the dashboard model consumes. */
export function watchlistCompanies(entries: WatchEntry[]): Company[] {
  return entries.map(watchEntryToCompany);
}

export type AddWatchInput = { name: string; symbol: string; exchange?: string };

/** Why an add was rejected — a code the UI turns into a plain-language message. */
export type AddWatchError = "missing_name" | "missing_symbol" | "duplicate" | "in_universe" | "owned";

export type AddWatchResult =
  | { ok: true; list: WatchEntry[]; entry: WatchEntry }
  | { ok: false; error: AddWatchError };

/**
 * Validate and add a typed name to the watchlist. Pure: it returns a new list
 * rather than mutating, so it unit-tests without a browser and the caller persists
 * the result. Rejections are explicit (empty fields, a symbol already on the
 * watchlist, already in the curated universe, or one you already hold) so the UI
 * can explain exactly what to fix — and so a held symbol never becomes a chip that
 * silently shows no card (the dashboard drops opportunities you already own).
 * `addedAt` must be supplied by the caller (so this stays a pure function of its
 * inputs); newest entries sort first.
 */
export function addWatchEntry(
  list: WatchEntry[],
  input: AddWatchInput,
  addedAt: string,
  universeSymbols: ReadonlySet<string> = new Set(),
  ownedSymbols: ReadonlySet<string> = new Set(),
): AddWatchResult {
  const name = input.name.trim();
  const symbol = normalizeSymbol(input.symbol);
  if (!name) return { ok: false, error: "missing_name" };
  if (!symbol) return { ok: false, error: "missing_symbol" };
  if (ownedSymbols.has(symbol)) return { ok: false, error: "owned" };
  if (universeSymbols.has(symbol)) return { ok: false, error: "in_universe" };
  if (list.some((entry) => entry.symbol === symbol)) return { ok: false, error: "duplicate" };

  const exchange = input.exchange?.trim();
  const entry: WatchEntry = {
    name,
    symbol,
    ...(exchange && exchange.length > 0 ? { exchange } : {}),
    addedAt,
  };
  return { ok: true, list: [entry, ...list], entry };
}

/** Remove the entry with this symbol (case-insensitive). Pure; returns a new list. */
export function removeWatchEntry(list: WatchEntry[], symbol: string): WatchEntry[] {
  const target = normalizeSymbol(symbol);
  return list.filter((entry) => entry.symbol !== target);
}

// --- persistence (mirrors storage.ts / brokerSettings.ts) -------------------

export function serializeWatchlist(entries: WatchEntry[]): string {
  return JSON.stringify({ version: 1, entries });
}

/**
 * Parse a stored payload back to a clean watchlist, dropping anything malformed so
 * a corrupt or older blob degrades to a shorter list rather than breaking the app.
 * Duplicates (same symbol) collapse to the first occurrence.
 */
export function parseWatchlist(raw: string | null | undefined): WatchEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: number; entries?: unknown };
    if (!Array.isArray(parsed.entries)) return [];
    const seen = new Set<string>();
    const out: WatchEntry[] = [];
    for (const raw of parsed.entries) {
      const candidate = raw as Partial<WatchEntry>;
      if (typeof candidate?.name !== "string" || typeof candidate?.symbol !== "string") continue;
      const name = candidate.name.trim();
      const symbol = normalizeSymbol(candidate.symbol);
      if (!name || !symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      const exchange = typeof candidate.exchange === "string" ? candidate.exchange.trim() : "";
      out.push({
        name,
        symbol,
        ...(exchange ? { exchange } : {}),
        addedAt: typeof candidate.addedAt === "string" ? candidate.addedAt : new Date(0).toISOString(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined; // localStorage can throw in private mode
  }
}

export function loadWatchlist(): WatchEntry[] {
  return parseWatchlist(storage()?.getItem(KEY) ?? undefined);
}

export function saveWatchlist(entries: WatchEntry[]): void {
  try {
    storage()?.setItem(KEY, serializeWatchlist(entries));
  } catch {
    /* quota / private mode — non-fatal, the session keeps the in-memory list */
  }
}
