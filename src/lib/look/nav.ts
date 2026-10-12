import type { Look } from "./look";

/**
 * Where the radio dial lives, per look (docs/looks.md).
 *
 * The public look keeps its Radio tab and /radio. In the preview looks the
 * Radio tab is retired: a usage audit found it quiet (about 4% of browsers
 * ever opened it, about 1.5% of plays), so the dial became a browse mode of
 * the Library, reached as `/library?view=dial` (src/lib/library/intents.ts).
 * Every navigation surface (the shell's tabs, the menu bar, the mobile More
 * sheet, the command palette) and /radio itself ask this module, so the
 * preview looks cannot disagree with one another about it.
 */

/** The Library in Dial mode: a library intent. */
export const DIAL_HREF = "/library?view=dial";

/** True where the Radio tab is gone and the dial is a Library mode. */
export function radioRetired(look: Look): boolean {
  return look !== "default";
}

/** Admin-only destinations: hidden from everyone else in every look. */
const ADMIN_PATHS = new Set(["/scanner", "/search"]);

/** Whether a navigation tab for `path` is shown, for this look and visitor. */
export function showsNavPath(path: string, look: Look, isAdmin: boolean): boolean {
  if (ADMIN_PATHS.has(path) && !isAdmin) return false;
  if (path === "/radio" && radioRetired(look)) return false;
  return true;
}

/** Where "the radio dial" is for this look: /radio, or the Library's Dial mode. */
export function dialHref(look: Look): string {
  return radioRetired(look) ? DIAL_HREF : "/radio";
}

/** What a menu calls the dial, for this look. */
export function dialLabel(look: Look): string {
  return radioRetired(look) ? "Library Dial" : "Radio Dial";
}
