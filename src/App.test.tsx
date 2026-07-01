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

  it("leads the front page with the model's weighted verdict on the whole book", () => {
    render(<App />);

    const scorecard = screen.getByLabelText(/the model's verdict on your book/i);
    // The dial reports a position-weighted score in the model's own verdict language.
    expect(within(scorecard).getByLabelText(/your book scores \d+ out of 100, in .+ range/i)).toBeInTheDocument();
    // The capital split partitions the book by verdict, named and accessible.
    expect(within(scorecard).getByLabelText(/your money by verdict/i)).toBeInTheDocument();
    // The honesty caveat about measured-vs-editorial data is surfaced.
    expect(within(scorecard).getByText(/of your book/i)).toBeInTheDocument();
    // …and it does NOT overclaim: it names the axes that are editorial for EVERY name,
    // rather than rounding "has a price snapshot" up to "measured market data behind its
    // score" (AI exposure carries the largest weight and is always editorial).
    expect(within(scorecard).getByText(/AI exposure and geopolitics are editorial/i)).toBeInTheDocument();

    // The capital-split legend percentages add up to exactly 100 (largest-remainder
    // rounding) — a data-honesty product must not print a partition that sums to 99.
    const pcts = within(scorecard)
      .getAllByText(/^\d+%$/)
      .map((el) => Number(el.textContent!.replace("%", "")));
    expect(pcts.length).toBeGreaterThanOrEqual(2);
    expect(pcts.reduce((sum, n) => sum + n, 0)).toBe(100);
  });

  it("keeps the book's carrier and drag readable as the top and bottom ledger rows", () => {
    render(<App />);

    // The scorecard's "carries the book / drags it down" anchor cards were dropped as
    // literal duplicates of the ledger — but the read is not lost: the table is ranked
    // by score, so the carrier is the top row and the drag is the bottom row.
    const rows = ledgerRows();
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].getAttribute("aria-label")).toMatch(/NVIDIA Corp\./i);
    expect(rows[rows.length - 1].getAttribute("aria-label")).toMatch(/Tesla Inc\./i);
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

  it("re-expresses the book in the user's own per-trade size as a slot band", () => {
    render(<App />);

    // The full-width band: the book measured in counts of your typical buy.
    expect(screen.getByRole("heading", { name: /your book in your own trades/i })).toBeInTheDocument();
    const band = screen.getByLabelText(/your book measured in your own trades/i);
    // The lead ties the count to the per-trade budget the user sets.
    expect(within(band).getByText(/of your usual/i)).toBeInTheDocument();
    // The discrete tile grid is one labelled image spelling out each holding's slot count.
    expect(within(band).getByRole("img", { name: /your book as \d+ buys of dkk/i })).toBeInTheDocument();
    // The largest holding is reachable as a link into its detail (lead + legend).
    expect(within(band).getAllByRole("button", { name: /nvidia/i }).length).toBeGreaterThan(0);
    // The honesty discipline is stated: measured DKK only, no FX, no editorial.
    expect(within(band).getByText(/measured dkk only, no fx/i)).toBeInTheDocument();
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
    // row (14 = 20 curated names − 6 demo holdings), not capped at ten.
    expect(ledgerRows(panel)).toHaveLength(14);

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
    expect(rows).toHaveLength(14);
    // Off-limits rows are visually demoted via a class, not removed from the DOM.
    expect(rows.some((row) => row.classList.contains("off-limits"))).toBe(true);

    // The hide toggle removes them on demand, then the count drops below the full list.
    fireEvent.click(within(panel).getByLabelText(/hide off-limits/i));
    const after = ledgerRows(screen.getByLabelText(/^Opportunities$/i));
    expect(after.length).toBeLessThan(rows.length);
    expect(after.some((row) => row.classList.contains("off-limits"))).toBe(false);
  });

  it("flags an above-budget name when live prices load and lets the user raise the budget", async () => {
    const snapshot = {
      generatedAt: new Date().toISOString(), // fresh: the chip reads LIVE only while recent
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
      generatedAt: new Date().toISOString(), // fresh: the chip reads LIVE only while recent
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
    // AMD now appears twice in the overview: once in the sized "next moves" deploy
    // queue and once in the grouped ledger below it. Both open the same detail; click
    // the last (the grouped ledger row) to exercise the original path.
    const amdButtons = screen.getAllByRole("button", { name: /Advanced Micro Devices.*open detail/i });
    fireEvent.click(amdButtons[amdButtons.length - 1]);

    // The detail view sizes the position to the per-trade slot, not just the score.
    const plan = screen.getByLabelText(/buy plan for your per-trade slot/i);
    expect(within(plan).getByText(/buy plan/i)).toBeInTheDocument();
    expect(within(plan).getByText(/≈ 3 shares/i)).toBeInTheDocument();
    expect(within(plan).getByText(/of your DKK 5,000 slot/i)).toBeInTheDocument();
    expect(within(plan).getByText(/of your book/i)).toBeInTheDocument();
  });

  it("lists a sized deploy queue of the next moves you can act on", async () => {
    const snapshot = {
      generatedAt: new Date().toISOString(), // fresh: the chip reads LIVE only while recent
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        // Two non-owned, affordable names (≈1,380 / 1,242 DKK a share). At least one
        // isn't the standout hero, so the deploy queue beneath it shows a sized row.
        AMD: { symbol: "AMD", price: 200, currency: "USD", momentum: 65, asOf: "2026-06-28T18:49:41.386Z" },
        AVGO: { symbol: "AVGO", price: 180, currency: "USD", momentum: 70, asOf: "2026-06-28T18:49:41.386Z" },
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);
    await screen.findByText(/LIVE · YHOO/i);

    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));
    const queue = screen.getByLabelText(/more ideas you can act on, sized to your budget/i);
    expect(within(queue).getByText(/where your next slot could go/i)).toBeInTheDocument();
    // Every listed move carries a concrete whole-share buy plan, not just a score.
    expect(within(queue).getAllByText(/≈ \d+ shares?/i).length).toBeGreaterThan(0);
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
    // A removable chip and a one-tap "send to integration queue" link both appear
    // (the link prefills a GitHub issue the daily routine reads — no terminal).
    const queueLink = within(panel).getByRole("link", { name: /NET/i });
    expect(queueLink).toHaveAttribute("href", expect.stringContaining("/issues/new"));

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

  it("resolves a typed company name to its ticker and fills the market the broker gate needs", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));

    const nameInput = screen.getByLabelText(/company name/i);
    // Typing a name surfaces matching companies from the bundled directory — the
    // user never has to know the Yahoo ticker.
    fireEvent.change(nameInput, { target: { value: "novo" } });
    const listbox = screen.getByRole("listbox", { name: /matching companies/i });
    const option = within(listbox).getByRole("option", { name: /Novo Nordisk/i });
    expect(within(option).getByText("NOVO-B.CO")).toBeInTheDocument();

    // Picking it fills the ticker AND the listing market — even one that isn't a
    // universe exchange — so the broker tradability gate has a market to judge.
    fireEvent.mouseDown(option);
    expect((screen.getByLabelText(/ticker symbol/i) as HTMLInputElement).value).toBe("NOVO-B.CO");
    expect((screen.getByLabelText(/listing market/i) as HTMLSelectElement).value).toBe("Nasdaq Copenhagen");
  });

  it("warns at entry when a picked listing sits on a market the broker can't trade", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));
    // Mark NASDAQ off the user's platform via the broker controls.
    fireEvent.click(screen.getByRole("button", { name: "NASDAQ" }));

    const nameInput = screen.getByLabelText(/company name/i);
    fireEvent.change(nameInput, { target: { value: "Qualcomm" } });
    const listbox = screen.getByRole("listbox", { name: /matching companies/i });
    const option = within(listbox).getByRole("option", { name: /Qualcomm/i });
    // Qualcomm lists on NASDAQ, now off the broker, so the row carries the same
    // "Off Saxo" warning the opportunity ledger uses — before the name is even added.
    expect(within(option).getByText(/off saxo/i)).toBeInTheDocument();

    fireEvent.mouseDown(option);
    expect((screen.getByLabelText(/ticker symbol/i) as HTMLInputElement).value).toBe("QCOM");
    expect(screen.getByRole("status")).toHaveTextContent(/isn.t on your broker/i);
  });

  it("picks a directory suggestion with the keyboard (arrow down, enter)", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /^Opportunities/ }));

    const nameInput = screen.getByLabelText(/company name/i);
    fireEvent.change(nameInput, { target: { value: "infineon" } });
    // Arrow down highlights the first match; Enter selects it instead of submitting.
    fireEvent.keyDown(nameInput, { key: "ArrowDown" });
    fireEvent.keyDown(nameInput, { key: "Enter" });
    expect((screen.getByLabelText(/ticker symbol/i) as HTMLInputElement).value).toBe("IFX.DE");
    expect((screen.getByLabelText(/listing market/i) as HTMLSelectElement).value).toBe("XETRA");
  });

  it("sizes the front-page lead idea once a refresh's prices arrive (cache isn't stale)", async () => {
    // The lead opportunity (TSMC, top of the demo set) is assessed on the first
    // render — before the snapshot resolves — so its investability is cached as
    // "no price yet". The assessment cache is keyed by symbol, so it MUST be rebuilt
    // when the snapshot lands; otherwise that first verdict freezes and the buy plan
    // (which needs the price) never appears. A strong momentum keeps TSMC the lead
    // idea across the refresh, so the same name is assessed before and after.
    const snapshot = {
      generatedAt: new Date().toISOString(), // fresh: the chip reads LIVE only while recent
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

  it("annotates the NAV sparkline with its own trailing-12-month move, not the all-time total return", async () => {
    // Every demo holding gets a price history with the SAME first→last ratio (+10%),
    // so the FX-weighted portfolio series moves +10.00% over the trailing year
    // regardless of position sizes. The demo book's all-time total return is +12.42%
    // (gains 12,406 / cost 99,912) — a deliberately DIFFERENT number, on a different
    // window. The sparkline sits on the trailing-year line, so its badge must report
    // the line's own +10.00% move, never echo the +12.42% since-purchase figure.
    const history = [100, 102, 105, 108, 110]; // +10% first→last
    const entry = (symbol: string) => ({
      symbol,
      price: 110,
      currency: "USD",
      momentum: 60,
      history,
      asOf: "2026-06-28T18:49:41.386Z",
    });
    const snapshot = {
      generatedAt: new Date().toISOString(), // fresh: the chip reads LIVE only while recent
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        NVDA: entry("NVDA"),
        AAPL: entry("AAPL"),
        GOOGL: entry("GOOGL"),
        MSFT: entry("MSFT"),
        TSLA: entry("TSLA"),
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);
    await screen.findByText(/LIVE · YHOO/i);

    // The trailing-year badge reports the series' own measured move…
    const sparkHead = await screen.findByText(/portfolio · trailing 12 months/i);
    const badge = sparkHead.parentElement!.querySelector(".total");
    await waitFor(() => expect(badge).toHaveTextContent("+10.00%"));

    // …distinct from the hero's all-time return delta (a different window). With
    // live prices the headline NAV and its deltas are re-priced from the snapshot,
    // and the hero is honest about coverage: 5 of the 6 demo holdings are priced
    // here (SOXX has no snapshot), so it reads "5/6 holdings" and the all-time
    // delta is the live figure, never the sparkline's +10.00%.
    const hero = screen.getByLabelText(/net asset value/i);
    await screen.findByText(/live prices · 5\/6 holdings/i);
    const totalDelta = within(hero).getByText(/total/i).closest(".nav-delta");
    // The hero's all-time delta is the LIVE return — not the sparkline's +10.00%
    // and not the imported +12.42%. Every covered holding is marked to 110 here,
    // far below its import price, so the live return is a loss: proof the headline
    // is genuinely re-priced from the snapshot, not echoing a stored figure.
    expect(totalDelta).not.toHaveTextContent("10.00%");
    expect(totalDelta).not.toHaveTextContent("12.42");
    expect(totalDelta).toHaveTextContent("−");
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
      generatedAt: new Date().toISOString(), // fresh: the chip reads LIVE only while recent
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

  it("shows a live holding's day-change from the snapshot, not the broker's frozen % 1D afk.", async () => {
    // The headline NAV today% re-prices every live holding from its Yahoo snapshot
    // (valuation.ts liveDayPct). The ledger TODAY column must agree: a live holding's
    // row shows that same measured day-change, not the broker's frozen dayReturnPct
    // captured at import — otherwise a green headline sits over contradicting red rows.
    // NVDA is priced (so it is live: USD snapshot, positive price); GOOGL is NOT priced
    // (so its row must fall back to the broker figure, exactly as the headline does).
    const snapshot = {
      generatedAt: new Date().toISOString(),
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        NVDA: {
          symbol: "NVDA",
          price: 205,
          currency: "USD",
          previousClose: 200,
          dayChangePct: 2.5, // live: differs from the broker's −1.30% for NVDA
          momentum: 61,
          asOf: "2026-06-28T18:49:41.386Z",
        },
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);
    await screen.findByText(/LIVE · YHOO/i);

    // NVIDIA is live → its TODAY cell tracks the snapshot day-change (+2.50%), and must
    // NOT show the broker's frozen −1.30%.
    const nvda = await screen.findByRole("button", { name: /NVIDIA Corp\..*open detail/i });
    await waitFor(() => {
      const today = nvda.querySelector(".lt-today");
      expect(today?.textContent).toBe("+2.50%");
    });
    expect(nvda.querySelector(".lt-today")?.textContent).not.toContain("1.30");

    // Alphabet has no snapshot → not live → its TODAY falls back to the broker's
    // frozen % 1D afk. (+0.80% in the demo CSV), matching how the headline counts it.
    const googl = screen.getByRole("button", { name: /Alphabet Inc\..*open detail/i });
    expect(googl.querySelector(".lt-today")?.textContent).toBe("+0.80%");
  });

  it("shows a live holding's TOTAL re-priced from the snapshot, not the broker's frozen % Total afkast", async () => {
    // The headline NAV all-time return re-prices every live holding (valuation.ts
    // liveReturnPct). The ledger TOTAL column must agree: a live holding's row shows
    // that same re-priced return, not the broker's frozen "% Total afkast" captured at
    // import — otherwise a row sits red under a headline the live price pushed green.
    // NVDA is priced (live: USD snapshot). Its import price is 198, marketValueDkk
    // 27324 → factor 138; cost basis 20700. A snapshot at 210 → value 28980 →
    // (28980−20700)/20700 = +40.00%, distinct from the broker's frozen +32.00%.
    const snapshot = {
      generatedAt: new Date().toISOString(),
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        NVDA: {
          symbol: "NVDA",
          price: 210,
          currency: "USD",
          previousClose: 205,
          dayChangePct: 2.44,
          momentum: 61,
          asOf: "2026-06-28T18:49:41.386Z",
        },
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);
    await screen.findByText(/LIVE · YHOO/i);

    // NVIDIA is live → its TOTAL cell shows the re-priced +40.00%, NOT the frozen +32.00%.
    const nvda = await screen.findByRole("button", { name: /NVIDIA Corp\..*open detail/i });
    await waitFor(() => {
      expect(nvda.querySelector(".lt-total")?.textContent).toBe("+40.00%");
    });
    expect(nvda.querySelector(".lt-total")?.textContent).not.toContain("32.00");

    // Alphabet has no snapshot → not live → its TOTAL falls back to the broker's frozen
    // % Total afkast (+16.67% in the demo CSV), exactly as the headline counts it.
    const googl = screen.getByRole("button", { name: /Alphabet Inc\..*open detail/i });
    expect(googl.querySelector(".lt-total")?.textContent).toBe("+16.67%");
  });

  it("stops claiming LIVE and names the age when the snapshot is stale", async () => {
    const snapshot = {
      // Refreshed three days ago: real Yahoo prices, but no longer current.
      generatedAt: new Date(new Date().getTime() - 3 * 86_400_000).toISOString(),
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        NVDA: { symbol: "NVDA", price: 197.22, currency: "USD", momentum: 61, asOf: "2026-06-27T16:00:00.000Z" },
      },
      signals: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    render(<App />);

    // Age is named, the green "LIVE" claim is dropped, and it is NOT mislabelled
    // editorial — the prices are still measured Yahoo data, just stale.
    const chip = await screen.findByText(/3 DAYS OLD/i);
    expect(chip).toHaveTextContent(/YHOO/i);
    expect(chip).not.toHaveTextContent(/LIVE/i);
    expect(chip).not.toHaveTextContent(/EDITORIAL/i);
    expect(chip.className).toContain("stale");

    // The headline-NAV caption must not contradict the chip directly above it: with a
    // stale snapshot it drops the "Live prices" claim for "Snapshot prices" — still
    // crediting the measured Yahoo snapshot, just no longer asserting currency.
    const hero = screen.getByLabelText(/net asset value/i);
    const caption = within(hero).getByText(/prices ·/i);
    expect(caption).toHaveTextContent(/^Snapshot prices ·/i);
    expect(caption).not.toHaveTextContent(/Live prices/i);
  });

  it("draws the annotated price-path chart when history is present", async () => {
    const snapshot = {
      generatedAt: new Date().toISOString(), // fresh: the chip reads LIVE only while recent
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

  it("offers external deep-dive links on the company detail, opening in a new tab", () => {
    render(<App />);
    openNvidiaDetail();
    expect(detailIsOpen()).toBeInTheDocument();

    // The "go deeper" exit hands off to the full external chart the dashboard
    // doesn't re-render. Yahoo keys on the canonical symbol; TradingView on the
    // mapped exchange:ticker — both open safely in a new tab.
    const yahoo = screen.getByRole("link", { name: /yahoo finance/i });
    expect(yahoo).toHaveAttribute("href", "https://finance.yahoo.com/quote/NVDA");
    expect(yahoo).toHaveAttribute("target", "_blank");
    expect(yahoo).toHaveAttribute("rel", expect.stringContaining("noopener"));

    const tradingView = screen.getByRole("link", { name: /tradingview/i });
    expect(tradingView).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NASDAQ%3ANVDA",
    );
  });
});
