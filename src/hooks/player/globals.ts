// ── Single-owner globals ──
//
// useAudioPlayer is instantiated twice: once by the desktop layout and once by
// <AudioPlayer/>, whose `if (!currentEpisode) return null` sits *after* the
// hooks, so it always runs them. Both instances share one HTMLAudioElement via
// the engine, so every media listener, timer and interval it installs was
// installed twice. The visible symptom was the queue advancing by two at the
// end of a track — two `ended` handlers each calling next() — plus a doubled
// position tick, a doubled persist interval and two reportStop() calls per
// unload.
//
// Ref-counted rather than claimed-by-first-mount: the count survives one
// instance unmounting, and React StrictMode's double-invoke (1→2→1) is a no-op.
//
// The count is PER CALL SITE, which is the whole point and was the bug. A single
// shared counter meant `globalRefs === 1` was true for exactly one of the calls
// — whichever ran first, i.e. the position timer — and the other four installs
// never ran at all. Not once, in any browser, since this was written. What that
// cost: the media element listeners were never attached, so the watchdog could
// see neither `progress` nor `canplay` and every load ran its deadline out and
// reported a phantom timeout over audio that was playing; `setFailureHandler`
// was never installed, so PlaybackErrorDialog could not open; playback position
// was never persisted; and the unload beacon never fired, so sessions
// accumulated in `active_sessions`.
//
// `releaseGlobals` was the same mistake twice: one variable for five cleanups,
// so even with a correct count a second install would have overwritten the
// first's teardown.
//
// A new call site needs a new key here. Reusing an existing one silently
// disables one of them.
const globalRefs = new Map<string, number>();
const globalRelease = new Map<string, () => void>();

export type GlobalKey =
  | "position-timer"
  | "media-events"
  | "failure-handler"
  | "failover-handler"
  | "persist-position"
  | "unload-flush"
  | "live-stop";

export function withGlobals(key: GlobalKey, install: () => () => void): () => void {
  const next = (globalRefs.get(key) ?? 0) + 1;
  globalRefs.set(key, next);
  if (next === 1) globalRelease.set(key, install());
  return () => {
    const remaining = (globalRefs.get(key) ?? 1) - 1;
    globalRefs.set(key, remaining);
    if (remaining === 0) {
      globalRelease.get(key)?.();
      globalRelease.delete(key);
    }
  };
}
