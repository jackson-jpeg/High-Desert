/**
 * Which start is the current one, and has it been counted?
 *
 * ## The generation token (HD-003)
 *
 * Starting a show is asynchronous — a metadata fetch, an OPFS lookup, and then
 * `play()`, whose promise settles whenever the network gets round to it. The
 * listener does not wait for any of that before changing their mind. When B was
 * started while A's `play()` was still pending, B's `load()` rejected A's
 * promise with `AbortError`, and A's `catch` ran *after* B had armed the
 * watchdog — so A's rejection was charged to B. The chain ended in `giveUp`:
 * the failure dialog opened over a show that was playing, a false
 * `play-rejected` row went into the table this project uses to judge its own
 * reliability, and `countListen(B)` never ran, so B was missing from the
 * leaderboard, the event log and "on air".
 *
 * So every start takes a number, and every continuation that runs after an
 * `await` checks that its number is still the newest before it touches shared
 * state. A superseded start's outcome — success or failure — belongs to nobody,
 * and is dropped without a word.
 *
 * ## The counted-listen flag (HD-024)
 *
 * `togglePlay()` used to decide "is this the first play of this source?" from
 * `readyState`, which a seek while paused drops back below HAVE_FUTURE_DATA —
 * so pausing, scrubbing and resuming counted a fresh listen. Whether this
 * source's listen has been counted is now a fact recorded when it happens, and
 * reset only when a new source is assigned.
 */

let generation = 0;
/** The generation whose listen has been counted, or -1. */
let countedGeneration = -1;

/**
 * A new start: the listener asked for a show, or a new source was assigned.
 * Returns its id. Everything earlier is superseded from this moment.
 */
export function beginStart(): number {
  generation += 1;
  return generation;
}

/** The id of the newest start. */
export function currentStart(): number {
  return generation;
}

/** Is `id` still the newest start? Check after every `await`. */
export function isCurrentStart(id: number): boolean {
  return id === generation;
}

/** The newest start's listen has been counted. */
export function markListenCounted(id: number): void {
  if (id === generation) countedGeneration = id;
}

/** Has the newest start's listen been counted? */
export function isListenCounted(): boolean {
  return countedGeneration === generation;
}

/**
 * `play()` was interrupted rather than refused: a new `load()` or a `pause()`
 * got there first. That is the listener (or this app) changing course, not a
 * failure, and it must never reach the watchdog.
 */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

/** How close to the end a saved position counts as "finished". */
export const FINISHED_WITHIN_S = 30;
/** ...or how far through, as a fraction of the duration. */
export const FINISHED_FRACTION = 0.95;

/**
 * Where a show should start from, given where the listener left it.
 *
 * Position is saved as the show plays and nothing reset it at the end, so a
 * finished show resumed in its last few seconds: `ended` fired almost at once,
 * the queue advanced, and to the listener "the show didn't start" (HD-004).
 * Within 30 s of the end, or past 95%, a show is finished and starts over.
 */
export function startPositionFor(
  saved: number | undefined | null,
  duration: number | undefined | null,
): number {
  const pos = typeof saved === "number" && Number.isFinite(saved) && saved > 0 ? saved : 0;
  if (pos === 0) return 0;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return pos;
  }
  if (pos >= duration - FINISHED_WITHIN_S || pos >= duration * FINISHED_FRACTION) {
    return 0;
  }
  return pos;
}

export const __testing = {
  reset: () => {
    generation = 0;
    countedGeneration = -1;
  },
};
