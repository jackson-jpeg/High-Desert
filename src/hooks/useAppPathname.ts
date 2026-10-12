"use client";

// The one place that may call usePathname (eslint.config.mjs bans it elsewhere).
// eslint-disable-next-line no-restricted-imports
import { usePathname } from "next/navigation";

const LOOK_PREFIX = /^\/(?:win98|night)(?=\/|$)/;

/** A pathname with the `[look]` segment taken off: "/win98/live" is "/live". */
export function appPathname(pathname: string): string {
  return pathname.replace(LOOK_PREFIX, "") || "/";
}

/**
 * The page's path as the visitor sees it, the same on the server and in the
 * browser.
 *
 * Every page is rendered inside the `[look]` segment through a rewrite
 * (next.config.ts), so `usePathname()` answers "/win98/live" while a page is
 * prerendered and "/live" in the browser. Anything that branched on it drew
 * one tree on the server and another in the browser: the empty player showed
 * on /live in the server HTML, React threw away the page (#418) and the boot
 * screen stayed up.
 */
export function useAppPathname(): string {
  return appPathname(usePathname() ?? "/");
}
