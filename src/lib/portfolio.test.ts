import { describe, expect, it } from "vitest";
import {
  holdingIdentities,
  holdingProviderSymbol,
  parseDanishNumber,
  parsePortfolioCsv,
  providerSymbol,
} from "./portfolio";
import type { Holding } from "./types";

// Synthetic fixture (not real positions). Exercises the BOM, the skipped broker
// summary row, comma decimals, weight-as-fraction and the P&L columns.
const csv =
  '﻿"Instrument","L/K","Valuta","Antal","Aktuel kurs","% Total afkast","% 1D afk.","Gevinst/Tab i alt (DKK)","Oprindelig værdi (DKK)","Markedsværdi (DKK)","Symbol","% af portefølje","ISIN","Udsteder","Aktivtype","1-dags gevinst/tab (DKK)","Senest opdateret"\n' +
  '"Aktier (2)","","","","","","","","","-1153.27","","0.73","","","","",""\n' +
  '"Demo Alpha A/S ","Lang","USD","2","100.00","-10,00%","1,00%","-20.00","220.00","200.00","ALPH:xnas","0.30","US0000000001","DemoAlpha","Aktie","2.00","20:13:28"\n' +
  '"Demo Beta A/S ","Lang","USD","3","50,00","5,00%","-0,50%","7.50","142.50","150.00","BETA:xnas","0.20","US0000000002","DemoBeta","Aktie","-0.75","20:13:28"';

describe("parsePortfolioCsv", () => {
  it("skips broker group rows and normalizes Danish broker fields", () => {
    const result = parsePortfolioCsv(csv);

    expect(result.holdings).toHaveLength(2);
    expect(result.holdings[0]).toMatchObject({
      instrument: "Demo Alpha A/S",
      rawSymbol: "ALPH:xnas",
      symbol: "ALPH",
      exchangeCode: "xnas",
      isin: "US0000000001",
      quantity: 2,
      marketValueDkk: 200.0,
    });
    expect(result.holdings[1].currentPrice).toBe(50.0);
    expect(result.totalMarketValueDkk).toBeCloseTo(350.0);
  });

  it("captures real P&L fields and normalizes weight to percent units", () => {
    const [alpha] = parsePortfolioCsv(csv).holdings;

    expect(alpha.totalReturnPct).toBeCloseTo(-10.0);
    expect(alpha.dayReturnPct).toBeCloseTo(1.0);
    expect(alpha.totalGainDkk).toBeCloseTo(-20.0);
    expect(alpha.dayGainDkk).toBeCloseTo(2.0);
    expect(alpha.costBasisDkk).toBeCloseTo(220.0);
    // Source stores 0.30 as a fraction; we surface it as 30%.
    expect(alpha.portfolioWeight).toBeCloseTo(30.0, 1);
  });

  it("maps broker symbols into provider lookup symbols", () => {
    expect(providerSymbol("GOOGL:xnas")).toBe("GOOGL");
    expect(providerSymbol("VWS:xcse")).toBe("VWS.CO");
    // These two feed the suffixed universe entries, so the dashboard join relies
    // on them (see dashboard.test.ts).
    expect(providerSymbol("0700:xhkg")).toBe("0700.HK");
    expect(providerSymbol("005930:xkrx")).toBe("005930.KS");
  });

  it("lists both identities a holding answers to", () => {
    const [alpha] = parsePortfolioCsv(csv).holdings;
    // A US listing has one identity: the suffix is empty, so both forms collapse.
    expect(holdingIdentities(alpha)).toEqual(["ALPH"]);

    const foreign = parsePortfolioCsv(
      '﻿"Instrument","Antal","Aktuel kurs","Markedsværdi (DKK)","Symbol","ISIN"\n' +
        '"Demo Foreign A/S","1","10","100.00","0700:xhkg","KY0000000001"',
    ).holdings[0];
    expect(holdingIdentities(foreign)).toEqual(["0700", "0700.HK"]);
  });

  it("derives the provider symbol rather than trusting an untrusted stored field", () => {
    const [alpha] = parsePortfolioCsv(csv).holdings;

    // storage.ts validates only `symbol` and `marketValueDkk`, so a stale or edited
    // `providerSymbol` must NOT be able to point a holding at another company.
    expect(holdingProviderSymbol({ ...alpha, providerSymbol: "NVDA" })).toBe("ALPH");
    // Honoured when there is nothing to derive from, so an older payload still works.
    expect(holdingProviderSymbol({ ...alpha, rawSymbol: "", providerSymbol: "ALPH" })).toBe("ALPH");
    // Never throws on a payload whose fields aren't even strings.
    const junk = { ...alpha, rawSymbol: undefined, providerSymbol: undefined } as unknown as Holding;
    expect(holdingProviderSymbol(junk)).toBe("");
  });

  it("does not let one unparseable cell poison the portfolio total", () => {
    const bad =
      '﻿"Instrument","Antal","Aktuel kurs","Markedsværdi (DKK)","Symbol","ISIN"\n' +
      '"Good A/S","1","10","100.00","GOOD:xnas","US0000000001"\n' +
      '"Bad A/S","1","10","n/a","BAD:xnas","US0000000002"';
    const result = parsePortfolioCsv(bad);

    expect(result.holdings).toHaveLength(2);
    expect(Number.isFinite(result.totalMarketValueDkk)).toBe(true);
    expect(result.totalMarketValueDkk).toBeCloseTo(100.0);
    // Missing weight column → 0, never NaN.
    expect(result.holdings[0].portfolioWeight).toBe(0);
  });
});

describe("parseDanishNumber", () => {
  it("handles the broker's ungrouped dot-decimal and comma-decimal forms", () => {
    expect(parseDanishNumber("24150.00")).toBeCloseTo(24150);
    expect(parseDanishNumber("16,67%")).toBeCloseTo(16.67);
    expect(parseDanishNumber("50,00")).toBeCloseTo(50);
  });

  it("handles grouped Danish numbers without producing NaN or 1000x errors", () => {
    expect(parseDanishNumber("1.234.567,89")).toBeCloseTo(1234567.89);
    expect(parseDanishNumber("1.250,00")).toBeCloseTo(1250);
  });

  it("returns NaN for empty input", () => {
    expect(Number.isNaN(parseDanishNumber(""))).toBe(true);
  });
});
