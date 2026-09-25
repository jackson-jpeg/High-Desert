/**
 * The live station, in the browser: tune in, stay in sync, follow the program.
 *
 * ## Where the station is
 *
 * `offset = serverNow − slot.start`. `serverNow` is the local clock plus the
 * min-RTT offset from `/api/live/time` (src/lib/live/time-sync.ts), so two
 * listeners whose laptops disagree by a minute still hear the same second.
 * The offset is computed at the moment the player assigns the source
 * (`liveStartFor`, src/audio/live-session.ts), not when the tap happened, so a
 * slow metadata fetch in between does not put anyone behind.
 *
 * ## Staying there
 *
 * Every `DRIFT_CHECK_MS` while tuned, after a stall ends (the element's
 * `waiting` → `playing`), and on returning to the tab, the element's position
 * is compared with the station's. Within ±`DRIFT_LIMIT_SEC` it is left alone —
 * a seek is audible, and small drift is what buffering does. Past it, one quiet
 * `seekEngine()`: no toast, no state churn, no new listen.
 *
 * ## Following the program
 *
 * At a slot's end (or its file's `ended`, whichever comes first) the station
 * ID plays until the next slot's start, and then the next show starts through
 * the same play path. A show whose file runs short leaves the rest of its slot
 * to the station ID, capped at `STATION_ID_SEC` of static and silence after —
 * the next show still starts on the minute it is scheduled.
 *
 * ## Pausing
 *
 * Pausing does not leave the station. It holds it: still tuned, the show
 * still in the player, the program timers stopped so nothing starts behind a
 * paused player. ▶ (any resume — the bottom player, a headset) goes back to
 * where the station is *now*: the same show at the live second if it is still
 * on, otherwise whatever is. It used to tune out, which dropped the listener
 * from the live count and turned the next ▶ into an ordinary resume from the
 * paused second.
 *
 * A reload keeps the hold. The tab's `sessionStorage` remembers that it was
 * tuned, and the station comes back held: the layout restores the show to the
 * player as it always does, and ▶ lands on the live second.
 *
 * ## Leaving
 *
 * "Leave the station" stops the player outright — audio off, the show cleared
 * from the bottom player and from what a reload restores. Picking any other
 * show also leaves, and that show plays. A failure does not: the dialog
 * explains it, and the station tries again with the next show.
 */

import type { Episode } from "@/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { serverNow, useLiveStore } from "@/stores/live-store";
import { engineState, onEngineEvent, pauseEngine, seekEngine } from "@/audio/engine";
import {
  setLiveEndedHandler,
  setLiveResumeHandler,
  setLiveStart,
  stopPlayerForLive,
} from "@/audio/live-session";
import {
  STATION_ID_SEC,
  knownSlots,
  locate,
  type LiveSchedule,
  type ProgramSlot,
} from "@/lib/live/schedule";
import { syncClock } from "@/lib/live/time-sync";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/utils/safe-storage";

/** Drift beyond this, in seconds, is corrected with a seek. The owner's number. */
export const DRIFT_LIMIT_SEC = 2;
export const DRIFT_CHECK_MS = 10_000;
/** While tuned in, re-read the schedule this often (a cheap, frozen read). */
export const SCHEDULE_POLL_MS = 60_000;
/** Re-sync the clock on tab return only if the last sync is older than this. */
export const CLOCK_STALE_MS = 5 * 60_000;
/** After a failed schedule read with nothing to play, try again after this. */
const SCHEDULE_RETRY_MS = 30_000;
/** sessionStorage: this tab is tuned in (held or playing). Survives a reload, not the tab. */
export const TUNED_MARK = "hd-live-tuned";

// Storage blocked: a reload simply forgets, as it did before.
function markTuned(on: boolean) {
  if (on) safeSetItem("session", TUNED_MARK, "1");
  else safeRemoveItem("session", TUNED_MARK);
}

function wasTuned(): boolean {
  return safeGetItem("session", TUNED_MARK) === "1";
}

export interface StationIdPlayer {
  prepare(): void;
  start(volume: number): void;
  stop(): void;
  release(): void;
}

export interface LiveDeps {
  fetchSchedule(): Promise<LiveSchedule | null>;
  fetchServerNow(): Promise<number>;
  /** Start `episode` through the app's ordinary play path. Synchronous up to play(). */
  startEpisode(episode: Episode): void;
  /** The Episode to play for a slot — synchronously; tuning in is inside a tap. */
  resolveEpisode(slot: ProgramSlot): Episode;
  /**
   * Leaving: stop the player and forget the show, so neither the bottom player
   * nor a reload brings it back. Defaults to the player's own stop.
   */
  leavePlayer?(): void;
  stationId: StationIdPlayer;
  /** Local clock. Tests replace it. */
  now?(): number;
}

/** Pure: where to seek to correct drift, or null to leave it alone. */
export function driftCorrection(
  expectedSec: number,
  actualSec: number,
  limitSec: number = DRIFT_LIMIT_SEC,
): number | null {
  return Math.abs(actualSec - expectedSec) > limitSec ? expectedSec : null;
}

/** Pure: seconds into `slot` the station is at `serverNowMs`. */
export function stationOffsetSec(slot: Pick<ProgramSlot, "start">, serverNowMs: number): number {
  return (serverNowMs - slot.start) / 1000;
}

export function slotKey(slot: Pick<ProgramSlot, "start" | "fileHash">): string {
  return `${slot.start}:${slot.fileHash}`;
}

export interface LiveStation {
  tuneIn(): void;
  tuneOut(): void;
  /** "Leave the station": tune out and stop the player. */
  leave(): void;
  /** Compare the element with the station and correct past the limit. */
  resync(): void;
  refreshSchedule(): Promise<LiveSchedule | null>;
  refreshClock(): Promise<void>;
  /** Install the listeners (ended, stall, visibility, player store). Returns the teardown. */
  install(): () => void;
}

export function createLiveStation(deps: LiveDeps): LiveStation {
  const now = deps.now ?? (() => Date.now());
  const sNow = () => serverNow(now());
  const live = () => useLiveStore.getState();

  let slotTimer: ReturnType<typeof setTimeout> | undefined;
  let staticTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let driftTimer: ReturnType<typeof setInterval> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  /** True while this module is itself changing the player — not the listener. */
  let transitioning = false;
  let stalled = false;
  let lastClockSync = 0;

  function transition(fn: () => void) {
    transitioning = true;
    try {
      fn();
    } finally {
      transitioning = false;
    }
  }

  function clearTimers() {
    clearTimeout(slotTimer);
    clearTimeout(staticTimer);
    clearTimeout(retryTimer);
    slotTimer = staticTimer = retryTimer = undefined;
  }

  /** Run `fn` when the server clock reaches `targetServerMs`. */
  function at(targetServerMs: number, fn: () => void) {
    clearTimeout(slotTimer);
    slotTimer = setTimeout(fn, Math.max(0, targetServerMs - sNow()));
  }

  async function refreshSchedule(): Promise<LiveSchedule | null> {
    const s = await deps.fetchSchedule().catch(() => null);
    if (s) live().setSchedule(s);
    return s;
  }

  async function refreshClock(): Promise<void> {
    const est = await syncClock(deps.fetchServerNow, { now });
    if (!est) return;
    live().setClock(est.offsetMs, est.rttMs);
    lastClockSync = now();
  }

  /** Put the station on whatever is scheduled right now. */
  function go() {
    if (!live().tuned) return;
    const schedule = live().schedule;
    const slots = schedule ? knownSlots(schedule) : [];
    const t = sNow();
    const last = slots[slots.length - 1];
    if (!last || t >= last.end) {
      // Nothing known covers now: the station ID, and read the program again.
      stationId(null);
      void refreshSchedule().then((s) => {
        if (!live().tuned) return;
        if (s) go();
        else retryTimer = setTimeout(go, SCHEDULE_RETRY_MS);
      });
      return;
    }
    const on = locate(slots, t, last.end);
    if ("slot" in on) startShow(on.slot);
    else stationId(on.endsAt);
  }

  function playerHas(slot: ProgramSlot): boolean {
    const p = usePlayerStore.getState();
    return p.playing && p.currentEpisode?.fileHash === slot.fileHash;
  }

  function startShow(slot: ProgramSlot) {
    const cur = live().current;
    const same = live().phase === "show" && !!cur && slotKey(cur) === slotKey(slot);
    clearTimeout(staticTimer);
    deps.stationId.stop();
    setLiveStart({
      fileHash: slot.fileHash,
      slotKey: slotKey(slot),
      startAt: () => stationOffsetSec(slot, sNow()),
    });
    live().setPhase("show", slot);
    if (same && playerHas(slot)) {
      resync();
    } else {
      transition(() => deps.startEpisode(deps.resolveEpisode(slot)));
    }
    at(slot.end, () => afterShow(slot));
  }

  /** `slot` is over (its end, or its file ran out): station ID until the next one. */
  function afterShow(slot: ProgramSlot) {
    const cur = live().current;
    if (!live().tuned || live().phase !== "show" || !cur || slotKey(cur) !== slotKey(slot)) return;
    const schedule = live().schedule;
    const slots = schedule ? knownSlots(schedule) : [];
    const next = slots.find((s) => s.start >= slot.end);
    stationId(next ? next.start : null);
  }

  function stationId(until: number | null) {
    setLiveStart(null);
    transition(() => {
      live().setPhase("station-id", null);
      const st = engineState();
      if (st && !st.paused) pauseEngine();
    });
    deps.stationId.start(usePlayerStore.getState().volume);
    clearTimeout(staticTimer);
    // An ID, not filler: a long gap (a swapped show that ran short) is quiet.
    staticTimer = setTimeout(() => deps.stationId.stop(), STATION_ID_SEC * 1000);
    if (until !== null) at(until, go);
  }

  function resync() {
    const cur = live().current;
    if (!live().tuned || live().phase !== "show" || !cur) return;
    const st = engineState();
    if (!st || st.paused || st.readyState < 1 || st.hasError) return;
    const t = sNow();
    if (t >= cur.end) {
      afterShow(cur);
      return;
    }
    const expected = stationOffsetSec(cur, t);
    live().setDrift(st.currentTime - expected);
    const target = driftCorrection(expected, st.currentTime);
    if (target !== null) seekEngine(target);
  }

  function startLoops() {
    clearInterval(driftTimer);
    clearInterval(pollTimer);
    driftTimer = setInterval(resync, DRIFT_CHECK_MS);
    pollTimer = setInterval(() => void refreshSchedule(), SCHEDULE_POLL_MS);
  }

  function tuneIn() {
    deps.stationId.prepare();
    live().setTuned(true);
    markTuned(true);
    startLoops();
    go();
    // Tuning in plays at once on whatever clock is known — it has to, inside
    // the tap. A sync that lands afterwards is applied by a quiet resync.
    if (now() - lastClockSync > CLOCK_STALE_MS) void refreshClock().then(resync);
  }

  function tuneOut() {
    if (!live().tuned) return;
    live().setTuned(false);
    markTuned(false);
    setLiveStart(null);
    clearTimers();
    clearInterval(driftTimer);
    clearInterval(pollTimer);
    driftTimer = pollTimer = undefined;
    deps.stationId.release();
  }

  function leave() {
    const was = live().tuned;
    tuneOut();
    if (!was) return;
    transition(() => (deps.leavePlayer ?? stopPlayerForLive)());
  }

  /** The listener paused: stay in the station, but start nothing behind them. */
  function hold() {
    live().setPaused(true);
    clearTimers();
    deps.stationId.stop();
  }

  /**
   * ▶ on a held station. True when the station has taken the start over (a
   * different show is on now, or nothing is known of the one in the player);
   * false after moving the playhead to the live second, for the player to
   * resume the element as usual.
   */
  function resumeHeld(): boolean {
    if (!live().tuned || !live().paused) return false;
    live().setPaused(false);
    startLoops();
    const cur = live().current;
    const t = sNow();
    const p = usePlayerStore.getState();
    const st = engineState();
    if (
      live().phase === "show" &&
      cur &&
      t < cur.end &&
      p.currentEpisode?.fileHash === cur.fileHash &&
      st &&
      !st.hasError
    ) {
      seekEngine(stationOffsetSec(cur, t));
      at(cur.end, () => afterShow(cur));
      return false;
    }
    go();
    return true;
  }

  /** A reload of a tab that was tuned in: come back held, ready for ▶. */
  function restoreHeld() {
    if (live().tuned || !wasTuned()) return;
    live().setTuned(true);
    live().setPaused(true);
    void refreshSchedule();
    if (now() - lastClockSync > CLOCK_STALE_MS) void refreshClock();
  }

  function install(): () => void {
    setLiveEndedHandler(() => {
      const cur = live().current;
      if (cur) afterShow(cur);
    });
    setLiveResumeHandler(resumeHeld);

    const offWaiting = onEngineEvent("waiting", () => {
      stalled = true;
    });
    const offPlaying = onEngineEvent("playing", () => {
      if (!stalled) return;
      stalled = false;
      resync();
    });

    const onVisibility = () => {
      if (document.visibilityState !== "visible" || !live().tuned) return;
      if (now() - lastClockSync > CLOCK_STALE_MS) void refreshClock().then(resync);
      else resync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Leaving the station: the listener picked another show. Pausing holds it.
    const offPlayer = usePlayerStore.subscribe((s, prev) => {
      if (!live().tuned || transitioning) return;
      // ■ Stop emptied the player: that is leaving, not a pause to hold.
      if (!s.currentEpisode && prev.currentEpisode) {
        tuneOut();
        return;
      }
      const { phase, current, paused } = live();
      if (paused) {
        // Held. Anything that starts sound now went around the station's own
        // resume (which clears the hold first): the listener picked a show.
        const swapped =
          !!current && !!s.currentEpisode && s.currentEpisode !== prev.currentEpisode &&
          s.currentEpisode.fileHash !== current.fileHash;
        if (swapped || (s.playing && !prev.playing)) tuneOut();
        return;
      }
      if (phase === "show" && current) {
        if (s.currentEpisode && s.currentEpisode.fileHash !== current.fileHash) {
          tuneOut();
          return;
        }
        if (prev.playing && !s.playing) {
          // Decided after the current task: the failure handler clears
          // `playing` a moment before it marks the load failed, and an error
          // or the end of the file is the station's business, not a pause.
          queueMicrotask(() => {
            if (!live().tuned || live().phase !== "show") return;
            const p = usePlayerStore.getState();
            const st = engineState();
            // `!st.paused`: a new start is under way on the element (a
            // load() between two sources can clear `playing` for a moment).
            if (p.playing || p.loadState === "failed" || !st || !st.paused || st.ended || st.hasError) return;
            hold();
          });
        }
      } else if (phase === "station-id" && s.playing && !prev.playing) {
        // Between shows the listener pressed play on something themselves.
        tuneOut();
      }
    });

    restoreHeld();

    return () => {
      setLiveEndedHandler(null);
      setLiveResumeHandler(null);
      offWaiting();
      offPlaying();
      document.removeEventListener("visibilitychange", onVisibility);
      offPlayer();
      // Uninstalling is not the listener leaving: keep the tab's mark, or a
      // remount (StrictMode's, a layout re-key) would forget it was tuned.
      const keep = wasTuned();
      tuneOut();
      if (keep) markTuned(true);
    };
  }

  return { tuneIn, tuneOut, leave, resync, refreshSchedule, refreshClock, install };
}

// ---------------------------------------------------------------------------
// The page's one station
// ---------------------------------------------------------------------------

let station: LiveStation | null = null;
/**
 * A surface asked for the program before the station was installed. React runs
 * a child's effects before its parent's, so on a direct load of /live the
 * screen's warm-up runs before the layout's install — and without this it was
 * dropped, leaving "Warming up the transmitter…" on screen for a full poll.
 */
let warmPending = false;

/** Mounted once, by the desktop layout. Returns the teardown. */
export function installLiveStation(deps: LiveDeps): () => void {
  const s = createLiveStation(deps);
  station = s;
  const off = s.install();
  if (warmPending) {
    warmPending = false;
    void warmLiveStation();
  }
  return () => {
    off();
    if (station === s) station = null;
  };
}

/** Tune in (from a tap: the Live screen, the ON AIR lamp). */
export function tuneIn(): void {
  station?.tuneIn();
}

export function tuneOut(): void {
  station?.tuneOut();
}

/** "Leave the station": tune out, stop the audio, clear the player. */
export function leaveStation(): void {
  station?.leave();
}

/**
 * A surface that shows the station is on screen: have the program and the
 * clock ready, so a tap can start at once. Cheap when both are fresh.
 */
export async function warmLiveStation(): Promise<void> {
  if (!station) {
    warmPending = true;
    return;
  }
  const { schedule, clockOffsetMs } = useLiveStore.getState();
  const stale = !schedule || serverNow() - schedule.serverNow > SCHEDULE_POLL_MS;
  await Promise.all([
    stale ? station.refreshSchedule() : null,
    clockOffsetMs === null ? station.refreshClock() : null,
  ]);
}
