/**
 * What of a stored `playback_failures.detail` may be shown on the public
 * `/api/stats/failures` route (HD-038).
 *
 * `detail` arrives in a POST anyone can send. The route bounds it (200 chars,
 * allowlisted episode, rate limit) but until now served it back verbatim, so
 * the failures panel was a place to post text for strangers to read. Not an
 * XSS — React escapes it — but spam in the one view that exists to be believed.
 *
 * The client only ever writes three shapes (src/audio/playback-watchdog.ts,
 * src/hooks/useAudioPlayer.ts), and only those survive:
 *
 *   code=3                                        MediaError.code, no message
 *   code=4 DEMUXER_ERROR_COULD_NOT_OPEN: …        Chromium's pipeline status
 *   duration=2.113 / ended duration=0.000         the advisory/empty-media form
 *
 * For the `code=` form, the browser's own status token is kept when it belongs
 * to a family a browser actually emits, and the free-text message after it is
 * dropped — the token is the signal CLAUDE.md describes ("DEMUXER_ERROR_COULD_
 * NOT_OPEN" is what separates an empty file from an unreachable one); the tail
 * is where arbitrary words would go. An unrecognised token degrades to the bare
 * `code=N`, which is still true — as does any message that does not open with
 * one. Anything not of these shapes becomes UNRECOGNISED_DETAIL.
 *
 * Filtered on output, not at ingest, on purpose: the stored row keeps the full
 * message for diagnosis by hand (psql), where the tail — "FFmpegDemuxer: open
 * context failed" and the like — is sometimes the only clue. Storage was
 * already bounded; what needed fixing is who can read it.
 */

export const UNRECOGNISED_DETAIL = "(unrecognised detail)";

/** How many details the public route shows per episode. */
export const PUBLIC_DETAILS_PER_EPISODE = 3;

/**
 * Status-token families real engines put in `MediaError.message`: Chromium's
 * PipelineStatus / media-element names, Firefox's NS_ERROR_DOM_MEDIA_*.
 */
const TOKEN_RE =
  /^(?:PIPELINE|DEMUXER|CHUNK_DEMUXER|DECODER|AUDIO_RENDERER|MEDIA_ELEMENT|NS_ERROR_DOM_MEDIA)(?:_[A-Z0-9]+)*$/;
const CODE_RE = /^code=(\d{1,2})(?: (.*))?$/;
/** The leading status word of a message: `DEMUXER_ERROR_X: …`, `NS_ERROR_Y (0x…)`. */
const LEAD_TOKEN_RE = /^([A-Z][A-Z0-9_]{0,63})(?=:|\s|$)/;
const DURATION_RE = /^(ended )?duration=(\d{1,7}(?:\.\d{1,3})?|NaN|-?Infinity)$/;

/** The public form of one stored detail, or null if nothing of it may be shown. */
export function publicDetail(raw: string): string | null {
  const s = raw.trim();

  const duration = DURATION_RE.exec(s);
  if (duration) return s;

  const code = CODE_RE.exec(s);
  if (code) {
    const token = code[2] ? LEAD_TOKEN_RE.exec(code[2])?.[1] : undefined;
    return token && TOKEN_RE.test(token) ? `code=${code[1]} ${token}` : `code=${code[1]}`;
  }

  return null;
}

/**
 * Stored details (distinct, newest first) → what the public route shows.
 *
 * Recognised details keep their order and are de-duplicated after
 * normalisation (two tails on one token are one diagnostic). Anything
 * unrecognised is represented at most once, and only after every real one, so
 * a burst of junk posts cannot crowd the real diagnostics out of the three
 * slots — which is what showing the newest three raw strings would allow.
 */
export function publicDetails(stored: readonly string[]): string[] {
  const out: string[] = [];
  let unrecognised = false;
  for (const raw of stored) {
    const d = publicDetail(raw);
    if (d === null) unrecognised = true;
    else if (!out.includes(d)) out.push(d);
  }
  if (unrecognised) out.push(UNRECOGNISED_DETAIL);
  return out.slice(0, PUBLIC_DETAILS_PER_EPISODE);
}
