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

describe("App", () => {
  it("renders the decision-first dashboard with the insights band and a holding", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /personal stock dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /what saxo doesn.t tell you/i })).toBeInTheDocument();
    expect(screen.getByText(/EIFO compliance is built in/i)).toBeInTheDocument();
    // The top holding now appears both in the holdings list and in the
    // concentration synthesis, so there may be more than one occurrence.
    expect(screen.getAllByText(/NVIDIA Corp\./i).length).toBeGreaterThanOrEqual(1);
    // The value-add insights are present.
    expect(screen.getByText(/Needs attention/i)).toBeInTheDocument();
    expect(screen.getByText(/Top opportunity/i)).toBeInTheDocument();
    expect(screen.getByText(/Concentration/i)).toBeInTheDocument();
    expect(screen.getByText(/in NVIDIA Corp\./i)).toBeInTheDocument();
  });

  it("exposes the model score to assistive technology, one ring per holding card", () => {
    render(<App />);

    // The score ring is the dashboard's central decision metric; it must carry
    // an accessible name so screen-reader users hear the score, not nothing.
    // Exact-name match guards against the inner <text> leaking back into the
    // announcement (which would read as a bare, context-free number).
    const scores = screen.getAllByRole("img", { name: /^Score \d+ of 100$/ });
    const cards = screen.getAllByRole("button").filter((button) => button.classList.contains("decision-card"));
    expect(cards.length).toBeGreaterThan(0);
    expect(scores.length).toBe(cards.length);
  });

  it("exposes the model score in the company detail view", () => {
    render(<App />);

    fireEvent.click(screen.getByText(/in NVIDIA Corp\./i));
    // The detail hero shows exactly one score ring with a clean accessible name.
    expect(screen.getAllByRole("img", { name: /^Score \d+ of 100$/ })).toHaveLength(1);
  });

  it("shows where a holding sits within the book when opened", () => {
    render(<App />);

    // Open the largest position straight from the concentration synthesis card.
    fireEvent.click(screen.getByText(/in NVIDIA Corp\./i));

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

    fireEvent.click(screen.getByText(/in NVIDIA Corp\./i));

    const analysis = screen.getByText(/why this score/i).closest("article")!;
    // The score breakdown caption and the raw input-level caption both appear,
    // so the two complementary charts are distinguishable.
    expect(within(analysis).getByText(/weighted pull on the score/i)).toBeInTheDocument();
    expect(within(analysis).getByText(/input levels/i)).toBeInTheDocument();
    // At least one factor lifts the score (+) and at least one drags it (−).
    expect(within(analysis).getAllByText(/^\+\d/).length).toBeGreaterThan(0);
    expect(within(analysis).getAllByText(/^−\d/).length).toBeGreaterThan(0);
    // Editorial-only load → AI exposure is labelled editorial, never measured.
    expect(within(analysis).getAllByText(/^editorial$/i).length).toBeGreaterThan(0);
  });

  it("ranks a holding against its theme peers and labels the comparison", () => {
    render(<App />);

    fireEvent.click(screen.getByText(/in NVIDIA Corp\./i));

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

    fireEvent.click(screen.getByRole("button", { name: /^Opportunities$/ }));

    const panel = screen.getByLabelText(/^Opportunities$/i);
    // Leads with the single featured idea you don't own.
    expect(within(panel).getByText(/standout idea/i)).toBeInTheDocument();
    // The overview summary counts ideas and themes.
    expect(within(panel).getByText(/ideas across/i)).toBeInTheDocument();
    // At least one theme is a blind spot the user holds nothing in.
    expect(within(panel).getAllByText(/gap · you own none/i).length).toBeGreaterThan(0);

    // No silent slicing: every non-owned name in the demo universe is shown as a
    // row (13 = 19 curated names − 6 demo holdings), not capped at ten.
    const cards = within(panel)
      .getAllByRole("button")
      .filter((button) => button.classList.contains("decision-card"));
    expect(cards).toHaveLength(13);

    // Opening a name from a theme group routes to its detail view.
    fireEvent.click(cards[0]);
    expect(screen.getAllByRole("img", { name: /^Score \d+ of 100$/ })).toHaveLength(1);
  });

  it("summarises what you can act on and flags off-platform ideas without hiding them", () => {
    render(<App />);

    // Front page: the investability card is part of the "what Saxo doesn't tell you" band.
    expect(screen.getByText(/Investable now/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Opportunities$/ }));
    const panel = screen.getByLabelText(/^Opportunities$/i);

    // The readout names how many ideas you can act on.
    expect(within(panel).getByText(/to act on/i)).toBeInTheDocument();
    // The Korea-listed names (Samsung, SK hynix) are off Saxo — flagged, not hidden.
    expect(within(panel).getAllByText(/off saxo/i).length).toBeGreaterThan(0);
    // Even off-limits, every non-owned name is still shown (honest, not silently dropped).
    const cards = within(panel)
      .getAllByRole("button")
      .filter((button) => button.classList.contains("decision-card"));
    expect(cards).toHaveLength(13);
    // Off-limits cards are visually demoted via a class, not removed from the DOM.
    expect(cards.some((card) => card.classList.contains("off-limits"))).toBe(true);

    // The hide toggle removes them on demand, then the count drops below 13.
    fireEvent.click(within(panel).getByLabelText(/hide off-limits/i));
    const after = within(screen.getByLabelText(/^Opportunities$/i))
      .getAllByRole("button")
      .filter((button) => button.classList.contains("decision-card"));
    expect(after.length).toBeLessThan(13);
    expect(after.some((card) => card.classList.contains("off-limits"))).toBe(false);
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
    await screen.findByText(/Live data/i);

    fireEvent.click(screen.getByRole("button", { name: /^Opportunities$/ }));
    const panel = screen.getByLabelText(/^Opportunities$/i);
    // One whole share already overshoots the per-trade budget.
    expect(within(panel).getAllByText(/1 share > budget/i).length).toBeGreaterThan(0);

    // Raising the budget past a single share clears the flag.
    const budget = screen.getByLabelText(/per-trade budget in dkk/i);
    fireEvent.change(budget, { target: { value: "20000" } });
    expect(within(screen.getByLabelText(/^Opportunities$/i)).queryByText(/1 share > budget/i)).toBeNull();
  });

  it("marks a market off-platform from the broker settings, and clears it again", () => {
    render(<App />);

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
    fireEvent.click(screen.getByRole("button", { name: /^Opportunities$/ }));

    const cardCount = () =>
      within(screen.getByLabelText(/^Opportunities$/i))
        .getAllByRole("button")
        .filter((button) => button.classList.contains("decision-card")).length;
    const before = cardCount();

    // Type a name that isn't in the curated universe and add it.
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "Cloudflare, Inc." } });
    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "net" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    // It joins the opportunity set as a new, scored card flagged "Added by you".
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
    // as owned — so it never becomes a chip with no matching opportunity card.
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "NVIDIA" } });
    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "NVDA" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/you already own that/i);

    // Removing the watched name drops it back out of the opportunity set.
    fireEvent.click(screen.getByRole("button", { name: /remove cloudflare, inc\. from your watchlist/i }));
    expect(cardCount()).toBe(before);
    expect(within(screen.getByLabelText(/^Opportunities$/i)).queryByText(/added by you/i)).toBeNull();
  });

  it("plots holdings and opportunities on the decision map and opens a name", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Map$/ }));

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
    expect(screen.getAllByRole("img", { name: /^Score \d+ of 100$/ })).toHaveLength(1);
  });

  it("compares two names head to head with a tale-of-the-tape and a verdict", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Compare$/ }));

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

    fireEvent.click(screen.getByRole("button", { name: /^Compare$/ }));
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

    await waitFor(() => expect(screen.getByText(/Editorial estimates/i)).toBeInTheDocument());
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

    expect(await screen.findByText(/Live data/i)).toBeInTheDocument();
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
    await screen.findByText(/Live data/i);
    fireEvent.click(screen.getByText(/in NVIDIA Corp\./i));

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
