/**
 * Two-pass Level offline: a clip's envelope from its own momentary loudness,
 * the same series ffmpeg's ebur128 gives the server (400 ms windows every
 * 100 ms, K-weighted, channels summed, a mono file counted as dual mono).
 * For the evaluator and the target tests; production envelopes come from
 * scripts/level-envelopes.mjs.
 */
import { kBlocks, momentarySeries, type Clip } from "./metrics.ts";
import { ENVELOPE_HOP_SEC, ENVELOPE_OFFSET_SEC, ENVELOPE_VERSION, decodeEnvelope, encodeEnvelope, levelEnvelope, type Envelope } from "../../lib/audio/level-envelope.ts";

/** What ebur128 prints for digital silence. */
const SILENT_LUFS = -120.7;

export function momentaryFrames(c: Clip): number[] {
  return Array.from(momentarySeries(kBlocks(c)), (v) => (Number.isFinite(v) ? v : SILENT_LUFS));
}

export function envelopeForClip(c: Clip): Envelope {
  return {
    version: ENVELOPE_VERSION,
    hopSec: ENVELOPE_HOP_SEC,
    offsetSec: ENVELOPE_OFFSET_SEC,
    // Through the int8 storage, as the browser receives it.
    gainDb: decodeEnvelope(encodeEnvelope(levelEnvelope(momentaryFrames(c)))),
  };
}
