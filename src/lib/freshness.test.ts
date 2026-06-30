import { describe, expect, it } from "vitest";
import { describeMarketFreshness, FRESH_WINDOW_MS } from "./freshness";

const NOW = new Date("2026-06-30T16:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("describeMarketFreshness", () => {
  it("calls a recent snapshot live", () => {
    const f = describeMarketFreshness(ago(30 * 60_000), NOW);
    expect(f?.state).toBe("live");
  });

  it("treats the window edge as still live (inclusive)", () => {
    const f = describeMarketFreshness(ago(FRESH_WINDOW_MS), NOW);
    expect(f?.state).toBe("live");
  });

  it("flags a snapshot just past the window as stale", () => {
    const f = describeMarketFreshness(ago(FRESH_WINDOW_MS + 60_000), NOW);
    expect(f?.state).toBe("stale");
  });

  it("a snapshot from the prior afternoon (overnight) reads stale", () => {
    // refreshed 16:00 yesterday, opened 16:00 today → 24h → a full session has moved
    const f = describeMarketFreshness(ago(24 * 3_600_000), NOW);
    expect(f?.state).toBe("stale");
    expect(f?.ageLabel).toBe("24 HOURS OLD");
  });

  it("labels in hours until two days (avoiding an ungrammatical '1 DAY'), then days", () => {
    expect(describeMarketFreshness(ago(13 * 3_600_000), NOW)?.ageLabel).toBe("13 HOURS OLD");
    // 47h59m must stay in hours, floored — never rounded up to "2 DAYS"
    expect(describeMarketFreshness(ago(47 * 3_600_000 + 59 * 60_000), NOW)?.ageLabel).toBe("47 HOURS OLD");
    // 48h is the first "DAYS" reading — and days is only ever plural here
    expect(describeMarketFreshness(ago(48 * 3_600_000), NOW)?.ageLabel).toBe("2 DAYS OLD");
  });

  it("labels multi-day staleness in days", () => {
    expect(describeMarketFreshness(ago(3 * 86_400_000), NOW)?.ageLabel).toBe("3 DAYS OLD");
  });

  it("never reports a negative age when the clock is behind the snapshot", () => {
    const f = describeMarketFreshness(ago(-5 * 60_000), NOW); // snapshot 5 min in the future
    expect(f?.ageMs).toBe(0);
    expect(f?.state).toBe("live");
  });

  it("returns undefined for missing or unparseable timestamps", () => {
    expect(describeMarketFreshness(undefined, NOW)).toBeUndefined();
    expect(describeMarketFreshness("not-a-date", NOW)).toBeUndefined();
  });
});
