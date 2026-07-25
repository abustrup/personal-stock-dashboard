import { describe, expect, it } from "vitest";
import { parseDanishNumber, parsePortfolioCsv, providerSymbol } from "./portfolio";
import { parseStoredPortfolio, serializePortfolio } from "./storage";

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
    // The row itself must agree with the total, which already counts it as 0.
    // A NaN here would render "DKK NaN" on every screen that shows the position.
    expect(result.holdings[1].marketValueDkk).toBe(0);
  });

  // The stored-payload half of the same defect, and the more damaging one: NaN
  // has no JSON representation, so serializePortfolio writes it as null and
  // parseStoredPortfolio's number check then rejects the ENTIRE payload — the
  // reader's real import is silently swapped for the demo book on the next
  // visit. Guarding the field at parse time is what keeps the payload loadable.
  it("keeps the saved import loadable when one market-value cell is unparseable", () => {
    // A dash, where the test above uses "n/a" — both are sentinels this broker
    // writes for a cell it has no number for, and both parse to NaN.
    const bad =
      '﻿"Instrument","Antal","Aktuel kurs","Markedsværdi (DKK)","Symbol","ISIN"\n' +
      '"Good A/S","1","10","100.00","GOOD:xnas","US0000000001"\n' +
      '"Bad A/S","1","10","-","BAD:xnas","US0000000002"';
    const { holdings } = parsePortfolioCsv(bad);

    const raw = serializePortfolio(holdings, "bad.csv", "2026-07-25T10:00:00.000Z");
    // It survives the round trip precisely because the field is guarded at parse
    // time; an unguarded NaN would sit here as null.
    expect(JSON.parse(raw).holdings[1].marketValueDkk).toBe(0);

    const restored = parseStoredPortfolio(raw);
    expect(restored?.holdings).toHaveLength(2);
    expect(restored?.holdings[0].marketValueDkk).toBeCloseTo(100.0);

    // And the counterfactual, so the line above can't quietly stop meaning
    // anything: a null in that slot still costs the reader the WHOLE payload —
    // the good holding included — which is what makes the parse-time guard the
    // thing keeping the import alive.
    const withNull = raw.replace('"marketValueDkk":0', '"marketValueDkk":null');
    expect(withNull).not.toBe(raw);
    expect(parseStoredPortfolio(withNull)).toBeUndefined();
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
