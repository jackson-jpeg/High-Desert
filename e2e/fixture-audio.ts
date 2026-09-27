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

/** Route `page`'s archive.org audio to its own origin's /mirror. Returns the redirected URLs, for asserting it happened. */
export async function playFromFixtureMirror(page: Page): Promise<string[]> {
  const redirected: string[] = [];
  await page.route(ARCHIVE_AUDIO, (route) => {
    const hash = fileHashOf(route.request().url());
    if (!hash) return route.fallback();
    redirected.push(route.request().url());
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
  return redirected;
}
