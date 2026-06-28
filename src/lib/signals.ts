import type { Company, ExpertSignal, NewsSignal } from "./types";

export type ProviderEnvironment = Record<string, string | undefined>;

export type ExternalSignalSnapshot = Record<
  string,
  {
    newsSignal?: NewsSignal;
    expertSignal?: ExpertSignal;
  }
>;

export function getConfiguredProviders(env: ProviderEnvironment): string[] {
  return [
    env.ALPHAVANTAGE_API_KEY ? "Alpha Vantage News Sentiment" : undefined,
    env.FMP_API_KEY ? "Financial Modeling Prep" : undefined,
    env.FINNHUB_API_KEY ? "Finnhub Recommendation Trends" : undefined,
  ].filter((provider): provider is string => Boolean(provider));
}

export function mergeExternalSignals<T extends Pick<Company, "symbol" | "newsSignal" | "expertSignal">>(
  company: T,
  snapshot: ExternalSignalSnapshot,
): T {
  const signal = snapshot[company.symbol];
  if (!signal) return company;

  return {
    ...company,
    newsSignal: signal.newsSignal ?? company.newsSignal,
    expertSignal: signal.expertSignal ?? company.expertSignal,
  };
}

export function dataFreshness(newsSignal: NewsSignal, expertSignal: ExpertSignal): string {
  const parts = [
    `${newsSignal.freshness} news`,
    `${expertSignal.freshness} expert signal`,
  ];
  return parts.join(" / ");
}
