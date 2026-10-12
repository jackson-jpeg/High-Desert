"use client";

import { useEffect, useState } from "react";
import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";

/**
 * "Put High Desert on your home screen", offered from a listener's second
 * visit (docs/funnel.md, "Install to home screen").
 *
 * - **A visit** is a new day or a new browser session, whichever comes first:
 *   counted once per page load at most, in localStorage `hd-visits`
 *   (`{n, day}`), with sessionStorage `hd-visit-counted` marking the session.
 *   Where storage cannot be read or written nothing is counted, so the
 *   prompt never shows rather than showing every time.
 * - **What it offers.** Where the browser fires `beforeinstallprompt`
 *   (Chromium: Android, desktop) an Install button that calls the browser's
 *   own prompt. On iPhone and iPad Safari, which has no install button, two
 *   steps: tap Share, then Add to Home Screen. Anywhere else, nothing.
 * - **Never** when the app is already installed (`display-mode: standalone`,
 *   or `navigator.standalone` on iOS), or after `appinstalled`.
 * - **Dismissed**, it stays away for 90 days; dismissed a second time, it
 *   never comes back (localStorage `hd-install-prompt`).
 *
 * The browser's event is captured once for the page (`captureInstallPrompt`,
 * installed by the shell, which used to keep it in its own state) and shared:
 * the shell's File menu Install item and the prompt read the same one.
 */

export const VISITS_KEY = "hd-visits";
export const VISIT_SESSION_KEY = "hd-visit-counted";
export const INSTALL_KEY = "hd-install-prompt";
/** The prompt shows from this visit on. */
export const MIN_VISITS = 2;
/** A first "Not now" keeps it away this long. */
export const SNOOZE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Visits {
  n: number;
  /** Local YYYY-MM-DD of the last counted visit. */
  day: string;
}

export interface InstallDismissal {
  dismissals: number;
  /** Epoch ms until which it stays away; null with dismissals ≥ 2 means never. */
  until: number | null;
}

/** The local calendar day, YYYY-MM-DD. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The count after this page load: one more on a new session or a new day, otherwise unchanged. */
export function nextVisits(prev: Visits | null, { newSession, today }: { newSession: boolean; today: string }): Visits {
  if (!prev) return { n: 1, day: today };
  if (newSession || prev.day !== today) return { n: prev.n + 1, day: today };
  return prev;
}

function readJson<T>(area: "local" | "session", key: string): T | null {
  const raw = safeGetItem(area, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Count this page load as a visit if it is one, and return the count. 0 when
 * storage cannot be written (nothing counted, so nothing offered).
 */
export function noteVisit(now: Date = new Date()): number {
  const prev = readJson<Visits>("local", VISITS_KEY);
  const valid = prev && Number.isFinite(prev.n) && typeof prev.day === "string" ? prev : null;
  const newSession = safeGetItem("session", VISIT_SESSION_KEY) !== "1";
  // A session that cannot be marked would count every page load.
  if (!safeSetItem("session", VISIT_SESSION_KEY, "1")) return 0;
  const next = nextVisits(valid, { newSession, today: dayOf(now) });
  if (next !== valid && !safeSetItem("local", VISITS_KEY, JSON.stringify(next))) return 0;
  return next.n;
}

/** The count so far, without counting. */
export function visitCount(): number {
  const v = readJson<Visits>("local", VISITS_KEY);
  return v && Number.isFinite(v.n) ? v.n : 0;
}

export function readDismissal(): InstallDismissal {
  const d = readJson<InstallDismissal>("local", INSTALL_KEY);
  if (d && Number.isFinite(d.dismissals)) return { dismissals: d.dismissals, until: d.until ?? null };
  return { dismissals: 0, until: null };
}

/** The record after one more "Not now": 90 days the first time, for good the second. */
export function nextDismissal(prev: InstallDismissal, now: number): InstallDismissal {
  const dismissals = prev.dismissals + 1;
  return { dismissals, until: dismissals >= 2 ? null : now + SNOOZE_DAYS * DAY_MS };
}

/** "Not now". Not stored (storage blocked): it comes back next visit, nothing better to do. */
export function dismissInstall(now: number = Date.now()): void {
  safeSetItem("local", INSTALL_KEY, JSON.stringify(nextDismissal(readDismissal(), now)));
}

/** Installed: never offer again (the standalone check covers the installed app itself). */
export function markInstalled(): void {
  safeSetItem("local", INSTALL_KEY, JSON.stringify({ dismissals: 2, until: null } satisfies InstallDismissal));
}

export function isDismissed(d: InstallDismissal, now: number): boolean {
  if (d.dismissals >= 2) return true;
  return d.dismissals > 0 && d.until !== null && now < d.until;
}

/** Running as an installed app. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * iPhone or iPad Safari itself: the one iOS browser whose Share sheet has Add
 * to Home Screen where these instructions say. In-app browsers (Reddit,
 * Facebook, Instagram) and the other iOS browsers are left out: their share
 * button is elsewhere, or they cannot add to the home screen at all.
 */
export function isIosSafari(ua: string, maxTouchPoints: number): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua) || (maxTouchPoints > 1 && /Macintosh/.test(ua));
  if (!ios) return false;
  if (!/Safari\//.test(ua) || !/Version\//.test(ua)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo|FBAN|FBAV|Instagram|Reddit|Snapchat|Twitter|LinkedIn/.test(ua);
}

export type InstallMode = "install" | "ios" | null;

/** What to offer, if anything. Pure: the inputs are read by `useInstallMode`. */
export function installMode(o: {
  visits: number;
  standalone: boolean;
  dismissal: InstallDismissal;
  now: number;
  canPrompt: boolean;
  iosSafari: boolean;
}): InstallMode {
  if (o.standalone || o.visits < MIN_VISITS || isDismissed(o.dismissal, o.now)) return null;
  if (o.canPrompt) return "install";
  if (o.iosSafari) return "ios";
  return null;
}

// ---------------------------------------------------------------------------
// The browser's beforeinstallprompt, captured once and shared
// ---------------------------------------------------------------------------

let deferred: BeforeInstallPromptEvent | null = null;
let captures = 0;
let release: (() => void) | null = null;
const subscribers = new Set<() => void>();

function changed() {
  for (const fn of subscribers) fn();
}

/** Listen for the browser's install event for this page. Ref-counted; returns the release. */
export function captureInstallPrompt(): () => void {
  captures++;
  if (captures === 1) {
    const onPrompt = (e: BeforeInstallPromptEvent) => {
      // The browser's own mini-infobar would cover the player; ours is inline.
      e.preventDefault();
      deferred = e;
      changed();
    };
    const onInstalled = () => {
      deferred = null;
      markInstalled();
      changed();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    release = () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }
  return () => {
    captures--;
    if (captures === 0) {
      release?.();
      release = null;
    }
  };
}

/** The browser's install prompt, if it has offered one. */
export function useDeferredInstall(): BeforeInstallPromptEvent | null {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(deferred);
  useEffect(() => {
    const fn = () => setEvent(deferred);
    subscribers.add(fn);
    fn();
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return event;
}

/** Show the browser's prompt. It can be shown once; afterwards there is none. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const e = deferred;
  if (!e) return null;
  deferred = null;
  changed();
  try {
    const choice = await e.prompt();
    if (choice?.outcome === "accepted") markInstalled();
    return choice?.outcome ?? null;
  } catch {
    return null;
  }
}

/** What this page should offer, decided after mount (storage and media queries are client-only). */
export function useInstallMode(): InstallMode {
  const event = useDeferredInstall();
  const [mode, setMode] = useState<InstallMode>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only inputs, read after mount
    setMode(
      installMode({
        // Counted here too, not only by the shell: a child's effect runs
        // before its parent's, so on the second visit's first page the
        // shell's count would come after this read. Counting is idempotent
        // within a session and a day.
        visits: noteVisit(),
        standalone: isStandalone(),
        dismissal: readDismissal(),
        now: Date.now(),
        canPrompt: !!event,
        iosSafari: isIosSafari(navigator.userAgent, navigator.maxTouchPoints ?? 0),
      }),
    );
  }, [event]);
  return mode;
}

export function resetInstallPromptForTests(): void {
  release?.();
  release = null;
  captures = 0;
  deferred = null;
  subscribers.clear();
}
