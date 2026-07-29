/**
 * Is there actually a broadcast in this file?
 *
 * The catalog is community rips of wildly varying provenance, and at least one
 * of them contains no audio at all: a 77KB "episode" that is an ID3 tag
 * wrapping a JPEG cover image, zero decodable MP3 frames. Archive.org serves it
 * with a clean 206 and the correct content type, so every check we run at the
 * HTTP layer passes it. A listener presses play and gets nothing — which is
 * indistinguishable, from their side of the screen, from the show simply not
 * starting. That is the complaint we set out to fix; this is the last shape of
 * it that survives.
 *
 * The hard part is not detecting a short file, it is not crying wolf. Two
 * traps:
 *
 *  - Plenty of catalogued episodes are legitimately short. Statements, single
 *    hours, follow-up segments — 37 of the 1,313 are under ten minutes and all
 *    but one of them are real. Length alone proves nothing.
 *
 *  - `duration` at `loadedmetadata` is a guess for a VBR MP3 with no Xing
 *    header, which describes most of this catalog. Browsers extrapolate from
 *    the first frame's bitrate and correct themselves later. Refusing to play
 *    on the strength of that number would break working shows to fix a broken
 *    one, which is a bad trade.
 *
 * So the "much shorter than catalogued" test only runs at `ended`, once the
 * browser has seen the whole file and its duration is a measurement rather than
 * an estimate. The only thing judged up front is the absolute floor, where no
 * estimate is wrong enough to matter: nothing that reports under five seconds
 * is a three-hour broadcast.
 */

export type DurationVerdict = "ok" | "empty" | "truncated";

/** Below this there is no broadcast in the file, whatever the tag claims. */
const MIN_PLAYABLE_SECONDS = 5;
/** A file must hold at least this share of its catalogued runtime... */
const MIN_RATIO = 0.5;
/** ...and fall short by at least this much, so near-misses are never flagged. */
const MIN_SHORTFALL_SECONDS = 120;

export interface DurationCheck {
  /** What the element reports, in seconds. */
  actual: number;
  /** What the catalog claims, or null — 5 episodes genuinely have no duration. */
  expected: number | null;
  /**
   * "metadata" is an estimate and only the absolute floor is trusted; "ended"
   * is a measurement and the full comparison applies.
   */
  stage: "metadata" | "ended";
}

export function assessDuration({
  actual,
  expected,
  stage,
}: DurationCheck): DurationVerdict {
  // NaN means not known yet; Infinity means an unbounded stream. Neither is
  // evidence of anything, and treating them as failure would reject every
  // episode during the window before metadata arrives.
  if (!Number.isFinite(actual)) return "ok";

  if (actual <= MIN_PLAYABLE_SECONDS) return "empty";
  if (stage === "metadata") return "ok";

  if (expected == null || expected <= 0) return "ok";
  if (actual >= expected * MIN_RATIO) return "ok";
  if (expected - actual < MIN_SHORTFALL_SECONDS) return "ok";

  return "truncated";
}

export const __testing = {
  MIN_PLAYABLE_SECONDS,
  MIN_RATIO,
  MIN_SHORTFALL_SECONDS,
};
