import type { ComplianceOverrides } from "./compliance";
import { holdingIdentities, holdingProviderSymbol } from "./portfolio";
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
  watchlist: Company[] = [],
): DashboardModel {
  const companyBySymbol = new Map(universe.map((company) => [company.symbol, company]));
  // Every identity a holding can be recognised by — the bare ticker the broker
  // exports ("0700") and the provider form the universe keys foreign listings by
  // ("0700.HK") — so a curated name you already own is never also pitched back to
  // you as an idea. Suppressing both forms cannot hide an unrelated company: a
  // universe symbol equal to a holding's provider symbol is by construction the
  // same listing.
  const holdingSymbols = new Set(holdings.flatMap(holdingIdentities));

  // User-added watchlist names join the opportunity field, but never shadow a
  // curated name or one you already own: a watch entry whose symbol is already in
  // the universe or your portfolio is dropped so each name appears exactly once.
  const universeSymbols = new Set(universe.map((company) => company.symbol));
  const extraCompanies = watchlist.filter((company) => !universeSymbols.has(company.symbol));
  const field = [...universe, ...extraCompanies];

  const portfolio = rankRecommendations(
    holdings.map((holding) =>
      recommendCompany(companyForHolding(holding, companyBySymbol), holding, overrides),
    ),
  );

  const opportunities = rankRecommendations(
    field
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

// Resolve a holding to its curated universe entry. Bare ticker FIRST, provider
// form SECOND.
//
// The provider form is purely a SECOND CHANCE for the suffixed entries (0700.HK,
// 005930.KS, 000660.KS, 2513.HK) that a bare-only lookup silently dropped onto
// the neutral placeholder below — losing both the curated profile and the
// momentum the refresh had already measured under that key.
//
// Bare-first is the deliberately weaker precondition rather than a requirement:
// no universe entry is keyed under both forms today, so either order resolves the
// same entry (the universe keys ASML by its bare primary ticker, and an
// ASML:xams holding would still reach it through the fallback). Trying the bare
// ticker first means anything that resolves today resolves to the identical entry
// regardless of what the universe is keyed by tomorrow.
//
// The resolved entry keeps the HOLDING's symbol, because that symbol is the
// app-wide selection and render key (App.tsx seeds selectedSymbol from
// holdings[0].symbol, and the persisted change baseline is keyed by it). That
// costs no measured data: App.tsx merges the market and signal snapshots onto the
// universe entry under its own key BEFORE buildDashboardModel runs, so the
// snapshot rides along in the spread. It does mean company.symbol ("0700") and
// company.market.symbol ("0700.HK") can differ on an owned foreign name —
// anything that re-merges snapshots must do it on the universe entry, never on
// this copy.
function companyForHolding(holding: Holding, companyBySymbol: Map<string, Company>): Company {
  const provider = holdingProviderSymbol(holding);
  const entry =
    companyBySymbol.get(holding.symbol) ?? (provider ? companyBySymbol.get(provider) : undefined);
  if (!entry) return companyFromHolding(holding);
  // Same object, not a copy, when the two forms already agree: every US holding
  // takes this branch, so its behaviour is unchanged down to referential identity.
  return entry.symbol === holding.symbol ? entry : { ...entry, symbol: holding.symbol };
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
