import { describe, expect, it } from "vitest";
import { universe } from "./universe";
import { seedHoldings } from "./portfolioSeed";
import { complianceOverrides } from "./complianceOverrides";
import { buildDashboardModel } from "../lib/dashboard";
import { DEFAULT_BROKER_SETTINGS, assessInvestability, isInvestable } from "../lib/investability";

const chinese = universe.filter((company) => company.region === "China");

/**
 * The China sleeve is a deliberate, owner-requested slice of the universe: ten
 * Chinese names picked to mirror the exposures this book already owns. These
 * tests pin the properties that make the sleeve useful rather than decorative —
 * that all ten actually reach the opportunities list, that they're on markets
 * the broker can trade, and that none of them quietly claims measured data it
 * hasn't got. They deliberately do NOT assert the model's scores or actions:
 * those must be free to move with the data.
 */
describe("China sleeve", () => {
  it("carries exactly the ten requested Chinese names", () => {
    expect(chinese.map((company) => company.symbol).sort()).toEqual(
      [
        "0100.HK", // MiniMax — multimodal foundation models
        "0700.HK", // Tencent
        "0981.HK", // SMIC — domestic foundry
        "1211.HK", // BYD — EV / autonomy
        "1810.HK", // Xiaomi — devices + EV
        "2513.HK", // Knowledge Atlas (Zhipu) — enterprise foundation models
        "6082.HK", // Biren — GPGPU
        "9660.HK", // Horizon Robotics — ADAS silicon
        "9888.HK", // Baidu — AI platform + robotaxi
        "BABA", // Alibaba
      ].sort(),
    );
  });

  it("surfaces every Chinese name as an opportunity for the demo book", () => {
    const model = buildDashboardModel(seedHoldings, universe, complianceOverrides);
    const opportunities = new Set(model.opportunities.map((rec) => rec.company.symbol));
    for (const company of chinese) {
      expect(opportunities.has(company.symbol)).toBe(true);
    }
  });

  it("keeps the sleeve to markets the broker can actually trade", () => {
    // An idea you can't buy is noise, so the sleeve is Hong Kong / US lines only
    // — no Shanghai or Shenzhen boards, which the default settings can't reach.
    for (const company of chinese) {
      const investability = assessInvestability(company, DEFAULT_BROKER_SETTINGS);
      expect(investability.tradable).toBe(true);
      expect(isInvestable(investability)).toBe(true);
    }
  });

  it("labels the whole sleeve as editorial until a refresh measures it", () => {
    for (const company of chinese) {
      expect(company.market).toBeUndefined();
      expect(company.newsSignal.freshness).toBe("seed");
      expect(company.expertSignal.freshness).toBe("seed");
    }
  });

  it("prices the shared China risk into every name in the sleeve", () => {
    // US export controls, Entity List exposure and mainland policy are the
    // non-diversifiable risk of owning any of these — the model must not read
    // any of them as a low-geopolitical-risk name.
    for (const company of chinese) {
      expect(company.geopoliticalRisk).toBeGreaterThanOrEqual(60);
    }
  });
});

describe("universe", () => {
  it("lists every symbol exactly once", () => {
    const symbols = universe.map((company) => company.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("keeps every editorial axis on the 0-100 scale", () => {
    for (const company of universe) {
      const axes = {
        aiExposure: company.aiExposure,
        growth: company.growth,
        momentum: company.momentum,
        quality: company.quality,
        valuationRisk: company.valuationRisk,
        balanceSheetRisk: company.balanceSheetRisk,
        geopoliticalRisk: company.geopoliticalRisk,
      };
      for (const [axis, value] of Object.entries(axes)) {
        expect(`${company.symbol} ${axis}: ${value}`).toBe(
          `${company.symbol} ${axis}: ${Math.min(100, Math.max(0, value))}`,
        );
      }
    }
  });
});
