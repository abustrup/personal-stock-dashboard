import type { ModelSnapshot } from "./changes";
import type { Holding } from "./types";

const KEY = "psd.portfolio.v1";
const CHANGES_KEY = "psd.changes.baseline.v1";

export type StoredPortfolio = {
  version: 1;
  importedAt: string;
  label: string;
  holdings: Holding[];
};

// Pure (de)serialization so it can be unit-tested without a browser.
export function serializePortfolio(holdings: Holding[], label: string, importedAt: string): string {
  const payload: StoredPortfolio = { version: 1, importedAt, label, holdings };
  return JSON.stringify(payload);
}

export function parseStoredPortfolio(raw: string | null | undefined): StoredPortfolio | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPortfolio>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.holdings) || parsed.holdings.length === 0) return undefined;
    // Minimal shape check so a corrupt/old payload falls back to the demo.
    if (!parsed.holdings.every((h) => typeof h?.symbol === "string" && typeof h?.marketValueDkk === "number")) {
      return undefined;
    }
    return {
      version: 1,
      importedAt: typeof parsed.importedAt === "string" ? parsed.importedAt : new Date(0).toISOString(),
      label: typeof parsed.label === "string" ? parsed.label : "Imported portfolio",
      holdings: parsed.holdings as Holding[],
    };
  } catch {
    return undefined;
  }
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined; // localStorage can throw in private mode
  }
}

export function loadPortfolio(): StoredPortfolio | undefined {
  return parseStoredPortfolio(storage()?.getItem(KEY) ?? undefined);
}

export function savePortfolio(holdings: Holding[], label: string, importedAt: string): void {
  try {
    storage()?.setItem(KEY, serializePortfolio(holdings, label, importedAt));
  } catch {
    /* quota / private mode — non-fatal, the session still works in memory */
  }
}

export function clearPortfolio(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}

// The "since the last refresh" baseline: the model snapshot the reader last saw,
// so the next visit can diff against it. Stored separately from the portfolio so
// either can be cleared without disturbing the other. Pure (de)serialization so
// the shape check is unit-testable without a browser.
export function serializeSnapshot(snapshot: ModelSnapshot): string {
  return JSON.stringify({ version: 1, ...snapshot });
}

export function parseStoredSnapshot(raw: string | null | undefined): ModelSnapshot | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<ModelSnapshot> & { version?: number };
    if (parsed?.version !== 1) return undefined;
    if (typeof parsed.asOf !== "string" || typeof parsed.entries !== "object" || parsed.entries === null) {
      return undefined;
    }
    return { asOf: parsed.asOf, entries: parsed.entries as ModelSnapshot["entries"] };
  } catch {
    return undefined;
  }
}

export function loadChangeBaseline(): ModelSnapshot | undefined {
  return parseStoredSnapshot(storage()?.getItem(CHANGES_KEY) ?? undefined);
}

export function saveChangeBaseline(snapshot: ModelSnapshot): void {
  try {
    storage()?.setItem(CHANGES_KEY, serializeSnapshot(snapshot));
  } catch {
    /* quota / private mode — non-fatal, the digest just won't persist */
  }
}
