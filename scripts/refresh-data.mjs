// Refresh local market data for the dashboard.
//
// Default source is keyless Yahoo Finance (prices, 52-week range, history) so
// the dashboard works with no API keys. News sentiment (Alpha Vantage) and
// analyst trends (Finnhub) are optional and only run when keys are present.
//
// Writes public/data/live-signals.json, which the browser reads at load time.
// Requires Node 22.18+ (the .ts imports below rely on unflagged type stripping).

import fs from "node:fs/promises";
import path from "node:path";
import { clamp, deriveFundamentalAxes, deriveMarketMetrics } from "../src/lib/market.ts";
import { universe } from "../src/data/universe.ts";

const UA = "Mozilla/5.0";

const cliSymbols = process.argv.slice(2);
// Skip non-listed names (e.g. assetType "private" like SpaceX): their broker
// proxy symbol can collide with an unrelated public ticker on Yahoo and be
// mispriced. Such names keep their editorial momentum and stay unpriced.
const symbols =
  cliSymbols.length > 0
    ? cliSymbols
    : universe.filter((company) => company.assetType !== "private").map((company) => company.symbol);
const outputPath = path.resolve("public/data/live-signals.json");

const apiKeys = {
  alphaVantage: process.env.ALPHAVANTAGE_API_KEY,
  finnhub: process.env.FINNHUB_API_KEY,
};

const market = {};
const signals = {};
const sources = ["Yahoo Finance (keyless prices)"];

// A crumb/cookie session unlocks the keyless fundamentals endpoint.
const session = await getYahooSession();
if (session) sources.push("Yahoo fundamentals (valuation/growth/quality/balance-sheet)");
if (apiKeys.alphaVantage) sources.push("Alpha Vantage News Sentiment");
if (apiKeys.finnhub) sources.push("Finnhub Recommendation Trends");

let priced = 0;
let withFundamentals = 0;
for (const symbol of symbols) {
  const snapshot = await fetchYahooMarket(symbol);
  if (snapshot) {
    const fundamentals = await fetchYahooFundamentals(symbol, session);
    if (fundamentals) {
      snapshot.fundamentals = fundamentals;
      withFundamentals += 1;
    }
    market[symbol] = snapshot;
    priced += 1;
  }

  const entry = {};
  if (apiKeys.alphaVantage) entry.newsSignal = await fetchAlphaVantageNews(symbol, apiKeys.alphaVantage);
  if (apiKeys.finnhub) entry.expertSignal = await fetchFinnhubRecommendation(symbol, apiKeys.finnhub);
  if (Object.keys(entry).length > 0) signals[symbol] = entry;

  await sleep(120); // be polite to the public endpoints
}

// A run that priced nothing means a systemic provider outage (rate-limit, DNS,
// Yahoo schema change), not "the market is empty". Writing the hollow result
// would clobber the last good snapshot with {} and silently drop the dashboard
// to editorial-only data. Preserve the prior file and fail loudly instead.
if (priced === 0) {
  console.error(
    `Refresh aborted: priced 0/${symbols.length} symbols (likely provider outage). ` +
      `Preserving existing ${outputPath} rather than overwriting it with empty data.`,
  );
  process.exit(1);
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), sources, market, signals }, null, 2)}\n`,
);

console.log(
  `Wrote ${outputPath} — priced ${priced}/${symbols.length} symbols via Yahoo, fundamentals for ${withFundamentals}.`,
);
if (!session) console.log("Fundamentals skipped (no Yahoo crumb session) — growth/quality/valuation stay editorial.");
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
    if (!response.ok) {
      console.warn(`Yahoo price fetch for ${symbol} returned HTTP ${response.status}.`);
      return undefined;
    }
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((v) => Number.isFinite(v));
    if (!meta || typeof meta.regularMarketPrice !== "number" || closes.length === 0) return undefined;

    const price = meta.regularMarketPrice;
    // Only trust strictly-positive 52-week bounds (providers sometimes return 0).
    const high = meta.fiftyTwoWeekHigh > 0 ? meta.fiftyTwoWeekHigh : undefined;
    const low = meta.fiftyTwoWeekLow > 0 ? meta.fiftyTwoWeekLow : undefined;
    const metrics = deriveMarketMetrics({ price, closes, fiftyTwoWeekHigh: high, fiftyTwoWeekLow: low });

    // meta.chartPreviousClose is the close *before the requested range* (a year
    // ago here), not yesterday. Use the prior daily close from the same series.
    const previousClose = closes.length >= 2 ? closes[closes.length - 2] : undefined;
    const dayChangePct =
      previousClose && previousClose > 0 ? Math.round((price / previousClose - 1) * 10000) / 100 : undefined;

    return {
      symbol,
      price,
      currency: meta.currency ?? "",
      previousClose,
      dayChangePct,
      fiftyTwoWeekHigh: high,
      fiftyTwoWeekLow: low,
      ...metrics,
      asOf: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(`Yahoo price fetch for ${symbol} failed: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

// Yahoo's fundamentals endpoint needs a cookie + crumb. Retry the handshake a
// few times and log why it failed, so a CI run shows when fundamentals are off.
async function getYahooSession() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
      const setCookies = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
      const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
      const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
        headers: { "User-Agent": UA, Cookie: cookie },
      });
      const crumb = (await cr.text()).trim();
      if (crumb && !crumb.includes("<") && crumb.length <= 40) return { cookie, crumb };
      console.log(`Yahoo crumb attempt ${attempt} rejected (HTTP ${cr.status}).`);
    } catch (error) {
      console.log(`Yahoo crumb attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
    }
    await sleep(400 * attempt);
  }
  return undefined;
}

async function fetchYahooFundamentals(symbol, session) {
  if (!session) return undefined;
  const url = new URL(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`);
  url.searchParams.set("modules", "financialData,defaultKeyStatistics,summaryDetail");

  try {
    // One re-auth if the crumb expired mid-run.
    let r;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      url.searchParams.set("crumb", session.crumb);
      r = await fetch(url, { headers: { "User-Agent": UA, Cookie: session.cookie } });
      if (r.status !== 401 || attempt === 1) break;
      const fresh = await getYahooSession();
      if (!fresh) return undefined;
      session.cookie = fresh.cookie;
      session.crumb = fresh.crumb;
    }
    if (!r.ok) return undefined;
    const data = await r.json();
    const res = data?.quoteSummary?.result?.[0];
    if (!res) return undefined;
    const fd = res.financialData ?? {};
    const ks = res.defaultKeyStatistics ?? {};
    const sd = res.summaryDetail ?? {};
    const raw = (x) => (x && typeof x.raw === "number" ? x.raw : undefined);

    // Balance-sheet figures are in the company's financialCurrency; market cap is
    // in the quote currency. For ADRs/foreign listings these differ, so only feed
    // the net-cash path when they match (otherwise the model uses debtToEquity,
    // which is unit-agnostic).
    const currenciesMatch = !fd.financialCurrency || !sd.currency || fd.financialCurrency === sd.currency;

    const inputs = {
      trailingPE: raw(sd.trailingPE),
      forwardPE: raw(sd.forwardPE) ?? raw(ks.forwardPE),
      priceToSales: raw(sd.priceToSalesTrailing12Months) ?? raw(ks.priceToSalesTrailing12Months),
      revenueGrowth: raw(fd.revenueGrowth),
      earningsGrowth: raw(fd.earningsGrowth),
      profitMargins: raw(fd.profitMargins) ?? raw(ks.profitMargins),
      returnOnEquity: raw(fd.returnOnEquity),
      debtToEquity: raw(fd.debtToEquity),
      currentRatio: raw(fd.currentRatio),
      totalCash: currenciesMatch ? raw(fd.totalCash) : undefined,
      totalDebt: currenciesMatch ? raw(fd.totalDebt) : undefined,
      marketCap: currenciesMatch ? raw(sd.marketCap) : undefined,
    };
    // Need at least one real signal to be worth attaching.
    const hasSignal = [inputs.revenueGrowth, inputs.profitMargins, inputs.trailingPE, inputs.forwardPE].some(
      (v) => typeof v === "number",
    );
    if (!hasSignal) return undefined;

    return {
      trailingPE: inputs.trailingPE,
      forwardPE: inputs.forwardPE,
      priceToSales: inputs.priceToSales,
      revenueGrowth: inputs.revenueGrowth,
      profitMargins: inputs.profitMargins,
      returnOnEquity: inputs.returnOnEquity,
      debtToEquity: inputs.debtToEquity,
      currentRatio: inputs.currentRatio,
      marketCap: inputs.marketCap,
      ...deriveFundamentalAxes(inputs),
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
    const sentiment = clamp(Math.round(50 + avg * 50));

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
