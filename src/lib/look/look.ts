/**
 * The site's two looks (docs/looks.md).
 *
 *   win98  gray Windows 98: the default, what a visitor with no choice sees.
 *   night  the dark theme: anyone can switch to it.
 *
 * The choice is per device: a plain cookie, `hd_look`, that anyone may set
 * (Start > Settings > Display in Win98, More > Display in Night, or the
 * first-visit offer). `src/proxy.ts` reads it on every page request and
 * rewrites into the `[look]` segment (`src/app/[look]/`), so the server renders
 * the chosen look and the page never flashes the other one. Both looks are
 * prerendered; nothing reads a cookie during rendering.
 */

export const LOOKS = ["win98", "night"] as const;
export type Look = (typeof LOOKS)[number];

/** What a visitor who has never chosen gets, and what crawlers see. */
export const DEFAULT_LOOK: Look = "win98";

export const LOOK_COOKIE = "hd_look";
/** 400 days: the most a browser keeps a cookie for. */
export const LOOK_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export const LOOK_LABELS: Record<Look, string> = {
  win98: "Win98",
  night: "Night",
};

export function isLook(v: unknown): v is Look {
  return v === "win98" || v === "night";
}

/** The look a cookie value asks for, or the default. */
export function lookFrom(value: string | undefined | null): Look {
  return isLook(value) ? value : DEFAULT_LOOK;
}

/** The look `document.cookie` holds, or the default. */
export function lookFromCookieString(cookie: string): Look {
  const m = /(?:^|;\s*)hd_look=([a-z0-9]+)(?:;|$)/.exec(cookie);
  return lookFrom(m?.[1]);
}

/** A `document.cookie` assignment that remembers `look` on this device. */
export function lookCookie(look: Look, secure: boolean): string {
  return `${LOOK_COOKIE}=${look}; Path=/; Max-Age=${LOOK_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
