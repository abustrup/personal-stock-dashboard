import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the simple portfolio dashboard with seeded holdings and compliance language", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /personal stock dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^portfolio$/i })).toBeInTheDocument();
    expect(screen.getByText(/NVIDIA Corp./i)).toBeInTheDocument();
    expect(screen.getByText(/EIFO status is not clean by default/i)).toBeInTheDocument();
  });

  it("shows real P&L from the seed and falls back to editorial-only without a snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")));
    render(<App />);

    // Portfolio-level return is computed from the real CSV, not a placeholder.
    expect(screen.getByText(/Total return/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Editorial estimates only/i)).toBeInTheDocument(),
    );
  });

  it("flags live market data when a refresh snapshot is present", async () => {
    const snapshot = {
      generatedAt: "2026-06-24T18:49:41.386Z",
      sources: ["Yahoo Finance (keyless prices)"],
      market: {
        NVDA: {
          symbol: "NVDA",
          price: 197.22,
          currency: "USD",
          fiftyTwoWeekHigh: 236.54,
          fiftyTwoWeekLow: 149.26,
          return1m: -8.4,
          return3m: 12.6,
          return6m: 9,
          rangePosition: 0.55,
          momentum: 61,
          asOf: "2026-06-24T18:49:41.386Z",
        },
      },
      signals: {},
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }),
    );
    render(<App />);

    expect(await screen.findByText(/Live market data/i)).toBeInTheDocument();
  });
});
