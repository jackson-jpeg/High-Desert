/**
 * An `ended` that is really a network failure.
 *
 * Found on iOS Safari (docs/ios-verification.md): with archive.org blocked
 * mid-show, a seek past the buffer stalled and the element then fired `pause`
 * and `ended` — no `error`, `MediaError` null — at 10,000 s of a 12,575 s
 * broadcast. Taken at its word, that clears the saved position and advances
 * the queue: the listener loses their place and hears the next show start.
 *
 * So an `ended` with no error, more than {@link EARLY_END_S} short of the
 * catalogued duration, is a failure of the source and goes to the mirror at
 * the same position — never the queue.
 *
 * Two guards keep a real ending from being mistaken for one:
 * - **The element must agree it is not at its end**, when it knows its own
 *   length. A file that is genuinely shorter than the catalog says reports
 *   `currentTime ≈ duration`; that is the empty/short-file case, which
 *   `duration-sanity.ts` owns, not a network failure.
 * - **No catalogued duration, no verdict.** archive.org's derive reports 0 for
 *   some full broadcasts (CLAUDE.md, "A missing duration is not evidence").
 */
export const EARLY_END_S = 120;

export function endedEarly({
  currentTime,
  elementDuration,
  catalogDuration,
  hasError,
}: {
  currentTime: number;
  elementDuration: number;
  catalogDuration: number | null | undefined;
  hasError: boolean;
}): boolean {
  if (hasError) return false;
  if (!Number.isFinite(currentTime)) return false;
  if (!catalogDuration || !Number.isFinite(catalogDuration) || catalogDuration <= 0) return false;
  if (catalogDuration - currentTime <= EARLY_END_S) return false;
  if (Number.isFinite(elementDuration) && elementDuration > 0 && elementDuration - currentTime <= EARLY_END_S) {
    return false;
  }
  return true;
}
