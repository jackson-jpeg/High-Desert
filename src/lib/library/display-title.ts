/**
 * The one way a show's name reaches the screen (2026-10-01).
 *
 * On Air showed "Art-Bell_Midnight_In_the_Desert--2015-12-08_--_Ar…": a
 * community key, printed because the listener's library had no row for it
 * (SEED_VERSION had not been bumped for the 2026-09-28 import, so nobody seeded
 * before then ever received those 101 shows), and the row's fallback was
 * `title || fileName || id`. Forty other places spelled the same fallback.
 *
 * Every surface now calls `episodeTitle()` (a row) or `keyTitle()` (an id from
 * the stats API), and neither can return a file name or a key: a title that
 * looks like one is passed over, and the last resort is the file name made
 * readable. `display-title.test.ts` holds both, and fails on any
 * `title || fileName` spelled anywhere else in src/.
 */

const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav|aiff?|wma)$/i;

/** True for something that is a file name, a path or a community key, not a title. */
export function looksLikeFileName(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (AUDIO_EXT.test(t)) return true;
  if (/%[0-9A-F]{2}/i.test(t)) return true;
  // Words joined by underscores, or the key's `--` separator, with no spaces.
  if (!/\s/.test(t) && /[_]|--/.test(t)) return true;
  return false;
}

/** A file name or key made readable: no extension, no underscores, no `--`. */
export function readableFileName(name: string): string {
  let s = name;
  try {
    s = decodeURIComponent(s);
  } catch {
    // a stray % is fine as it is
  }
  s = s.replace(/^.*[\\/]/, "").replace(AUDIO_EXT, "");
  s = s.replace(/_+/g, " ").replace(/\s*--\s*/g, " - ").replace(/\s+/g, " ").trim();
  return s;
}

export const UNTITLED = "Untitled show";

/** The title of an episode row: its own title, never its file name as such. */
export function episodeTitle(ep: { title?: string | null; fileName?: string | null } | null | undefined): string {
  const t = ep?.title?.trim();
  if (t && !looksLikeFileName(t)) return t;
  const fromFile = ep?.fileName ? readableFileName(ep.fileName) : "";
  if (fromFile) return fromFile;
  return t ? readableFileName(t) || UNTITLED : UNTITLED;
}

/**
 * The title for an id from the stats API: the local row's, else the catalog
 * title the server sent, else the key made readable (the part after the
 * collection, `{collection}--{file}`).
 */
export function keyTitle(
  episode: { title?: string | null; fileName?: string | null } | null | undefined,
  episodeId: string,
  catalogTitle?: string | null,
): string {
  if (episode) return episodeTitle(episode);
  const c = catalogTitle?.trim();
  if (c && !looksLikeFileName(c)) return c;
  const file = episodeId.includes("--") ? episodeId.slice(episodeId.indexOf("--") + 2) : episodeId;
  return readableFileName(file) || UNTITLED;
}
