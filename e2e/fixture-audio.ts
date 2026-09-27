/**
 * Take archive.org out of a spec's pass/fail: every request for an episode's
 * audio at archive.org is answered with a redirect to this origin's
 * `/mirror/{fileHash}`. On the e2e stack (scripts/live-e2e-stack.mjs) that is a
 * four-hour silent MP3 (scripts/e2e-mirror.mjs); pointed at production, it is
 * the real mirror.
 *
 * A redirect, not a failover: the player's source stays "archive", its
 * `currentSrc` stays the archive.org URL, and nothing about the play path
 * changes — only where the bytes come from. The first CI run of PR #36 failed
 * because archive.org stalled a stream on the runner; with this, a spec that
 * streams a show depends on this origin alone.
 */
import type { Page } from "@playwright/test";

const ARCHIVE_AUDIO = /^https:\/\/([a-z0-9-]+\.)*archive\.org\/download\/([^/?#]+)\/([^?#]+)/;

/** `https://archive.org/download/{identifier}/{file}` → `archive:{identifier}:{file}` (src/db/identity.ts). */
export function fileHashOf(archiveUrl: string): string | null {
  const m = ARCHIVE_AUDIO.exec(archiveUrl);
  if (!m) return null;
  return `archive:${decodeURIComponent(m[2])}:${decodeURIComponent(m[3])}`;
}

/** The episode a player source is: an archive.org URL or this origin's `/mirror/{fileHash}`. */
export function showOf(src: string): string | null {
  const mirror = /\/mirror\/([^/?#]+)$/.exec(new URL(src, "http://x").pathname);
  if (mirror) return decodeURIComponent(mirror[1]);
  return fileHashOf(src);
}

/**
 * Route `page`'s archive.org audio to its own origin's /mirror. Returns the
 * episode audio URLs this page then fetched from /mirror — by redirect, or
 * directly when the app itself believed archive.org was down — so a spec can
 * assert its show really came from here (an idle route would let archive.org
 * back into the pass/fail unseen).
 */
export async function playFromFixtureMirror(page: Page): Promise<string[]> {
  const served: string[] = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (/^\/mirror\/archive(:|%3A)/i.test(u.pathname)) served.push(req.url());
  });
  await page.route(ARCHIVE_AUDIO, (route) => {
    const hash = fileHashOf(route.request().url());
    if (!hash) return route.fallback();
    const origin = new URL(page.url()).origin;
    return route.fulfill({
      status: 302,
      headers: {
        location: `${origin}/mirror/${encodeURIComponent(hash)}`,
        // The element is crossOrigin="anonymous": a CORS redirect must pass the check too.
        "access-control-allow-origin": "*",
      },
    });
  });
  return served;
}
