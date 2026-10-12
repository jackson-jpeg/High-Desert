/**
 * Where the radio dial lives (docs/looks.md).
 *
 * There is no Radio tab: a usage audit found it quiet (about 4% of browsers
 * ever opened it, about 2% of plays), so the dial is a browse mode of the
 * Library, reached as `/library?view=dial` (src/lib/library/intents.ts), and
 * /radio redirects there (src/proxy.ts). On a phone its slot in the tab bar
 * went to the Phone Lines.
 */

/** The Library in Dial mode: a library intent. */
export const DIAL_HREF = "/library?view=dial";

/** What a menu calls the dial. */
export const DIAL_LABEL = "Library Dial";

/** Admin-only destinations: hidden from everyone else. */
const ADMIN_PATHS = new Set(["/scanner", "/search"]);

/** Whether a navigation tab for `path` is shown to this visitor. */
export function showsNavPath(path: string, isAdmin: boolean): boolean {
  if (ADMIN_PATHS.has(path) && !isAdmin) return false;
  if (path === "/radio") return false;
  return true;
}
