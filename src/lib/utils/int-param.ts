/**
 * A bounded integer from a query-string value (HD-027).
 *
 * `parseInt` alone is not validation: `parseInt("abc")` is NaN, and NaN
 * survives `Math.min`/`Math.max` untouched — `Math.min(NaN, 100)` is NaN — so
 * `?rows=abc` went to archive.org as `rows=NaN`, and `?rows=0` on the scrape
 * route divided by zero into `totalPages: Infinity`. Anything absent or not a
 * number is `fallback`; anything else is clamped into `[min, max]`.
 */
export function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
