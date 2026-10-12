/**
 * Share links for shows and moments (docs/show-pages.md, "Sharing").
 *
 * The Share button sends a show's own page, `/show/<slug>`, whose card names
 * the show; "Share this moment" sends `/show/<slug>?t=<seconds>`, the same
 * page, which plays from that second and has a card that says so. The slug map
 * stays on the server; the browser asks `/api/shows/link` for a show's slug by
 * its community key (src/hooks/useShowSlug.ts), and until it knows, the key's
 * own redirect (`/show/key/<key>?t=`) lands on the same page.
 *
 * Pure and client-safe: no file reads, no `@/` imports beyond pure modules.
 */

import { formatTime } from "@/lib/utils/format";

/** Moments are whole seconds, at most this many digits: 99,999 s is past any show. */
export const MOMENT_DIGITS = 5;
const MOMENT = /^\d{1,5}$/;

/** `?t=` as given: whole seconds, or null for anything else (a typo plays from the start, never errors). */
export function parseMomentSeconds(raw: string | null | undefined): number | null {
  if (raw == null || !MOMENT.test(raw)) return null;
  return Number(raw);
}

/** "1:23:45", "4:05": how the card, the page and the share text say a moment. */
export function momentLabel(seconds: number): string {
  return seconds > 0 ? formatTime(seconds) : "0:00";
}

/** A moment inside a show of `duration` seconds (unknown: any). Past the end is no moment. */
export function validMoment(seconds: number | null, duration: number | undefined): number | null {
  if (seconds == null || !Number.isInteger(seconds) || seconds < 0) return null;
  if (duration && Number.isFinite(duration) && seconds >= Math.floor(duration)) return null;
  return seconds;
}

export const showPagePath = (slug: string) => `/show/${slug}`;

/** The show page, or that moment of it. */
export function showShareUrl(origin: string, slug: string, seconds?: number | null): string {
  const base = `${origin}${showPagePath(slug)}`;
  return seconds != null ? `${base}?t=${Math.max(0, Math.floor(seconds))}` : base;
}

/** The key's redirect, which carries `t` to the same page: what a share uses before the slug is known. */
export function showKeyShareUrl(origin: string, key: string, seconds?: number | null): string {
  const base = `${origin}/show/key/${encodeURIComponent(key)}`;
  return seconds != null ? `${base}?t=${Math.max(0, Math.floor(seconds))}` : base;
}

/** The share sheet's text for a moment. */
export function momentShareText(title: string, seconds: number): string {
  return `${title}, from ${momentLabel(seconds)}. Listen on High Desert`;
}
