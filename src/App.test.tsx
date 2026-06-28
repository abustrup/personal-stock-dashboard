import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText(/NVIDIA Corp\./i)).toBeInTheDocument();
    // The value-add insights are present.
    expect(screen.getByText(/Needs attention/i)).toBeInTheDocument();
    expect(screen.getByText(/Top opportunity/i)).toBeInTheDocument();
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
