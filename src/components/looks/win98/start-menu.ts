/**
 * The Win98 look's Start menu, as data (src/components/looks/win98/StartMenu.tsx
 * draws it). Kept pure so the list, the keyboard and the Run box are tested
 * without a DOM.
 *
 * Radio is never listed: a usage audit found the Radio tab quiet, so the
 * dial lives inside the Library (`/library?view=dial`).
 */

export type StartAction =
  | { kind: "route"; href: string }
  | { kind: "about" }
  | { kind: "shortcuts" }
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "display" }
  | { kind: "submenu"; items: StartItem[] }
  | { kind: "run" }
  | { kind: "shutdown" };

export type StartIcon =
  | "library"
  | "live"
  | "phone"
  | "dial"
  | "stats"
  | "scanner"
  | "search"
  | "settings"
  | "display"
  | "about"
  | "shortcuts"
  | "help"
  | "run"
  | "shutdown";

export interface StartItem {
  id: string;
  label: string;
  /** The underlined letter: pressing it while the menu is open picks the item. */
  accel: string;
  icon: StartIcon;
  action: StartAction;
  /** A rule above this item. */
  separatorBefore?: boolean;
}

/** Where "Phone Lines" goes: the Live screen, with the lines open on a phone. */
export const PHONE_LINES_HREF = "/live#phone-lines";
/** The Library's dial browse mode (an intent another branch builds). */
export const DIAL_HREF = "/library?view=dial";

export function startMenuItems({ isAdmin, isMobile }: { isAdmin: boolean; isMobile: boolean }): StartItem[] {
  const items: StartItem[] = [
    { id: "library", label: "Library", accel: "L", icon: "library", action: { kind: "route", href: "/library" } },
    { id: "live", label: "Live", accel: "V", icon: "live", action: { kind: "route", href: "/live" } },
    { id: "phone-lines", label: "Phone Lines", accel: "P", icon: "phone", action: { kind: "route", href: PHONE_LINES_HREF } },
    { id: "dial", label: "Dial", accel: "D", icon: "dial", action: { kind: "route", href: DIAL_HREF } },
    { id: "stats", label: "Stats", accel: "S", icon: "stats", action: { kind: "route", href: "/stats" } },
  ];
  if (isAdmin) {
    items.push(
      { id: "scanner", label: "Scanner", accel: "C", icon: "scanner", action: { kind: "route", href: "/scanner" } },
      { id: "search", label: "Search archive.org", accel: "E", icon: "search", action: { kind: "route", href: "/search" } },
    );
  }
  items.push({
    id: "settings",
    label: "Settings",
    accel: "T",
    icon: "settings",
    action: { kind: "submenu", items: settingsItems({ isMobile }) },
    separatorBefore: true,
  });
  items.push(
    { id: "about", label: "About High Desert", accel: "A", icon: "about", action: { kind: "about" } },
    { id: "shortcuts", label: "Shortcuts", accel: "O", icon: "shortcuts", action: { kind: "shortcuts" } },
    { id: "help", label: "Help", accel: "H", icon: "help", action: { kind: "help" } },
    { id: "run", label: "Run...", accel: "R", icon: "run", action: { kind: "run" } },
    { id: "shutdown", label: "Shut Down...", accel: "U", icon: "shutdown", action: { kind: "shutdown" }, separatorBefore: true },
  );
  return items;
}

/**
 * Start > Settings: Display (the look: Win98 or Night, docs/looks.md), and on
 * a phone, which has no menu bar, the rest of its settings (text size, sound,
 * export) in the More sheet.
 */
export function settingsItems({ isMobile }: { isMobile: boolean }): StartItem[] {
  const items: StartItem[] = [
    { id: "display", label: "Display...", accel: "D", icon: "display", action: { kind: "display" } },
  ];
  if (isMobile) {
    items.push({ id: "more-settings", label: "More Settings...", accel: "M", icon: "settings", action: { kind: "settings" } });
  }
  return items;
}

/** The items a submenu item opens, or null for an item that acts. */
export function submenuOf(item: StartItem): StartItem[] | null {
  return item.action.kind === "submenu" ? item.action.items : null;
}

/**
 * Where focus goes for a key while the menu is open, or null when the key is
 * not the menu's. Arrows wrap, as Windows does; a letter jumps to the item it
 * underlines.
 */
export function startMenuKey(key: string, current: number, items: readonly StartItem[]): number | null {
  const n = items.length;
  if (n === 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % n;
    case "ArrowUp":
      return current < 0 ? n - 1 : (current - 1 + n) % n;
    case "Home":
      return 0;
    case "End":
      return n - 1;
  }
  if (key.length === 1) {
    const i = items.findIndex((it) => it.accel.toLowerCase() === key.toLowerCase());
    return i >= 0 ? i : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Run...
// ---------------------------------------------------------------------------

export type RunResult =
  | { kind: "action"; action: StartAction }
  | { kind: "mels-hole" }
  | { kind: "not-found"; name: string }
  | { kind: "empty" };

/** Names the Run box opens Mel's Hole for. Spaces, case and apostrophes do not matter. */
export const MELS_HOLE_NAMES = ["melshole", "melshole.exe", "melwaters", "ellensburg"];

function normalise(input: string): string {
  return input.trim().toLowerCase().replace(/[\s'’_-]+/g, "");
}

export function runCommand(input: string): RunResult {
  const name = normalise(input);
  if (!name) return { kind: "empty" };
  if (MELS_HOLE_NAMES.includes(name)) return { kind: "mels-hole" };
  const route = (href: string): RunResult => ({ kind: "action", action: { kind: "route", href } });
  switch (name.replace(/\.exe$/, "")) {
    case "library":
    case "explorer":
      return route("/library");
    case "live":
      return route("/live");
    case "notepad":
    case "phonelines":
      return route(PHONE_LINES_HREF);
    case "dial":
    case "radio":
      return route(DIAL_HREF);
    case "stats":
    case "taskmgr":
      return route("/stats");
    case "winver":
    case "about":
      return { kind: "action", action: { kind: "about" } };
    case "help":
    case "winhelp":
      return { kind: "action", action: { kind: "help" } };
    case "display":
    case "desk.cpl":
      return { kind: "action", action: { kind: "display" } };
  }
  return { kind: "not-found", name: input.trim() };
}

/** The Run box's refusal, worded as Windows worded it (no em dashes). */
export function notFoundMessage(name: string): string {
  return `Cannot find the file '${name}' (or one of its components). Make sure the path and filename are correct and that all required libraries are available.`;
}

// ---------------------------------------------------------------------------
// Typing on the desktop
// ---------------------------------------------------------------------------

/** The word that, typed with nothing focused, opens Mel's Hole. No letter of
 *  it is a player shortcut (M mutes, N and P skip). */
export const HOLE_WORD = "hole";

/**
 * Feed one key into a typed-word matcher. Returns the new progress and
 * whether the word is complete. Any other key starts over (or starts the word
 * again, if it is the word's first letter).
 */
export function typeKey(progress: number, key: string, word: string = HOLE_WORD): { progress: number; done: boolean } {
  const k = key.toLowerCase();
  if (k === word[progress]) {
    const next = progress + 1;
    return next === word.length ? { progress: 0, done: true } : { progress: next, done: false };
  }
  return { progress: k === word[0] ? 1 : 0, done: false };
}
