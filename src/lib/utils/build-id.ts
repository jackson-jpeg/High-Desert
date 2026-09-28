/**
 * Which build a page is running, and whether a string names a build.
 *
 * A build id is what `next.config.ts` bakes into NEXT_PUBLIC_BUILD_ID: the
 * commit's short SHA, with a digest of the working tree after a dash when the
 * tree was dirty. scripts/deploy.sh refuses a dirty tree, so in production it
 * is always the bare short SHA.
 *
 * The page reads its own build from `<meta name="hd-build">` (the root layout
 * writes it) rather than from the inlined constant, so the document is the one
 * source: what a reload fetched is what the page says it is. Every play and
 * failure row carries it (`build` on /api/stats/play and /api/playback-event),
 * and the stale-tab watcher compares it with `/api/build`.
 */

export const BUILD_META = "hd-build";

/** A short or full SHA, optionally `-<7 hex>` for a dirty tree. Nothing else is stored. */
export const BUILD_ID_RE = /^[0-9a-f]{7,40}(?:-[0-9a-f]{7})?$/;

export function isBuildId(v: unknown): v is string {
  return typeof v === "string" && BUILD_ID_RE.test(v);
}

/** The build this server was compiled as, or null (dev, or no git at build time). */
export function serverBuild(): string | null {
  const id = process.env.NEXT_PUBLIC_BUILD_ID;
  return isBuildId(id) ? id : null;
}

/** The build this page was served as, or null when it cannot say. */
export function pageBuild(): string | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${BUILD_META}"]`);
  const id = meta?.content;
  return isBuildId(id) ? id : null;
}
