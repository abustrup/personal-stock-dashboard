import { describe, expect, it } from "vitest";
import { collectRefreshSymbols } from "./refreshSymbols";
import { COMPANY_DIRECTORY } from "./companyDirectory";
import { universe } from "../data/universe";

describe("collectRefreshSymbols", () => {
  it("prices every non-private universe name", () => {
    const symbols = collectRefreshSymbols(universe, []);
    for (const company of universe) {
      if (company.assetType === "private") continue;
      expect(symbols).toContain(company.symbol);
    }
  });

  it("skips private/unlisted names whose proxy ticker can be mispriced", () => {
    const fixture = [
      { symbol: "NVDA", assetType: "stock" },
      { symbol: "SPCX", assetType: "private" },
    ];
    const symbols = collectRefreshSymbols(fixture, []);
    expect(symbols).toContain("NVDA");
    expect(symbols).not.toContain("SPCX");
  });

  it("now also prices every name the watchlist picker can add", () => {
    const symbols = collectRefreshSymbols(universe, COMPANY_DIRECTORY);
    for (const entry of COMPANY_DIRECTORY) {
      expect(symbols).toContain(entry.symbol);
    }
  });

  it("fetches a symbol once even if it appears in both sets", () => {
    const fixture = [{ symbol: "ORCL", assetType: "stock" }];
    const directory = [{ symbol: "ORCL" }, { symbol: "SAP.DE" }];
    const symbols = collectRefreshSymbols(fixture, directory);
    expect(symbols.filter((s) => s === "ORCL")).toHaveLength(1);
    expect(symbols).toContain("SAP.DE");
  });

  it("keeps a stable order — universe first, then directory", () => {
    const fixture = [
      { symbol: "NVDA", assetType: "stock" },
      { symbol: "MSFT", assetType: "stock" },
    ];
    const directory = [{ symbol: "ORCL" }, { symbol: "CRM" }];
    expect(collectRefreshSymbols(fixture, directory)).toEqual(["NVDA", "MSFT", "ORCL", "CRM"]);
  });

  it("drops empty or whitespace-only symbols defensively and trims the rest", () => {
    const fixture = [
      { symbol: "NVDA", assetType: "stock" },
      { symbol: "", assetType: "stock" },
      { symbol: "   ", assetType: "stock" },
    ];
    const directory = [{ symbol: " ORCL " }];
    expect(collectRefreshSymbols(fixture, directory)).toEqual(["NVDA", "ORCL"]);
  });
});
