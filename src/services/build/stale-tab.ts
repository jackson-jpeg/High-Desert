/**
 * A tab left open for days updates itself to the live build, at a natural
 * break, and keeps the listener's place.
 *
 * Why: the station is left open for days, and on 2026-09-28 four of the first
 * eight failed starts after a release came from one tab still running the
 * build before it. A deploy replaces the server, not the pages already open.
 *
 * ## Knowing there is a newer build
 *
 * The page's own build is its document's `<meta name="hd-build">`
 * (src/lib/utils/build-id.ts); the server's is `/api/build`. Asked every
 * `CHECK_MS`, whenever the tab comes back on screen or gets focus, and when the
 * network returns. A difference makes the new build *pending*; nothing happens
 * until a break.
 *
 * ## The breaks (`naturalBreak`)
 *
 * Never mid-audio. With sound on, the one break is the station's gap between
 * shows (the station ID): the next show has not started, so nothing is cut,
 * and the new page starts it. That reload is only taken where the new page
 * may start sound without a tap: a Chromium engine (a same-origin reload keeps
 * the page's activation there), a tab that has had a tap, on screen. Safari
 * and iOS refuse sound after a reload, and a hidden tab's new document may not
 * be allowed to start at all; those wait for the listener to pause.
 *
 * With nothing playing (paused, held, stopped): when the tab is hidden, or
 * after `IDLE_MS` without a click, key or scroll, and never while someone is
 * typing (a call half-written on the phone lines).
 *
 * ## The listener's place
 *
 * A show and its position: the position is saved on `pagehide`, and the
 * layout primes the last show at it on load, as after any reload. The station:
 * `hd-live-tuned` brings the tab back held, and `RESUME_MARK` (written just
 * before the reload) says it was on the air, so `resumeStationAfterReload()`
 * puts it back without a tap (src/audio/live-controller.ts).
 *
 * ## Never a loop
 *
 * One reload per build: `RELOADED_FOR` remembers the build a reload was for,
 * and if the page that comes back is still not it (a proxy, a cache), it does
 * not try again for that build.
 */

import { pageBuild as readPageBuild, isBuildId } from "@/lib/utils/build-id";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/utils/safe-storage";

/** How often an open tab asks which build is live. */
export const CHECK_MS = 5 * 60_000;
/** The first check after a page loads: soon, but not in the page's busy first seconds. */
export const FIRST_CHECK_MS = 30_000;
/** Nothing playing and no input for this long is a break. */
export const IDLE_MS = 2 * 60_000;
/** A resume intent older than this is not from the reload that just happened. */
export const RESUME_FRESH_MS = 2 * 60_000;
/** sessionStorage: what the tab was doing when it reloaded itself. */
export const RESUME_MARK = "hd-update-resume";
/** sessionStorage: the build the last self-reload was for. */
export const RELOADED_FOR = "hd-update-reloaded-for";

export type BreakReason = "station-break" | "hidden" | "idle";

export interface TabState {
  /** Sound is on: the player playing, or the station on the air (its gap included). */
  playing: boolean;
  liveTuned: boolean;
  livePaused: boolean;
  livePhase: "off" | "show" | "station-id";
  hidden: boolean;
  /** Since the last click, key, touch or scroll. */
  idleMs: number;
  /** A text field has focus and something in it. */
  typing: boolean;
  /** The new page may start sound without a tap (see "The breaks"). */
  canResumeAfterReload: boolean;
}

/** Pure: whether now is a break to reload at, and which. */
export function naturalBreak(s: TabState): BreakReason | null {
  if (s.typing) return null;
  if (s.playing) {
    const onAir = s.liveTuned && !s.livePaused;
    if (onAir && s.livePhase === "station-id" && !s.hidden && s.canResumeAfterReload) return "station-break";
    return null;
  }
  if (s.hidden) return "hidden";
  if (s.idleMs >= IDLE_MS) return "idle";
  return null;
}

export interface ResumeIntent {
  /** The build the reload was for. */
  build: string;
  /** The station was on the air: put it back on without a tap. */
  live: boolean;
  reason: BreakReason;
  at: number;
}

export interface StaleTabDeps {
  fetchBuild(): Promise<string | null>;
  pageBuild(): string | null;
  state(): TabState;
  reload(): void;
  /** Called after a self-reload that left the station on the air. */
  resumeStation(): void;
  /** Subscribe to anything that can open a break (player, station); returns the unsubscribe. */
  onChange(fn: () => void): () => void;
  now?(): number;
}

export interface StaleTab {
  /** Ask which build is live. */
  check(): Promise<void>;
  /** Reload now if there is a pending build and this is a break. True if it reloaded. */
  consider(): boolean;
  /** The newer build waiting for a break, or null. */
  pending(): string | null;
  /** Record input: the idle clock starts again. */
  touch(): void;
  /** On load: finish a self-reload (resume the station). Returns the intent it acted on. */
  arrive(): ResumeIntent | null;
}

export function createStaleTab(deps: StaleTabDeps): StaleTab {
  const now = deps.now ?? (() => Date.now());
  let pendingBuild: string | null = null;
  let lastInput = now();
  let reloading = false;

  async function check() {
    const mine = deps.pageBuild();
    if (!mine) return; // a page that cannot say which build it is (dev) never reloads
    const live = await deps.fetchBuild().catch(() => null);
    if (!isBuildId(live) || live === mine) {
      pendingBuild = null;
      return;
    }
    // Already reloaded once for this build and still not on it: never loop.
    if (safeGetItem("session", RELOADED_FOR) === live) return;
    pendingBuild = live;
    consider();
  }

  function consider(): boolean {
    if (!pendingBuild || reloading) return false;
    const state = deps.state();
    const reason = naturalBreak({ ...state, idleMs: now() - lastInput });
    if (!reason) return false;
    const intent: ResumeIntent = {
      build: pendingBuild,
      live: state.liveTuned && !state.livePaused,
      reason,
      at: now(),
    };
    safeSetItem("session", RESUME_MARK, JSON.stringify(intent));
    safeSetItem("session", RELOADED_FOR, pendingBuild);
    reloading = true;
    deps.reload();
    return true;
  }

  function arrive(): ResumeIntent | null {
    const raw = safeGetItem("session", RESUME_MARK);
    safeRemoveItem("session", RESUME_MARK);
    if (!raw) return null;
    let intent: ResumeIntent | null = null;
    try {
      intent = JSON.parse(raw) as ResumeIntent;
    } catch {
      return null;
    }
    if (!intent || typeof intent.at !== "number" || now() - intent.at > RESUME_FRESH_MS) return null;
    if (intent.live) deps.resumeStation();
    return intent;
  }

  return {
    check,
    consider,
    pending: () => pendingBuild,
    touch: () => {
      lastInput = now();
    },
    arrive,
  };
}

// ---------------------------------------------------------------------------
// In the browser
// ---------------------------------------------------------------------------

/** A field with focus and something typed in it: reloading would lose it. */
function typing(): boolean {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim() !== "";
  return el.isContentEditable && (el.textContent ?? "").trim() !== "";
}

/**
 * A same-origin reload keeps the page's activation on a Chromium engine, so
 * the new page may start sound; Safari (every iOS browser) and Firefox do not
 * promise it. And the tab must have had a tap to keep.
 */
export function canResumeAfterReload(nav: Navigator = navigator): boolean {
  const data = (nav as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData;
  const chromium = !!data?.brands?.some((b) => /Chromium/i.test(b.brand));
  const activated = (nav as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === true;
  return chromium && activated;
}

export async function fetchLiveBuild(): Promise<string | null> {
  const res = await fetch("/api/build", { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as { build?: unknown };
  return isBuildId(body.build) ? body.build : null;
}

export interface BrowserStaleTabDeps {
  state(): Omit<TabState, "hidden" | "idleMs" | "typing" | "canResumeAfterReload">;
  resumeStation(): void;
  onChange(fn: () => void): () => void;
}

/**
 * Mounted once, by the desktop layout, after the live station (so a reload
 * that left the station on the air can put it back). Returns the teardown.
 */
export function installStaleTab(b: BrowserStaleTabDeps): () => void {
  const tab = createStaleTab({
    fetchBuild: fetchLiveBuild,
    pageBuild: readPageBuild,
    state: () => ({
      ...b.state(),
      hidden: document.visibilityState === "hidden",
      idleMs: 0, // replaced by the controller's own clock
      typing: typing(),
      canResumeAfterReload: canResumeAfterReload(),
    }),
    reload: () => window.location.reload(),
    resumeStation: b.resumeStation,
    onChange: b.onChange,
  });

  tab.arrive();

  const onInput = () => tab.touch();
  const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  for (const e of inputs) window.addEventListener(e, onInput, { passive: true, capture: true });

  const onVisibility = () => {
    if (document.visibilityState === "visible") void tab.check();
    else tab.consider();
  };
  const onFocus = () => void tab.check();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onFocus);

  const offChange = b.onChange(() => tab.consider());
  const firstCheck = setTimeout(() => void tab.check(), FIRST_CHECK_MS);
  const checkTimer = setInterval(() => void tab.check(), CHECK_MS);
  // The idle break opens with time, not with an event.
  const idleTimer = setInterval(() => tab.consider(), 30_000);

  return () => {
    for (const e of inputs) window.removeEventListener(e, onInput, { capture: true });
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onFocus);
    offChange();
    clearTimeout(firstCheck);
    clearInterval(checkTimer);
    clearInterval(idleTimer);
  };
}
