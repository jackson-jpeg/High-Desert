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
 */

import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";

export type FunnelStep = "visit" | "live" | "tune" | "call";
export type FunnelDevice = "phone" | "desktop";

export const FUNNEL_STORAGE_KEY = "hd-funnel";

interface FunnelState {
  /** The UTC day this browser first arrived; null = here before the funnel, never counted. */
  cohort: string | null;
  /** What it arrived as. Kept with it: a phone rotated to landscape is still the phone that arrived. */
  device?: FunnelDevice;
  done: FunnelStep[];
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

function post(step: FunnelStep, cohort: string, device: FunnelDevice): void {
  void fetch("/api/stats/funnel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step, cohort, device }),
    keepalive: true,
  }).catch(() => {});
}

function report(state: FunnelState, step: FunnelStep): void {
  if (state.cohort === null || state.done.includes(step)) return;
  const next = { ...state, done: [...state.done, step] };
  if (!write(next)) return;
  state.done = next.done;
  post(step, state.cohort, state.device ?? "desktop");
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

/** Whether this browser already has a verdict (so no library count is needed). */
export function funnelDecided(): boolean {
  return read() !== null;
}

/** A later step happened. Reported once, ever, and only for a counted browser. */
export function noteFunnelStep(step: Exclude<FunnelStep, "visit">): void {
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
