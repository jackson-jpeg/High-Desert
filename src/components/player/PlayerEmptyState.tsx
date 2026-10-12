"use client";

import { useAppPathname } from "@/hooks/useAppPathname";
import { cn } from "@/lib/utils/cn";
import { useLook } from "@/hooks/useLook";
import { useOnAirSlot } from "@/hooks/useLiveStation";
import { useLiveStore } from "@/stores/live-store";
import { tuneIn } from "@/audio/live-controller";
import { episodeTitle } from "@/lib/library/display-title";
import type { ProgramSlot } from "@/lib/live/schedule";

/**
 * The player with nothing loaded (it used to draw nothing at all): what is on
 * the station now, and one tap to tune in. `tuneIn()` runs inside the tap, so
 * the browser lets audio start. The program comes from the shared live store
 * through `useOnAirSlot` (the same reader as the dial's ON AIR lamp), never a
 * poller of its own.
 *
 * Not on the Live screen: that screen is the station, and on a phone its
 * Listen live card is the one tune-in control (docs/funnel.md).
 *
 * Win98 draws it as an idle Winamp strip, Night as its mini bar.
 */
export function PlayerEmptyState() {
  const pathname = useAppPathname();
  const look = useLook();
  const slot = useOnAirSlot();
  const haveProgram = useLiveStore((s) => s.schedule !== null);
  if (pathname === "/live") return null;
  return look === "win98" ? (
    <Win98Idle slot={slot} canTune={haveProgram} />
  ) : (
    <NightIdle slot={slot} canTune={haveProgram} />
  );
}

/** What the strip says: the show on the air, its guest, or the gap between shows. */
export function onAirLine(slot: ProgramSlot | null, haveProgram: boolean): { title: string; guest: string | null } {
  if (slot) return { title: episodeTitle({ title: slot.title, fileName: "" }), guest: slot.guestName };
  if (haveProgram) return { title: "Between shows. The next one starts in a moment.", guest: null };
  return { title: "Nothing playing. Pick a show from the Library.", guest: null };
}

function Win98Idle({ slot, canTune }: { slot: ProgramSlot | null; canTune: boolean }) {
  const line = onAirLine(slot, canTune);
  return (
    <div data-testid="player-empty" data-look-variant="win98" className="hd-w98-idle flex items-center gap-2 px-2 py-1 w98-font">
      <div className="hd-w98-idle-lcd flex-1 min-w-0 flex flex-col justify-center px-2 py-[2px]">
        <span className="text-hd-micro uppercase tracking-wider">{slot ? "On the air now" : "High Desert Live"}</span>
        <span className="text-hd-caption truncate" data-testid="player-empty-title">
          {line.title}
          {line.guest && <span> with {line.guest}</span>}
        </span>
      </div>
      {canTune && (
        <button
          type="button"
          onClick={() => tuneIn()}
          data-testid="player-empty-tune"
          className="hd-w98-idle-tune w98-raised-dark bg-raised-surface text-hd-12 font-bold px-3 min-h-touch md:min-h-[26px] cursor-pointer flex-shrink-0"
        >
          Tune in
        </button>
      )}
    </div>
  );
}

function NightIdle({ slot, canTune }: { slot: ProgramSlot | null; canTune: boolean }) {
  const line = onAirLine(slot, canTune);
  return (
    <div
      data-testid="player-empty"
      data-look-variant="night"
      className={cn(
        "flex items-center gap-3 px-3 py-2 md:py-1.5",
        "glass-light glass-promote md:bg-midnight/80 md:border-t md:border-bevel-dark/15",
      )}
    >
      <span className="w-[8px] h-[8px] rounded-full bg-red-500 animate-on-air flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0 flex flex-col">
        <span className="text-hd-micro uppercase tracking-wider text-bevel-dark">
          {slot ? "On the air now" : "High Desert Live"}
        </span>
        <span className="text-hd-body md:text-hd-caption text-desktop-gray truncate" data-testid="player-empty-title">
          {line.title}
          {line.guest && <span className="text-static-green"> with {line.guest}</span>}
        </span>
      </div>
      {canTune && (
        <button
          type="button"
          onClick={() => tuneIn()}
          data-testid="player-empty-tune"
          className="min-h-touch md:min-h-[30px] px-4 rounded-full bg-desert-amber text-midnight text-hd-body md:text-hd-caption font-bold cursor-pointer flex-shrink-0"
        >
          Tune in
        </button>
      )}
    </div>
  );
}
