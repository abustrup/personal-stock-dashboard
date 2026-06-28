import type { ComplianceOverrides } from "./compliance";
import { recommendCompany, rankRecommendations } from "./recommendations";
import type { Company, Holding, Recommendation } from "./types";

export type DashboardModel = {
  portfolio: Recommendation[];
  opportunities: Recommendation[];
  all: Recommendation[];
  totalMarketValueDkk: number;
  totalCostBasisDkk: number;
  totalGainDkk: number;
  totalReturnPct: number;
  dayGainDkk: number;
  topIdea?: Recommendation;
  highestRisk?: Recommendation;
};

export function buildDashboardModel(
  holdings: Holding[],
  universe: Company[],
  overrides: ComplianceOverrides = {},
): DashboardModel {
  const companyBySymbol = new Map(universe.map((company) => [company.symbol, company]));
  const holdingSymbols = new Set(holdings.map((holding) => holding.symbol));

  const portfolio = rankRecommendations(
    holdings.map((holding) =>
      recommendCompany(companyBySymbol.get(holding.symbol) ?? companyFromHolding(holding), holding, overrides),
    ),
  );

  const opportunities = rankRecommendations(
    universe
      .filter((company) => !holdingSymbols.has(company.symbol))
      .map((company) => recommendCompany(company, undefined, overrides)),
  );

  const all = rankRecommendations([...portfolio, ...opportunities]);

  const totalMarketValueDkk = sum(holdings, (h) => h.marketValueDkk);
  const totalCostBasisDkk = sum(holdings, (h) => h.costBasisDkk ?? 0);
  const totalGainDkk = sum(holdings, (h) => h.totalGainDkk ?? 0);
  const dayGainDkk = sum(holdings, (h) => h.dayGainDkk ?? 0);

  return {
    portfolio,
    opportunities,
    all,
    totalMarketValueDkk,
    totalCostBasisDkk,
    totalGainDkk,
    totalReturnPct: totalCostBasisDkk > 0 ? (totalGainDkk / totalCostBasisDkk) * 100 : 0,
    dayGainDkk,
    topIdea: all.find((item) => item.action !== "avoid"),
    highestRisk: [...all].sort((a, b) => riskScore(b) - riskScore(a))[0],
  };
}

function sum(holdings: Holding[], pick: (holding: Holding) => number): number {
  return holdings.reduce((total, holding) => total + pick(holding), 0);
}

function companyFromHolding(holding: Holding): Company {
  return {
    name: holding.instrument,
    symbol: holding.symbol,
    isin: holding.isin,
    region: "Unknown",
    exchange: holding.exchangeCode?.toUpperCase() ?? "Unknown",
    assetType: holding.assetType,
    themes: ["portfolio-import"],
    aiExposure: 45,
    growth: 50,
    momentum: 50,
    quality: 50,
    valuationRisk: 50,
    balanceSheetRisk: 35,
    geopoliticalRisk: 35,
    newsSignal: {
      sentiment: 50,
      direction: "neutral",
      summary: "No seeded company profile. Add to the curated universe for better scoring.",
      freshness: "missing",
      sources: [],
    },
    expertSignal: {
      direction: "neutral",
      summary: "No expert signal coverage.",
      freshness: "missing",
      sources: [],
    },
  };
}

function riskScore(recommendation: Recommendation): number {
  return (
    recommendation.company.valuationRisk +
    recommendation.company.balanceSheetRisk +
    recommendation.company.geopoliticalRisk +
    (recommendation.compliance.status === "blocked" ? 100 : 0)
  );
}
