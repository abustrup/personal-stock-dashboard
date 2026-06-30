import { describe, expect, it } from "vitest";
import { buildDashboardModel } from "./dashboard";
import { provenanceLabel, recommendCompany } from "./recommendations";
import { mergeMarketSnapshot } from "./market";
import type { MarketSnapshot } from "./types";
import {
  addWatchEntry,
  normalizeSymbol,
  parseWatchlist,
  removeWatchEntry,
  serializeWatchlist,
  watchEntryToCompany,
  watchlistCompanies,
  type WatchEntry,
} from "./watchlist";

const entry = (over: Partial<WatchEntry> = {}): WatchEntry => ({
  name: "Tesla, Inc.",
  symbol: "TSLA",
  addedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("watch entry → company", () => {
  it("scores a fresh name with neutral, unbiased editorial axes", () => {
    const company = watchEntryToCompany(entry());
    expect(company.userAdded).toBe(true);
    // Every editorial axis sits at the neutral midpoint — no flattering guess.
    for (const axis of [
      company.aiExposure,
      company.growth,
      company.momentum,
      company.quality,
      company.valuationRisk,
      company.balanceSheetRisk,
      company.geopoliticalRisk,
    ]) {
      expect(axis).toBe(50);
    }
    expect(company.newsSignal.freshness).toBe("missing");
    expect(company.market).toBeUndefined();
  });

  it("produces a middling, clearly-provisional score (a 'watch', not a buy)", () => {
    const rec = recommendCompany(watchEntryToCompany(entry()), undefined, {});
    expect(rec.measured).toBe(false);
    expect(rec.action).toBe("watch");
    expect(rec.score).toBeGreaterThan(45);
    expect(rec.score).toBeLessThan(60);
  });

  it("uses the typed exchange so the broker tradability gate can apply", () => {
    expect(watchEntryToCompany(entry({ exchange: "Korea Exchange" })).exchange).toBe("Korea Exchange");
    expect(watchEntryToCompany(entry({ exchange: "  " })).exchange).toBe("Unknown");
    expect(watchEntryToCompany(entry()).exchange).toBe("Unknown");
  });

  it("still blocks an EIFO negative-list name the user types in", () => {
    const rec = recommendCompany(watchEntryToCompany(entry({ name: "Vestas Wind Systems", symbol: "VWS" })), undefined, {});
    expect(rec.compliance.status).toBe("blocked");
    expect(rec.action).toBe("avoid");
    expect(rec.score).toBe(0);
  });

  it("becomes price-backed (measured, not yet data-backed) once a refresh merges a price-only snapshot", () => {
    const company = watchEntryToCompany(entry());
    const snapshot: MarketSnapshot = {
      symbol: "TSLA",
      price: 250,
      currency: "USD",
      momentum: 82,
      asOf: "2026-01-02T00:00:00.000Z",
    };
    const enriched = mergeMarketSnapshot(company, { TSLA: snapshot });
    expect(enriched.userAdded).toBe(true); // metadata survives enrichment
    const rec = recommendCompany(enriched, undefined, {});
    expect(rec.measured).toBe(true);
    expect(rec.company.momentum).toBe(82);
    // A price snapshot alone is "price-backed", not "data-backed": fundamentals
    // are still editorial until they are fetched too.
    expect(provenanceLabel(rec)).toBe("price-backed");
  });
});

describe("add / remove", () => {
  it("adds a validated entry to the front of the list", () => {
    const result = addWatchEntry([], { name: "  Tesla  ", symbol: "tsla" }, "2026-01-01T00:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.list).toHaveLength(1);
    expect(result.entry.name).toBe("Tesla");
    expect(result.entry.symbol).toBe("TSLA");
  });

  it("rejects empty fields, duplicates, and names already in the universe", () => {
    expect(addWatchEntry([], { name: "", symbol: "X" }, "t")).toMatchObject({ ok: false, error: "missing_name" });
    expect(addWatchEntry([], { name: "X", symbol: "  " }, "t")).toMatchObject({ ok: false, error: "missing_symbol" });
    expect(addWatchEntry([entry()], { name: "Tesla again", symbol: "tsla" }, "t")).toMatchObject({
      ok: false,
      error: "duplicate",
    });
    expect(addWatchEntry([], { name: "NVIDIA", symbol: "NVDA" }, "t", new Set(["NVDA"]))).toMatchObject({
      ok: false,
      error: "in_universe",
    });
    // A symbol the user already holds is rejected up front, so it never becomes a
    // chip with no card (the dashboard drops opportunities you already own).
    expect(addWatchEntry([], { name: "Rheinmetall", symbol: "RHM" }, "t", new Set(), new Set(["RHM"]))).toMatchObject({
      ok: false,
      error: "owned",
    });
  });

  it("removes by symbol, case-insensitively", () => {
    expect(removeWatchEntry([entry()], "tsla")).toHaveLength(0);
    expect(removeWatchEntry([entry()], "AMD")).toHaveLength(1);
  });
});

describe("persistence", () => {
  it("round-trips through serialize/parse", () => {
    const list = [entry(), entry({ name: "ASML", symbol: "ASML.AS", exchange: "Euronext Amsterdam" })];
    expect(parseWatchlist(serializeWatchlist(list))).toEqual(list);
  });

  it("degrades gracefully on malformed or duplicate payloads", () => {
    expect(parseWatchlist(undefined)).toEqual([]);
    expect(parseWatchlist("not json")).toEqual([]);
    // Bad rows dropped; duplicate symbol collapses to the first.
    const raw = JSON.stringify({
      version: 1,
      entries: [{ name: "Tesla", symbol: "tsla" }, { symbol: "X" }, { name: "Dup", symbol: "TSLA" }],
    });
    const parsed = parseWatchlist(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "Tesla", symbol: "TSLA" });
  });
});

describe("dashboard integration", () => {
  it("surfaces a watch entry as an opportunity, scored by the same model", () => {
    const model = buildDashboardModel([], [], {}, watchlistCompanies([entry()]));
    const tsla = model.opportunities.find((rec) => rec.company.symbol === "TSLA");
    expect(tsla).toBeDefined();
    expect(tsla?.company.userAdded).toBe(true);
    expect(tsla?.company.themes).toContain("watchlist");
  });
});
