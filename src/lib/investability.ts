import type { Company, Recommendation } from "./types";

/**
 * Can you actually act on an idea — through YOUR broker, within YOUR sizing? Two
 * practical gates a broker dashboard never applies to its own "top movers":
 *
 *  1. Tradability — some markets simply aren't on your platform. Saxo Investor
 *     does not offer the Korea Exchange, so a Korean listing (e.g. SK hynix) is
 *     un-buyable no matter how good the score.
 *  2. Affordability — you buy whole shares, so the floor for any position is one
 *     share. If one share costs more than your typical per-trade budget, the name
 *     is effectively out of reach (e.g. ASML near 1,800 USD ≈ 12,000 DKK a share,
 *     against a ~5,000 DKK position size on a ~40,000 DKK book).
 *
 * Both gates are USER-DECLARED settings (which markets, what budget), so this is
 * decision support tuned to one person's account — not a claim about the market.
 */
export type BrokerSettings = {
  /** A typical position size in DKK — the floor a single share must fit inside. */
  perTradeBudgetDkk: number;
  /** Exchanges the broker can't trade, matched exactly against `Company.exchange`. */
  untradableExchanges: string[];
};

/**
 * Defaults tuned to the owner's account: a ~5,000 DKK per-trade budget (about a
 * tenth of a ~40,000 DKK book) and the Korea Exchange marked off-platform, the
 * one market the owner has confirmed Saxo Investor doesn't offer. Everything else
 * starts tradable; the user adds markets as they discover them.
 */
export const DEFAULT_BROKER_SETTINGS: BrokerSettings = {
  perTradeBudgetDkk: 5000,
  untradableExchanges: ["Korea Exchange"],
};

/**
 * Approximate FX rates to DKK, used ONLY to size a foreign share price against a
 * DKK budget. These are editorial round numbers (DKK is euro-pegged near 7.46),
 * not a live quote — the affordability check only needs the right order of
 * magnitude, and the UI labels the conversion as approximate. They never touch
 * measured P&L or the model score.
 */
export const FX_TO_DKK: Record<string, number> = {
  DKK: 1,
  EUR: 7.46,
  USD: 6.9,
  GBP: 8.7,
  CHF: 7.8,
  SEK: 0.65,
  NOK: 0.62,
  HKD: 0.88,
  KRW: 0.005,
  JPY: 0.044,
  TWD: 0.21,
  CNY: 0.95,
  SGD: 5.1,
  CAD: 5.0,
  AUD: 4.5,
};

/** Approximate value of one unit of `currency` in DKK, or undefined if unknown. */
export function fxToDkk(currency: string | undefined): number | undefined {
  if (!currency) return undefined;
  return FX_TO_DKK[currency.toUpperCase()];
}

/**
 * Editorial placeholders and non-answers that name no real public venue, so the
 * broker gate can't map them to a platform and the market toggle must not list
 * them: private/pre-IPO proxies, unknown imports, and the add-form's "not sure"
 * default. Matched case-insensitively after trimming.
 */
const NON_VENUES = new Set(["private proxy", "unknown", "not sure", ""]);

/**
 * The same physical venue is spelled more than one way across the data sources: the
 * curated universe labels ASML's listing "Amsterdam" while the add-a-company
 * directory labels Besi's "Euronext Amsterdam" — both are the one Euronext Amsterdam
 * market. The tradability gate matches the listing exchange as a free-form string, so
 * without a canonical form the user would have to mark BOTH spellings off-platform to
 * block the single market, the broker toggle would show two chips for it, and a name
 * could slip the gate purely because its label didn't match the one the user toggled
 * (e.g. marking "Euronext Amsterdam" untradable would silently leave ASML, labelled
 * "Amsterdam", buyable). Keyed by the lower-cased spelling; the value is the one
 * canonical label all spellings fold onto.
 */
const EXCHANGE_ALIASES: Record<string, string> = {
  amsterdam: "Euronext Amsterdam",
  "euronext amsterdam": "Euronext Amsterdam",
};

/**
 * Fold a listing exchange onto a single canonical label so a venue is gated, listed
 * and counted under one identity however its source happens to spell it. Unknown
 * exchanges pass through unchanged (only trimmed) — the default is to trust the data,
 * never to invent a mapping for a venue we don't have an explicit alias for.
 */
export function canonicalExchange(exchange: string): string {
  const trimmed = (exchange ?? "").trim();
  return EXCHANGE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Whether a listing exchange is on the broker's untradable list, compared by canonical
 * identity rather than raw string. Both the company's exchange and every stored setting
 * are canonicalised before comparing, so "Amsterdam" and "Euronext Amsterdam" gate as
 * one market — and a setting stored under either spelling keeps working. The gate, the
 * broker toggle and the add-a-company picker all route through this so the three agree.
 */
export function isExchangeUntradable(exchange: string, settings: BrokerSettings): boolean {
  const canon = canonicalExchange(exchange);
  return settings.untradableExchanges.some((listed) => canonicalExchange(listed) === canon);
}

/**
 * The set of markets the broker tradability gate can actually be applied to — the
 * options the "Markets your broker can trade" toggle offers. The gate keys on a
 * free-form `Company.exchange` string, so this must be sourced from EVERY exchange
 * a name on screen could carry, not just the curated universe: the curated names,
 * the bundled add-a-company directory (long-tail listings the picker can add, e.g.
 * Oslo Børs / XETRA / Nasdaq Copenhagen), whatever the user has already watched,
 * and any market already marked off-platform (so a stored setting always keeps a
 * toggle to switch it back on). Without the directory and watched listings, a
 * hand-added Nordic or German name had no toggle at all — the gate stayed blind to
 * a market the broker genuinely may not trade. Editorial non-venues are dropped; every
 * spelling is folded onto its canonical label so one physical venue shows a single chip
 * (not a separate "Amsterdam" and "Euronext Amsterdam"); the result is de-duplicated and
 * sorted for a stable control order.
 */
export function collectKnownMarkets(exchanges: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const raw of exchanges) {
    const trimmed = (raw ?? "").trim();
    if (trimmed && !NON_VENUES.has(trimmed.toLowerCase())) set.add(canonicalExchange(trimmed));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export type InvestabilityStatus = "ok" | "not_tradable" | "above_budget" | "unknown";

export type Investability = {
  /** The dominant verdict, in precedence order: platform, then budget, then price-known. */
  status: InvestabilityStatus;
  /** False when the listing's exchange is on the broker's untradable list. */
  tradable: boolean;
  /** True/false once a share price is known; undefined when it can't be sized yet. */
  affordable?: boolean;
  /** Approximate cost of one share in DKK — the minimum to open a position. */
  sharePriceDkk?: number;
  /** The per-trade budget this was measured against. */
  budgetDkk: number;
  /** The listing exchange the tradability gate keyed on. */
  exchange: string;
  /** True when `sharePriceDkk` relied on an approximate FX conversion (not DKK-native). */
  fxApprox: boolean;
  /** Short badge text for an off-limits name (undefined when fully investable). */
  reason?: string;
  /** One-line, plain-language explanation for tooltips and the detail view. */
  note: string;
};

const DKK = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * Assess one company against the broker settings. Pure and synchronous: tradability
 * is a string-set check on the exchange; affordability converts the measured share
 * price to DKK (approximately, for non-DKK currencies) and compares it to the
 * budget. When no price is loaded yet, affordability is left unknown rather than
 * guessed — the honest default, so an un-refreshed name is never wrongly hidden.
 */
export function assessInvestability(company: Company, settings: BrokerSettings): Investability {
  const exchange = company.exchange;
  const budgetDkk = settings.perTradeBudgetDkk;
  const tradable = !isExchangeUntradable(exchange, settings);

  const market = company.market;
  const fx = market ? fxToDkk(market.currency) : undefined;
  const sharePriceDkk =
    market && market.price > 0 && fx !== undefined ? market.price * fx : undefined;
  // True only when an actual non-DKK conversion produced the share price — never
  // for a DKK-native price, nor for a currency with no FX entry (which can't be sized).
  const fxApprox = sharePriceDkk !== undefined && market!.currency?.toUpperCase() !== "DKK";
  const affordable = sharePriceDkk === undefined ? undefined : sharePriceDkk <= budgetDkk;

  if (!tradable) {
    return {
      status: "not_tradable",
      tradable: false,
      affordable,
      sharePriceDkk,
      budgetDkk,
      exchange,
      fxApprox,
      reason: "Off Saxo",
      note: `${exchange} isn't tradable on your broker — the model still scores it, but you can't buy it here.`,
    };
  }

  if (affordable === false) {
    return {
      status: "above_budget",
      tradable: true,
      affordable: false,
      sharePriceDkk,
      budgetDkk,
      exchange,
      fxApprox,
      reason: "1 share > budget",
      note: `One share ≈ DKK ${DKK.format(sharePriceDkk!)}${fxApprox ? " (approx)" : ""} — above your DKK ${DKK.format(budgetDkk)} per-trade budget. A single share already overshoots your sizing.`,
    };
  }

  if (affordable === true) {
    return {
      status: "ok",
      tradable: true,
      affordable: true,
      sharePriceDkk,
      budgetDkk,
      exchange,
      fxApprox,
      note: `One share ≈ DKK ${DKK.format(sharePriceDkk!)}${fxApprox ? " (approx)" : ""} — fits inside your DKK ${DKK.format(budgetDkk)} per-trade budget.`,
    };
  }

  return {
    status: "unknown",
    tradable: true,
    affordable: undefined,
    sharePriceDkk: undefined,
    budgetDkk,
    exchange,
    fxApprox: false,
    note: `On a tradable market, but no live price yet — run a refresh to size one share against your DKK ${DKK.format(budgetDkk)} budget.`,
  };
}

/**
 * Whether an idea clears both gates well enough to act on: it must be on a
 * tradable market and not be a name a single share already overshoots the budget
 * for. An unknown (un-priced) name counts as still-investable — absence of a price
 * is not proof it's unaffordable, so it isn't penalised.
 */
export function isInvestable(inv: Investability): boolean {
  return inv.status === "ok" || inv.status === "unknown";
}

export type InvestabilitySummary = {
  total: number;
  /** Ideas you can act on now (tradable and not over budget). */
  investable: number;
  /** Ideas blocked because the market isn't on your broker. */
  offPlatform: number;
  /** Ideas where a single share already exceeds your per-trade budget. */
  aboveBudget: number;
  /** The best (first, since input is pre-ranked) investable idea, if any. */
  topInvestable?: Recommendation;
};

/**
 * Roll up a pre-ranked list of recommendations into the investability counts the
 * front-page card and the opportunities summary read from. Expects the input
 * already ranked (best first) so `topInvestable` is the best actionable idea.
 */
export function summarizeInvestability(
  recommendations: Recommendation[],
  settings: BrokerSettings,
): InvestabilitySummary {
  let investable = 0;
  let offPlatform = 0;
  let aboveBudget = 0;
  let topInvestable: Recommendation | undefined;

  for (const rec of recommendations) {
    const inv = assessInvestability(rec.company, settings);
    if (inv.status === "not_tradable") offPlatform += 1;
    else if (inv.status === "above_budget") aboveBudget += 1;
    else {
      investable += 1;
      if (!topInvestable && rec.action !== "avoid") topInvestable = rec;
    }
  }

  return { total: recommendations.length, investable, offPlatform, aboveBudget, topInvestable };
}

/** The symbols that clear both gates — handed to the opportunities overview so the
 *  standout idea is always one you can actually act on. */
export function investableSymbols(
  recommendations: Recommendation[],
  settings: BrokerSettings,
): Set<string> {
  const set = new Set<string>();
  for (const rec of recommendations) {
    if (isInvestable(assessInvestability(rec.company, settings))) set.add(rec.company.symbol);
  }
  return set;
}

/** One off-limits name, with the approximate one-share cost when it's over budget. */
export type ReachName = {
  symbol: string;
  name: string;
  /** Approximate cost of one share in DKK — present for over-budget names. */
  sharePriceDkk?: number;
  /** True when `sharePriceDkk` relied on an approximate (non-DKK) FX conversion. */
  fxApprox: boolean;
};

/** Off-broker names grouped by the exchange that puts them out of reach. */
export type ReachExchangeGroup = { exchange: string; names: ReachName[] };

/**
 * The named breakdown behind the investability counts: not just *how many* ideas
 * are out of reach, but *which* ones and why. `summarizeInvestability` owns the
 * counts; this names the blocked stocks so the overview can say "Korea Exchange —
 * SK hynix, Samsung" and "over budget — ASML, 1 share ≈ DKK 12,500" instead of a
 * bare number. Both read the same `assessInvestability`, with the same precedence
 * (platform gate before budget gate), so the names always reconcile with the counts.
 */
export type ReachBreakdown = {
  /** Off-broker names grouped by exchange; the exchange blocking the most names first. */
  offPlatform: ReachExchangeGroup[];
  /** Over-budget names, the costliest (highest one-share DKK price) first. */
  aboveBudget: ReachName[];
};

/**
 * Build the named off-limits breakdown for a set of opportunities. An idea blocked
 * on the platform gate is listed under its exchange (never also under budget, even
 * when a single share would also overshoot — the platform gate decides, exactly as
 * `assessInvestability` resolves it). Investable and un-priced ideas are omitted —
 * this is only the names you can't act on. Ordering is deterministic so the panel
 * renders the same way every time: groups by descending block count then exchange
 * name; over-budget by descending share price then name.
 */
export function reachBreakdown(
  recommendations: Recommendation[],
  settings: BrokerSettings,
): ReachBreakdown {
  const byExchange = new Map<string, ReachName[]>();
  const aboveBudget: ReachName[] = [];

  for (const rec of recommendations) {
    const inv = assessInvestability(rec.company, settings);
    const entry: ReachName = {
      symbol: rec.company.symbol,
      name: rec.company.name,
      sharePriceDkk: inv.sharePriceDkk,
      fxApprox: inv.fxApprox,
    };
    if (inv.status === "not_tradable") {
      // Group under the canonical venue so two spellings of one market (ASML's
      // "Amsterdam", Besi's "Euronext Amsterdam") share a single off-platform group.
      const venue = canonicalExchange(inv.exchange);
      const list = byExchange.get(venue) ?? [];
      list.push(entry);
      byExchange.set(venue, list);
    } else if (inv.status === "above_budget") {
      aboveBudget.push(entry);
    }
  }

  const offPlatform: ReachExchangeGroup[] = [...byExchange.entries()]
    .map(([exchange, names]) => ({
      exchange,
      names: [...names].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.names.length - a.names.length || a.exchange.localeCompare(b.exchange));

  aboveBudget.sort(
    (a, b) => (b.sharePriceDkk ?? 0) - (a.sharePriceDkk ?? 0) || a.name.localeCompare(b.name),
  );

  return { offPlatform, aboveBudget };
}

/** One named idea at its model score. */
export type ReachGapName = {
  symbol: string;
  name: string;
  /** The model's 0–100 score — an editorial read, not a measured market figure. */
  score: number;
};

/**
 * What the broker + budget gates cost in the model's own conviction. `reachBreakdown`
 * already names *which* ideas are out of reach; this measures *how good the idea you're
 * losing is* — the field's single highest-scored idea against the highest-scored one
 * that actually clears both gates. The `gap` is the conviction, in score points, the
 * constraints keep off the table: a synthesis a broker dashboard (which only ever shows
 * names you can already trade) can't draw.
 *
 * Honesty boundary: `score` is the model's editorial 0–100 read, never a measured market
 * figure, and the gates are user-declared settings — so this is the cost of *one person's*
 * account constraints, not a market claim.
 *
 * Returns `undefined` when there is nothing to report: no real ideas, the field's best idea
 * is itself within reach, or an equally-scored idea is buyable (then the gate blocks access
 * but costs no conviction). When the best idea IS out of reach, the struct is returned even if *nothing* clears the gates
 * (`topInvestable` undefined) — that "everything good is unreachable" state is the most
 * important one to surface. Pure and order-independent (scans for the max rather than
 * trusting input order); `avoid` names (EIFO-blocked / score 0) are never treated as ideas.
 */
export type ReachGap = {
  /** The model's single highest-scored real idea, whether or not you can act on it. */
  topOverall: ReachGapName;
  /** Why `topOverall` is out of reach (never "ok"/"unknown" — those don't produce a gap). */
  topOverallStatus: InvestabilityStatus;
  /** The highest-scored idea that clears both gates, if any. */
  topInvestable?: ReachGapName;
  /** `topOverall.score − topInvestable.score`, clamped ≥ 0; the whole score when none is reachable. */
  gap: number;
};

export function reachGap(
  recommendations: Recommendation[],
  settings: BrokerSettings,
): ReachGap | undefined {
  let topOverall: { rec: Recommendation; status: InvestabilityStatus } | undefined;
  let topInvestable: Recommendation | undefined;

  for (const rec of recommendations) {
    if (rec.action === "avoid") continue; // blocked / EIFO names aren't ideas you're losing
    const inv = assessInvestability(rec.company, settings);
    if (!topOverall || rec.score > topOverall.rec.score) {
      topOverall = { rec, status: inv.status };
    }
    if (isInvestable(inv) && (!topInvestable || rec.score > topInvestable.score)) {
      topInvestable = rec;
    }
  }

  // Nothing to lose, or the best idea is itself within reach — no conviction cost at the top.
  const bestIsWithinReach =
    topOverall && (topOverall.status === "ok" || topOverall.status === "unknown");
  if (!topOverall || bestIsWithinReach) return undefined;

  const named = (rec: Recommendation): ReachGapName => ({
    symbol: rec.company.symbol,
    name: rec.company.name,
    score: rec.score,
  });
  const gap = topInvestable
    ? Math.max(0, topOverall.rec.score - topInvestable.score)
    : topOverall.rec.score;

  // An equally-scored idea is buyable — the gate blocks access, but costs no conviction.
  if (topInvestable && gap === 0) return undefined;

  return {
    topOverall: named(topOverall.rec),
    topOverallStatus: topOverall.status,
    topInvestable: topInvestable ? named(topInvestable) : undefined,
    gap,
  };
}
