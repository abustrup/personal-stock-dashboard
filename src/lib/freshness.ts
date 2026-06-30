// How fresh is the measured-market snapshot behind the header chip?
//
// The chip used to assert "LIVE" whenever ANY snapshot was loaded, no matter how
// old — so a local copy refreshed days ago still read "LIVE · YHOO · 30 JUN 16:15"
// in confident green over stale prices. That dresses up uncertainty the dashboard
// is supposed to show, not hide (Charter §1). This classifies a snapshot by age so
// the chip only claims "LIVE" while the data is recent; once it ages past a
// trading-day-ish window we stop claiming live and name how old it is.
//
// Honesty note: stale measured data is still MEASURED. A stale snapshot is real
// Yahoo prices, just not current — so the stale state stays "YHOO · <when> · <age>",
// never demoted to "EDITORIAL" (which means no measured data at all).

// 12h tolerates same-trading-day intraday viewing (refresh at 9:00, glance at 16:00
// still reads live) while flagging an overnight-stale copy the next morning — a full
// session has moved by then, so "live" would overclaim. The deployed site refreshes
// hourly, so a healthy deploy is always well inside this window.
export const FRESH_WINDOW_MS = 12 * 60 * 60 * 1000;

export type MarketFreshness = {
  state: "live" | "stale";
  ageMs: number;
  /** Human age, e.g. "15 HOURS OLD", "3 DAYS OLD" — only meaningful when stale. */
  ageLabel: string;
};

// Returns undefined when the timestamp is missing or unparseable — the caller then
// falls back to the plain "LIVE" treatment rather than inventing an age.
export function describeMarketFreshness(
  generatedAtIso: string | undefined,
  now: Date,
): MarketFreshness | undefined {
  if (!generatedAtIso) return undefined;
  const ts = new Date(generatedAtIso).getTime();
  if (Number.isNaN(ts)) return undefined;
  const ageMs = Math.max(0, now.getTime() - ts);
  const state = ageMs <= FRESH_WINDOW_MS ? "live" : "stale";
  return { state, ageMs, ageLabel: formatAge(ageMs) };
}

// Coarse, upper-case to match the chip's other tokens. Floors to the largest whole
// unit ("at least N old"), so it never rounds a stale snapshot up to a fresher-
// sounding age.
function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} MIN OLD`;
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 48) return `${hours} HOUR${hours === 1 ? "" : "S"} OLD`;
  const days = Math.floor(ageMs / 86_400_000);
  return `${days} DAYS OLD`;
}
