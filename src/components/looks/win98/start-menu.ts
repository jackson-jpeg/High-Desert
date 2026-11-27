/**
 * The Win98 look's Start menu, as data (src/components/looks/win98/StartMenu.tsx
 * draws it). Kept pure so the list, the keyboard and the Run box are tested
 * without a DOM.
 *
 * Radio is never listed: a usage audit found the Radio tab quiet, so the
 * dial lives inside the Library (`/library?view=dial`).
 */

import { PHONE_LINES_HREF } from "@/lib/live/phone-lines";
import { REQUEST_LINE_LABEL, REQUEST_LINE_PATH } from "@/lib/live/request-line";
import { libraryIntentHref } from "@/lib/library/intents";
import { SHOW_YEARS, TOP_GUESTS } from "@/lib/shows/start-programs";
import { eraOfYear, type EraKey } from "@/lib/era/era";

export type StartAction =
  | { kind: "route"; href: string }
  | { kind: "about" }
  | { kind: "shortcuts" }
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "display" }
  | { kind: "submenu"; items: StartItem[] }
  | { kind: "run" }
  | { kind: "shutdown" }
  /** Tune in to the live station (the show on the air in Tonight's Shows). */
  | { kind: "tune" }
  /** Turn the interface sounds on or off (src/audio/ui-sounds.ts). */
  | { kind: "sounds" };

export type StartIcon =
  | "library"
  | "live"
  | "phone"
  | "request"
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
  | "shutdown"
  | "speaker";

export interface StartItem {
  id: string;
  label: string;
  /** The underlined letter: pressing it while the menu is open picks the item. */
  accel: string;
  icon: StartIcon;
  action: StartAction;
  /** A rule above this item. */
  separatorBefore?: boolean;
  /** A year's era (src/lib/era/era.ts): By Year draws a swatch in its colour. */
  era?: EraKey;
}

/** One show on tonight's log, for Tonight's Shows. */
export interface TonightEntry {
  /** "8:00 PM", Pacific, as the log prints it. */
  time: string;
  title: string;
  onAir: boolean;
}

/** One of the listener's recent shows, for Recent Shows. */
export interface RecentEntry {
  title: string;
  /** Its community key: /library?show=<key> selects it. */
  key: string;
}

export interface StartMenuContext {
  isAdmin: boolean;
  isMobile: boolean;
  /** Tonight's log; empty until the schedule has loaded. */
  tonight?: readonly TonightEntry[];
  /** The listener's last shows, newest first. */
  recent?: readonly RecentEntry[];
  /** Interface sounds: whether this device can have them, and whether they are on. */
  sounds?: { supported: boolean; on: boolean };
}

/** How many recent shows Recent Shows lists. */
export const RECENT_MAX = 5;

/** The first letter or digit of a label: a submenu item's accelerator. */
const firstKey = (label: string) => (/[A-Za-z0-9]/.exec(label)?.[0] ?? "?").toUpperCase();

/** Start > Programs' submenus: Tonight's Shows, Recent Shows, Guests, By Year. */
export function programItems({ tonight = [], recent = [] }: Pick<StartMenuContext, "tonight" | "recent">): StartItem[] {
  const route = (href: string): StartAction => ({ kind: "route", href });
  const tonightItems: StartItem[] = tonight.length
    ? tonight.map((e, i) => ({
        id: `tonight-${i}`,
        label: `${e.time}  ${e.title}${e.onAir ? " (on the air)" : ""}`,
        accel: firstKey(e.time),
        icon: "live",
        action: e.onAir ? { kind: "tune" } : route("/tonight"),
      }))
    : [{ id: "tonight-guide", label: "Program guide", accel: "P", icon: "live", action: route("/tonight") }];
  const recentItems: StartItem[] = recent.length
    ? recent.slice(0, RECENT_MAX).map((r, i) => ({
        id: `recent-${i}`,
        label: r.title,
        accel: String(i + 1),
        icon: "library",
        action: route(libraryIntentHref({ show: r.key })),
      }))
    : [{ id: "recent-none", label: "Nothing played yet: open the Library", accel: "N", icon: "library", action: route("/library") }];
  return [
    { id: "tonight", label: "Tonight's Shows", accel: "N", icon: "live", action: { kind: "submenu", items: tonightItems }, separatorBefore: true },
    { id: "recent", label: "Recent Shows", accel: "W", icon: "library", action: { kind: "submenu", items: recentItems } },
    {
      id: "guests",
      label: "Guests",
      accel: "G",
      icon: "phone",
      action: {
        kind: "submenu",
        items: TOP_GUESTS.map((g) => ({ id: `guest-${g.slug}`, label: g.name, accel: firstKey(g.name), icon: "phone", action: route(`/guest/${g.slug}`) })),
      },
    },
    {
      id: "years",
      label: "By Year",
      accel: "B",
      icon: "dial",
      action: {
        kind: "submenu",
        items: SHOW_YEARS.map((y) => ({
          id: `year-${y}`,
          label: String(y),
          accel: String(y).slice(-1),
          icon: "dial",
          era: eraOfYear(y) ?? undefined,
          action: route(`/shows/${y}`),
        })),
      },
    },
  ];
}

/** Where "Phone Lines" goes: the Live screen with the lines open (src/lib/live/phone-lines.ts). */
export { PHONE_LINES_HREF };
/** The Library's dial browse mode (an intent another branch builds). */
export const DIAL_HREF = "/library?view=dial";

export function startMenuItems({ isAdmin, isMobile, tonight, recent, sounds }: StartMenuContext): StartItem[] {
  const items: StartItem[] = [
    { id: "library", label: "Library", accel: "L", icon: "library", action: { kind: "route", href: "/library" } },
    { id: "live", label: "Live", accel: "V", icon: "live", action: { kind: "route", href: "/live" } },
    { id: "phone-lines", label: "Phone Lines", accel: "P", icon: "phone", action: { kind: "route", href: PHONE_LINES_HREF } },
    // Tonight's 10 PM pick (docs/request-line.md). Q: R is Run.
    { id: "request-line", label: REQUEST_LINE_LABEL, accel: "Q", icon: "request", action: { kind: "route", href: REQUEST_LINE_PATH } },
    { id: "dial", label: "Dial", accel: "D", icon: "dial", action: { kind: "route", href: DIAL_HREF } },
    { id: "stats", label: "Stats", accel: "S", icon: "stats", action: { kind: "route", href: "/stats" } },
    ...programItems({ tonight, recent }),
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
    action: { kind: "submenu", items: settingsItems({ isMobile, sounds }) },
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
export function settingsItems({ isMobile, sounds }: { isMobile: boolean; sounds?: StartMenuContext["sounds"] }): StartItem[] {
  const items: StartItem[] = [
    { id: "display", label: "Display...", accel: "D", icon: "display", action: { kind: "display" } },
  ];
  // Off by default; never offered where the sounds cannot play (iOS).
  if (sounds?.supported) {
    items.push({ id: "sounds", label: sounds.on ? "Sounds: On" : "Sounds: Off", accel: "S", icon: "speaker", action: { kind: "sounds" } });
  }
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
    case "requestline":
    case "request":
      return route(REQUEST_LINE_PATH);
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
