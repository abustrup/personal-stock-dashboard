import { AlertTriangle, BriefcaseBusiness, FileUp, Radar, Search, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { complianceOverrides } from "./data/complianceOverrides";
import { seedHoldings } from "./data/portfolioSeed";
import { universe } from "./data/universe";
import { buildDashboardModel } from "./lib/dashboard";
import { mergeMarketSnapshot, type MarketSnapshotMap } from "./lib/market";
import { parsePortfolioCsv } from "./lib/portfolio";
import { mergeExternalSignals, type ExternalSignalSnapshot } from "./lib/signals";
import type { Holding, MarketSnapshot, Recommendation } from "./lib/types";

type View = "portfolio" | "opportunities" | "detail";

const tabs: Array<{ id: View; label: string; icon: typeof BriefcaseBusiness }> = [
  { id: "portfolio", label: "Portfolio", icon: BriefcaseBusiness },
  { id: "opportunities", label: "Opportunities", icon: Radar },
  { id: "detail", label: "Company Detail", icon: Search },
];

export default function App() {
  const [holdings, setHoldings] = useState<Holding[]>(seedHoldings);
  const [view, setView] = useState<View>("portfolio");
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>("NVDA");
  const [importNotice, setImportNotice] = useState("Showing a demo portfolio — import your CSV to see your own positions.");
  const [externalSignals, setExternalSignals] = useState<ExternalSignalSnapshot>({});
  const [marketSnapshots, setMarketSnapshots] = useState<MarketSnapshotMap>({});
  const [dataAsOf, setDataAsOf] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    // BASE_URL is "/" in dev and "/<repo>/" on GitHub Pages, so the snapshot
    // resolves correctly in both.
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
  const selected =
    model.all.find((recommendation) => recommendation.company.symbol === selectedSymbol) ??
    model.topIdea ??
    model.portfolio[0];

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const parsed = parsePortfolioCsv(text);
    setHoldings(parsed.holdings);
    setImportNotice(`Imported ${parsed.holdings.length} positions. Skipped ${parsed.skippedRows} broker summary rows.`);
    setSelectedSymbol(parsed.holdings[0]?.symbol);
    setView("portfolio");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Medium-high-risk decision support</p>
          <h1>Personal Stock Dashboard</h1>
        </div>
        <label className="upload">
          <FileUp aria-hidden="true" size={18} />
          <span>Import CSV</span>
          <input type="file" accept=".csv,text/csv" onChange={(event) => void handleFileUpload(event.target.files?.[0])} />
        </label>
      </header>

      <section className="notice" aria-label="compliance notice">
        <ShieldAlert size={20} aria-hidden="true" />
        <div>
          <strong>EIFO status is not clean by default.</strong>
          <span>
            The app only uses the policy PDF you provided. It blocks named policy exclusions, flags possible overlap and never clears a company without current EIFO lists.
          </span>
        </div>
      </section>

      <section className="metrics" aria-label="summary">
        <Metric label="Portfolio value" value={`DKK ${formatNumber(model.totalMarketValueDkk)}`} />
        <Metric
          label="Total return"
          value={`${formatSignedPct(model.totalReturnPct)} · DKK ${formatSigned(model.totalGainDkk)}`}
          tone={toneOf(model.totalGainDkk)}
        />
        <Metric
          label="Today"
          value={`DKK ${formatSigned(model.dayGainDkk)}`}
          tone={toneOf(model.dayGainDkk)}
        />
        <Metric label="Holdings" value={String(model.portfolio.length)} />
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
              title={tab.label}
            >
              <Icon aria-hidden="true" size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <p className="import-note">
        {importNotice}
        {" · "}
        {hasLiveMarket ? (
          <span className="tone-up">
            Live market data{dataAsOf ? ` · refreshed ${formatAsOf(dataAsOf)}` : ""}
          </span>
        ) : (
          <span className="muted">Editorial estimates only — run npm run refresh for live prices</span>
        )}
      </p>

      {view === "portfolio" && (
        <RecommendationList
          title="Portfolio"
          items={model.portfolio}
          empty="No holdings loaded."
          onSelect={(symbol) => {
            setSelectedSymbol(symbol);
            setView("detail");
          }}
        />
      )}

      {view === "opportunities" && (
        <RecommendationList
          title="Opportunities"
          items={model.opportunities.slice(0, 8)}
          empty="No opportunities in the current universe."
          onSelect={(symbol) => {
            setSelectedSymbol(symbol);
            setView("detail");
          }}
        />
      )}

      {view === "detail" && selected && <CompanyDetail recommendation={selected} />}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
    </div>
  );
}

function RecommendationList({
  title,
  items,
  empty,
  onSelect,
}: {
  title: string;
  items: Recommendation[];
  empty: string;
  onSelect: (symbol: string) => void;
}) {
  return (
    <section className="panel" aria-label={title}>
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{items.length} names</span>
      </div>
      {items.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="recommendation-grid">
          {items.map((item) => (
            <button
              key={item.company.symbol}
              className="stock-row"
              type="button"
              onClick={() => onSelect(item.company.symbol)}
            >
              <div className="row-id">
                <strong>{item.company.name}</strong>
                <span>{item.company.symbol} · {item.company.region}</span>
              </div>
              {item.holding && (
                <div className="row-pl">
                  <span className={`pl ${toneClass(item.holding.totalReturnPct)}`}>
                    {formatSignedPct(item.holding.totalReturnPct)}
                  </span>
                  <span className="muted">
                    {item.holding.portfolioWeight.toFixed(1)}% · {formatSignedPct(item.holding.dayReturnPct)} today
                  </span>
                </div>
              )}
              <div className="row-right">
                <Action action={item.action} />
                <span className="score">{item.score}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function CompanyDetail({ recommendation }: { recommendation: Recommendation }) {
  const { company, compliance, holding } = recommendation;
  const market = company.market;

  return (
    <section className="detail">
      <div className="detail-hero">
        <div>
          <span className="symbol">{company.symbol}</span>
          <h2>{company.name}</h2>
          <p>{company.themes.join(" · ")}</p>
        </div>
        <div className="detail-action">
          <Action action={recommendation.action} />
          <strong>{recommendation.score}/100</strong>
          <span>
            {recommendation.conviction} conviction · {recommendation.measured ? "data-backed" : "editorial only"}
          </span>
        </div>
      </div>

      <p className="estimate-note">
        The score blends measured price action with editorial estimates from the curated universe.
        {!market && " No live price for this name — momentum here is an editorial estimate, not measured."}
      </p>

      {holding && (
        <div className="position" aria-label="your position">
          <PositionStat label="Position" value={`${formatNumber(holding.quantity)} × ${company.symbol}`} />
          <PositionStat label="Market value" value={`DKK ${formatNumber(holding.marketValueDkk)}`} />
          <PositionStat
            label="Total return"
            value={`${formatSignedPct(holding.totalReturnPct)} · DKK ${formatSigned(holding.totalGainDkk ?? 0)}`}
            tone={toneOf(holding.totalGainDkk ?? 0)}
          />
          <PositionStat
            label="Today"
            value={`${formatSignedPct(holding.dayReturnPct)} · DKK ${formatSigned(holding.dayGainDkk ?? 0)}`}
            tone={toneOf(holding.dayGainDkk ?? 0)}
          />
          <PositionStat label="Weight" value={`${holding.portfolioWeight.toFixed(1)}%`} />
        </div>
      )}

      {market && (
        <div className="position market" aria-label="live market">
          <PositionStat
            label="Live price"
            value={`${formatPrice(market.price)} ${market.currency}`}
          />
          <PositionStat
            label="1M / 3M"
            value={`${formatSignedPct(market.return1m)} · ${formatSignedPct(market.return3m)}`}
            tone={toneOf(market.return3m ?? 0)}
          />
          <PositionStat label="6M" value={formatSignedPct(market.return6m)} tone={toneOf(market.return6m ?? 0)} />
          <PositionStat
            label="52w range"
            value={
              market.fiftyTwoWeekLow !== undefined && market.fiftyTwoWeekHigh !== undefined
                ? `${formatPrice(market.fiftyTwoWeekLow)}–${formatPrice(market.fiftyTwoWeekHigh)}`
                : "—"
            }
          />
          <PositionStat label="Momentum" value={`${market.momentum}/100 (measured)`} />
        </div>
      )}

      <div className="detail-grid">
        <InfoBlock title="Reasoning" lines={recommendation.reasoning} />
        <InfoBlock title="Downside" lines={[recommendation.downside]} />
        <InfoBlock title="News Signal" lines={[recommendation.newsSignal.summary, recommendation.freshness]} />
        <InfoBlock title="Expert Signal" lines={[recommendation.expertSignal.summary]} />
      </div>

      <div className={`compliance ${compliance.status}`}>
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <strong>{compliance.status.replace("_", " ")}</strong>
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
    </section>
  );
}

function InfoBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <article className="info-block">
      <h3>{title}</h3>
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </article>
  );
}

function PositionStat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="position-stat">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
    </div>
  );
}

function Action({ action }: { action: Recommendation["action"] }) {
  return <span className={`action ${action}`}>{action}</span>;
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
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}%`;
}

function toneOf(value: number): "up" | "down" | undefined {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return undefined;
}

function toneClass(value: number | undefined): string {
  if (value === undefined || value === 0) return "";
  return value > 0 ? "tone-up" : "tone-down";
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
