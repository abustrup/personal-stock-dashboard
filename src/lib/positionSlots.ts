import type { Recommendation } from "./types";

/**
 * Your book, measured in units of YOUR OWN typical trade — a synthesis a broker
 * dashboard never draws. Saxo shows each position's weight (24% in NVIDIA); it
 * never tells you that, at the ~5,000 DKK you actually buy in, that one position
 * is 5–6 of your usual trades stacked on top of each other.
 *
 * The unit is the per-trade budget the user already sets for affordability
 * (`BrokerSettings.perTradeBudgetDkk`), so "a slot" is one of their normal buys.
 * The book and each holding are then expressed as a count of those slots:
 *
 *   totalSlots   = book value / budget          (the book is ≈ N of your buys)
 *   holding.slots = holding value / budget       (this name is ≈ M of your buys)
 *
 * Everything here is pure arithmetic on MEASURED DKK values (the broker's own
 * `marketValueDkk`, no FX) divided by a USER SETTING. Nothing editorial enters,
 * so it stays on the measured side of the data-honesty line; the framing is
 * factual ("5.5 of your buys"), never advice.
 */

export type SlotHolding = {
  symbol: string;
  name: string;
  /** Measured market value in DKK (broker import). */
  valueDkk: number;
  /** valueDkk / budget — how many of your typical buys this one position is. */
  slots: number;
};

export type PositionSlots = {
  /** The per-trade budget the slots are measured in. */
  budgetDkk: number;
  /** Total measured book value in DKK (sum of owned holdings). */
  bookValueDkk: number;
  /** bookValue / budget — the book expressed as a count of your typical buys. */
  totalSlots: number;
  /** totalSlots rounded for the "≈ N buys" headline; at least 1. */
  totalSlotsRounded: number;
  /** Owned holdings with a positive value, largest first. */
  holdings: SlotHolding[];
  /** The largest position by value — the concentration the slot framing dramatises. */
  top: SlotHolding;
  /** Combined slot count of the three largest positions. */
  topThreeSlots: number;
  /**
   * One symbol per discrete tile, largest-remainder apportioned so the tiles sum
   * exactly to `cells.length`. Each tile is ≈ one of your buys (exactly so when
   * not truncated). Largest holdings come first, in contiguous runs.
   */
  cells: string[];
  /** True when the book has more slots than the display cap, so tiles are scaled. */
  truncated: boolean;
};

/**
 * The default tile cap. Typical personal books (a ~40k–150k DKK book at a
 * ~5k DKK trade) are 8–30 slots and never hit this; the cap only guards a
 * pathological case (a tiny budget) from rendering hundreds of tiles.
 */
export const DEFAULT_SLOT_CELL_CAP = 36;

/**
 * Apportion `total` discrete tiles across the holdings in proportion to value,
 * using the largest-remainder method so the integer tiles sum to exactly `total`.
 * Each holding first takes its floor share; the leftover tiles go to the holdings
 * with the largest fractional remainders (ties broken by value, so a bigger
 * position is never out-tiled by a smaller one). Returns one symbol per tile, in
 * value-descending, contiguous runs.
 */
export function apportionCells(holdings: SlotHolding[], bookValueDkk: number, total: number): string[] {
  if (total <= 0 || bookValueDkk <= 0 || holdings.length === 0) return [];
  const quotas = holdings.map((h) => ({
    symbol: h.symbol,
    value: h.valueDkk,
    exact: (h.valueDkk / bookValueDkk) * total,
  }));
  const counts = quotas.map((q) => ({ ...q, count: Math.floor(q.exact) }));
  let assigned = counts.reduce((sum, q) => sum + q.count, 0);
  const byRemainder = [...counts].sort(
    (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || b.value - a.value,
  );
  for (let i = 0; assigned < total && i < byRemainder.length; i += 1) {
    byRemainder[i].count += 1;
    assigned += 1;
  }
  const countBySymbol = new Map(counts.map((q) => [q.symbol, q.count]));
  const cells: string[] = [];
  for (const h of holdings) {
    const n = countBySymbol.get(h.symbol) ?? 0;
    for (let i = 0; i < n; i += 1) cells.push(h.symbol);
  }
  return cells;
}

/**
 * Build the slot model for a portfolio at a given per-trade budget. Only owned
 * holdings with a positive market value count; ideas you don't own aren't part of
 * "your book". Returns undefined when there's nothing to size (no budget, no book),
 * so the caller renders nothing rather than a divide-by-zero.
 */
export function buildPositionSlots(
  portfolio: Recommendation[],
  budgetDkk: number,
  cap: number = DEFAULT_SLOT_CELL_CAP,
): PositionSlots | undefined {
  if (!Number.isFinite(budgetDkk) || budgetDkk <= 0) return undefined;

  const holdings: SlotHolding[] = portfolio
    .filter((rec) => rec.holding && rec.holding.marketValueDkk > 0)
    .map((rec) => ({
      symbol: rec.company.symbol,
      name: rec.company.name,
      valueDkk: rec.holding!.marketValueDkk,
      slots: rec.holding!.marketValueDkk / budgetDkk,
    }))
    .sort((a, b) => b.valueDkk - a.valueDkk);

  if (holdings.length === 0) return undefined;

  const bookValueDkk = holdings.reduce((sum, h) => sum + h.valueDkk, 0);
  if (bookValueDkk <= 0) return undefined;

  const totalSlots = bookValueDkk / budgetDkk;
  const totalSlotsRounded = Math.max(1, Math.round(totalSlots));
  const tileCount = Math.min(totalSlotsRounded, Math.max(1, Math.floor(cap)));
  const topThreeSlots = holdings.slice(0, 3).reduce((sum, h) => sum + h.slots, 0);

  return {
    budgetDkk,
    bookValueDkk,
    totalSlots,
    totalSlotsRounded,
    holdings,
    top: holdings[0],
    topThreeSlots,
    cells: apportionCells(holdings, bookValueDkk, tileCount),
    truncated: totalSlotsRounded > tileCount,
  };
}
