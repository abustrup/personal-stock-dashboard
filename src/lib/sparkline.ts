// Pure geometry for the company detail view's price-path chart.
//
// The dashboard already fetches a full year of daily closes to derive the
// measured momentum and trailing returns (src/lib/market.ts); the refresh script
// stores a downsampled slice of that same series on the snapshot, and this module
// turns it into the SVG paths the detail view draws — plus it locates the
// trailing-return anchor points the momentum window is measured from.
//
// Everything here is pure and unit-tested so the picture can never drift from the
// numbers: the line IS the measured price path, the anchor markers sit on it, and
// the 52-week band is the same high/low the range bar uses. No editorial input,
// no charting dependency, no momentum math (that stays canonical in market.ts).

export type ChartDims = {
  width: number;
  height: number;
  padX: number;
  /** Top inner padding (headroom above the 52-week high line). */
  padTop: number;
  /** Bottom inner padding (room below the low line for the axis). */
  padBottom: number;
};

export type ChartPoint = { x: number; y: number; value: number; index: number };

export type PriceChart = {
  /** SVG path for the price line ("M x y L x y …"). */
  linePath: string;
  /** Closed area path under the line (down to the baseline and back). */
  areaPath: string;
  points: ChartPoint[];
  first: ChartPoint;
  last: ChartPoint;
  /** Vertical domain actually drawn (series extremes widened to include refs). */
  min: number;
  max: number;
  /** Pixel y for any price in the domain — used to place reference lines. */
  yFor: (value: number) => number;
};

/** A compact, measured read of a price series — the numbers a lead card's
 *  trajectory strip is annotated with, kept pure so the caption can never drift
 *  from the line it sits under. */
export type TrendSummary = {
  /** Net percentage move from the first drawn close to the last (the latest price). */
  changePct: number;
  /** True when the series ended at or above where it began. */
  rising: boolean;
  /** First (oldest) and last (latest) finite, positive closes actually drawn. */
  startValue: number;
  endValue: number;
  /** Where the latest price sits inside the series' own low→high band, 0 (at the
   *  series low) to 1 (at the series high). Undefined when the band is degenerate. */
  rangePosition?: number;
};

/**
 * Summarize a price series for the lead-card trajectory caption: the net move
 * across the drawn window and the latest price's position within the window's
 * own high/low. Pure and unit-tested, drawn from the SAME cleaned series
 * `buildPriceChart` plots (finite, positive, in order), so the number under the
 * line always matches the line. Returns undefined when fewer than two valid
 * closes exist — the honest "no trend yet" case the UI renders as empty.
 */
export function summarizeTrend(values: number[]): TrendSummary | undefined {
  const series = values.filter((value) => Number.isFinite(value) && value > 0);
  if (series.length < 2) return undefined;

  const startValue = series[0];
  const endValue = series[series.length - 1];
  const changePct = ((endValue - startValue) / startValue) * 100;

  const low = Math.min(...series);
  const high = Math.max(...series);
  const span = high - low;
  const rangePosition = span > 0 ? clamp((endValue - low) / span, 0, 1) : undefined;

  return { changePct: round(changePct), rising: endValue >= startValue, startValue, endValue, rangePosition };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Evenly downsample a numeric series to at most `target` points, always keeping
 * the first and last so the endpoints (and the latest price) stay exact. Returns
 * the cleaned input unchanged when it is already short enough. Non-finite values
 * are dropped first so a provider gap cannot break the path. Used by the refresh
 * script to turn ~252 daily closes into a compact ~weekly series for the JSON.
 */
export function downsample(values: number[], target: number): number[] {
  const clean = values.filter((value) => Number.isFinite(value));
  if (target < 2 || clean.length <= target) return clean;
  const out: number[] = [];
  const step = (clean.length - 1) / (target - 1);
  for (let i = 0; i < target; i += 1) {
    out.push(clean[Math.round(i * step)]);
  }
  return out;
}

/**
 * Index into a year-long, oldest→newest series for the point `monthsAgo` back,
 * so a trailing-return anchor (3M, 6M) can be marked on the line. Approximate by
 * design — the series is downsampled — so the UI labels these "~3M" and reads the
 * exact return from the canonical measured scalar, never from this position.
 */
export function monthsAgoIndex(length: number, monthsAgo: number, spanMonths = 12): number {
  if (length <= 1) return 0;
  const fromEnd = clamp((monthsAgo / spanMonths) * (length - 1), 0, length - 1);
  return length - 1 - Math.round(fromEnd);
}

/**
 * Build the SVG geometry for the price line. The vertical domain is the series'
 * own extremes, widened to include the 52-week high/low when given so the band
 * lines sit correctly and the path never clips. Returns undefined when there are
 * too few points to draw an honest line.
 */
export function buildPriceChart(
  values: number[],
  dims: ChartDims,
  refs?: { high?: number; low?: number },
): PriceChart | undefined {
  const series = values.filter((value) => Number.isFinite(value) && value > 0);
  if (series.length < 2) return undefined;

  const candidates = [...series];
  if (refs?.high !== undefined && refs.high > 0) candidates.push(refs.high);
  if (refs?.low !== undefined && refs.low > 0) candidates.push(refs.low);
  const min = Math.min(...candidates);
  const max = Math.max(...candidates);
  const span = max - min || 1;

  const innerW = dims.width - dims.padX * 2;
  const innerH = dims.height - dims.padTop - dims.padBottom;
  const baseline = dims.padTop + innerH;

  const xFor = (index: number) => dims.padX + (index / (series.length - 1)) * innerW;
  const yFor = (value: number) =>
    dims.padTop + (1 - (clamp(value, min, max) - min) / span) * innerH;

  const points: ChartPoint[] = series.map((value, index) => ({
    x: round(xFor(index)),
    y: round(yFor(value)),
    value,
    index,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const last = points[points.length - 1];
  const areaPath = `${linePath} L${last.x} ${round(baseline)} L${points[0].x} ${round(baseline)} Z`;

  return {
    linePath,
    areaPath,
    points,
    first: points[0],
    last,
    min,
    max,
    yFor: (value: number) => round(yFor(value)),
  };
}
