import {
  AlertTriangle,
  BriefcaseBusiness,
  Compass,
  FileUp,
  Radar,
  RotateCcw,
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
import { clamp, mergeMarketSnapshot, rangePosition, type MarketSnapshotMap } from "./lib/market";
import { parsePortfolioCsv } from "./lib/portfolio";
import { scoreContributions } from "./lib/recommendations";
import { mergeExternalSignals, type ExternalSignalSnapshot } from "./lib/signals";
import { clearPortfolio, loadPortfolio, savePortfolio } from "./lib/storage";
import type { Company, ComplianceStatus, Holding, Recommendation } from "./lib/types";

type View = "portfolio" | "opportunities" | "detail";

const tabs: Array<{ id: View; label: string; icon: typeof BriefcaseBusiness }> = [
  { id: "portfolio", label: "Portfolio", icon: BriefcaseBusiness },
  { id: "opportunities", label: "Opportunities", icon: Radar },
  { id: "detail", label: "Company", icon: Search },
];

const stored = loadPortfolio();

export default function App() {
  const [holdings, setHoldings] = useState<Holding[]>(stored?.holdings ?? seedHoldings);
  const [source, setSource] = useState<{ label: string; isDemo: boolean }>(
    stored ? { label: `Imported ${formatDate(stored.importedAt)}`, isDemo: false } : { label: "Demo portfolio", isDemo: true },
  );
  const [view, setView] = useState<View>("portfolio");
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>(holdings[0]?.symbol);
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
                ? `${complianceLabel(insights.compliance.top.compliance.status)} · ${insights.compliance.top.company.name}`
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
      {view === "detail" && selected && (
        <CompanyDetail
          recommendation={selected}
          context={insights.holdingContexts.get(selected.company.symbol)}
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
            <span className={`flag ${compliance.status}`}>{complianceLabel(compliance.status)}</span>
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

function CompanyDetail({
  recommendation,
  context,
}: {
  recommendation: Recommendation;
  context?: HoldingContext;
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
          <strong>EIFO: {complianceLabel(compliance.status)}</strong>
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
          {market.fiftyTwoWeekLow !== undefined && market.fiftyTwoWeekHigh !== undefined && (
            <RangeBar low={market.fiftyTwoWeekLow} high={market.fiftyTwoWeekHigh} price={market.price} currency={market.currency} />
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
            <div className={`driver-fill ${d.measured ? "m" : "e"}`} style={{ width: `${clamp(d.value)}%` }} />
          </div>
          <span className="driver-val">{Math.round(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

function RangeBar({ low, high, price, currency }: { low: number; high: number; price: number; currency: string }) {
  const pos = (rangePosition(price, high, low) ?? 0.5) * 100;
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
  const offset = circ * (1 - clamp(score) / 100);
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

// Human label for a compliance status enum (only `possible_overlap` carries an
// underscore). One helper so every render site presents the status identically.
function complianceLabel(status: ComplianceStatus): string {
  return status.replace("_", " ");
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
  const tone = toneOf(value ?? 0);
  return tone ? `tone-${tone}` : "";
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
