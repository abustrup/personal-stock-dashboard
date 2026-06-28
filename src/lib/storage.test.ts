import { describe, expect, it } from "vitest";
import { parseStoredPortfolio, serializePortfolio } from "./storage";
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
