import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
  // Broker & budget settings persist in localStorage; reset so each test starts
  // from the defaults rather than inheriting a prior test's toggles.
  localStorage.clear();
});

// A ledger row (holding or opportunity) is the redesign's clickable table row.
function ledgerRows(scope: HTMLElement = document.body): HTMLElement[] {
  return within(scope)
    .getAllByRole("button")
    .filter((button) => button.classList.contains("lt-row"));
}

// Open NVIDIA's detail by clicking its holding row in the ledger.
function openNvidiaDetail() {
  fireEvent.click(screen.getByRole("button", { name: /NVIDIA Corp\..*open detail/i }));
}

// The company detail view is in front when its back link is present.
function detailIsOpen() {
  return screen.getByRole("button", { name: /back to holdings/i });
}

describe("App", () => {
  it("renders the Portfolio Ledger chrome, the holdings table and the rail", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /the portfolio ledger/i })).toBeInTheDocument();
    // The NAV hero carries the real net asset value figure.
    expect(screen.getByText(/net asset value · dkk/i)).toBeInTheDocument();
    // The "What Saxo won't say" synthesis now lives in the portfolio rail.
    expect(screen.getByRole("heading", { name: /what saxo won.t say/i })).toBeInTheDocument();
    // The top holding appears in the holdings table.
    expect(screen.getAllByText(/NVIDIA Corp\./i).length).toBeGreaterThanOrEqual(1);
    // The rail briefs are present.
    expect(screen.getByText(/Needs attention/i)).toBeInTheDocument();
    expect(screen.getByText(/Top opportunity/i)).toBeInTheDocument();
    expect(screen.getByText(/Concentration/i)).toBeInTheDocument();
    expect(screen.getByText(/EIFO compliance/i)).toBeInTheDocument();
    // The concentration brief names the largest position.
    expect(screen.getByText(/\d+% in NVIDIA/i)).toBeInTheDocument();
  });

  it("leads the front page with an opportunity you can actually act on, not just the top score", () => {
    render(<App />);

    const rail = screen.getByLabelText(/what saxo won.t say/i);
    // The lead idea states the investability guarantee, and by default is the
    // top-scoring name the user can buy (TSMC, listed on the NYSE).
    expect(within(rail).getByText(/one you can act on/i)).toBeInTheDocument();
    expect(within(rail).getByText(/Taiwan Semiconductor/i)).toBeInTheDocument();

    // Mark the NYSE off the user's platform via the broker controls in Opportunities.
    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));
    fireEvent.click(screen.getByRole("button", { name: "NYSE" }));

    // Back on the front page, the lead idea is no longer the now-untradable NYSE
    // name — it falls through to the strongest name the user can still buy and says
    // so, instead of headlining a stock the user can't act on.
    fireEvent.click(screen.getByRole("button", { name: /^Portfolio/ }));
    const railAfter = screen.getByLabelText(/what saxo won.t say/i);
    expect(within(railAfter).queryByText(/Taiwan Semiconductor/i)).not.toBeInTheDocument();
    expect(within(railAfter).getByText(/off-limits for your account/i)).toBeInTheDocument();
  });

  it("synthesises the book into a theme composition band under the ledger", () => {
    render(<App />);

    // The full-width rollup: what the book is betting on, by theme.
    expect(screen.getByRole("heading", { name: /what your book is betting on/i })).toBeInTheDocument();
    const band = screen.getByLabelText(/what your book is betting on/i);
    // The spine is exposed to assistive tech as one labelled image describing the split.
    expect(within(band).getByRole("img", { name: /your book split by theme/i })).toBeInTheDocument();
    // The lead line names the dominant theme.
    expect(within(band).getByText(/most in/i)).toBeInTheDocument();
    // The honesty discipline is stated: a counted-once partition, measured weights,
    // editorial taxonomy — never relabelled.
    expect(within(band).getByText(/each counted once/i)).toBeInTheDocument();
    expect(within(band).getByText(/Weights are\s+measured from your import/i)).toBeInTheDocument();
  });

  it("exposes each holding's model score to assistive technology via the row name", () => {
    render(<App />);

    // The redesign replaces the per-card score ring with a number + microbar; the
    // score must still reach screen-reader users, so every clickable holding row
    // carries it in its accessible name.
    const rows = ledgerRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => /score \d+/i.test(row.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("shows the model score in the company detail hero", () => {
    render(<App />);

    openNvidiaDetail();
    expect(detailIsOpen()).toBeInTheDocument();
    // The hero shows the big score out of 100.
    expect(screen.getByText("/100")).toBeInTheDocument();
  });

  it("shows where a holding sits within the book when opened", () => {
    render(<App />);

    openNvidiaDetail();

    const context = screen.getByLabelText(/this holding within your portfolio/i);
    expect(within(context).getByText(/in your portfolio/i)).toBeInTheDocument();
    // NVIDIA is the largest demo position by weight.
    expect(within(context).getByText(/^Largest$/)).toBeInTheDocument();
    // Editorial-only load (no fetched fundamentals) → the axis is labelled
    // editorial, matching the rest of the detail view's provenance discipline.
    expect(within(context).getByText(/largest risk axis here is valuation risk \(editorial\)/i)).toBeInTheDocument();
  });

  it("explains the score by weighted contribution in the detail view", () => {
    render(<App />);

    openNvidiaDetail();

    const analysis = screen.getByText(/why this score/i).closest("article")!;
    // The score breakdown caption and the raw input-level caption both appear,
    // so the two complementary charts are distinguishable.
    expect(within(analysis).getByText(/weighted pull on the score/i)).toBeInTheDocument();
    // The card title and the raw input-level sub-caption both mention "input
    // levels"; assert the sub-caption form (with the 0–100 parenthetical) so the
    // two complementary charts stay distinguishable.
    expect(within(analysis).getByText(/^Input levels \(0/i)).toBeInTheDocument();
    // At least one factor lifts the score (+) and at least one drags it (−).
    expect(within(analysis).getAllByText(/^\+\d/).length).toBeGreaterThan(0);
    expect(within(analysis).getAllByText(/^−\d/).length).toBeGreaterThan(0);
    // Editorial-only load → AI exposure is labelled editorial, never measured.
    expect(within(analysis).getAllByText(/^editorial$/i).length).toBeGreaterThan(0);
  });

  it("ranks a holding against its theme peers and labels the comparison", () => {
    render(<App />);

    openNvidiaDetail();

    const peers = screen.getByLabelText(/theme peers in ai infrastructure/i);
    // The ladder states the rank and reuses the map's ownership vocabulary.
    expect(within(peers).getByText(/ranks \w+ of \d+ by model score/i)).toBeInTheDocument();
    expect(within(peers).getByText(/filled marker = you own it/i)).toBeInTheDocument();
    expect(within(peers).getByText(/not your broker/i)).toBeInTheDocument();
    // Each peer is its own openable row with an accessible name carrying ownership.
    const rows = within(peers).getAllByRole("button");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((row) => /you (own it|don't own it)/i.test(row.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("groups opportunities by theme, leads with a standout, and surfaces blind spots", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));

    const panel = screen.getByLabelText(/^Opportunities$/i);
    // Leads with the single featured idea you don't own.
    expect(within(panel).getByRole("button", { name: /standout idea/i })).toBeInTheDocument();
    // The overview summary counts ideas and themes.
    expect(within(panel).getByText(/ideas across/i)).toBeInTheDocument();
    // At least one theme is a blind spot the user holds nothing in.
    expect(within(panel).getAllByText(/gap · you own none/i).length).toBeGreaterThan(0);

    // No silent slicing: every non-owned name in the demo universe is shown as a
    // row (13 = 19 curated names − 6 demo holdings), not capped at ten.
    expect(ledgerRows(panel)).toHaveLength(13);

    // Opening a name from a theme group routes to its detail view.
    fireEvent.click(ledgerRows(panel)[0]);
    expect(detailIsOpen()).toBeInTheDocument();
  });

  it("summarises what you can act on and flags off-platform ideas without hiding them", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));
    const panel = screen.getByLabelText(/^Opportunities$/i);

    // The readout names how many ideas you can act on.
    expect(within(panel).getByText(/to act on/i)).toBeInTheDocument();
    // The Korea-listed names (Samsung, SK hynix) are off Saxo — flagged, not hidden.
    expect(within(panel).getAllByText(/off saxo/i).length).toBeGreaterThan(0);
    // Even off-limits, every non-owned name is still shown (honest, not silently dropped).
    const rows = ledgerRows(panel);
    expect(rows).toHaveLength(13);
    // Off-limits rows are visually demoted via a class, not removed from the DOM.
    expect(rows.some((row) => row.classList.contains("off-limits"))).toBe(true);

    // The hide toggle removes them on demand, then the count drops below 13.
    fireEvent.click(within(panel).getByLabelText(/hide off-limits/i));
    const after = ledgerRows(screen.getByLabelText(/^Opportunities$/i));
    expect(after.length).toBeLessThan(13);
    expect(after.some((row) => row.classList.contains("off-limits"))).toBe(false);
  });

  it("flags an above-budget name when live prices load and lets the user raise the budget", async () => {
    const snapshot = {
      generatedAt: "2026-06-28T18:49:41.386Z",
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        // ASML near 1,800 USD ≈ 12,000+ DKK a share — over the default 5,000 DKK budget.
        ASML: { symbol: "ASML", price: 1794.62, currency: "USD", momentum: 70, asOf: "2026-06-28T18:49:41.386Z" },
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);
    await screen.findByText(/LIVE · YHOO/i);

    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));
    const panel = screen.getByLabelText(/^Opportunities$/i);
    // One whole share already overshoots the per-trade budget.
    expect(within(panel).getAllByText(/1 share > budget/i).length).toBeGreaterThan(0);

    // Raising the budget past a single share clears the flag.
    const budget = screen.getByLabelText(/per-trade budget in dkk/i);
    fireEvent.change(budget, { target: { value: "20000" } });
    expect(within(screen.getByLabelText(/^Opportunities$/i)).queryByText(/1 share > budget/i)).toBeNull();
  });

  it("turns an affordable idea into a concrete buy plan sized to the slot", async () => {
    const snapshot = {
      generatedAt: "2026-06-28T18:49:41.386Z",
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        // AMD is an opportunity (not held) on NASDAQ; ~200 USD ≈ 1,380 DKK a share,
        // so a 5,000 DKK slot buys 3 whole shares (4,140 DKK) and strands the rest.
        AMD: { symbol: "AMD", price: 200, currency: "USD", momentum: 65, asOf: "2026-06-28T18:49:41.386Z" },
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);
    await screen.findByText(/LIVE · YHOO/i);

    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));
    fireEvent.click(screen.getByRole("button", { name: /Advanced Micro Devices.*open detail/i }));

    // The detail view sizes the position to the per-trade slot, not just the score.
    const plan = screen.getByLabelText(/buy plan for your per-trade slot/i);
    expect(within(plan).getByText(/buy plan/i)).toBeInTheDocument();
    expect(within(plan).getByText(/≈ 3 shares/i)).toBeInTheDocument();
    expect(within(plan).getByText(/of your DKK 5,000 slot/i)).toBeInTheDocument();
    expect(within(plan).getByText(/of your book/i)).toBeInTheDocument();
  });

  it("marks a market off-platform from the broker settings, and clears it again", () => {
    render(<App />);
    // The broker & budget settings now live in the Opportunities view.
    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));

    // The chips live inside a collapsed disclosure; query including hidden nodes.
    const nasdaq = () => screen.getByRole("button", { name: /^NASDAQ$/i, hidden: true });
    // NASDAQ starts tradable; mark it off-platform and the chip reflects the change.
    expect(nasdaq()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(nasdaq());
    expect(nasdaq()).toHaveAttribute("aria-pressed", "false");

    // The summary line now reports more markets off the platform.
    expect(screen.getByText(/markets off your platform/i)).toBeInTheDocument();

    // Toggling it back restores tradable state.
    fireEvent.click(nasdaq());
    expect(nasdaq()).toHaveAttribute("aria-pressed", "true");
  });

  it("lets the user add their own name, scores it like any opportunity, and removes it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));

    const cardCount = () => ledgerRows(screen.getByLabelText(/^Opportunities$/i)).length;
    const before = cardCount();

    // Type a name that isn't in the curated universe and add it.
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "Cloudflare, Inc." } });
    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "net" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    // It joins the opportunity set as a new, scored row flagged "Added by you".
    const panel = screen.getByLabelText(/^Opportunities$/i);
    expect(cardCount()).toBe(before + 1);
    expect(within(panel).getAllByText(/added by you/i).length).toBeGreaterThan(0);
    // A removable chip and the live refresh hint both appear.
    expect(within(panel).getByText(/npm run refresh -- NET/i)).toBeInTheDocument();

    // Adding a name already in the curated set (PLTR is curated but not a demo
    // holding) is rejected with a clear message.
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "Palantir" } });
    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "PLTR" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/already in the curated set/i);

    // Adding a name the user already holds (NVDA is a demo holding) is rejected
    // as owned — so it never becomes a chip with no matching opportunity row.
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "NVIDIA" } });
    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "NVDA" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/you already own that/i);

    // Removing the watched name drops it back out of the opportunity set.
    fireEvent.click(screen.getByRole("button", { name: /remove cloudflare, inc\. from your watchlist/i }));
    expect(cardCount()).toBe(before);
    expect(within(screen.getByLabelText(/^Opportunities$/i)).queryByText(/added by you/i)).toBeNull();
  });

  it("sizes the front-page lead idea once a refresh's prices arrive (cache isn't stale)", async () => {
    // The lead opportunity (TSMC, top of the demo set) is assessed on the first
    // render — before the snapshot resolves — so its investability is cached as
    // "no price yet". The assessment cache is keyed by symbol, so it MUST be rebuilt
    // when the snapshot lands; otherwise that first verdict freezes and the buy plan
    // (which needs the price) never appears. A strong momentum keeps TSMC the lead
    // idea across the refresh, so the same name is assessed before and after.
    const snapshot = {
      generatedAt: "2026-06-28T18:49:41.386Z",
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        TSM: {
          symbol: "TSM",
          price: 200,
          currency: "USD",
          dayChangePct: 0.4,
          fiftyTwoWeekHigh: 230,
          fiftyTwoWeekLow: 120,
          return3m: 18,
          return6m: 24,
          momentum: 88,
          asOf: "2026-06-28T18:49:41.386Z",
        },
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);
    await screen.findByText(/LIVE · YHOO/i);

    // Once prices land, the lead card sizes a concrete buy plan from the live price —
    // a measured share count and its share of the book — rather than staying frozen
    // on the pre-fetch "no price yet" verdict.
    const rail = screen.getByLabelText(/what saxo won.t say/i);
    await waitFor(() => {
      const plan = rail.querySelector(".rail-top-plan");
      expect(plan).not.toBeNull();
      expect(plan?.textContent).toMatch(/share.*DKK.*of your book/i);
    });
    expect(within(rail).getByText(/Taiwan Semiconductor/i)).toBeInTheDocument();
  });

  it("plots holdings and opportunities on the decision map and opens a name", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Map/ }));

    // The plane and its quadrant labels render.
    expect(screen.getByLabelText(/^Decision map$/i)).toBeInTheDocument();
    expect(screen.getByText(/strong & steady/i)).toBeInTheDocument();
    expect(screen.getByText(/avoid zone/i)).toBeInTheDocument();

    // Owned holdings are marked as such and carry their book weight in the
    // accessible label; opportunities are explicitly "not owned".
    const nvidia = screen.getByRole("button", { name: /NVIDIA Corp.*% of your book/i });
    expect(screen.getAllByRole("button", { name: /not owned/i }).length).toBeGreaterThan(0);

    // Clicking a marker opens that company's detail view.
    fireEvent.click(nvidia);
    expect(detailIsOpen()).toBeInTheDocument();
  });

  it("compares two names head to head with a tale-of-the-tape and a verdict", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Compare/ }));

    const panel = screen.getByLabelText(/compare two names/i);
    // Two pickers, defaulting to one name vs another.
    expect(within(panel).getAllByRole("combobox")).toHaveLength(2);

    // The diverging chart lists every scoring driver as its own row.
    const tape = within(panel).getByRole("table", { name: /driver comparison/i });
    for (const axis of [/AI exposure/i, /Growth/i, /Momentum/i, /Quality/i, /Value/i, /Balance sheet/i]) {
      expect(within(tape).getByRole("rowheader", { name: axis })).toBeInTheDocument();
    }

    // A one-line synthesis states the model's lean (or an honest tie/block).
    expect(
      within(panel).getByText(/the model leans|too close to call|blocked by eifo/i),
    ).toBeInTheDocument();
  });

  it("re-runs the comparison when you pick a different name", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Compare/ }));
    const panel = screen.getByLabelText(/compare two names/i);
    const [first] = within(panel).getAllByRole("combobox");

    // AAPL is a demo holding, so it is always selectable on the left.
    fireEvent.change(first, { target: { value: "AAPL" } });
    expect((first as HTMLSelectElement).value).toBe("AAPL");
    expect(within(panel).getAllByText(/Apple/i).length).toBeGreaterThan(0);
  });

  it("falls back to an editorial-only label when no snapshot loads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")));
    render(<App />);

    await waitFor(() => expect(screen.getByText(/EDITORIAL · NPM RUN REFRESH/i)).toBeInTheDocument());
  });

  it("flags live data when a refresh snapshot is present", async () => {
    const snapshot = {
      generatedAt: "2026-06-28T18:49:41.386Z",
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        NVDA: {
          symbol: "NVDA",
          price: 197.22,
          currency: "USD",
          dayChangePct: -1.6,
          fiftyTwoWeekHigh: 236.54,
          fiftyTwoWeekLow: 149.26,
          return3m: 12.6,
          return6m: 9,
          momentum: 61,
          asOf: "2026-06-28T18:49:41.386Z",
        },
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);

    expect(await screen.findByText(/LIVE · YHOO/i)).toBeInTheDocument();
  });

  it("draws the annotated price-path chart when history is present", async () => {
    const snapshot = {
      generatedAt: "2026-06-28T18:49:41.386Z",
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        NVDA: {
          symbol: "NVDA",
          price: 197.22,
          currency: "USD",
          dayChangePct: -1.6,
          fiftyTwoWeekHigh: 236.54,
          fiftyTwoWeekLow: 149.26,
          return3m: 12.6,
          return6m: 9,
          momentum: 61,
          history: [150, 158, 165, 172, 168, 175, 183, 188, 192, 197.22],
          asOf: "2026-06-28T18:49:41.386Z",
        },
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);

    // Wait for the live snapshot to merge, then open NVIDIA's detail view.
    await screen.findByText(/LIVE · YHOO/i);
    openNvidiaDetail();

    // The chart is exposed as a single labelled image describing the price path
    // and the 52-week range it is annotated with.
    const chart = await screen.findByRole("img", { name: /price over the past year/i });
    expect(chart).toHaveAccessibleName(/52-week range/i);
    // The momentum-window anchors carry their measured trailing returns, tying the
    // line to the model's own numbers — the annotation a broker's chart lacks.
    expect(screen.getByText(/^~3M · \+12\.60%$/)).toBeInTheDocument();
    expect(screen.getByText(/^~6M · \+9\.00%$/)).toBeInTheDocument();
    expect(screen.getByText(/the same series momentum is derived from/i)).toBeInTheDocument();
  });
});
