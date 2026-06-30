import { describe, expect, it } from "vitest";
import {
  parseStoredPortfolio,
  parseStoredSnapshot,
  serializePortfolio,
  serializeSnapshot,
} from "./storage";
import type { ModelSnapshot } from "./changes";
import type { Holding } from "./types";

const holding = (symbol: string): Holding => ({
  instrument: symbol,
  rawSymbol: `${symbol}:xnas`,
  symbol,
  providerSymbol: symbol,
  isin: "US0000000000",
  issuer: symbol,
  assetType: "stock",
  currency: "USD",
  quantity: 1,
  currentPrice: 100,
  marketValueDkk: 690,
  portfolioWeight: 50,
});

describe("portfolio storage", () => {
  it("round-trips an imported portfolio", () => {
    const json = serializePortfolio([holding("AAA"), holding("BBB")], "My import", "2026-06-28T00:00:00.000Z");
    const parsed = parseStoredPortfolio(json);

    expect(parsed?.holdings).toHaveLength(2);
    expect(parsed?.holdings[0].symbol).toBe("AAA");
    expect(parsed?.label).toBe("My import");
    expect(parsed?.importedAt).toBe("2026-06-28T00:00:00.000Z");
  });

  it("rejects empty, corrupt, or wrong-version payloads", () => {
    expect(parseStoredPortfolio(null)).toBeUndefined();
    expect(parseStoredPortfolio("not json")).toBeUndefined();
    expect(parseStoredPortfolio(JSON.stringify({ version: 1, holdings: [] }))).toBeUndefined();
    expect(parseStoredPortfolio(JSON.stringify({ version: 2, holdings: [holding("AAA")] }))).toBeUndefined();
    expect(parseStoredPortfolio(JSON.stringify({ version: 1, holdings: [{ symbol: "X" }] }))).toBeUndefined();
  });
});

describe("change-baseline storage", () => {
  const snapshot: ModelSnapshot = {
    asOf: "2026-06-30T06:00:00.000Z",
    entries: {
      AAA: { action: "increase", score: 80, momentum: 70, price: 120, owned: true },
      BBB: { action: "watch", score: 55, owned: false },
    },
  };

  it("round-trips a model snapshot", () => {
    const parsed = parseStoredSnapshot(serializeSnapshot(snapshot));
    expect(parsed).toEqual(snapshot);
  });

  it("rejects empty, corrupt, or wrong-version payloads", () => {
    expect(parseStoredSnapshot(null)).toBeUndefined();
    expect(parseStoredSnapshot("not json")).toBeUndefined();
    expect(parseStoredSnapshot(JSON.stringify({ version: 2, asOf: "x", entries: {} }))).toBeUndefined();
    expect(parseStoredSnapshot(JSON.stringify({ version: 1, entries: {} }))).toBeUndefined();
    expect(parseStoredSnapshot(JSON.stringify({ version: 1, asOf: "x" }))).toBeUndefined();
  });
});
