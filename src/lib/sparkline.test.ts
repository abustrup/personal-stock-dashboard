import { describe, expect, it } from "vitest";
import { buildPriceChart, downsample, monthsAgoIndex, type ChartDims } from "./sparkline";

const dims: ChartDims = { width: 320, height: 120, padX: 8, padTop: 10, padBottom: 18 };

describe("downsample", () => {
  it("keeps a short series unchanged", () => {
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it("reduces to the target length, preserving first and last", () => {
    const series = Array.from({ length: 252 }, (_, i) => i);
    const out = downsample(series, 52);
    expect(out).toHaveLength(52);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(251);
  });

  it("drops non-finite values before sampling", () => {
    expect(downsample([1, NaN, 3, Infinity, 5], 10)).toEqual([1, 3, 5]);
  });

  it("returns the cleaned series when target is degenerate", () => {
    expect(downsample([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });
});

describe("monthsAgoIndex", () => {
  it("returns the last index for 0 months ago", () => {
    expect(monthsAgoIndex(13, 0)).toBe(12);
  });

  it("places 3 months back a quarter of the way from the end", () => {
    // 13 points spanning 12 months: 3/12 * 12 = 3 steps from the end → index 9.
    expect(monthsAgoIndex(13, 3)).toBe(9);
  });

  it("places 6 months back at the midpoint", () => {
    expect(monthsAgoIndex(13, 6)).toBe(6);
  });

  it("never goes out of range", () => {
    expect(monthsAgoIndex(5, 24)).toBe(0);
    expect(monthsAgoIndex(1, 6)).toBe(0);
  });
});

describe("buildPriceChart", () => {
  it("returns undefined for too few points", () => {
    expect(buildPriceChart([], dims)).toBeUndefined();
    expect(buildPriceChart([100], dims)).toBeUndefined();
  });

  it("ignores non-finite and non-positive values", () => {
    expect(buildPriceChart([100, NaN, 0, -5], dims)).toBeUndefined();
  });

  it("anchors the first and last points to the plot edges", () => {
    const chart = buildPriceChart([10, 20, 30], dims)!;
    expect(chart.first.x).toBe(dims.padX);
    expect(chart.last.x).toBe(dims.width - dims.padX);
    // Lowest value sits at the bottom of the inner plot, highest at the top.
    expect(chart.first.y).toBe(dims.height - dims.padBottom);
    expect(chart.last.y).toBe(dims.padTop);
  });

  it("widens the domain to include the 52-week band so lines never clip", () => {
    const chart = buildPriceChart([100, 110, 120], dims, { high: 140, low: 80 })!;
    expect(chart.max).toBe(140);
    expect(chart.min).toBe(80);
    // The band edges map to the very top and bottom of the inner plot.
    expect(chart.yFor(140)).toBe(dims.padTop);
    expect(chart.yFor(80)).toBe(dims.height - dims.padBottom);
    // The latest price sits between the band edges.
    expect(chart.last.y).toBeGreaterThan(dims.padTop);
    expect(chart.last.y).toBeLessThan(dims.height - dims.padBottom);
  });

  it("builds a closed area path returning to the baseline", () => {
    const chart = buildPriceChart([10, 20], dims)!;
    expect(chart.linePath.startsWith("M")).toBe(true);
    expect(chart.areaPath.endsWith("Z")).toBe(true);
    expect(chart.points).toHaveLength(2);
  });

  it("keeps a flat series on a single horizontal line without dividing by zero", () => {
    const chart = buildPriceChart([50, 50, 50], dims)!;
    expect(chart.points.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(new Set(chart.points.map((p) => p.y)).size).toBe(1);
  });
});
