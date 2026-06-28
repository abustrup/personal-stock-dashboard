export type AssetType = "stock" | "etf" | "private" | "unknown";

export type SignalDirection = "positive" | "neutral" | "negative";
export type Freshness = "live" | "cached" | "seed" | "missing";

export type NewsSignal = {
  sentiment: number;
  direction: SignalDirection;
  summary: string;
  freshness: Freshness;
  sources: string[];
};

export type ExpertSignal = {
  direction: SignalDirection;
  summary: string;
  freshness: Freshness;
  sources: string[];
};

export type Holding = {
  instrument: string;
  rawSymbol: string;
  symbol: string;
  exchangeCode?: string;
  providerSymbol: string;
  isin: string;
  issuer: string;
  assetType: AssetType;
  currency: string;
  quantity: number;
  currentPrice: number;
  costPrice?: number;
  openingPrice?: number;
  marketValueDkk: number;
  /** Cost basis in DKK (broker "Oprindelig værdi (DKK)"), FX already applied. */
  costBasisDkk?: number;
  /** Total unrealised gain/loss in DKK, FX already applied. */
  totalGainDkk?: number;
  /** Total return as a percent number, e.g. -3.55 means -3.55%. */
  totalReturnPct?: number;
  /** One-day return as a percent number, e.g. 0.85 means +0.85%. */
  dayReturnPct?: number;
  /** One-day gain/loss in DKK. */
  dayGainDkk?: number;
  /** Share of total portfolio as a percent number, e.g. 11.79 means 11.79%. */
  portfolioWeight: number;
  lastUpdated?: string;
};

/** Real, measured price data from a market provider (currently keyless Yahoo). */
export type MarketSnapshot = {
  symbol: string;
  price: number;
  currency: string;
  previousClose?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  /** Trailing returns as percent numbers, e.g. 12.4 means +12.4%. */
  return1m?: number;
  return3m?: number;
  return6m?: number;
  /** Position within the 52-week range, 0 (at low) to 1 (at high). */
  rangePosition?: number;
  /** Momentum 0-100 derived from price action (not an editorial estimate). */
  momentum: number;
  asOf: string;
};

export type Company = {
  name: string;
  symbol: string;
  isin?: string;
  region: string;
  exchange: string;
  assetType: AssetType;
  themes: string[];
  aiExposure: number;
  growth: number;
  /** Editorial estimate 0-100; replaced by measured momentum when a market snapshot exists. */
  momentum: number;
  quality: number;
  valuationRisk: number;
  balanceSheetRisk: number;
  geopoliticalRisk: number;
  newsSignal: NewsSignal;
  expertSignal: ExpertSignal;
  /** Live price metrics when a refresh has run; absent means editorial-only. */
  market?: MarketSnapshot;
};

export type ComplianceStatus = "blocked" | "restricted" | "possible_overlap" | "unknown";

export type ComplianceResult = {
  status: ComplianceStatus;
  flags: string[];
  /** Standing policy reminders (e.g. the §9.2 six-month hold) for tradeable-but-restricted names. */
  notes?: string[];
  source: string;
};

export type RecommendationAction =
  | "increase"
  | "hold"
  | "trim"
  | "investigate"
  | "watch"
  | "avoid";

export type Recommendation = {
  company: Company;
  holding?: Holding;
  action: RecommendationAction;
  conviction: "high" | "medium" | "low";
  /** True when backed by measured market data or live signals (not editorial-only). */
  measured: boolean;
  score: number;
  reasoning: string[];
  downside: string;
  compliance: ComplianceResult;
  newsSignal: NewsSignal;
  expertSignal: ExpertSignal;
  freshness: string;
};
