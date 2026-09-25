import { create } from "zustand";
import type { LiveSchedule, ProgramSlot } from "@/lib/live/schedule";

/**
 * The live station, as this browser sees it.
 *
 *   tuned          the listener has tuned in; cleared the moment they leave
 *                  (Leave the station, or pick another show) —
 *                  src/audio/live-controller.ts
 *   paused         tuned, but the listener paused the player: still in the
 *                  station, and ▶ goes back to where the station is now
 *   phase          "show" while a slot is on, "station-id" in the gap between
 *                  shows, "off" when not tuned
 *   current        the slot this browser is playing (null in the station ID)
 *   clockOffsetMs  server clock − local clock, from the min-RTT time sync
 *                  (src/lib/live/time-sync.ts); null until the first sync
 *   clockRttMs     that sample's round trip — the offset is good to half of it
 *   schedule       the last GET /api/live/schedule
 *   drift          element position − where the station is, seconds, at the
 *                  last check; resynced past ±2 s
 */

export type LivePhase = "off" | "show" | "station-id";

interface LiveState {
  tuned: boolean;
  paused: boolean;
  phase: LivePhase;
  current: ProgramSlot | null;
  clockOffsetMs: number | null;
  clockRttMs: number | null;
  schedule: LiveSchedule | null;
  drift: number | null;
  setSchedule: (schedule: LiveSchedule) => void;
  setClock: (offsetMs: number, rttMs: number) => void;
  setTuned: (tuned: boolean) => void;
  setPaused: (paused: boolean) => void;
  setPhase: (phase: Exclude<LivePhase, "off">, current: ProgramSlot | null) => void;
  setDrift: (drift: number | null) => void;
}

export const useLiveStore = create<LiveState>((set, get) => ({
  tuned: false,
  paused: false,
  phase: "off",
  current: null,
  clockOffsetMs: null,
  clockRttMs: null,
  schedule: null,
  drift: null,

  setSchedule: (schedule) => {
    // Responses can land out of order (a slow poll behind a fast refetch at a
    // slot boundary). An older answer must not replace a newer one: it would
    // put the previous show back on the guide.
    const held = get().schedule;
    if (held && held.serverNow > schedule.serverNow) return;
    set({ schedule });
  },
  setClock: (offsetMs, rttMs) => set({ clockOffsetMs: offsetMs, clockRttMs: rttMs }),
  setTuned: (tuned) =>
    set(tuned ? { tuned, paused: false } : { tuned, paused: false, phase: "off", current: null, drift: null }),
  setPaused: (paused) => {
    if (!get().tuned) return;
    set({ paused });
  },
  setPhase: (phase, current) => {
    if (!get().tuned) return;
    set({ phase, current, drift: null });
  },
  setDrift: (drift) => set({ drift }),
}));

/** The server's clock, as best this browser knows it. Local time until the first sync. */
export function serverNow(now: number = Date.now()): number {
  return now + (useLiveStore.getState().clockOffsetMs ?? 0);
}
