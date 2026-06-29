import {
  AlertTriangle,
  Ban,
  BookmarkPlus,
  FileUp,
  GitCompareArrows,
  Landmark,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { complianceOverrides } from "./data/complianceOverrides";
import { seedHoldings } from "./data/portfolioSeed";
import { universe } from "./data/universe";
import { buildDashboardModel } from "./lib/dashboard";
import { buildInsights, RISK_FACTORS, type HoldingContext, type RiskFactor } from "./lib/insights";
import {
  buildMapPoints,
  markerRadius,
  projectPoint,
  QUADRANT_LABELS,
  RISK_MIDLINE,
  SCORE_MIDLINE,
  type MapPoint,
  type PlaneDims,
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
import { buildPeerComparison, type PeerComparison } from "./lib/peers";
import { parsePortfolioCsv } from "./lib/portfolio";
import { buildPriceChart, monthsAgoIndex, type ChartDims } from "./lib/sparkline";
import { scoreContributions } from "./lib/recommendations";
import { mergeExternalSignals, type ExternalSignalSnapshot } from "./lib/signals";
import { clearPortfolio, loadPortfolio, savePortfolio } from "./lib/storage";
import {
  assessInvestability,
  investableSymbols,
  summarizeInvestability,
  type BrokerSettings,
  type Investability,
  type InvestabilitySummary,
} from "./lib/investability";
import { loadBrokerSettings, saveBrokerSettings } from "./lib/brokerSettings";
import { bookPctLabel, describePlan, planHeadline, planPosition, type PositionPlan } from "./lib/positionPlan";
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
  // Markets present in the curated universe — the toggle set the user picks from.
  // Drop editorial placeholders that aren't real public venues (private/pre-IPO
  // proxies, unknown imports) so the control only lists markets a broker can map to.
  const knownMarkets = useMemo(() => {
    const notAVenue = new Set(["Private proxy", "Unknown"]);
    return [...new Set(universe.map((company) => company.exchange))]
      .filter((exchange) => !notAVenue.has(exchange))
      .sort((a, b) => a.localeCompare(b));
  }, []);
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

  // NAV-hero deltas, all from real model totals. Today's percent is derived from
  // the aggregate day gain against yesterday's value (NAV minus today's gain).
  const navToday =
    model.totalMarketValueDkk - model.dayGainDkk > 0
      ? (model.dayGainDkk / (model.totalMarketValueDkk - model.dayGainDkk)) * 100
      : 0;
  // A measured DKK NAV series for the hero sparkline — undefined in demo mode
  // (no fetched history), in which case the inset shows a graceful empty state.
  const navSeries = useMemo(() => buildPortfolioSeries(model.portfolio), [model.portfolio]);

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
          <span className={`live${hasLiveMarket ? "" : " stale"}`} aria-label="data freshness">
            <span className="live-dot" aria-hidden="true" />
            {hasLiveMarket
              ? `LIVE · YHOO${dataAsOf ? ` · ${formatLiveStamp(dataAsOf)}` : ""}`
              : "EDITORIAL · NPM RUN REFRESH"}
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
        valueDkk={model.totalMarketValueDkk}
        totalPct={model.totalReturnPct}
        totalGainDkk={model.totalGainDkk}
        todayPct={navToday}
        series={navSeries}
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
        {source.label} · DKK {formatNumber(model.totalMarketValueDkk)} · {formatSignedPct(model.totalReturnPct)} total
      </p>

      <div className="view" key={view}>
        {view === "portfolio" && (
          <PortfolioView portfolio={model.portfolio} insights={insights} nextBuy={nextBuy} onSelect={open} />
        )}
        {view === "opportunities" && (
          <OpportunitiesOverview
            overview={opportunityOverview}
            summary={investSummary}
            settings={brokerSettings}
            markets={knownMarkets}
            onChangeSettings={updateBrokerSettings}
            investabilityFor={investabilityFor}
            bookValueDkk={model.totalMarketValueDkk}
            hideOffLimits={hideOffLimits}
            onToggleOffLimits={setHideOffLimits}
            watchlist={watchlist}
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
}: {
  valueDkk: number;
  totalPct: number;
  totalGainDkk: number;
  todayPct: number;
  series?: number[];
}) {
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
      </div>
      <NavSpark series={series} totalPct={totalPct} />
    </section>
  );
}

const SPARK_DIMS: ChartDims = { width: 340, height: 80, padX: 6, padTop: 6, padBottom: 6 };

function NavSpark({ series, totalPct }: { series?: number[]; totalPct: number }) {
  const chart = series && series.length >= 2 ? buildPriceChart(series, SPARK_DIMS) : undefined;
  const [startLabel, endLabel] = trailingMonthLabels();
  const rising = chart ? chart.last.value >= chart.first.value : totalPct >= 0;
  return (
    <div className="nav-spark">
      <div className="nav-spark-head">
        <span>Portfolio · trailing 12 months</span>
        <span className={`total ${totalPct >= 0 ? "tone-up" : "tone-down"}`}>{formatSignedPct(totalPct)}</span>
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
function PortfolioView({
  portfolio,
  insights,
  nextBuy,
  onSelect,
}: {
  portfolio: Recommendation[];
  insights: ReturnType<typeof buildInsights>;
  nextBuy?: NextBuy;
  onSelect: (symbol: string) => void;
}) {
  const { needsAttention, concentration, compliance, tilt } = insights;
  // Roll the owned book up into a primary-theme partition — what the money is actually
  // betting on, counted once per holding. The full-width band below the ledger.
  const composition = useMemo(() => buildBookComposition(portfolio), [portfolio]);
  return (
    <div className="portfolio-grid">
      <section className="holdings" aria-label="Your holdings">
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

      {composition.holdingCount > 0 && <BookComposition composition={composition} />}
    </div>
  );
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
  const todayPct = holding?.dayReturnPct ?? company.market?.dayChangePct;
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

// Build a measured DKK NAV series for the hero sparkline from the holdings that
// carry fetched price history. Each leg's native-currency history is FX-scaled so
// its latest point equals the holding's DKK market value (and earlier points track
// the price ratio), so the summed series is a real DKK portfolio value over the
// trailing year — its latest total matching the model's NAV. Returns undefined
// when no holding has history (demo mode), so the hero can show an empty state.
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
  for (const { holding, history } of legs) {
    const tail = history.slice(history.length - length);
    const lastPrice = tail[tail.length - 1];
    const fx = lastPrice > 0 ? holding.marketValueDkk / lastPrice : 0;
    for (let i = 0; i < length; i += 1) series[i] += tail[i] * fx;
  }
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
    const off = settings.untradableExchanges.includes(market);
    onChange({
      ...settings,
      untradableExchanges: off
        ? settings.untradableExchanges.filter((m) => m !== market)
        : [...settings.untradableExchanges, market],
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
              const off = settings.untradableExchanges.includes(market);
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
            Tap a market to mark it off-platform — Saxo Investor doesn&apos;t trade the Korea Exchange, for
            instance. Off-platform names stay scored, but are flagged so you don&apos;t act on one you can&apos;t buy.
          </span>
        </div>
      </div>
    </details>
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
  settings,
  markets,
  onChangeSettings,
  investabilityFor,
  bookValueDkk,
  hideOffLimits,
  onToggleOffLimits,
  watchlist,
  onAddWatch,
  onRemoveWatch,
  onSelect,
}: {
  overview: OpportunityOverview;
  summary: InvestabilitySummary;
  settings: BrokerSettings;
  markets: string[];
  onChangeSettings: (next: BrokerSettings) => void;
  investabilityFor: (company: Company) => Investability;
  bookValueDkk: number;
  hideOffLimits: boolean;
  onToggleOffLimits: (next: boolean) => void;
  watchlist: WatchEntry[];
  onAddWatch: (input: { name: string; symbol: string; exchange?: string }) => AddWatchError | undefined;
  onRemoveWatch: (symbol: string) => void;
  onSelect: (symbol: string) => void;
}) {
  const { standout, standoutExposure, groups, total, gapCount, themeCount, standoutSkipped } = overview;
  const gapThemeCount = groups.filter((g) => g.isGap).length;
  const offLimitsTotal = summary.offPlatform + summary.aboveBudget;

  const brokerBar = <BrokerBar settings={settings} markets={markets} onChange={onChangeSettings} />;
  const watchBar = (
    <WatchlistBar watchlist={watchlist} markets={markets} onAdd={onAddWatch} onRemove={onRemoveWatch} />
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

      <div className="invest-bar">
        <div className="invest-stats" role="group" aria-label="What you can act on">
          <span className="invest-stat ok">
            <strong>{summary.investable}</strong> to act on
          </span>
          {summary.offPlatform > 0 && (
            <span className="invest-stat off">
              <Landmark aria-hidden="true" size={13} />
              <strong>{summary.offPlatform}</strong> off Saxo
            </span>
          )}
          {summary.aboveBudget > 0 && (
            <span className="invest-stat budget">
              <Wallet aria-hidden="true" size={13} />
              <strong>{summary.aboveBudget}</strong> over DKK {formatNumber(settings.perTradeBudgetDkk)}
            </span>
          )}
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

function WatchlistBar({
  watchlist,
  markets,
  onAdd,
  onRemove,
}: {
  watchlist: WatchEntry[];
  markets: string[];
  onAdd: (input: { name: string; symbol: string; exchange?: string }) => AddWatchError | undefined;
  onRemove: (symbol: string) => void;
}) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState("");
  const [error, setError] = useState<AddWatchError | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const err = onAdd({ name, symbol, exchange: exchange || undefined });
    if (err) {
      setError(err);
      return;
    }
    setName("");
    setSymbol("");
    setExchange("");
    setError(undefined);
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
            Score a name that isn&apos;t in the set — the same model, your EIFO rules and budget. It starts neutral
            until you refresh its market data.
          </span>
        </div>
      </div>

      <form className="watch-form" onSubmit={submit}>
        <label className="watch-field watch-field-name">
          <span>Company</span>
          <input
            type="text"
            value={name}
            placeholder="e.g. Tesla"
            onChange={(event) => setName(event.target.value)}
            aria-label="Company name"
          />
        </label>
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
            {markets.map((market) => (
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

      {error && (
        <p className="watch-error" role="alert">
          {ADD_WATCH_MESSAGES[error]}
        </p>
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
            Run <code>npm run refresh -- {watchlist.map((entry) => entry.symbol).join(" ")}</code> to score these on
            live momentum &amp; fundamentals.
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
          {rec.conviction} conviction · {rec.measured ? "data-backed" : "editorial"}
        </span>
        {company.userAdded && <WatchBadge />}
        {rec.compliance.status !== "unknown" && (
          <span className={`flag ${rec.compliance.status}`}>{rec.compliance.status.replace("_", " ")}</span>
        )}
        {offLimits && investability && <InvestabilityBadge investability={investability} />}
      </div>
      <p className="standout-why">{rec.headline}</p>
      <p className="standout-fit">{standoutFit(exposure)}</p>
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

// The decision map: every name on one risk/reward plane — your holdings (filled,
// sized by weight) and the opportunities you don't own (hollow). The synthesis a
// broker can't draw: it only ever shows what you already hold. Score (x) is the
// model's own; risk (y) is the mean of the valuation, balance-sheet and
// geopolitical axes. Pure SVG, no chart dependency; the projection/quadrant math
// is unit-tested in lib/map.ts so the picture can't drift from the numbers.
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
            <span>Score against risk — your book and the field on one plane</span>
          </div>
        </div>
        <p className="empty">Import a portfolio to map it against the opportunity set.</p>
      </section>
    );
  }

  const dims: PlaneDims = { width: 720, height: 460, padX: 54, padY: 40 };
  const left = dims.padX;
  const right = dims.width - dims.padX;
  const top = dims.padY;
  const bottom = dims.height - dims.padY;
  const midX = projectPoint(SCORE_MIDLINE, 0, dims).x;
  const midY = projectPoint(0, RISK_MIDLINE, dims).y;

  const maxWeight = portfolio.reduce(
    (max, rec) => Math.max(max, rec.holding?.portfolioWeight ?? 0),
    0,
  );
  const scale = { minR: 5, maxR: 15, maxWeight };

  // Draw opportunities first so owned holdings (filled, labelled) sit on top.
  const ordered = [...points].sort((a, b) => Number(a.owned) - Number(b.owned));

  return (
    <section className="panel map-panel" aria-label="Decision map">
      <div className="panel-heading">
        <div>
          <h2>Decision map</h2>
          <span>Score × risk · one plane — your book and the field, the synthesis a broker can&apos;t draw</span>
        </div>
        <span className="count">{points.length} plotted</span>
      </div>

      <div className="map-frame">
        <svg
          className="map-svg"
          viewBox={`0 0 ${dims.width} ${dims.height}`}
          role="group"
          aria-label={`Risk-reward map of ${ownedCount} holdings and ${shownOpportunities.length} opportunities`}
        >
          {/* The one tinted region: where you want names to land (strong & steady). */}
          <rect className="map-quadrant" x={midX} y={midY} width={right - midX} height={bottom - midY} />

          {/* Plane frame + midlines */}
          <rect className="map-plane" x={left} y={top} width={right - left} height={bottom - top} />
          <line className="map-mid" x1={midX} y1={top} x2={midX} y2={bottom} />
          <line className="map-mid" x1={left} y1={midY} x2={right} y2={midY} />

          {/* Quadrant labels in their corners (structure carries meaning) */}
          <text className="map-quad-label steady" x={right - 8} y={bottom - 8} textAnchor="end">
            {QUADRANT_LABELS["strong-steady"]}
          </text>
          <text className="map-quad-label faint" x={right - 8} y={top + 14} textAnchor="end">
            {QUADRANT_LABELS["strong-risky"]}
          </text>
          <text className="map-quad-label faint" x={left + 8} y={bottom - 8}>
            {QUADRANT_LABELS["low-priority"]}
          </text>
          <text className="map-quad-label avoid" x={left + 8} y={top + 14}>
            {QUADRANT_LABELS["avoid-zone"]}
          </text>

          {/* Axis cue */}
          <text className="map-axis" x={(left + right) / 2} y={dims.height - 12} textAnchor="middle">
            Model score →
          </text>
          <text className="map-axis-end" x={left} y={dims.height - 12} textAnchor="start">
            weaker
          </text>
          <text className="map-axis-end" x={right} y={dims.height - 12} textAnchor="end">
            stronger
          </text>
          <text
            className="map-axis"
            x={16}
            y={(top + bottom) / 2}
            textAnchor="middle"
            transform={`rotate(-90 16 ${(top + bottom) / 2})`}
          >
            Risk ↑
          </text>

          {ordered.map((point) => (
            <MapMarker
              key={point.symbol}
              point={point}
              dims={dims}
              scale={scale}
              isTopOpp={!point.owned && point.symbol === topOpportunitySymbol}
              onSelect={onSelect}
            />
          ))}
        </svg>
      </div>

      <div className="map-legend">
        <span className="map-key">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle className="map-swatch fill" cx="8" cy="8" r="6" />
          </svg>
          Your holdings
        </span>
        <span className="map-key">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle className="map-swatch hollow" cx="8" cy="8" r="5.5" />
          </svg>
          Opportunities
        </span>
        <span className="map-key">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle className="map-swatch flag" cx="8" cy="8" r="5.5" />
          </svg>
          EIFO flag
        </span>
        <span className="map-note">Click any marker for the breakdown.</span>
      </div>

      <p className="estimate-note">
        Plotting your {ownedCount} {ownedCount === 1 ? "holding" : "holdings"} and the top{" "}
        {shownOpportunities.length} of {opportunities.length} opportunities. Score is the model&apos;s; risk is the
        mean of the valuation and balance-sheet axes (measured once fundamentals are fetched, editorial
        otherwise) and the geopolitical axis (always editorial). A dashed ring marks an EIFO compliance flag.
      </p>
    </section>
  );
}

function MapMarker({
  point,
  dims,
  scale,
  isTopOpp,
  onSelect,
}: {
  point: MapPoint;
  dims: PlaneDims;
  scale: { minR: number; maxR: number; maxWeight: number };
  isTopOpp: boolean;
  onSelect: (symbol: string) => void;
}) {
  const { x, y } = projectPoint(point.score, point.risk, dims);
  const r = markerRadius(point, scale);
  const flagged = point.compliance !== "unknown";
  const label = `${point.name}: ${point.action}, score ${point.score}, risk ${point.risk}, ${
    point.owned ? `${point.weightPct.toFixed(1)}% of your book` : "not owned"
  }${flagged ? `, EIFO ${point.compliance.replace("_", " ")}` : ""}`;
  const labelClass = point.owned ? "map-mark-label" : isTopOpp ? "map-mark-label top-opp" : "map-mark-label opp";
  return (
    <g
      className={`map-dot ${mapTone(point.action)} ${point.owned ? "owned" : "opp"}${flagged ? " flagged" : ""}${
        isTopOpp ? " top-opp" : ""
      }`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => onSelect(point.symbol)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(point.symbol);
        }
      }}
    >
      <title>{label}</title>
      {flagged && <circle className="map-flag-ring" cx={x} cy={y} r={r + 3.5} />}
      <circle className={point.owned ? "map-mark fill" : "map-mark hollow"} cx={x} cy={y} r={r} />
      <text className={labelClass} x={x} y={y + r + 12} textAnchor="middle">
        {isTopOpp ? `${point.symbol} ${point.score}` : point.symbol}
      </text>
    </g>
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
            {recommendation.conviction} conviction · {recommendation.measured ? "data-backed" : "editorial only"}
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
