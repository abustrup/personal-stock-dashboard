import {
  AlertTriangle,
  BriefcaseBusiness,
  Compass,
  FileUp,
  GitCompareArrows,
  Radar,
  RotateCcw,
  ScatterChart,
  Search,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { buildPeerComparison, type PeerComparison } from "./lib/peers";
import { parsePortfolioCsv } from "./lib/portfolio";
import { buildPriceChart, monthsAgoIndex, type ChartDims } from "./lib/sparkline";
import { scoreContributions } from "./lib/recommendations";
import { mergeExternalSignals, type ExternalSignalSnapshot } from "./lib/signals";
import { clearPortfolio, loadPortfolio, savePortfolio } from "./lib/storage";
import type { Company, ComplianceStatus, Holding, MarketSnapshot, Recommendation } from "./lib/types";

type View = "portfolio" | "opportunities" | "map" | "compare" | "detail";

const tabs: Array<{ id: View; label: string; icon: typeof BriefcaseBusiness }> = [
  { id: "portfolio", label: "Portfolio", icon: BriefcaseBusiness },
  { id: "opportunities", label: "Opportunities", icon: Radar },
  { id: "map", label: "Map", icon: ScatterChart },
  { id: "compare", label: "Compare", icon: GitCompareArrows },
  { id: "detail", label: "Company", icon: Search },
];

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
  const model = useMemo(
    () => buildDashboardModel(holdings, enrichedUniverse, complianceOverrides),
    [holdings, enrichedUniverse],
  );
  const insights = useMemo(() => buildInsights(model.portfolio, model.opportunities), [model]);
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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Decision support beyond your broker</p>
          <h1>Personal Stock Dashboard</h1>
        </div>
        <div className="topbar-actions">
          {!source.isDemo && (
            <button className="ghost" type="button" onClick={resetToDemo} title="Forget the saved portfolio">
              <RotateCcw aria-hidden="true" size={15} />
              <span>Reset</span>
            </button>
          )}
          <label className="upload">
            <FileUp aria-hidden="true" size={17} />
            <span>Import CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleFileUpload(event.target.files?.[0])}
            />
          </label>
        </div>
      </header>

      <section className="notice" aria-label="compliance notice">
        <ShieldAlert size={20} aria-hidden="true" />
        <div>
          <strong>EIFO compliance is built in — your broker has no idea about it.</strong>
          <span>
            Blocks the policy negative list, flags possible overlap, and never clears a company without current EIFO
            lists.
          </span>
        </div>
      </section>

      <section className="insights" aria-label="what your broker doesn't tell you">
        <div className="insights-head">
          <h2>What Saxo doesn&apos;t tell you</h2>
          <span className={hasLiveMarket ? "fresh tone-up" : "fresh muted"}>
            {hasLiveMarket
              ? `Live data${dataAsOf ? ` · ${formatAsOf(dataAsOf)}` : ""}`
              : "Editorial estimates · run npm run refresh"}
          </span>
        </div>
        <div className="insight-grid">
          <InsightCard
            icon={TriangleAlert}
            tone={insights.needsAttention.count > 0 ? "warn" : "calm"}
            label="Needs attention"
            value={insights.needsAttention.count > 0 ? `${insights.needsAttention.count} to review` : "All clear"}
            detail={
              insights.needsAttention.top
                ? `${insights.needsAttention.top.action} · ${insights.needsAttention.top.company.name}`
                : "Nothing flagged to trim or avoid"
            }
            onClick={() => open(insights.needsAttention.top?.company.symbol)}
          />
          <InsightCard
            icon={insights.compliance.count > 0 ? ShieldAlert : ShieldCheck}
            tone={insights.compliance.count > 0 ? "warn" : "calm"}
            label="EIFO compliance"
            value={insights.compliance.count > 0 ? `${insights.compliance.count} flagged` : "None flagged"}
            detail={
              insights.compliance.top
                ? `${insights.compliance.top.compliance.status.replace("_", " ")} · ${insights.compliance.top.company.name}`
                : "No holding blocked or overlapping"
            }
            onClick={() => open(insights.compliance.top?.company.symbol)}
          />
          <InsightCard
            icon={Radar}
            tone="idea"
            label="Top opportunity"
            value={insights.topOpportunity ? insights.topOpportunity.company.name : "—"}
            detail={
              insights.topOpportunity
                ? `${insights.topOpportunity.action} · score ${insights.topOpportunity.score} · you don't own it`
                : "No standout idea right now"
            }
            onClick={() => open(insights.topOpportunity?.company.symbol)}
          />
          <InsightCard
            icon={Compass}
            tone={insights.concentration?.concentrated ? "warn" : "neutral"}
            label="Concentration"
            value={
              insights.concentration
                ? `${insights.concentration.weightPct.toFixed(0)}% in ${insights.concentration.top.company.name}`
                : "—"
            }
            detail={
              insights.concentration
                ? `${insights.concentration.concentrated ? "Concentrated" : "Diversified"} · top 3 = ${insights.concentration.topThreeWeightPct.toFixed(0)}%${insights.tilt ? ` · ${prettyTheme(insights.tilt.theme)} tilt` : ""}`
                : "Import a portfolio to see concentration"
            }
            onClick={() => open(insights.concentration?.top.company.symbol)}
          />
        </div>
      </section>

      <nav className="tabs" aria-label="dashboard views">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={view === tab.id ? "tab active" : "tab"}
              type="button"
              aria-current={view === tab.id ? "page" : undefined}
              onClick={() => setView(tab.id)}
            >
              <Icon aria-hidden="true" size={17} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <p className="source-line">
        <span>
          {source.label} · DKK {formatNumber(model.totalMarketValueDkk)} · {formatSignedPct(model.totalReturnPct)} total
        </span>
      </p>

      {view === "portfolio" && (
        <DecisionList title="Your holdings" subtitle="Ranked by what to do next" items={model.portfolio} onSelect={open} />
      )}
      {view === "opportunities" && (
        <DecisionList
          title="Opportunities"
          subtitle="Names you don't own — your broker won't surface these"
          items={model.opportunities.slice(0, 10)}
          onSelect={open}
        />
      )}
      {view === "map" && (
        <DecisionMap
          portfolio={model.portfolio}
          opportunities={model.opportunities}
          opportunityLimit={MAP_OPPORTUNITY_LIMIT}
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
          onSelect={open}
        />
      )}
    </main>
  );
}

function InsightCard({
  icon: Icon,
  tone,
  label,
  value,
  detail,
  onClick,
}: {
  icon: typeof Radar;
  tone: "warn" | "calm" | "idea" | "neutral";
  label: string;
  value: string;
  detail: string;
  onClick?: () => void;
}) {
  return (
    <button className={`insight ${tone}`} type="button" onClick={onClick}>
      <span className="insight-label">
        <Icon aria-hidden="true" size={15} />
        {label}
      </span>
      <strong className="insight-value">{value}</strong>
      <span className="insight-detail">{detail}</span>
    </button>
  );
}

function DecisionList({
  title,
  subtitle,
  items,
  onSelect,
}: {
  title: string;
  subtitle: string;
  items: Recommendation[];
  onSelect: (symbol: string) => void;
}) {
  return (
    <section className="panel" aria-label={title}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
        <span className="count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="empty">Nothing to show yet.</p>
      ) : (
        <div className="decision-grid">
          {items.map((item) => (
            <DecisionCard key={item.company.symbol} item={item} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}

function DecisionCard({ item, onSelect }: { item: Recommendation; onSelect: (symbol: string) => void }) {
  const { company, holding, compliance } = item;
  return (
    <button className="decision-card" type="button" onClick={() => onSelect(company.symbol)}>
      <ScoreRing score={item.score} action={item.action} />
      <div className="dc-body">
        <div className="dc-top">
          <Action action={item.action} />
          <span className="dc-conviction">
            {item.conviction} · {item.measured ? "data-backed" : "editorial"}
          </span>
          {compliance.status !== "unknown" && (
            <span className={`flag ${compliance.status}`}>{compliance.status.replace("_", " ")}</span>
          )}
        </div>
        <strong className="dc-name">{company.name}</strong>
        <p className="dc-why">{item.headline}</p>
      </div>
      <div className="dc-right">
        {holding ? (
          <>
            <span className={`dc-return ${toneClass(holding.totalReturnPct)}`}>
              {formatSignedPct(holding.totalReturnPct)}
            </span>
            <span className="dc-broker">{holding.portfolioWeight.toFixed(0)}% · from Saxo</span>
          </>
        ) : company.market ? (
          <>
            <span className={`dc-return ${toneClass(company.market.dayChangePct)}`}>
              {formatSignedPct(company.market.dayChangePct)}
            </span>
            <span className="dc-broker">today</span>
          </>
        ) : null}
      </div>
    </button>
  );
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
  onSelect,
}: {
  portfolio: Recommendation[];
  opportunities: Recommendation[];
  opportunityLimit: number;
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
          <span>Score against risk — your book and the field on one plane</span>
        </div>
        <span className="count">{points.length}</span>
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
          <text className="map-quad-label" x={right - 8} y={bottom - 8} textAnchor="end">
            {QUADRANT_LABELS["strong-steady"]}
          </text>
          <text className="map-quad-label" x={right - 8} y={top + 14} textAnchor="end">
            {QUADRANT_LABELS["strong-risky"]}
          </text>
          <text className="map-quad-label" x={left + 8} y={bottom - 8}>
            {QUADRANT_LABELS["low-priority"]}
          </text>
          <text className="map-quad-label" x={left + 8} y={top + 14}>
            {QUADRANT_LABELS["avoid-zone"]}
          </text>

          {/* Axis cues */}
          <text className="map-axis" x={(left + right) / 2} y={dims.height - 10} textAnchor="middle">
            Model score →
          </text>
          <text className="map-axis-end" x={left} y={dims.height - 10} textAnchor="start">
            weaker
          </text>
          <text className="map-axis-end" x={right} y={dims.height - 10} textAnchor="end">
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
            <MapMarker key={point.symbol} point={point} dims={dims} scale={scale} onSelect={onSelect} />
          ))}
        </svg>
      </div>

      <div className="map-legend">
        <span className="map-key">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle className="map-swatch fill" cx="8" cy="8" r="6" />
          </svg>
          Holdings — sized by weight
        </span>
        <span className="map-key">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle className="map-swatch hollow" cx="8" cy="8" r="5.5" />
          </svg>
          Opportunities you don&apos;t own
        </span>
        <span className="map-key map-key-actions" aria-hidden="true">
          <i className="map-chip go" /> increase
          <i className="map-chip hold" /> hold
          <i className="map-chip trim" /> trim
          <i className="map-chip avoid" /> avoid
        </span>
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
  onSelect,
}: {
  point: MapPoint;
  dims: PlaneDims;
  scale: { minR: number; maxR: number; maxWeight: number };
  onSelect: (symbol: string) => void;
}) {
  const { x, y } = projectPoint(point.score, point.risk, dims);
  const r = markerRadius(point, scale);
  const flagged = point.compliance !== "unknown";
  const label = `${point.name}: ${point.action}, score ${point.score}, risk ${point.risk}, ${
    point.owned ? `${point.weightPct.toFixed(1)}% of your book` : "not owned"
  }${flagged ? `, EIFO ${point.compliance.replace("_", " ")}` : ""}`;
  return (
    <g
      className={`map-dot ${mapTone(point.action)} ${point.owned ? "owned" : "opp"}${flagged ? " flagged" : ""}`}
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
      {point.owned && (
        <text className="map-mark-label" x={x + r + 3} y={y + 3.5}>
          {point.symbol}
        </text>
      )}
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
  onSelect,
}: {
  recommendation: Recommendation;
  context?: HoldingContext;
  peers?: PeerComparison;
  onSelect: (symbol: string) => void;
}) {
  const { company, compliance, holding } = recommendation;
  const market = company.market;

  return (
    <section className="detail">
      <div className="detail-hero">
        <div>
          <span className="symbol">{company.symbol} · {company.region}</span>
          <h2>{company.name}</h2>
          <p>{company.themes.map(prettyTheme).join(" · ")}</p>
        </div>
        <div className="detail-action">
          <ScoreRing score={recommendation.score} action={recommendation.action} large />
          <Action action={recommendation.action} />
          <span>
            {recommendation.conviction} conviction · {recommendation.measured ? "data-backed" : "editorial only"}
          </span>
        </div>
      </div>

      <p className={`headline ${recommendation.action}`}>{recommendation.headline}</p>

      <div className="analysis">
        <article className="card">
          <h3>Why this score</h3>
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
          <p className="downside">{recommendation.downside}</p>
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
