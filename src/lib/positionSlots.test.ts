import { describe, expect, it } from "vitest";
import { apportionCells, buildPositionSlots, DEFAULT_SLOT_CELL_CAP } from "./positionSlots";
import type { Company, Holding, Recommendation } from "./types";

const company = (symbol: string, name: string): Company => ({
  name,
  symbol,
  region: "US",
  exchange: "NASDAQ",
  assetType: "stock",
  themes: ["ai-platform"],
  aiExposure: 50,
  growth: 50,
  momentum: 50,
  quality: 50,
  valuationRisk: 50,
  balanceSheetRisk: 30,
  geopoliticalRisk: 30,
  newsSignal: { sentiment: 50, direction: "neutral", summary: "", freshness: "seed", sources: [] },
  expertSignal: { direction: "neutral", summary: "", freshness: "seed", sources: [] },
});

const holding = (symbol: string, marketValueDkk: number): Holding => ({
  instrument: symbol,
  rawSymbol: symbol,
  symbol,
  providerSymbol: symbol,
  isin: `ISIN${symbol}`,
  issuer: symbol,
  assetType: "stock",
  currency: "DKK",
  quantity: 1,
  currentPrice: marketValueDkk,
  marketValueDkk,
  portfolioWeight: 0,
});

// A holding-backed recommendation (an owned position).
const owned = (symbol: string, name: string, valueDkk: number): Recommendation => ({
  company: company(symbol, name),
  holding: holding(symbol, valueDkk),
  action: "hold",
  conviction: "medium",
  measured: true,
  score: 60,
  headline: "",
  reasoning: [],
  downside: "",
  compliance: { status: "unknown", flags: [], source: "test" },
  newsSignal: company(symbol, name).newsSignal,
  expertSignal: company(symbol, name).expertSignal,
  freshness: "seed",
});

// A non-owned idea (no holding) — should never count toward the book.
const idea = (symbol: string): Recommendation => ({ ...owned(symbol, symbol, 1), holding: undefined });

describe("buildPositionSlots", () => {
  it("expresses the book and each holding as a count of the per-trade budget", () => {
    const slots = buildPositionSlots(
      [owned("AAA", "Alpha", 30000), owned("BBB", "Beta", 15000), owned("CCC", "Gamma", 5000)],
      5000,
    );
    expect(slots).toBeDefined();
    expect(slots!.bookValueDkk).toBe(50000);
    expect(slots!.totalSlots).toBe(10);
    expect(slots!.totalSlotsRounded).toBe(10);
    expect(slots!.top.symbol).toBe("AAA");
    expect(slots!.top.slots).toBe(6); // 30000 / 5000
    expect(slots!.holdings.map((h) => h.symbol)).toEqual(["AAA", "BBB", "CCC"]);
    expect(slots!.topThreeSlots).toBe(10);
  });

  it("sorts holdings largest-first regardless of input order", () => {
    const slots = buildPositionSlots(
      [owned("S", "Small", 2000), owned("L", "Large", 40000), owned("M", "Mid", 8000)],
      5000,
    );
    expect(slots!.holdings.map((h) => h.symbol)).toEqual(["L", "M", "S"]);
    expect(slots!.top.symbol).toBe("L");
  });

  it("ignores non-owned ideas — only your holdings make up the book", () => {
    const slots = buildPositionSlots([owned("OWN", "Owned", 20000), idea("IDEA")], 5000);
    expect(slots!.bookValueDkk).toBe(20000);
    expect(slots!.holdings).toHaveLength(1);
    expect(slots!.holdings[0].symbol).toBe("OWN");
  });

  it("returns one tile per whole buy, summing exactly to the rounded book size", () => {
    const slots = buildPositionSlots(
      [owned("AAA", "Alpha", 27300), owned("BBB", "Beta", 24000), owned("CCC", "Gamma", 16000)],
      5000,
    );
    // book 67,300 / 5,000 = 13.46 -> 13 tiles
    expect(slots!.totalSlotsRounded).toBe(13);
    expect(slots!.cells).toHaveLength(13);
    expect(slots!.truncated).toBe(false);
    // tiles are contiguous, largest holding first
    expect(slots!.cells[0]).toBe("AAA");
  });

  it("apportions leftover tiles to the largest fractional remainders (sum is exact)", () => {
    // three equal holdings, 10 tiles: 3.33 each -> floors 3,3,3 = 9, one extra to a remainder
    const cells = apportionCells(
      [
        { symbol: "A", name: "A", valueDkk: 100, slots: 0 },
        { symbol: "B", name: "B", valueDkk: 100, slots: 0 },
        { symbol: "C", name: "C", valueDkk: 100, slots: 0 },
      ],
      300,
      10,
    );
    expect(cells).toHaveLength(10);
    const counts = cells.reduce<Record<string, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(10);
    // each holding gets at least its floor share
    for (const v of Object.values(counts)) expect(v).toBeGreaterThanOrEqual(3);
  });

  it("caps the tile count for a pathological (tiny-budget) book and flags it truncated", () => {
    const slots = buildPositionSlots([owned("BIG", "Big", 1_000_000)], 5000, 10);
    expect(slots!.totalSlotsRounded).toBe(200);
    expect(slots!.cells).toHaveLength(10); // capped
    expect(slots!.truncated).toBe(true);
    expect(slots!.cells.every((s) => s === "BIG")).toBe(true);
  });

  it("does not truncate a typical personal book under the default cap", () => {
    // a ~120k book at a 5k trade is ~24 slots — comfortably under the cap
    const slots = buildPositionSlots(
      [owned("A", "A", 60000), owned("B", "B", 40000), owned("C", "C", 20000)],
      5000,
    );
    expect(slots!.totalSlotsRounded).toBe(24);
    expect(slots!.totalSlotsRounded).toBeLessThan(DEFAULT_SLOT_CELL_CAP);
    expect(slots!.cells).toHaveLength(24);
    expect(slots!.truncated).toBe(false);
  });

  it("returns undefined when there is nothing to size", () => {
    expect(buildPositionSlots([], 5000)).toBeUndefined(); // no holdings
    expect(buildPositionSlots([idea("X")], 5000)).toBeUndefined(); // no owned book
    expect(buildPositionSlots([owned("A", "A", 10000)], 0)).toBeUndefined(); // no budget
    expect(buildPositionSlots([owned("A", "A", 10000)], -5)).toBeUndefined();
    expect(buildPositionSlots([owned("A", "A", 10000)], Number.NaN)).toBeUndefined();
  });

  it("always gives every holding of at least one whole buy its own tile", () => {
    // A small book where the two largest are >= 1 buy and two others are sub-1-buy.
    // Largest-remainder floors a >=1-buy holding to >=1, so it can never be tile-less;
    // sub-1-buy names ("less than one of your trades") may not fill a tile but still
    // appear in the legend with their true fractional count — honest, not dropped.
    const slots = buildPositionSlots(
      [
        owned("BIG", "Big", 12000), // 2.4 buys
        owned("MID", "Mid", 7000), // 1.4 buys
        owned("SML", "Small", 3000), // 0.6 buys
        owned("TNY", "Tiny", 2000), // 0.4 buys
      ],
      5000,
    );
    const tilesBySymbol = slots!.cells.reduce<Record<string, number>>(
      (m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }),
      {},
    );
    for (const h of slots!.holdings) {
      if (h.slots >= 1) expect(tilesBySymbol[h.symbol] ?? 0).toBeGreaterThanOrEqual(1);
    }
    // every holding, tiled or not, is still carried in the model for the legend
    expect(slots!.holdings.map((h) => h.symbol)).toEqual(["BIG", "MID", "SML", "TNY"]);
  });

  it("handles a single position as one full-book run of tiles", () => {
    const slots = buildPositionSlots([owned("ONE", "Only", 26000)], 5000);
    expect(slots!.totalSlotsRounded).toBe(5); // 26000/5000 = 5.2 -> 5
    expect(slots!.top.slots).toBeCloseTo(5.2);
    expect(slots!.cells).toEqual(["ONE", "ONE", "ONE", "ONE", "ONE"]);
  });
});
