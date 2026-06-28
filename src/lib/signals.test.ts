import { describe, expect, it } from "vitest";
import { getConfiguredProviders, mergeExternalSignals } from "./signals";

describe("signals", () => {
  it("does not require API keys for the dashboard to run", () => {
    const providers = getConfiguredProviders({});

    expect(providers).toEqual([]);
  });

  it("merges live news and expert signals when a provider snapshot exists", () => {
    const company = {
      name: "Apple Inc.",
      symbol: "AAPL",
      newsSignal: {
        sentiment: 50,
        direction: "neutral" as const,
        summary: "Seed news.",
        freshness: "seed" as const,
        sources: ["seed"],
      },
      expertSignal: {
        direction: "neutral" as const,
        summary: "Seed expert signal.",
        freshness: "seed" as const,
        sources: ["seed"],
      },
    };

    const merged = mergeExternalSignals(company, {
      AAPL: {
        newsSignal: {
          sentiment: 68,
          direction: "positive",
          summary: "Live headlines improved.",
          freshness: "live",
          sources: ["Alpha Vantage"],
        },
        expertSignal: {
          direction: "positive",
          summary: "Recommendation trend improved.",
          freshness: "live",
          sources: ["Finnhub"],
        },
      },
    });

    expect(merged.newsSignal.summary).toContain("Live");
    expect(merged.expertSignal.sources).toContain("Finnhub");
  });
});
