import { describe, expect, it } from "vitest";
import { researchLinks, tradingViewSymbol } from "./externalResearch";

describe("tradingViewSymbol", () => {
  it("maps a bare US ticker via its exchange label", () => {
    expect(tradingViewSymbol("NVDA", "NASDAQ")).toEqual({ prefix: "NASDAQ", ticker: "NVDA" });
    expect(tradingViewSymbol("TSM", "NYSE")).toEqual({ prefix: "NYSE", ticker: "TSM" });
  });

  it("maps a Yahoo suffix to its exchange, preferring it over the label", () => {
    // SK hynix — the owner's Korea Exchange example.
    expect(tradingViewSymbol("000660.KS", "Korea Exchange")).toEqual({ prefix: "KRX", ticker: "000660" });
    // Tencent on Hong Kong.
    expect(tradingViewSymbol("0700.HK", "Hong Kong")).toEqual({ prefix: "HKEX", ticker: "0700" });
  });

  it("maps a suffixed European listing to its exchange", () => {
    // A real Yahoo suffix pins the listing, so the chart matches the Yahoo page.
    expect(tradingViewSymbol("STMPA.PA", "Euronext Paris")).toEqual({ prefix: "EURONEXT", ticker: "STMPA" });
    expect(tradingViewSymbol("IFX.DE", "XETRA")).toEqual({ prefix: "XETR", ticker: "IFX" });
  });

  it("does NOT map a suffix-less ADR labelled with a foreign market", () => {
    // ASML is stored as the bare NASDAQ ADR symbol but labelled "Amsterdam".
    // Yahoo /quote/ASML is the ADR; a EURONEXT:ASML chart would be a different
    // security, so we emit no TradingView link rather than a mismatched one.
    expect(tradingViewSymbol("ASML", "Amsterdam")).toBeUndefined();
  });

  it("refuses to guess when the exchange is unknown", () => {
    expect(tradingViewSymbol("SPCX", "Private proxy")).toBeUndefined();
    expect(tradingViewSymbol("FOO", "Some Unlisted Venue")).toBeUndefined();
  });

  it("refuses a hyphenated share class rather than form a bad ticker", () => {
    // NOVO-B.CO: the suffix is known (Copenhagen) but the ticker isn't clean.
    expect(tradingViewSymbol("NOVO-B.CO", "Nasdaq Copenhagen")).toBeUndefined();
  });

  it("treats a non-market dot (share class) as part of the ticker and bails", () => {
    expect(tradingViewSymbol("BRK.B", "NYSE")).toBeUndefined();
  });

  it("returns undefined for an empty symbol", () => {
    expect(tradingViewSymbol("", "NASDAQ")).toBeUndefined();
  });
});

describe("researchLinks", () => {
  it("always offers a direct Yahoo link keyed on the canonical symbol", () => {
    const links = researchLinks({ symbol: "NVDA", exchange: "NASDAQ", name: "NVIDIA" });
    const yahoo = links.find((l) => l.provider === "yahoo");
    expect(yahoo?.href).toBe("https://finance.yahoo.com/quote/NVDA");
  });

  it("adds TradingView when a confident exchange:ticker can be formed", () => {
    const links = researchLinks({ symbol: "000660.KS", exchange: "Korea Exchange", name: "SK hynix" });
    expect(links.map((l) => l.provider)).toEqual(["yahoo", "tradingview"]);
    const tv = links.find((l) => l.provider === "tradingview");
    expect(tv?.href).toBe("https://www.tradingview.com/chart/?symbol=KRX%3A000660");
    // Yahoo still keys on the suffixed symbol, encoded.
    const yahoo = links.find((l) => l.provider === "yahoo");
    expect(yahoo?.href).toBe("https://finance.yahoo.com/quote/000660.KS");
  });

  it("omits TradingView but keeps Yahoo when the listing can't be mapped", () => {
    const links = researchLinks({ symbol: "NOVO-B.CO", exchange: "Nasdaq Copenhagen", name: "Novo Nordisk" });
    expect(links.map((l) => l.provider)).toEqual(["yahoo"]);
  });

  it("never points its two links at different securities (ASML ADR vs Amsterdam)", () => {
    // Regression guard: the Yahoo link is the NASDAQ ADR, so we must not also emit
    // a EURONEXT (Amsterdam) chart for the same name — Yahoo only.
    const links = researchLinks({ symbol: "ASML", exchange: "Amsterdam", name: "ASML Holding" });
    expect(links.map((l) => l.provider)).toEqual(["yahoo"]);
    expect(links[0].href).toBe("https://finance.yahoo.com/quote/ASML");
  });

  it("returns no links for a non-listed synthetic proxy", () => {
    expect(researchLinks({ symbol: "SPCX", exchange: "Private proxy", name: "SpaceX proxy" })).toEqual([]);
  });

  it("returns no links when there is no symbol", () => {
    expect(researchLinks({ symbol: "", exchange: "NASDAQ", name: "Mystery" })).toEqual([]);
  });
});
