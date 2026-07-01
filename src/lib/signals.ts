import type { Company, ExpertSignal, NewsSignal } from "./types";

export type ExternalSignalSnapshot = Record<
  string,
  {
    newsSignal?: NewsSignal;
    expertSignal?: ExpertSignal;
  }
>;

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
