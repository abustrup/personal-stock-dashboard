// Refresh local market data for the dashboard.
//
// Default source is keyless Yahoo Finance (prices, 52-week range, history) so
// the dashboard works with no API keys. News sentiment (Alpha Vantage) and
// analyst trends (Finnhub) are optional and only run when keys are present.
//
// Writes public/data/live-signals.json, which the browser reads at load time.
// Requires Node 22.6+ (the TS import below relies on native type stripping).

import fs from "node:fs/promises";
import path from "node:path";
import { deriveMarketMetrics } from "../src/lib/market.ts";
import { universe } from "../src/data/universe.ts";

const cliSymbols = process.argv.slice(2);
const symbols = cliSymbols.length > 0 ? cliSymbols : universe.map((company) => company.symbol);
const outputPath = path.resolve("public/data/live-signals.json");

const apiKeys = {
  alphaVantage: process.env.ALPHAVANTAGE_API_KEY,
  finnhub: process.env.FINNHUB_API_KEY,
};

const market = {};
const signals = {};
const sources = ["Yahoo Finance (keyless prices)"];
if (apiKeys.alphaVantage) sources.push("Alpha Vantage News Sentiment");
if (apiKeys.finnhub) sources.push("Finnhub Recommendation Trends");

let priced = 0;
for (const symbol of symbols) {
  const snapshot = await fetchYahooMarket(symbol);
  if (snapshot) {
    market[symbol] = snapshot;
    priced += 1;
  }

  const entry = {};
  if (apiKeys.alphaVantage) entry.newsSignal = await fetchAlphaVantageNews(symbol, apiKeys.alphaVantage);
  if (apiKeys.finnhub) entry.expertSignal = await fetchFinnhubRecommendation(symbol, apiKeys.finnhub);
  if (Object.keys(entry).length > 0) signals[symbol] = entry;

  await sleep(120); // be polite to the public endpoints
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), sources, market, signals }, null, 2)}\n`,
);

console.log(`Wrote ${outputPath} — priced ${priced}/${symbols.length} symbols via Yahoo.`);
if (priced < symbols.length) {
  const missing = symbols.filter((s) => !market[s]);
  console.log(`No price for: ${missing.join(", ")} (private/unlisted or provider gap — confidence lowered, not blocked).`);
}

async function fetchYahooMarket(symbol) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "1y");
  url.searchParams.set("interval", "1d");

  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return undefined;
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((v) => Number.isFinite(v));
    if (!meta || typeof meta.regularMarketPrice !== "number" || closes.length === 0) return undefined;

    const price = meta.regularMarketPrice;
    const metrics = deriveMarketMetrics({
      price,
      closes,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    });

    return {
      symbol,
      price,
      currency: meta.currency ?? "",
      previousClose: meta.chartPreviousClose,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      ...metrics,
      asOf: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

async function fetchAlphaVantageNews(symbol, apiKey) {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "NEWS_SENTIMENT");
  url.searchParams.set("tickers", symbol);
  url.searchParams.set("apikey", apiKey);

  try {
    const response = await fetch(url);
    const data = await response.json();
    const feed = Array.isArray(data.feed) ? data.feed.slice(0, 8) : [];
    const tickerSentiments = feed.flatMap((item) => item.ticker_sentiment ?? []);
    const relevant = tickerSentiments.filter((item) => item.ticker === symbol);
    const avg =
      relevant.reduce((sum, item) => sum + Number(item.ticker_sentiment_score ?? 0), 0) /
      Math.max(1, relevant.length);
    const sentiment = Math.max(0, Math.min(100, Math.round(50 + avg * 50)));

    return {
      sentiment,
      direction: sentiment > 57 ? "positive" : sentiment < 43 ? "negative" : "neutral",
      summary: feed[0]?.title ?? "No recent Alpha Vantage headline returned.",
      freshness: "live",
      sources: ["Alpha Vantage News Sentiment"],
    };
  } catch (error) {
    return {
      sentiment: 50,
      direction: "neutral",
      summary: `Alpha Vantage fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      freshness: "missing",
      sources: ["Alpha Vantage News Sentiment"],
    };
  }
}

async function fetchFinnhubRecommendation(symbol, apiKey) {
  const url = new URL("https://finnhub.io/api/v1/stock/recommendation");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", apiKey);

  try {
    const response = await fetch(url);
    const data = await response.json();
    const latest = Array.isArray(data) ? data[0] : undefined;
    const positive = Number(latest?.strongBuy ?? 0) + Number(latest?.buy ?? 0);
    const negative = Number(latest?.sell ?? 0) + Number(latest?.strongSell ?? 0);
    const direction = positive > negative ? "positive" : negative > positive ? "negative" : "neutral";

    return {
      direction,
      summary: latest
        ? `${positive} buy or strong-buy ratings versus ${negative} sell or strong-sell ratings.`
        : "No Finnhub recommendation trend returned.",
      freshness: "live",
      sources: ["Finnhub Recommendation Trends"],
    };
  } catch (error) {
    return {
      direction: "neutral",
      summary: `Finnhub fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      freshness: "missing",
      sources: ["Finnhub Recommendation Trends"],
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
