/**
 * The arrival funnel, browser side (docs/funnel.md).
 *
 * A browser that arrives with an empty library is a first visit, and its
 * cohort is that UTC day. From then on it reports each later step — `live`
 * (the Live screen was on screen), `tune` (tuned in), `call` (a first call
 * went through) — once, ever, against that cohort day. A browser that arrives
 * with a library already here was a visitor before the funnel existed: it is
 * excluded for good and reports nothing, so the funnel never mixes a new
 * arrival with a regular.
 *
 * "Once" is kept here, in localStorage (`hd-funnel`). The state is written
 * *before* anything is posted, and nothing is posted when it cannot be
 * written: a browser that cannot remember having counted would otherwise count
 * itself as a first visit on every page load.
 *
 * Steps can arrive before the verdict (the Live screen mounts before the
 * library count resolves on a direct load of /live). They wait in memory and
 * are reported, or dropped, when the verdict lands.
 *
 * The look (2026-10-12, docs/looks.md). Every step carries the look the page
 * was rendered in, and a step is counted once *per look*: a browser that
 * switched from Win98 to Night and tunes in again in Night counts that tune
 * toward Night's funnel too, marked `again` so the totals still count it once.
 * On every load of the app a counted browser also reports `visit` in a look it
 * has not visited in yet, and `return` the first time it is back on a later
 * UTC day than its cohort (`noteFunnelRevisit`): what an audit needs to compare
 * Win98 and Night on tune-ins and returns.
 */

import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";
import { pageLook } from "@/lib/look/choice";
import type { Look } from "@/lib/look/look";
import { notCounted } from "./not-counted";

export type FunnelStep = "visit" | "live" | "tune" | "call" | "return";
export type FunnelDevice = "phone" | "desktop";

export const FUNNEL_STORAGE_KEY = "hd-funnel";

interface FunnelState {
  /** The UTC day this browser first arrived; null = here before the funnel, never counted. */
  cohort: string | null;
  /** What it arrived as. Kept with it: a phone rotated to landscape is still the phone that arrived. */
  device?: FunnelDevice;
  done: FunnelStep[];
  /** The looks each step has been counted in. A step in `done` with no entry here was counted before looks were recorded. */
  looks?: Partial<Record<FunnelStep, Look[]>>;
}

/** The app's own breakpoint (useIsMobile): narrower than 768 px is a phone. */
export function currentDevice(): FunnelDevice {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 768px)").matches
    ? "phone"
    : "desktop";
}

let pending = new Set<FunnelStep>();

function read(): FunnelState | null {
  const raw = safeGetItem("local", FUNNEL_STORAGE_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as FunnelState;
    if (s && (s.cohort === null || typeof s.cohort === "string") && Array.isArray(s.done)) return s;
  } catch {
    /* unreadable: treated as excluded below */
  }
  return { cohort: null, done: [] };
}

function write(s: FunnelState): boolean {
  return safeSetItem("local", FUNNEL_STORAGE_KEY, JSON.stringify(s));
}

function post(step: FunnelStep, cohort: string, device: FunnelDevice, look: Look | null, again: boolean): void {
  void fetch("/api/stats/funnel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step, cohort, device, ...(look ? { look } : {}), ...(again ? { again: true } : {}) }),
    keepalive: true,
  }).catch(() => {});
}

function report(state: FunnelState, step: FunnelStep): void {
  if (state.cohort === null) return;
  // A headless checker's browser (./not-counted.ts) is nobody's arrival.
  if (notCounted()) return;
  const look = pageLook();
  const first = !state.done.includes(step);
  const counted = state.looks?.[step] ?? [];
  // Once per browser, and once more in each other look it takes the step in.
  if (!first && (look === null || counted.includes(look))) return;
  const next: FunnelState = {
    ...state,
    done: first ? [...state.done, step] : state.done,
    looks: look ? { ...state.looks, [step]: [...counted, look] } : state.looks,
  };
  if (!write(next)) return;
  state.done = next.done;
  state.looks = next.looks;
  post(step, state.cohort, state.device ?? "desktop", look, !first);
}

/**
 * The verdict, once per browser: was the library empty when this browser
 * arrived? Idempotent — a browser with a verdict keeps it.
 */
export function startFunnel(libraryWasEmpty: boolean, nowMs = Date.now(), device: FunnelDevice = currentDevice()): void {
  if (read()) return;
  const waiting = pending;
  pending = new Set();
  if (!libraryWasEmpty) {
    write({ cohort: null, done: [] });
    return;
  }
  const state: FunnelState = { cohort: new Date(nowMs).toISOString().slice(0, 10), device, done: [] };
  if (!write(state)) return;
  report(state, "visit");
  for (const step of waiting) report(state, step);
}

/**
 * This browser's own funnel arrival, for the visitor count
 * (src/services/stats/visitor-client.ts): its cohort day, device and the
 * look it first visited in; `excluded` when it arrived with a library (a
 * visitor from before the funnel); null while there is no verdict yet.
 */
export function funnelArrival(): { cohort: string; device: FunnelDevice; look: Look | null } | { excluded: true } | null {
  const state = read();
  if (!state) return null;
  if (state.cohort === null) return { excluded: true };
  return { cohort: state.cohort, device: state.device ?? "desktop", look: state.looks?.visit?.[0] ?? null };
}

/** Whether this browser already has a verdict (so no library count is needed). */
export function funnelDecided(): boolean {
  return read() !== null;
}

/**
 * The app loaded in a browser that already has a verdict: report `visit` in a
 * look it has not visited in yet, and `return` the first time it is back on a
 * later UTC day than its cohort. Nothing for an excluded browser.
 */
export function noteFunnelRevisit(nowMs = Date.now()): void {
  const state = read();
  if (!state || state.cohort === null) return;
  report(state, "visit");
  if (new Date(nowMs).toISOString().slice(0, 10) > state.cohort) report(state, "return");
}

/** A later step happened. Reported once, ever, and only for a counted browser. */
export function noteFunnelStep(step: Exclude<FunnelStep, "visit" | "return">): void {
  const state = read();
  if (!state) {
    pending.add(step);
    return;
  }
  report(state, step);
}

export function resetFunnelForTests(): void {
  pending = new Set();
}
