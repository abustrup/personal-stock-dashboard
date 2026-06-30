import type { Company } from "./types";

/**
 * Where to go DEEPER on a name — the full external chart, news and financials the
 * dashboard deliberately doesn't try to re-render. The product's value is the
 * verdict (the model score, EIFO status, your buy plan); these links are the
 * "now go read the whole story" exit, and they matter most for the names your
 * broker hides entirely: Saxo Investor can't even show you SK hynix (Korea
 * Exchange), but a deep-dive link can take you straight to its chart.
 *
 * Design rule: NEVER render a link we aren't confident is correct.
 *  - Yahoo Finance keys off the SAME canonical Yahoo symbol the app already uses
 *    for live data (`0700.HK`, `000660.KS`, `NVDA`), so `/quote/{symbol}` is a
 *    direct, reliable hit for every name the dashboard can price.
 *  - TradingView needs an `EXCHANGE:TICKER` pair. We only emit it when we can map
 *    the listing to a TradingView exchange prefix AND the ticker is clean
 *    (alphanumeric). When we can't (an unknown market, a hyphenated share class
 *    like `NOVO-B`), we omit the TradingView link rather than guess at a URL that
 *    might 404 — Yahoo alone is better than a broken second link.
 *
 * Pure and keyless: no network, no API key, no new dependency — just string
 * construction over identity the app already holds.
 */

export type ResearchProvider = "yahoo" | "tradingview";

export type ResearchLink = {
  provider: ResearchProvider;
  /** Button label, e.g. "Yahoo Finance". */
  label: string;
  /** One-line of what the reader will find there. */
  detail: string;
  /** Fully-formed external URL. */
  href: string;
};

// A Yahoo ticker suffix -> the TradingView exchange prefix for the same listing.
// Keyed on the suffix because it's a stronger signal than the editorial exchange
// string: `000660.KS` is unambiguously the Korea Exchange regardless of how the
// listing label is spelled. Only listings we can name with confidence appear here.
const SUFFIX_TO_TRADINGVIEW: Record<string, string> = {
  HK: "HKEX",
  KS: "KRX",
  KQ: "KOSDAQ",
  TW: "TWSE",
  TWO: "TPEX",
  AS: "EURONEXT",
  PA: "EURONEXT",
  BR: "EURONEXT",
  LS: "EURONEXT",
  DE: "XETR",
  CO: "OMXCOP",
  ST: "OMXSTO",
  HE: "OMXHEX",
  OL: "OSL",
  L: "LSE",
  SW: "SIX",
  TO: "TSX",
};

// Fallback for a symbol that carries NO Yahoo market suffix. By Yahoo's convention
// a suffix-less ticker is a US listing (non-US listings always carry a suffix like
// `.AS` or `.KS`), and the bare `/quote/{ticker}` page resolves to that US line —
// so the only safe TradingView prefix here is the matching US exchange. We
// deliberately do NOT map non-US labels: a bare ticker stored against a foreign
// market (e.g. ASML, the NASDAQ ADR, labelled "Amsterdam") would otherwise get a
// EURONEXT chart for a DIFFERENT security than the Yahoo ADR link. Those names get
// Yahoo only. Non-US listings with a real suffix are handled by SUFFIX_TO_TRADINGVIEW.
const EXCHANGE_TO_TRADINGVIEW: Record<string, string> = {
  NASDAQ: "NASDAQ",
  NYSE: "NYSE",
};

// Exchanges that aren't a real, chartable listing — a synthetic proxy has no
// external page to send the reader to, so we emit no links at all rather than a
// dead one.
const NON_LISTED_EXCHANGES = new Set(["Private proxy"]);

/**
 * Resolve a confident TradingView `EXCHANGE:TICKER`, or undefined when we can't.
 * The suffix decides both the exchange and where the ticker ends; an unknown
 * suffix is treated as part of the ticker (e.g. a `.B` share class), which then
 * fails the clean-ticker guard and yields undefined — exactly the "don't guess"
 * behaviour we want.
 */
export function tradingViewSymbol(
  symbol: string,
  exchange: string,
): { prefix: string; ticker: string } | undefined {
  if (!symbol) return undefined;
  const dot = symbol.lastIndexOf(".");
  const suffix = dot >= 0 ? symbol.slice(dot + 1).toUpperCase() : "";
  const knownPrefix = SUFFIX_TO_TRADINGVIEW[suffix];
  // Strip the suffix only when it's a market we recognise; otherwise keep the
  // whole symbol as the ticker (so a non-market dot fails the guard below).
  const ticker = (knownPrefix && dot >= 0 ? symbol.slice(0, dot) : symbol).toUpperCase();
  const prefix = knownPrefix ?? EXCHANGE_TO_TRADINGVIEW[exchange];
  if (!prefix) return undefined;
  if (!/^[A-Z0-9]+$/.test(ticker)) return undefined;
  return { prefix, ticker };
}

/**
 * The external research links for one company, in priority order. Yahoo Finance is
 * always present for a real listing (it keys on the canonical symbol); TradingView
 * is appended only when a confident `EXCHANGE:TICKER` can be formed. Returns an
 * empty list for a name with no symbol or a non-listed proxy — nothing to link to.
 */
export function researchLinks(company: Pick<Company, "symbol" | "exchange" | "name">): ResearchLink[] {
  const symbol = company.symbol?.trim();
  if (!symbol || NON_LISTED_EXCHANGES.has(company.exchange)) return [];

  const links: ResearchLink[] = [
    {
      provider: "yahoo",
      label: "Yahoo Finance",
      detail: "Full chart, news & financials",
      href: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    },
  ];

  const tv = tradingViewSymbol(symbol, company.exchange);
  if (tv) {
    links.push({
      provider: "tradingview",
      label: "TradingView",
      detail: "Interactive chart & technicals",
      href: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`${tv.prefix}:${tv.ticker}`)}`,
    });
  }

  return links;
}
