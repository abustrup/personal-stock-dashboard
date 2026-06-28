import { describe, expect, it } from "vitest";
import { parsePortfolioCsv, providerSymbol } from "./portfolio";

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
});
