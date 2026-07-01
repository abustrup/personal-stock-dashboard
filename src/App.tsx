import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  BookmarkPlus,
  FileUp,
  GitCompareArrows,
  History,
  Landmark,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { complianceOverrides } from "./data/complianceOverrides";
import { seedHoldings } from "./data/portfolioSeed";
import { universe } from "./data/universe";
import { buildDashboardModel } from "./lib/dashboard";
import { buildInsights, RISK_FACTORS, type HoldingContext, type RiskFactor } from "./lib/insights";
import {
  buildMapPoints,
  QUADRANT_LABELS,
  type MapPoint,
  type MapQuadrant,
} from "./lib/map";
import { mergeMarketSnapshot, type MarketSnapshotMap } from "./lib/market";
import { buildComparison, type Comparison, type Side } from "./lib/compare";
import {
  buildOpportunityOverview,
  pickActionableStandout,
  themeExposure,
  type OpportunityGroup,
  type OpportunityOverview,
  type StandoutExposure,
} from "./lib/opportunities";
import { buildBookComposition, type BookComposition as BookCompositionModel } from "./lib/allocation";
import { buildBookScorecard, type BookScorecard as BookScorecardModel, type Stance, type StanceSlice } from "./lib/scorecard";
import { importFxFactor, isHoldingLive, valuePortfolio, type LiveValuation } from "./lib/valuation";
import { buildNextMoves, type NextMove } from "./lib/nextMoves";
import { buildPositionSlots, type PositionSlots as PositionSlotsModel } from "./lib/positionSlots";
import { buildPeerComparison, type PeerComparison } from "./lib/peers";
import { parsePortfolioCsv } from "./lib/portfolio";
import { buildPriceChart, monthsAgoIndex, summarizeTrend, type ChartDims } from "./lib/sparkline";
import { describeMarketFreshness } from "./lib/freshness";
import { rangeLabel, readRange } from "./lib/range";
import { OWNED_SCORE_THRESHOLDS, provenanceLabel, scoreContributions } from "./lib/recommendations";
import { mergeExternalSignals, type ExternalSignalSnapshot } from "./lib/signals";
import {
  clearPortfolio,
  loadChangeBaseline,
  loadPortfolio,
  saveChangeBaseline,
  savePortfolio,
} from "./lib/storage";
import { diffModel, snapshotModel, type Change, type ChangeDigest } from "./lib/changes";
import {
  assessInvestability,
  canonicalExchange,
  collectKnownMarkets,
  investableSymbols,
  isExchangeUntradable,
  reachBreakdown,
  reachGap,
  summarizeInvestability,
  type BrokerSettings,
  type Investability,
  type InvestabilitySummary,
  type ReachBreakdown,
  type ReachGap,
} from "./lib/investability";
import { loadBrokerSettings, saveBrokerSettings } from "./lib/brokerSettings";
import { bookPctLabel, describePlan, planHeadline, planPosition, type PositionPlan } from "./lib/positionPlan";
import { COMPANY_DIRECTORY, searchDirectory, type DirectoryEntry } from "./lib/companyDirectory";
import { researchLinks } from "./lib/externalResearch";
import {
  addWatchEntry,
  loadWatchlist,
  removeWatchEntry,
  saveWatchlist,
  watchlistCompanies,
  type AddWatchError,
  type WatchEntry,
} from "./lib/watchlist";
import type { Company, ComplianceStatus, Holding, MarketSnapshot, Recommendation } from "./lib/types";

type View = "portfolio" | "opportunities" | "map" | "compare" | "detail";

// The front-page lead idea: the best opportunity the user can actually act on,
// resolved once at the top so the portfolio rail and the decision-map highlight
// agree. Carries the buy plan and theme fit so the rail card can show not just
// what to buy but how much, and the honest skip note when stronger ideas are
// off-limits.
type NextBuy = {
  rec: Recommendation;
  skipped: number;
  investability: Investability;
  exposure?: StandoutExposure;
  plan?: PositionPlan;
};

const tabs: Array<{ id: View; label: string }> = [
  { id: "portfolio", label: "Portfolio" },
  { id: "opportunities", label: "Opportunities" },
  { id: "map", label: "Map" },
  { id: "compare", label: "Compare" },
  { id: "detail", label: "Company" },
];

// Verdict → 3px microbar fill (the small list bars). Matches the prototype's BAR map.
const VERDICT_BAR: Record<Recommendation["action"], string> = {
  increase: "#2f8d61",
  investigate: "#2f5fd0",
  hold: "#aab2bc",
  watch: "#aab2bc",
  trim: "#c0473c",
  avoid: "#c0473c",
};

// Full region names → the 2-letter codes the opportunity table shows. Falls back
// to the first two letters so an unmapped region still renders something sane.
const REGION_CODES: Record<string, string> = {
  "United States": "US",
  Netherlands: "NL",
  Taiwan: "TW",
  "United Kingdom": "UK",
  Norway: "NO",
  Denmark: "DK",
  Sweden: "SE",
  Germany: "DE",
  France: "FR",
  Switzerland: "CH",
  "South Korea": "KR",
  Japan: "JP",
  China: "CN",
  Ireland: "IE",
  Israel: "IL",
  Canada: "CA",
};

function regionCode(region: string): string {
  return REGION_CODES[region] ?? region.slice(0, 2).toUpperCase();
}

// How many non-owned opportunities to plot on the decision map. Owned holdings
// are always all shown; opportunities are ranked and capped so the plane stays
// legible — the count actually shown vs. available is surfaced in the UI.
const MAP_OPPORTUNITY_LIMIT = 14;

const stored = loadPortfolio();

export default function App() {
  const [holdings, setHoldings] = useState<Holding[]>(stored?.holdings ?? seedHoldings);
  const [source, setSource] = useState<{ label: string; isDemo: boolean }>(
    stored ? { label: `Imported ${formatDate(stored.importedAt)}`, isDemo: false } : { label: "Demo portfolio", isDemo: true },
  );
  const [view, setView] = useState<View>("portfolio");
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>(holdings[0]?.symbol);
  const [compareA, setCompareA] = useState<string | undefined>();
  const [compareB, setCompareB] = useState<string | undefined>();
  const [externalSignals, setExternalSignals] = useState<ExternalSignalSnapshot>({});
  const [marketSnapshots, setMarketSnapshots] = useState<MarketSnapshotMap>({});
  const [dataAsOf, setDataAsOf] = useState<string | undefined>();
  const [brokerSettings, setBrokerSettings] = useState<BrokerSettings>(loadBrokerSettings);
  const [hideOffLimits, setHideOffLimits] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchEntry[]>(loadWatchlist);

  function updateBrokerSettings(next: BrokerSettings) {
    setBrokerSettings(next);
    saveBrokerSettings(next);
  }

  // Add a name the user typed. Returns an error code on rejection so the form can
  // explain exactly what to fix; on success the new list is persisted in-browser.
  function addToWatchlist(input: { name: string; symbol: string; exchange?: string }): AddWatchError | undefined {
    const universeSymbols = new Set(universe.map((company) => company.symbol));
    const ownedSymbols = new Set(holdings.map((holding) => holding.symbol));
    const result = addWatchEntry(watchlist, input, new Date().toISOString(), universeSymbols, ownedSymbols);
    if (!result.ok) return result.error;
    setWatchlist(result.list);
    saveWatchlist(result.list);
    return undefined;
  }

  function removeFromWatchlist(symbol: string) {
    const next = removeWatchEntry(watchlist, symbol);
    setWatchlist(next);
    saveWatchlist(next);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/live-signals.json`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then(
        (
          snapshot:
            | { signals?: ExternalSignalSnapshot; market?: MarketSnapshotMap; generatedAt?: string }
            | undefined,
        ) => {
          if (cancelled || !snapshot) return;
          if (snapshot.signals) setExternalSignals(snapshot.signals);
          if (snapshot.market) setMarketSnapshots(snapshot.market);
          if (snapshot.generatedAt) setDataAsOf(snapshot.generatedAt);
        },
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const enrichedUniverse = useMemo(
    () =>
      universe.map((company) =>
        mergeMarketSnapshot(mergeExternalSignals(company, externalSignals), marketSnapshots),
      ),
    [externalSignals, marketSnapshots],
  );
  const hasLiveMarket = Object.keys(marketSnapshots).length > 0;
  // Classify the snapshot's age so the header chip only claims "LIVE" while the data
  // is recent — a stale local copy is named as such, never dressed up as live.
  const freshness = hasLiveMarket ? describeMarketFreshness(dataAsOf, new Date()) : undefined;
  const isStale = freshness?.state === "stale";
  // User-added names run through the SAME enrichment path as the curated universe:
  // a refresh that wrote their symbol replaces the neutral placeholders with
  // measured momentum and fundamentals, so they're scored on real data when present.
  const enrichedWatchlist = useMemo(
    () =>
      watchlistCompanies(watchlist).map((company) =>
        mergeMarketSnapshot(mergeExternalSignals(company, externalSignals), marketSnapshots),
      ),
    [watchlist, externalSignals, marketSnapshots],
  );
  const model = useMemo(
    () => buildDashboardModel(holdings, enrichedUniverse, complianceOverrides, enrichedWatchlist),
    [holdings, enrichedUniverse, enrichedWatchlist],
  );

  // Symbols the company-name picker must NOT suggest: anything already owned, already
  // in the curated set, or already on the watchlist. Hiding them up front means every
  // suggestion shown is actually addable (the add still validates, but the user never
  // picks a name only to be told it's a duplicate). Upper-cased to match the directory.
  const watchExcludeSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const company of universe) set.add(company.symbol.toUpperCase());
    for (const holding of holdings) set.add(holding.symbol.toUpperCase());
    for (const entry of watchlist) set.add(entry.symbol.toUpperCase());
    return set;
  }, [holdings, watchlist]);
  const insights = useMemo(() => buildInsights(model.portfolio, model.opportunities), [model]);

  // Investability: which opportunities the user can actually act on through their
  // broker and within their per-trade budget. Computed from the same model the
  // rest of the dashboard uses, so the badges, counts and standout never disagree.
  // The cache is keyed by symbol, so it MUST be rebuilt whenever the inputs to the
  // assessment change — both the broker settings and the market snapshots, since
  // affordability reads each company's price. Omitting marketSnapshots here would
  // freeze the first (pre-fetch) "no price yet" verdict in place, so a refresh's
  // prices would never reach the budget gate or the buy plan.
  const investabilityFor = useMemo(() => {
    const cache = new Map<string, Investability>();
    return (company: Company): Investability => {
      const hit = cache.get(company.symbol);
      if (hit) return hit;
      const inv = assessInvestability(company, brokerSettings);
      cache.set(company.symbol, inv);
      return inv;
    };
  }, [brokerSettings, marketSnapshots]);
  const oppInvestableSet = useMemo(
    () => investableSymbols(model.opportunities, brokerSettings),
    [model.opportunities, brokerSettings],
  );
  const investSummary: InvestabilitySummary = useMemo(
    () => summarizeInvestability(model.opportunities, brokerSettings),
    [model.opportunities, brokerSettings],
  );
  // The named off-limits breakdown behind those counts — which specific stocks are
  // off the broker or over budget, and why. Built from the FULL opportunity set
  // (independent of the hide-off-limits toggle) so the panel always names every
  // idea it filtered, even when the rows below are hidden.
  const reach: ReachBreakdown = useMemo(
    () => reachBreakdown(model.opportunities, brokerSettings),
    [model.opportunities, brokerSettings],
  );
  // How much conviction the broker + budget gates cost at the top: the best idea overall
  // against the best one you can act on. Undefined when there's no cost to report. Built
  // from the FULL set, independent of the hide-off-limits toggle, like the breakdown above.
  const gap: ReachGap | undefined = useMemo(
    () => reachGap(model.opportunities, brokerSettings),
    [model.opportunities, brokerSettings],
  );
  const visibleOpportunities = useMemo(
    () => (hideOffLimits ? model.opportunities.filter((rec) => oppInvestableSet.has(rec.company.symbol)) : model.opportunities),
    [hideOffLimits, model.opportunities, oppInvestableSet],
  );
  const opportunityOverview = useMemo(
    () => buildOpportunityOverview(model.portfolio, visibleOpportunities, oppInvestableSet),
    [model.portfolio, visibleOpportunities, oppInvestableSet],
  );
  // The single idea the dashboard leads with on the front page and the map: the
  // best name you don't own that you can actually act on — investability-gated, so
  // it's never a stock off your broker's markets or one a single share overshoots
  // your budget for. Built from the full opportunity set (independent of the
  // Opportunities view's hide-off-limits toggle) and carries its buy plan + theme
  // fit so the rail can show how much to buy, not just what.
  const nextBuy = useMemo<NextBuy | undefined>(() => {
    const { standout, standoutSkipped } = pickActionableStandout(model.opportunities, oppInvestableSet);
    if (!standout) return undefined;
    const investability = investabilityFor(standout.company);
    const theme = standout.company.themes[0];
    const exposure = theme ? themeExposure(model.portfolio, theme) : undefined;
    const plan = planPosition(investability, model.totalMarketValueDkk);
    return { rec: standout, skipped: standoutSkipped, investability, exposure, plan };
  }, [model.opportunities, model.portfolio, model.totalMarketValueDkk, oppInvestableSet, investabilityFor]);
  // The deploy queue beneath the standout: the next-best ideas you can concretely
  // buy now, each sized to your per-trade slot. Built from the full opportunity set
  // (same as the standout and reach panel) and excludes the standout itself, which
  // is already the hero above. Same investability resolver, so the gate matches.
  const nextMoves = useMemo<NextMove[]>(
    () =>
      buildNextMoves(model.opportunities, investabilityFor, model.portfolio, model.totalMarketValueDkk, {
        excludeSymbol: nextBuy?.rec.company.symbol,
      }),
    [model.opportunities, model.portfolio, model.totalMarketValueDkk, investabilityFor, nextBuy?.rec.company.symbol],
  );
  // Every market the broker tradability gate could apply to — the toggle set the
  // user picks from. Sourced from all four places a name's exchange can come from,
  // not just the curated universe: the universe, the bundled add-a-company directory
  // (long-tail listings the picker can add — Oslo Børs, XETRA, Nasdaq Copenhagen…),
  // names already on screen (`model.all`, which folds in watchlist additions), and
  // any market already marked off-platform. Without the directory and watched
  // listings, a hand-added Nordic/German name had no toggle, so the gate could never
  // be told the broker can't trade it. `collectKnownMarkets` drops non-venues, dedupes
  // and sorts.
  const knownMarkets = useMemo(
    () =>
      collectKnownMarkets([
        ...universe.map((company) => company.exchange),
        ...COMPANY_DIRECTORY.map((entry) => entry.exchange),
        ...model.all.map((rec) => rec.company.exchange),
        ...brokerSettings.untradableExchanges,
      ]),
    [model.all, brokerSettings.untradableExchanges],
  );
  const selected =
    model.all.find((recommendation) => recommendation.company.symbol === selectedSymbol) ??
    model.topIdea ??
    model.portfolio[0];
  const peerComparison = useMemo(
    () => (selected ? buildPeerComparison(model.all, selected.company.symbol) : undefined),
    [model.all, selected?.company.symbol],
  );

  // Resolve the two names being compared. Defaults pose the natural question a
  // broker can't answer — your top holding against the best idea you don't own —
  // and fall back gracefully if a chosen symbol is gone after a re-import.
  const leftRec =
    model.all.find((rec) => rec.company.symbol === compareA) ?? model.portfolio[0] ?? model.all[0];
  const rightRec =
    model.all.find((rec) => rec.company.symbol === compareB) ??
    model.opportunities.find((rec) => rec.company.symbol !== leftRec?.company.symbol) ??
    model.all.find((rec) => rec.company.symbol !== leftRec?.company.symbol);
  const comparison = useMemo(
    () => (leftRec && rightRec ? buildComparison(leftRec, rightRec) : undefined),
    [leftRec, rightRec],
  );

  function open(symbol: string | undefined) {
    if (!symbol) return;
    setSelectedSymbol(symbol);
    setView("detail");
  }

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const parsed = parsePortfolioCsv(text);
    if (parsed.holdings.length === 0) return;
    const importedAt = new Date().toISOString();
    savePortfolio(parsed.holdings, file.name, importedAt);
    setHoldings(parsed.holdings);
    setSource({ label: `Imported ${formatDate(importedAt)} · saved in this browser`, isDemo: false });
    setSelectedSymbol(parsed.holdings[0]?.symbol);
    setView("portfolio");
  }

  function resetToDemo() {
    clearPortfolio();
    setHoldings(seedHoldings);
    setSource({ label: "Demo portfolio", isDemo: true });
    setSelectedSymbol(seedHoldings[0]?.symbol);
    setView("portfolio");
  }

  // The headline NAV, re-priced from live market data when available.
  // valuePortfolio re-values each holding at its live price via the import-implied
  // FX, falling back to the imported value (and counting the gap) for any holding
  // without a live snapshot — so the figure is honest about how live it really is.
  const live = useMemo(() => valuePortfolio(model.portfolio), [model.portfolio]);
  // Today's percent from the imported broker figures — the fallback when nothing is live.
  const importedToday =
    model.totalMarketValueDkk - model.dayGainDkk > 0
      ? (model.dayGainDkk / (model.totalMarketValueDkk - model.dayGainDkk)) * 100
      : 0;
  const nav = live.anyLive
    ? {
        valueDkk: live.liveValueDkk,
        totalPct: live.liveReturnPct,
        totalGainDkk: live.liveGainDkk,
        todayPct: live.liveDayPct,
      }
    : {
        valueDkk: model.totalMarketValueDkk,
        totalPct: model.totalReturnPct,
        totalGainDkk: model.totalGainDkk,
        todayPct: importedToday,
      };
  // A measured DKK NAV series for the hero sparkline — undefined in demo mode
  // (no fetched history), in which case the inset shows a graceful empty state.
  const navSeries = useMemo(() => buildPortfolioSeries(model.portfolio), [model.portfolio]);

  // "Since the last refresh" — the one axis no other view covers: TIME. We hold a
  // baseline of the model's own outputs from the data the reader last saw, and
  // diff this refresh against it. The baseline is captured ONCE at mount (a ref),
  // so the digest stays stable for the session even as we record the new one.
  // Lazy init (like loadBrokerSettings/loadWatchlist above): read the last-seen
  // baseline from storage exactly once at mount, never on later renders.
  const [priorBaseline] = useState(loadChangeBaseline);
  const savedAsOfRef = useRef<string | undefined>(priorBaseline?.asOf);
  const changeDigest = useMemo<ChangeDigest>(
    // Only meaningful against live data; before the fetch lands, model.all carries
    // editorial momentum, which would diff falsely against a measured baseline.
    () => (hasLiveMarket ? diffModel(priorBaseline, model.all) : { hasBaseline: false, changes: [] }),
    [hasLiveMarket, priorBaseline, model.all],
  );
  // Record the model the reader is seeing as the next baseline — but only once the
  // data has actually advanced (a new asOf), so re-opening the app before the next
  // refresh keeps showing the same digest instead of wiping it to "nothing moved".
  useEffect(() => {
    if (!hasLiveMarket || !dataAsOf) return;
    if (savedAsOfRef.current === dataAsOf) return;
    saveChangeBaseline(snapshotModel(model.all, dataAsOf));
    savedAsOfRef.current = dataAsOf;
  }, [hasLiveMarket, dataAsOf, model.all]);

  const tabCounts: Partial<Record<View, number>> = {
    portfolio: model.portfolio.length,
    opportunities: model.opportunities.length,
    map: model.portfolio.length + Math.min(model.opportunities.length, MAP_OPPORTUNITY_LIMIT),
  };
  // The same actionable pick anchors the decision-map highlight, so "top
  // opportunity" means one thing across the dashboard — the best idea you can buy.
  const topOpportunitySymbol = nextBuy?.rec.company.symbol;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Decision support · beyond your broker</p>
          <h1 className="wordmark">The Portfolio Ledger</h1>
        </div>
        <div className="topbar-actions">
          <span
            className={`live${hasLiveMarket && !isStale ? "" : " stale"}`}
            aria-label={
              !hasLiveMarket
                ? "data source: editorial estimates, no live market data"
                : isStale
                  ? `market data is stale, ${freshness?.ageLabel.toLowerCase()}`
                  : "market data is live"
            }
          >
            <span className="live-dot" aria-hidden="true" />
            {!hasLiveMarket
              ? "EDITORIAL · NPM RUN REFRESH"
              : isStale
                ? `YHOO${dataAsOf ? ` · ${formatLiveStamp(dataAsOf)}` : ""} · ${freshness?.ageLabel}`
                : `LIVE · YHOO${dataAsOf ? ` · ${formatLiveStamp(dataAsOf)}` : ""}`}
          </span>
          {!source.isDemo && (
            <button className="ghost" type="button" onClick={resetToDemo} title="Forget the saved portfolio">
              <RotateCcw aria-hidden="true" size={14} />
              <span>Reset</span>
            </button>
          )}
          <label className="upload">
            <FileUp aria-hidden="true" size={15} />
            <span>Import CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleFileUpload(event.target.files?.[0])}
            />
          </label>
        </div>
      </header>

      <NavHero
        valueDkk={nav.valueDkk}
        totalPct={nav.totalPct}
        totalGainDkk={nav.totalGainDkk}
        todayPct={nav.todayPct}
        series={navSeries}
        live={live}
        isStale={isStale}
      />

      <nav className="tabs" aria-label="dashboard views">
        {tabs.map((tab) => {
          const count = tabCounts[tab.id];
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              className={active ? "tab active" : "tab"}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setView(tab.id)}
            >
              <span>{tab.label}</span>
              {count !== undefined && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </nav>

      <p className="source-line">
        {source.label} · DKK {formatNumber(model.totalMarketValueDkk)} as imported
      </p>

      <div className="view" key={view}>
        {view === "portfolio" && (
          <PortfolioView
            portfolio={model.portfolio}
            insights={insights}
            nextBuy={nextBuy}
            perTradeBudgetDkk={brokerSettings.perTradeBudgetDkk}
            changeDigest={changeDigest}
            onSelect={open}
          />
        )}
        {view === "opportunities" && (
          <OpportunitiesOverview
            overview={opportunityOverview}
            summary={investSummary}
            reach={reach}
            gap={gap}
            nextMoves={nextMoves}
            settings={brokerSettings}
            markets={knownMarkets}
            onChangeSettings={updateBrokerSettings}
            investabilityFor={investabilityFor}
            bookValueDkk={model.totalMarketValueDkk}
            hideOffLimits={hideOffLimits}
            onToggleOffLimits={setHideOffLimits}
            watchlist={watchlist}
            watchExcludeSymbols={watchExcludeSymbols}
            onAddWatch={addToWatchlist}
            onRemoveWatch={removeFromWatchlist}
            onSelect={open}
          />
        )}
        {view === "map" && (
          <DecisionMap
            portfolio={model.portfolio}
            opportunities={model.opportunities}
            opportunityLimit={MAP_OPPORTUNITY_LIMIT}
            topOpportunitySymbol={topOpportunitySymbol}
            onSelect={open}
          />
        )}
        {view === "compare" && leftRec && rightRec && comparison && (
          <CompareView
            left={leftRec}
            right={rightRec}
            comparison={comparison}
            options={model.all}
            onChangeLeft={setCompareA}
            onChangeRight={setCompareB}
            onSwap={() => {
              setCompareA(rightRec.company.symbol);
              setCompareB(leftRec.company.symbol);
            }}
            onSelect={open}
          />
        )}
        {view === "detail" && selected && (
          <CompanyDetail
            recommendation={selected}
            context={insights.holdingContexts.get(selected.company.symbol)}
            peers={peerComparison}
            investability={selected.holding ? undefined : investabilityFor(selected.company)}
            bookValueDkk={model.totalMarketValueDkk}
            onBack={() => setView("portfolio")}
            onSelect={open}
          />
        )}
      </div>
    </main>
  );
}

// The persistent NAV hero: the real net asset value and its deltas (all from the
// model's measured totals), plus a trailing-year sparkline of the portfolio's DKK
// value. The sparkline is drawn only from a measured series — in demo mode (no
// fetched price history) it shows an honest empty state rather than a fake line.
function NavHero({
  valueDkk,
  totalPct,
  totalGainDkk,
  todayPct,
  series,
  live,
  isStale,
}: {
  valueDkk: number;
  totalPct: number;
  totalGainDkk: number;
  todayPct: number;
  series?: number[];
  live: LiveValuation;
  isStale: boolean;
}) {
  // The prices behind the NAV come from the loaded snapshot, not a live tick. While
  // that snapshot is fresh, "Live prices" is honest; once it ages past the header
  // chip's window (isStale), keep crediting the measured Yahoo snapshot — these are
  // still real prices, never editorial — but stop claiming currency. The header chip
  // above already names the snapshot's timestamp + age, so the caption only needs to
  // drop the "Live" claim, not restate the age (Charter §1, no duplication).
  const priceLabel = isStale ? "Snapshot prices" : "Live prices";
  return (
    <section className="hero" aria-label="net asset value">
      <div>
        <p className="hero-label">Net asset value · DKK</p>
        <div className="nav-figure">
          <span className="nav-cur">kr</span>
          <span className="nav-value">{formatNumber(valueDkk)}</span>
        </div>
        <div className="nav-deltas">
          <span className={`nav-delta ${totalPct >= 0 ? "up" : "down"}`}>
            <span className="arrow" aria-hidden="true">
              {totalPct >= 0 ? "▲" : "▼"}
            </span>
            {formatSignedPct(totalPct)} <span className="unit">total</span>
          </span>
          <span className="nav-sep" aria-hidden="true">
            |
          </span>
          <span className={totalGainDkk >= 0 ? "tone-up" : "tone-down"} style={{ fontWeight: 500 }}>
            {totalGainDkk >= 0 ? "+" : "−"}kr {formatNumber(Math.abs(totalGainDkk))}
          </span>
          <span className="nav-sep" aria-hidden="true">
            |
          </span>
          <span className={`nav-delta ${todayPct >= 0 ? "up" : "down"}`}>
            <span className="arrow" aria-hidden="true">
              {todayPct >= 0 ? "▲" : "▼"}
            </span>
            {formatSignedPct(todayPct)} <span className="unit">today</span>
          </span>
        </div>
        {live.anyLive ? (
          <p className="nav-prov">
            {live.allLive
              ? `${priceLabel} · all ${live.total} holding${live.total === 1 ? "" : "s"} · converted at your import's FX`
              : `${priceLabel} · ${live.covered}/${live.total} holdings (${Math.round(live.coveredWeightPct)}% of book) · the rest at your imported value`}
          </p>
        ) : (
          <p className="nav-prov">From your import · run a refresh for live prices</p>
        )}
      </div>
      <NavSpark series={series} totalPct={totalPct} />
    </section>
  );
}

const SPARK_DIMS: ChartDims = { width: 340, height: 80, padX: 6, padTop: 6, padBottom: 6 };

function NavSpark({ series, totalPct }: { series?: number[]; totalPct: number }) {
  // Annotate the trailing-year line with ITS OWN measured 12-month move — the change
  // the plotted series actually shows between its endpoints — never the all-time
  // total-return-vs-cost. That figure already sits in the NAV deltas above and spans
  // a different window (since purchase, not the trailing year), so printing it on a
  // chart whose axis reads e.g. JUL '25 → JUN '26 mislabels what the line depicts.
  // summarizeTrend reads the SAME cleaned series buildPriceChart plots, so the badge
  // can never disagree with the line it sits on. Omitted (no badge) in demo mode,
  // where there is no fetched history and so no honest trailing move to state.
  const trend = series && series.length >= 2 ? summarizeTrend(series) : undefined;
  const chart = trend ? buildPriceChart(series!, SPARK_DIMS) : undefined;
  const [startLabel, endLabel] = trailingMonthLabels();
  const rising = trend ? trend.rising : totalPct >= 0;
  return (
    <div className="nav-spark">
      <div className="nav-spark-head">
        <span>Portfolio · trailing 12 months</span>
        {trend && (
          <span className={`total ${trend.rising ? "tone-up" : "tone-down"}`}>{formatSignedPct(trend.changePct)}</span>
        )}
      </div>
      {chart ? (
        <>
          <svg viewBox={`0 0 ${SPARK_DIMS.width} ${SPARK_DIMS.height}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={chart.areaPath} fill={rising ? "#e8f1ec" : "#f7e6e2"} />
            <path
              d={chart.linePath}
              fill="none"
              stroke={rising ? "#1f7a52" : "#b3322a"}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle cx={chart.last.x} cy={chart.last.y} r={3.5} fill={rising ? "#1f7a52" : "#b3322a"} />
          </svg>
          <div className="nav-spark-axis">
            <span>{startLabel}</span>
            <span>{endLabel}</span>
          </div>
        </>
      ) : (
        <div className="nav-spark-empty">No price history yet — run npm run refresh to chart the trailing year.</div>
      )}
    </div>
  );
}

// The Portfolio view: the holdings ledger on the left, the "What Saxo won't say"
// rail on the right. Both read entirely from the dashboard model and buildInsights
// — the rail surfaces the top opportunity, what needs attention, concentration and
// EIFO posture, the synthesis a broker's holdings screen never draws.
// "Since the last refresh" — the front page's one temporal read. Every other
// view answers "where do things stand now"; this answers "what does the model
// read DIFFERENTLY than the last data you saw" — a synthesis a static broker
// feed structurally can't give. It stays out of the way: nothing renders before
// the first baseline exists, and a quiet one-line "caught up" on a flat day, so
// it only takes real estate when something genuinely moved. The honesty rule is
// visible in the dots — a filled dot is a MEASURED market delta (price,
// momentum); a hollow dot is the MODEL's verdict call, never relabeled measured.
function describeChange(change: Change): string {
  switch (change.kind) {
    case "verdict":
      return `${VERDICT_WORD[change.fromAction!]} → ${VERDICT_WORD[change.toAction!]}`;
    case "momentum":
      return `Momentum ${Math.round(change.fromMomentum!)} → ${Math.round(change.toMomentum!)}`;
    case "price": {
      const pct = change.pricePct ?? 0;
      return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}% price`;
    }
  }
}

function RefreshDigest({
  digest,
  onSelect,
}: {
  digest: ChangeDigest;
  onSelect: (symbol: string) => void;
}) {
  // First-ever look (no baseline yet): record silently, show nothing — a
  // first-time visitor's front page stays clean, and the value appears next time.
  if (!digest.hasBaseline) return null;
  const since = digest.baselineAsOf ? formatLiveStamp(digest.baselineAsOf) : undefined;
  return (
    <section className="refresh-digest" aria-label="What changed since the last refresh">
      <div className="rd-head">
        <span className="rd-eyebrow">
          <History aria-hidden="true" size={13} />
          Since the last refresh{since ? ` · ${since}` : ""}
        </span>
        {digest.changes.length > 0 && (
          <span className="rd-legend" aria-hidden="true">
            <span className="rd-dot measured" /> measured
            <span className="rd-dot model" /> model
          </span>
        )}
      </div>
      {digest.changes.length === 0 ? (
        <p className="rd-quiet">No material moves since you last looked — the model reads the field the same.</p>
      ) : (
        <ul className="rd-chips">
          {digest.changes.map((change) => {
            const Arrow = change.direction === "up" ? ArrowUpRight : ArrowDownRight;
            return (
              <li key={`${change.symbol}-${change.kind}`}>
                <button
                  type="button"
                  className={`rd-chip ${change.direction}`}
                  onClick={() => onSelect(change.symbol)}
                  title={`${change.name} — ${change.measured ? "measured market move" : "the model's verdict changed"}. Open detail.`}
                >
                  <span className={`rd-dot ${change.measured ? "measured" : "model"}`} aria-hidden="true" />
                  <span className="rd-name">{shortName(change.name)}</span>
                  <span className="rd-tag">{change.owned ? "BOOK" : "IDEA"}</span>
                  <Arrow className="rd-arrow" aria-hidden="true" size={13} />
                  <span className="rd-delta">{describeChange(change)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PortfolioView({
  portfolio,
  insights,
  nextBuy,
  perTradeBudgetDkk,
  changeDigest,
  onSelect,
}: {
  portfolio: Recommendation[];
  insights: ReturnType<typeof buildInsights>;
  nextBuy?: NextBuy;
  perTradeBudgetDkk: number;
  changeDigest: ChangeDigest;
  onSelect: (symbol: string) => void;
}) {
  const { needsAttention, concentration, compliance, tilt } = insights;
  // Roll the owned book up into a primary-theme partition — what the money is actually
  // betting on, counted once per holding. The full-width band below the ledger.
  const composition = useMemo(() => buildBookComposition(portfolio), [portfolio]);
  // The model's single verdict on the whole book — the dial that leads the front page.
  const scorecard = useMemo(() => buildBookScorecard(portfolio), [portfolio]);
  // The book re-expressed in the user's OWN trade size — each position as a count of
  // their typical buy. Sized against the per-trade budget they set in Opportunities.
  const slots = useMemo(
    () => buildPositionSlots(portfolio, perTradeBudgetDkk),
    [portfolio, perTradeBudgetDkk],
  );
  return (
    <div className="portfolio-grid">
      <RefreshDigest digest={changeDigest} onSelect={onSelect} />

      <section className="holdings" aria-label="Your holdings">
        {scorecard && <BookScorecard card={scorecard} />}

        <div className="holdings-head">
          <h2>Your holdings</h2>
          <span className="ranked">Ranked by model score</span>
        </div>
        {portfolio.length === 0 ? (
          <p className="empty">Import a portfolio to see your holdings ranked.</p>
        ) : (
          <>
            <div className="ledger-scroll">
              <div className="lt-head holding" role="row">
                <span>Company</span>
                <span>Verdict</span>
                <span>Score</span>
                <span className="num total-col">Total</span>
                <span className="num">Today</span>
                <span className="num">Weight</span>
                <span aria-hidden="true" />
              </div>
              {portfolio.map((item) => (
                <LedgerRow key={item.company.symbol} item={item} variant="holding" onSelect={onSelect} />
              ))}
            </div>
            <p className="lt-foot">
              SCORE blends measured momentum, growth, quality, valuation &amp; balance-sheet risk with editorial
              AI-exposure and geopolitics. VERDICT is the model&apos;s, not your broker&apos;s. Click any holding for the
              full breakdown.
            </p>
          </>
        )}
      </section>

      <aside className="rail" aria-label="What Saxo won't say">
        <h2>What Saxo won&apos;t say</h2>

        {nextBuy && <RailNextBuy nextBuy={nextBuy} onSelect={onSelect} />}

        <RailBrief
          eyebrow="Needs attention"
          tone={needsAttention.count > 0 ? "warn" : "calm"}
          headline={
            needsAttention.count > 0 && needsAttention.top ? (
              <>
                {needsAttention.count} to review —{" "}
                <span className="tone-down">
                  {needsAttention.top.action} {shortName(needsAttention.top.company.name)}
                </span>
              </>
            ) : (
              "All clear"
            )
          }
          note={
            needsAttention.top
              ? `${needsAttention.top.company.name} is the model's lowest score in the book (${needsAttention.top.score}).`
              : "Nothing in the book is flagged to trim or avoid."
          }
          onClick={() => onSelect(needsAttention.top?.company.symbol ?? "")}
        />

        {concentration && (
          <RailBrief
            eyebrow="Concentration"
            tone="neutral"
            headline={`${concentration.weightPct.toFixed(0)}% in ${shortName(concentration.top.company.name)}`}
            note={`Top three names are ${concentration.topThreeWeightPct.toFixed(0)}% of the book${
              tilt ? ` — a pronounced ${prettyTheme(tilt.theme)} tilt` : ""
            }.`}
            onClick={() => onSelect(concentration.top.company.symbol)}
          />
        )}

        <RailBrief
          eyebrow="EIFO compliance"
          tone={compliance.count > 0 ? "warn" : "calm"}
          headline={compliance.count > 0 ? `${compliance.count} flagged` : "None flagged"}
          note={
            compliance.count > 0 && compliance.top
              ? `${compliance.top.compliance.status.replace("_", " ")} · ${compliance.top.company.name}.`
              : 'No holding is blocked or in possible overlap — but no name is ever called "clean".'
          }
          onClick={() => onSelect(compliance.top?.company.symbol ?? "")}
        />
      </aside>

      {slots && <PositionSlots slots={slots} onSelect={onSelect} />}

      {composition.holdingCount > 0 && <BookComposition composition={composition} />}
    </div>
  );
}

// The book re-expressed in the user's OWN trade size — a synthesis a broker can't
// give. Saxo shows each position's weight; it never tells you that, at the ~5,000 DKK
// you actually buy in, your biggest name is five or six of your normal buys stacked
// up. The signature is the DISCRETE tile grid: each tile is ≈ one of your buys, the
// book laid out as a sheet of trade tickets (largest holding first), so the run of
// dark tiles for an oversized position is something you SEE, not just a percentage.
// Deliberately discrete (gapped tiles, counting units) so it never reads as another
// proportional bar next to the theme band below it. The unit is the per-trade budget
// from Opportunities; every value is measured DKK (no FX, no editorial), apportioned
// by the tested largest-remainder math in lib/positionSlots, so the picture can't
// drift from the numbers. The framing is factual — a count of your buys, not advice.
const TILE_LEGEND_LIMIT = 5;
function PositionSlots({ slots, onSelect }: { slots: PositionSlotsModel; onSelect: (symbol: string) => void }) {
  const { budgetDkk, bookValueDkk, totalSlotsRounded, top, holdings, cells, truncated } = slots;
  // Colour each holding by its size rank, reusing the composition band's slate ramp so
  // the front page speaks one palette; the largest position takes the accent.
  const colorOf = new Map(holdings.map((h, index) => [h.symbol, sliceColor(index)]));
  const legend = holdings.slice(0, TILE_LEGEND_LIMIT);
  const restCount = holdings.length - legend.length;
  const tilesLabel = `Your book as ${totalSlotsRounded} buys of DKK ${formatNumber(budgetDkk)}: ${holdings
    .map((h) => `${shortName(h.name)} ${h.slots.toFixed(1)}`)
    .join(", ")}.`;
  return (
    <section className="trades" aria-label="Your book measured in your own trades">
      <div className="trades-head">
        <h2>Your book in your own trades</h2>
        <span className="ranked">At your DKK {formatNumber(budgetDkk)} per trade</span>
      </div>

      <p className="trades-lead">
        Your <strong>DKK {formatNumber(bookValueDkk)}</strong> book is about{" "}
        <strong>{totalSlotsRounded}</strong> of your usual <strong>DKK {formatNumber(budgetDkk)}</strong> buys.{" "}
        <button type="button" className="trades-top-link" onClick={() => onSelect(top.symbol)}>
          {shortName(top.name)}
        </button>
        , your largest, is <strong>{top.slots.toFixed(1)}</strong> of them — you&apos;d repeat your usual trade{" "}
        {repeatPhrase(top.slots)} to build it from scratch.
      </p>

      <div className="trades-grid" role="img" aria-label={tilesLabel}>
        {cells.map((symbol, index) => (
          <span
            key={`${symbol}-${index}`}
            className="trade-tile"
            style={{ background: colorOf.get(symbol) ?? sliceColor(holdings.length) }}
            title={`${shortName(holdings.find((h) => h.symbol === symbol)?.name ?? symbol)} · ≈ 1 of your buys`}
          />
        ))}
        {truncated && <span className="trade-more">+{totalSlotsRounded - cells.length}</span>}
      </div>

      <ul className="trades-legend">
        {legend.map((h, index) => (
          <li className="trades-leg-row" key={h.symbol}>
            <button type="button" className="trades-leg-name" onClick={() => onSelect(h.symbol)}>
              <span className="trades-swatch" style={{ background: sliceColor(index) }} aria-hidden="true" />
              {shortName(h.name)}
            </button>
            <span className="trades-leg-slots">{h.slots.toFixed(1)}×</span>
          </li>
        ))}
        {restCount > 0 && (
          <li className="trades-leg-row trades-leg-rest">
            <span className="trades-leg-name muted">
              <span className="trades-swatch" style={{ background: sliceColor(legend.length) }} aria-hidden="true" />+
              {restCount} smaller
            </span>
          </li>
        )}
      </ul>

      <p className="lt-foot">
        Sized from your imported position values against the per-trade budget you set in Opportunities — each tile is
        about one of your buys. Measured DKK only, no FX. A synthesis your broker&apos;s flat positions list never draws.
      </p>
    </section>
  );
}

// Plain-language framing for how many buys a position is — kept factual (a count of
// your trades), never a recommendation to trim. Near a whole number it reads "about
// N times"; mid-way (e.g. 5.5) it gives the bracketing range "5–6 times" so the words
// stay coherent with the one-decimal figure shown alongside.
function repeatPhrase(slots: number): string {
  if (slots < 1.5) return "about once";
  const nearest = Math.round(slots);
  if (Math.abs(slots - nearest) < 0.15) return `about ${nearest} times`;
  return `${Math.floor(slots)}–${Math.ceil(slots)} times`;
}

// The front-page lead synthesis: the model's verdict on your WHOLE book, in one
// reading. The signature is the dial — a measured semicircular gauge of the
// position-weighted score, with the model's own verdict cutoffs (42 trim · 56 hold ·
// 72 increase) ticked onto the arc, so the book's number is read in the same verdict
// language every holding row uses, and you can see how far the book sits from a better
// verdict. Beneath it, the capital split: a single proportional bar partitioning YOUR
// money by what the model would add to, hold, or reduce — the forward editorial a
// broker's flat positions list never draws over your weights. Pure rollup of the
// tested model (lib/scorecard), so the picture can't drift from the numbers; the score
// blends measured and editorial inputs, so the dial is captioned with how much of the
// book is data-backed rather than overclaiming.
const STANCE_META: Record<Stance, { label: string; color: string }> = {
  add: { label: "Add to", color: "var(--up-bar)" },
  hold: { label: "Hold", color: "var(--neutral-bar)" },
  reduce: { label: "Reduce", color: "var(--down-bar)" },
};

// The dial arc reads in the model's verdict language; its colour matches the verdict
// so the gauge, the label and the per-holding row microbars all speak the same palette.
const VERDICT_GAUGE: Record<Recommendation["action"], string> = {
  increase: "var(--up-bar)",
  hold: "var(--neutral-v)",
  trim: "var(--down-bar)",
  avoid: "var(--down)",
  investigate: "var(--accent)",
  watch: "var(--neutral-bar)",
};

const VERDICT_WORD: Record<Recommendation["action"], string> = {
  increase: "Increase",
  hold: "Hold",
  trim: "Trim",
  avoid: "Avoid",
  investigate: "Investigate",
  watch: "Watch",
};

// Semicircle gauge geometry: a point on the arc for a 0-100 value, sweeping the
// score from the left end (0) over the top to the right end (100).
const GAUGE = { cx: 100, cy: 100, r: 84 };
function gaugePoint(value: number): { x: number; y: number } {
  const theta = Math.PI * (1 - Math.max(0, Math.min(100, value)) / 100);
  return { x: GAUGE.cx + GAUGE.r * Math.cos(theta), y: GAUGE.cy - GAUGE.r * Math.sin(theta) };
}
// The arc path from value `from` to value `to` along the dial.
function gaugeArc(from: number, to: number): string {
  const a = gaugePoint(from);
  const b = gaugePoint(to);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${GAUGE.r} ${GAUGE.r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

// Round the capital shares so the printed integers still add up to 100 (largest
// remainder), so the legend never reads 99% or 101% on a partition that really does
// sum to the whole book. The bar widths use the raw floats; only the labels round.
function roundedStanceShares(stances: StanceSlice[]): Map<Stance, number> {
  const live = stances.filter((s) => s.weightPct > 0.05);
  const total = Math.round(live.reduce((sum, s) => sum + s.weightPct, 0));
  const parts = live.map((s) => ({ stance: s.stance, floor: Math.floor(s.weightPct), rem: s.weightPct % 1 }));
  let deficit = total - parts.reduce((sum, p) => sum + p.floor, 0);
  const result = new Map<Stance, number>(parts.map((p) => [p.stance, p.floor]));
  for (const p of [...parts].sort((a, b) => b.rem - a.rem)) {
    if (deficit <= 0) break;
    result.set(p.stance, (result.get(p.stance) ?? 0) + 1);
    deficit -= 1;
  }
  return result;
}

function BookScorecard({ card }: { card: BookScorecardModel }) {
  const { weightedScore, verdict, toNextTier, stances, momentumMeasuredShare, fundamentalsMeasuredShare } = card;
  const arcColor = VERDICT_GAUGE[verdict];
  const dot = gaugePoint(weightedScore);
  const momentumPct = Math.round(momentumMeasuredShare * 100);
  const fundamentalsPct = Math.round(fundamentalsMeasuredShare * 100);
  // Capital stances that actually carry weight — the bar and legend skip empty ones.
  const liveStances = stances.filter((s) => s.weightPct > 0.05);
  // Integer shares that sum to exactly 100 for the labels (bar widths stay exact).
  const shares = roundedStanceShares(stances);

  return (
    <div className="scorecard" role="group" aria-label="The model's verdict on your book">
      <div className="scorecard-body">
        <div className="gauge" role="img" aria-label={`Your book scores ${weightedScore} out of 100, in ${VERDICT_WORD[verdict]} range.`}>
          <svg viewBox="0 0 200 116" className="gauge-svg" aria-hidden="true">
            <path className="gauge-track" d={gaugeArc(0, 100)} />
            <path className="gauge-value" d={gaugeArc(0, weightedScore)} style={{ stroke: arcColor }} />
            {/* The model's own verdict cutoffs, ticked onto the arc — read from the shared
                thresholds so the ticks can never drift from the verdict logic. */}
            {[OWNED_SCORE_THRESHOLDS.trim, OWNED_SCORE_THRESHOLDS.hold, OWNED_SCORE_THRESHOLDS.increase].map((tick) => {
              const inner = gaugePoint(tick);
              const outer = {
                x: GAUGE.cx + (GAUGE.r + 7) * Math.cos(Math.PI * (1 - tick / 100)),
                y: GAUGE.cy - (GAUGE.r + 7) * Math.sin(Math.PI * (1 - tick / 100)),
              };
              return (
                <line
                  key={tick}
                  className="gauge-tick"
                  x1={inner.x.toFixed(2)}
                  y1={inner.y.toFixed(2)}
                  x2={outer.x.toFixed(2)}
                  y2={outer.y.toFixed(2)}
                />
              );
            })}
            <circle className="gauge-dot" cx={dot.x.toFixed(2)} cy={dot.y.toFixed(2)} r={5} style={{ fill: arcColor }} />
          </svg>
          <div className="gauge-readout">
            <span className="gauge-score" style={{ color: arcColor }}>{weightedScore}</span>
            <span className="gauge-verdict" style={{ color: arcColor }}>{VERDICT_WORD[verdict]} range</span>
            <span className="gauge-scale" aria-hidden="true">/ 100</span>
          </div>
        </div>

        <div className="scorecard-read">
          <p className="scorecard-lead">
            Weighted by position size, your book reads{" "}
            <strong style={{ color: arcColor }}>{VERDICT_WORD[verdict].toLowerCase()}</strong>
            {toNextTier
              ? ` — ${toNextTier.points} ${toNextTier.points === 1 ? "point" : "points"} below where the model starts saying ${VERDICT_WORD[toNextTier.action].toLowerCase()}.`
              : " — the strongest verdict the model gives an owned name."}
          </p>

          <div className="cap-bar" role="img" aria-label={capitalLabel(card)}>
            {liveStances.map((slice) => (
              <span
                key={slice.stance}
                className="cap-seg"
                style={{ flexGrow: Math.max(slice.weightPct, 0.001), background: STANCE_META[slice.stance].color }}
                title={`${STANCE_META[slice.stance].label} · ${shares.get(slice.stance) ?? 0}% of your money`}
              />
            ))}
          </div>

          <ul className="cap-legend">
            {liveStances.map((slice) => (
              <li key={slice.stance} className="cap-row">
                <span className="cap-swatch" style={{ background: STANCE_META[slice.stance].color }} aria-hidden="true" />
                <span className="cap-label">{STANCE_META[slice.stance].label}</span>
                <span className="cap-meta">
                  {slice.holdings} {slice.holdings === 1 ? "name" : "names"}
                </span>
                <span className="cap-pct">{shares.get(slice.stance) ?? 0}%</span>
              </li>
            ))}
          </ul>

          <p className="scorecard-foot">
            Momentum is measured for {momentumPct}% of your book and fundamentals for {fundamentalsPct}%; AI exposure
            and geopolitics are editorial for every name.
            {momentumPct < 50 && " Run npm run refresh to score it on live momentum & fundamentals."}{" "}
            The verdict is the model&apos;s, not your broker&apos;s.
          </p>
        </div>
      </div>
    </div>
  );
}

// The plain-text reading of the capital split, for the bar's accessible label. Uses
// the same integer shares (summing to 100) the legend prints, so the two never disagree.
function capitalLabel(card: BookScorecardModel): string {
  const shares = roundedStanceShares(card.stances);
  const parts = card.stances
    .filter((s) => s.weightPct > 0.05)
    .map((s) => `${shares.get(s.stance) ?? 0}% to ${STANCE_META[s.stance].label.toLowerCase()}`);
  return `Your money by verdict: ${parts.join(", ")}.`;
}

// Restrained ramp for the composition slices: the lead slice takes the ledger's accent
// token; the rest step down the skin's cool-grey neutral family in even tonal steps
// (the first two are the --muted-2 / --faint tokens; the lighter three are interpolated
// between --faint and the --weight-fill/--tab-border greys to keep the steps regular).
// The tail past the ramp all shares the faintest grey — those slices are tiny by
// construction, and each legend row names its theme regardless of colour.
const SLICE_COLORS = ["var(--accent)", "#737982", "#9aa0a8", "#b9bec6", "#cbd0d7", "#dadde2"];
function sliceColor(index: number): string {
  return SLICE_COLORS[Math.min(index, SLICE_COLORS.length - 1)];
}

// Normalise a slice's measured weight to a share of the counted book. Weights already
// sum to ~100 (they are portfolio percentages), but a re-import with imperfect weights
// shouldn't let the slices misrepresent the whole — so the displayed share is always
// relative to the actual counted total. Falls back to the raw weight if degenerate.
function pctOfBook(weightPct: number, totalWeightPct: number): number {
  return totalWeightPct > 0 ? (weightPct / totalWeightPct) * 100 : weightPct;
}

// The front-page synthesis: what the book is actually betting on, rolled up by theme.
// The signature is the "spine" — a single proportional bar partitioned by each holding's
// PRIMARY theme, so every position is counted once and the segments add up to the whole
// book (an honest partition, never the overlapping >100% theme exposure the opportunities
// view uses). Drawn in the Ledger's own restrained tokens — hairline-divided segments,
// a grey ramp with the lead theme in accent — so it reads as part of the ledger, not a
// foreign chart. The legend below is the accessible, plain-text representation. The
// rollup math is unit-tested in lib/allocation.ts, so the picture can't drift from the
// numbers — the thematic synthesis a broker's flat positions list never draws.
function BookComposition({ composition }: { composition: BookCompositionModel }) {
  const { slices, themeCount, holdingCount, totalWeightPct, topTheme } = composition;
  const holdingsWord = holdingCount === 1 ? "holding" : "holdings";
  const themesWord = themeCount === 1 ? "theme" : "themes";
  const spineLabel = `Your book split by theme: ${slices
    .map((slice) => `${prettyTheme(slice.theme)} ${Math.round(pctOfBook(slice.weightPct, totalWeightPct))}%`)
    .join(", ")}.`;

  return (
    <section className="book-comp" aria-label="What your book is betting on">
      <div className="book-comp-head">
        <h2>What your book is betting on</h2>
        <span className="ranked">By theme · each counted once</span>
      </div>

      <p className="book-comp-lead">
        <strong>{holdingCount}</strong> {holdingsWord} across <strong>{themeCount}</strong> {themesWord}
        {topTheme && (
          <>
            {" — most in "}
            <strong className="book-comp-top">{prettyTheme(topTheme)}</strong> at{" "}
            {Math.round(pctOfBook(composition.topWeightPct, totalWeightPct))}%
          </>
        )}
      </p>

      <div className="spine" role="img" aria-label={spineLabel}>
        {slices.map((slice, index) => (
          <span
            key={slice.theme}
            className="spine-seg"
            style={{ flexGrow: Math.max(slice.weightPct, 0.001), background: sliceColor(index) }}
            title={`${prettyTheme(slice.theme)} · ${Math.round(pctOfBook(slice.weightPct, totalWeightPct))}% of your book`}
          />
        ))}
      </div>

      <ul className="comp-legend">
        {slices.map((slice, index) => (
          <li className="comp-row" key={slice.theme}>
            <span className="comp-swatch" style={{ background: sliceColor(index) }} aria-hidden="true" />
            <span className="comp-theme">{prettyTheme(slice.theme)}</span>
            <span className="comp-meta">
              {slice.holdings} {slice.holdings === 1 ? "holding" : "holdings"} · lead {slice.topName}
            </span>
            <span className="comp-pct">{Math.round(pctOfBook(slice.weightPct, totalWeightPct))}%</span>
          </li>
        ))}
      </ul>

      <p className="lt-foot">
        Each holding is counted once, under its primary theme, so the slices add up to your whole book. Weights are
        measured from your import; the themes are an editorial classification — a synthesis your broker&apos;s flat
        positions list doesn&apos;t draw.
      </p>
    </section>
  );
}

// One clickable row in a ledger table — shared by the holdings and opportunity
// tables. The score becomes a number + a 3px microbar (replacing the old ring in
// lists); badges for user-added, EIFO flags and investability gates sit inline
// with the name. Columns differ by variant; every value is the model's own.
// The 52-week range cell: a track from the trailing-year low to high with a marker
// at the latest price, plus a plain-words band. This is MEASURED context a broker's
// flat price list never shows at a glance — whether a high-scoring idea is basing
// near its low or extended near its high. Omits (a quiet dash) for editorial-only
// names that carry no measured range, so the column never guesses.
function RangeCell({ market }: { market?: MarketSnapshot }) {
  const read = readRange(market);
  if (!read) {
    return (
      <span className="lt-range lt-range-empty" aria-label="No 52-week range data">
        —
      </span>
    );
  }
  const pct = clampPct(read.pctAboveLow);
  const bounds =
    read.low !== undefined && read.high !== undefined
      ? ` (low ${formatPrice(read.low)}, high ${formatPrice(read.high)} ${read.currency})`
      : "";
  const label = `${formatPrice(read.price)} ${read.currency} — ${Math.round(pct)}% of its 52-week range${bounds}; ${read.label}.`;
  return (
    <span className={`lt-range band-${read.band}`} role="img" aria-label={label}>
      <span className="lt-range-track" aria-hidden="true">
        <span className="lt-range-fill" style={{ width: `${pct}%` }} />
        <span className="lt-range-marker" style={{ left: `${pct}%` }} />
      </span>
      <span className="lt-range-label">{read.shortLabel}</span>
    </span>
  );
}

function LedgerRow({
  item,
  variant,
  investability,
  onSelect,
}: {
  item: Recommendation;
  variant: "holding" | "opportunity";
  investability?: Investability;
  onSelect: (symbol: string) => void;
}) {
  const { company, holding, compliance } = item;
  const offLimits = investability && investability.status !== "ok" && investability.status !== "unknown";
  const primaryTheme = company.themes[0] ? prettyTheme(company.themes[0]) : "";
  const dek = primaryTheme ? `${primaryTheme} · ${item.conviction} conviction` : `${item.conviction} conviction`;
  // "Today" must agree with the headline NAV's today%. The headline (valuation.ts
  // liveDayPct) re-prices every live holding from its Yahoo snapshot, so a live
  // holding's row shows that same measured day-change — not the broker's frozen
  // "% 1D afk." (dayReturnPct), which is captured at import and would contradict the
  // green/red the headline implies. Gated on the EXACT isHoldingLive predicate the
  // headline uses: a holding the headline counts via broker dayGainDkk (currency
  // mismatch / no price) likewise falls to its broker dayReturnPct here. Opportunities
  // have no holding, so they keep using the snapshot day-change as before.
  const liveToday = holding && isHoldingLive(holding, company.market) ? company.market?.dayChangePct : undefined;
  const todayPct = liveToday ?? holding?.dayReturnPct ?? company.market?.dayChangePct;
  const hasBadge = company.userAdded || compliance.status !== "unknown" || offLimits;
  return (
    <button
      type="button"
      className={`lt-row ${variant}${offLimits ? " off-limits" : ""}`}
      onClick={() => onSelect(company.symbol)}
      aria-label={`${company.name}, ${item.action}, score ${item.score} — open detail`}
    >
      <span className="lt-company">
        <span className="lt-name">
          {company.name} <span className="lt-ticker">{company.symbol}</span>
          {hasBadge && (
            <span className="lt-badges">
              {company.userAdded && <WatchBadge />}
              {compliance.status !== "unknown" && (
                <span className={`flag ${compliance.status}`}>{compliance.status.replace("_", " ")}</span>
              )}
              {offLimits && investability && <InvestabilityBadge investability={investability} />}
            </span>
          )}
        </span>
        <span className="lt-dek">{dek}</span>
      </span>
      <span>
        <Action action={item.action} />
      </span>
      <span>
        <span className="lt-score-num">{item.score}</span>
        <span className="lt-microbar">
          <span style={{ width: `${clampPct(item.score)}%`, background: VERDICT_BAR[item.action] }} />
        </span>
      </span>
      {variant === "holding" ? (
        <>
          <span className={`lt-num lt-total ${toneClass(holding?.totalReturnPct)}`}>
            {formatSignedPct(holding?.totalReturnPct)}
          </span>
          <span className={`lt-num lt-today ${toneClass(todayPct)}`}>{formatSignedPct(todayPct)}</span>
          <span className="lt-num">
            <span className="lt-weight-num">{holding ? `${holding.portfolioWeight.toFixed(1)}%` : "—"}</span>
            <span className="lt-weight-track" aria-hidden="true">
              <span className="lt-weight-fill" style={{ width: `${clampPct(holding?.portfolioWeight ?? 0)}%` }} />
            </span>
          </span>
        </>
      ) : (
        <>
          <RangeCell market={company.market} />
          <span className={`lt-num lt-today ${toneClass(todayPct)}`}>{formatSignedPct(todayPct)}</span>
          <span className="lt-num lt-region">{regionCode(company.region)}</span>
        </>
      )}
      <span className="lt-chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

// A single brief in the portfolio rail: an uppercase tone-coloured eyebrow, a
// headline and a muted sentence. The whole brief is a button into the relevant
// company detail.
function RailBrief({
  eyebrow,
  tone,
  headline,
  note,
  onClick,
}: {
  eyebrow: string;
  tone: "warn" | "calm" | "neutral";
  headline: ReactNode;
  note: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="rail-brief" onClick={onClick}>
      <div className={`rail-brief-eyebrow ${tone}`}>{eyebrow}</div>
      <div className="rail-brief-headline">{headline}</div>
      <div className="rail-brief-note">{note}</div>
    </button>
  );
}

// The front-page lead idea, made trustworthy: the best opportunity you can ACT ON.
// The old "top opportunity" link headlined the highest-scoring name even when it was
// off your broker's markets or a single share already blew your budget — exactly the
// trap the owner asked to avoid. This card leads with the strongest *investable* idea
// instead, carries its buy plan (how many whole shares your slot buys) and an honest
// note when stronger ideas were skipped for being off-limits. The pick and its skip
// count come from the same tested picker the Opportunities standout uses, so the
// dashboard leads with one consistent idea everywhere. Falls back to showing the top
// idea behind a clear off-limits gate when nothing is investable — never silently.
function RailNextBuy({ nextBuy, onSelect }: { nextBuy: NextBuy; onSelect: (symbol: string) => void }) {
  const { rec, skipped, investability, exposure, plan } = nextBuy;
  const { company } = rec;
  const offLimits = investability.status !== "ok" && investability.status !== "unknown";
  const ofBook = plan ? bookPctLabel(plan.bookFraction) : undefined;
  return (
    <button
      type="button"
      className={`rail-top${offLimits ? " off-limits" : ""}`}
      onClick={() => onSelect(company.symbol)}
      aria-label={`${
        offLimits ? "Top idea, off-limits for your account" : "Top opportunity you can act on"
      }: ${company.name}, score ${rec.score}, ${rec.action} — open detail`}
    >
      <div className="rail-top-eyebrow">
        {offLimits ? "↗ Top idea · off-limits for your account" : "↗ Top opportunity · one you can act on"}
      </div>
      <div className="rail-top-name">{company.name}</div>
      <div className="rail-top-meta">
        SCORE {rec.score} · {rec.action.toUpperCase()} · NOT OWNED
      </div>
      {(company.userAdded || rec.compliance.status !== "unknown") && (
        <div className="rail-top-badges">
          {company.userAdded && <WatchBadge />}
          {rec.compliance.status !== "unknown" && (
            <span className={`flag ${rec.compliance.status}`}>{rec.compliance.status.replace("_", " ")}</span>
          )}
        </div>
      )}
      <div className="rail-top-why">{rec.headline}</div>
      <div className="rail-top-fit">{standoutFit(exposure)}</div>
      <LeadTrend market={company.market} />
      {offLimits ? (
        <div className="rail-top-gate">
          <InvestabilityBadge investability={investability} />
        </div>
      ) : plan ? (
        <div className="rail-top-plan">
          <Wallet aria-hidden="true" size={12} />
          <span>
            {planHeadline(plan)}
            {ofBook ? ` · ~${ofBook} of your book` : ""}
          </span>
        </div>
      ) : null}
      {skipped > 0 && (
        <div className="rail-top-skip">
          {skipped} higher-scoring {skipped === 1 ? "idea is" : "ideas are"} off-limits for your account — this is the
          strongest you can act on.
        </div>
      )}
    </button>
  );
}

// Marks a name the user typed in themselves, so a watchlist idea is never mistaken
// for a curated, researched one — in the accent green (it's yours), distinct from
// the slate investability gates and the warm-red EIFO flags.
function WatchBadge() {
  return (
    <span className="watch-added" title="You added this name — scored by the model, not yet researched.">
      <BookmarkPlus aria-hidden="true" size={12} />
      Added by you
    </span>
  );
}

// The investability gate badge: a quiet, slate-toned pill — deliberately NOT in
// the warm-red EIFO palette, because this is a practical "can I act on it?" gate,
// not a compliance danger. A bank pillar marks an off-platform market; a wallet
// marks a name a single share already overshoots the budget for.
function InvestabilityBadge({ investability }: { investability: Investability }) {
  const platform = investability.status === "not_tradable";
  const Icon = platform ? Landmark : Wallet;
  return (
    <span className={`gate ${platform ? "gate-platform" : "gate-budget"}`} title={investability.note}>
      <Icon aria-hidden="true" size={12} />
      {investability.reason}
    </span>
  );
}

// The buy plan: the step a broker's "buying power" readout skips. The owner buys
// in fixed ~5,000 DKK slots and only whole shares, so the signature here is a slot
// meter — the track is one per-trade slot, the fill is what whole shares actually
// consume, and the gap to the right is budget left stranded by whole-share rounding.
// An over-budget name overflows the track (one share already exceeds the slot).
// Sizing is approximate (measured price, approximate FX); it never touches the score.
// Built from <span>s (phrasing content) so the meter stays valid markup even as a
// descendant of the clickable standout button; the meter is aria-hidden with the
// numbers carried in text.
function BuyPlan({ plan, variant }: { plan: PositionPlan; variant: "hero" | "detail" }) {
  const over = plan.status === "over";
  const fillPct = Math.min(100, Math.round(plan.budgetUse * 100));
  const ofBook = bookPctLabel(plan.bookFraction);
  const slotLabel = over
    ? `${plan.slotMultiple >= 10 ? "10+" : plan.slotMultiple.toFixed(1)}× your DKK ${formatNumber(plan.budgetDkk)} slot`
    : `of your DKK ${formatNumber(plan.budgetDkk)} slot`;
  return (
    <span className={`buy-plan ${variant}${over ? " over" : ""}`} role="group" aria-label="Buy plan for your per-trade slot">
      <span className="buy-plan-head">
        <span className="buy-plan-eyebrow">{over ? "Doesn’t fit your slot" : "Buy plan"}</span>
        <strong className="buy-plan-figure">{planHeadline(plan)}</strong>
      </span>
      <span className="buy-plan-meter" aria-hidden="true">
        <span className="buy-plan-fill" style={{ width: `${fillPct}%` }} />
        {over && <span className="buy-plan-over" />}
      </span>
      <span className="buy-plan-foot">
        <span>{over ? slotLabel : `${fillPct}% ${slotLabel}`}</span>
        {ofBook && <span className="buy-plan-book">~{ofBook} of your book</span>}
      </span>
    </span>
  );
}

// The trajectory strip for a lead idea card (the front-page next buy and the
// Opportunities standout). It draws the measured trailing-year price path as a
// quiet horizon line and captions it with the 12-month move and where the latest
// price sits in its 52-week range — so the card carries the price trajectory next
// to the model's score and verdict, the synthesis a broker's price chart never
// draws beside it. The 12-month move comes from the same cleaned series the line
// is drawn from (lib/sparkline), so the figure and the line can't disagree; the
// chart's vertical domain is widened to the canonical 52-week high/low (the same
// refs PricePath uses), so the latest-price dot sits where the "52w range" caption
// says it should. Drawn only when a refresh has fetched history; renders nothing
// until then (no fake line).
const LEAD_SPARK_DIMS: ChartDims = { width: 300, height: 38, padX: 2, padTop: 5, padBottom: 5 };

function LeadTrend({ market }: { market?: MarketSnapshot }) {
  const history = market?.history;
  if (!history) return null;
  const chart = buildPriceChart(history, LEAD_SPARK_DIMS, {
    high: market!.fiftyTwoWeekHigh,
    low: market!.fiftyTwoWeekLow,
  });
  const trend = summarizeTrend(history);
  if (!chart || !trend) return null;

  const rising = trend.rising;
  // Prefer the canonical 52-week range position from market.ts; fall back to the
  // drawn series' own band when a snapshot lacks the 52-week high/low.
  const rangePhrase = rangeLabel(market!.rangePosition ?? trend.rangePosition);
  const label = `Price over the trailing year: ${formatSignedPct(trend.changePct)}${
    rangePhrase ? `, ${rangePhrase}` : ""
  }. Latest ${formatPrice(market!.price)} ${market!.currency}.`;

  return (
    <span className="lead-trend" role="img" aria-label={label}>
      <svg
        className="lead-trend-svg"
        viewBox={`0 0 ${LEAD_SPARK_DIMS.width} ${LEAD_SPARK_DIMS.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className={`lead-trend-area ${rising ? "up" : "down"}`} d={chart.areaPath} />
        <path className={`lead-trend-line ${rising ? "up" : "down"}`} d={chart.linePath} />
        <circle className={`lead-trend-dot ${rising ? "up" : "down"}`} cx={chart.last.x} cy={chart.last.y} r={3} />
      </svg>
      <span className="lead-trend-cap">
        <span className="lead-trend-eyebrow">12-mo</span>
        <span className={`lead-trend-move ${toneClass(trend.changePct)}`}>{formatSignedPct(trend.changePct)}</span>
        {rangePhrase && <span className="lead-trend-range">{rangePhrase}</span>}
      </span>
    </span>
  );
}

// Build a measured DKK NAV series for the hero sparkline from the holdings that
// carry fetched price history. Each leg's native-currency history is scaled by the
// same import-implied FX factor the live headline uses (importFxFactor), so the
// line and the headline NAV move together. Returns undefined when no holding has
// usable history (demo mode), so the hero can show an empty state.
function buildPortfolioSeries(portfolio: Recommendation[]): number[] | undefined {
  const legs = portfolio
    .map((rec) => ({ holding: rec.holding, history: rec.company.market?.history }))
    .filter((leg): leg is { holding: Holding; history: number[] } =>
      Boolean(leg.holding) && Array.isArray(leg.history) && leg.history.length >= 2,
    );
  if (legs.length === 0) return undefined;
  const length = Math.min(...legs.map((leg) => leg.history.length));
  if (length < 2) return undefined;
  const series = new Array<number>(length).fill(0);
  let contributed = 0;
  for (const { holding, history } of legs) {
    const factor = importFxFactor(holding);
    if (factor === undefined) continue;
    const tail = history.slice(history.length - length);
    for (let i = 0; i < length; i += 1) series[i] += tail[i] * factor;
    contributed += 1;
  }
  if (contributed === 0) return undefined;
  return series.map((value) => Math.round(value));
}

// "28 JUN 20:13" — the live-status stamp, matching the prototype's wordmark line.
function formatLiveStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.toUpperCase();
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-GB", { month: "short" }).toUpperCase();
  const time = date.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${month} ${time}`;
}

// The two axis labels under the hero sparkline — the months bounding the trailing
// year, e.g. ["JUL '25", "JUN '26"].
function trailingMonthLabels(): [string, string] {
  const fmt = (date: Date) =>
    `${date.toLocaleString("en-GB", { month: "short" }).toUpperCase()} '${String(date.getFullYear()).slice(2)}`;
  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - 11);
  return [fmt(start), fmt(now)];
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function shortName(name: string): string {
  return name.split(/\s+/)[0];
}

// The detail-view investability heading, in the user's own terms.
function investabilityTitle(investability: Investability): string {
  if (investability.status === "not_tradable") return "Off your platform";
  if (investability.status === "above_budget") return "Above your per-trade budget";
  return "Within reach";
}

// Where the user tells the dashboard about their own account: the per-trade budget
// that defines "affordable" and which markets their broker can actually trade. A
// quiet disclosure so it stays out of the way until needed — the settings persist
// in this browser. This is the control the rest of the investability layer reads.
function BrokerBar({
  settings,
  markets,
  onChange,
}: {
  settings: BrokerSettings;
  markets: string[];
  onChange: (next: BrokerSettings) => void;
}) {
  const offCount = settings.untradableExchanges.length;
  function setBudget(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    onChange({ ...settings, perTradeBudgetDkk: Math.round(value) });
  }
  function toggleMarket(market: string) {
    // Compare and store by canonical venue so toggling one spelling of a market also
    // clears any other spelling of it, and so a freshly-toggled chip gates every name
    // on that venue however its source labels the listing (e.g. ASML's "Amsterdam").
    const off = isExchangeUntradable(market, settings);
    onChange({
      ...settings,
      untradableExchanges: off
        ? settings.untradableExchanges.filter((m) => canonicalExchange(m) !== canonicalExchange(market))
        : [...settings.untradableExchanges, canonicalExchange(market)],
    });
  }
  return (
    <details className="broker-bar">
      <summary>
        <span className="broker-bar-icon">
          <SlidersHorizontal aria-hidden="true" size={15} />
        </span>
        <span className="broker-bar-summary">
          <strong>Broker &amp; budget</strong>
          <span>
            DKK {formatNumber(settings.perTradeBudgetDkk)} per trade ·{" "}
            {offCount === 0
              ? "all markets tradable"
              : `${offCount} market${offCount === 1 ? "" : "s"} off your platform`}
          </span>
        </span>
        <span className="broker-bar-edit">Edit</span>
      </summary>
      <div className="broker-bar-body">
        <label className="broker-budget">
          <span className="broker-field-label">Typical position size</span>
          <span className="broker-budget-input">
            <span className="broker-budget-cur">DKK</span>
            <input
              type="number"
              min={100}
              step={500}
              value={settings.perTradeBudgetDkk}
              onChange={(event) => setBudget(Number(event.target.value))}
              aria-label="Per-trade budget in DKK"
            />
          </span>
          <span className="broker-field-hint">
            Any idea whose single share costs more than this is flagged above budget.
          </span>
        </label>
        <div className="broker-markets">
          <span className="broker-field-label">Markets your broker can trade</span>
          <div className="market-chips">
            {markets.map((market) => {
              const off = isExchangeUntradable(market, settings);
              return (
                <button
                  key={market}
                  type="button"
                  className={`market-chip${off ? " off" : ""}`}
                  aria-pressed={!off}
                  onClick={() => toggleMarket(market)}
                  title={off ? `${market} — off your platform` : `${market} — tradable`}
                >
                  {off ? <Ban aria-hidden="true" size={12} /> : <Landmark aria-hidden="true" size={12} />}
                  {market}
                </button>
              );
            })}
          </div>
          <span className="broker-field-hint">
            Every market a name here — or one you could add by name — can list on. Tap one to mark it
            off-platform: Saxo Investor doesn&apos;t trade the Korea Exchange, for instance. Off-platform names
            stay scored, but are flagged so you don&apos;t act on one you can&apos;t buy.
          </span>
        </div>
      </div>
    </details>
  );
}

// The reachability readout: of every idea the model ranks, how many can you
// actually act on — through YOUR broker, at YOUR per-trade budget — and which
// ones can't, named and grouped by the reason. The segmented bar is the signature:
// one track partitioned into within-reach (green), off your broker (slate) and
// over budget (amber), so the proportion you can touch is visible at a glance.
// Counts come from summarizeInvestability; the named lists from reachBreakdown,
// both off the same assessInvestability call — so they can never disagree. This is
// the synthesis a broker can't give: its screen never tells you a top mover is on a
// market it can't trade, or that a single share already overshoots your sizing.
function ReachPanel({
  summary,
  reach,
  gap,
  budgetDkk,
  hideOffLimits,
  onToggleOffLimits,
  onSelect,
}: {
  summary: InvestabilitySummary;
  reach: ReachBreakdown;
  gap: ReachGap | undefined;
  budgetDkk: number;
  hideOffLimits: boolean;
  onToggleOffLimits: (next: boolean) => void;
  onSelect: (symbol: string) => void;
}) {
  const { investable, offPlatform, aboveBudget, total } = summary;
  const offLimitsTotal = offPlatform + aboveBudget;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const allClear = offLimitsTotal === 0;
  const hasApproxCost = reach.aboveBudget.some((name) => name.fxApprox);

  return (
    <section className="reach" aria-label="What you can act on">
      <div className="reach-head">
        <div>
          <p className="reach-eyebrow">Within reach</p>
          <p className="reach-lead">
            {allClear ? (
              <>
                All <strong>{total}</strong> {total === 1 ? "idea" : "ideas"} clear your broker and your DKK{" "}
                {formatNumber(budgetDkk)} per-trade budget.
              </>
            ) : (
              <>
                <strong>{investable}</strong> of {total} {total === 1 ? "idea is" : "ideas are"} buyable through Saxo
                at your DKK {formatNumber(budgetDkk)} per trade — the rest are named below, not silently dropped.
              </>
            )}
          </p>
        </div>
        {offLimitsTotal > 0 && (
          <label className="invest-toggle">
            <input
              type="checkbox"
              checked={hideOffLimits}
              onChange={(event) => onToggleOffLimits(event.target.checked)}
            />
            <span>Hide off-limits</span>
          </label>
        )}
      </div>

      <div
        className="reach-bar"
        role="img"
        aria-label={`${investable} of ${total} ideas within reach; ${offPlatform} off your broker; ${aboveBudget} over your DKK ${formatNumber(budgetDkk)} per-trade budget`}
      >
        {investable > 0 && (
          <span className="reach-seg ok" style={{ width: `${pct(investable)}%` }} title={`${investable} within reach`} />
        )}
        {offPlatform > 0 && (
          <span className="reach-seg off" style={{ width: `${pct(offPlatform)}%` }} title={`${offPlatform} off your broker`} />
        )}
        {aboveBudget > 0 && (
          <span className="reach-seg budget" style={{ width: `${pct(aboveBudget)}%` }} title={`${aboveBudget} over budget`} />
        )}
      </div>

      <div className="reach-legend">
        <span className="reach-key ok">
          <i aria-hidden="true" /> <strong>{investable}</strong> to act on
        </span>
        {offPlatform > 0 && (
          <span className="reach-key off">
            <Landmark aria-hidden="true" size={12} /> <strong>{offPlatform}</strong> off your broker
          </span>
        )}
        {aboveBudget > 0 && (
          <span className="reach-key budget">
            <Wallet aria-hidden="true" size={12} /> <strong>{aboveBudget}</strong> over budget
          </span>
        )}
      </div>

      {gap && <ConvictionGap gap={gap} onSelect={onSelect} />}

      {offLimitsTotal > 0 && (
        <ul className="reach-blocked">
          {reach.offPlatform.map((group) => (
            <li className="reach-block off" key={group.exchange}>
              <span className="reach-block-reason">
                <Landmark aria-hidden="true" size={13} /> Off your broker · {group.exchange}
              </span>
              <span className="reach-block-names">
                {group.names.map((name, index) => (
                  <Fragment key={name.symbol}>
                    {index > 0 && <span className="reach-sep" aria-hidden="true">·</span>}
                    <button type="button" className="reach-name" onClick={() => onSelect(name.symbol)}>
                      {name.name}
                    </button>
                  </Fragment>
                ))}
              </span>
            </li>
          ))}
          {reach.aboveBudget.length > 0 && (
            <li className="reach-block budget">
              <span className="reach-block-reason">
                <Wallet aria-hidden="true" size={13} /> Over your DKK {formatNumber(budgetDkk)} budget
              </span>
              <span className="reach-block-names">
                {reach.aboveBudget.map((name, index) => (
                  <Fragment key={name.symbol}>
                    {index > 0 && <span className="reach-sep" aria-hidden="true">·</span>}
                    <button type="button" className="reach-name" onClick={() => onSelect(name.symbol)}>
                      {name.name}
                      {name.sharePriceDkk !== undefined && (
                        <span className="reach-name-cost">
                          {" "}
                          1 share ≈ DKK {formatNumber(name.sharePriceDkk)}
                          {name.fxApprox ? "*" : ""}
                        </span>
                      )}
                    </button>
                  </Fragment>
                ))}
              </span>
            </li>
          )}
        </ul>
      )}

      {hasApproxCost && (
        <p className="reach-foot">* one-share cost converted to DKK at an approximate rate — enough to size it, not a quote.</p>
      )}
    </section>
  );
}

// The conviction your account costs you: the model's highest-scored idea (which you can't
// reach) measured against the strongest one you can actually act on. The reach panel above
// names *which* ideas are blocked; this is the one place that says *how good* the idea
// you're losing is — the synthesis a broker, which only shows what you can already trade,
// never draws. The score is the model's editorial 0–100 read, labelled as such; the gates
// are the user's own broker + budget settings. Logic and edge cases live in lib/investability.
function ConvictionGap({ gap, onSelect }: { gap: ReachGap; onSelect: (symbol: string) => void }) {
  const { topOverall, topOverallStatus, topInvestable } = gap;
  const blockedWhy = topOverallStatus === "not_tradable" ? "off your broker" : "over your budget";

  // The whole field is out of reach — there's no second point to plot, so state it plainly.
  if (!topInvestable) {
    return (
      <div className="reach-gap reach-gap-empty">
        <p className="reach-gap-eyebrow">What your account costs</p>
        <p className="reach-gap-line">
          The model&apos;s strongest idea,{" "}
          <button type="button" className="reach-name" onClick={() => onSelect(topOverall.symbol)}>
            {topOverall.name}
          </button>{" "}
          (<span className="reach-gap-num">{topOverall.score}</span>), is {blockedWhy} — and nothing else
          here clears both gates at any score.
        </p>
      </div>
    );
  }

  const lo = topInvestable.score;
  const hi = topOverall.score;
  return (
    <div className="reach-gap">
      <div className="reach-gap-top">
        <p className="reach-gap-eyebrow">What your account costs</p>
        <p className="reach-gap-delta">
          <span className="reach-gap-delta-num">−{gap.gap}</span>
          <span className="reach-gap-delta-unit">pts of conviction</span>
        </p>
      </div>

      <div
        className="reach-gap-track"
        role="img"
        aria-label={`The model scores ${topOverall.name} ${hi}, but it is ${blockedWhy}. The strongest idea you can act on, ${topInvestable.name}, scores ${lo} — a ${gap.gap}-point gap on the model's 0 to 100 scale.`}
      >
        <span className="reach-gap-span" style={{ left: `${lo}%`, width: `${hi - lo}%` }} aria-hidden="true" />
        <span className="reach-gap-mark in" style={{ left: `${lo}%` }} aria-hidden="true" />
        <span className="reach-gap-mark out" style={{ left: `${hi}%` }} aria-hidden="true" />
      </div>

      <div className="reach-gap-rows">
        <button type="button" className="reach-gap-row out" onClick={() => onSelect(topOverall.symbol)}>
          <span className="reach-gap-score">{topOverall.score}</span>
          <span className="reach-gap-name">{topOverall.name}</span>
          <span className="reach-gap-tag">{blockedWhy}</span>
        </button>
        <button type="button" className="reach-gap-row in" onClick={() => onSelect(topInvestable.symbol)}>
          <span className="reach-gap-score">{topInvestable.score}</span>
          <span className="reach-gap-name">{topInvestable.name}</span>
          <span className="reach-gap-tag">strongest you can act on</span>
        </button>
      </div>

      <p className="reach-gap-foot">
        Score is the model&apos;s own 0–100 read — an editorial estimate, not a market price.
      </p>
    </div>
  );
}

// The Opportunities overview: not a flat ranked list but a map of where your book
// has no exposure yet. It leads with the single standout idea, then groups every
// name you don't own by theme — each theme badged with YOUR own exposure to it, so
// blind spots (themes you hold nothing in) are surfaced first. The synthesis a
// broker can't draw: it only ever shows what you already hold, never the gaps. The
// grouping, exposure and gap-first ordering are unit-tested in lib/opportunities.ts;
// every score/action is reused from the dashboard model, so this can't disagree
// with the detail or compare views.
function OpportunitiesOverview({
  overview,
  summary,
  reach,
  gap,
  nextMoves,
  settings,
  markets,
  onChangeSettings,
  investabilityFor,
  bookValueDkk,
  hideOffLimits,
  onToggleOffLimits,
  watchlist,
  watchExcludeSymbols,
  onAddWatch,
  onRemoveWatch,
  onSelect,
}: {
  overview: OpportunityOverview;
  summary: InvestabilitySummary;
  reach: ReachBreakdown;
  gap: ReachGap | undefined;
  nextMoves: NextMove[];
  settings: BrokerSettings;
  markets: string[];
  onChangeSettings: (next: BrokerSettings) => void;
  investabilityFor: (company: Company) => Investability;
  bookValueDkk: number;
  hideOffLimits: boolean;
  onToggleOffLimits: (next: boolean) => void;
  watchlist: WatchEntry[];
  watchExcludeSymbols: ReadonlySet<string>;
  onAddWatch: (input: { name: string; symbol: string; exchange?: string }) => AddWatchError | undefined;
  onRemoveWatch: (symbol: string) => void;
  onSelect: (symbol: string) => void;
}) {
  const { standout, standoutExposure, groups, total, gapCount, themeCount, standoutSkipped } = overview;
  const gapThemeCount = groups.filter((g) => g.isGap).length;
  const offLimitsTotal = summary.offPlatform + summary.aboveBudget;

  const brokerBar = <BrokerBar settings={settings} markets={markets} onChange={onChangeSettings} />;
  const watchBar = (
    <WatchlistBar
      watchlist={watchlist}
      markets={markets}
      excludeSymbols={watchExcludeSymbols}
      untradableExchanges={settings.untradableExchanges}
      onAdd={onAddWatch}
      onRemove={onRemoveWatch}
    />
  );

  if (total === 0) {
    const hiddenByFilter = hideOffLimits && offLimitsTotal > 0;
    return (
      <section className="panel" aria-label="Opportunities">
        <div className="panel-heading">
          <div>
            <h2>Opportunities</h2>
            <span>Names you don&apos;t own — and where your book has no exposure yet</span>
          </div>
        </div>
        {brokerBar}
        {watchBar}
        {hiddenByFilter ? (
          <p className="empty">
            Every idea is off-limits for your account right now — {offLimitsTotal} hidden.{" "}
            <button type="button" className="link-button" onClick={() => onToggleOffLimits(false)}>
              Show off-limits ideas
            </button>{" "}
            to see them anyway, or widen your broker &amp; budget settings above.
          </p>
        ) : (
          <p className="empty">No opportunities in the universe right now. Every curated name is one you already hold.</p>
        )}
      </section>
    );
  }

  return (
    <section className="panel opps" aria-label="Opportunities">
      <div className="panel-heading">
        <div>
          <h2>Opportunities</h2>
          <span>Names you don&apos;t own</span>
        </div>
        <span className="count">{total} ideas</span>
      </div>

      <p className="opp-intro">
        Curated global AI &amp; tech names ranked by the model — the ideas your broker&apos;s screen will never put in
        front of you.
      </p>

      {brokerBar}
      {watchBar}

      {standout && (
        <StandoutIdea
          rec={standout}
          exposure={standoutExposure}
          investability={investabilityFor(standout.company)}
          bookValueDkk={bookValueDkk}
          onSelect={onSelect}
        />
      )}

      {standoutSkipped > 0 && (
        <p className="invest-skip-note">
          The {standoutSkipped === 1 ? "top idea by score is" : `top ${standoutSkipped} ideas by score are`}{" "}
          off-limits for your account — this is the strongest one you can actually act on.
        </p>
      )}

      <NextMoves moves={nextMoves} onSelect={onSelect} />

      <ReachPanel
        summary={summary}
        reach={reach}
        gap={gap}
        budgetDkk={settings.perTradeBudgetDkk}
        hideOffLimits={hideOffLimits}
        onToggleOffLimits={onToggleOffLimits}
        onSelect={onSelect}
      />

      <p className="opps-summary">
        <strong>{total}</strong> {total === 1 ? "idea" : "ideas"} across <strong>{themeCount}</strong>{" "}
        {themeCount === 1 ? "theme" : "themes"}
        {gapCount > 0 ? (
          <>
            {" · "}
            <strong className="opps-summary-gap">{gapCount}</strong> in {gapThemeCount}{" "}
            {gapThemeCount === 1 ? "theme" : "themes"} you don&apos;t own yet
          </>
        ) : (
          " · all in themes you already hold"
        )}
      </p>

      <div className="ledger-scroll">
        <div className="lt-head opportunity" role="row">
          <span>Company</span>
          <span>Verdict</span>
          <span>Score</span>
          <span>52-wk range</span>
          <span className="num">Today</span>
          <span className="num">Region</span>
          <span aria-hidden="true" />
        </div>

        {groups.map((group) => (
          <div className={`opp-group ${group.isGap ? "is-gap" : ""}`} key={group.theme}>
            <div
              className="opp-theme-row"
              role="img"
              aria-label={
                group.isGap
                  ? `Your exposure to ${prettyTheme(group.theme)}: none — a gap in your book`
                  : `Your exposure to ${prettyTheme(group.theme)}: ${group.ownedCount} ${group.ownedCount === 1 ? "holding" : "holdings"}, ${group.ownedWeightPct.toFixed(0)} percent of your book`
              }
            >
              <span className="opp-theme">{prettyTheme(group.theme)}</span>
              <span className="opp-exposure">
                <span className="opp-exposure-label">{themeExposureLabel(group)}</span>
                <span className="opp-meter" aria-hidden="true">
                  {!group.isGap && (
                    <span className="opp-meter-fill" style={{ width: `${clampPct(group.ownedWeightPct)}%` }} />
                  )}
                </span>
              </span>
            </div>
            {group.opportunities.map((item) => (
              <LedgerRow
                key={item.company.symbol}
                item={item}
                variant="opportunity"
                investability={investabilityFor(item.company)}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </div>

      <p className="estimate-note">
        Grouped by each name&apos;s primary theme and ranked by the model&apos;s own score. Your exposure is measured from
        your imported weights; the themes themselves are an editorial classification. A <em>gap</em> means you hold no
        name tagged with that theme — a blind spot your broker won&apos;t flag.
      </p>
    </section>
  );
}

// The exposure label for an opportunity theme group: a gap reads as "you own
// none", otherwise the holding count and weight of your book already in the theme.
function themeExposureLabel(group: OpportunityGroup): string {
  if (group.isGap) return "Gap · you own none";
  return `${group.ownedCount} ${group.ownedCount === 1 ? "holding" : "holdings"} · ${group.ownedWeightPct.toFixed(0)}% of book`;
}

// Where you put YOUR own ideas through the same unbiased model. A typed name joins
// the opportunity set scored on neutral placeholders — deliberately middling and
// flagged provisional — until a refresh fetches its real momentum and fundamentals.
// The differentiator a broker can't offer: it shows a name's price, never how that
// name scores against your personal risk model, your EIFO rules and your budget.
const ADD_WATCH_MESSAGES: Record<AddWatchError, string> = {
  missing_name: "Add the company's name.",
  missing_symbol: "Add a ticker symbol — it's the key to live data.",
  duplicate: "That symbol is already on your watchlist.",
  in_universe: "That name is already in the curated set below.",
  owned: "You already own that — it's in your portfolio, not an opportunity.",
};

// Build a prefilled GitHub issue URL for the integration queue, so a watched name
// reaches the repo (as an `integrate`-labelled issue) with one tap — no terminal,
// no client secret to ship on a static site. The daily routine reads these issues
// and integrates the company via a PR. See docs/automation/integrate-watchlist.md.
const REPO_SLUG = "abustrup/personal-stock-dashboard";

function integrationIssueUrl(entry: { name: string; symbol: string; exchange?: string }): string {
  const params = new URLSearchParams({
    template: "integrate.yml",
    title: `Integrate: ${entry.name} (${entry.symbol})`,
    name: entry.name,
    ticker: entry.exchange ? `${entry.exchange}: ${entry.symbol}` : entry.symbol,
  });
  if (entry.exchange) params.set("region", entry.exchange);
  return `https://github.com/${REPO_SLUG}/issues/new?${params.toString()}`;
}

function WatchlistBar({
  watchlist,
  markets,
  excludeSymbols,
  untradableExchanges,
  onAdd,
  onRemove,
}: {
  watchlist: WatchEntry[];
  markets: string[];
  excludeSymbols: ReadonlySet<string>;
  untradableExchanges: string[];
  onAdd: (input: { name: string; symbol: string; exchange?: string }) => AddWatchError | undefined;
  onRemove: (symbol: string) => void;
}) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState("");
  const [error, setError] = useState<AddWatchError | undefined>();
  // Picker state: which suggestion is keyboard-highlighted, whether the list is
  // open, and a one-line heads-up when the picked listing is off the broker.
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [offBroker, setOffBroker] = useState<string | undefined>();
  const listId = "watch-suggestions";

  // Resolve a typed name to real companies (with their canonical Yahoo ticker and
  // exchange) so the user never has to know the ticker. Already-owned, in-universe
  // and already-watched symbols are filtered out so every suggestion is addable.
  const suggestions = useMemo(
    () => searchDirectory(name, { exclude: excludeSymbols, limit: 6 }),
    [name, excludeSymbols],
  );
  const showList = open && suggestions.length > 0;

  const isOffBroker = (entry: DirectoryEntry) =>
    untradableExchanges.some((m) => canonicalExchange(m) === canonicalExchange(entry.exchange));

  // The market <select> only lists the exchanges already seen in the universe; a
  // picked name may sit on another (e.g. Euronext Amsterdam), so surface it as an
  // option too — otherwise the select would silently fail to show the real market.
  const marketOptions = exchange && !markets.includes(exchange) ? [exchange, ...markets] : markets;

  function reset() {
    setName("");
    setSymbol("");
    setExchange("");
    setError(undefined);
    setOffBroker(undefined);
    setOpen(false);
    setActive(-1);
  }

  function choose(entry: DirectoryEntry) {
    // One pick fills all three fields — the ticker friction this whole control removes.
    setName(entry.name);
    setSymbol(entry.symbol);
    setExchange(entry.exchange);
    setError(undefined);
    setOffBroker(isOffBroker(entry) ? entry.exchange : undefined);
    setOpen(false);
    setActive(-1);
  }

  function onNameChange(value: string) {
    setName(value);
    setOpen(true);
    setActive(-1);
    setOffBroker(undefined);
  }

  function onNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault(); // pick the highlighted row instead of submitting
      choose(suggestions[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const err = onAdd({ name, symbol, exchange: exchange || undefined });
    if (err) {
      setError(err);
      return;
    }
    reset();
  }

  return (
    <section className="watch-bar" aria-label="Add a name to watch">
      <div className="watch-bar-intro">
        <span className="watch-bar-icon">
          <BookmarkPlus aria-hidden="true" size={15} />
        </span>
        <div>
          <strong>Watch your own ideas</strong>
          <span>
            Search a company by name — we fill in its ticker and market — then score it on the same model, your EIFO
            rules and budget. It starts neutral until you refresh its market data.
          </span>
        </div>
      </div>

      <form className="watch-form" onSubmit={submit}>
        <div className="watch-field watch-field-name watch-combo">
          <span className="watch-field-label">Company</span>
          <input
            type="text"
            value={name}
            placeholder="Search a company…"
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={onNameKeyDown}
            onFocus={() => name && setOpen(true)}
            onBlur={() => setOpen(false)}
            aria-label="Company name"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `watch-sug-${active}` : undefined}
            autoComplete="off"
          />
          {showList && (
            <ul className="watch-suggest" id={listId} role="listbox" aria-label="Matching companies">
              {suggestions.map((entry, index) => {
                const off = isOffBroker(entry);
                return (
                  <li
                    key={entry.symbol}
                    id={`watch-sug-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={`watch-suggest-row${index === active ? " is-active" : ""}`}
                    onMouseDown={(event) => {
                      event.preventDefault(); // keep focus; select before the input blurs
                      choose(entry);
                    }}
                    onMouseEnter={() => setActive(index)}
                  >
                    <span className="watch-suggest-name">{entry.name}</span>
                    <span className="watch-suggest-meta">
                      {off && <span className="watch-suggest-off">Off Saxo</span>}
                      <span className="watch-suggest-tkr">{entry.symbol}</span>
                      <span className="watch-suggest-exch">{entry.exchange}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <label className="watch-field watch-field-sym">
          <span>Ticker</span>
          <input
            type="text"
            value={symbol}
            placeholder="TSLA"
            onChange={(event) => setSymbol(event.target.value)}
            aria-label="Ticker symbol"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <label className="watch-field watch-field-exch">
          <span>Market</span>
          <select value={exchange} onChange={(event) => setExchange(event.target.value)} aria-label="Listing market">
            <option value="">Not sure</option>
            {marketOptions.map((market) => (
              <option key={market} value={market}>
                {market}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="watch-add">
          <Plus aria-hidden="true" size={15} />
          <span>Add</span>
        </button>
      </form>

      {error ? (
        <p className="watch-error" role="alert">
          {ADD_WATCH_MESSAGES[error]}
        </p>
      ) : (
        offBroker && (
          <p className="watch-note" role="status">
            Heads up — {offBroker} isn&apos;t on your broker. The model still scores it; you just can&apos;t buy it
            here.
          </p>
        )
      )}

      {watchlist.length > 0 ? (
        <div className="watch-chips" aria-label="Your watched names">
          {watchlist.map((entry) => (
            <span key={entry.symbol} className="watch-chip">
              <strong>{entry.symbol}</strong>
              <span className="watch-chip-name">{entry.name}</span>
              <button
                type="button"
                className="watch-chip-remove"
                aria-label={`Remove ${entry.name} from your watchlist`}
                onClick={() => onRemove(entry.symbol)}
              >
                <X aria-hidden="true" size={13} />
              </button>
            </span>
          ))}
          <span className="watch-hint">
            Skip the terminal — send a name to the integration queue and the daily routine researches, scores &amp;
            ships it to the live dashboard:{" "}
            {watchlist.map((entry, index) => (
              <span key={entry.symbol}>
                {index > 0 && " · "}
                <a className="link-button" href={integrationIssueUrl(entry)} target="_blank" rel="noopener noreferrer">
                  {entry.symbol} ↗
                </a>
              </span>
            ))}
          </span>
        </div>
      ) : (
        <p className="watch-empty">Nothing watched yet. Add a ticker and it appears below, scored like any other name.</p>
      )}
    </section>
  );
}

// The featured idea: the single best name you don't own, framed with whether it
// opens new ground (a theme you hold nothing in) or doubles down on an existing
// tilt — the portfolio-aware context a broker's "top movers" list never carries.
function StandoutIdea({
  rec,
  exposure,
  investability,
  bookValueDkk,
  onSelect,
}: {
  rec: Recommendation;
  exposure: OpportunityOverview["standoutExposure"];
  investability?: Investability;
  bookValueDkk: number;
  onSelect: (symbol: string) => void;
}) {
  const { company } = rec;
  const offLimits = investability && investability.status !== "ok" && investability.status !== "unknown";
  const todayPct = company.market?.dayChangePct;
  const plan = investability ? planPosition(investability, bookValueDkk) : undefined;
  return (
    <button
      type="button"
      className={`standout${offLimits ? " off-limits" : ""}`}
      onClick={() => onSelect(company.symbol)}
      aria-label={`Standout idea: ${company.name}, score ${rec.score}, ${rec.action} — open detail`}
    >
      <div className="standout-eyebrow">↗ Top opportunity · you don&apos;t own it</div>
      <div className="standout-top">
        <span className="standout-name">{company.name}</span>
        {todayPct !== undefined && (
          <span className="standout-return">
            <span className={toneClass(todayPct)}>{formatSignedPct(todayPct)}</span>
            <span className="standout-return-unit">today</span>
          </span>
        )}
      </div>
      <div className="standout-meta">
        <Action action={rec.action} />
        <span className="standout-conv">
          {rec.conviction} conviction · {provenanceLabel(rec)}
        </span>
        {company.userAdded && <WatchBadge />}
        {rec.compliance.status !== "unknown" && (
          <span className={`flag ${rec.compliance.status}`}>{rec.compliance.status.replace("_", " ")}</span>
        )}
        {offLimits && investability && <InvestabilityBadge investability={investability} />}
      </div>
      <p className="standout-why">{rec.headline}</p>
      <p className="standout-fit">{standoutFit(exposure)}</p>
      <LeadTrend market={company.market} />
      {plan ? (
        <BuyPlan plan={plan} variant="hero" />
      ) : (
        investability && investability.status === "ok" && <p className="standout-invest">✓ {investability.note}</p>
      )}
    </button>
  );
}

// The one-line portfolio fit for the standout. Honest in both cases: either the
// theme is genuinely absent from your book, or it adds to a tilt you can quantify.
function standoutFit(exposure: OpportunityOverview["standoutExposure"]): string {
  if (!exposure) return "A name outside your current book.";
  if (exposure.isGap) {
    return `Opens new ground — your book has no ${prettyTheme(exposure.theme)} exposure today.`;
  }
  const holdings = `${exposure.ownedCount} ${exposure.ownedCount === 1 ? "holding" : "holdings"}`;
  return `Adds to your ${prettyTheme(exposure.theme)} tilt — already ${holdings}, ${exposure.ownedWeightPct.toFixed(0)}% of your book.`;
}

// The deploy queue: after the single standout hero, the next-best ideas you can
// CONCRETELY act on — each already sized to your per-trade slot as a whole-share
// buy plan. The grouped ledger below shows every name with only a score and a
// badge; this turns the strongest few into a ranked shortlist of actual moves
// (how many shares, what DKK, what fraction of the slot), gated to what your
// broker can trade at your budget. Ranks continue past the standout (2, 3, …), so
// the number is the true score order of the ideas you can buy. The whole list is
// built by the tested lib/nextMoves from the same investability/sizing helpers the
// standout uses, so it can never disagree. Renders nothing when no priced,
// in-reach idea remains — honest, never a fake or unsized row.
function NextMoves({ moves, onSelect }: { moves: NextMove[]; onSelect: (symbol: string) => void }) {
  if (moves.length === 0) return null;
  return (
    <section className="next-moves" aria-label="More ideas you can act on, sized to your budget">
      <div className="next-moves-head">
        <span className="next-moves-eyebrow">↳ Where your next slot could go</span>
        <span className="next-moves-sub">Ranked by score · sized to your per-trade budget</span>
      </div>
      <ol className="next-moves-list">
        {moves.map((move) => (
          <NextMoveRow key={move.rec.company.symbol} move={move} onSelect={onSelect} />
        ))}
      </ol>
      <p className="next-moves-foot">
        Ranked by the model&apos;s own score among the ideas you can actually buy — on a market your broker trades, at
        your budget. Whole-share plans are sized from the measured price (approximate FX for non-DKK); they never touch
        the score.
      </p>
    </section>
  );
}

// One row of the deploy queue: a ledger line that reads rank · name · sized buy
// plan · score/today. The signature is the compact slot meter — the same green
// "one slot" vocabulary as the full BuyPlan, shrunk to a single line so the rows
// scan as a queue. Every row is a button into the company detail.
function NextMoveRow({ move, onSelect }: { move: NextMove; onSelect: (symbol: string) => void }) {
  const { rec, plan, exposure, rank } = move;
  const { company } = rec;
  const todayPct = company.market?.dayChangePct;
  const fillPct = Math.min(100, Math.round(plan.budgetUse * 100));
  const ofBook = bookPctLabel(plan.bookFraction);
  return (
    <li>
      <button
        type="button"
        className="next-move"
        onClick={() => onSelect(company.symbol)}
        aria-label={`Number ${rank}: ${company.name}, score ${rec.score}, ${rec.action}, ${planHeadline(plan)} — open detail`}
      >
        <span className="next-move-rank" aria-hidden="true">
          {rank}
        </span>
        <span className="next-move-main">
          <span className="next-move-name">
            {company.name} <span className="next-move-ticker">{company.symbol}</span>
            {rec.compliance.status !== "unknown" && (
              <span className={`flag ${rec.compliance.status}`}>{rec.compliance.status.replace("_", " ")}</span>
            )}
          </span>
          <span className="next-move-fit">{moveFit(exposure)}</span>
        </span>
        <span className="next-move-sizing">
          <span className="next-move-figure">{planHeadline(plan)}</span>
          <span className="next-move-meter" aria-hidden="true">
            <span className="next-move-fill" style={{ width: `${fillPct}%` }} />
          </span>
          <span className="next-move-cap">
            {fillPct}% of slot{ofBook ? ` · ~${ofBook} of book` : ""}
          </span>
        </span>
        <span className="next-move-aside">
          <span className="next-move-verdict">
            <Action action={rec.action} />
          </span>
          <span className="next-move-score">
            <span className="lt-score-num">{rec.score}</span>
            {todayPct !== undefined && (
              <span className={`next-move-today ${toneClass(todayPct)}`}>{formatSignedPct(todayPct)}</span>
            )}
          </span>
        </span>
        <span className="lt-chev" aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  );
}

// The compact portfolio-fit line for a queue row: opens new ground (a theme you
// hold nothing in) or adds to a tilt you can quantify — the same honest framing as
// the standout, shortened to one scannable clause.
function moveFit(exposure?: StandoutExposure): string {
  if (!exposure) return "Outside your current book";
  if (exposure.isGap) return `Opens new ground · ${prettyTheme(exposure.theme)}`;
  return `Adds to ${prettyTheme(exposure.theme)} · already ${exposure.ownedWeightPct.toFixed(0)}% of book`;
}

// The decision map: every name on one risk/reward plane — your holdings (filled,
// sized by weight) and the opportunities you don't own (hollow). The synthesis a
// broker can't draw: it only ever shows what you already hold. Score (x) is the
// model's own; risk (y) is the mean of the valuation, balance-sheet and
// geopolitical axes. Pure SVG, no chart dependency; the projection/quadrant math
// is unit-tested in lib/map.ts so the picture can't drift from the numbers.
// The decision board replaces the old score×risk scatter — which, with a real
// (clustered) book, piled markers and labels on top of each other exactly where
// it mattered. It keeps the same synthesis (the model's score against a composite
// risk index) but as four categorical zones the lib already computes: each name is
// binned into its quadrant and ranked by score within it, so the picture is legible
// however many names there are. The four cells are still laid out as a plane
// (risk ↑, score →) so the 2-D mental model survives without the overlap.
const ZONE_ORDER: MapQuadrant[] = ["strong-steady", "strong-risky", "low-priority", "avoid-zone"];

const ZONE_GLOSS: Record<MapQuadrant, string> = {
  "strong-steady": "High score, low risk — where you want names to land.",
  "strong-risky": "High score, but a high risk index — size with care.",
  "low-priority": "Low risk, but the model isn't sold — little urgency.",
  "avoid-zone": "Low score and high risk — the model's least favourite.",
};

function DecisionMap({
  portfolio,
  opportunities,
  opportunityLimit,
  topOpportunitySymbol,
  onSelect,
}: {
  portfolio: Recommendation[];
  opportunities: Recommendation[];
  opportunityLimit: number;
  topOpportunitySymbol?: string;
  onSelect: (symbol: string) => void;
}) {
  const shownOpportunities = opportunities.slice(0, opportunityLimit);
  const points = buildMapPoints(portfolio, shownOpportunities);
  const ownedCount = portfolio.length;

  if (points.length === 0) {
    return (
      <section className="panel" aria-label="Decision map">
        <div className="panel-heading">
          <div>
            <h2>Decision map</h2>
            <span>Score against risk — your book and the field, sorted into four zones</span>
          </div>
        </div>
        <p className="empty">Import a portfolio to map it against the opportunity set.</p>
      </section>
    );
  }

  // Bin every name into its zone, then rank within each zone by score (owned wins
  // ties so your holdings surface first). The zone IS the recommendation.
  const byZone = new Map<MapQuadrant, MapPoint[]>(ZONE_ORDER.map((q) => [q, []]));
  for (const point of points) byZone.get(point.quadrant)!.push(point);
  for (const list of byZone.values()) {
    list.sort((a, b) => b.score - a.score || Number(b.owned) - Number(a.owned));
  }

  return (
    <section className="panel" aria-label="Decision map">
      <div className="panel-heading">
        <div>
          <h2>Decision map</h2>
          <span>Score × risk · four zones — your book and the field, the synthesis a broker can&apos;t draw</span>
        </div>
        <span className="count">{points.length} names</span>
      </div>

      <div className="board-wrap">
        <span className="board-axis-y" aria-hidden="true">
          Risk ↑
        </span>
        <div
          className="board"
          role="group"
          aria-label={`Risk-reward zones for ${ownedCount} holdings and ${shownOpportunities.length} opportunities`}
        >
          {ZONE_ORDER.map((quadrant) => (
            <ZoneCell
              key={quadrant}
              quadrant={quadrant}
              points={byZone.get(quadrant)!}
              topOpportunitySymbol={topOpportunitySymbol}
              onSelect={onSelect}
            />
          ))}
        </div>
        <div className="board-axis-x" aria-hidden="true">
          <span>weaker</span>
          <span>Model score →</span>
          <span>stronger</span>
        </div>
      </div>

      <div className="map-legend">
        <span className="map-key">
          <span className="zone-marker owned" aria-hidden="true" /> Your holdings
        </span>
        <span className="map-key">
          <span className="zone-marker opp" aria-hidden="true" /> Opportunities
        </span>
        <span className="map-key">
          <span className="zone-marker opp flagged" aria-hidden="true" /> EIFO flag
        </span>
        <span className="map-note">Click any name for the breakdown.</span>
      </div>

      <p className="estimate-note">
        Your {ownedCount} {ownedCount === 1 ? "holding" : "holdings"} and the top {shownOpportunities.length} of{" "}
        {opportunities.length} opportunities, binned into four zones by the model score and a composite risk index
        (the mean of the valuation and balance-sheet axes — measured once fundamentals are fetched, editorial
        otherwise — and the always-editorial geopolitical axis), then ranked by score within each zone. A dashed
        marker flags an EIFO compliance concern.
      </p>
    </section>
  );
}

// One zone of the board: a tinted cell holding the names that fall in that
// score×risk quadrant, ranked by score. Long zones cap to the top few with a
// "+N more" toggle so a crowded sweet spot never blows out the grid.
function ZoneCell({
  quadrant,
  points,
  topOpportunitySymbol,
  onSelect,
}: {
  quadrant: MapQuadrant;
  points: MapPoint[];
  topOpportunitySymbol?: string;
  onSelect: (symbol: string) => void;
}) {
  const CAP = 7;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? points : points.slice(0, CAP);
  const hidden = points.length - visible.length;
  return (
    <div className={`zone zone-${quadrant}`}>
      <div className="zone-head">
        <span className="zone-name">{QUADRANT_LABELS[quadrant]}</span>
        <span className="zone-count">{points.length}</span>
      </div>
      <p className="zone-gloss">{ZONE_GLOSS[quadrant]}</p>
      {points.length === 0 ? (
        <p className="zone-empty">No names here.</p>
      ) : (
        <ul className="zone-list">
          {visible.map((point) => (
            <ZoneChip
              key={point.symbol}
              point={point}
              isTopOpp={!point.owned && point.symbol === topOpportunitySymbol}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
      {points.length > CAP && (
        <button type="button" className="zone-more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show fewer" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}

// One name in a zone: a clickable row carrying the ownership marker (filled =
// owned, hollow = opportunity, dashed = EIFO-flagged, blue = the lead idea), the
// company name, a weight tag for holdings, and the model score coloured by verdict.
function ZoneChip({
  point,
  isTopOpp,
  onSelect,
}: {
  point: MapPoint;
  isTopOpp: boolean;
  onSelect: (symbol: string) => void;
}) {
  const flagged = point.compliance !== "unknown";
  const label = `${point.name}: ${point.action}, score ${point.score}, risk ${point.risk}, ${
    point.owned ? `${point.weightPct.toFixed(1)}% of your book` : "not owned"
  }${flagged ? `, EIFO ${point.compliance.replace("_", " ")}` : ""}`;
  return (
    <li>
      <button
        type="button"
        className={`zone-chip${isTopOpp ? " top-opp" : ""}`}
        aria-label={label}
        onClick={() => onSelect(point.symbol)}
      >
        <span
          className={`zone-marker ${point.owned ? "owned" : "opp"}${flagged ? " flagged" : ""}${
            isTopOpp ? " top-opp" : ""
          }`}
          aria-hidden="true"
        />
        <span className="zone-chip-name">{point.name}</span>
        {point.owned ? (
          <span className="zone-chip-weight">{point.weightPct.toFixed(0)}%</span>
        ) : isTopOpp ? (
          <span className="zone-chip-tag">↗ lead</span>
        ) : null}
        <span className={`zone-chip-score ${point.action}`}>{point.score}</span>
      </button>
    </li>
  );
}

// Map an action to a colour tone class. Namespaced (go/hold/trim/avoid) so it
// never collides with the global action-pill colour classes of the same name.
function mapTone(action: Recommendation["action"]): string {
  if (action === "increase" || action === "investigate") return "go";
  if (action === "hold" || action === "watch") return "hold";
  if (action === "trim") return "trim";
  return "avoid";
}

// The head-to-head Compare view: two names on one "tale of the tape". The
// signature is the diverging axis chart — each scoring driver mirrored across a
// centre spine, the leader's bar in the accent, the trailing one muted — so you
// can read at a glance who wins each axis. The call a broker dashboard can't
// make: it has no model score, and only ever shows what you already own. Every
// number is the model's own (reused from the dashboard recommendations), so the
// comparison can never disagree with the detail view; the synthesis logic and
// axis math are unit-tested in lib/compare.ts.
function CompareView({
  left,
  right,
  comparison,
  options,
  onChangeLeft,
  onChangeRight,
  onSwap,
  onSelect,
}: {
  left: Recommendation;
  right: Recommendation;
  comparison: Comparison;
  options: Recommendation[];
  onChangeLeft: (symbol: string) => void;
  onChangeRight: (symbol: string) => void;
  onSwap: () => void;
  onSelect: (symbol: string) => void;
}) {
  const sameName = left.company.symbol === right.company.symbol;
  return (
    <section className="panel compare-panel" aria-label="Compare two names">
      <div className="panel-heading">
        <div>
          <h2>Compare</h2>
          <span>Two names, head to head — the call your broker can&apos;t make</span>
        </div>
      </div>

      <div className="cmp-pickers">
        <CompanyPicker label="First name" value={left.company.symbol} options={options} onChange={onChangeLeft} />
        <button type="button" className="cmp-swap" onClick={onSwap} aria-label="Swap the two names">
          <GitCompareArrows aria-hidden="true" size={16} />
          <span>Swap</span>
        </button>
        <CompanyPicker label="Second name" value={right.company.symbol} options={options} onChange={onChangeRight} />
      </div>

      {sameName ? (
        <p className="empty">Pick two different names to compare them.</p>
      ) : (
        <>
          <div className="cmp-cards">
            <CompareCard rec={left} side="a" leader={comparison.leader} onSelect={onSelect} />
            <span className="cmp-versus" aria-hidden="true">
              vs
            </span>
            <CompareCard rec={right} side="b" leader={comparison.leader} onSelect={onSelect} />
          </div>

          <TaleOfTheTape comparison={comparison} leftName={left.company.name} rightName={right.company.name} />

          <p className={`cmp-verdict ${comparison.leader}`}>{comparison.verdict}</p>
          <p className="estimate-note">
            Bars are the model&apos;s own 0–100 driver levels, higher is better (valuation and balance-sheet risk
            inverted). An axis reads <em>measured</em> only when both names have fetched data; otherwise at least one
            side is an editorial estimate. Score and action are the same the rest of the dashboard shows.
          </p>
        </>
      )}
    </section>
  );
}

function CompanyPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Recommendation[];
  onChange: (symbol: string) => void;
}) {
  const owned = options.filter((rec) => rec.holding);
  const ideas = options.filter((rec) => !rec.holding);
  return (
    <label className="cmp-picker">
      <span className="cmp-picker-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {owned.length > 0 && (
          <optgroup label="Your holdings">
            {owned.map((rec) => (
              <option key={rec.company.symbol} value={rec.company.symbol}>
                {rec.company.name} · score {rec.score}
              </option>
            ))}
          </optgroup>
        )}
        {ideas.length > 0 && (
          <optgroup label="Opportunities you don't own">
            {ideas.map((rec) => (
              <option key={rec.company.symbol} value={rec.company.symbol}>
                {rec.company.name} · score {rec.score}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function CompareCard({
  rec,
  side,
  leader,
  onSelect,
}: {
  rec: Recommendation;
  side: Side;
  leader: Side;
  onSelect: (symbol: string) => void;
}) {
  const { company, holding, compliance } = rec;
  const isLeader = leader === side;
  return (
    <button
      type="button"
      className={`cmp-card ${isLeader ? "is-leader" : ""}`}
      onClick={() => onSelect(company.symbol)}
      aria-label={`${company.name}, score ${rec.score}, ${rec.action}${isLeader ? ", the model's pick" : ""} — open detail`}
    >
      {isLeader && <span className="cmp-pick">Model&apos;s pick</span>}
      <ScoreRing score={rec.score} action={rec.action} />
      <strong className="cmp-card-name">{company.name}</strong>
      <span className="cmp-card-sym">
        {company.symbol} · {holding ? "you own it" : "opportunity"}
      </span>
      <div className="cmp-card-meta">
        <Action action={rec.action} />
        {compliance.status !== "unknown" && (
          <span className={`flag ${compliance.status}`}>{compliance.status.replace("_", " ")}</span>
        )}
      </div>
      {holding ? (
        <span className={`cmp-card-return ${toneClass(holding.totalReturnPct)}`}>
          {formatSignedPct(holding.totalReturnPct)} total · from Saxo
        </span>
      ) : company.market?.dayChangePct !== undefined ? (
        <span className={`cmp-card-return ${toneClass(company.market.dayChangePct)}`}>
          {formatSignedPct(company.market.dayChangePct)} today
        </span>
      ) : null}
    </button>
  );
}

// The signature element: each driver mirrored across a centre spine. The leading
// side's bar and value carry the accent; the trailing side is muted; a tie keeps
// both quiet. Reads as a stat sheet, not chartjunk — one row per axis, the gap is
// the story.
function TaleOfTheTape({
  comparison,
  leftName,
  rightName,
}: {
  comparison: Comparison;
  leftName: string;
  rightName: string;
}) {
  return (
    <div className="tape" role="table" aria-label={`Driver comparison: ${leftName} versus ${rightName}`}>
      <div className="tape-head" role="row">
        <span className="tape-head-a" role="columnheader">
          {leftName}
        </span>
        <span className="tape-head-axis" role="columnheader" aria-hidden="true" />
        <span className="tape-head-b" role="columnheader">
          {rightName}
        </span>
      </div>
      {comparison.axes.map((axis) => (
        <div className="tape-row" role="row" key={axis.label}>
          <span className={`tape-val a ${axis.leader === "a" ? "lead" : ""}`} role="cell">
            {axis.a}
          </span>
          <span className="tape-track a" aria-hidden="true">
            <span
              className={`tape-fill ${axis.leader === "a" ? "lead" : axis.leader === "b" ? "trail" : "tie"}`}
              style={{ width: `${axis.a}%` }}
            />
          </span>
          <span className="tape-axis" role="rowheader">
            {axis.label}
            <em>{axis.provenance}</em>
          </span>
          <span className="tape-track b" aria-hidden="true">
            <span
              className={`tape-fill ${axis.leader === "b" ? "lead" : axis.leader === "a" ? "trail" : "tie"}`}
              style={{ width: `${axis.b}%` }}
            />
          </span>
          <span className={`tape-val b ${axis.leader === "b" ? "lead" : ""}`} role="cell">
            {axis.b}
          </span>
        </div>
      ))}
    </div>
  );
}

function CompanyDetail({
  recommendation,
  context,
  peers,
  investability,
  bookValueDkk,
  onBack,
  onSelect,
}: {
  recommendation: Recommendation;
  context?: HoldingContext;
  peers?: PeerComparison;
  investability?: Investability;
  bookValueDkk: number;
  onBack: () => void;
  onSelect: (symbol: string) => void;
}) {
  const { company, compliance, holding } = recommendation;
  const market = company.market;
  const plan = investability ? planPosition(investability, bookValueDkk) : undefined;

  return (
    <section className="detail">
      <button type="button" className="detail-back" onClick={onBack}>
        ‹ Back to holdings
      </button>

      <div className="detail-hero">
        <div>
          <span className="detail-symbol">
            {company.symbol} · {company.region}
          </span>
          <h2>{company.name}</h2>
          <p className="detail-hero-theme">{company.themes.map(prettyTheme).join(" · ")}</p>
        </div>
        <div className="detail-action">
          <div className="detail-score">
            <span className={`detail-score-num ${recommendation.action}`}>{recommendation.score}</span>
            <span className="detail-score-max">/100</span>
          </div>
          <Action action={recommendation.action} />
          <div className="detail-conv">
            {recommendation.conviction} conviction · {provenanceLabel(recommendation)}
          </div>
        </div>
      </div>

      <p className="headline">{recommendation.headline}</p>

      <div className="analysis">
        <article className="card">
          <h3>Why this score · input levels 0–100</h3>
          {compliance.status === "blocked" ? (
            <p className="micro-cap">Score forced to 0 by EIFO policy — the model weighting below is not applied.</p>
          ) : (
            <>
              <p className="micro-cap">Weighted pull on the score</p>
              <ScoreDrivers company={company} complianceStatus={compliance.status} />
            </>
          )}
          <p className="micro-cap micro-cap-spaced">Input levels (0–100)</p>
          <DriverBars company={company} />
          <p className="estimate-note">
            Momentum, growth, quality, valuation and balance-sheet risk are measured from live data when available;
            AI exposure and geopolitical risk are editorial thesis inputs.
          </p>
        </article>
        <article className="card">
          <h3>Reasoning</h3>
          {recommendation.reasoning.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
          <p className="downside">
            <span className="downside-label">Downside · </span>
            {recommendation.downside}
          </p>
        </article>
      </div>

      <div className={`compliance ${compliance.status}`}>
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <strong>EIFO: {compliance.status.replace("_", " ")}</strong>
          {compliance.flags.map((flag) => (
            <span key={flag}>{flag}</span>
          ))}
          {compliance.notes?.map((note) => (
            <span key={note} className="note">
              ↳ {note}
            </span>
          ))}
          <span className="note">Source: {compliance.source}</span>
        </div>
      </div>

      {investability && investability.status !== "unknown" && (
        <div className={`investability ${investability.status}`} aria-label="whether you can act on this">
          {investability.status === "not_tradable" ? (
            <Landmark size={18} aria-hidden="true" />
          ) : investability.status === "above_budget" ? (
            <Wallet size={18} aria-hidden="true" />
          ) : (
            <ShieldCheck size={18} aria-hidden="true" />
          )}
          <div>
            <strong>{investabilityTitle(investability)}</strong>
            <span>{plan ? describePlan(plan) : investability.note}</span>
            {plan && <BuyPlan plan={plan} variant="detail" />}
          </div>
        </div>
      )}

      {market && (
        <article className="card market-card">
          <h3>Market context</h3>
          {market.history && market.history.length > 1 ? (
            <PricePath market={market} />
          ) : (
            market.fiftyTwoWeekLow !== undefined &&
            market.fiftyTwoWeekHigh !== undefined && (
              <RangeBar low={market.fiftyTwoWeekLow} high={market.fiftyTwoWeekHigh} price={market.price} currency={market.currency} />
            )
          )}
          <div className="context-stats">
            <Stat label="Today" value={formatSignedPct(market.dayChangePct)} tone={toneOf(market.dayChangePct ?? 0)} />
            <Stat label="3M / 6M" value={`${formatSignedPct(market.return3m)} · ${formatSignedPct(market.return6m)}`} tone={toneOf(market.return3m ?? 0)} />
            <Stat label="Momentum" value={`${market.momentum}/100`} />
            {market.fundamentals && (
              <>
                <Stat label="Fwd P/E" value={formatRatio(market.fundamentals.forwardPE)} />
                <Stat label="Rev. growth" value={formatSignedPct(toPct(market.fundamentals.revenueGrowth))} tone={toneOf(market.fundamentals.revenueGrowth ?? 0)} />
                <Stat label="Profit margin" value={formatSignedPct(toPct(market.fundamentals.profitMargins))} tone={toneOf(market.fundamentals.profitMargins ?? 0)} />
              </>
            )}
          </div>
        </article>
      )}

      <DeepDiveLinks company={company} />

      {peers && peers.count > 1 && <ThemePeers comparison={peers} onSelect={onSelect} />}

      {context && holding && (
        <article className="card" aria-label="this holding within your portfolio">
          <h3>In your portfolio</h3>
          <div className="context-stats">
            <Stat label="By size" value={sizeLabel(context.sizeRank, context.count)} />
            <Stat label="By risk" value={riskLabel(context.riskRank, context.count)} />
          </div>
          <p className="estimate-note">
            {context.count > 1
              ? `Ranked across your ${context.count} holdings — largest risk axis here is ${context.riskFactor} (${riskFactorProvenance(context.riskFactor, Boolean(company.market?.fundamentals))}). A cross-portfolio synthesis your broker doesn't provide.`
              : `Your only holding — largest risk axis here is ${context.riskFactor} (${riskFactorProvenance(context.riskFactor, Boolean(company.market?.fundamentals))}).`}
          </p>
        </article>
      )}

      {holding && (
        <div className="broker-strip" aria-label="your position from your broker">
          <span className="broker-tag">From Saxo</span>
          <Stat label="Position" value={`${formatNumber(holding.quantity)} sh`} />
          <Stat label="Value" value={`DKK ${formatNumber(holding.marketValueDkk)}`} />
          <Stat
            label="Total"
            value={`${formatSignedPct(holding.totalReturnPct)} · DKK ${formatSigned(holding.totalGainDkk ?? 0)}`}
            tone={toneOf(holding.totalGainDkk ?? 0)}
          />
          <Stat label="Weight" value={`${holding.portfolioWeight.toFixed(1)}%`} />
        </div>
      )}
    </section>
  );
}

// The theme-peer ladder: where this name ranks among the universe companies doing
// the same thing, by the model's own score. Ownership reuses the decision map's
// vocabulary (filled marker = you own it, hollow ring = an opportunity) so the two
// charts speak the same language; the bar colour reuses the action palette. The
// point a broker can't give: it calls out the higher-scoring names you do NOT own.
function ThemePeers({
  comparison,
  onSelect,
}: {
  comparison: PeerComparison;
  onSelect: (symbol: string) => void;
}) {
  const { theme, peers, rank, count, higherUnowned } = comparison;
  return (
    <article className="card peers-card" aria-label={`theme peers in ${prettyTheme(theme)}`}>
      <div className="peers-head">
        <h3>Theme peers</h3>
        <span className="peers-theme">{prettyTheme(theme)}</span>
      </div>
      <p className="micro-cap peers-rank">
        Ranks {ordinal(rank)} of {count} by model score
      </p>
      <ol className="peer-ladder">
        {peers.map((peer) => {
          const flagged = peer.compliance !== "unknown";
          const label = `${peer.name}: score ${peer.score}, ${peer.action}, ${
            peer.owned ? "you own it" : "you don't own it"
          }${flagged ? `, EIFO ${peer.compliance.replace("_", " ")}` : ""}`;
          return (
            <li key={peer.symbol}>
              <button
                type="button"
                className={`peer-row ${peer.selected ? "is-selected" : ""}`}
                onClick={() => onSelect(peer.symbol)}
                aria-current={peer.selected ? "true" : undefined}
                aria-label={label}
              >
                <span
                  className={`peer-marker ${peer.owned ? "owned" : "opp"}${flagged ? " flagged" : ""}`}
                  aria-hidden="true"
                />
                <span className="peer-name">
                  <span className="peer-name-text">{peer.name}</span>
                  {peer.selected && <em className="peer-here">this name</em>}
                  {!peer.owned && <span className="peer-tag">opportunity</span>}
                </span>
                <span className="peer-track" aria-hidden="true">
                  <span
                    className={`peer-fill ${mapTone(peer.action)}`}
                    style={{ width: `${Math.max(0, Math.min(100, peer.score))}%` }}
                  />
                </span>
                <span className="peer-score">{peer.score}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="estimate-note">
        {peerSynthesis(rank, theme, higherUnowned.map((p) => p.name))} Filled marker = you own it; hollow ring = an
        opportunity. A dashed ring marks an EIFO compliance flag. Ranked by the model&apos;s score — not your broker&apos;s.
      </p>
    </article>
  );
}

// The one-line synthesis above the legend. Honest about ownership in every case:
// either the named higher-scoring opportunities, or why there are none.
function peerSynthesis(rank: number, theme: string, higherUnowned: string[]): string {
  if (higherUnowned.length > 0) {
    const names = higherUnowned.join(", ");
    return `${higherUnowned.length} ${higherUnowned.length === 1 ? "name" : "names"} you don't own score higher: ${names}.`;
  }
  if (rank === 1) return `Tops its ${prettyTheme(theme)} peers on the model's score.`;
  return `No name you don't own scores higher in ${prettyTheme(theme)}.`;
}

// Explains the model's central score by the signed, weighted pull of each input
// — the synthesis a broker cannot give (a broker has no model score at all).
// Direction is encoded by colour (green lifts, warm-red drags); provenance keeps
// the measured/editorial/policy discipline as a label, never relabelling one as
// the other. Bars are scaled to the largest absolute contribution, so the chart
// shows relative influence, not a literal decomposition of the rounded score.
function ScoreDrivers({ company, complianceStatus }: { company: Company; complianceStatus: ComplianceStatus }) {
  const contributions = scoreContributions(company, complianceStatus)
    .filter((c) => Math.abs(c.points) >= 0.05)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const max = contributions.reduce((m, c) => Math.max(m, Math.abs(c.points)), 1);
  return (
    <div className="contribs">
      {contributions.map((c) => {
        const positive = c.points > 0;
        const width = (Math.abs(c.points) / max) * 50;
        return (
          <div className="contrib" key={c.label}>
            <span className="contrib-label">
              {c.label} <em>{c.provenance}</em>
            </span>
            <div className="contrib-track">
              <span className="contrib-mid" aria-hidden="true" />
              <span
                className={`contrib-fill ${positive ? "pos" : "neg"}`}
                style={positive ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
              />
            </div>
            <span className={`contrib-val ${positive ? "tone-up" : "tone-down"}`}>
              {positive ? "+" : "−"}
              {Math.abs(c.points).toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DriverBars({ company }: { company: Company }) {
  const fundamentals = Boolean(company.market?.fundamentals);
  const momentum = Boolean(company.market);
  const drivers = [
    { label: "Momentum", value: company.momentum, measured: momentum },
    { label: "Growth", value: company.growth, measured: fundamentals },
    { label: "Quality", value: company.quality, measured: fundamentals },
    { label: "Value (vs risk)", value: 100 - company.valuationRisk, measured: fundamentals },
    { label: "Balance sheet", value: 100 - company.balanceSheetRisk, measured: fundamentals },
    { label: "AI exposure", value: company.aiExposure, measured: false },
  ];
  return (
    <div className="drivers">
      {drivers.map((d) => (
        <div className="driver" key={d.label}>
          <span className="driver-label">
            {d.label} <em>{d.measured ? "measured" : "editorial"}</em>
          </span>
          <div className="driver-track">
            <div className={`driver-fill ${d.measured ? "m" : "e"}`} style={{ width: `${Math.max(0, Math.min(100, d.value))}%` }} />
          </div>
          <span className="driver-val">{Math.round(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

// The price-path chart: the trailing-year price line a broker also draws — but
// annotated with the dashboard's own measured analysis so it says something Saxo's
// chart doesn't. The 52-week high/low band ties to the range bar's numbers; the
// ~3M and ~6M anchors mark exactly where the momentum lookback windows begin, so
// the abstract "Momentum 61/100 · 3M +12%" stats become visually verifiable on the
// same line. Pure SVG, no chart dependency; the geometry is unit-tested in
// lib/sparkline.ts (the line IS the measured series momentum is derived from).
const PRICE_DIMS: ChartDims = { width: 640, height: 156, padX: 12, padTop: 18, padBottom: 26 };

function PricePath({ market }: { market: MarketSnapshot }) {
  const history = market.history ?? [];
  const chart = buildPriceChart(history, PRICE_DIMS, {
    high: market.fiftyTwoWeekHigh,
    low: market.fiftyTwoWeekLow,
  });
  if (!chart) {
    return market.fiftyTwoWeekLow !== undefined && market.fiftyTwoWeekHigh !== undefined ? (
      <RangeBar low={market.fiftyTwoWeekLow} high={market.fiftyTwoWeekHigh} price={market.price} currency={market.currency} />
    ) : null;
  }

  const { width, height, padX } = PRICE_DIMS;
  const rising = chart.last.value >= chart.first.value;
  const hasBand = market.fiftyTwoWeekHigh !== undefined && market.fiftyTwoWeekLow !== undefined;
  const baselineY = height - PRICE_DIMS.padBottom;

  // Anchor the trailing-return windows on the line. Drawn only when the series is
  // long enough to place them away from the latest point.
  const anchors = [
    { months: 6, label: "6M", ret: market.return6m },
    { months: 3, label: "3M", ret: market.return3m },
  ]
    .map((a) => ({ ...a, point: chart.points[monthsAgoIndex(chart.points.length, a.months)] }))
    .filter((a) => a.point && a.point.index < chart.points.length - 2);

  const summary = `Price over the past year, ${formatPrice(chart.first.value)} to ${formatPrice(
    market.price,
  )} ${market.currency}${hasBand ? `, 52-week range ${formatPrice(market.fiftyTwoWeekLow!)} to ${formatPrice(market.fiftyTwoWeekHigh!)}` : ""}.`;

  return (
    <div className="pricepath">
      <svg className="pricepath-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
        <title>{summary}</title>
        <defs>
          <linearGradient id="pricepath-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className={`pp-grad-top ${rising ? "up" : "down"}`} />
            <stop offset="100%" className="pp-grad-bottom" />
          </linearGradient>
        </defs>

        {/* 52-week band: the same high/low the range bar reads, as reference lines. */}
        {hasBand && (
          <>
            <line className="pp-band" x1={padX} y1={chart.yFor(market.fiftyTwoWeekHigh!)} x2={width - padX} y2={chart.yFor(market.fiftyTwoWeekHigh!)} />
            <line className="pp-band" x1={padX} y1={chart.yFor(market.fiftyTwoWeekLow!)} x2={width - padX} y2={chart.yFor(market.fiftyTwoWeekLow!)} />
            <text className="pp-band-label" x={width - padX} y={chart.yFor(market.fiftyTwoWeekHigh!) - 4} textAnchor="end">
              52w high · {formatPrice(market.fiftyTwoWeekHigh!)}
            </text>
            <text className="pp-band-label" x={width - padX} y={chart.yFor(market.fiftyTwoWeekLow!) + 12} textAnchor="end">
              52w low · {formatPrice(market.fiftyTwoWeekLow!)}
            </text>
          </>
        )}

        <path className={`pp-area ${rising ? "up" : "down"}`} d={chart.areaPath} fill="url(#pricepath-fill)" />
        <path className={`pp-line ${rising ? "up" : "down"}`} d={chart.linePath} />

        {/* Momentum-window anchors: where the 3M / 6M trailing returns are measured from. */}
        {anchors.map((a) => (
          <g className="pp-anchor" key={a.label}>
            <line className="pp-anchor-tick" x1={a.point.x} y1={a.point.y} x2={a.point.x} y2={baselineY} />
            <circle className="pp-anchor-dot" cx={a.point.x} cy={a.point.y} r={3} />
            <text className="pp-anchor-label" x={a.point.x} y={baselineY + 13} textAnchor="middle">
              ~{a.label}
              {a.ret !== undefined ? ` · ${formatSignedPct(a.ret)}` : ""}
            </text>
          </g>
        ))}

        {/* Latest price. */}
        <circle className={`pp-now ${rising ? "up" : "down"}`} cx={chart.last.x} cy={chart.last.y} r={4} />
        <text className={`pp-now-label ${rising ? "up" : "down"}`} x={chart.last.x} y={chart.last.y - 9} textAnchor="end">
          {formatPrice(market.price)} {market.currency}
        </text>

        <text className="pp-axis" x={padX} y={height - 6} textAnchor="start">1Y ago</text>
        <text className="pp-axis" x={width - padX} y={height - 6} textAnchor="end">now</text>
      </svg>
      <p className="estimate-note pricepath-note">
        Measured close prices over the past year — the same series momentum is derived from. The ~3M and ~6M ticks mark
        roughly where each measured trailing-return window begins; the band is the 52-week range. Annotation your
        broker&apos;s chart doesn&apos;t draw.
      </p>
    </div>
  );
}

function RangeBar({ low, high, price, currency }: { low: number; high: number; price: number; currency: string }) {
  const pos = high > low ? Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100)) : 50;
  return (
    <div className="range">
      <span className="range-end">{formatPrice(low)}</span>
      <div className="range-track">
        <div className="range-marker" style={{ left: `${pos}%` }}>
          <span className="range-price">{formatPrice(price)} {currency}</span>
        </div>
      </div>
      <span className="range-end">{formatPrice(high)}</span>
    </div>
  );
}

// The "go deeper" exit: external links to the full chart, news and financials the
// dashboard doesn't try to re-render. The product keeps the verdict (score, EIFO,
// the buy plan); this hands off to the source for the whole story — and it's the
// only way to research a name your broker hides outright (Saxo can't show you a
// Korea Exchange listing at all). Every link is one we're confident resolves
// (see lib/externalResearch); a name with nothing safe to link to renders nothing.
function DeepDiveLinks({ company }: { company: Company }) {
  const links = useMemo(() => researchLinks(company), [company]);
  if (links.length === 0) return null;
  return (
    <div className="deepdive" aria-label={`Research ${company.name} on an external site`}>
      <span className="deepdive-eyebrow">Go deeper · opens a new tab</span>
      <div className="deepdive-links">
        {links.map((link) => (
          <a
            key={link.provider}
            className="deepdive-link"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${link.label} — ${link.detail} (opens in a new tab)`}
          >
            <span className="deepdive-link-text">
              <span className="deepdive-link-name">{link.label}</span>
              <span className="deepdive-link-detail">{link.detail}</span>
            </span>
            <ArrowUpRight aria-hidden="true" size={14} />
          </a>
        ))}
      </div>
    </div>
  );
}

function ScoreRing({ score, action, large }: { score: number; action: Recommendation["action"]; large?: boolean }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(100, score)) / 100);
  // The ring is the dashboard's central decision metric. Expose it to assistive
  // technology as a single labelled image (role="img" so the inner <text> isn't
  // announced on its own as a bare, context-free number); sighted layout is
  // unchanged.
  return (
    <svg
      className={`ring ${large ? "ring-lg" : ""}`}
      viewBox="0 0 48 48"
      role="img"
      aria-label={`Score ${score} of 100`}
    >
      <circle className="ring-track" cx="24" cy="24" r={r} />
      <circle
        className={`ring-arc ${action}`}
        cx="24"
        cy="24"
        r={r}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 24 24)"
      />
      <text className="ring-num" x="24" y="24" dominantBaseline="central" textAnchor="middle">
        {score}
      </text>
    </svg>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
    </div>
  );
}

function Action({ action }: { action: Recommendation["action"] }) {
  return <span className={`action ${action}`}>{action}</span>;
}

function prettyTheme(theme: string): string {
  return theme.replace(/-/g, " ");
}

function ordinal(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

function sizeLabel(rank: number, count: number): string {
  if (count <= 1) return "Only position";
  if (rank === 1) return "Largest";
  if (rank === count) return "Smallest";
  return `${ordinal(rank)} largest`;
}

function riskLabel(rank: number, count: number): string {
  if (count <= 1) return "Only position";
  if (rank === 1) return "Riskiest";
  if (rank === count) return "Lowest risk";
  return `${ordinal(rank)}-riskiest`;
}

// Provenance of the named risk axis, matching the measured/editorial discipline
// the rest of the detail view follows. Geopolitical risk is always editorial;
// compliance is policy-driven; valuation and balance-sheet risk are measured
// from fundamentals when a refresh has run, otherwise editorial estimates.
function riskFactorProvenance(riskFactor: RiskFactor, fundamentalsMeasured: boolean): string {
  if (riskFactor === RISK_FACTORS.compliance) return "policy";
  if (riskFactor === RISK_FACTORS.geopolitical) return "editorial";
  return fundamentalsMeasured ? "measured" : "editorial";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatSigned(value: number): string {
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(value));
  return `${value < 0 ? "−" : "+"}${formatted}`;
}

function formatSignedPct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(2));
  const sign = rounded < 0 ? "−" : rounded > 0 ? "+" : "";
  return `${sign}${Math.abs(rounded).toFixed(2)}%`;
}

function toneOf(value: number): "up" | "down" | undefined {
  if (value > 0.005) return "up";
  if (value < -0.005) return "down";
  return undefined;
}

function toneClass(value: number | undefined): string {
  if (value === undefined || value === 0) return "";
  return value > 0 ? "tone-up" : "tone-down";
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatRatio(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  return `${value.toFixed(1)}×`;
}

function toPct(fraction: number | undefined): number | undefined {
  return fraction === undefined || !Number.isFinite(fraction) ? undefined : fraction * 100;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "earlier";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
