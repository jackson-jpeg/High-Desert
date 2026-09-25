"use client";

import { useEffect, useState } from "react";
import { useLiveStore, serverNow } from "@/stores/live-store";
import { warmLiveStation, SCHEDULE_POLL_MS } from "@/audio/live-controller";
import { knownSlots, locate, type LiveSchedule, type OnNow, type ProgramSlot } from "@/lib/live/schedule";

/**
 * The station's program, for a surface that shows it (the Live screen, the
 * radio dial's ON AIR lamp). Mounting one reads the program and syncs the
 * clock if they are stale, so a tap on "Tune in" can start at once; while it
 * stays mounted the program is kept fresh. The controller keeps its own poll
 * while tuned in, so this is only about surfaces that are merely looking.
 */
export function useLiveSchedule(): LiveSchedule | null {
  const schedule = useLiveStore((s) => s.schedule);
  useEffect(() => {
    void warmLiveStation();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void warmLiveStation();
    }, SCHEDULE_POLL_MS);
    return () => clearInterval(id);
  }, []);
  return schedule;
}

/**
 * The station clock (server time), ticking every `everyMs`. Only leaves that
 * display a moving number should call this — every tick re-renders the caller.
 */
export function useStationClock(everyMs = 1000): number {
  const [t, setT] = useState(() => serverNow());
  useEffect(() => {
    const tick = () => setT(serverNow());
    tick();
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return t;
}

/** What is on the station at `t`, from a published schedule. */
export function onAirAt(schedule: LiveSchedule | null, t: number): OnNow | null {
  if (!schedule) return null;
  const slots = knownSlots(schedule);
  const last = slots[slots.length - 1];
  if (!last) return null;
  return locate(slots, t, last.end);
}

/**
 * The show on the air, re-checked every `everyMs` but only *changing* (and so
 * only re-rendering the caller) when the show does. For surfaces that mark the
 * station rather than count it down — the radio dial.
 */
export function useOnAirSlot(everyMs = 5000): ProgramSlot | null {
  const schedule = useLiveSchedule();
  const [slot, setSlot] = useState<ProgramSlot | null>(null);
  useEffect(() => {
    const tick = () => {
      const on = onAirAt(schedule, serverNow());
      const next = on && "slot" in on ? on.slot : null;
      setSlot((prev) =>
        prev?.start === next?.start && prev?.fileHash === next?.fileHash ? prev : next,
      );
    };
    tick();
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [schedule, everyMs]);
  return slot;
}
