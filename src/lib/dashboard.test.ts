import { describe, expect, it } from "vitest";
import { universe } from "../data/universe";
import { buildDashboardModel } from "./dashboard";
import { mergeMarketSnapshot } from "./market";
import { holdingIdentities, parsePortfolioCsv } from "./portfolio";
import type { Company, MarketSnapshot } from "./types";

// Synthetic broker rows (not real positions). Only the columns `toHolding` reads,
// so the tests exercise the real producer of `symbol`/`providerSymbol` rather than
// a hand-built Holding — the two-identity split is exactly what is under test.
const HEADER =
  '﻿"Instrument","Valuta","Antal","Aktuel kurs","Markedsværdi (DKK)","Symbol","ISIN","Udsteder","Aktivtype"\n';

type Row = { name: string; symbol: string; isin: string; currency: string };

function book(...rows: Row[]): string {
  return (
    HEADER +
    rows
      .map(
        (row) =>
          `"${row.name}","${row.currency}","10","100.00","10000.00","${row.symbol}","${row.isin}","Demo","Aktie"`,
      )
      .join("\n")
  );
}

// The broker's own instrument strings, which differ from the curated names on
// purpose — that difference is how these tests tell a resolved entry from the
// placeholder built out of the broker row.
const TENCENT = { name: "Tencent Holdings Ltd.", symbol: "0700:xhkg", isin: "KY0000000001", currency: "HKD" };
const SAMSUNG = { name: "Samsung Elec Co Ltd", symbol: "005930:xkrx", isin: "KR0000000001", currency: "KRW" };
const NVIDIA = { name: "NVIDIA Corp.", symbol: "NVDA:xnas", isin: "US0000000001", currency: "USD" };
const ASML = { name: "ASML Holding N.V.", symbol: "ASML:xams", isin: "NL0000000001", currency: "EUR" };
// Deliberately a name with NO curated counterpart under either identity. Note the
// universe carries US ADRs (BABA, TSM) whose foreign lines (9988.HK, 2330.TW) are a
// DIFFERENT symbol entirely — matching those is a cross-listing/ISIN problem this
// join does not attempt, so an ADR ticker would make a misleading fixture here.
const UNSEEDED = { name: "Demo Foreign A/S", symbol: "9999:xhkg", isin: "KY0000000002", currency: "HKD" };

function holdingsOf(...rows: Row[]) {
  return parsePortfolioCsv(book(...rows)).holdings;
}

/** Mirrors App.tsx: snapshots are merged onto the universe BEFORE the model builds. */
function enriched(snapshots: Record<string, MarketSnapshot>): Company[] {
  return universe.map((company) => mergeMarketSnapshot(company, snapshots));
}

function snapshot(symbol: string, over: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    symbol,
    price: 400,
    currency: "HKD",
    momentum: 71,
    asOf: "2026-07-26T00:00:00.000Z",
    ...over,
  };
}

describe("buildDashboardModel — holdings-to-universe join", () => {
  it("matches an owned foreign listing to its curated universe entry", () => {
    const model = buildDashboardModel(holdingsOf(TENCENT), universe);

    expect(model.portfolio).toHaveLength(1);
    const [tencent] = model.portfolio;
    expect(tencent.company.name).toBe("Tencent Holdings");
    expect(tencent.company.region).toBe("China");
    expect(tencent.company.exchange).toBe("Hong Kong");
    expect(tencent.company.themes).toContain("china-ai");
    // The neutral placeholder profile must NOT be what it landed on.
    expect(tencent.company.newsSignal.summary).not.toMatch(/No seeded company profile/);
  });

  it("keeps the measured momentum of an owned foreign listing", () => {
    const model = buildDashboardModel(
      holdingsOf(TENCENT),
      enriched({ "0700.HK": snapshot("0700.HK", { momentum: 71 }) }),
    );

    const [tencent] = model.portfolio;
    // The refresh measured this under the provider key; the join must not discard it.
    expect(tencent.company.momentum).toBe(71);
    expect(tencent.company.market?.symbol).toBe("0700.HK");
    expect(tencent.measured).toBe(true);
  });

  it("keeps the holding's own symbol as the app-wide key", () => {
    const model = buildDashboardModel(holdingsOf(TENCENT), universe);

    // App.tsx seeds selectedSymbol from holdings[0].symbol and the persisted change
    // baseline is keyed by company.symbol; the resolved entry must not move that key.
    expect(model.portfolio[0].company.symbol).toBe("0700");
    expect(model.portfolio[0].holding?.symbol).toBe("0700");
    expect(model.portfolio[0].holding?.rawSymbol).toBe("0700:xhkg");
  });

  it("does not re-pitch a foreign listing you already own", () => {
    const model = buildDashboardModel(holdingsOf(TENCENT), universe);

    expect(model.opportunities.map((rec) => rec.company.symbol)).not.toContain("0700.HK");
    expect(model.opportunities.map((rec) => rec.company.name)).not.toContain("Tencent Holdings");
    expect(model.opportunities).toHaveLength(universe.length - 1);
  });

  it("suppresses a watch entry the user already holds under its provider form", () => {
    // The bundled picker offers the Nordic/European names by their provider form
    // ("VWS.CO"), so a holder of VWS:xcse can add one. The dashboard drops it as
    // already-owned — which is only honest because addToWatchlist now rejects it
    // up front (see the ownedIdentities guard in App.tsx); otherwise the user gets
    // a persisted chip that silently shows no card.
    const vestas = { name: "Vestas Wind Systems", symbol: "VWS:xcse", isin: "DK0000000001", currency: "DKK" };
    const watchEntry: Company = {
      ...universe[0],
      name: "Vestas Wind Systems",
      symbol: "VWS.CO",
      themes: ["watchlist"],
    };

    const model = buildDashboardModel(holdingsOf(vestas), universe, {}, [watchEntry]);

    expect(model.opportunities.map((rec) => rec.company.symbol)).not.toContain("VWS.CO");
    expect(holdingIdentities(holdingsOf(vestas)[0])).toEqual(["VWS", "VWS.CO"]);
  });

  it("keeps owned and opportunity names disjoint across a mixed book", () => {
    const model = buildDashboardModel(holdingsOf(NVIDIA, TENCENT, SAMSUNG), universe);

    // Three owned names removed from the field, not one. Pins the count directly:
    // a bare-only join leaves the two foreign entries in, giving universe.length - 1.
    expect(model.opportunities).toHaveLength(universe.length - 3);

    const ownedNames = model.portfolio.map((rec) => rec.company.name);
    const oppNames = model.opportunities.map((rec) => rec.company.name);

    // The name-level invariant is the one that catches this defect class without
    // anyone having to know that exchange suffixes exist.
    for (const name of ownedNames) expect(oppNames).not.toContain(name);
    expect(new Set(model.all.map((rec) => rec.company.name)).size).toBe(model.all.length);
  });

  it("still matches a US holding on its bare ticker, by reference", () => {
    const field = enriched({});
    const model = buildDashboardModel(holdingsOf(NVIDIA), field);

    // Referential identity, not just equality: an unconditional copy here would
    // churn every downstream useMemo for the case that was never broken.
    expect(model.portfolio[0].company).toBe(field.find((company) => company.symbol === "NVDA"));
  });

  it("still resolves an Amsterdam listing to the universe's bare ASML entry", () => {
    const field = enriched({});
    const model = buildDashboardModel(holdingsOf(ASML), field);

    // The universe keys ASML by its bare primary ticker, so a join that looked up
    // ONLY the provider form ("ASML.AS") would drop it to the placeholder. (A
    // provider-FIRST order would still find it through the bare fallback; this
    // pins the outcome, not the order.)
    expect(model.portfolio[0].company.symbol).toBe("ASML");
    expect(model.portfolio[0].company.name).toBe("ASML Holding");
    expect(model.portfolio[0].company.exchange).toBe("Amsterdam");
    expect(model.portfolio[0].company).toBe(field.find((company) => company.symbol === "ASML"));
  });

  it("still falls back to a neutral, unmeasured placeholder for an unseeded holding", () => {
    const model = buildDashboardModel(holdingsOf(UNSEEDED), universe);

    const [rec] = model.portfolio;
    expect(rec.company.name).toBe("Demo Foreign A/S");
    expect(rec.company.symbol).toBe("9999");
    expect(rec.company.newsSignal.summary).toMatch(/No seeded company profile/);
    // The second-chance lookup is not a licence to claim data we do not have.
    expect(rec.measured).toBe(false);
  });

  it("resolves a holding whose stored providerSymbol is missing", () => {
    const [holding] = holdingsOf(TENCENT);
    // storage.ts validates only `symbol` and `marketValueDkk`, so a truncated
    // payload can arrive without the field; the key is derived, not trusted.
    const model = buildDashboardModel([{ ...holding, providerSymbol: "" }], universe);

    expect(model.portfolio[0].company.name).toBe("Tencent Holdings");
    expect(model.portfolio[0].company.symbol).toBe("0700");
    expect(model.opportunities.map((rec) => rec.company.symbol)).not.toContain("0700.HK");
  });
});
