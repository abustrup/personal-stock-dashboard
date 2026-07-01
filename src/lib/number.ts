// Small numeric helpers shared across the analytical modules and UI, so the
// same predicate/clamp is defined once rather than copied per file.

/** True only for a real, finite number (rejects NaN, Infinity and non-numbers). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Clamp a value to the 0–100 percent range. */
export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}
