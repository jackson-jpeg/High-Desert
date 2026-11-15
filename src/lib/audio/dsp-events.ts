/**
 * The counters Level and Clean up keep (docs/audio-processing/README.md,
 * "What is counted"): one row per UTC day per event in `dsp_daily`. The
 * schema's CHECK lists the same words; dsp-events.test.ts holds them equal.
 *
 *   level-on / level-off / cleanup-on / cleanup-off   a listener flipped a switch
 *   play-level / play-cleanup / play-plain            a show started with Level on,
 *                                                     Clean up on, or neither
 *   unavailable-ios / unavailable-unsupported         the switches were shown greyed
 *   fallback-load       the processor's module would not load
 *   fallback-worklet    the processor failed while playing (plain playback took over)
 *   fallback-stalled    the audio stopped flowing through it (paused, with a message)
 *   fallback-silent     the source reached it as silence (CORS): plain playback
 */
export const DSP_EVENTS = [
  "level-on",
  "level-off",
  "cleanup-on",
  "cleanup-off",
  "play-level",
  "play-cleanup",
  "play-plain",
  "unavailable-ios",
  "unavailable-unsupported",
  "fallback-load",
  "fallback-worklet",
  "fallback-stalled",
  "fallback-silent",
] as const;
export type DspEvent = (typeof DSP_EVENTS)[number];

export function isDspEvent(s: unknown): s is DspEvent {
  return typeof s === "string" && (DSP_EVENTS as readonly string[]).includes(s);
}
