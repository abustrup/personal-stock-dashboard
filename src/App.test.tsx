import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
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
});
